import { Buffer } from 'node:buffer';
import { setTimeout as wait } from 'node:timers/promises';

import { PocketStationError } from '../errors.js';
import { nativeCallSync } from './errors.js';
import type {
  NativeAudioInputHandle,
  NativeAudioInputObservations,
  NativeOutputGenerationHandle,
} from './native.js';
import { SourceOutput, type Session } from './session.js';

/** Configuration for PCM supplied by the application. */
export interface AudioInputOptions {
  /** Sample rate in hertz. Defaults to the Session sample rate. */
  sampleRateHz?: number;
  /** Number of interleaved channels. Defaults to the Session channel count. */
  channels?: 1 | 2;
  /** Number of complete frames that may wait for Core. Defaults to eight. */
  capacityFrames?: number;
  /** Samples per channel in each write. Defaults to 480. */
  frameSamplesPerChannel?: number;
}

/** Resolved configuration of one AudioInput. */
export interface AudioInputConfig {
  /** Application label for this input. */
  readonly name: string;
  /** Sample rate in hertz. */
  readonly sampleRateHz: number;
  /** Number of interleaved channels. */
  readonly channels: 1 | 2;
  /** Maximum number of complete frames waiting for Core. */
  readonly capacityFrames: number;
  /** Required samples per channel in each write. */
  readonly frameSamplesPerChannel: number;
}

/** Options for one immediate PCM write. */
export interface AudioInputTryWriteOptions {
  /** Mark this frame as the first frame after missing or intentionally skipped media. */
  discontinuity?: boolean;
  /** Attach this frame to replaceable output created by this AudioInput. */
  output?: OutputGeneration;
}

/** Options for one finite wait for Core capacity. */
export interface AudioInputWriteOptions extends AudioInputTryWriteOptions {
  /** Maximum wait in milliseconds. Defaults to 1,000; maximum 60,000. */
  timeoutMs?: number;
  /** Stops this wait without closing the AudioInput or Session. */
  signal?: AbortSignal;
}

/** Current capacity and lifecycle state reported by Core. */
export interface AudioInputObservations {
  /** Configured number of frames that may wait for Core. */
  readonly capacityFrames: bigint;
  /** Preallocated frame slots, including the producer's working slot. */
  readonly bufferSlots: bigint;
  /** Frame slots currently available to the producer. */
  readonly availableBuffers: bigint;
  /** Frames accepted since this input was created. */
  readonly acceptedTotal: bigint;
  /** Writes rejected because Core had no capacity. */
  readonly fullTotal: bigint;
  /** Writes rejected because their frame shape was invalid. */
  readonly invalidTotal: bigint;
  /** Writes rejected because their output was no longer active. */
  readonly cancelledOutputWritesTotal: bigint;
  /** Whether the owning Session was cancelled. */
  readonly cancelled: boolean;
  /** Whether this input no longer accepts writes. */
  readonly closed: boolean;
}

/** Base class for application-audio write failures. */
export class AudioInputError extends PocketStationError {
  /** Create a typed application-audio failure. */
  public constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(code, message, options);
    this.name = 'AudioInputError';
  }
}

/** An AudioInput name, format, frame size, or capacity is invalid. */
export class AudioInputConfigurationError extends AudioInputError {
  /** Create an invalid-configuration failure. */
  public constructor(message: string, options?: { cause?: unknown }) {
    super('audio_input.invalid_configuration', message, options);
    this.name = 'AudioInputConfigurationError';
  }
}

/** Core had no capacity for another complete frame. */
export class AudioInputFullError extends AudioInputError {
  /** Create a capacity failure from the native result. */
  public constructor(message = 'audio input is full', options?: { cause?: unknown }) {
    super('audio_input.full', message, options);
    this.name = 'AudioInputFullError';
  }
}

/** A write was attempted after the AudioInput closed. */
export class AudioInputClosedError extends AudioInputError {
  /** Create a closed-input failure from the native result. */
  public constructor(message = 'audio input is closed', options?: { cause?: unknown }) {
    super('audio_input.closed', message, options);
    this.name = 'AudioInputClosedError';
  }
}

/** The owning Session was cancelled before Core accepted the frame. */
export class AudioInputCancelledError extends AudioInputError {
  /** Create a Session-cancelled input failure from the native result. */
  public constructor(message = 'audio input Session was cancelled', options?: { cause?: unknown }) {
    super('audio_input.cancelled', message, options);
    this.name = 'AudioInputCancelledError';
  }
}

/** Samples did not match the configured float32 frame. */
export class AudioInputBufferError extends AudioInputError {
  /** Create an invalid-samples failure from the native result. */
  public constructor(message: string, options?: { cause?: unknown }) {
    super('audio_input.invalid_buffer', message, options);
    this.name = 'AudioInputBufferError';
  }
}

/** Core did not have capacity before the write deadline. */
export class AudioInputTimeoutError extends AudioInputError {
  /** Configured deadline in milliseconds. */
  public readonly timeoutMs: number;

  /** Create a finite-wait failure. */
  public constructor(timeoutMs: number, options?: { cause?: unknown }) {
    super(
      'audio_input.timeout',
      `audio input remained full for ${timeoutMs} ms`,
      options,
    );
    this.name = 'AudioInputTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** A write was rejected because its replaceable output is no longer active. */
export class OutputCancelledError extends AudioInputError {
  /** Create an inactive-output failure. */
  public constructor(message = 'output is no longer active', options?: { cause?: unknown }) {
    super('audio_input.output_cancelled', message, options);
    this.name = 'OutputCancelledError';
  }
}

/** Replaceable output was created by a different AudioInput. */
export class OutputOwnershipError extends AudioInputError {
  /** Create an output-ownership failure. */
  public constructor(message: string, options?: { cause?: unknown }) {
    super('audio_input.wrong_output_input', message, options);
    this.name = 'OutputOwnershipError';
  }
}

/** Core cannot assign another output identity to this AudioInput. */
export class OutputGenerationLimitError extends AudioInputError {
  /** Create an output-identity exhaustion failure. */
  public constructor(message: string, options?: { cause?: unknown }) {
    super('audio_input.output_generation_limit', message, options);
    this.name = 'OutputGenerationLimitError';
  }
}

/** An AbortSignal stopped a pending write. */
export class AudioInputAbortError extends AudioInputError {
  /** Reason supplied to AbortController.abort(), when present. */
  public readonly reason: unknown;

  /** Create an aborted-wait failure. */
  public constructor(reason?: unknown, options?: { cause?: unknown }) {
    super('audio_input.aborted', 'audio input write was aborted', options);
    this.name = 'AbortError';
    this.reason = reason;
  }
}

/** Float32 PCM samples accepted by AudioInput. */
export type AudioInputSamples = Float32Array | Buffer;

/** One replaceable output produced through an AudioInput. */
export class OutputGeneration {
  readonly #native: NativeOutputGenerationHandle;

  private constructor(native: NativeOutputGenerationHandle) {
    this.#native = native;
  }

  /** @internal */
  public static _create(native: NativeOutputGenerationHandle): OutputGeneration {
    return new OutputGeneration(native);
  }

  /** Identity retained on every accepted frame from this output. */
  public get id(): bigint {
    return BigInt(this.#native.id);
  }

  /** Whether this output still accepts frames. */
  public get active(): boolean {
    return this.#native.active;
  }

  /**
   * Stop this output without closing its AudioInput or Session.
   * Returns true when this call deactivates it.
   */
  public cancel(): boolean {
    return nativeCallSync(() => this.#native.cancel());
  }

  /** @internal */
  public _handle(): NativeOutputGenerationHandle {
    return this.#native;
  }
}

/** Supplies application-owned PCM to one native Session Source. */
export class AudioInput implements Disposable {
  readonly #native: NativeAudioInputHandle;
  readonly #config: AudioInputConfig;
  readonly #output: SourceOutput;

  private constructor(
    session: Session,
    native: NativeAudioInputHandle,
    config: AudioInputConfig,
  ) {
    this.#native = native;
    this.#config = Object.freeze({ ...config });
    this.#output = SourceOutput._create(session, native.output);
  }

  /** @internal */
  public static _create(
    session: Session,
    native: NativeAudioInputHandle,
    config: AudioInputConfig,
  ): AudioInput {
    return new AudioInput(session, native, config);
  }

  /** Resolved format, frame size, and capacity. */
  public get config(): AudioInputConfig {
    return this.#config;
  }

  /** Stable Source identity assigned by Core. */
  public get sourceId(): bigint {
    return BigInt(this.#native.sourceId);
  }

  /** Stable stream identity assigned by Core. */
  public get streamId(): bigint {
    return BigInt(this.#native.streamId);
  }

  /** Source output used with send, connect, through, or record. */
  public get output(): SourceOutput {
    return this.#output;
  }

  /** Start a replaceable output while keeping this AudioInput and Session alive. */
  public beginOutput(): OutputGeneration {
    try {
      return OutputGeneration._create(
        nativeCallSync(() => this.#native.beginOutput()),
      );
    } catch (failure) {
      throw typedFailure(failure);
    }
  }

  /**
   * Attempt one immediate write.
   *
   * Accepted samples are copied into Core-owned storage before this method
   * returns. The caller may reuse or modify its array immediately afterward.
   */
  public tryWrite(
    samples: AudioInputSamples,
    options: AudioInputTryWriteOptions = {},
  ): void {
    try {
      if (Buffer.isBuffer(samples)) {
        nativeCallSync(() =>
          this.#native.tryWriteF32Le(
            samples,
            options.discontinuity ?? false,
            options.output?._handle(),
          ),
        );
        return;
      }
      if (!(samples instanceof Float32Array)) {
        throw new AudioInputBufferError(
          'samples must be a Float32Array or a Buffer of little-endian float32 values',
        );
      }
      nativeCallSync(() =>
        this.#native.tryWriteF32(
          samples,
          options.discontinuity ?? false,
          options.output?._handle(),
        ),
      );
    } catch (failure) {
      throw typedFailure(failure);
    }
  }

  /** Wait finitely for Core to accept one complete frame. */
  public async write(
    samples: AudioInputSamples,
    options: AudioInputWriteOptions = {},
  ): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 1_000;
    validateTimeout(timeoutMs);
    throwIfAborted(options.signal);

    try {
      this.tryWrite(samples, options);
      return;
    } catch (failure) {
      if (!(failure instanceof AudioInputFullError)) {
        throw failure;
      }
    }

    const retained = Buffer.isBuffer(samples)
      ? Buffer.from(samples)
      : new Float32Array(samples);
    const deadline = performance.now() + timeoutMs;
    let waitMs = 1;

    while (true) {
      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) {
        throw new AudioInputTimeoutError(timeoutMs);
      }
      try {
        await wait(Math.min(waitMs, remainingMs), undefined, {
          signal: options.signal,
        });
      } catch (failure) {
        if (options.signal?.aborted === true) {
          throw new AudioInputAbortError(options.signal.reason, { cause: failure });
        }
        throw failure;
      }
      try {
        this.tryWrite(retained, options);
        return;
      } catch (failure) {
        if (!(failure instanceof AudioInputFullError)) {
          throw failure;
        }
      }
      waitMs = Math.min(waitMs * 2, 5);
    }
  }

  /** Close this input. Accepted frames continue through normal Session shutdown. */
  public close(): void {
    try {
      nativeCallSync(() => this.#native.close());
    } catch (failure) {
      throw typedFailure(failure);
    }
  }

  /** Read one current capacity and lifecycle snapshot from Core. */
  public observations(): AudioInputObservations {
    let value: NativeAudioInputObservations;
    try {
      value = nativeCallSync(() => this.#native.observations());
    } catch (failure) {
      throw typedFailure(failure);
    }
    return Object.freeze({
      capacityFrames: BigInt(value.capacityFrames),
      bufferSlots: BigInt(value.bufferSlots),
      availableBuffers: BigInt(value.availableBuffers),
      acceptedTotal: BigInt(value.acceptedTotal),
      fullTotal: BigInt(value.fullTotal),
      invalidTotal: BigInt(value.invalidTotal),
      cancelledOutputWritesTotal: BigInt(value.cancelledOutputWritesTotal),
      cancelled: value.cancelled,
      closed: value.closed,
    });
  }

  /** Close this input when used with `using`. */
  public [Symbol.dispose](): void {
    this.close();
  }
}

function typedFailure(failure: unknown): Error {
  if (failure instanceof AudioInputError) {
    return failure;
  }
  if (!(failure instanceof PocketStationError)) {
    return failure instanceof Error ? failure : new Error(String(failure));
  }
  const options = { cause: failure };
  switch (failure.code) {
    case 'audio_input.invalid_configuration':
      return new AudioInputConfigurationError(failure.message, options);
    case 'audio_input.full':
      return new AudioInputFullError(failure.message, options);
    case 'audio_input.closed':
      return new AudioInputClosedError(failure.message, options);
    case 'audio_input.cancelled':
      return new AudioInputCancelledError(failure.message, options);
    case 'audio_input.invalid_buffer':
      return new AudioInputBufferError(failure.message, options);
    case 'audio_input.output_cancelled':
      return new OutputCancelledError(failure.message, options);
    case 'audio_input.wrong_output_input':
      return new OutputOwnershipError(failure.message, options);
    case 'audio_input.output_generation_limit':
      return new OutputGenerationLimitError(failure.message, options);
    default:
      return failure;
  }
}

/** @internal */
export function _audioInputFailure(failure: unknown): Error {
  return typedFailure(failure);
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) {
    throw new RangeError('timeoutMs must be between 0 and 60000');
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new AudioInputAbortError(signal.reason);
  }
}
