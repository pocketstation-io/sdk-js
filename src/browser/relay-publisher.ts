import { PocketStationError } from '../errors.js';
import { SecretToken, type IceServer } from '../control/types.js';
import { operationSignal } from './operation-signal.js';
import { latencyReportPayload } from './latency-report.js';
import { SignalingTransport } from './signaling.js';
import type {
  RelayPublishObservation,
  RelayCodecHint,
  RelayLatencyReport,
  RelayPublisherAccess,
  RelayPublisherOptions,
  RelayPublisherState,
  RelayServerMessage,
  RelaySessionState,
} from './types.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
const DEFAULT_DISCONNECT_TIMEOUT_MS = 2_000;
const FIRST_PACKET_POLL_MS = 25;
const MAX_IDENTIFIER_BYTES = 64;
const MAX_PENDING_ICE_CANDIDATES = 64;

/** Per-operation cancellation for browser Relay publication. */
export interface RelayPublishOperationOptions {
  readonly signal?: AbortSignal;
}

/** Publish one caller-owned browser audio stream to one authorized Relay AudioBus. */
export class RelayPublisher {
  #access: RelayPublisherAccess | null;
  readonly #options: RelayPublisherOptions;
  #state: RelayPublisherState = 'idle';
  #transport: SignalingTransport | null = null;
  #connection: RTCPeerConnection | null = null;
  #stream: MediaStream | null = null;
  #track: MediaStreamTrack | null = null;
  #publishOperation: Promise<void> | null = null;
  #closeOperation: Promise<void> | null = null;
  #controller: AbortController | null = null;
  #closing = false;
  #pendingIce: string[] = [];
  #pendingLocalIce: string[] = [];
  #publishSent = false;
  #answer: Deferred<string> | null = null;
  #connected: Deferred<void> | null = null;
  #lastError: PocketStationError | null = null;
  #sessionState: RelaySessionState | null = null;
  #observationRevision = 0;
  #lastCodecHint: RelayCodecHint | null = null;
  #reconnectOperation: Promise<void> | null = null;

  public constructor(
    access: RelayPublisherAccess,
    options: RelayPublisherOptions = {},
  ) {
    validateAccess(access);
    const connectTimeoutMs = finiteTimeout(
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      'connectTimeoutMs',
    );
    const disconnectTimeoutMs = finiteTimeout(
      options.disconnectTimeoutMs ?? DEFAULT_DISCONNECT_TIMEOUT_MS,
      'disconnectTimeoutMs',
    );
    this.#access = snapshotAccess(access);
    this.#options = Object.freeze({
      connectTimeoutMs,
      disconnectTimeoutMs,
      onStateChange: options.onStateChange,
      onSessionState: options.onSessionState,
      onError: options.onError,
      onCodecHint: options.onCodecHint,
    });
  }

  /**
   * Publish one live audio track and resolve only after an outbound RTP packet exists.
   *
   * The caller retains ownership of the MediaStream and every track in it.
   */
  public publish(
    stream: MediaStream,
    options: RelayPublishOperationOptions = {},
  ): Promise<void> {
    if (this.#state === 'closed') {
      return Promise.reject(
        new PocketStationError('relay.publisher_closed', 'RelayPublisher is closed'),
      );
    }
    if (this.#publishOperation !== null) return this.#publishOperation;
    let track: MediaStreamTrack;
    try {
      track = selectedAudioTrack(stream);
    } catch (cause) {
      return Promise.reject(cause);
    }
    this.#stream = stream;
    this.#track = track;
    this.#controller = new AbortController();
    const operation = operationSignal(
      this.#options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      options.signal,
      this.#controller.signal,
    );
    const signal = operation.signal;
    this.#publishOperation = this.#publish(stream, track, signal).catch(
      async (cause: unknown) => {
        const failure = publisherFailure(cause, signal);
        if (!this.#closing && this.#state !== 'closed') this.#reportFailure(failure);
        try {
          await this.#closeResources();
        } catch (cleanupCause) {
          throw new AggregateError(
            [failure, cleanupCause],
            'Relay publisher failed and cleanup did not complete',
          );
        }
        throw failure;
      },
    ).finally(operation.dispose);
    return this.#publishOperation;
  }

  /** Close WebRTC without stopping or otherwise mutating the caller-owned stream. */
  public async disconnect(): Promise<void> {
    if (this.#state === 'closed') return;
    this.#closing = true;
    this.#controller?.abort(
      new PocketStationError('relay.disconnect_requested', 'Relay publisher is closing'),
    );
    try {
      await this.#closeResources();
      this.#access = null;
      this.#setState('closed');
    } finally {
      this.#closing = false;
      this.#publishOperation = null;
    }
  }

  /** Reattach the same or a replacement live stream as a new Relay source generation. */
  public reconnect(
    stream?: MediaStream,
    options: RelayPublishOperationOptions = {},
  ): Promise<void> {
    if (this.#state === 'closed') {
      return Promise.reject(
        new PocketStationError('relay.publisher_closed', 'RelayPublisher is closed'),
      );
    }
    if (this.#reconnectOperation !== null) return this.#reconnectOperation;
    let selectedStream: MediaStream;
    try {
      selectedStream = stream ?? requiredStream(this.#stream);
    } catch (cause) {
      return Promise.reject(cause);
    }
    this.#reconnectOperation = this.#performReconnect(selectedStream, options).finally(() => {
      this.#reconnectOperation = null;
    });
    return this.#reconnectOperation;
  }

  async #performReconnect(
    stream: MediaStream,
    options: RelayPublishOperationOptions,
  ): Promise<void> {
    this.#setState('recovering');
    this.#closing = true;
    try {
      this.#controller?.abort(
        new PocketStationError(
          'relay.reconnect_requested',
          'Relay publisher is reconnecting',
        ),
      );
      await this.#closeResources();
    } finally {
      this.#closing = false;
    }
    this.#publishOperation = null;
    this.#setState('idle');
    return this.publish(stream, options);
  }

  /** Report one validated latency sample to Relay. */
  public reportLatency(report: RelayLatencyReport): void {
    if (this.#transport?.isOpen !== true || this.#state !== 'publishing') {
      throw new PocketStationError(
        'relay.publisher_not_connected',
        'Publish the RelayPublisher before reporting latency',
      );
    }
    const access = requiredAccess(this.#access);
    const payload = latencyReportPayload(report, access.sessionId);
    this.#transport.send({
      type: 'LATENCY_REPORT',
      session_id: access.sessionId,
      latency_report: payload,
    });
  }

  /** Read one outbound WebRTC observation without inventing unavailable values. */
  public async observe(): Promise<RelayPublishObservation> {
    const connection = this.#connection;
    const track = this.#track;
    const access = this.#access;
    if (connection === null || track === null || access === null) {
      throw new PocketStationError(
        'relay.publisher_not_connected',
        'Publish a stream before reading publisher observations',
      );
    }
    const report = await outboundAudioReport(connection);
    this.#observationRevision += 1;
    return Object.freeze({
      revision: this.#observationRevision,
      sessionId: access.sessionId,
      busId: access.busId,
      observedAtMs: Date.now(),
      statsTimestampMs: numberField(report, 'timestamp'),
      packetsSent: numberField(report, 'packetsSent'),
      bytesSent: numberField(report, 'bytesSent'),
      headerBytesSent: numberField(report, 'headerBytesSent'),
      totalSamplesSent: numberField(report, 'totalSamplesSent'),
      totalSamplesDurationSeconds: numberField(report, 'totalSamplesDuration'),
      audioLevel: numberField(report, 'audioLevel'),
      totalAudioEnergy: numberField(report, 'totalAudioEnergy'),
      connectionState: connection.connectionState,
      trackState: track.readyState,
      trackMuted: track.muted,
    });
  }

  public get state(): RelayPublisherState {
    return this.#state;
  }

  public get access(): RelayPublisherAccess | null {
    return this.#access;
  }

  public get stream(): MediaStream | null {
    return this.#stream;
  }

  public get sessionState(): RelaySessionState | null {
    return this.#sessionState;
  }

  public get lastError(): PocketStationError | null {
    return this.#lastError;
  }

  public get lastCodecHint(): RelayCodecHint | null {
    return this.#lastCodecHint;
  }

  async #publish(
    stream: MediaStream,
    track: MediaStreamTrack,
    signal: AbortSignal,
  ): Promise<void> {
    const access = requiredAccess(this.#access);
    this.#answer = deferred<string>();
    this.#connected = deferred<void>();
    this.#pendingIce = [];
    this.#pendingLocalIce = [];
    this.#publishSent = false;
    this.#setState('signaling');

    const connection = new RTCPeerConnection({
      iceServers:
        access.iceServers === undefined ? [] : access.iceServers.map(rtcIceServer),
    });
    this.#connection = connection;
    connection.addTransceiver(track, {
      direction: 'sendonly',
      streams: [stream],
    });
    track.addEventListener('ended', this.#onTrackEnded, { once: true });
    connection.onicecandidate = (event) => {
      if (event.candidate !== null) {
        const candidate = event.candidate.candidate;
        if (!this.#publishSent) {
          if (this.#pendingLocalIce.length >= MAX_PENDING_ICE_CANDIDATES) {
            this.#handleAsyncFailure(
              new PocketStationError(
                'relay.publisher_local_ice_capacity_exceeded',
                `Browser produced more than ${MAX_PENDING_ICE_CANDIDATES} ICE candidates before publication`,
              ),
            );
            return;
          }
          this.#pendingLocalIce.push(candidate);
          return;
        }
        try {
          this.#transport?.send({ type: 'ICE', candidate });
        } catch (cause) {
          this.#handleAsyncFailure(publisherFailure(cause));
        }
      }
    };
    connection.onconnectionstatechange = () => {
      switch (connection.connectionState) {
        case 'connected':
          this.#connected?.resolve();
          if (this.#state === 'disconnected') this.#setState('connecting');
          break;
        case 'disconnected':
          if (!this.#closing) this.#setState('disconnected');
          break;
        case 'failed':
          this.#handleAsyncFailure(
            new PocketStationError(
              'relay.publisher_webrtc_failed',
              'WebRTC publication to Relay failed',
            ),
          );
          break;
        case 'closed':
          if (!this.#closing) {
            this.#handleAsyncFailure(
              new PocketStationError(
                'relay.publisher_webrtc_closed',
                'WebRTC publication to Relay closed unexpectedly',
              ),
            );
          }
          break;
      }
    };

    const transport = new SignalingTransport(access.signalUrl);
    this.#transport = transport;
    await transport.open({
      signal,
      onMessage: (message) => this.#handleMessage(message),
      onClose: () => {
        if (!this.#closing) {
          this.#handleAsyncFailure(
            new PocketStationError(
              'relay.publisher_websocket_closed',
              'Relay publisher signaling closed unexpectedly',
            ),
          );
        }
      },
      onError: (error) => this.#handleAsyncFailure(error),
    });

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    if (offer.sdp === undefined) {
      throw new PocketStationError(
        'relay.publisher_sdp_offer_missing',
        'Browser did not create a WebRTC publisher offer',
      );
    }
    transport.send({
      type: 'PUBLISH',
      session_id: access.sessionId,
      bus_id: access.busId,
      token: access.publisherToken.exposeSecret(),
      sdp_offer: offer.sdp,
    });
    this.#publishSent = true;
    for (const candidate of this.#pendingLocalIce.splice(0)) {
      transport.send({ type: 'ICE', candidate });
    }
    const answer = await waitWithSignal(this.#answer.promise, signal);
    await connection.setRemoteDescription({ type: 'answer', sdp: answer });
    for (const candidate of this.#pendingIce.splice(0)) {
      await connection.addIceCandidate({ candidate, sdpMLineIndex: 0 });
    }
    this.#setState('connecting');
    await waitWithSignal(this.#connected.promise, signal);
    await waitForFirstPacket(connection, signal);
    this.#setState('publishing');
  }

  #handleMessage(message: RelayServerMessage): void {
    switch (message.type) {
      case 'SDP_ANSWER':
        this.#answer?.resolve(message.sdp_answer);
        break;
      case 'ICE':
        if (this.#connection?.remoteDescription === null) {
          if (this.#pendingIce.length >= MAX_PENDING_ICE_CANDIDATES) {
            this.#handleAsyncFailure(
              new PocketStationError(
                'relay.publisher_ice_capacity_exceeded',
                `Relay sent more than ${MAX_PENDING_ICE_CANDIDATES} pending ICE candidates`,
              ),
            );
            break;
          }
          this.#pendingIce.push(message.candidate);
        } else {
          void this.#connection
            ?.addIceCandidate({ candidate: message.candidate, sdpMLineIndex: 0 })
            .catch((cause: unknown) => {
              this.#handleAsyncFailure(publisherFailure(cause));
            });
        }
        break;
      case 'SESSION_STATE': {
        const access = this.#access;
        if (access === null) break;
        if (
          (message.session_id !== undefined &&
            message.session_id !== access.sessionId) ||
          (message.bus_id !== undefined && message.bus_id !== access.busId)
        ) {
          this.#handleAsyncFailure(
            new PocketStationError(
              'relay.publisher_state_identity_mismatch',
              'Relay returned Session state for a different Session or AudioBus',
            ),
          );
          break;
        }
        const state = Object.freeze({
          sessionId: message.session_id ?? access.sessionId,
          busId: message.bus_id ?? access.busId,
          sourceActive: message.source_active,
          subscriptionCount: message.subscription_count,
          codec: message.codec ?? null,
        });
        this.#sessionState = state;
        this.#notify(this.#options.onSessionState, state, 'onSessionState');
        break;
      }
      case 'ERROR': {
        const failure = new PocketStationError(
          `relay.${message.code ?? 'publisher_rejected'}`,
          message.message ?? 'Relay rejected browser publication',
        );
        this.#answer?.reject(failure);
        this.#connected?.reject(failure);
        this.#handleAsyncFailure(failure);
        break;
      }
      case 'CODEC_HINT':
        this.#lastCodecHint = message.codec_hint;
        this.#notify(this.#options.onCodecHint, message.codec_hint, 'onCodecHint');
        void this.#applyCodecHint(message.codec_hint);
        break;
      case 'ICE_RESTART':
        void this.reconnect().catch((cause: unknown) => {
          this.#handleAsyncFailure(publisherFailure(cause));
        });
        break;
      case 'KEY_EXCHANGE':
        this.#handleAsyncFailure(
          new PocketStationError(
            'relay.publisher_unexpected_key_exchange',
            'Relay sent KEY_EXCHANGE to a publisher',
          ),
        );
        break;
    }
  }

  async #applyCodecHint(hint: RelayCodecHint): Promise<void> {
    const sender = this.#connection
      ?.getSenders()
      .find((candidate) => candidate.track === this.#track);
    if (sender === undefined) return;
    const parameters = sender.getParameters();
    if (parameters.encodings.length === 0) return;
    parameters.encodings[0]!.maxBitrate = hint.bitrateKbps * 1_000;
    try {
      await sender.setParameters(parameters);
    } catch (cause) {
      this.#notifyError(
        new PocketStationError(
          'relay.publisher_codec_hint_failed',
          'Browser could not apply Relay codec bitrate guidance',
          { cause },
        ),
      );
    }
  }

  readonly #onTrackEnded = (): void => {
    if (this.#closing) return;
    this.#handleAsyncFailure(
      new PocketStationError(
        'relay.publisher_track_ended',
        'The caller-owned browser audio track ended',
      ),
    );
  };

  #handleAsyncFailure(failure: PocketStationError): void {
    if (this.#closing || this.#state === 'closed') return;
    this.#answer?.reject(failure);
    this.#connected?.reject(failure);
    this.#reportFailure(failure);
    this.#controller?.abort(failure);
    void this.#closeResources().catch((cleanupCause: unknown) => {
      this.#notifyError(
        new AggregateError(
          [failure, cleanupCause],
          'Relay publisher failure cleanup did not complete',
        ),
      );
    });
  }

  #reportFailure(failure: PocketStationError): void {
    if (this.#state === 'closed') return;
    this.#lastError = failure;
    this.#setState('failed');
    this.#notifyError(failure);
  }

  #setState(state: RelayPublisherState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#notify(this.#options.onStateChange, state, 'onStateChange');
  }

  #notify<T>(
    callback: ((value: T) => void) | undefined,
    value: T,
    callbackName: string,
  ): void {
    if (callback === undefined) return;
    try {
      callback(value);
    } catch (cause) {
      this.#notifyError(
        new PocketStationError(
          'relay.publisher_callback_failed',
          `RelayPublisher ${callbackName} callback failed`,
          { cause },
        ),
      );
    }
  }

  #notifyError(error: Error): void {
    try {
      this.#options.onError?.(error);
    } catch {
      // An observer cannot take ownership of the media lifecycle by throwing.
    }
  }

  async #closeResources(): Promise<void> {
    if (this.#closeOperation !== null) return this.#closeOperation;
    const wasClosing = this.#closing;
    this.#closing = true;
    const connection = this.#connection;
    const transport = this.#transport;
    const track = this.#track;
    this.#connection = null;
    this.#transport = null;
    this.#stream = null;
    this.#track = null;
    this.#answer = null;
    this.#connected = null;
    this.#pendingIce = [];
    this.#pendingLocalIce = [];
    this.#publishSent = false;
    if (track !== null) track.removeEventListener('ended', this.#onTrackEnded);
    if (connection !== null) {
      connection.onicecandidate = null;
      connection.onconnectionstatechange = null;
    }
    this.#closeOperation = (async () => {
      connection?.close();
      if (transport !== null) {
        await transport.close(
          this.#options.disconnectTimeoutMs ?? DEFAULT_DISCONNECT_TIMEOUT_MS,
        );
      }
    })();
    try {
      await this.#closeOperation;
    } finally {
      this.#closeOperation = null;
      this.#closing = wasClosing;
    }
  }
}

function validateAccess(access: RelayPublisherAccess): void {
  parseSignalUrl(access.signalUrl);
  requiredText(access.sessionId, 'sessionId');
  portableIdentifier(access.busId, 'busId');
  if (!(access.publisherToken instanceof SecretToken)) {
    throw new TypeError('publisherToken must be a SecretToken');
  }
  for (const server of access.iceServers ?? []) validateIceServer(server);
}

function snapshotAccess(access: RelayPublisherAccess): RelayPublisherAccess {
  return Object.freeze({
    signalUrl: access.signalUrl,
    sessionId: access.sessionId,
    busId: access.busId,
    publisherToken: access.publisherToken,
    iceServers:
      access.iceServers === undefined
        ? undefined
        : Object.freeze(access.iceServers.map(snapshotIceServer)),
  });
}

function snapshotIceServer(server: IceServer): IceServer {
  return Object.freeze({
    urls: Object.freeze([...server.urls]),
    username: server.username,
    credential: server.credential,
  });
}

function validateIceServer(server: IceServer): void {
  const urls = server.urls;
  if (urls.length === 0 || urls.length > 8 || urls.some((url) => url.length === 0)) {
    throw new RangeError('ICE server URLs must contain between one and eight values');
  }
  if (server.credential !== null && !(server.credential instanceof SecretToken)) {
    throw new TypeError('ICE server credential must be a SecretToken or null');
  }
}

function rtcIceServer(server: IceServer): RTCIceServer {
  return {
    urls: [...server.urls],
    ...(server.username === null ? {} : { username: server.username }),
    ...(server.credential === null
      ? {}
      : { credential: server.credential.exposeSecret() }),
  };
}

function parseSignalUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new PocketStationError(
      'relay.invalid_signal_url',
      'Relay signalUrl must be an absolute WebSocket URL',
      { cause },
    );
  }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) {
    throw new PocketStationError(
      'relay.invalid_signal_url',
      'Relay signalUrl must use ws or wss and cannot contain credentials',
    );
  }
  return url;
}

function selectedAudioTrack(stream: MediaStream): MediaStreamTrack {
  const tracks = stream.getAudioTracks();
  if (tracks.length !== 1) {
    throw new PocketStationError(
      'relay.publisher_audio_track_count',
      'RelayPublisher requires exactly one browser audio track',
    );
  }
  const track = tracks[0];
  if (track === undefined || track.readyState !== 'live') {
    throw new PocketStationError(
      'relay.publisher_track_not_live',
      'RelayPublisher requires one live browser audio track',
    );
  }
  return track;
}

function requiredStream(stream: MediaStream | null): MediaStream {
  if (stream === null) {
    throw new PocketStationError(
      'relay.publisher_stream_missing',
      'Publish a stream before reconnecting without an explicit replacement',
    );
  }
  return stream;
}

function requiredAccess(access: RelayPublisherAccess | null): RelayPublisherAccess {
  if (access === null) {
    throw new PocketStationError(
      'relay.publisher_closed',
      'RelayPublisher authority was released during close',
    );
  }
  return access;
}

function requiredText(value: string, name: string): string {
  if (value.length === 0) throw new TypeError(`${name} cannot be empty`);
  return value;
}

function portableIdentifier(value: string, name: string): string {
  const byteLength = new TextEncoder().encode(value).byteLength;
  if (
    byteLength === 0 ||
    byteLength > MAX_IDENTIFIER_BYTES ||
    !/^[A-Za-z0-9._-]+$/.test(value)
  ) {
    throw new TypeError(
      `${name} must contain 1-${MAX_IDENTIFIER_BYTES} portable identifier bytes`,
    );
  }
  return value;
}

function finiteTimeout(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer number of milliseconds`);
  }
  return value;
}

async function waitForFirstPacket(
  connection: RTCPeerConnection,
  signal: AbortSignal,
): Promise<void> {
  for (;;) {
    const report = await outboundAudioReport(connection);
    const packetsSent = numberField(report, 'packetsSent');
    if (packetsSent !== null && packetsSent > 0) return;
    await delay(FIRST_PACKET_POLL_MS, signal);
  }
}

async function outboundAudioReport(
  connection: RTCPeerConnection,
): Promise<RTCOutboundRtpStreamStats | null> {
  const reports = await connection.getStats();
  let outbound: RTCOutboundRtpStreamStats | null = null;
  reports.forEach((report: RTCStats) => {
    if (isOutboundAudioStats(report)) outbound = report;
  });
  return outbound;
}

function isOutboundAudioStats(report: RTCStats): report is RTCOutboundRtpStreamStats {
  return report.type === 'outbound-rtp' && 'kind' in report && report.kind === 'audio';
}

function numberField(
  value: RTCStats | null,
  name: string,
): number | null {
  const field = value === null ? undefined : Reflect.get(value, name);
  return typeof field === 'number' && Number.isFinite(field) ? field : null;
}

function delay(timeoutMs: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      finish();
      resolve();
    }, timeoutMs);
    const onAbort = (): void => {
      finish();
      reject(abortFailure(signal.reason));
    };
    const finish = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortFailure(signal.reason));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      finish();
      reject(abortFailure(signal.reason));
    };
    const finish = (): void => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        finish();
        resolve(value);
      },
      (cause: unknown) => {
        finish();
        reject(cause);
      },
    );
  });
}

function publisherFailure(
  cause: unknown,
  signal?: AbortSignal,
): PocketStationError {
  if (signal?.aborted === true) {
    const reason = signal.reason;
    const timedOut = reason instanceof DOMException && reason.name === 'TimeoutError';
    if (!timedOut && reason instanceof PocketStationError) return reason;
    return new PocketStationError(
      timedOut ? 'relay.publisher_connect_timeout' : 'relay.publisher_cancelled',
      timedOut
        ? 'Relay publication did not deliver an outbound packet before its deadline'
        : reason instanceof Error
          ? reason.message
          : 'Relay publication was cancelled',
      { cause: reason },
    );
  }
  if (cause instanceof PocketStationError) return cause;
  return new PocketStationError(
    'relay.publisher_failed',
    cause instanceof Error ? cause.message : 'Relay publication failed',
    { cause },
  );
}

function abortFailure(reason: unknown): PocketStationError {
  return reason instanceof PocketStationError
    ? reason
    : new PocketStationError(
        'relay.publisher_cancelled',
        reason instanceof Error ? reason.message : 'Relay publication was cancelled',
        { cause: reason },
      );
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (cause: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (cause: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  // A Relay error may reject a later handshake phase before the state machine
  // reaches its await point. Attach a no-op observer without changing what
  // callers receive from the original Promise.
  void promise.catch(() => {});
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}
