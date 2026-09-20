const MAX_SESSION_ID_BYTES = 128;
const MAX_SECRET_BYTES = 4_096;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** A validated Session identifier safe for one URL path segment. */
export class SessionId {
  readonly #value: string;

  public constructor(value: string) {
    if (
      value.length === 0 ||
      utf8Length(value) > MAX_SESSION_ID_BYTES ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    ) {
      throw new RangeError(
        "Session ID must contain only ASCII letters, digits, '-' or '_'",
      );
    }
    this.#value = value;
    Object.freeze(this);
  }

  public toString(): string {
    return this.#value;
  }

  public toJSON(): string {
    return this.#value;
  }
}

/** A credential that never exposes its value through normal stringification. */
export class SecretToken {
  readonly #value: string;

  public constructor(value: string) {
    if (value.length === 0) {
      throw new RangeError('credential token must not be empty');
    }
    if (utf8Length(value) > MAX_SECRET_BYTES) {
      throw new RangeError(
        `credential token must not exceed ${MAX_SECRET_BYTES} bytes`,
      );
    }
    this.#value = value;
    Object.freeze(this);
  }

  /** Explicitly expose the credential for an authenticated transport boundary. */
  public exposeSecret(): string {
    return this.#value;
  }

  public toString(): string {
    return "SecretToken('[redacted]')";
  }

  public toJSON(): string {
    return '[redacted]';
  }
}

/** One ICE server returned with Session credentials. */
export interface IceServer {
  readonly urls: readonly string[];
  readonly username: string | null;
  readonly credential: SecretToken | null;
}

/** Credentials and media endpoints returned when a Session is created. */
export interface SessionCredentials {
  readonly sessionId: SessionId;
  readonly requiredBuses: readonly string[];
  readonly sourceToken: SecretToken;
  readonly whipUrl: string | null;
  readonly whepUrl: string | null;
  readonly iceServers: readonly IceServer[];
}

/** Current state of one named AudioBus. */
export interface BusState {
  readonly busId: string;
  readonly role: string;
  readonly sourceActive: boolean;
  readonly sourceGeneration: number;
}

/** Current state of one BusSubscription. */
export interface SubscriptionState {
  readonly subscriberId: string;
  readonly busId: string;
}

/** Bounded, validated control-plane view of a Session. */
export interface SessionSnapshot {
  readonly sessionId: SessionId;
  readonly stateRevision: number;
  readonly relayEpoch: string | null;
  readonly relayRevision: number;
  readonly requiredBuses: readonly string[];
  readonly buses: readonly BusState[];
  readonly subscriptions: readonly SubscriptionState[];
  readonly ready: boolean;
  readonly subscriptionCount: number;
  readonly codec: string;
}

/** One time-limited receiver invitation. */
export interface Invitation {
  readonly sessionId: SessionId;
  readonly joinCode: string;
  readonly joinUrl: string;
  readonly expiresAt: string;
}

/** Capability scoped to one receiver and one AudioBus. */
export interface SubscriberCredentials {
  readonly sessionId: SessionId;
  readonly busId: string;
  readonly subscriberToken: SecretToken;
}

/** Media-only capability scoped to one publisher and one AudioBus. */
export interface PublisherCredentials {
  readonly sessionId: SessionId;
  readonly busId: string;
  readonly publisherToken: SecretToken;
  readonly signalUrl: string;
  readonly iceServers: readonly IceServer[];
}

/** Per-operation deadline and cancellation controls. */
export interface ControlRequestOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** Options for creating a Session. */
export interface CreateSessionOptions extends ControlRequestOptions {
  readonly requiredBuses?: readonly string[];
}

/** Options for a single-AudioBus credential or invitation operation. */
export interface BusCredentialOptions extends ControlRequestOptions {
  readonly busId?: string;
}

/** Options for issuing one exact AudioBus publisher capability. */
export interface PublisherCredentialOptions extends ControlRequestOptions {
  readonly busId: string;
}

/** Minimal web-standard fetch contract accepted for dependency injection. */
export type ControlFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Construction options for a reusable control-plane client. */
export interface ControlClientOptions {
  readonly timeoutMs?: number;
  readonly fetch?: ControlFetch;
}
