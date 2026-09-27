import { PocketStationError } from '../errors.js';
import {
  ControlClient,
  ControlPlaneError,
  SecretUrl,
  type SecretToken,
  SessionId,
  type Invitation,
  type InvitationVisibility,
  type SessionCredentials,
  type SessionSnapshot,
} from '../control/index.js';
import {
  RelayPublisher,
  type RelayIceServer,
  type Session,
} from './session.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_PUBLISHER_TIMEOUT_MS = 10_000;
const DEFAULT_RECEIVER_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const MAX_TIMEOUT_MS = 300_000;

/** A Relay declaration, request, activation, or lifecycle failure. */
export class RelayError extends PocketStationError {
  public constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(code, message, options);
    this.name = 'RelayError';
  }
}

/** An authoritative publisher or receiver activation deadline expired. */
export class RelayTimeoutError extends RelayError {
  public constructor(code: string, message: string) {
    super(code, message);
    this.name = 'RelayTimeoutError';
  }
}

/** Control-plane snapshot after Relay confirmed a live publisher. */
export class PublisherActivation {
  public readonly snapshot: SessionSnapshot;

  public constructor(snapshot: SessionSnapshot) {
    this.snapshot = snapshot;
    Object.freeze(this);
  }
}

/** Control-plane snapshot after Relay confirmed a receiver subscription. */
export class ReceiverActivation {
  public readonly snapshot: SessionSnapshot;

  public constructor(snapshot: SessionSnapshot) {
    this.snapshot = snapshot;
    Object.freeze(this);
  }
}

/** Exact-bus receiver invitation whose private URLs stay redacted by default. */
export class ReceiverInvitation {
  public readonly sessionId: SessionId;
  public readonly busId: string;
  public readonly joinCode: SecretToken;
  public readonly joinUrl: SecretUrl | null;
  public readonly shareAlias: string;
  public readonly shareUrl: SecretUrl | null;
  public readonly visibility: InvitationVisibility;
  public readonly expiresAt: string;

  public constructor(invitation: Invitation) {
    this.sessionId = invitation.sessionId;
    this.busId = invitation.busId;
    this.joinCode = invitation.joinCode;
    this.joinUrl = invitation.joinUrl;
    this.shareAlias = invitation.shareAlias;
    this.shareUrl = invitation.shareUrl;
    this.visibility = invitation.visibility;
    this.expiresAt = invitation.expiresAt;
    Object.freeze(this);
  }

  /** Prefer the readable link, falling back to the opaque compatibility link. */
  public exposeShareUrl(): string {
    const selected = this.shareUrl ?? this.joinUrl;
    if (selected === null) {
      throw new RelayError(
        'relay.invitation_url_unavailable',
        'Control plane did not return a receiver URL',
      );
    }
    return selected.exposeSecret();
  }

  public toString(): string {
    return `ReceiverInvitation(alias=${this.shareAlias}, busId=${this.busId}, url=[redacted])`;
  }
}

/** Options for creating one remote Relay Session. */
export interface RelaySessionOptions {
  readonly controlPlaneUrl: string;
  /**
   * Optional Relay origin override for an older control plane that omits media
   * endpoints. Modern control planes are authoritative through WHIP/WHEP.
   */
  readonly relayUrl?: string;
  readonly requestTimeoutMs?: number;
  readonly requiredBuses?: readonly string[];
  readonly controlClient?: ControlClient;
  readonly signal?: AbortSignal;
}

/** Finite wait options for Relay publisher and receiver activation. */
export interface RelayActivationOptions {
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly signal?: AbortSignal;
}

/** Options for creating one receiver invitation. */
export interface ReceiverInvitationOptions {
  readonly busId: string;
  /** Choose a fixed name length; omit to use Relay allocation policy. */
  readonly wordCount?: 2 | 3;
  /** @deprecated Formatting only; cannot be combined with wordCount. */
  readonly visibility?: InvitationVisibility;
  readonly signal?: AbortSignal;
}

/** Owns one remote Relay Session and composes it with a native Core Session. */
export class RelaySession {
  public readonly relayUrl: string;
  public readonly credentials: SessionCredentials;
  readonly #control: ControlClient;
  readonly #ownsControl: boolean;
  readonly #requestTimeoutMs: number;
  readonly #iceServers: readonly RelayIceServer[];
  #publisherActivation: PublisherActivation | null = null;
  #invitation: ReceiverInvitation | null = null;
  #receiverActivation: ReceiverActivation | null = null;
  #closed = false;
  #closeOperation: Promise<void> | null = null;

  private constructor(options: {
    relayUrl: string;
    credentials: SessionCredentials;
    control: ControlClient;
    ownsControl: boolean;
    requestTimeoutMs: number;
    iceServers: readonly RelayIceServer[];
  }) {
    this.relayUrl = options.relayUrl;
    this.credentials = options.credentials;
    this.#control = options.control;
    this.#ownsControl = options.ownsControl;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#iceServers = options.iceServers;
  }

  /** Create one remote Session through the control plane. */
  public static async create(options: RelaySessionOptions): Promise<RelaySession> {
    const requestTimeoutMs = finiteTimeout(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      'requestTimeoutMs',
    );
    const requestedRelayUrl = options.relayUrl === undefined
      ? undefined
      : relayOrigin(options.relayUrl);
    const ownsControl = options.controlClient === undefined;
    const control = options.controlClient ?? new ControlClient(
      options.controlPlaneUrl,
      { timeoutMs: requestTimeoutMs },
    );
    let credentials: SessionCredentials | undefined;
    try {
      credentials = await control.createSession({
        requiredBuses: options.requiredBuses,
        timeoutMs: requestTimeoutMs,
        signal: options.signal,
      });
      const relayUrl = resolveRelayOrigin(credentials, requestedRelayUrl);
      const iceServers = relayPublisherIceServers(credentials);
      return new RelaySession({
        relayUrl,
        credentials,
        control,
        ownsControl,
        requestTimeoutMs,
        iceServers,
      });
    } catch (error) {
      if (credentials !== undefined) {
        try {
          await control.deleteSession(
            credentials.sessionId,
            credentials.sourceToken,
            { timeoutMs: requestTimeoutMs },
          );
        } catch (cleanupError) {
          if (ownsControl) control.close();
          throw new RelayError(
            'relay.cleanup_failed',
            'Relay Session validation failed and remote cleanup also failed',
            { cause: new AggregateError([error, cleanupError]) },
          );
        }
      }
      if (ownsControl) control.close();
      throw error;
    }
  }

  public get sessionId(): SessionId {
    return this.credentials.sessionId;
  }

  public get publisherActivation(): PublisherActivation | null {
    return this.#publisherActivation;
  }

  public get invitation(): ReceiverInvitation | null {
    return this.#invitation;
  }

  public get receiverActivation(): ReceiverActivation | null {
    return this.#receiverActivation;
  }

  /** Declare the native Relay publisher on an unstarted Core Session. */
  public publisher(session: Session): RelayPublisher {
    this.#requireOpen();
    return session.relay({
      url: this.relayUrl,
      sessionId: this.sessionId.toString(),
      sourceToken: this.credentials.sourceToken.exposeSecret(),
      iceServers: this.#iceServers,
    });
  }

  /** Wait within one deadline for every required publisher AudioBus. */
  public async waitForPublisher(
    options: RelayActivationOptions = {},
  ): Promise<PublisherActivation> {
    this.#requireOpen();
    const snapshot = await this.#waitForSnapshot(
      (value) => value.ready,
      options,
      DEFAULT_PUBLISHER_TIMEOUT_MS,
      'relay.publisher_timeout',
      'Relay publisher did not become active before the deadline',
    );
    const activation = new PublisherActivation(snapshot);
    this.#publisherActivation = activation;
    return activation;
  }

  /** Create a scoped receiver invitation after the publisher is active. */
  public async createReceiverInvitation(
    options: ReceiverInvitationOptions,
  ): Promise<ReceiverInvitation> {
    this.#requireOpen();
    if (this.#publisherActivation === null) {
      throw new RelayError(
        'relay.publisher_not_active',
        'waitForPublisher() must succeed before creating an invitation',
      );
    }
    const created = await this.#control.createInvitation(
      this.credentials.sessionId,
      this.credentials.sourceToken,
      {
        busId: options.busId,
        visibility: options.visibility,
        wordCount: options.wordCount,
        timeoutMs: this.#requestTimeoutMs,
        signal: options.signal,
      },
    );
    const invitation = receiverInvitation(created, this.sessionId);
    this.#invitation = invitation;
    return invitation;
  }

  /** Wait for publishing and then create one receiver invitation. */
  public async waitForPublisherAndInvitation(
    options: RelayActivationOptions & ReceiverInvitationOptions,
  ): Promise<ReceiverInvitation> {
    await this.waitForPublisher(options);
    return this.createReceiverInvitation(options);
  }

  /** Wait within one deadline for an active receiver subscription. */
  public async waitForReceiver(
    options: RelayActivationOptions = {},
  ): Promise<ReceiverActivation> {
    this.#requireOpen();
    if (this.#invitation === null) {
      throw new RelayError(
        'relay.invitation_missing',
        'createReceiverInvitation() must succeed before waiting for a receiver',
      );
    }
    const snapshot = await this.#waitForSnapshot(
      (value) => value.ready && value.subscriptionCount > 0,
      options,
      DEFAULT_RECEIVER_TIMEOUT_MS,
      'relay.receiver_timeout',
      'Relay receiver did not become active before the deadline',
    );
    const activation = new ReceiverActivation(snapshot);
    this.#receiverActivation = activation;
    return activation;
  }

  /** Delete the remote Session and close an internally owned client. Idempotent. */
  public close(options: { readonly deleteRemoteSession?: boolean } = {}): Promise<void> {
    if (this.#closeOperation !== null) return this.#closeOperation;
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    this.#closeOperation = (async () => {
      try {
        if (options.deleteRemoteSession ?? true) {
          await this.#control.deleteSession(
            this.credentials.sessionId,
            this.credentials.sourceToken,
            { timeoutMs: this.#requestTimeoutMs },
          );
        }
      } finally {
        if (this.#ownsControl) this.#control.close();
      }
    })();
    return this.#closeOperation;
  }

  public [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  public toString(): string {
    return `RelaySession(sessionId=${this.sessionId.toString()}, relayUrl=${this.relayUrl}, credentials=[redacted])`;
  }

  async #waitForSnapshot(
    predicate: (snapshot: SessionSnapshot) => boolean,
    options: RelayActivationOptions,
    defaultTimeoutMs: number,
    timeoutCode: string,
    timeoutMessage: string,
  ): Promise<SessionSnapshot> {
    const timeoutMs = finiteTimeout(options.timeoutMs ?? defaultTimeoutMs, 'timeoutMs');
    const pollIntervalMs = finiteTimeout(
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      'pollIntervalMs',
    );
    const deadline = performance.now() + timeoutMs;
    while (true) {
      this.#requireOpen();
      throwIfAborted(options.signal);
      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) {
        throw new RelayTimeoutError(timeoutCode, timeoutMessage);
      }
      try {
        const snapshot = await this.#control.session(
          this.credentials.sessionId,
          this.credentials.sourceToken,
          {
            timeoutMs: Math.max(
              1,
              Math.min(Math.ceil(remainingMs), this.#requestTimeoutMs),
            ),
            signal: options.signal,
          },
        );
        if (predicate(snapshot)) return snapshot;
      } catch (error) {
        if (!(error instanceof ControlPlaneError) || error.code !== 'control.request') {
          throw error;
        }
      }
      const delayMs = Math.min(pollIntervalMs, Math.max(0, deadline - performance.now()));
      if (delayMs > 0) await abortableDelay(delayMs, options.signal);
    }
  }

  #requireOpen(): void {
    if (this.#closed) {
      throw new RelayError('relay.closed', 'RelaySession has closed');
    }
  }
}

function relayOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw new RelayError(
      'relay.invalid_url',
      'relayUrl must be an absolute HTTP or HTTPS origin',
      { cause },
    );
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    (parsed.pathname !== '' && parsed.pathname !== '/') ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new RelayError(
      'relay.invalid_url',
      'relayUrl must be an HTTP or HTTPS origin without credentials, path, query, or fragment',
    );
  }
  return parsed.origin;
}

function resolveRelayOrigin(
  credentials: SessionCredentials,
  requestedRelayUrl: string | undefined,
): string {
  if (credentials.whipUrl === null) {
    if (requestedRelayUrl !== undefined) return requestedRelayUrl;
    throw new RelayError(
      'relay.missing_relay_url',
      'Control-plane Session credentials omitted the WHIP endpoint',
    );
  }
  const authoritative = mediaEndpointOrigin(
    credentials.whipUrl,
    credentials.sessionId,
    'whip',
  );
  if (credentials.whepUrl !== null) {
    const receiverOrigin = mediaEndpointOrigin(
      credentials.whepUrl,
      credentials.sessionId,
      'whep',
    );
    if (receiverOrigin !== authoritative) {
      throw new RelayError(
        'relay.response_identity',
        'Control-plane WHIP and WHEP endpoints use different Relay origins',
      );
    }
  }
  if (requestedRelayUrl !== undefined && requestedRelayUrl !== authoritative) {
    throw new RelayError(
      'relay.response_identity',
      'Configured Relay origin does not match the control-plane Session endpoint',
    );
  }
  return authoritative;
}

function relayPublisherIceServers(
  credentials: SessionCredentials,
): readonly RelayIceServer[] {
  return Object.freeze(credentials.iceServers.map((server) => {
    if (
      server.username !== null
      || server.credential !== null
      || server.urls.some((url) => !url.startsWith('stun:'))
    ) {
      throw new RelayError(
        'relay.unsupported_ice_server',
        'The native Relay publisher accepts unauthenticated STUN servers; the control plane returned an unsupported ICE server',
      );
    }
    return Object.freeze({ urls: Object.freeze([...server.urls]) });
  }));
}

function mediaEndpointOrigin(
  value: string,
  sessionId: SessionId,
  endpoint: 'whip' | 'whep',
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw new RelayError(
      'relay.response_decode',
      `Control-plane ${endpoint.toUpperCase()} endpoint must be an absolute URL`,
      { cause },
    );
  }
  const expectedPath = `/v1/sessions/${sessionId.toString()}/${endpoint}`;
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== expectedPath ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new RelayError(
      'relay.response_identity',
      `Control-plane ${endpoint.toUpperCase()} endpoint does not match its Session`,
    );
  }
  return parsed.origin;
}

function receiverInvitation(
  created: Invitation,
  expectedSessionId: SessionId,
): ReceiverInvitation {
  const expected = expectedSessionId.toString();
  if (created.sessionId.toString() !== expected) {
    throw new RelayError(
      'relay.response_identity',
      'Control-plane invitation belongs to a different Session',
    );
  }
  if (created.busId.length === 0) {
    throw new RelayError(
      'relay.response_identity',
      'Control-plane invitation is missing its exact AudioBus identity',
    );
  }
  return new ReceiverInvitation(created);
}

function finiteTimeout(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new RangeError(`${name} must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
  }
  return value;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) signal.throwIfAborted();
}

function abortableDelay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const aborted = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      reject(signal?.reason ?? new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted === true) {
      aborted();
      return;
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }, milliseconds);
  });
}
