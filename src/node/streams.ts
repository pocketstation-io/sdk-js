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
export interface AudioReadOptions {
  /** Maximum native wait in milliseconds. Must be an integer from 0 through 1000. */
  timeoutMs?: number;
  /** Stops this reader without stopping the Session. */
  signal?: AbortSignal;
}

const DEFAULT_WAIT_MS = 100;

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

  /** Read the next available frame, or `undefined` when the wait expires. */
  public async read(options: AudioReadOptions = {}): Promise<AudioFrame | undefined> {
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
  public async *frames(options: AudioReadOptions = {}): AsyncGenerator<AudioFrame> {
    if (this.#activeReader || this.#readInProgress) {
      throw new PocketStationError(
        'stream.in_use',
        'Audio stream already has an active reader',
      );
    }
    this.#activeReader = true;
    try {
      while (!this.#closed || this.#pending.length > 0) {
        if (options.signal?.aborted === true) {
          throw options.signal.reason;
        }
        const frame = await this.#readOnce(options);
        if (frame !== undefined) {
          yield frame;
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
    this.#pending = [];
  }

  async #readOnce(options: AudioReadOptions): Promise<AudioFrame | undefined> {
    options.signal?.throwIfAborted();
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
    validateTimeout(timeoutMs);
    const pending = this.#pending.shift();
    if (pending !== undefined) {
      return pending;
    }
    if (this.#closed) {
      return undefined;
    }
    const result = await nativeCall(() => this.#running.readAudio(timeoutMs));
    const frames = result.frames.map(frameFromNative);
    this.#pending.push(...frames);
    if (result.sessionState === 'stopped' || result.sessionState === 'failed') {
      this.#closed = true;
    }
    options.signal?.throwIfAborted();
    return this.#pending.shift();
  }
}
