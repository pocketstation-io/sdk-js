import { PocketStationError } from '../errors.js';
import { operationSignal } from './operation-signal.js';
import { SignalingTransport } from './signaling.js';
import type {
  RelayInvitation,
  RelayPlayoutObservation,
  RelayReceiverAccess,
  RelayReceiverOptions,
  RelayReceiverState,
  RelayServerMessage,
  RelaySessionState,
} from './types.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
const DEFAULT_DISCONNECT_TIMEOUT_MS = 2_000;
const MAX_CONTROL_RESPONSE_BYTES = 16 * 1024;
const MAX_PENDING_ICE_CANDIDATES = 64;

interface ConnectOptions {
  readonly signal?: AbortSignal;
}

/** Resolve a one-time receiver invitation through the PocketStation control plane. */
export async function resolveRelayInvitation(
  invitation: RelayInvitation,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<RelayReceiverAccess> {
  const timeoutMs = finiteTimeout(
    options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    'invitation timeoutMs',
  );
  const control = parseControlUrl(invitation.controlUrl);
  const joinCode = requiredText(invitation.joinCode, 'invitation joinCode');
  const operation = operationSignal(timeoutMs, options.signal);
  try {
    let response: Response;
    try {
      response = await fetch(
        new URL(`/v1/invitations/${encodeURIComponent(joinCode)}`, control),
        { cache: 'no-store', credentials: 'omit', signal: operation.signal },
      );
    } catch (cause) {
      throw requestFailure(
        'relay.invitation_request_failed',
        'Invitation could not be resolved',
        cause,
      );
    }
    let body: string;
    try {
      body = await readLimitedText(response, MAX_CONTROL_RESPONSE_BYTES);
    } catch (cause) {
      throw requestFailure(
        'relay.invitation_response_failed',
        'Invitation response could not be read',
        cause,
      );
    }
    if (!response.ok) {
      throw new PocketStationError(
        'relay.invitation_rejected',
        `PocketStation control plane rejected the invitation with HTTP ${response.status}`,
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch (cause) {
      throw new PocketStationError(
        'relay.invalid_invitation_response',
        'PocketStation control plane returned malformed invitation JSON',
        { cause },
      );
    }
    return invitationAccess(value);
  } finally {
    operation.dispose();
  }
}

/** Receive one selected Relay AudioBus as a browser MediaStream. */
export class RelayReceiver {
  readonly #requestedAccess: RelayReceiverAccess | RelayInvitation;
  readonly #options: RelayReceiverOptions;
  #state: RelayReceiverState = 'idle';
  #access: RelayReceiverAccess | null = null;
  #transport: SignalingTransport | null = null;
  #connection: RTCPeerConnection | null = null;
  #stream: MediaStream | null = null;
  #connectOperation: Promise<MediaStream> | null = null;
  #closeOperation: Promise<void> | null = null;
  #controller: AbortController | null = null;
  #closing = false;
  #pendingIce: string[] = [];
  #answer: Deferred<string> | null = null;
  #track: Deferred<MediaStream> | null = null;
  #connected: Deferred<void> | null = null;
  #lastError: PocketStationError | null = null;
  #sessionState: RelaySessionState | null = null;
  #observationRevision = 0;

  public constructor(
    access: RelayReceiverAccess | RelayInvitation,
    options: RelayReceiverOptions = {},
  ) {
    this.#requestedAccess = access;
    this.#options = options;
    finiteTimeout(
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      'connectTimeoutMs',
    );
    finiteTimeout(
      options.disconnectTimeoutMs ?? DEFAULT_DISCONNECT_TIMEOUT_MS,
      'disconnectTimeoutMs',
    );
    if (isInvitation(access)) {
      parseControlUrl(access.controlUrl);
      requiredText(access.joinCode, 'invitation joinCode');
    } else {
      validateAccess(access);
      this.#access = access;
    }
  }

  /** Resolve access, connect WebRTC, and return after the selected audio track arrives. */
  public connect(options: ConnectOptions = {}): Promise<MediaStream> {
    if (this.#state === 'closed') {
      return Promise.reject(
        new PocketStationError('relay.receiver_closed', 'RelayReceiver is closed'),
      );
    }
    if (this.#connectOperation !== null) return this.#connectOperation;
    this.#controller = new AbortController();
    const operation = operationSignal(
      this.#options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      options.signal,
      this.#controller.signal,
    );
    const signal = operation.signal;
    this.#connectOperation = this.#connect(signal).catch(async (cause: unknown) => {
      const failure = receiverFailure(cause, signal);
      if (!this.#closing) this.#reportFailure(failure);
      try {
        await this.#closeResources();
      } catch (cleanupCause) {
        throw new AggregateError(
          [failure, cleanupCause],
          'Relay receiver failed and cleanup did not complete',
        );
      }
      throw failure;
    }).finally(operation.dispose);
    return this.#connectOperation;
  }

  /** Close WebRTC and wait for the signaling socket to finish or time out. */
  public async disconnect(): Promise<void> {
    if (this.#state === 'closed') return;
    this.#closing = true;
    this.#controller?.abort(
      new PocketStationError('relay.disconnect_requested', 'Relay receiver is closing'),
    );
    try {
      await this.#closeResources();
      this.#setState('closed');
    } finally {
      this.#closing = false;
      this.#connectOperation = null;
    }
  }

  /** Reconnect direct access or an already-resolved invitation after connection loss. */
  public async reconnect(options: ConnectOptions = {}): Promise<MediaStream> {
    if (this.#state === 'closed') {
      throw new PocketStationError('relay.receiver_closed', 'RelayReceiver is closed');
    }
    this.#closing = true;
    try {
      this.#controller?.abort(
        new PocketStationError('relay.reconnect_requested', 'Relay receiver is reconnecting'),
      );
      await this.#closeResources();
    } finally {
      this.#closing = false;
    }
    this.#connectOperation = null;
    this.#setState('idle');
    return this.connect(options);
  }

  /** Read one WebRTC receiver observation without inventing unavailable values. */
  public async observe(): Promise<RelayPlayoutObservation> {
    const access = this.#access;
    const connection = this.#connection;
    if (access === null || connection === null) {
      throw new PocketStationError(
        'relay.receiver_not_connected',
        'Connect the RelayReceiver before reading playout observations',
      );
    }
    const reports = await connection.getStats();
    let inbound: Record<string, unknown> | null = null;
    reports.forEach((report) => {
      const candidate = report as unknown as Record<string, unknown>;
      if (candidate.type === 'inbound-rtp' && candidate.kind !== 'video') {
        inbound = candidate;
      }
    });
    const report = inbound as Record<string, unknown> | null;
    const emitted = numberField(report, 'jitterBufferEmittedCount');
    const delaySeconds = numberField(report, 'jitterBufferDelay');
    this.#observationRevision += 1;
    return Object.freeze({
      revision: this.#observationRevision,
      sessionId: access.sessionId,
      busId: access.busId,
      observedAtMs: Date.now(),
      statsTimestampMs: numberField(report, 'timestamp'),
      packetsReceived: numberField(report, 'packetsReceived'),
      packetsLost: numberField(report, 'packetsLost'),
      bytesReceived: numberField(report, 'bytesReceived'),
      jitterMs: milliseconds(numberField(report, 'jitter')),
      jitterBufferDelayMs:
        delaySeconds === null || emitted === null || emitted <= 0
          ? null
          : (delaySeconds / emitted) * 1_000,
      jitterBufferEmittedCount: emitted,
      totalSamplesReceived: numberField(report, 'totalSamplesReceived'),
      totalSamplesDurationSeconds: numberField(report, 'totalSamplesDuration'),
      estimatedPlayoutTimestampMs: numberField(report, 'estimatedPlayoutTimestamp'),
      trackState: this.#stream?.getAudioTracks()[0]?.readyState ?? null,
      acousticOutput: 'unavailable',
    });
  }

  public get state(): RelayReceiverState {
    return this.#state;
  }

  public get stream(): MediaStream | null {
    return this.#stream;
  }

  public get access(): RelayReceiverAccess | null {
    return this.#access;
  }

  public get sessionState(): RelaySessionState | null {
    return this.#sessionState;
  }

  public get lastError(): PocketStationError | null {
    return this.#lastError;
  }

  async #connect(signal: AbortSignal): Promise<MediaStream> {
    if (this.#access === null) {
      this.#setState('resolving-invitation');
      this.#access = await resolveRelayInvitation(this.#requestedAccess as RelayInvitation, {
        signal,
        timeoutMs: this.#options.connectTimeoutMs,
      });
    }
    const access = this.#access;
    validateAccess(access);
    this.#answer = deferred<string>();
    this.#track = deferred<MediaStream>();
    this.#connected = deferred<void>();
    this.#pendingIce = [];
    this.#setState('signaling');

    const connection = new RTCPeerConnection({
      iceServers: access.iceServers === undefined ? [] : [...access.iceServers],
    });
    this.#connection = connection;
    this.#stream = new MediaStream();
    connection.onicecandidate = (event) => {
      if (event.candidate !== null) {
        try {
          this.#transport?.send({ type: 'ICE', candidate: event.candidate.candidate });
        } catch (cause) {
          this.#handleAsyncFailure(receiverFailure(cause));
        }
      }
    };
    connection.ontrack = (event) => {
      const stream = this.#stream;
      if (stream === null || event.track.kind !== 'audio') return;
      const tracks = event.streams[0]?.getAudioTracks() ?? [event.track];
      for (const track of tracks) {
        if (!stream.getTracks().includes(track)) stream.addTrack(track);
      }
      this.#track?.resolve(stream);
    };
    connection.onconnectionstatechange = () => {
      switch (connection.connectionState) {
        case 'connected':
          this.#connected?.resolve();
          if (this.#state === 'disconnected') this.#setState('connected');
          break;
        case 'disconnected':
          if (!this.#closing) this.#setState('disconnected');
          break;
        case 'failed':
          this.#handleAsyncFailure(
            new PocketStationError(
              'relay.webrtc_failed',
              'WebRTC connection to Relay failed',
            ),
          );
          break;
        case 'closed':
          if (!this.#closing) {
            this.#handleAsyncFailure(
              new PocketStationError(
                'relay.webrtc_closed',
                'WebRTC connection to Relay closed unexpectedly',
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
              'relay.websocket_closed',
              'Relay signaling connection closed unexpectedly',
            ),
          );
        }
      },
      onError: (error) => {
        this.#handleAsyncFailure(error);
      },
    });

    connection.addTransceiver('audio', { direction: 'recvonly' });
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    if (offer.sdp === undefined) {
      throw new PocketStationError(
        'relay.sdp_offer_missing',
        'Browser did not create a WebRTC offer',
      );
    }
    transport.send({
      type: 'SUBSCRIBE',
      session_id: access.sessionId,
      bus_id: access.busId,
      token: access.subscriberToken,
      sdp_offer: offer.sdp,
    });
    const answer = await waitWithSignal(this.#answer.promise, signal);
    await connection.setRemoteDescription({ type: 'answer', sdp: answer });
    for (const candidate of this.#pendingIce.splice(0)) {
      await connection.addIceCandidate({ candidate, sdpMLineIndex: 0 });
    }
    this.#setState('connecting');
    const [, stream] = await waitWithSignal(
      Promise.all([this.#connected.promise, this.#track.promise]),
      signal,
    );
    this.#setState('connected');
    return stream;
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
                'relay.ice_capacity_exceeded',
                `Relay sent more than ${MAX_PENDING_ICE_CANDIDATES} pending ICE candidates`,
              ),
            );
          } else {
            this.#pendingIce.push(message.candidate);
          }
        } else {
          void this.#connection
            ?.addIceCandidate({ candidate: message.candidate, sdpMLineIndex: 0 })
            .catch((cause: unknown) => {
              const failure = new PocketStationError(
                'relay.ice_candidate_failed',
                'Browser rejected a Relay ICE candidate',
                { cause },
              );
              this.#handleAsyncFailure(failure);
            });
        }
        break;
      case 'SESSION_STATE': {
        const access = this.#access;
        if (access === null) break;
        const state = Object.freeze({
          sessionId: message.session_id ?? access.sessionId,
          busId: message.bus_id ?? access.busId,
          sourceActive: message.source_active,
          subscriptionCount: message.subscription_count,
          codec: message.codec ?? null,
        });
        this.#sessionState = state;
        this.#options.onSessionState?.(state);
        break;
      }
      case 'ERROR':
        this.#handleAsyncFailure(
          new PocketStationError(
            message.code ?? 'relay.failure',
            message.message ?? 'PocketStation Relay reported an error',
          ),
        );
        break;
      case 'ICE_RESTART':
        this.#handleAsyncFailure(
          new PocketStationError(
            'relay.ice_restart_required',
            'Relay requested a new ICE connection; call reconnect()',
          ),
        );
        break;
      case 'KEY_EXCHANGE':
      case 'CODEC_HINT':
      case 'LATENCY_REPORT':
        break;
    }
  }

  async #closeResources(): Promise<void> {
    if (this.#closeOperation !== null) return this.#closeOperation;
    this.#closeOperation = this.#performClose().finally(() => {
      this.#closeOperation = null;
    });
    return this.#closeOperation;
  }

  async #performClose(): Promise<void> {
    this.#answer = null;
    this.#track = null;
    this.#connected = null;
    this.#pendingIce = [];
    const transport = this.#transport;
    this.#transport = null;
    this.#connection?.close();
    this.#connection = null;
    this.#stream = null;
    if (transport !== null) {
      await transport.close(
        this.#options.disconnectTimeoutMs ?? DEFAULT_DISCONNECT_TIMEOUT_MS,
      );
    }
  }

  #rejectPending(error: PocketStationError): void {
    this.#answer?.reject(error);
    this.#track?.reject(error);
    this.#connected?.reject(error);
  }

  #handleAsyncFailure(error: PocketStationError): void {
    this.#rejectPending(error);
    if (this.#state !== 'connected' && this.#state !== 'disconnected') return;
    this.#reportFailure(error);
    this.#closing = true;
    void this.#closeResources()
      .catch((cause: unknown) => {
        this.#reportFailure(
          new PocketStationError(
            'relay.cleanup_failed',
            'Relay receiver failed and its resources could not be closed cleanly',
            { cause },
          ),
        );
      })
      .finally(() => {
        this.#closing = false;
        this.#connectOperation = null;
      });
  }

  #reportFailure(error: PocketStationError): void {
    this.#lastError = error;
    if (!this.#closing) this.#setState('failed');
    this.#options.onError?.(error);
  }

  #setState(state: RelayReceiverState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#options.onStateChange?.(state);
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // A Relay error can settle later connection stages before the main connect
  // operation reaches them. The main operation still observes the rejection.
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function waitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(receiverFailure(signal.reason, signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(receiverFailure(signal.reason, signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (cause: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(cause);
      },
    );
  });
}

function isInvitation(
  access: RelayReceiverAccess | RelayInvitation,
): access is RelayInvitation {
  return 'joinCode' in access;
}

function validateAccess(access: RelayReceiverAccess): void {
  let signal: URL;
  try {
    signal = new URL(requiredText(access.signalUrl, 'signalUrl'));
  } catch (cause) {
    throw new PocketStationError(
      'relay.invalid_signal_url',
      'Relay signalUrl must be an absolute WebSocket URL',
      { cause },
    );
  }
  if (!['ws:', 'wss:'].includes(signal.protocol) || signal.username || signal.password) {
    throw new PocketStationError(
      'relay.invalid_signal_url',
      'Relay signalUrl must use ws or wss and cannot contain credentials',
    );
  }
  requiredText(access.sessionId, 'sessionId');
  requiredText(access.busId, 'busId');
  requiredText(access.subscriberToken, 'subscriberToken');
  for (const server of access.iceServers ?? []) validateIceServer(server);
}

function invitationAccess(value: unknown): RelayReceiverAccess {
  if (!isRecord(value)) {
    throw invalidInvitation('Invitation response must be a JSON object');
  }
  const access: RelayReceiverAccess = {
    signalUrl: recordText(value, 'signal_url'),
    sessionId: recordText(value, 'session_id'),
    busId: recordText(value, 'bus_id'),
    subscriberToken: recordText(value, 'subscriber_token'),
    iceServers:
      value.ice_servers === undefined
        ? undefined
        : invitationIceServers(value.ice_servers),
  };
  validateAccess(access);
  return Object.freeze(access);
}

function invitationIceServers(value: unknown): RTCIceServer[] {
  if (!Array.isArray(value) || value.length > 16) {
    throw invalidInvitation('Invitation response has an invalid ICE server list');
  }
  return value.map((server) => {
    if (!isRecord(server)) throw invalidInvitation('Invitation contains an invalid ICE server');
    const urls = server.urls;
    const result: RTCIceServer = {
      urls:
        typeof urls === 'string'
          ? urls
          : Array.isArray(urls) && urls.every((url) => typeof url === 'string')
            ? urls
            : (() => {
                throw invalidInvitation('Invitation ICE server is missing urls');
              })(),
      username: typeof server.username === 'string' ? server.username : undefined,
      credential:
        typeof server.credential === 'string' ? server.credential : undefined,
    };
    validateIceServer(result);
    return result;
  });
}

function validateIceServer(server: RTCIceServer): void {
  const urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
  if (urls.length === 0 || urls.length > 8 || urls.some((url) => url.length === 0)) {
    throw invalidInvitation('ICE server URLs must contain between one and eight values');
  }
}

function parseControlUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(requiredText(value, 'controlUrl'));
  } catch (cause) {
    throw new PocketStationError(
      'relay.invalid_control_url',
      'Control URL must be an absolute HTTP or HTTPS origin',
      { cause },
    );
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  ) {
    throw new PocketStationError(
      'relay.invalid_control_url',
      'Control URL must be an HTTP or HTTPS origin without credentials or a path',
    );
  }
  return url;
}

async function readLimitedText(response: Response, maximumBytes: number): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    bytes += item.value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel();
      throw new PocketStationError(
        'relay.invitation_response_too_large',
        `Invitation response exceeded ${maximumBytes} bytes`,
      );
    }
    text += decoder.decode(item.value, { stream: true });
  }
  return text + decoder.decode();
}

function finiteTimeout(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 120_000) {
    throw new RangeError(`${name} must be an integer between 1 and 120000`);
  }
  return value;
}

function requiredText(value: string, name: string): string {
  if (value.trim().length === 0) throw new RangeError(`${name} cannot be empty`);
  return value;
}

function recordText(value: Record<string, unknown>, name: string): string {
  const field = value[name];
  if (typeof field !== 'string' || field.length === 0) {
    throw invalidInvitation(`Invitation response is missing ${name}`);
  }
  return field;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidInvitation(message: string): PocketStationError {
  return new PocketStationError('relay.invalid_invitation_response', message);
}

function requestFailure(code: string, message: string, cause: unknown): PocketStationError {
  if (cause instanceof PocketStationError) return cause;
  return new PocketStationError(code, message, { cause });
}

function receiverFailure(cause: unknown, signal?: AbortSignal): PocketStationError {
  if (cause instanceof PocketStationError) return cause;
  if (signal?.aborted === true) {
    return new PocketStationError(
      'relay.connect_cancelled',
      signal.reason instanceof Error
        ? signal.reason.message
        : 'Relay receiver connection was cancelled or timed out',
      { cause: signal.reason },
    );
  }
  return new PocketStationError(
    'relay.receiver_failed',
    cause instanceof Error ? cause.message : 'Relay receiver failed',
    { cause },
  );
}

function numberField(value: Record<string, unknown> | null, name: string): number | null {
  if (value === null) return null;
  const field = value[name];
  return typeof field === 'number' && Number.isFinite(field) ? field : null;
}

function milliseconds(seconds: number | null): number | null {
  return seconds === null ? null : seconds * 1_000;
}
