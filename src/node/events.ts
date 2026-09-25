import {
  PocketStationError,
  StreamInUseError,
  StreamModeError,
  nativeCall,
} from './errors.js';
import {
  EndpointId,
  OperatorInstanceId,
  RouteId,
  RuntimeSessionId,
  SidecarId,
  SourceId,
  StemId,
} from './identity.js';
import type {
  NativeControlFailure,
  NativeEndpointFailure,
  NativeRunningSessionHandle,
  NativeSessionEvent,
  NativeSourceFailure,
} from './native.js';
import type { SourceRuntimeEvent } from './sources.js';
import type { EndpointFailureRetryability } from './endpoint.js';

/** Stable variants of the authoritative Session event stream. */
export const SessionEventType = Object.freeze({
  LIFECYCLE: 'lifecycle',
  SOURCE_FAILURE: 'source-failure',
  ENDPOINT_FAILURE: 'endpoint-failure',
  ROLLBACK_FAILURE: 'rollback-failure',
  FINALIZATION_FAILURE: 'finalization-failure',
  TERMINAL: 'terminal',
} as const);
export type SessionEventType =
  (typeof SessionEventType)[keyof typeof SessionEventType];

/** Public native Session lifecycle state. */
export const SessionLifecycleState = Object.freeze({
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  FAILED: 'failed',
} as const);
export type SessionLifecycleState =
  (typeof SessionLifecycleState)[keyof typeof SessionLifecycleState];
/** @deprecated Use `SessionLifecycleState`. */
export type SessionState = SessionLifecycleState;

/** Terminal native Session states. */
export const SessionTerminalState = Object.freeze({
  STOPPED: 'stopped',
  FAILED: 'failed',
} as const);
export type SessionTerminalState =
  (typeof SessionTerminalState)[keyof typeof SessionTerminalState];

/** Stable categories for retained Session failures. */
export const SessionFailureKind = Object.freeze({
  SOURCE: 'source',
  ENDPOINT: 'endpoint',
  ROLLBACK: 'rollback',
  FINALIZATION: 'finalization',
} as const);
export type SessionFailureKind =
  (typeof SessionFailureKind)[keyof typeof SessionFailureKind];

/** Stable Session component categories. */
export const SessionComponentKind = Object.freeze({
  SOURCE: 'source',
  ENDPOINT: 'endpoint',
  OPERATOR: 'operator',
  SIDECAR: 'sidecar',
  RUNTIME: 'runtime',
} as const);
export type SessionComponentKind =
  (typeof SessionComponentKind)[keyof typeof SessionComponentKind];

/** Native source disappearance or backend failure. */
export interface SourceFailure extends SourceRuntimeEvent {
  /** Session Stem affected by the failure. */
  readonly stemId: StemId;
}

/** Session lifecycle transition. */
export interface LifecycleEvent {
  /** Event discriminator. */
  readonly type: 'lifecycle';
  /** Session that emitted the event. */
  readonly sessionId: RuntimeSessionId;
  /** Current native lifecycle state. */
  readonly state: SessionState;
}

/** Source failure reported by a running Session. */
export interface SourceFailureEvent {
  /** Event discriminator. */
  readonly type: 'source-failure';
  /** Session that emitted the event. */
  readonly sessionId: RuntimeSessionId;
  /** Source failure details. */
  readonly failure: SourceFailure;
}

/** Endpoint delivery or lifecycle failure. */
export interface EndpointFailureEvent {
  /** Event discriminator. */
  readonly type: 'endpoint-failure';
  /** Session that emitted the event. */
  readonly sessionId: RuntimeSessionId;
  /** Route affected by the failure. */
  readonly routeId: RouteId;
  /** Endpoint affected by the failure. */
  readonly endpointId: EndpointId;
  /** Endpoint lifecycle stage that failed. */
  readonly stage: EndpointFailureStage;
  /** Human-readable failure description. */
  readonly message: string;
  /** Stable provider error code, when supplied. */
  readonly code?: string;
  /** Provider retry guidance, when supplied. */
  readonly retryability?: EndpointFailureRetryability;
}

/** Endpoint lifecycle operation that reported a failure. */
export const EndpointFailureStage = Object.freeze({
  PREPARE: 'prepare',
  CANCEL_PREPARATION: 'cancel-preparation',
  START: 'start',
  REQUEST_STOP: 'request-stop',
  JOIN_FINALIZE: 'join-finalize',
} as const);
export type EndpointFailureStage =
  (typeof EndpointFailureStage)[keyof typeof EndpointFailureStage];

/** One Endpoint failure retained in the terminal Session result. */
export interface EndpointFailure {
  readonly routeId: RouteId;
  readonly endpointId: EndpointId;
  readonly stage: EndpointFailureStage;
  readonly message: string;
  readonly code?: string;
  readonly retryability?: EndpointFailureRetryability;
}

/** Startup operation used while closing resources opened before a failed start. */
export const SessionRollbackStage = Object.freeze({
  CANCEL_OPERATOR: 'cancel-operator',
  CANCEL_ENDPOINT_PREPARATION: 'cancel-endpoint-preparation',
  FINALIZE_STARTED_ENDPOINT: 'finalize-started-endpoint',
  STOP_OPENED_CAPTURE: 'stop-opened-capture',
  DISCARD_RUNTIME_QUEUES: 'discard-runtime-queues',
} as const);
export type SessionRollbackStage =
  (typeof SessionRollbackStage)[keyof typeof SessionRollbackStage];
/** @deprecated Use `SessionRollbackStage`. */
export type RollbackFailureStage = SessionRollbackStage;

/** Shutdown operation that could not finish normally. */
export const SessionFinalizationStage = Object.freeze({
  STOP_CAPTURE: 'stop-capture',
  DRAIN_RUNTIME: 'drain-runtime',
  DRAIN_OPERATOR: 'drain-operator',
  REQUEST_ENDPOINT_STOP: 'request-endpoint-stop',
  JOIN_ENDPOINT: 'join-endpoint',
  FINALIZE_ENDPOINT: 'finalize-endpoint',
  DRAIN_SIDECAR: 'drain-sidecar',
} as const);
export type SessionFinalizationStage =
  (typeof SessionFinalizationStage)[keyof typeof SessionFinalizationStage];
/** @deprecated Use `SessionFinalizationStage`. */
export type FinalizationFailureStage = SessionFinalizationStage;

/** Stable typed owner of one rollback or finalization failure. */
export interface SessionComponent {
  readonly kind: SessionComponentKind;
  readonly stemId?: StemId;
  readonly routeId?: RouteId;
  readonly endpointId?: EndpointId;
  readonly operatorInstanceId?: OperatorInstanceId;
  readonly sidecarId?: SidecarId;
}

/** One normalized source, Endpoint, rollback, or finalization failure. */
export interface SessionFailure {
  readonly kind: SessionFailureKind;
  readonly stage?:
    | EndpointFailureStage
    | SessionRollbackStage
    | SessionFinalizationStage;
  readonly operation?: string;
  readonly errorClass?: string;
  readonly errorCode?: string;
  readonly retryability?: EndpointFailureRetryability;
  readonly component?: SessionComponent;
  readonly componentDiagnostic?: string;
  readonly message?: string;
  readonly stemId?: StemId;
  readonly routeId?: RouteId;
  readonly endpointId?: EndpointId;
  readonly operatorInstanceId?: OperatorInstanceId;
  readonly sidecarId?: SidecarId;
  readonly source?: SourceRuntimeEvent;
}

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
  readonly sessionId: RuntimeSessionId;
  /** Startup or shutdown stage that failed. */
  readonly stage: RollbackFailureStage | FinalizationFailureStage;
  /** Kind of Session component that failed. */
  readonly componentKind: 'source' | 'endpoint' | 'operator' | 'sidecar' | 'runtime';
  /** Component identity formatted without numeric precision loss. */
  readonly componentId: string;
  /** Operation that failed. */
  readonly operation: string;
  /** Stable failure kind. */
  readonly errorClass: string;
}

/** Final Session state and failure counts. */
export interface TerminalEvent {
  /** Event discriminator. */
  readonly type: 'terminal';
  /** Session that emitted the event. */
  readonly sessionId: RuntimeSessionId;
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

/** Fields available on every projected Session event. */
export interface SessionEventFields {
  readonly sessionId: RuntimeSessionId;
  readonly lifecycleState?: SessionLifecycleState;
  readonly stemId?: StemId;
  readonly endpointId?: EndpointId;
  readonly routeId?: RouteId;
  readonly failures: readonly SessionFailure[];
  readonly failuresTotal: bigint;
  readonly terminalState?: SessionTerminalState;
  readonly source?: SourceRuntimeEvent;
}

/** One lifecycle or failure event from the native Session runtime. */
export type SessionEvent =
  SessionEventFields & (
    | LifecycleEvent
    | SourceFailureEvent
    | EndpointFailureEvent
    | SessionControlFailureEvent
    | TerminalEvent
  );

/** Controls one direct read or async event iterator. */
export interface EventReadOptions {
  /** Maximum native wait in milliseconds. Must be an integer from 0 through 1000. */
  readonly timeoutMs?: number;
  /** Stops this reader without stopping the Session. */
  readonly signal?: AbortSignal;
}

/** Application callbacks used to expose a Session-compatible event stream. */
export interface EventStreamOptions {
  /** Return one immediately available event without waiting. */
  readonly pollEvent: () => SessionEvent | undefined | Promise<SessionEvent | undefined>;
  /** Wait up to the supplied finite number of milliseconds for one event. */
  readonly waitEvent: (
    timeoutMs: number,
  ) => SessionEvent | undefined | Promise<SessionEvent | undefined>;
  /** Report whether the producer is closed and will emit no later events. */
  readonly isClosed: () => boolean;
}

const DEFAULT_WAIT_MS = 100;

/** Reads lifecycle and failure events from a running Session. */
export class EventStream implements AsyncIterable<SessionEvent> {
  readonly #pollEvent: EventStreamOptions['pollEvent'];
  readonly #waitEvent: EventStreamOptions['waitEvent'];
  readonly #producerIsClosed: EventStreamOptions['isClosed'];
  #activeReader = false;
  #readerMode: 'event_read' | 'events' | undefined;
  #closed = false;
  #pending: SessionEvent[] = [];

  public constructor(options: EventStreamOptions) {
    if (typeof options?.pollEvent !== 'function') {
      throw new TypeError('pollEvent must be a function');
    }
    if (typeof options.waitEvent !== 'function') {
      throw new TypeError('waitEvent must be a function');
    }
    if (typeof options.isClosed !== 'function') {
      throw new TypeError('isClosed must be a function');
    }
    this.#pollEvent = options.pollEvent;
    this.#waitEvent = options.waitEvent;
    this.#producerIsClosed = options.isClosed;
  }

  /** @internal */
  public static _create(running: NativeRunningSessionHandle): EventStream {
    let producerClosed = false;
    const readNative = async (timeoutMs: number): Promise<SessionEvent | undefined> => {
      const result = await nativeCall(() => running.readEvent(timeoutMs));
      if (result.sessionState === 'stopped' || result.sessionState === 'failed') {
        producerClosed = true;
      }
      return result.event == null ? undefined : _eventFromNative(result.event);
    };
    return new EventStream({
      pollEvent: () => readNative(0),
      waitEvent: (timeoutMs) => readNative(timeoutMs),
      isClosed: () => producerClosed,
    });
  }

  /** Whether the Session has finished and all retained events were read. */
  public get closed(): boolean {
    return this.#closed;
  }

  /** Whether the Session has finished and all retained events were read. */
  public get isClosed(): boolean {
    return this.#closed;
  }

  /** Permanently selected consumption mode, once reading begins. */
  public get readerMode(): 'event_read' | 'events' | undefined {
    return this.#readerMode;
  }

  /** Read the next event immediately. */
  public async poll(
    options: Omit<EventReadOptions, 'timeoutMs'> = {},
  ): Promise<SessionEvent | undefined> {
    const release = this.#claim('event_read');
    try {
      return await this.#readOnce({ ...options, timeoutMs: 0 });
    } finally {
      release();
    }
  }

  /** Read the next event, or `undefined` when the wait expires. */
  public async read(options: EventReadOptions = {}): Promise<SessionEvent | undefined> {
    const release = this.#claim('event_read');
    try {
      return await this.#readOnce(options);
    } finally {
      release();
    }
  }

  /** Iterate until the Session closes or the reader is aborted. */
  public async *events(options: EventReadOptions = {}): AsyncGenerator<SessionEvent> {
    yield* this.iterEvents(options);
  }

  /** Iterate until the Session closes or the reader is aborted. */
  public async *iterEvents(
    options: EventReadOptions = {},
  ): AsyncGenerator<SessionEvent> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
    validateTimeout(timeoutMs);
    if (timeoutMs === 0) {
      throw new RangeError('iterEvents() requires timeoutMs to be greater than zero');
    }
    const release = this.#claim('events');
    try {
      while (!this.#closed || this.#pending.length > 0) {
        options.signal?.throwIfAborted();
        const event = await this.#readOnce(options);
        if (event !== undefined) {
          yield event;
        }
      }
    } finally {
      release();
    }
  }

  /** Iterate with the default read options. */
  public [Symbol.asyncIterator](): AsyncGenerator<SessionEvent> {
    return this.iterEvents();
  }

  /** @internal */
  public _finish(events: readonly NativeSessionEvent[]): void {
    this.#pending.push(...events.map(_eventFromNative));
    this.#closed = true;
  }

  #claim(mode: 'event_read' | 'events'): () => void {
    if (this.#readerMode !== undefined && this.#readerMode !== mode) {
      throw new StreamModeError(this.#readerMode, mode);
    }
    if (this.#activeReader) {
      throw new StreamInUseError(mode);
    }
    this.#readerMode = mode;
    this.#activeReader = true;
    return () => {
      this.#activeReader = false;
    };
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
    const event = await (timeoutMs === 0
      ? this.#pollEvent()
      : this.#waitEvent(timeoutMs));
    if (event !== undefined) {
      this.#pending.push(event);
    }
    if (this.#producerIsClosed()) {
      this.#closed = true;
    }
    options.signal?.throwIfAborted();
    return this.#pending.shift();
  }
}

/** @internal */
export function _eventFromNative(event: NativeSessionEvent): SessionEvent {
  const sessionId = RuntimeSessionId(BigInt(event.sessionId));
  switch (event.eventType) {
    case 'lifecycle':
      const lifecycleState = choice(
        required(event.sessionState, 'sessionState'),
        'lifecycle state',
        SESSION_STATES,
      );
      return Object.freeze({
        ...eventFields(sessionId),
        type: 'lifecycle',
        state: lifecycleState,
        lifecycleState,
      });
    case 'source-failure': {
      const platform = choice(required(event.sourcePlatform, 'sourcePlatform'), 'source platform', PLATFORMS);
      const kind = choice(required(event.sourceKind, 'sourceKind'), 'source kind', SOURCE_KINDS);
      const failure = Object.freeze({
        kind: choice(
          required(event.sourceEventKind, 'sourceEventKind'),
          'source failure kind',
          SOURCE_FAILURE_KINDS,
        ),
        stemId: StemId(BigInt(required(event.stemId, 'stemId'))),
        stableId: Object.freeze({
          platform,
          kind,
          stableKey: required(event.sourceStableKey, 'sourceStableKey'),
          sourceId: SourceId(BigInt(required(event.sourceId, 'sourceId'))),
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
      }) satisfies SourceFailure;
      const normalized = sourceSessionFailure(failure);
      return Object.freeze({
        ...eventFields(sessionId, [normalized]),
        type: 'source-failure',
        failure,
        stemId: failure.stemId,
        source: failure,
      });
    }
    case 'endpoint-failure': {
      const failure = Object.freeze({
        routeId: RouteId(BigInt(required(event.routeId, 'routeId'))),
        endpointId: EndpointId(BigInt(required(event.endpointId, 'endpointId'))),
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
      }) satisfies EndpointFailure;
      return Object.freeze({
        ...eventFields(sessionId, [endpointSessionFailure(failure)]),
        type: 'endpoint-failure',
        ...failure,
      });
    }
    case 'rollback-failure':
    case 'finalization-failure': {
      const controlFailure = Object.freeze({
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
      }) satisfies SessionControlFailure;
      return Object.freeze({
        ...eventFields(
          sessionId,
          [controlSessionFailure(
            event.eventType === 'rollback-failure' ? 'rollback' : 'finalization',
            controlFailure,
          )],
        ),
        type: event.eventType,
        ...controlFailure,
      });
    }
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
      const failures = Object.freeze([
        ...terminal.sourceFailures.map(sourceSessionFailure),
        ...terminal.endpointFailures.map(endpointSessionFailure),
        ...terminal.rollbackFailures.map((failure) =>
          controlSessionFailure('rollback', failure)
        ),
        ...terminal.finalizationFailures.map((failure) =>
          controlSessionFailure('finalization', failure)
        ),
      ]);
      return Object.freeze({
        ...eventFields(sessionId, failures),
        ...terminal,
        terminalState: terminal.state,
      });
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
    stemId: StemId(BigInt(failure.stemId)),
    stableId: Object.freeze({
      platform: choice(failure.sourcePlatform, 'source platform', PLATFORMS),
      kind: choice(failure.sourceKind, 'source kind', SOURCE_KINDS),
      stableKey: failure.sourceStableKey,
      sourceId: SourceId(BigInt(failure.sourceId)),
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
    routeId: RouteId(BigInt(failure.routeId)),
    endpointId: EndpointId(BigInt(failure.endpointId)),
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

function eventFields(
  sessionId: RuntimeSessionId,
  failures: readonly SessionFailure[] = [],
): SessionEventFields {
  const ownedFailures = Object.freeze([...failures]);
  return Object.freeze({
    sessionId,
    lifecycleState: undefined,
    stemId: undefined,
    endpointId: undefined,
    routeId: undefined,
    failures: ownedFailures,
    failuresTotal: BigInt(ownedFailures.length),
    terminalState: undefined,
    source: undefined,
  });
}

function sourceSessionFailure(failure: SourceFailure): SessionFailure {
  return Object.freeze({
    kind: 'source',
    operation: failure.operation,
    errorClass: failure.failureClass,
    componentDiagnostic: failure.stableId.stableKey,
    stemId: failure.stemId,
    source: failure,
  });
}

function endpointSessionFailure(failure: EndpointFailure): SessionFailure {
  return Object.freeze({
    kind: 'endpoint',
    stage: failure.stage,
    errorCode: failure.code,
    retryability: failure.retryability,
    message: failure.message,
    routeId: failure.routeId,
    endpointId: failure.endpointId,
  });
}

function controlSessionFailure(
  kind: 'rollback' | 'finalization',
  failure: SessionControlFailure,
): SessionFailure {
  const component = sessionComponent(failure.componentKind, failure.componentId);
  return Object.freeze({
    kind,
    stage: failure.stage,
    operation: failure.operation,
    errorClass: failure.errorClass,
    component,
    componentDiagnostic: failure.componentId,
    stemId: component.stemId,
    routeId: component.routeId,
    endpointId: component.endpointId,
    operatorInstanceId: component.operatorInstanceId,
    sidecarId: component.sidecarId,
  });
}

function sessionComponent(
  kind: SessionComponentKind,
  diagnostic: string,
): SessionComponent {
  switch (kind) {
    case 'source':
      return Object.freeze({ kind, stemId: StemId(BigInt(diagnostic)) });
    case 'endpoint': {
      const [routeId, endpointId, ...extra] = diagnostic.split(':');
      if (routeId === undefined || endpointId === undefined || extra.length > 0) {
        throw new PocketStationError(
          'session.invalid_event',
          `Native Endpoint component identity is invalid: ${diagnostic}`,
        );
      }
      return Object.freeze({
        kind,
        routeId: RouteId(BigInt(routeId)),
        endpointId: EndpointId(BigInt(endpointId)),
      });
    }
    case 'operator':
      return Object.freeze({
        kind,
        operatorInstanceId: OperatorInstanceId(BigInt(diagnostic)),
      });
    case 'sidecar':
      return Object.freeze({ kind, sidecarId: SidecarId(BigInt(diagnostic)) });
    case 'runtime':
      return Object.freeze({ kind });
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
