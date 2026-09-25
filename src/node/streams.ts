import {
  StreamError,
  StreamInUseError,
  StreamModeError,
  nativeCall,
} from './errors.js';
import {
  ClockDomainId,
  ConnectorId,
  EndpointId,
  RouteId,
  RuntimeSessionId,
  SourceId,
  StemId,
  StreamId,
  type ClockDomainOrigin,
  type ClockDomainKind,
} from './identity.js';
import type {
  NativeAudioFrame,
  NativeRunningSessionHandle,
} from './native.js';

/** Stable semantics associated with a native clock-domain identity. */
export interface ClockDomainDescriptor {
  /** Native clock-domain identity. */
  readonly id: ClockDomainId;
  /** Authority that defines the clock. */
  readonly kind: ClockDomainKind;
  /** Epoch against which timestamps are measured. */
  readonly origin: ClockDomainOrigin;
  /** Number of clock ticks per second, when Core knows it. */
  readonly tickRateHz: bigint | undefined;
}

/** One PCM frame with the identity and timing assigned by the native Session. */
export interface AudioFrame {
  /** Interleaved floating-point PCM samples. */
  readonly samples: Float32Array;
  /** Owned little-endian float32 PCM bytes. */
  readonly samplesF32le: Uint8Array;
  /** Number of interleaved float32 samples. */
  readonly sampleCount: number;
  /** Stable PCM sample representation. */
  readonly sampleFormat: 'f32le';
  /** Sample rate in hertz. */
  readonly sampleRateHz: number;
  /** Number of interleaved audio channels. */
  readonly channelCount: number;
  /** Session that produced this frame. */
  readonly sessionId: RuntimeSessionId;
  /** Native audio stream identity. */
  readonly streamId: StreamId;
  /** Physical, application, or generated source identity. */
  readonly sourceId: SourceId;
  /** Source-aware Session stem identity. */
  readonly stemId: StemId;
  /** Native clock identity used for the media timestamp. */
  readonly clockId: ClockDomainId;
  /** Semantics Core can assert for the native clock identity. */
  readonly clock: ClockDomainDescriptor;
  /** Sequence number within the stream. */
  readonly sequenceNumber: bigint;
  /** Timestamp of the first sample, in nanoseconds on the frame's clock. */
  readonly timestampStartNs: bigint;
  /** Frame duration in nanoseconds. */
  readonly durationNs: bigint;
  /** Source lifetime generation. This increases when the source is reopened. */
  readonly sourceGeneration: number;
  /** Discontinuity generation reported by the source. */
  readonly discontinuityEpoch: bigint;
  /** Permission-state generation reported by the source. */
  readonly permissionEpoch: bigint;
  /** Identity of generated output, when the frame came from generated audio. */
  readonly outputGenerationId: bigint | undefined;
  /** Endpoint that supplied this observed frame. */
  readonly endpointId: EndpointId;
  /** Connector identity, when a Connector supplied the frame. */
  readonly connectorId: ConnectorId | undefined;
  /** Route that delivered the frame. */
  readonly routeId: RouteId;
  /** Route enqueue time in monotonic nanoseconds. */
  readonly routeEnqueuedAtNs: bigint;
  /** Route receive time in monotonic nanoseconds. */
  readonly routeReceivedAtNs: bigint;
  /** Endpoint enqueue time in monotonic nanoseconds, when observed. */
  readonly endpointEnqueuedAtNs: bigint | undefined;
  /** Time the native reader received the frame, in monotonic nanoseconds. */
  readonly polledAtNs: bigint | undefined;
  /** Time the Node main thread completed the native read, in monotonic nanoseconds. */
  readonly nodeReadResolvedAtNs: bigint;
}

/** Controls one direct read or one async-iterator reader. */
export interface StreamReadOptions {
  /** Maximum native wait in milliseconds. Must be an integer from 0 through 1000. */
  timeoutMs?: number;
  /** Stops this reader without stopping the Session. */
  signal?: AbortSignal;
}

const DEFAULT_WAIT_MS = 100;
const ABORT_CHECK_INTERVAL_MS = 20;

/** Returned by a direct read after the native Session has ended. */
export class EndOfStream {
  /** Stable marker for exhaustive result handling. */
  public readonly kind = 'end-of-stream';

  private constructor() {}

  /** @internal */
  public static readonly value = new EndOfStream();
}

/** The shared result returned after a stream has ended. */
export const END_OF_STREAM = EndOfStream.value;

/** Result of one direct audio read. `undefined` means that the wait expired. */
export type AudioReadResult = AudioFrame | EndOfStream | undefined;

/** Result of one explicit batch read. `undefined` means the wait expired. */
export type AudioBatchReadResult = AudioBatch | EndOfStream | undefined;

/** One bounded batch returned by the native polled-audio endpoint. */
export class AudioBatch implements Iterable<AudioFrame> {
  readonly #frames: readonly AudioFrame[];

  private constructor(frames: readonly AudioFrame[]) {
    this.#frames = Object.freeze([...frames]);
  }

  /** @internal */
  public static _create(frames: readonly AudioFrame[]): AudioBatch {
    return new AudioBatch(frames);
  }

  /** Number of frames in this batch. */
  public get length(): number {
    return this.#frames.length;
  }

  /** Return one frame by zero-based index, with negative indexes from the end. */
  public at(index: number): AudioFrame | undefined {
    if (!Number.isInteger(index)) {
      throw new TypeError('AudioBatch index must be an integer');
    }
    return this.#frames.at(index);
  }

  /** Return a shallow, independently owned array of the batch frames. */
  public frames(): readonly AudioFrame[] {
    return Object.freeze([...this.#frames]);
  }

  /** Iterate over the frames in native delivery order. */
  public [Symbol.iterator](): Iterator<AudioFrame> {
    return this.#frames[Symbol.iterator]();
  }
}

/** A read stopped because its AbortSignal was aborted. */
export class StreamAbortError extends StreamError {
  /** Value supplied when AbortController.abort() was called. */
  public readonly reason: unknown;

  public constructor(reason?: unknown) {
    super('stream.aborted', 'Stream read was aborted', reason);
    this.name = 'AbortError';
    this.reason = reason;
  }
}

function frameFromNative(frame: NativeAudioFrame): AudioFrame {
  const samplesF32le = Uint8Array.from(frame.samplesF32Le);
  const samples = new Float32Array(
    samplesF32le.buffer,
    samplesF32le.byteOffset,
    frame.sampleCount,
  );
  const optionalConnectorId = (value: string): ConnectorId | undefined =>
    value === '0' ? undefined : ConnectorId(BigInt(value));
  return {
    samples,
    samplesF32le,
    sampleCount: frame.sampleCount,
    sampleFormat: 'f32le',
    sampleRateHz: frame.sampleRateHz,
    channelCount: frame.channelCount,
    sessionId: RuntimeSessionId(BigInt(frame.sessionId)),
    streamId: StreamId(BigInt(frame.streamId)),
    sourceId: SourceId(BigInt(frame.sourceId)),
    stemId: StemId(BigInt(frame.stemId)),
    clockId: ClockDomainId(frame.clockId),
    clock: Object.freeze({
      id: ClockDomainId(frame.clockId),
      kind: frame.clockKind as ClockDomainDescriptor['kind'],
      origin: frame.clockOrigin as ClockDomainDescriptor['origin'],
      tickRateHz:
        frame.clockTickRateHz === undefined
          ? undefined
          : BigInt(frame.clockTickRateHz),
    }),
    sequenceNumber: BigInt(frame.sequenceNumber),
    timestampStartNs: BigInt(frame.timestampStartNs),
    durationNs: BigInt(frame.durationNs),
    sourceGeneration: frame.sourceGeneration,
    discontinuityEpoch: BigInt(frame.discontinuityEpoch),
    permissionEpoch: BigInt(frame.permissionEpoch),
    outputGenerationId:
      frame.outputGenerationId === undefined
        ? undefined
        : BigInt(frame.outputGenerationId),
    endpointId: EndpointId(BigInt(frame.endpointId)),
    connectorId: optionalConnectorId(frame.connectorId),
    routeId: RouteId(BigInt(frame.routeId)),
    routeEnqueuedAtNs: BigInt(frame.routeEnqueuedAtNs),
    routeReceivedAtNs: BigInt(frame.routeReceivedAtNs),
    endpointEnqueuedAtNs:
      frame.endpointEnqueuedAtNs === '0'
        ? undefined
        : BigInt(frame.endpointEnqueuedAtNs),
    polledAtNs:
      frame.polledAtNs === '0' ? undefined : BigInt(frame.polledAtNs),
    nodeReadResolvedAtNs: BigInt(frame.nativeReadResolvedAtNs),
  };
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

/** Reads source-aware audio from a running Session. */
export class AudioStream implements AsyncIterable<AudioFrame> {
  readonly #running: NativeRunningSessionHandle;
  #activeReader = false;
  #readerMode: 'read' | 'frames' | 'batches' | undefined;
  #closed = false;
  #pendingFrames: AudioFrame[] = [];
  #pendingBatch: AudioBatch | undefined;

  private constructor(running: NativeRunningSessionHandle) {
    this.#running = running;
  }

  /** @internal */
  public static _create(running: NativeRunningSessionHandle): AudioStream {
    return new AudioStream(running);
  }

  /** Whether the native Session has reached a terminal state. */
  public get closed(): boolean {
    return this.#closed;
  }

  /** Python-parity alias for whether the native Session is terminal. */
  public get isClosed(): boolean {
    return this.#closed;
  }

  /** Permanently selected consumption mode, once reading begins. */
  public get readerMode(): 'read' | 'frames' | 'batches' | undefined {
    return this.#readerMode;
  }

  /**
   * Read the next available frame.
   *
   * Returns `undefined` when the wait expires and `END_OF_STREAM` after the
   * Session ends and all received frames have been read.
   */
  public async read(options: StreamReadOptions = {}): Promise<AudioReadResult> {
    const release = this.#claim('read');
    try {
      return await this.#readFrame(options);
    } finally {
      release();
    }
  }

  /** Read one native batch immediately; empty and end-of-stream both return undefined. */
  public async pollBatch(
    options: Omit<StreamReadOptions, 'timeoutMs'> = {},
  ): Promise<AudioBatch | undefined> {
    const release = this.#claim('batches');
    try {
      const result = await this.#readBatchOnce({ ...options, timeoutMs: 0 });
      return result instanceof EndOfStream ? undefined : result;
    } finally {
      release();
    }
  }

  /** Read one native batch immediately with distinct empty and EOF outcomes. */
  public async poll(
    options: Omit<StreamReadOptions, 'timeoutMs'> = {},
  ): Promise<AudioBatchReadResult> {
    const release = this.#claim('batches');
    try {
      return await this.#readBatchOnce({ ...options, timeoutMs: 0 });
    } finally {
      release();
    }
  }

  /** Wait for one native batch; timeout and end-of-stream both return undefined. */
  public async readBatch(
    options: StreamReadOptions = {},
  ): Promise<AudioBatch | undefined> {
    const release = this.#claim('batches');
    try {
      const result = await this.#readBatchOnce(options);
      return result instanceof EndOfStream ? undefined : result;
    } finally {
      release();
    }
  }

  /** Wait for one native batch with distinct timeout and EOF outcomes. */
  public async readResult(
    options: StreamReadOptions = {},
  ): Promise<AudioBatchReadResult> {
    const release = this.#claim('batches');
    try {
      return await this.#readBatchOnce(options);
    } finally {
      release();
    }
  }

  /** Iterate over frames until the Session closes or the reader is aborted. */
  public async *frames(options: StreamReadOptions = {}): AsyncGenerator<AudioFrame> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
    validateTimeout(timeoutMs);
    if (timeoutMs === 0) {
      throw new RangeError('frames() requires timeoutMs to be greater than zero');
    }
    const release = this.#claim('frames');
    try {
      while (true) {
        const result = await this.#readFrame(options);
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

  /** Iterate over native-owned batches without creating an unbounded JS queue. */
  public async *batches(
    options: StreamReadOptions = {},
  ): AsyncGenerator<AudioBatch> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
    validateTimeout(timeoutMs);
    if (timeoutMs === 0) {
      throw new RangeError('batches() requires timeoutMs to be greater than zero');
    }
    const release = this.#claim('batches');
    try {
      while (true) {
        const result = await this.#readBatchOnce(options);
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
  public [Symbol.asyncIterator](): AsyncGenerator<AudioFrame> {
    return this.frames();
  }

  /** @internal */
  public _close(): void {
    this.#closed = true;
  }

  #claim(mode: 'read' | 'frames' | 'batches'): () => void {
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

  async #readFrame(options: StreamReadOptions): Promise<AudioReadResult> {
    throwIfAborted(options.signal);
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
    validateTimeout(timeoutMs);
    const pending = this.#pendingFrames.shift();
    if (pending !== undefined) {
      return pending;
    }
    if (this.#closed) {
      return END_OF_STREAM;
    }

    const batch = await this.#waitNativeBatch(options);
    if (batch !== undefined) {
      this.#pendingFrames.push(...batch);
    }
    throwIfAborted(options.signal);
    const frame = this.#pendingFrames.shift();
    if (frame !== undefined) {
      return frame;
    }
    return this.#closed ? END_OF_STREAM : undefined;
  }

  async #readBatchOnce(
    options: StreamReadOptions,
  ): Promise<AudioBatchReadResult> {
    throwIfAborted(options.signal);
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
    validateTimeout(timeoutMs);
    const pending = this.#pendingBatch;
    if (pending !== undefined) {
      this.#pendingBatch = undefined;
      return pending;
    }
    if (this.#closed) {
      return END_OF_STREAM;
    }
    const batch = await this.#waitNativeBatch(options);
    this.#pendingBatch = batch;
    throwIfAborted(options.signal);
    if (this.#pendingBatch !== undefined) {
      const ready = this.#pendingBatch;
      this.#pendingBatch = undefined;
      return ready;
    }
    return this.#closed ? END_OF_STREAM : undefined;
  }

  async #waitNativeBatch(
    options: StreamReadOptions,
  ): Promise<AudioBatch | undefined> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;

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
      const result = await nativeCall(() => this.#running.readAudio(nativeWaitMs));
      const resolvedAtNs = this.#running.monotonicTimestampNs();
      for (const frame of result.frames) {
        frame.nativeReadResolvedAtNs = resolvedAtNs;
      }
      const frames = result.frames.map(frameFromNative);
      if (result.sessionState === 'stopped' || result.sessionState === 'failed') {
        this.#closed = true;
      }
      if (frames.length > 0) {
        return AudioBatch._create(frames);
      }
      if (this.#closed) {
        return undefined;
      }
    }
    return undefined;
  }
}
