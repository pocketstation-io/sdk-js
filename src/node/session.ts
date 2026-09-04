import { nativeCall, nativeCallSync } from './errors.js';
import {
  nativeAddon,
  type NativeEndpointHandle,
  type NativeRunningSessionHandle,
  type NativeSessionHandle,
  type NativeStemHandle,
  type NativeStopResult,
} from './native.js';
import { Source, nativeSource } from './sources.js';
import { AudioStream } from './streams.js';
import { EventStream } from './events.js';

/** Audio format and frame cadence used by a Session. */
export interface SessionOptions {
  /** Requested sample rate in hertz. Defaults to 48,000. */
  sampleRateHz?: number;
  /** Requested channel count. Defaults to one channel. */
  channels?: 1 | 2;
  /** Frame duration in milliseconds. Defaults to 20. */
  frameDurationMs?: 10 | 20;
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
  public send(endpoint: Endpoint): bigint {
    if (!endpoint._belongsTo(this.#session)) {
      throw new TypeError('Stem and Endpoint belong to different Sessions');
    }
    return BigInt(
      nativeCallSync(() => this.#native.send(endpoint._nativeHandle())),
    );
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
        return stopResultFromNative(result);
      });
    }
    return this.#finish;
  }
}

/** Declares Sources, routes, and destinations before native capture starts. */
export class Session {
  readonly #native: NativeSessionHandle;

  /** Create a Session declaration. No capture resource is opened yet. */
  public constructor(options: SessionOptions = {}) {
    this.#native = nativeCallSync(
      () => new (nativeAddon().NativeSession)(options),
    );
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

  /** Add an Endpoint that exposes audio to the Node process. */
  public audio(): Endpoint {
    return Endpoint._create(this, nativeCallSync(() => this.#native.audio()));
  }

  /** Validate the declaration, open native resources, and start capture. */
  public async start(): Promise<RunningSession> {
    return RunningSession._create(await nativeCall(() => this.#native.start()));
  }
}
