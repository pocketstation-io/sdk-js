/**
 * RoomClient — high-level PocketStation session client.
 *
 * Manages the full lifecycle of a single source or listener session:
 * room creation → signaling → ICE negotiation → RTP media → teardown.
 *
 * Invariant: one active PeerConnection per RoomClient. Sessions are not
 * reused after disconnect().
 *
 * Ownership: caller owns the RoomClient; call disconnect() on teardown.
 * Failure behavior: throws PocketStationError on network / protocol failure.
 */
import { SignalingTransport } from './SignalingTransport.js';
import {
  PocketStationConfig,
  RoomCredentials,
  ServerMessage,
  SessionStats,
  PocketStationError,
} from './types.js';

type SessionRole = 'source' | 'listener';

/** Options for RoomClient.connect(). */
export interface ConnectOptions {
  /** Role to join as. */
  role: SessionRole;
  /**
   * For source: the MediaStreamTrack to publish.
   * For listener: omit (track is received from the relay).
   */
  track?: MediaStreamTrack;
  /**
   * Room credentials from a prior POST /v1/rooms call.
   * If omitted, RoomClient calls POST /v1/rooms automatically.
   */
  credentials?: RoomCredentials;
}

export class RoomClient {
  private readonly config: PocketStationConfig;
  private transport: SignalingTransport | null = null;
  private pc: RTCPeerConnection | null = null;
  private credentials: RoomCredentials | null = null;
  private _remoteStream: MediaStream | null = null;

  constructor(config: PocketStationConfig) {
    this.config = config;
  }

  /**
   * Connect to a PocketStation room as source or listener.
   *
   * For source: publishes `options.track` to the relay.
   * For listener: subscribes and resolves with the remote MediaStream.
   *
   * @returns The remote MediaStream (listener) or null (source).
   */
  async connect(options: ConnectOptions): Promise<MediaStream | null> {
    this.credentials = options.credentials ?? (await this._createRoom());

    const token =
      options.role === 'source'
        ? this.credentials.sourceToken
        : this.credentials.listenerToken;

    this.transport = new SignalingTransport(this.config.relayUrl);
    await this.transport.open(
      (msg) => this._handleMessage(msg),
      (err) => { throw err; },
    );

    this.pc = new RTCPeerConnection({
      iceServers: this.credentials.iceServers ?? [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.transport?.send({ type: 'ICE', candidate: event.candidate.candidate });
      }
    };

    if (options.role === 'source') {
      return this._publishFlow(token, options.track!);
    } else {
      return this._subscribeFlow(token);
    }
  }

  /** Send a LEAVE message and close the PeerConnection and WebSocket. */
  disconnect(): void {
    this.transport?.send({ type: 'LEAVE' });
    this.transport?.close();
    this.pc?.close();
    this.transport = null;
    this.pc = null;
  }

  /**
   * Return a snapshot of session statistics from the active PeerConnection.
   * Returns null if not connected.
   */
  async getStats(): Promise<SessionStats | null> {
    if (!this.pc) {
      return null;
    }
    const reports = await this.pc.getStats();
    let packetsReceived = 0;
    let packetsLost = 0;
    let bytesReceived = 0;
    let jitter = 0;
    let roundTripTime: number | null = null;

    reports.forEach((report) => {
      if (report.type === 'inbound-rtp') {
        const r = report as RTCInboundRtpStreamStats;
        packetsReceived += r.packetsReceived ?? 0;
        packetsLost += r.packetsLost ?? 0;
        bytesReceived += r.bytesReceived ?? 0;
        jitter = Math.max(jitter, (r.jitter ?? 0) * 1000);
      }
      if (report.type === 'remote-inbound-rtp') {
        const r = report as RTCInboundRtpStreamStats & { roundTripTime?: number };
        if (r.roundTripTime != null) {
          roundTripTime = r.roundTripTime * 1000;
        }
      }
    });

    return { packetsReceived, packetsLost, bytesReceived, jitterMs: jitter, roundTripTimeMs: roundTripTime };
  }

  /** The remote MediaStream (listener sessions only, after connect resolves). */
  get remoteStream(): MediaStream | null {
    return this._remoteStream;
  }

  /** The room ID this client is connected to. */
  get roomId(): string | null {
    return this.credentials?.roomId ?? null;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async _createRoom(): Promise<RoomCredentials> {
    const response = await fetch(`${this.config.apiUrl}/v1/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new PocketStationError(
        `Failed to create room: HTTP ${response.status}`,
        'room_create_failed',
      );
    }
    const body = await response.json() as {
      room_id: string;
      source_token: string;
      listener_token: string;
      ice_servers?: RTCIceServer[];
    };
    return {
      roomId: body.room_id,
      sourceToken: body.source_token,
      listenerToken: body.listener_token,
      iceServers: body.ice_servers,
    };
  }

  private _pendingAnswer: ((sdp: string) => void) | null = null;
  private _pendingTrack: ((stream: MediaStream) => void) | null = null;

  private _handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'SDP_ANSWER':
        this._pendingAnswer?.(msg.sdp_answer!);
        break;
      case 'ICE':
        if (msg.candidate) {
          this.pc?.addIceCandidate({ candidate: msg.candidate }).catch(() => {});
        }
        break;
      case 'ERROR':
        throw new PocketStationError(
          msg.message ?? 'relay error',
          msg.code ?? 'relay_error',
        );
    }
  }

  private async _publishFlow(
    token: string,
    track: MediaStreamTrack,
  ): Promise<null> {
    this.pc!.addTrack(track);
    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);

    const answerSdp = await new Promise<string>((resolve) => {
      this._pendingAnswer = resolve;
      this.transport!.send({ type: 'PUBLISH', token, sdp_offer: offer.sdp });
    });

    await this.pc!.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    return null;
  }

  private async _subscribeFlow(token: string): Promise<MediaStream> {
    this._remoteStream = new MediaStream();
    this.pc!.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((t) => this._remoteStream!.addTrack(t));
    };

    this.pc!.addTransceiver('audio', { direction: 'recvonly' });
    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);

    const answerSdp = await new Promise<string>((resolve) => {
      this._pendingAnswer = resolve;
      this.transport!.send({ type: 'SUBSCRIBE', token, sdp_offer: offer.sdp });
    });

    await this.pc!.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    return this._remoteStream;
  }
}
