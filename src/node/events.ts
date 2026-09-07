import { PocketStationError, nativeCall } from './errors.js';
import type {
  NativeControlFailure,
  NativeEndpointFailure,
  NativeRunningSessionHandle,
  NativeSessionEvent,
  NativeSourceFailure,
} from './native.js';
import type { StableSourceId } from './sources.js';

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
  readonly stage: EndpointFailureStage;
  /** Human-readable failure description. */
  readonly message: string;
  /** Stable provider error code, when supplied. */
  readonly code?: string;
  /** Provider retry guidance, when supplied. */
  readonly retryability?: 'never' | 'retryable' | 'reconfiguration-required';
}

/** Endpoint lifecycle operation that reported a failure. */
export type EndpointFailureStage =
  | 'prepare'
  | 'cancel-preparation'
  | 'start'
  | 'request-stop'
  | 'join-finalize';

/** One Endpoint failure retained in the terminal Session result. */
export interface EndpointFailure {
  readonly routeId: bigint;
  readonly endpointId: bigint;
  readonly stage: EndpointFailureStage;
  readonly message: string;
  readonly code?: string;
  readonly retryability?: 'never' | 'retryable' | 'reconfiguration-required';
}

/** Startup operation used while closing resources opened before a failed start. */
export type RollbackFailureStage =
  | 'cancel-operator'
  | 'cancel-endpoint-preparation'
  | 'finalize-started-endpoint'
  | 'stop-opened-capture'
  | 'discard-runtime-queues';

/** Shutdown operation that could not finish normally. */
export type FinalizationFailureStage =
  | 'stop-capture'
  | 'drain-runtime'
  | 'drain-operator'
  | 'request-endpoint-stop'
  | 'join-endpoint'
  | 'finalize-endpoint'
  | 'drain-sidecar';

/** One component failure retained in the terminal Session result. */
export interface SessionControlFailure {
  readonly stage: RollbackFailureStage | FinalizationFailureStage;
  readonly componentKind: 'source' | 'endpoint' | 'operator' | 'sidecar' | 'runtime';
  readonly componentId: string;
  readonly operation: string;
  readonly errorClass: string;
}

/** Failure while rolling back startup or finalizing shutdown. */
export interface SessionControlFailureEvent {
  /** Event discriminator and failure phase. */
  readonly type: 'rollback-failure' | 'finalization-failure';
  /** Session that emitted the event. */
  readonly sessionId: bigint;
  /** Startup or shutdown stage that failed. */
  readonly stage: RollbackFailureStage | FinalizationFailureStage;
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
  /** Complete source failures retained by Core. */
  readonly sourceFailures: readonly SourceFailure[];
  /** Complete Endpoint failures retained by Core. */
  readonly endpointFailures: readonly EndpointFailure[];
  /** Complete startup rollback failures retained by Core. */
  readonly rollbackFailures: readonly SessionControlFailure[];
  /** Complete shutdown failures retained by Core. */
  readonly finalizationFailures: readonly SessionControlFailure[];
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
    this.#pending.push(...events.map(_eventFromNative));
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
    return result.event == null ? undefined : _eventFromNative(result.event);
  }
}

/** @internal */
export function _eventFromNative(event: NativeSessionEvent): SessionEvent {
  const sessionId = BigInt(event.sessionId);
  switch (event.eventType) {
    case 'lifecycle':
      return Object.freeze({
        type: 'lifecycle',
        sessionId,
        state: choice(
          required(event.sessionState, 'sessionState'),
          'lifecycle state',
          SESSION_STATES,
        ),
      });
    case 'source-failure': {
      const platform = choice(required(event.sourcePlatform, 'sourcePlatform'), 'source platform', PLATFORMS);
      const kind = choice(required(event.sourceKind, 'sourceKind'), 'source kind', SOURCE_KINDS);
      return Object.freeze({
        type: 'source-failure',
        sessionId,
        failure: Object.freeze({
          kind: choice(
            required(event.sourceEventKind, 'sourceEventKind'),
            'source failure kind',
            SOURCE_FAILURE_KINDS,
          ),
          stemId: BigInt(required(event.stemId, 'stemId')),
          stableId: Object.freeze({
            platform,
            kind,
            stableKey: required(event.sourceStableKey, 'sourceStableKey'),
            sourceId: BigInt(required(event.sourceId, 'sourceId')),
          }),
          generation: required(event.sourceGeneration, 'sourceGeneration'),
          recoveryRequirement:
            event.sourceRecoveryRequirement == null
              ? undefined
              : choice(
                  event.sourceRecoveryRequirement,
                  'source recovery requirement',
                  RECOVERY_REQUIREMENTS,
                ),
          operation: required(event.sourceFailureOperation, 'sourceFailureOperation'),
          failureClass: choice(
            required(event.sourceFailureClass, 'sourceFailureClass'),
            'source failure class',
            SOURCE_FAILURE_CLASSES,
          ),
          platformStatusCode: event.sourcePlatformStatusCode ?? undefined,
          backendClass: event.sourceBackendClass ?? undefined,
        }),
      });
    }
    case 'endpoint-failure':
      return Object.freeze({
        type: 'endpoint-failure',
        sessionId,
        routeId: BigInt(required(event.routeId, 'routeId')),
        endpointId: BigInt(required(event.endpointId, 'endpointId')),
        stage: choice(
          required(event.failureStage, 'failureStage'),
          'Endpoint failure stage',
          ENDPOINT_STAGES,
        ),
        message: required(event.failureMessage, 'failureMessage'),
        code: event.failureCode ?? undefined,
        retryability:
          event.failureRetryability == null
            ? undefined
            : choice(
                event.failureRetryability,
                'Endpoint retryability',
                RETRYABILITY,
              ),
      });
    case 'rollback-failure':
    case 'finalization-failure':
      return Object.freeze({
        type: event.eventType,
        sessionId,
        stage: event.eventType === 'rollback-failure'
          ? choice(
              required(event.failureStage, 'failureStage'),
              'rollback failure stage',
              ROLLBACK_STAGES,
            )
          : choice(
              required(event.failureStage, 'failureStage'),
              'finalization failure stage',
              FINALIZATION_STAGES,
            ),
        componentKind: choice(
          required(event.componentKind, 'componentKind'),
          'Session component kind',
          COMPONENT_KINDS,
        ),
        componentId: required(event.componentId, 'componentId'),
        operation: required(event.failureOperation, 'failureOperation'),
        errorClass: required(event.failureErrorClass, 'failureErrorClass'),
      });
    case 'terminal': {
      const terminal: TerminalEvent = Object.freeze({
        type: 'terminal',
        sessionId,
        state: choice(
          required(event.sessionState, 'sessionState'),
          'terminal state',
          TERMINAL_STATES,
        ),
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
        sourceFailures: Object.freeze(
          required(event.sourceFailures, 'sourceFailures').map(sourceFailureFromNative),
        ),
        endpointFailures: Object.freeze(
          required(event.endpointFailures, 'endpointFailures').map(endpointFailureFromNative),
        ),
        rollbackFailures: Object.freeze(
          required(event.rollbackFailures, 'rollbackFailures').map(controlFailureFromNative),
        ),
        finalizationFailures: Object.freeze(
          required(event.finalizationFailures, 'finalizationFailures').map(
            controlFailureFromNative,
          ),
        ),
      });
      if (
        terminal.sourceFailuresTotal !== BigInt(terminal.sourceFailures.length) ||
        terminal.endpointFailuresTotal !== BigInt(terminal.endpointFailures.length) ||
        terminal.rollbackFailuresTotal !== BigInt(terminal.rollbackFailures.length) ||
        terminal.finalizationFailuresTotal !==
          BigInt(terminal.finalizationFailures.length)
      ) {
        throw new PocketStationError(
          'session.invalid_event',
          'Native terminal event failure counts are inconsistent',
        );
      }
      return terminal;
    }
    default:
      throw new PocketStationError(
        'session.invalid_event',
        `Native Session returned an unknown event type: ${event.eventType}`,
      );
  }
}

function sourceFailureFromNative(failure: NativeSourceFailure): SourceFailure {
  return Object.freeze({
    kind: choice(failure.sourceEventKind, 'source failure kind', SOURCE_FAILURE_KINDS),
    stemId: BigInt(failure.stemId),
    stableId: Object.freeze({
      platform: choice(failure.sourcePlatform, 'source platform', PLATFORMS),
      kind: choice(failure.sourceKind, 'source kind', SOURCE_KINDS),
      stableKey: failure.sourceStableKey,
      sourceId: BigInt(failure.sourceId),
    }),
    generation: failure.sourceGeneration,
    recoveryRequirement:
      failure.sourceRecoveryRequirement == null
        ? undefined
        : choice(failure.sourceRecoveryRequirement, 'source recovery requirement', RECOVERY_REQUIREMENTS),
    operation: failure.sourceFailureOperation,
    failureClass: choice(failure.sourceFailureClass, 'source failure class', SOURCE_FAILURE_CLASSES),
    platformStatusCode: failure.sourcePlatformStatusCode ?? undefined,
    backendClass: failure.sourceBackendClass ?? undefined,
  });
}

function endpointFailureFromNative(failure: NativeEndpointFailure): EndpointFailure {
  return Object.freeze({
    routeId: BigInt(failure.routeId),
    endpointId: BigInt(failure.endpointId),
    stage: choice(failure.failureStage, 'Endpoint failure stage', ENDPOINT_STAGES),
    message: failure.failureMessage,
    code: failure.failureCode ?? undefined,
    retryability:
      failure.failureRetryability == null
        ? undefined
        : choice(failure.failureRetryability, 'Endpoint retryability', RETRYABILITY),
  });
}

function controlFailureFromNative(failure: NativeControlFailure): SessionControlFailure {
  return Object.freeze({
    stage: choice(failure.failureStage, 'Session control failure stage', CONTROL_STAGES),
    componentKind: choice(failure.componentKind, 'Session component kind', COMPONENT_KINDS),
    componentId: failure.componentId,
    operation: failure.failureOperation,
    errorClass: failure.failureErrorClass,
  });
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

const SESSION_STATES = ['starting', 'running', 'stopping', 'stopped', 'failed'] as const;
const TERMINAL_STATES = ['stopped', 'failed'] as const;
const PLATFORMS = ['macos', 'windows', 'linux', 'ios', 'android', 'web', 'unknown'] as const;
const SOURCE_KINDS = ['application', 'output-device', 'input-device', 'system-mix'] as const;
const SOURCE_FAILURE_KINDS = ['source-unavailable', 'backend-failure'] as const;
const SOURCE_FAILURE_CLASSES = ['source-instance-exited', 'platform-status', 'backend-class'] as const;
const RECOVERY_REQUIREMENTS = ['explicit-rediscovery-and-new-session'] as const;
const ENDPOINT_STAGES = ['prepare', 'cancel-preparation', 'start', 'request-stop', 'join-finalize'] as const;
const ROLLBACK_STAGES = ['cancel-operator', 'cancel-endpoint-preparation', 'finalize-started-endpoint', 'stop-opened-capture', 'discard-runtime-queues'] as const;
const FINALIZATION_STAGES = ['stop-capture', 'drain-runtime', 'drain-operator', 'request-endpoint-stop', 'join-endpoint', 'finalize-endpoint', 'drain-sidecar'] as const;
const CONTROL_STAGES = [...ROLLBACK_STAGES, ...FINALIZATION_STAGES] as const;
const COMPONENT_KINDS = ['source', 'endpoint', 'operator', 'sidecar', 'runtime'] as const;
const RETRYABILITY = ['never', 'retryable', 'reconfiguration-required'] as const;

function choice<const T extends readonly string[]>(
  value: string,
  name: string,
  accepted: T,
): T[number] {
  if (!(accepted as readonly string[]).includes(value)) {
    throw new PocketStationError(
      'session.invalid_event',
      `Native Session returned an unknown ${name}: ${value}`,
    );
  }
  return value as T[number];
}
