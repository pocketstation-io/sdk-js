import {
  StreamError,
  StreamInUseError,
  StreamModeError,
  nativeCall,
  nativeCallSync,
} from './errors.js';
import { RouteSettings, SignalSpec, type SignalKind } from './graph.js';
import {
  ClockDomainId,
  ConnectorId,
  RouteId,
  RuntimeSessionId,
  SourceId,
  StreamId,
} from './identity.js';
import type {
  NativeBusSubscriptionHandle,
  NativeRunningSessionHandle,
  NativeSignalEnvelope,
  NativeSignalLineage,
  NativeSignalTiming,
} from './native.js';
import type { Session } from './session.js';
import {
  END_OF_STREAM,
  EndOfStream,
  StreamAbortError,
  type ClockDomainDescriptor,
  type StreamReadOptions,
} from './streams.js';

const DEFAULT_WAIT_MS = 100;
const ABORT_CHECK_INTERVAL_MS = 20;

/** Timing recorded for one value emitted by an Operator or Source. */
export interface SignalTiming {
  /** Timestamp assigned by the original Source, in nanoseconds. */
  readonly sourceTimestampNs?: bigint;
  /** Monotonic time at which Core observed the value, in nanoseconds. */
  readonly observedTimestampNs: bigint;
  /** Timestamp translated to the Session clock, in nanoseconds. */
  readonly sessionTimestampNs?: bigint;
  /** Media duration represented by this value, in nanoseconds. */
  readonly durationNs?: bigint;
}

/** Source and stream identity retained while a value moves through Operators. */
export interface SignalLineage {
  /** Session that owns the value. */
  readonly sessionId: RuntimeSessionId;
  /** Source stream retained through each Operator. */
  readonly streamId: StreamId;
  /** Original Source that produced the value. */
  readonly sourceId: SourceId;
  /** Native clock used by source timestamps. */
  readonly clockId: ClockDomainId;
  /** Stable semantics associated with the native clock identity. */
  readonly clock: ClockDomainDescriptor;
  /** Position of this value within the source stream. */
  readonly sequenceNumber: bigint;
  /** Source lifetime that produced this value. */
  readonly sourceGeneration: number;
  /** Increases after a known break in media continuity. */
  readonly discontinuityEpoch: bigint;
  /** Permission or routing policy version active for this value. */
  readonly policyEpoch: bigint;
}

/** Operator invocation that produced a derived value. */
export interface SignalDerivation {
  /** Identity retained from the Operator input. */
  readonly upstreamLineage: SignalLineage;
  /** Timing retained from the Operator input. */
  readonly upstreamTiming: SignalTiming;
  /** Stable identifier of the Operator implementation. */
  readonly operatorId: string;
  /** Declared Operator implementation revision. */
  readonly operatorRevision: number;
  /** Lifetime of the running Operator instance. */
  readonly operatorGeneration: number;
  /** Connector that produced the value, when applicable. */
  readonly connectorId?: ConnectorId;
}

/** Owned interleaved float32 PCM carried by a typed signal. */
export interface SignalAudioPayload {
  /** Discriminant used for exhaustive payload handling. */
  readonly kind: 'audio';
  /** Owned little-endian float32 PCM bytes. */
  readonly samplesF32le: Uint8Array;
  /** Number of interleaved float32 samples. */
  readonly sampleCount: number;
  /** Stable PCM sample representation. */
  readonly sampleFormat: 'f32le';
  /** Interleaved floating-point PCM samples. */
  readonly samples: Float32Array;
  /** Sample rate in hertz. */
  readonly sampleRateHz: number;
  /** Number of interleaved channels. */
  readonly channelCount: number;
  /** Source stream carried by this audio value. */
  readonly streamId: StreamId;
  /** Original Source carried by this audio value. */
  readonly sourceId: SourceId;
  /** Position of this value within its stream. */
  readonly sequenceNumber: bigint;
  /** First-sample timestamp in nanoseconds. */
  readonly timestampNs: bigint;
}

/** @deprecated Use `SignalAudioPayload`. */
export interface AudioSignalPayload extends SignalAudioPayload {}

/** Text carried by a typed signal. */
export interface TextSignalPayload {
  /** Discriminant used for exhaustive payload handling. */
  readonly kind: 'text';
  /** Decoded text emitted by the Source or Operator. */
  readonly text: string;
}

/** Encoded or package-defined bytes carried by a typed signal. */
export interface BytesSignalPayload {
  /** Discriminant used for exhaustive payload handling. */
  readonly kind: 'bytes';
  /** Owned byte snapshot copied from the native envelope. */
  readonly data: Uint8Array;
}

/** Value carried by one typed signal envelope. */
export type SignalPayload =
  | SignalAudioPayload
  | TextSignalPayload
  | BytesSignalPayload;

/** One typed value with its timing, identity, and derivation. */
export interface SignalEnvelope {
  /** Signal identity and wire format carried by this value. */
  readonly signal: SignalSpec;
  /** Source and Session timing retained by Core. */
  readonly timing: SignalTiming;
  /** Source identity, when the producer supplied it. */
  readonly lineage?: SignalLineage;
  /** Operator that produced this value, when it is derived. */
  readonly derivation?: SignalDerivation;
  /** Audio, text, or bytes carried by the envelope. */
  readonly payload: SignalPayload;
}

/** Current queue state and delivery totals for one subscription. */
export interface SignalSubscriptionMetrics {
  /** Maximum number of queued signals. */
  readonly capacitySignals: bigint;
  /** Maximum bytes accepted in one payload. */
  readonly maxPayloadBytes: bigint;
  /** Maximum payload bytes that the complete queue can retain. */
  readonly maximumBufferedPayloadBytes: bigint;
  /** Signals waiting to be read now. */
  readonly depthSignals: bigint;
  /** Highest observed queue depth. */
  readonly peakDepthSignals: bigint;
  /** Signals accepted by the route. */
  readonly enqueuedTotal: bigint;
  /** Signals returned to JavaScript. */
  readonly receivedTotal: bigint;
  /** Signals rejected or discarded under the selected delivery policy. */
  readonly droppedTotal: bigint;
}

/** A typed signal output declared for later consumption. */
export class BusSubscription {
  readonly #session: Session;
  readonly #native: NativeBusSubscriptionHandle;
  /** Signal accepted by this subscription. */
  public readonly signal: SignalSpec;
  /** Delivery and media settings used by its route. */
  public readonly route: RouteSettings;

  private constructor(
    session: Session,
    native: NativeBusSubscriptionHandle,
    signal: SignalSpec,
    route: RouteSettings,
  ) {
    this.#session = session;
    this.#native = native;
    this.signal = signal;
    this.route = route;
  }

  /** @internal */
  public static _create(
    session: Session,
    native: NativeBusSubscriptionHandle,
    signal: SignalSpec,
    route: RouteSettings,
  ): BusSubscription {
    return new BusSubscription(session, native, signal, route);
  }

  /** Session-local subscription identity. */
  public get id(): bigint {
    return BigInt(this.#native.id);
  }

  /** Session that owns this subscription. */
  public get sessionId(): RuntimeSessionId {
    return RuntimeSessionId(BigInt(this.#native.sessionId));
  }

  /** Core route that supplies this subscription. */
  public get routeId(): RouteId {
    return RouteId(BigInt(this.#native.routeId));
  }

  /** Canonical delivery and media settings used by this route. */
  public get routeSettings(): RouteSettings {
    return this.route;
  }

  /** @internal */
  public _belongsTo(session: Session): boolean {
    return this.#session === session;
  }

  /** @internal */
  public _nativeHandle(): NativeBusSubscriptionHandle {
    return this.#native;
  }
}

/** Result of one signal read. `undefined` means that the wait expired. */
export type SignalReadResult = SignalEnvelope | EndOfStream | undefined;

/** Python-compatible name for the shared end-of-stream result. */
export const STREAM_EOF = END_OF_STREAM;

/** Reads one declared signal output from a running Session. */
export class SignalStream
  implements AsyncIterable<SignalEnvelope>, Disposable
{
  readonly #running: NativeRunningSessionHandle;
  readonly #subscription: BusSubscription;
  #activeReader = false;
  #readerMode: 'signal_read' | 'signals' | undefined;
  #closed = false;
  #pending: SignalEnvelope | undefined;

  private constructor(
    running: NativeRunningSessionHandle,
    subscription: BusSubscription,
  ) {
    this.#running = running;
    this.#subscription = subscription;
  }

  /** @internal */
  public static _create(
    running: NativeRunningSessionHandle,
    subscription: BusSubscription,
  ): SignalStream {
    return new SignalStream(running, subscription);
  }

  /** Whether this subscription can return another value. */
  public get closed(): boolean {
    return this.#closed;
  }

  /** Python-parity alias for whether this subscription is terminal. */
  public get isClosed(): boolean {
    return this.#closed;
  }

  /** Permanently selected consumption mode, once reading begins. */
  public get readerMode(): 'signal_read' | 'signals' | undefined {
    return this.#readerMode;
  }

  /** Read immediately with distinct empty and end-of-stream outcomes. */
  public async poll(
    options: Omit<StreamReadOptions, 'timeoutMs'> = {},
  ): Promise<SignalReadResult> {
    const release = this.#claim('signal_read');
    try {
      return await this.#readOnce({ ...options, timeoutMs: 0 });
    } finally {
      release();
    }
  }

  /** Read one value, wait for the selected duration, or observe end-of-stream. */
  public async read(options: StreamReadOptions = {}): Promise<SignalReadResult> {
    const release = this.#claim('signal_read');
    try {
      return await this.#readOnce(options);
    } finally {
      release();
    }
  }

  /** Iterate until this subscription or its Session closes. */
  public async *values(
    options: StreamReadOptions = {},
  ): AsyncGenerator<SignalEnvelope> {
    yield* this.iterSignals(options);
  }

  /** Python-parity name for iterating until this subscription closes. */
  public async *iterSignals(
    options: StreamReadOptions = {},
  ): AsyncGenerator<SignalEnvelope> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
    validateTimeout(timeoutMs);
    if (timeoutMs === 0) {
      throw new RangeError('values() requires timeoutMs to be greater than zero');
    }
    const release = this.#claim('signals');
    try {
      while (true) {
        const result = await this.#readOnce(options);
        if (result instanceof EndOfStream) {
          return;
        }
        if (result !== undefined) {
          yield result;
        }
      }
    } finally {
      release();
    }
  }

  /** Iterate with the default read options. */
  public [Symbol.asyncIterator](): AsyncGenerator<SignalEnvelope> {
    return this.iterSignals();
  }

  /** Stop this subscription without stopping the Session. */
  public close(): void {
    if (!this.#closed) {
      nativeCallSync(() =>
        this.#running.closeSignal(this.#subscription._nativeHandle()),
      );
      this.#closed = true;
    }
  }

  /** Async close form matching Python's asyncio stream surface. */
  public async aclose(): Promise<void> {
    this.close();
  }

  /** Read current queue and delivery totals from Core. */
  public async metrics(): Promise<SignalSubscriptionMetrics> {
    const value = await nativeCall(() =>
      this.#running.signalMetrics(this.#subscription._nativeHandle()),
    );
    return {
      capacitySignals: BigInt(value.capacitySignals),
      maxPayloadBytes: BigInt(value.maxPayloadBytes),
      maximumBufferedPayloadBytes: BigInt(value.maximumBufferedPayloadBytes),
      depthSignals: BigInt(value.depthSignals),
      peakDepthSignals: BigInt(value.peakDepthSignals),
      enqueuedTotal: BigInt(value.enqueuedTotal),
      receivedTotal: BigInt(value.receivedTotal),
      droppedTotal: BigInt(value.droppedTotal),
    };
  }

  /** Close this subscription when used with `using`. */
  public [Symbol.dispose](): void {
    this.close();
  }

  /** @internal */
  public _finish(): void {
    this.#closed = true;
  }

  #claim(mode: 'signal_read' | 'signals'): () => void {
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

  async #readOnce(options: StreamReadOptions): Promise<SignalReadResult> {
    throwIfAborted(options.signal);
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
    validateTimeout(timeoutMs);
    const pending = this.#pending;
    if (pending !== undefined) {
      this.#pending = undefined;
      return pending;
    }
    if (this.#closed) {
      return END_OF_STREAM;
    }
    const deadline = performance.now() + timeoutMs;
    let firstRead = true;
    while (firstRead || performance.now() < deadline) {
      firstRead = false;
      throwIfAborted(options.signal);
      const remainingMs = Math.max(0, Math.ceil(deadline - performance.now()));
      const nativeWaitMs =
        timeoutMs === 0
          ? 0
          : Math.min(ABORT_CHECK_INTERVAL_MS, remainingMs);
      const result = await nativeCall(() =>
        this.#running.readSignal(
          this.#subscription._nativeHandle(),
          nativeWaitMs,
        ),
      );
      switch (result.status) {
        case 'item':
          if (result.envelope == null) {
            throw new StreamError(
              'stream.invalid_read',
              'Native signal read returned no envelope',
            );
          }
          this.#pending = _envelopeFromNative(result.envelope);
          throwIfAborted(options.signal);
          {
            const ready = this.#pending;
            this.#pending = undefined;
            return ready;
          }
        case 'closed':
          throwIfAborted(options.signal);
          this.#closed = true;
          return END_OF_STREAM;
        case 'fault':
          throwIfAborted(options.signal);
          this.#closed = true;
          throw new StreamError(
            'stream.fault',
            result.error ?? 'Native signal subscription failed',
          );
        case 'empty':
          throwIfAborted(options.signal);
          break;
        default:
          throwIfAborted(options.signal);
          throw new StreamError(
            'stream.invalid_read',
            `Native signal read returned unknown status ${JSON.stringify(result.status)}`,
          );
      }
    }
    return undefined;
  }
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 1_000) {
    throw new RangeError('timeoutMs must be an integer between 0 and 1000');
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new StreamAbortError(signal.reason);
  }
}

function timingFromNative(value: NativeSignalTiming): SignalTiming {
  return {
    sourceTimestampNs:
      value.sourceTimestampNs == null
        ? undefined
        : BigInt(value.sourceTimestampNs),
    observedTimestampNs: BigInt(value.observedTimestampNs),
    sessionTimestampNs:
      value.sessionTimestampNs == null
        ? undefined
        : BigInt(value.sessionTimestampNs),
    durationNs:
      value.durationNs == null ? undefined : BigInt(value.durationNs),
  };
}

function lineageFromNative(value: NativeSignalLineage): SignalLineage {
  const clockId = ClockDomainId(value.clockId);
  return {
    sessionId: RuntimeSessionId(BigInt(value.sessionId)),
    streamId: StreamId(BigInt(value.streamId)),
    sourceId: SourceId(BigInt(value.sourceId)),
    clockId,
    clock: Object.freeze({
      id: clockId,
      kind: value.clockKind as ClockDomainDescriptor['kind'],
      origin: value.clockOrigin as ClockDomainDescriptor['origin'],
      tickRateHz:
        value.clockTickRateHz == null ? undefined : BigInt(value.clockTickRateHz),
    }),
    sequenceNumber: BigInt(value.sequenceNumber),
    sourceGeneration: value.sourceGeneration,
    discontinuityEpoch: BigInt(value.discontinuityEpoch),
    policyEpoch: BigInt(value.policyEpoch),
  };
}

/** @internal */
export function _envelopeFromNative(value: NativeSignalEnvelope): SignalEnvelope {
  const signal = SignalSpec._fromDescription({
    kind: value.signalKind as SignalKind,
    format: value.signalFormat ?? undefined,
    customId: value.signalCustomId ?? undefined,
    role: value.signalRole ?? undefined,
    schema: value.signalSchema ?? undefined,
  });
  if (signal.wireId !== value.signalWireId) {
    throw new StreamError(
      'stream.invalid_read',
      'Native signal description does not match its wire identity',
    );
  }
  const lineage = value.lineage == null
    ? undefined
    : lineageFromNative(value.lineage);
  const derivation = value.derivation == null
    ? undefined
    : {
        upstreamLineage: lineageFromNative(value.derivation.upstreamLineage),
        upstreamTiming: timingFromNative(value.derivation.upstreamTiming),
        operatorId: value.derivation.operatorId,
        operatorRevision: value.derivation.operatorRevision,
        operatorGeneration: value.derivation.operatorGeneration,
        connectorId:
          value.derivation.connectorId == null
            ? undefined
            : ConnectorId(BigInt(value.derivation.connectorId)),
      };
  return {
    signal,
    timing: timingFromNative(value.timing),
    lineage,
    derivation,
    payload: payloadFromNative(value),
  };
}

function payloadFromNative(value: NativeSignalEnvelope): SignalPayload {
  switch (value.payloadKind) {
    case 'text':
      if (value.text == null) {
        break;
      }
      return { kind: 'text', text: value.text };
    case 'bytes':
      if (value.bytes == null) {
        break;
      }
      return { kind: 'bytes', data: value.bytes };
    case 'audio':
      if (value.audio == null) {
        break;
      }
      const samplesF32le = Uint8Array.from(value.audio.samplesF32Le);
      return {
        kind: 'audio',
        samplesF32le,
        sampleCount: value.audio.sampleCount,
        sampleFormat: 'f32le',
        samples: new Float32Array(
          samplesF32le.buffer,
          samplesF32le.byteOffset,
          value.audio.sampleCount,
        ),
        sampleRateHz: value.audio.sampleRateHz,
        channelCount: value.audio.channelCount,
        streamId: StreamId(BigInt(value.audio.streamId)),
        sourceId: SourceId(BigInt(value.audio.sourceId)),
        sequenceNumber: BigInt(value.audio.sequenceNumber),
        timestampNs: BigInt(value.audio.timestampNs),
      };
  }
  throw new StreamError(
    'stream.invalid_read',
    `Native ${JSON.stringify(value.payloadKind)} signal has no matching payload`,
  );
}
