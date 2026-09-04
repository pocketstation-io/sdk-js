import { PocketStationError } from '../errors.js';
import { SignalingTransport } from './signaling.js';
import type {
  RelayConfig,
  RelayCredentials,
  RelayServerMessage,
  RelayStats,
} from './types.js';

/** Join as a publisher and send one browser audio track. */
export interface RelayPublishOptions {
  /** Select the publisher operation. */
  role: 'publisher';
  /** Browser audio track to publish. */
  track: MediaStreamTrack;
  /** Existing credentials, or omit to create a Relay session. */
  credentials?: RelayCredentials;
}

/** Join as a receiver and obtain the remote audio stream. */
export interface RelayReceiveOptions {
  /** Select the receiver operation. */
  role: 'receiver';
  /** Existing credentials, or omit to create a Relay session. */
  credentials?: RelayCredentials;
}

/** Options for joining a Relay session. */
export type RelayConnectOptions = RelayPublishOptions | RelayReceiveOptions;

/** @internal */
export async function requestRelayCredentials(
  config: RelayConfig,
): Promise<RelayCredentials> {
  const response = await fetch(`${config.controlUrl}/v1/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new PocketStationError(
      'relay.session_create_failed',
      `PocketStation could not create a Relay session: HTTP ${response.status}`,
    );
  }
  const body = (await response.json()) as Record<string, unknown>;
  if (
    typeof body.room_id !== 'string' ||
    typeof body.source_token !== 'string' ||
    typeof body.listener_token !== 'string'
  ) {
    throw new PocketStationError(
      'relay.invalid_session_response',
      'PocketStation control service returned an invalid Relay session',
    );
  }
  return {
    sessionId: body.room_id,
    publisherToken: body.source_token,
    receiverToken: body.listener_token,
    iceServers: body.ice_servers as RTCIceServer[] | undefined,
  };
}

/** Owns one browser WebRTC connection to PocketStation Relay. */
export class RelaySession {
  readonly #config: RelayConfig;
  #transport: SignalingTransport | null = null;
  #connection: RTCPeerConnection | null = null;
  #credentials: RelayCredentials | null = null;
  #remoteStream: MediaStream | null = null;
  #pendingAnswer: ((sdp: string) => void) | null = null;

  public constructor(config: RelayConfig) {
    this.#config = config;
  }

  /** Publish one track or receive the remote stream. */
  public async connect(options: RelayPublishOptions): Promise<null>;
  /** Receive the remote stream from an existing or newly created Relay session. */
  public async connect(options: RelayReceiveOptions): Promise<MediaStream>;
  public async connect(options: RelayConnectOptions): Promise<MediaStream | null> {
    if (this.#connection !== null || this.#transport !== null) {
      throw new PocketStationError(
        'relay.already_connected',
        'RelaySession has already connected',
      );
    }
    this.#credentials = options.credentials ?? (await this.createSession());
    const token =
      options.role === 'publisher'
        ? this.#credentials.publisherToken
        : this.#credentials.receiverToken;

    this.#transport = new SignalingTransport(this.#config.relayUrl);
    await this.#transport.open(
      (message) => this.handleMessage(message),
      () => undefined,
    );

    this.#connection = new RTCPeerConnection({
      iceServers: this.#credentials.iceServers ?? [],
    });
    this.#connection.onicecandidate = (event) => {
      if (event.candidate !== null) {
        this.#transport?.send({
          type: 'ICE',
          candidate: event.candidate.candidate,
        });
      }
    };

    if (options.role === 'publisher') {
      await this.publish(token, options.track);
      return null;
    }
    return this.receive(token);
  }

  /** Send LEAVE and close the WebRTC and WebSocket resources. */
  public disconnect(): void {
    if (this.#transport?.isOpen === true) {
      this.#transport.send({ type: 'LEAVE' });
    }
    this.#transport?.close();
    this.#connection?.close();
    this.#transport = null;
    this.#connection = null;
    this.#pendingAnswer = null;
  }

  /** Read a point-in-time WebRTC statistics summary. */
  public async getStats(): Promise<RelayStats | null> {
    if (this.#connection === null) {
      return null;
    }
    const reports = await this.#connection.getStats();
    let packetsReceived = 0;
    let packetsLost = 0;
    let bytesReceived = 0;
    let jitterMs = 0;
    let roundTripTimeMs: number | null = null;

    reports.forEach((report) => {
      if (report.type === 'inbound-rtp') {
        const inbound = report as RTCInboundRtpStreamStats;
        packetsReceived += inbound.packetsReceived ?? 0;
        packetsLost += inbound.packetsLost ?? 0;
        bytesReceived += inbound.bytesReceived ?? 0;
        jitterMs = Math.max(jitterMs, (inbound.jitter ?? 0) * 1_000);
      }
      if (report.type === 'remote-inbound-rtp') {
        const remote = report as RTCInboundRtpStreamStats & {
          roundTripTime?: number;
        };
        if (remote.roundTripTime !== undefined) {
          roundTripTimeMs = remote.roundTripTime * 1_000;
        }
      }
    });

    return {
      packetsReceived,
      packetsLost,
      bytesReceived,
      jitterMs,
      roundTripTimeMs,
    };
  }

  /** Remote audio received after joining as a receiver. */
  public get remoteStream(): MediaStream | null {
    return this.#remoteStream;
  }

  /** Relay session identity assigned by the control service. */
  public get sessionId(): string | null {
    return this.#credentials?.sessionId ?? null;
  }

  private async createSession(): Promise<RelayCredentials> {
    return requestRelayCredentials(this.#config);
  }

  private handleMessage(message: RelayServerMessage): void {
    switch (message.type) {
      case 'SDP_ANSWER':
        if (message.sdp_answer !== undefined) {
          this.#pendingAnswer?.(message.sdp_answer);
        }
        break;
      case 'ICE':
        if (message.candidate !== undefined) {
          void this.#connection
            ?.addIceCandidate({ candidate: message.candidate })
            .catch(() => undefined);
        }
        break;
      case 'ERROR':
        throw new PocketStationError(
          message.code ?? 'relay.failure',
          message.message ?? 'PocketStation Relay reported an error',
        );
    }
  }

  private async publish(token: string, track: MediaStreamTrack): Promise<void> {
    this.#connection?.addTrack(track);
    const offer = await this.#connection!.createOffer();
    await this.#connection!.setLocalDescription(offer);
    const answer = await this.waitForAnswer({
      type: 'PUBLISH',
      token,
      sdp_offer: offer.sdp,
    });
    await this.#connection!.setRemoteDescription({ type: 'answer', sdp: answer });
  }

  private async receive(token: string): Promise<MediaStream> {
    this.#remoteStream = new MediaStream();
    this.#connection!.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => {
        this.#remoteStream?.addTrack(track);
      });
    };
    this.#connection!.addTransceiver('audio', { direction: 'recvonly' });
    const offer = await this.#connection!.createOffer();
    await this.#connection!.setLocalDescription(offer);
    const answer = await this.waitForAnswer({
      type: 'SUBSCRIBE',
      token,
      sdp_offer: offer.sdp,
    });
    await this.#connection!.setRemoteDescription({ type: 'answer', sdp: answer });
    return this.#remoteStream;
  }

  private waitForAnswer(message: {
    type: 'PUBLISH' | 'SUBSCRIBE';
    token: string;
    sdp_offer: string | undefined;
  }): Promise<string> {
    return new Promise<string>((resolve) => {
      this.#pendingAnswer = resolve;
      this.#transport!.send(message);
    });
  }
}
