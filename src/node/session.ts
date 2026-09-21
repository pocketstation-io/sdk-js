import { nativeCall, nativeCallSync } from './errors.js';
import {
  type NativeAudioInputHandle,
  nativeAddon,
  type NativeDerivedStreamHandle,
  type NativeCompileDiagnostic,
  type NativeEndpointHandle,
  type NativeOperatorInputHandle,
  type NativeOperatorInstanceHandle,
  type NativeRelayDestinationOptions,
  type NativeRunningSessionHandle,
  type NativeSessionHandle,
  type NativeStemHandle,
  type NativeSourceOutputHandle,
  type NativeSourceInstanceHandle,
  type NativeStopResult,
} from './native.js';
import {
  AudioInput,
  AudioInputConfigurationError,
  _audioInputFailure,
  type AudioInputOptions,
  type AudioInputSamples,
} from './application-audio.js';
import {
  EventInput,
  type EventInputOptions,
} from './event-input.js';
import { PocketStationError } from '../errors.js';
import {
  type Conversation,
  type ConversationDeclarationOptions,
  declareConversation,
} from '../voice/conversation.js';
import {
  DeliveryPolicy,
  type Configuration,
  EndpointDefinition,
  Operator,
  RouteSettings,
  SignalSpec,
} from './graph.js';
import { Source, nativeSource } from './sources.js';
import { AudioStream } from './streams.js';
import { _eventFromNative, EventStream, type TerminalEvent } from './events.js';
import {
  BusSubscription,
  SignalStream,
  type SignalEnvelope,
} from './signals.js';
import {
  extensionLibraryFromNative,
  type NativeExtensionLibrary,
} from './extensions.js';
import {
  SidecarConnection,
  SidecarHandle,
  SidecarProcess,
  SidecarSnapshot,
} from './sidecar.js';
import { Connector, RegisteredConnector, type ConnectorConfigurationInput } from './connector.js';
import {
  EndpointProvider,
  RegisteredEndpoint,
  type EndpointConfigurationInput,
} from './endpoint.js';
import { EndpointFactory, OperatorFactory, SourceFactory } from './provider.js';
import {
  _recordingOutcomeFromNative,
  _sessionMetricsFromNative,
  _traceOutcomeFromNative,
  type RecordingOutcome,
  type SessionMetrics,
  type SessionTraceOutcome,
} from './observations.js';

/** Finite native event trace written alongside a Session. */
export interface SessionTraceOptions {
  /** New file to create. The file must not already exist. */
  readonly path: string;
  /** Maximum queued records. Defaults to 256; maximum 1,000,000. */
  readonly capacityRecords?: number;
}

/** Audio format and frame cadence used by a Session. */
export interface SessionOptions {
  /** Requested sample rate in hertz. Defaults to 48,000. */
  sampleRateHz?: number;
  /** Requested channel count. Defaults to one channel. */
  channels?: 1 | 2;
  /** Frame duration in milliseconds. Defaults to 20. */
  frameDurationMs?: 10 | 20;
  /** Directory where declared multistem recordings are written. */
  recordingRoot?: string;
  /** Optional native lifecycle and failure trace. */
  trace?: SessionTraceOptions;
}

/** Final result returned after a running Session stops or is cancelled. */
export interface StopResult {
  /** Whether every required finalization operation succeeded. */
  readonly success: boolean;
  /** Whether the native Session had already stopped. */
  readonly alreadyStopped: boolean;
  /** Operation that produced this result. */
  readonly disposition: 'stopped' | 'cancelled' | 'already-stopped';
  /** Final native Session state. */
  readonly sessionState: 'stopped' | 'failed';
  /** Whether the native runtime worker panicked during execution or shutdown. */
  readonly runtimeWorkerPanicked: boolean;
  /** Number of capture resources that failed to close. */
  readonly captureFinalizationFailuresTotal: bigint;
  /** Number of Operators that failed to close. */
  readonly operatorFinalizationFailuresTotal: bigint;
  /** Number of Endpoints that failed to close. */
  readonly endpointFinalizationFailuresTotal: bigint;
  /** Number of runtime failures observed by the Session. */
  readonly runtimeFailuresTotal: bigint;
  /** Number of invalid lineage transitions observed by the Session. */
  readonly lineageFailuresTotal: bigint;
  /** Number of Source frames rejected before routing. */
  readonly sourceSendRejectionsTotal: bigint;
  /** Number of runtime events retained by the Session. */
  readonly runtimeEventsTotal: bigint;
  /** Final process state and queue counters for every registered sidecar. */
  readonly sidecarOutcomes: readonly SidecarSnapshot[];
  /** Multistem recording result when this Session declared recording outputs. */
  readonly recording?: RecordingOutcome;
  /** Native trace write result when tracing was enabled. */
  readonly trace?: SessionTraceOutcome;
  /** Why the native trace could not be finalized, when finalization failed. */
  readonly traceError?: string;
  /** Complete terminal Session event, including retained failures. */
  readonly terminalEvent?: TerminalEvent;
  /** Final Core metrics, including queue depth, delivery, timing, and provider state. */
  readonly metrics?: SessionMetrics;
  /** Why final metrics could not be read, when Core could not produce them. */
  readonly metricsUnavailableReason?: string;
}

/** String settings passed to an externally registered Source. */
export type SourceConfiguration = Readonly<Record<string, string>>;

/** Stable location details returned when Core rejects a Session declaration. */
export interface CompileDiagnostic {
  /** Stable Core diagnostic code. */
  readonly code: string;
  /** Zero-based node index when one declaration caused the failure. */
  readonly nodeIndex?: number;
  /** Zero-based route index when one connection caused the failure. */
  readonly edgeIndex?: number;
  /** Registered Operator identifier involved in the failure. */
  readonly operatorId?: string;
  /** Session-local Operator instance identity. */
  readonly operatorInstanceId?: bigint;
  /** Node type involved in the failure. */
  readonly nodeTypeId?: string;
  /** Source type involved in the failure. */
  readonly sourceTypeId?: string;
  /** Named port involved in the failure. */
  readonly portName?: string;
  /** Input or output direction when relevant. */
  readonly direction?: string;
  /** Value required by the compiler. */
  readonly expected?: string;
  /** Value found in the Session declaration. */
  readonly actual?: string;
}

function compileDiagnosticFromNative(
  diagnostic?: NativeCompileDiagnostic | null,
): CompileDiagnostic | undefined {
  return diagnostic == null
    ? undefined
    : Object.freeze({
        code: diagnostic.code,
        nodeIndex: diagnostic.nodeIndex ?? undefined,
        edgeIndex: diagnostic.edgeIndex ?? undefined,
        operatorId: diagnostic.operatorId ?? undefined,
        operatorInstanceId:
          diagnostic.operatorInstanceId == null
            ? undefined
            : BigInt(diagnostic.operatorInstanceId),
        nodeTypeId: diagnostic.nodeTypeId ?? undefined,
        sourceTypeId: diagnostic.sourceTypeId ?? undefined,
        portName: diagnostic.portName ?? undefined,
        direction: diagnostic.direction ?? undefined,
        expected: diagnostic.expected ?? undefined,
        actual: diagnostic.actual ?? undefined,
      });
}

/** Startup failure reported by the native Session runtime. */
export class SessionStartError extends PocketStationError {
  /** Precise Core location data when startup failed during compilation. */
  public readonly diagnostic: CompileDiagnostic | undefined;

  /** Create a typed projection of one native startup failure. */
  public constructor(
    code: string,
    message: string,
    diagnostic?: CompileDiagnostic,
  ) {
    super(code, message);
    this.name = 'SessionStartError';
    this.diagnostic = diagnostic;
  }
}

/** A destination declared in a Session. */
export class Endpoint {
  readonly #session: Session;
  readonly #native: NativeEndpointHandle;

  private constructor(session: Session, native: NativeEndpointHandle) {
    this.#session = session;
    this.#native = native;
  }

  /** @internal */
  public static _create(session: Session, native: NativeEndpointHandle): Endpoint {
    return new Endpoint(session, native);
  }

  /** Session-local Endpoint identity. */
  public get id(): bigint {
    return BigInt(this.#native.id);
  }

  /** Session identity that owns this Endpoint. */
  public get sessionId(): bigint {
    return BigInt(this.#native.sessionId);
  }

  /** Core-assigned Connector identity, when this is a Connector destination. */
  public get connectorId(): bigint | undefined {
    return this.#native.connectorId == null ? undefined : BigInt(this.#native.connectorId);
  }

  /** @internal */
  public _belongsTo(session: Session): boolean {
    return this.#session === session;
  }

  /** @internal */
  public _nativeHandle(): NativeEndpointHandle {
    return this.#native;
  }
}

/** One STUN server available to the native Relay publisher. */
export interface RelayIceServer {
  /** One or more `stun:` URLs. */
  readonly urls: string | readonly string[];
}

/** Connection details returned when the control plane creates a RelaySession. */
export interface RelayPublisherOptions {
  /** PocketStation Relay HTTP or HTTPS origin. */
  readonly url: string;
  /** RelaySession identity returned by the control plane. */
  readonly sessionId: string;
  /** Source credential returned with the RelaySession. */
  readonly sourceToken: string;
  /** Prefer fresh speech audio over preserving a growing queue. */
  readonly lowLatency?: boolean;
  /** Complete signaling, ICE, and DTLS startup deadline. Defaults to 30 seconds. */
  readonly startupTimeoutMs?: number;
  /** STUN servers returned by the control plane, when needed. */
  readonly iceServers?: readonly RelayIceServer[];
}

/** Named audio destinations published through one shared Relay connection. */
export class RelayPublisher {
  readonly #session: Session;
  readonly #options: RelayPublisherOptions;
  readonly #destinations = new Map<string, Endpoint>();

  private constructor(session: Session, options: RelayPublisherOptions) {
    this.#session = session;
    this.#options = Object.freeze({ ...options });
  }

  /** @internal */
  public static _create(session: Session, options: RelayPublisherOptions): RelayPublisher {
    return new RelayPublisher(session, options);
  }

  /** Return the Session destination for one named Relay AudioBus. */
  public audio(busId: string): Endpoint {
    const bus = busId.trim();
    if (bus.length === 0) {
      throw new RangeError('Relay AudioBus name cannot be empty');
    }
    const existing = this.#destinations.get(bus);
    if (existing !== undefined) return existing;
    const endpoint = this.#session._relayAudio(this.#options, bus);
    this.#destinations.set(bus, endpoint);
    return endpoint;
  }
}

/** One source-aware output from a declared Source. */
export class Stem {
  readonly #session: Session;
  readonly #native: NativeStemHandle;

  private constructor(session: Session, native: NativeStemHandle) {
    this.#session = session;
    this.#native = native;
  }

  /** @internal */
  public static _create(session: Session, native: NativeStemHandle): Stem {
    return new Stem(session, native);
  }

  /** Session-local Stem identity. */
  public get id(): bigint {
    return BigInt(this.#native.id);
  }

  /** Route this Stem to an Endpoint and return the Session-local route identity. */
  public send(endpoint: Endpoint, options: { input?: string } = {}): bigint {
    if (!endpoint._belongsTo(this.#session)) {
      throw new TypeError('Stem and Endpoint belong to different Sessions');
    }
    return BigInt(
      nativeCallSync(() =>
        this.#native.send(endpoint._nativeHandle(), options.input),
      ),
    );
  }

  /** Send this Stem to one application-owned Connector. */
  public sendTo(connector: Connector): bigint {
    return this.send(this.#session.destination(connector));
  }

  /** Connect this Stem to one named Operator input. */
  public connect(input: OperatorInput): bigint {
    return BigInt(nativeCallSync(() => this.#native.connect(input._nativeHandle())));
  }

  /** Apply one Operator and select its output. */
  public through(
    operator: Operator,
    options: { input?: string; output?: string } = {},
  ): DerivedStream {
    return DerivedStream._create(
      this.#session,
      nativeCallSync(() =>
        this.#native.through(
          operator._nativeHandle(),
          options.input,
          options.output,
        ),
      ),
    );
  }

  /** Record this Stem under a stable name in the Session recording directory. */
  public record(name: string): Endpoint {
    return Endpoint._create(
      this.#session,
      nativeCallSync(() => this.#native.record(name)),
    );
  }
}

/** One source-aware output from an application-owned or registered Source. */
export class SourceOutput {
  readonly #session: Session;
  readonly #native: NativeSourceOutputHandle;
  readonly #conversationRouteIds = new Set<bigint>();
  readonly #conversationEndpointIds = new Set<bigint>();

  private constructor(session: Session, native: NativeSourceOutputHandle) {
    this.#session = session;
    this.#native = native;
  }

  /** @internal */
  public static _create(
    session: Session,
    native: NativeSourceOutputHandle,
  ): SourceOutput {
    return new SourceOutput(session, native);
  }

  /** Native Session that owns this output. */
  public get sessionId(): bigint {
    return BigInt(this.#native.sessionId);
  }

  /** Session-local identity of the registered Source instance. */
  public get sourceInstanceId(): bigint {
    return BigInt(this.#native.sourceInstanceId);
  }

  /** Stable Source identity assigned by Core. */
  public get sourceId(): bigint {
    return BigInt(this.#native.sourceId);
  }

  /** Stable stream identity assigned by Core. */
  public get streamId(): bigint {
    return BigInt(this.#native.streamId);
  }

  /** Named output port declared by this Source. */
  public get outputName(): string {
    return this.#native.outputPort;
  }

  /** Route this output to an Endpoint. */
  public send(endpoint: Endpoint, options: { input?: string } = {}): bigint {
    if (!endpoint._belongsTo(this.#session)) {
      throw new TypeError('SourceOutput and Endpoint belong to different Sessions');
    }
    const routeId = BigInt(
      nativeCallSync(() =>
        this.#native.send(endpoint._nativeHandle(), options.input),
      ),
    );
    this.#conversationRouteIds.add(routeId);
    this.#conversationEndpointIds.add(endpoint.id);
    return routeId;
  }

  /** Send this output to one application-owned Connector. */
  public sendTo(connector: Connector): bigint {
    return this.send(this.#session.destination(connector));
  }

  /** Connect this output to one named Operator input. */
  public connect(input: OperatorInput): bigint {
    return BigInt(nativeCallSync(() => this.#native.connect(input._nativeHandle())));
  }

  /** Apply an Operator and select its output. */
  public through(
    operator: Operator,
    options: { input?: string; output?: string } = {},
  ): DerivedStream {
    return DerivedStream._create(
      this.#session,
      nativeCallSync(() =>
        this.#native.through(
          operator._nativeHandle(),
          options.input,
          options.output,
        ),
      ),
    );
  }

  /** Record this output under a stable name in the Session recording directory. */
  public record(name: string): Endpoint {
    const endpoint = Endpoint._create(
      this.#session,
      nativeCallSync(() => this.#native.record(name)),
    );
    this.#conversationEndpointIds.add(endpoint.id);
    return endpoint;
  }

  /** @internal */
  public _conversationDeliveryTargets(): {
    readonly routeIds: readonly bigint[];
    readonly endpointIds: readonly bigint[];
  } {
    return Object.freeze({
      routeIds: Object.freeze([...this.#conversationRouteIds]),
      endpointIds: Object.freeze([...this.#conversationEndpointIds]),
    });
  }

  /** @internal */
  public _belongsTo(session: Session): boolean {
    return this.#session === session;
  }

  /** @internal */
  public _nativeHandle(): NativeSourceOutputHandle {
    return this.#native;
  }
}

/** One configured instance of an externally registered Source. */
export class SourceInstance {
  readonly #session: Session;
  readonly #native: NativeSourceInstanceHandle;

  private constructor(session: Session, native: NativeSourceInstanceHandle) {
    this.#session = session;
    this.#native = native;
  }

  /** @internal */
  public static _create(
    session: Session,
    native: NativeSourceInstanceHandle,
  ): SourceInstance {
    return new SourceInstance(session, native);
  }

  /** Native Session that owns this Source. */
  public get sessionId(): bigint {
    return BigInt(this.#native.sessionId);
  }

  /** Session-local Source instance identity. */
  public get id(): bigint {
    return BigInt(this.#native.instanceId);
  }

  /** Stable Source identity assigned by Core. */
  public get sourceId(): bigint {
    return BigInt(this.#native.sourceId);
  }

  /** Select one named output declared by the Source. */
  public output(name: string): SourceOutput {
    return SourceOutput._create(
      this.#session,
      nativeCallSync(() => this.#native.output(name)),
    );
  }
}

/** One named input on a Session-owned Operator instance. */
export class OperatorInput {
  readonly #native: NativeOperatorInputHandle;

  private constructor(native: NativeOperatorInputHandle) {
    this.#native = native;
  }

  /** @internal */
  public static _create(native: NativeOperatorInputHandle): OperatorInput {
    return new OperatorInput(native);
  }

  /** Named input selected on the Operator instance. */
  public get name(): string {
    return this.#native.portName;
  }

  /** @internal */
  public _nativeHandle(): NativeOperatorInputHandle {
    return this.#native;
  }
}

/** One configured Operator declared on a Session. */
export class OperatorInstance {
  readonly #session: Session;
  readonly #native: NativeOperatorInstanceHandle;

  private constructor(session: Session, native: NativeOperatorInstanceHandle) {
    this.#session = session;
    this.#native = native;
  }

  /** @internal */
  public static _create(
    session: Session,
    native: NativeOperatorInstanceHandle,
  ): OperatorInstance {
    return new OperatorInstance(session, native);
  }

  /** Session-local Operator instance identity. */
  public get id(): bigint {
    return BigInt(this.#native.instanceId);
  }

  /** Select a named input without starting the Operator. */
  public input(name: string): OperatorInput {
    return OperatorInput._create(
      nativeCallSync(() => this.#native.input(name)),
    );
  }

  /** Select a named output without starting the Operator. */
  public output(name: string): DerivedStream {
    return DerivedStream._create(
      this.#session,
      nativeCallSync(() => this.#native.output(name)),
    );
  }
}

/** One named Operator output that can be connected, routed, or returned as audio. */
export class DerivedStream {
  readonly #session: Session;
  readonly #native: NativeDerivedStreamHandle;

  private constructor(session: Session, native: NativeDerivedStreamHandle) {
    this.#session = session;
    this.#native = native;
  }

  /** @internal */
  public static _create(
    session: Session,
    native: NativeDerivedStreamHandle,
  ): DerivedStream {
    return new DerivedStream(session, native);
  }

  /** Session-local identity of the Operator that emits this stream. */
  public get operatorId(): bigint {
    return BigInt(this.#native.operatorInstanceId);
  }

  /** Selected output port, or `undefined` before an explicit output is chosen. */
  public get outputName(): string | undefined {
    return this.#native.outputPort ?? undefined;
  }

  /** Select another named output on the same Operator instance. */
  public output(name: string): DerivedStream {
    return DerivedStream._create(
      this.#session,
      nativeCallSync(() => this.#native.output(name)),
    );
  }

  /** Connect this output to one named Operator input. */
  public connect(input: OperatorInput): bigint {
    return BigInt(nativeCallSync(() => this.#native.connect(input._nativeHandle())));
  }

  /** Route this output to an Endpoint. */
  public send(endpoint: Endpoint, options: { input?: string } = {}): bigint {
    if (!endpoint._belongsTo(this.#session)) {
      throw new TypeError('DerivedStream and Endpoint belong to different Sessions');
    }
    return BigInt(
      nativeCallSync(() =>
        this.#native.send(endpoint._nativeHandle(), options.input),
      ),
    );
  }

  /** Send this output to one application-owned Connector. */
  public sendTo(connector: Connector): bigint {
    return this.send(this.#session.destination(connector));
  }

  /** Apply another Operator and select its output. */
  public through(
    operator: Operator,
    options: { input?: string; output?: string } = {},
  ): DerivedStream {
    return DerivedStream._create(
      this.#session,
      nativeCallSync(() =>
        this.#native.through(
          operator._nativeHandle(),
          options.input,
          options.output,
        ),
      ),
    );
  }

  /** Return generated PCM to Core as a normal source-aware Stem. */
  public reenterAudio(): Stem {
    return Stem._create(
      this.#session,
      nativeCallSync(() => this.#native.reenterAudio()),
    );
  }

  /** @internal */
  public _belongsTo(session: Session): boolean {
    return this.#session === session;
  }

  /** @internal */
  public _nativeHandle(): NativeDerivedStreamHandle {
    return this.#native;
  }
}

function stopResultFromNative(result: NativeStopResult): StopResult {
  let terminalEvent: TerminalEvent | undefined;
  for (let index = result.remainingEvents.length - 1; index >= 0; index -= 1) {
    const event = result.remainingEvents[index];
    if (event?.eventType === 'terminal') {
      const projected = _eventFromNative(event);
      if (projected.type !== 'terminal') {
        throw new PocketStationError(
          'session.invalid_stop_result',
          'Native terminal event did not project as a terminal event',
        );
      }
      terminalEvent = projected;
      break;
    }
  }
  return Object.freeze({
    success: result.success,
    alreadyStopped: result.alreadyStopped,
    disposition: terminationDisposition(result.disposition),
    sessionState: terminalSessionState(result.sessionState),
    runtimeWorkerPanicked: result.runtimeWorkerPanicked,
    captureFinalizationFailuresTotal: BigInt(
      result.captureFinalizationFailuresTotal,
    ),
    operatorFinalizationFailuresTotal: BigInt(
      result.operatorFinalizationFailuresTotal,
    ),
    endpointFinalizationFailuresTotal: BigInt(
      result.endpointFinalizationFailuresTotal,
    ),
    runtimeFailuresTotal: BigInt(result.runtimeFailuresTotal),
    lineageFailuresTotal: BigInt(result.lineageFailuresTotal),
    sourceSendRejectionsTotal: BigInt(result.sourceSendRejectionsTotal),
    runtimeEventsTotal: BigInt(result.runtimeEventsTotal),
    sidecarOutcomes: Object.freeze(
      result.sidecarOutcomes.map((snapshot) => new SidecarSnapshot(snapshot)),
    ),
    recording:
      result.recording == null
        ? undefined
        : _recordingOutcomeFromNative(result.recording),
    trace: result.trace == null ? undefined : _traceOutcomeFromNative(result.trace),
    traceError: result.traceError ?? undefined,
    terminalEvent,
    metrics:
      result.metrics == null
        ? undefined
        : _sessionMetricsFromNative(result.metrics),
    metricsUnavailableReason: result.metricsUnavailableReason ?? undefined,
  });
}

function terminationDisposition(value: string): StopResult['disposition'] {
  if (value === 'stopped' || value === 'cancelled' || value === 'already-stopped') {
    return value;
  }
  throw new PocketStationError(
    'session.invalid_stop_result',
    `Native Session returned an unknown stop disposition: ${value}`,
  );
}

function terminalSessionState(value: string): StopResult['sessionState'] {
  if (value === 'stopped' || value === 'failed') return value;
  throw new PocketStationError(
    'session.invalid_stop_result',
    `Native Session returned an unknown terminal state: ${value}`,
  );
}

/** Owns a started native Session until it is stopped or cancelled. */
export class RunningSession implements AsyncDisposable {
  readonly #native: NativeRunningSessionHandle;
  /** Source-aware audio routed to the Session's Node Endpoint. */
  readonly audio: AudioStream;
  /** Lifecycle and failure events reported by the native Session. */
  readonly events: EventStream;
  #finish: Promise<StopResult> | undefined;
  readonly #signalStreams = new Map<bigint, SignalStream>();
  readonly #sidecars = new Map<bigint, SidecarConnection>();
  readonly #providers: readonly { _abort(reason?: unknown): void }[];

  private constructor(
    native: NativeRunningSessionHandle,
    providers: readonly { _abort(reason?: unknown): void }[],
  ) {
    this.#native = native;
    this.#providers = providers;
    this.audio = AudioStream._create(native);
    this.events = EventStream._create(native);
  }

  /** @internal */
  public static _create(
    native: NativeRunningSessionHandle,
    providers: readonly { _abort(reason?: unknown): void }[] = [],
  ): RunningSession {
    return new RunningSession(native, providers);
  }

  /** Native Session identity. */
  public get sessionId(): bigint {
    return BigInt(this.#native.sessionId);
  }

  /** Open the async stream declared by `Session.subscribe()`. */
  public signals(subscription: BusSubscription): SignalStream {
    if (subscription.sessionId !== this.sessionId) {
      throw new TypeError('BusSubscription belongs to a different Session');
    }
    let stream = this.#signalStreams.get(subscription.id);
    if (stream === undefined) {
      stream = SignalStream._create(this.#native, subscription);
      this.#signalStreams.set(subscription.id, stream);
    }
    return stream;
  }

  /** Read one immutable snapshot of Core-owned queues, delivery, timing, and lifecycle state. */
  public async metrics(): Promise<SessionMetrics> {
    return _sessionMetricsFromNative(
      await nativeCall(() => this.#native.metrics()),
    );
  }

  /** Access one child process registered by the same Session. */
  public sidecar(handle: SidecarHandle): SidecarConnection {
    if (handle.sessionId !== this.sessionId) {
      throw new TypeError('SidecarHandle belongs to a different Session');
    }
    let connection = this.#sidecars.get(handle.id);
    if (connection === undefined) {
      connection = new SidecarConnection(this.#native, handle);
      this.#sidecars.set(handle.id, connection);
    }
    return connection;
  }

  /** Finish accepted work and close every native resource. */
  public stop(): Promise<StopResult> {
    return this.#finishSession('stop');
  }

  /** Stop without draining pending work. */
  public cancel(): Promise<StopResult> {
    for (const provider of this.#providers) provider._abort();
    return this.#finishSession('cancel');
  }

  /** Stop the Session when used with `await using`. */
  public async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }

  #finishSession(disposition: 'stop' | 'cancel'): Promise<StopResult> {
    if (this.#finish === undefined) {
      this.#finish = nativeCall(() => this.#native[disposition]())
        .then((result) => {
          this.audio._close();
          this.events._finish(result.remainingEvents);
          for (const stream of this.#signalStreams.values()) {
            stream._finish();
          }
          for (const sidecar of this.#sidecars.values()) {
            sidecar._close();
          }
          return stopResultFromNative(result);
        })
        .catch((failure: unknown) => {
          this.#finish = undefined;
          throw failure;
        });
    }
    return this.#finish;
  }
}

/** Declares Sources, routes, and destinations before native capture starts. */
export class Session {
  #native: NativeSessionHandle;
  readonly #sampleRateHz: number;
  readonly #channels: 1 | 2;
  readonly #frameDurationMs: 10 | 20;
  readonly #connectorEndpoints = new WeakMap<Connector, Endpoint>();
  readonly #registeredConnectors = new WeakMap<Connector, RegisteredConnector>();
  readonly #registeredEndpoints = new WeakMap<EndpointProvider, RegisteredEndpoint>();
  readonly #registeredSources = new WeakSet<SourceFactory>();
  readonly #registeredOperators = new WeakSet<OperatorFactory>();
  #nextEndpointRegistration = 0;
  #nextConnectorIdentity = 0n;
  readonly #providers = new Set<{ _abort(reason?: unknown): void }>();

  /** Create a Session declaration. No capture resource is opened yet. */
  public constructor(options: SessionOptions = {}) {
    this.#sampleRateHz = options.sampleRateHz ?? 48_000;
    this.#channels = options.channels ?? 1;
    this.#frameDurationMs = options.frameDurationMs ?? 20;
    const trace = options.trace;
    if (trace !== undefined) {
      if (trace.path.trim().length === 0) {
        throw new RangeError('trace.path cannot be empty');
      }
      const capacity = trace.capacityRecords ?? 256;
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1_000_000) {
        throw new RangeError(
          'trace.capacityRecords must be an integer between 1 and 1000000',
        );
      }
    }
    this.#native = nativeCallSync(() =>
      new (nativeAddon().NativeSession)({
        sampleRateHz: options.sampleRateHz,
        channels: options.channels,
        frameDurationMs: options.frameDurationMs,
        recordingRoot: options.recordingRoot,
        tracePath: trace?.path,
        traceCapacityRecords: trace?.capacityRecords,
      }),
    );
  }

  /** @internal Create the deterministic native Session used by SDK tests. */
  public static _conformance(saturation = false): Session {
    const nativeSession = nativeAddon().NativeSession;
    if (nativeSession.conformance === undefined) {
      throw new PocketStationError(
        'session.conformance_unavailable',
        'This native build does not include conformance fixtures',
      );
    }
    const session = new Session();
    session.#native = nativeSession.conformance(saturation);
    return session;
  }

  /** Native Session identity. */
  public get id(): bigint {
    return BigInt(this.#native.id);
  }

  /** Add a Source and return its source-aware Stem. */
  public capture(source: Source): Stem {
    return Stem._create(
      this,
      nativeCallSync(() => this.#native.capture(nativeSource(source))),
    );
  }

  /** Declare one instance of an externally registered Source. */
  public source(
    source: string | SourceFactory,
    configuration: SourceConfiguration = {},
  ): SourceInstance {
    const sourceTypeId = typeof source === 'string' ? source : source.id;
    if (source instanceof SourceFactory) this.registerSource(source);
    const entries = Object.entries(configuration)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({ key, value, sensitive: false }));
    return SourceInstance._create(
      this,
      nativeCallSync(() => this.#native.source(sourceTypeId, entries)),
    );
  }

  /** Register one reusable JavaScript Source implementation. */
  public registerSource(source: SourceFactory): SourceFactory {
    if (this.#registeredSources.has(source)) return source;
    source._bind(this.id);
    nativeCallSync(() => source._register(this.#native));
    this.#registeredSources.add(source);
    this.#providers.add(source);
    return source;
  }

  /** Register one managed process to be started with this Session. */
  public registerSidecar(process: SidecarProcess): SidecarHandle {
    const id = BigInt(
      nativeCallSync(() => this.#native.registerSidecar(process._nativeSpec())),
    );
    return new SidecarHandle(id, this.id);
  }

  /**
   * Import every validated registration from one trusted native library.
   *
   * The path must be absolute. This executes native code in the current
   * process; use only libraries you trust.
   */
  public async loadNativeExtensionLibrary(
    path: string,
  ): Promise<NativeExtensionLibrary> {
    return extensionLibraryFromNative(
      await nativeCall(() => this.#native.loadNativeExtensionLibrary(path)),
    );
  }

  /** Add a named input for float32 PCM already owned by this application. */
  public audioInput(name: string, options: AudioInputOptions = {}): AudioInput {
    if (name.trim().length === 0) {
      throw new AudioInputConfigurationError('audio input name cannot be empty');
    }
    const sampleRateHz = options.sampleRateHz ?? this.#sampleRateHz;
    const config = {
      name,
      sampleRateHz,
      channels: options.channels ?? this.#channels,
      capacityFrames: options.capacityFrames ?? 8,
      frameSamplesPerChannel:
        options.frameSamplesPerChannel ??
        (sampleRateHz * this.#frameDurationMs) / 1_000,
    } as const;
    let native: NativeAudioInputHandle;
    try {
      native = nativeCallSync(() =>
        this.#native.audioInput(
          config.sampleRateHz,
          config.channels,
          config.capacityFrames,
          config.frameSamplesPerChannel,
        ),
      );
    } catch (failure) {
      throw _audioInputFailure(failure);
    }
    return AudioInput._create(this, native, config);
  }

  /** Add bounded application-owned JSON events as one typed Source. */
  public eventInput(name: string, options: EventInputOptions = {}): EventInput {
    return new EventInput(this, name, options);
  }

  /** Add an Endpoint that exposes audio to the Node process. */
  public audio(route?: RouteSettings): Endpoint {
    return Endpoint._create(
      this,
      nativeCallSync(() =>
        route === undefined
          ? this.#native.audio()
          : this.#native.audioWithRoute(route._nativeHandle()),
      ),
    );
  }

  /** Publish one or more named audio buses through one native Relay connection. */
  public relay(options: RelayPublisherOptions): RelayPublisher {
    validateRelayPublisherOptions(options);
    return RelayPublisher._create(this, options);
  }

  /**
   * Compose bounded provider-neutral voice work over this Session draft.
   *
   * Capture, routing, recording, and generated-audio ingestion remain owned by
   * the native Session. The returned object owns only provider and turn state.
   */
  public conversation<TInput>(
    options: Omit<
      ConversationDeclarationOptions<
        Session,
        TInput,
        BusSubscription,
        AudioInputSamples,
        SignalEnvelope,
        RunningSession
      >,
      'session'
    >,
  ): Conversation<BusSubscription, AudioInputSamples, SignalEnvelope> {
    return declareConversation({ ...options, session: this });
  }

  /** @internal */
  public _relayAudio(options: RelayPublisherOptions, busId: string): Endpoint {
    const nativeOptions: NativeRelayDestinationOptions = {
      url: options.url,
      sessionId: options.sessionId,
      sourceToken: options.sourceToken,
      busId,
      lowLatency: options.lowLatency,
      startupTimeoutMs: options.startupTimeoutMs,
      iceServers: options.iceServers?.map((server) => ({
        urls: typeof server.urls === 'string' ? [server.urls] : [...server.urls],
      })),
    };
    return Endpoint._create(
      this,
      nativeCallSync(() => this.#native.relayAudio(nativeOptions)),
    );
  }

  /** Declare one destination implemented by application-owned JavaScript. */
  public destination(connector: Connector, options: { configuration?: ConnectorConfigurationInput; routeSettings?: RouteSettings } = {}): Endpoint {
    const existing = this.#connectorEndpoints.get(connector);
    if (existing !== undefined) {
      if (options.configuration !== undefined || options.routeSettings !== undefined) throw new TypeError('A cached Connector destination cannot be redeclared with different options; use registerConnector().declare()');
      return existing;
    }
    if (connector._isAdvanced()) {
      const endpoint = this.registerConnector(connector).declare(options.configuration, { routeSettings: options.routeSettings });
      this.#connectorEndpoints.set(connector, endpoint);
      return endpoint;
    }
    if (options.configuration !== undefined) throw new TypeError('Concise Connectors do not accept configuration');
    connector._bind(this.id, this.#allocateConnectorIdentity());
    const endpoint = Endpoint._create(
      this,
      nativeCallSync(() =>
        this.#native.audioConnector(
          connector._dispatch,
          connector._deadline(),
          (options.routeSettings ?? RouteSettings.realtimeAudio())
            .withDelivery(
              DeliveryPolicy.realtimeAudio().withJitterBudgetMs(
                connector._capacityFrames() * this.#frameDurationMs,
              ),
            )
            ._nativeHandle(),
        ),
      ),
    );
    this.#connectorEndpoints.set(connector, endpoint);
    this.#providers.add(connector);
    return endpoint;
  }

  /** Register one reusable manifest-driven Connector with this Session draft. */
  public registerConnector(connector: Connector): RegisteredConnector {
    const existing = this.#registeredConnectors.get(connector);
    if (existing !== undefined) return existing;
    if (!connector._isAdvanced()) {
      throw new TypeError('registerConnector() requires a manifest-driven Connector');
    }
    connector._bind(this.id, this.#allocateConnectorIdentity());
    const options = connector._endpointFactoryOptions();
    const factory = new EndpointFactory(options);
    factory._bind(this.id);
    const nativeRegistered = nativeCallSync(() => this.#native.registerConnector(
      connector.manifest._nativeManifest(),
      connector.manifest.inputs.map((input) => input._nativeHandle()),
      factory._dispatch,
      options.deadlineMs,
      options.maximumBatchItems ?? 1,
      connector._usesWorker(),
    ));
    const registered = new RegisteredConnector(
      this.id,
      connector,
      (configuration, route) => Endpoint._create(
        this,
        nativeCallSync(() => this.#native.connectorEndpoint(
          nativeRegistered,
          connector.manifest.configuration._nativeEntries(configuration),
          route._nativeHandle(),
        )),
      ),
    );
    this.#registeredConnectors.set(connector, registered);
    this.#providers.add(connector);
    this.#providers.add(factory);
    return registered;
  }

  /** Register one reusable manifest-driven generic Endpoint. */
  public registerEndpoint(provider: EndpointProvider): RegisteredEndpoint {
    const existing = this.#registeredEndpoints.get(provider);
    if (existing !== undefined) return existing;
    provider._bind(this.id);
    const factory = provider._factory();
    factory._bind(this.id);
    nativeCallSync(() => factory._register(
      this.#native,
      provider.manifest.operatorId,
      {},
    ));
    const registered = new RegisteredEndpoint(
      this.id,
      provider,
      (definition, _configuration, _route) => Endpoint._create(
        this,
        nativeCallSync(() => this.#native.endpoint(definition._nativeHandle())),
      ),
    );
    this.#registeredEndpoints.set(provider, registered);
    this.#providers.add(factory);
    return registered;
  }

  #allocateConnectorIdentity(): bigint {
    this.#nextConnectorIdentity += 1n;
    return this.#nextConnectorIdentity;
  }

  /** Declare one configured Operator and select its named ports. */
  public operator(
    operator: Operator | OperatorFactory,
    configuration: Configuration = {},
  ): OperatorInstance {
    if (operator instanceof OperatorFactory) this.registerOperator(operator);
    if (!(operator instanceof OperatorFactory) && Object.keys(configuration).length !== 0) {
      throw new TypeError('Pass configuration to the Operator constructor or supply an OperatorFactory');
    }
    const declaration = operator instanceof OperatorFactory
      ? operator.configured(configuration)
      : operator;
    return OperatorInstance._create(
      this,
      nativeCallSync(() => this.#native.operator(declaration._nativeHandle())),
    );
  }

  /** Register one reusable JavaScript Operator implementation. */
  public registerOperator(operator: OperatorFactory): OperatorFactory {
    if (this.#registeredOperators.has(operator)) return operator;
    operator._bind(this.id);
    nativeCallSync(() => operator._register(this.#native));
    this.#registeredOperators.add(operator);
    this.#providers.add(operator);
    return operator;
  }

  /** Declare one native or application-owned Endpoint implementation. */
  public endpoint(
    definition: EndpointDefinition | EndpointFactory | EndpointProvider,
    configuration: Configuration | EndpointConfigurationInput = {},
  ): Endpoint {
    if (definition instanceof EndpointProvider) {
      return this.registerEndpoint(definition).declare(configuration);
    }
    if (definition instanceof EndpointFactory) {
      definition._bind(this.id);
      this.#nextEndpointRegistration += 1;
      const registrationId = `${definition.id}.endpoint.${this.#nextEndpointRegistration}`;
      const declared = nativeCallSync(() =>
        definition._register(this.#native, registrationId, configuration),
      );
      const endpoint = Endpoint._create(
        this,
        nativeCallSync(() => this.#native.endpoint(declared._nativeHandle())),
      );
      this.#providers.add(definition);
      return endpoint;
    }
    if (Object.keys(configuration).length !== 0) {
      throw new TypeError(
        'Pass configuration to EndpointDefinition or supply an EndpointFactory',
      );
    }
    return Endpoint._create(
      this,
      nativeCallSync(() => this.#native.endpoint(definition._nativeHandle())),
    );
  }

  /**
   * Declare a typed output for consumption after this Session starts.
   *
   * The subscription does not read or start native work until `start()`.
   */
  public subscribe(
    stream: SourceOutput | DerivedStream,
    options: { signal: SignalSpec; route?: RouteSettings },
  ): BusSubscription {
    if (!stream._belongsTo(this)) {
      throw new TypeError('Signal output belongs to a different Session');
    }
    const route = options.route ?? RouteSettings.buffered();
    const native = stream instanceof SourceOutput
      ? nativeCallSync(() =>
          this.#native.subscribeSourceOutput(
            stream._nativeHandle(),
            options.signal._nativeHandle(),
            route._nativeHandle(),
          ),
        )
      : nativeCallSync(() =>
          this.#native.subscribeDerived(
            stream._nativeHandle(),
            options.signal._nativeHandle(),
            route._nativeHandle(),
          ),
        );
    return BusSubscription._create(this, native, options.signal, route);
  }

  /** Validate the declaration, open native resources, and start capture. */
  public async start(): Promise<RunningSession> {
    const result = await nativeCall(() => this.#native.start());
    if (result.failure != null) {
      throw new SessionStartError(
        result.failure.code,
        result.failure.message,
        compileDiagnosticFromNative(result.failure.diagnostic),
      );
    }
    const running = result.takeRunning();
    if (running == null) {
      throw new PocketStationError(
        'session.start_result_missing',
        'native Session start returned neither a running Session nor a failure',
      );
    }
    return RunningSession._create(running, Object.freeze([...this.#providers]));
  }

  /**
   * Run application work inside this Session's complete lifecycle.
   *
   * A successful callback drains accepted work with `stop()`. A thrown or
   * rejected callback cancels pending work before the original failure is
   * rethrown. Use `start()` when application code needs to choose shutdown
   * independently.
  */
  public async run(
    work: (running: RunningSession) => void | Promise<void>,
  ): Promise<StopResult> {
    const running = await this.start();
    try {
      await work(running);
      return await running.stop();
    } catch (cause) {
      try {
        await running.cancel();
      } catch (cleanupFailure) {
        throw new AggregateError(
          [cause, cleanupFailure],
          'Session work failed and cancellation did not complete',
        );
      }
      throw cause;
    }
  }
}

function validateRelayPublisherOptions(options: RelayPublisherOptions): void {
  for (const [name, value] of [
    ['url', options.url],
    ['sessionId', options.sessionId],
    ['sourceToken', options.sourceToken],
  ] as const) {
    if (value.trim().length === 0) {
      throw new RangeError(`Relay ${name} cannot be empty`);
    }
  }
  if (
    options.startupTimeoutMs !== undefined &&
    (!Number.isInteger(options.startupTimeoutMs) ||
      options.startupTimeoutMs < 1 ||
      options.startupTimeoutMs > 120_000)
  ) {
    throw new RangeError(
      'Relay startupTimeoutMs must be an integer between 1 and 120000',
    );
  }
}
