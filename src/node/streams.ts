import { PocketStationError, nativeCall } from './errors.js';
import type {
  NativeAudioFrame,
  NativeRunningSessionHandle,
} from './native.js';

/** One PCM frame with the identity and timing assigned by the native Session. */
export interface AudioFrame {
  /** Interleaved floating-point PCM samples. */
  readonly samples: Float32Array;
  /** Sample rate in hertz. */
  readonly sampleRateHz: number;
  /** Number of interleaved audio channels. */
  readonly channelCount: number;
  /** Session that produced this frame. */
  readonly sessionId: bigint;
  /** Native audio stream identity. */
  readonly streamId: bigint;
  /** Physical, application, or generated source identity. */
  readonly sourceId: bigint;
  /** Source-aware Session stem identity. */
  readonly stemId: bigint;
  /** Native clock identity used for the media timestamp. */
  readonly clockId: number;
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
  readonly endpointId: bigint;
  /** Connector identity, or zero when no Connector supplied the frame. */
  readonly connectorId: bigint;
  /** Route that delivered the frame. */
  readonly routeId: bigint;
  /** Route enqueue time in monotonic nanoseconds. */
  readonly routeEnqueuedAtNs: bigint;
  /** Route receive time in monotonic nanoseconds. */
  readonly routeReceivedAtNs: bigint;
  /** Endpoint enqueue time in monotonic nanoseconds. */
  readonly endpointEnqueuedAtNs: bigint;
  /** Time the Node reader received the frame, in monotonic nanoseconds. */
  readonly polledAtNs: bigint;
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

/** A read stopped because its AbortSignal was aborted. */
export class StreamAbortError extends PocketStationError {
  /** Value supplied when AbortController.abort() was called. */
  public readonly reason: unknown;

  public constructor(reason?: unknown) {
    super('stream.aborted', 'Stream read was aborted', { cause: reason });
    this.name = 'AbortError';
    this.reason = reason;
  }
}

function frameFromNative(frame: NativeAudioFrame): AudioFrame {
  const samples = new Float32Array(
    frame.samplesF32Le.buffer,
    frame.samplesF32Le.byteOffset,
    frame.sampleCount,
  );
  return {
    samples,
    sampleRateHz: frame.sampleRateHz,
    channelCount: frame.channelCount,
    sessionId: BigInt(frame.sessionId),
    streamId: BigInt(frame.streamId),
    sourceId: BigInt(frame.sourceId),
    stemId: BigInt(frame.stemId),
    clockId: frame.clockId,
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
    endpointId: BigInt(frame.endpointId),
    connectorId: BigInt(frame.connectorId),
    routeId: BigInt(frame.routeId),
    routeEnqueuedAtNs: BigInt(frame.routeEnqueuedAtNs),
    routeReceivedAtNs: BigInt(frame.routeReceivedAtNs),
    endpointEnqueuedAtNs: BigInt(frame.endpointEnqueuedAtNs),
    polledAtNs: BigInt(frame.polledAtNs),
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
  #readInProgress = false;
  #closed = false;
  #pending: AudioFrame[] = [];

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

  /**
   * Read the next available frame.
   *
   * Returns `undefined` when the wait expires and `END_OF_STREAM` after the
   * Session ends and all received frames have been read.
   */
  public async read(options: StreamReadOptions = {}): Promise<AudioReadResult> {
    if (this.#activeReader || this.#readInProgress) {
      throw new PocketStationError(
        'stream.in_use',
        'Audio stream already has an active reader',
      );
    }
    this.#readInProgress = true;
    try {
      return await this.#readOnce(options);
    } finally {
      this.#readInProgress = false;
    }
  }

  /** Iterate over frames until the Session closes or the reader is aborted. */
  public async *frames(options: StreamReadOptions = {}): AsyncGenerator<AudioFrame> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
    validateTimeout(timeoutMs);
    if (timeoutMs === 0) {
      throw new RangeError('frames() requires timeoutMs to be greater than zero');
    }
    if (this.#activeReader || this.#readInProgress) {
      throw new PocketStationError(
        'stream.in_use',
        'Audio stream already has an active reader',
      );
    }
    this.#activeReader = true;
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
      this.#activeReader = false;
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

  async #readOnce(options: StreamReadOptions): Promise<AudioReadResult> {
    throwIfAborted(options.signal);
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
    validateTimeout(timeoutMs);
    const pending = this.#pending.shift();
    if (pending !== undefined) {
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
      const result = await nativeCall(() => this.#running.readAudio(nativeWaitMs));
      const frames = result.frames.map(frameFromNative);
      this.#pending.push(...frames);
      if (result.sessionState === 'stopped' || result.sessionState === 'failed') {
        this.#closed = true;
      }
      throwIfAborted(options.signal);
      const frame = this.#pending.shift();
      if (frame !== undefined) {
        return frame;
      }
      if (this.#closed) {
        return END_OF_STREAM;
      }
    }
    return undefined;
  }
}
