import { PocketStationError, nativeCall } from './errors.js';
import type {
  NativeRunningSessionHandle,
  NativeSessionEvent,
} from './native.js';
import type { Platform, SourceKind, StableSourceId } from './sources.js';

/** Public native Session lifecycle state. */
export type SessionState =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed';

/** Native source disappearance or backend failure. */
export interface SourceFailure {
  /** Native source failure category. */
  readonly kind: 'source-unavailable' | 'backend-failure';
  /** Session Stem affected by the failure. */
  readonly stemId: bigint;
  /** Exact source that failed. */
  readonly stableId: StableSourceId;
  /** Source lifetime generation. */
  readonly generation: number;
  /** Required recovery action, when Core can determine one. */
  readonly recoveryRequirement?: 'explicit-rediscovery-and-new-session';
  /** Native operation that reported the failure. */
  readonly operation: string;
  /** Stable failure category. */
  readonly failureClass: 'source-instance-exited' | 'platform-status' | 'backend-class';
  /** Native platform status code, when supplied. */
  readonly platformStatusCode?: number;
  /** Backend-defined failure category, when supplied. */
  readonly backendClass?: string;
}

/** Session lifecycle transition. */
export interface LifecycleEvent {
  /** Event discriminator. */
  readonly type: 'lifecycle';
  /** Session that emitted the event. */
  readonly sessionId: bigint;
  /** Current native lifecycle state. */
  readonly state: SessionState;
}

/** Source failure reported by a running Session. */
export interface SourceFailureEvent {
  /** Event discriminator. */
  readonly type: 'source-failure';
  /** Session that emitted the event. */
  readonly sessionId: bigint;
  /** Source failure details. */
  readonly failure: SourceFailure;
}

/** Endpoint delivery or lifecycle failure. */
export interface EndpointFailureEvent {
  /** Event discriminator. */
  readonly type: 'endpoint-failure';
  /** Session that emitted the event. */
  readonly sessionId: bigint;
  /** Route affected by the failure. */
  readonly routeId: bigint;
  /** Endpoint affected by the failure. */
  readonly endpointId: bigint;
  /** Endpoint lifecycle stage that failed. */
  readonly stage: string;
  /** Human-readable failure description. */
  readonly message: string;
  /** Stable provider error code, when supplied. */
  readonly code?: string;
  /** Provider retry guidance, when supplied. */
  readonly retryability?: 'never' | 'retryable' | 'reconfiguration-required';
}

/** Failure while rolling back startup or finalizing shutdown. */
export interface SessionControlFailureEvent {
  /** Event discriminator and failure phase. */
  readonly type: 'rollback-failure' | 'finalization-failure';
  /** Session that emitted the event. */
  readonly sessionId: bigint;
  /** Startup or shutdown stage that failed. */
  readonly stage: string;
  /** Kind of Session component that failed. */
  readonly componentKind: 'source' | 'endpoint' | 'operator' | 'sidecar' | 'runtime';
  /** Component identity formatted without numeric precision loss. */
  readonly componentId: string;
  /** Operation that failed. */
  readonly operation: string;
  /** Stable failure category. */
  readonly errorClass: string;
}

/** Final Session state and failure counts. */
export interface TerminalEvent {
  /** Event discriminator. */
  readonly type: 'terminal';
  /** Session that emitted the event. */
  readonly sessionId: bigint;
  /** Final native state. */
  readonly state: 'stopped' | 'failed';
  /** Number of source failures retained by the Session. */
  readonly sourceFailuresTotal: bigint;
  /** Number of Endpoint failures retained by the Session. */
  readonly endpointFailuresTotal: bigint;
  /** Number of startup rollback failures. */
  readonly rollbackFailuresTotal: bigint;
  /** Number of shutdown finalization failures. */
  readonly finalizationFailuresTotal: bigint;
}

/** One lifecycle or failure event from the native Session owner. */
export type SessionEvent =
  | LifecycleEvent
  | SourceFailureEvent
  | EndpointFailureEvent
  | SessionControlFailureEvent
  | TerminalEvent;

/** Controls one direct read or async event iterator. */
export interface EventReadOptions {
  /** Maximum native wait in milliseconds. Must be an integer from 0 through 1000. */
  readonly timeoutMs?: number;
  /** Stops this reader without stopping the Session. */
  readonly signal?: AbortSignal;
}

const DEFAULT_WAIT_MS = 100;

/** Reads lifecycle and failure events from a running Session. */
export class EventStream implements AsyncIterable<SessionEvent> {
  readonly #running: NativeRunningSessionHandle;
  #activeReader = false;
  #readInProgress = false;
  #closed = false;
  #pending: SessionEvent[] = [];

  private constructor(running: NativeRunningSessionHandle) {
    this.#running = running;
  }

  /** @internal */
  public static _create(running: NativeRunningSessionHandle): EventStream {
    return new EventStream(running);
  }

  /** Whether the Session has finished and all retained events were read. */
  public get closed(): boolean {
    return this.#closed;
  }

  /** Read the next event, or `undefined` when the wait expires. */
  public async read(options: EventReadOptions = {}): Promise<SessionEvent | undefined> {
    if (this.#activeReader || this.#readInProgress) {
      throw new PocketStationError(
        'stream.in_use',
        'Session event stream already has an active reader',
      );
    }
    this.#readInProgress = true;
    try {
      return await this.#readOnce(options);
    } finally {
      this.#readInProgress = false;
    }
  }

  /** Iterate until the Session closes or the reader is aborted. */
  public async *events(options: EventReadOptions = {}): AsyncGenerator<SessionEvent> {
    if (this.#activeReader || this.#readInProgress) {
      throw new PocketStationError(
        'stream.in_use',
        'Session event stream already has an active reader',
      );
    }
    this.#activeReader = true;
    try {
      while (!this.#closed || this.#pending.length > 0) {
        options.signal?.throwIfAborted();
        const event = await this.#readOnce(options);
        if (event !== undefined) {
          yield event;
        }
      }
    } finally {
      this.#activeReader = false;
    }
  }

  /** Iterate with the default read options. */
  public [Symbol.asyncIterator](): AsyncGenerator<SessionEvent> {
    return this.events();
  }

  /** @internal */
  public _finish(events: readonly NativeSessionEvent[]): void {
    this.#pending.push(...events.map(eventFromNative));
    this.#closed = true;
  }

  async #readOnce(options: EventReadOptions): Promise<SessionEvent | undefined> {
    options.signal?.throwIfAborted();
    const pending = this.#pending.shift();
    if (pending !== undefined) {
      return pending;
    }
    if (this.#closed) {
      return undefined;
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
    validateTimeout(timeoutMs);
    const result = await nativeCall(() => this.#running.readEvent(timeoutMs));
    if (result.sessionState === 'stopped' || result.sessionState === 'failed') {
      this.#closed = true;
    }
    options.signal?.throwIfAborted();
    return result.event == null ? undefined : eventFromNative(result.event);
  }
}

function eventFromNative(event: NativeSessionEvent): SessionEvent {
  const sessionId = BigInt(event.sessionId);
  switch (event.eventType) {
    case 'lifecycle':
      return {
        type: 'lifecycle',
        sessionId,
        state: required(event.sessionState, 'sessionState') as SessionState,
      };
    case 'source-failure': {
      const platform = required(event.sourcePlatform, 'sourcePlatform') as Platform;
      const kind = required(event.sourceKind, 'sourceKind') as SourceKind;
      return {
        type: 'source-failure',
        sessionId,
        failure: {
          kind: required(event.sourceEventKind, 'sourceEventKind') as SourceFailure['kind'],
          stemId: BigInt(required(event.stemId, 'stemId')),
          stableId: {
            platform,
            kind,
            stableKey: required(event.sourceStableKey, 'sourceStableKey'),
            sourceId: BigInt(required(event.sourceId, 'sourceId')),
          },
          generation: required(event.sourceGeneration, 'sourceGeneration'),
          recoveryRequirement: (event.sourceRecoveryRequirement ??
            undefined) as SourceFailure['recoveryRequirement'],
          operation: required(event.sourceFailureOperation, 'sourceFailureOperation'),
          failureClass: required(
            event.sourceFailureClass,
            'sourceFailureClass',
          ) as SourceFailure['failureClass'],
          platformStatusCode: event.sourcePlatformStatusCode ?? undefined,
          backendClass: event.sourceBackendClass ?? undefined,
        },
      };
    }
    case 'endpoint-failure':
      return {
        type: 'endpoint-failure',
        sessionId,
        routeId: BigInt(required(event.routeId, 'routeId')),
        endpointId: BigInt(required(event.endpointId, 'endpointId')),
        stage: required(event.failureStage, 'failureStage'),
        message: required(event.failureMessage, 'failureMessage'),
        code: event.failureCode ?? undefined,
        retryability: (event.failureRetryability ??
          undefined) as EndpointFailureEvent['retryability'],
      };
    case 'rollback-failure':
    case 'finalization-failure':
      return {
        type: event.eventType,
        sessionId,
        stage: required(event.failureStage, 'failureStage'),
        componentKind: required(
          event.componentKind,
          'componentKind',
        ) as SessionControlFailureEvent['componentKind'],
        componentId: required(event.componentId, 'componentId'),
        operation: required(event.failureOperation, 'failureOperation'),
        errorClass: required(event.failureErrorClass, 'failureErrorClass'),
      };
    case 'terminal':
      return {
        type: 'terminal',
        sessionId,
        state: required(event.sessionState, 'sessionState') as TerminalEvent['state'],
        sourceFailuresTotal: BigInt(required(event.sourceFailuresTotal, 'sourceFailuresTotal')),
        endpointFailuresTotal: BigInt(
          required(event.endpointFailuresTotal, 'endpointFailuresTotal'),
        ),
        rollbackFailuresTotal: BigInt(
          required(event.rollbackFailuresTotal, 'rollbackFailuresTotal'),
        ),
        finalizationFailuresTotal: BigInt(
          required(event.finalizationFailuresTotal, 'finalizationFailuresTotal'),
        ),
      };
    default:
      throw new PocketStationError(
        'session.invalid_event',
        `Native Session returned an unknown event type: ${event.eventType}`,
      );
  }
}

function required<T>(value: T | null | undefined, name: string): T {
  if (value == null) {
    throw new PocketStationError(
      'session.invalid_event',
      `Native Session event is missing ${name}`,
    );
  }
  return value;
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 1_000) {
    throw new RangeError('timeoutMs must be an integer between 0 and 1000');
  }
}
