import { Buffer } from 'node:buffer';
import { setTimeout as wait } from 'node:timers/promises';

import { PocketStationError } from '../errors.js';
import {
  AudioInputAbortError,
  AudioInputBufferError,
  AudioInputCancelledError,
  AudioInputClosedError,
  AudioInputConfigurationError,
  AudioInputError,
  AudioInputFullError,
  AudioInputTimeoutError,
  OutputCancelledError,
  OutputGenerationLimitError,
  OutputOwnershipError,
  nativeCallSync,
} from './errors.js';
export {
  AudioInputAbortError,
  AudioInputBufferError,
  AudioInputCancelledError,
  AudioInputClosedError,
  AudioInputConfigurationError,
  AudioInputError,
  AudioInputFullError,
  AudioInputTimeoutError,
  OutputCancelledError,
  OutputGenerationLimitError,
  OutputOwnershipError,
} from './errors.js';
import { SourceId, StreamId } from './identity.js';
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
  /** Samples per channel in each write. Defaults to the Session frame duration at the selected sample rate. */
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
  /**
   * Attach this frame to a replaceable output generation.
   * This is the cross-SDK name; `output` remains as a compatibility alias.
   */
  generation?: OutputGeneration;
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
  /** Accepted frames discarded after their replaceable output was cancelled. */
  readonly discardedOutputFramesTotal: bigint;
  /** Writes rejected because their output was no longer active. */
  readonly cancelledOutputWritesTotal: bigint;
  /** Whether the owning Session was cancelled. */
  readonly cancelled: boolean;
  /** Whether this input no longer accepts writes. */
  readonly closed: boolean;
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

/**
 * Advanced explicit ownership of one Session source output and PCM writer.
 *
 * Session constructs instances; applications use this contract when a component
 * accepts any application-owned PCM source without requiring finite-wait
 * `AudioInput.write()` convenience.
 */
export interface PcmSource extends Disposable {
  /** Resolved format, frame size, and capacity. */
  readonly config: AudioInputConfig;
  /** Stable Source identity assigned by Core. */
  readonly sourceId: SourceId;
  /** Stable stream identity assigned by Core. */
  readonly streamId: StreamId;
  /** Source output used with send, connect, through, or record. */
  readonly output: SourceOutput;
  /** Start a replaceable output while keeping this source and Session alive. */
  beginOutput(): OutputGeneration;
  /** Attempt one immediate write into Core's bounded input. */
  tryWrite(samples: AudioInputSamples, options?: AudioInputTryWriteOptions): void;
  /** Close this input after accepted frames drain. */
  close(): void;
  /** Read one current capacity and lifecycle snapshot from Core. */
  observations(): AudioInputObservations;
  /** Close this input when used with `using`. */
  [Symbol.dispose](): void;
}

/** Supplies application-owned PCM to one native Session Source. */
export class AudioInput implements PcmSource {
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
  public get sourceId(): SourceId {
    return SourceId(BigInt(this.#native.sourceId));
  }

  /** Stable stream identity assigned by Core. */
  public get streamId(): StreamId {
    return StreamId(BigInt(this.#native.streamId));
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
      const generation = resolveGeneration(options);
      if (Buffer.isBuffer(samples)) {
        nativeCallSync(() =>
          this.#native.tryWriteF32Le(
            samples,
            options.discontinuity ?? false,
            generation?._handle(),
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
          generation?._handle(),
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
      discardedOutputFramesTotal: BigInt(value.discardedOutputFramesTotal),
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

function resolveGeneration(
  options: AudioInputTryWriteOptions,
): OutputGeneration | undefined {
  if (
    options.output !== undefined &&
    options.generation !== undefined &&
    options.output !== options.generation
  ) {
    throw new AudioInputConfigurationError(
      'output and generation must reference the same OutputGeneration',
    );
  }
  return options.generation ?? options.output;
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
