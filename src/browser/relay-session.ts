import { isReadableInvitationLocator } from '../control/invitation-locator.js';
import { PocketStationError } from '../errors.js';
import { InvitationUnavailableError } from '../control/control-client.js';
import { SecretToken, type IceServer } from '../control/types.js';
import { operationSignal } from './operation-signal.js';
import { latencyReportPayload } from './latency-report.js';
import { SignalingTransport } from './signaling.js';
import type {
  RelayInvitation,
  RelayLatencyReport,
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
const MAX_ICE_SERVERS = 32;
const MAX_ICE_URLS = 16;

/** Per-operation cancellation for browser Relay receiving. */
export interface RelayConnectOptions {
  readonly signal?: AbortSignal;
}

/** Trusted control-plane settings for explicit invitation redemption. */
export interface RelayInvitationResolutionOptions extends RelayConnectOptions {
  readonly controlPlaneUrl: string;
  readonly timeoutMs?: number;
}

/** Parse only invitation locator and fragment authority from a receiver URL. */
export function parseRelayInvitationLocation(
  location: string | URL,
): RelayInvitation {
  let parsed: URL;
  try {
    parsed = location instanceof URL ? new URL(location.href) : new URL(location);
  } catch (cause) {
    throw new PocketStationError(
      'relay.invalid_invitation_location',
      'Invitation location must be an absolute HTTP or HTTPS URL',
    );
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new PocketStationError(
      'relay.invalid_invitation_location',
      'Invitation location must use HTTP or HTTPS without URL credentials',
    );
  }
  const queryKeys: string[] = [];
  parsed.searchParams.forEach((_value, key) => queryKeys.push(key));
  if (queryKeys.some((key) => key !== 'join')) {
    throw new PocketStationError(
      'relay.invalid_invitation_location',
      'Invitation location contains an unsupported query parameter',
    );
  }
  const queryLocators = parsed.searchParams.getAll('join');
  if (queryLocators.length > 1) {
    throw new PocketStationError(
      'relay.invalid_invitation_location',
      'Invitation location contains multiple join locators',
    );
  }
  const pathLocator = invitationPathLocator(parsed.pathname);
  const queryLocator = queryLocators[0] ?? '';
  if (pathLocator !== '' && queryLocator !== '' && pathLocator !== queryLocator) {
    throw new PocketStationError(
      'relay.invalid_invitation_location',
      'Invitation location contains conflicting locators',
    );
  }
  const joinCode = invitationFragmentJoinCode(parsed.hash);
  const locator = validatedInvitationLocator(pathLocator || queryLocator || joinCode?.exposeSecret() || '');
  if (isOpaqueJoinCode(locator) && joinCode && locator !== joinCode.exposeSecret()) {
    throw invitationFailure('relay.invalid_invitation_location', 'Conflicting delegated join credentials');
  }
  return Object.freeze({ locator: redactedLocator(locator), joinCode });
}

/** Redeem a one-time receiver invitation through one trusted control-plane origin. */
export async function resolveRelayInvitation(
  invitation: RelayInvitation,
  options: RelayInvitationResolutionOptions,
): Promise<RelayReceiverAccess> {
  const timeoutMs = finiteTimeout(
    options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    'invitation timeoutMs',
  );
  const control = parseControlUrl(options.controlPlaneUrl);
  const locator = validatedInvitationLocator(invitation.locator);
  const suppliedJoinCode = invitationJoinCode(invitation);
  const opaqueLocator = isOpaqueJoinCode(locator);
  if (opaqueLocator && suppliedJoinCode && suppliedJoinCode.exposeSecret() !== locator) throw new InvitationUnavailableError();
  const joinCode = opaqueLocator ? new SecretToken(locator) : suppliedJoinCode;
  if (joinCode === null) throw new InvitationUnavailableError();
  const operation = operationSignal(timeoutMs, options.signal);
  try {
    let response: Response;
    try {
      response = await fetch(
        new URL(opaqueLocator ? '/v1/join' : `/v1/join/${encodeURIComponent(locator)}`, control),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            { join_code: joinCode.exposeSecret() },
          ),
          redirect: 'error',
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: operation.signal,
        },
      );
    } catch {
      throw invitationFailure(
        'relay.invitation_request_failed',
        'Invitation could not be resolved',
      );
    }
    let body: string;
    try {
      body = await readLimitedText(response, MAX_CONTROL_RESPONSE_BYTES);
    } catch (cause) {
      if (
        cause instanceof PocketStationError &&
        cause.code === 'relay.invitation_response_too_large'
      ) {
        throw cause;
      }
      throw invitationFailure(
        'relay.invitation_response_failed',
        'Invitation response could not be read',
      );
    }
    if (!response.ok) {
      if (response.status === 404) throw new InvitationUnavailableError();
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
      );
    }
    return invitationAccess(value);
  } finally {
    operation.dispose();
  }
}

/** Receive one selected Relay AudioBus as a browser MediaStream. */
export class RelayReceiver {
  #requestedAccess: RelayReceiverAccess | RelayInvitation | null;
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
  #pendingLocalIce: string[] = [];
  #subscribeSent = false;
  #answer: Deferred<string> | null = null;
  #track: Deferred<MediaStream> | null = null;
  #connected: Deferred<void> | null = null;
  #lastError: PocketStationError | null = null;
  #sessionState: RelaySessionState | null = null;
  #observationRevision = 0;
  #reconnectOperation: Promise<MediaStream> | null = null;

  public constructor(
    access: RelayReceiverAccess | RelayInvitation,
    options: RelayReceiverOptions = {},
  ) {
    const connectTimeoutMs = finiteTimeout(
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      'connectTimeoutMs',
    );
    const disconnectTimeoutMs = finiteTimeout(
      options.disconnectTimeoutMs ?? DEFAULT_DISCONNECT_TIMEOUT_MS,
      'disconnectTimeoutMs',
    );
    this.#options = Object.freeze({
      connectTimeoutMs,
      disconnectTimeoutMs,
      controlPlaneUrl:
        options.controlPlaneUrl === undefined
          ? undefined
          : parseControlUrl(options.controlPlaneUrl).href,
      onStateChange: options.onStateChange,
      onSessionState: options.onSessionState,
      onError: options.onError,
    });
    if (isInvitation(access)) {
      if (this.#options.controlPlaneUrl === undefined) {
        throw new PocketStationError(
          'relay.invalid_control_url',
          'RelayReceiver invitation requires a separately configured controlPlaneUrl',
        );
      }
      const locator = validatedInvitationLocator(access.locator);
      const joinCode = invitationJoinCode(access);
      this.#requestedAccess = Object.freeze({ locator: redactedLocator(locator), joinCode });
    } else {
      validateAccess(access);
      const snapshot = snapshotAccess(access);
      this.#requestedAccess = snapshot;
      this.#access = snapshot;
    }
  }

  /** Resolve access, connect WebRTC, and return after the selected audio track arrives. */
  public connect(options: RelayConnectOptions = {}): Promise<MediaStream> {
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
      if (!this.#closing && this.#state !== 'closed') this.#reportFailure(failure);
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
      this.#requestedAccess = null;
      this.#access = null;
      this.#setState('closed');
    } finally {
      this.#closing = false;
      this.#connectOperation = null;
    }
  }

  /** Reconnect direct access or an already-resolved invitation after connection loss. */
  public reconnect(options: RelayConnectOptions = {}): Promise<MediaStream> {
    if (this.#state === 'closed') {
      return Promise.reject(
        new PocketStationError('relay.receiver_closed', 'RelayReceiver is closed'),
      );
    }
    if (this.#reconnectOperation !== null) return this.#reconnectOperation;
    this.#reconnectOperation = this.#performReconnect(options).finally(() => {
      this.#reconnectOperation = null;
    });
    return this.#reconnectOperation;
  }

  async #performReconnect(options: RelayConnectOptions): Promise<MediaStream> {
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

  /** Report one validated latency sample to Relay. */
  public reportLatency(report: RelayLatencyReport): void {
    const access = this.#access;
    if (
      access === null ||
      this.#transport?.isOpen !== true ||
      this.#state !== 'connected'
    ) {
      throw new PocketStationError(
        'relay.receiver_not_connected',
        'Connect the RelayReceiver before reporting latency',
      );
    }
    this.#transport.send({
      type: 'LATENCY_REPORT',
      session_id: access.sessionId,
      latency_report: latencyReportPayload(report, access.sessionId),
    });
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
    let inbound: RTCInboundRtpStreamStats | null = null;
    reports.forEach((report: RTCStats) => {
      if (isInboundAudioStats(report)) inbound = report;
    });
    const report = inbound;
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
      const requestedAccess = this.#requestedAccess;
      if (requestedAccess === null || !isInvitation(requestedAccess)) {
        throw new PocketStationError(
          'relay.receiver_closed',
          'RelayReceiver authority was released during close',
        );
      }
      this.#setState('resolving-invitation');
      const controlPlaneUrl = this.#options.controlPlaneUrl;
      if (controlPlaneUrl === undefined) {
        throw new PocketStationError(
          'relay.invalid_control_url',
          'RelayReceiver invitation requires a separately configured controlPlaneUrl',
        );
      }
      this.#access = await resolveRelayInvitation(requestedAccess, {
        controlPlaneUrl,
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
    this.#pendingLocalIce = [];
    this.#subscribeSent = false;
    this.#setState('signaling');

    const connection = new RTCPeerConnection({
      iceServers:
        access.iceServers === undefined ? [] : access.iceServers.map(rtcIceServer),
    });
    this.#connection = connection;
    this.#stream = new MediaStream();
    connection.onicecandidate = (event) => {
      if (event.candidate !== null) {
        const candidate = event.candidate.candidate;
        if (!this.#subscribeSent) {
          if (this.#pendingLocalIce.length >= MAX_PENDING_ICE_CANDIDATES) {
            this.#handleAsyncFailure(
              new PocketStationError(
                'relay.receiver_local_ice_capacity_exceeded',
                `Browser produced more than ${MAX_PENDING_ICE_CANDIDATES} ICE candidates before subscription`,
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
      token: access.subscriberToken.exposeSecret(),
      sdp_offer: offer.sdp,
    });
    this.#subscribeSent = true;
    for (const candidate of this.#pendingLocalIce.splice(0)) {
      transport.send({ type: 'ICE', candidate });
    }
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
        if (
          (message.session_id !== undefined && message.session_id !== access.sessionId) ||
          (message.bus_id !== undefined && message.bus_id !== access.busId)
        ) {
          this.#handleAsyncFailure(
            new PocketStationError(
              'relay.receiver_state_identity_mismatch',
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
      case 'ERROR':
        this.#handleAsyncFailure(
          new PocketStationError(
            message.code ?? 'relay.failure',
            message.message ?? 'PocketStation Relay reported an error',
          ),
        );
        break;
      case 'ICE_RESTART':
        void this.reconnect().catch((cause: unknown) => {
          this.#handleAsyncFailure(receiverFailure(cause));
        });
        break;
      case 'KEY_EXCHANGE':
        this.#handleAsyncFailure(
          new PocketStationError(
            'relay.sframe_unsupported',
            'This browser client cannot consume an encrypted SFrame AudioBus',
          ),
        );
        break;
      case 'CODEC_HINT':
        this.#handleAsyncFailure(
          new PocketStationError(
            'relay.receiver_unexpected_codec_hint',
            'Relay sent publisher codec guidance to a receiver',
          ),
        );
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
    this.#pendingLocalIce = [];
    this.#subscribeSent = false;
    const transport = this.#transport;
    this.#transport = null;
    const stream = this.#stream;
    this.#connection?.close();
    this.#connection = null;
    this.#stream = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
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
    if (this.#state === 'closed') return;
    this.#lastError = error;
    if (!this.#closing) this.#setState('failed');
    this.#notifyError(error);
  }

  #setState(state: RelayReceiverState): void {
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
          'relay.receiver_callback_failed',
          `RelayReceiver ${callbackName} callback failed`,
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
  return 'locator' in access;
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
  if (!(access.subscriberToken instanceof SecretToken)) {
    throw new TypeError('subscriberToken must be a SecretToken');
  }
  for (const server of access.iceServers ?? []) validateIceServer(server);
}

function snapshotAccess(access: RelayReceiverAccess): RelayReceiverAccess {
  return Object.freeze({
    signalUrl: access.signalUrl,
    sessionId: access.sessionId,
    busId: access.busId,
    subscriberToken: access.subscriberToken,
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

function invitationAccess(value: unknown): RelayReceiverAccess {
  if (!isRecord(value)) {
    throw invalidInvitation('Invitation response must be a JSON object');
  }
  try {
    const access: RelayReceiverAccess = {
      signalUrl: recordText(value, 'signal_url'),
      sessionId: responseIdentifier(value, 'session_id', 128),
      busId: responseIdentifier(value, 'bus_id', 64),
      subscriberToken: new SecretToken(recordText(value, 'subscriber_token')),
      iceServers:
        value.ice_servers === undefined
          ? undefined
          : invitationIceServers(value.ice_servers),
    };
    validateAccess(access);
    return snapshotAccess(access);
  } catch (cause) {
    if (
      cause instanceof PocketStationError &&
      cause.code === 'relay.invalid_invitation_response'
    ) {
      throw cause;
    }
    throw invalidInvitation('Invitation response contains invalid receiver access');
  }
}

function invitationIceServers(value: unknown): IceServer[] {
  if (!Array.isArray(value) || value.length > MAX_ICE_SERVERS) {
    throw invalidInvitation('Invitation response has an invalid ICE server list');
  }
  return value.map((server) => {
    if (!isRecord(server)) throw invalidInvitation('Invitation contains an invalid ICE server');
    const urls = server.urls;
    if (
      !Array.isArray(urls) ||
      !urls.every((url) => typeof url === 'string')
    ) {
      throw invalidInvitation('Invitation ICE server is missing urls');
    }
    if (
      server.username !== undefined &&
      server.username !== null &&
      typeof server.username !== 'string'
    ) {
      throw invalidInvitation('Invitation ICE server has an invalid username');
    }
    if (
      server.credential !== undefined &&
      server.credential !== null &&
      typeof server.credential !== 'string'
    ) {
      throw invalidInvitation('Invitation ICE server has an invalid credential');
    }
    const result: IceServer = {
      urls: Object.freeze([...urls]) as readonly string[],
      username: typeof server.username === 'string' ? server.username : null,
      credential: typeof server.credential === 'string'
        ? new SecretToken(server.credential)
        : null,
    };
    validateIceServer(result);
    return result;
  });
}

function validateIceServer(server: IceServer): void {
  const urls = server.urls;
  if (
    urls.length === 0 ||
    urls.length > MAX_ICE_URLS ||
    urls.some((url) => url.length === 0)
  ) {
    throw invalidInvitation(
      `ICE server URLs must contain between one and ${MAX_ICE_URLS} values`,
    );
  }
  if (server.credential !== null && !(server.credential instanceof SecretToken)) {
    throw invalidInvitation('ICE server credential must be a SecretToken or null');
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

function invitationPathLocator(pathname: string): string {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0 || (segments.length === 1 && segments[0] === 'join')) {
    return '';
  }
  if (segments.length === 1) return decodedInvitationSegment(segments[0] as string);
  if (segments.length === 2 && segments[0] === 'join') {
    return decodedInvitationSegment(segments[1] as string);
  }
  throw new PocketStationError(
    'relay.invalid_invitation_location',
    'Invitation location path is not a supported receiver route',
  );
}

function decodedInvitationSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch (cause) {
    throw new PocketStationError(
      'relay.invalid_invitation_location',
      'Invitation location contains an invalid path segment',
      { cause },
    );
  }
}

function validatedInvitationLocator(value: string | SecretToken): string {
  const locator = requiredText(value instanceof SecretToken ? value.exposeSecret() : value, 'invitation locator').trim();
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(locator) ||
    isReadableInvitationLocator(locator)
  ) {
    return locator;
  }
  throw new PocketStationError(
    'relay.invalid_invitation_location',
    'Invitation locator must be an opaque code or a 2–15-word alias of at most 134 ASCII bytes',
  );
}

function isOpaqueJoinCode(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function redactedLocator(value: string): string | SecretToken {
  return isOpaqueJoinCode(value) ? new SecretToken(value) : value;
}

function invitationJoinCode(invitation: RelayInvitation): SecretToken | null {
  const primary = invitation.joinCode ?? null;
  const compatibility = invitation.secret ?? null;
  for (const credential of [primary, compatibility]) {
    if (credential !== null && (!(credential instanceof SecretToken) || !isOpaqueJoinCode(credential.exposeSecret()))) {
      throw new TypeError('joinCode must be a SecretToken containing an opaque delegated credential');
    }
  }
  if (primary && compatibility && primary.exposeSecret() !== compatibility.exposeSecret()) {
    throw new TypeError('joinCode and deprecated secret alias disagree');
  }
  return primary ?? compatibility;
}

function invitationFragmentJoinCode(hash: string): SecretToken | null {
  if (hash.length === 0) return null;
  const parameters = new URLSearchParams(hash.slice(1));
  const keys: string[] = [];
  parameters.forEach((_value, key) => keys.push(key));
  const values = parameters.getAll('join');
  const value = values[0] ?? '';
  if (keys.some((key) => key !== 'join') || values.length !== 1 || !isOpaqueJoinCode(value)) {
    throw invitationFailure('relay.invalid_invitation_location', 'Invitation fragment must contain one opaque join credential');
  }
  return new SecretToken(value);
}

function parseControlUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(requiredText(value, 'controlUrl'));
  } catch (cause) {
    throw new PocketStationError(
      'relay.invalid_control_url',
      'controlPlaneUrl must be an absolute HTTP or HTTPS origin',
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
      'controlPlaneUrl must be an HTTP or HTTPS origin without credentials or a path',
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

function responseIdentifier(
  value: Record<string, unknown>,
  name: string,
  maximum: number,
): string {
  const field = recordText(value, name);
  if (field.length > maximum || !/^[A-Za-z0-9._-]+$/.test(field)) {
    throw invalidInvitation(`Invitation response contains an invalid ${name}`);
  }
  return field;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidInvitation(message: string): PocketStationError {
  return new PocketStationError('relay.invalid_invitation_response', message);
}

function invitationFailure(code: string, message: string): PocketStationError {
  // Invitation request bodies can contain a fragment secret. Do not retain an
  // arbitrary transport/stream error as a cause because normal error logging
  // could otherwise reveal that authority.
  return new PocketStationError(code, message);
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

function isInboundAudioStats(report: RTCStats): report is RTCInboundRtpStreamStats {
  return report.type === 'inbound-rtp' && 'kind' in report && report.kind === 'audio';
}

function numberField(value: RTCStats | null, name: string): number | null {
  if (value === null) return null;
  const field = Reflect.get(value, name);
  return typeof field === 'number' && Number.isFinite(field) ? field : null;
}

function milliseconds(seconds: number | null): number | null {
  return seconds === null ? null : seconds * 1_000;
}
