import { nativeCall, nativeCallSync } from './errors.js';
import {
  type NativeAudioInputHandle,
  nativeAddon,
  type NativeDerivedStreamHandle,
  type NativeCompileDiagnostic,
  type NativeEndpointHandle,
  type NativeOperatorInputHandle,
  type NativeOperatorInstanceHandle,
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
} from './application-audio.js';
import { PocketStationError } from '../errors.js';
import {
  EndpointDefinition,
  Operator,
  RouteSettings,
  SignalSpec,
} from './graph.js';
import { Source, nativeSource } from './sources.js';
import { AudioStream } from './streams.js';
import { EventStream } from './events.js';
import { BusSubscription, SignalStream } from './signals.js';
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

/** Startup failure reported by the native Session owner. */
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

  /** @internal */
  public _belongsTo(session: Session): boolean {
    return this.#session === session;
  }

  /** @internal */
  public _nativeHandle(): NativeEndpointHandle {
    return this.#native;
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
    return BigInt(
      nativeCallSync(() =>
        this.#native.send(endpoint._nativeHandle(), options.input),
      ),
    );
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
    return Endpoint._create(
      this.#session,
      nativeCallSync(() => this.#native.record(name)),
    );
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
  return {
    success: result.success,
    alreadyStopped: result.alreadyStopped,
    disposition: result.disposition as StopResult['disposition'],
    sessionState: result.sessionState as StopResult['sessionState'],
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
  };
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

  private constructor(native: NativeRunningSessionHandle) {
    this.#native = native;
    this.audio = AudioStream._create(native);
    this.events = EventStream._create(native);
  }

  /** @internal */
  public static _create(native: NativeRunningSessionHandle): RunningSession {
    return new RunningSession(native);
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
    return this.#finishSession('cancel');
  }

  /** Stop the Session when used with `await using`. */
  public async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }

  #finishSession(disposition: 'stop' | 'cancel'): Promise<StopResult> {
    if (this.#finish === undefined) {
      this.#finish = nativeCall(() => this.#native[disposition]()).then((result) => {
        this.audio._close();
        this.events._finish(result.remainingEvents);
        for (const stream of this.#signalStreams.values()) {
          stream._finish();
        }
        for (const sidecar of this.#sidecars.values()) {
          sidecar._close();
        }
        return stopResultFromNative(result);
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

  /** Create a Session declaration. No capture resource is opened yet. */
  public constructor(options: SessionOptions = {}) {
    this.#sampleRateHz = options.sampleRateHz ?? 48_000;
    this.#channels = options.channels ?? 1;
    this.#native = nativeCallSync(
      () => new (nativeAddon().NativeSession)(options),
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
    sourceTypeId: string,
    configuration: SourceConfiguration = {},
  ): SourceInstance {
    const entries = Object.entries(configuration)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({ key, value, sensitive: false }));
    return SourceInstance._create(
      this,
      nativeCallSync(() => this.#native.source(sourceTypeId, entries)),
    );
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
    const config = {
      name,
      sampleRateHz: options.sampleRateHz ?? this.#sampleRateHz,
      channels: options.channels ?? this.#channels,
      capacityFrames: options.capacityFrames ?? 8,
      frameSamplesPerChannel: options.frameSamplesPerChannel ?? 480,
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

  /** Declare one configured Operator and select its named ports. */
  public operator(operator: Operator): OperatorInstance {
    return OperatorInstance._create(
      this,
      nativeCallSync(() => this.#native.operator(operator._nativeHandle())),
    );
  }

  /** Declare one native Endpoint implementation. */
  public endpoint(definition: EndpointDefinition): Endpoint {
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
    return RunningSession._create(running);
  }
}
