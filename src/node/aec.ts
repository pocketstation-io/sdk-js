import { nativeCallSync } from './errors.js';
import { SourceId } from './identity.js';
import { nativeAddon, type NativeEchoCancelledAudioHandle } from './native.js';
import type { DerivedStream, SourceOutput, Stem } from './session.js';

/** An already-declared audio stream; AudioInput callers use its output. */
export type EchoAudioInput = Stem | SourceOutput | DerivedStream;

/** One explicitly selected playback device for OS-provided microphone processing. */
export class NativePlaybackReference {
  public readonly playbackDeviceId: string;

  private constructor(playbackDeviceId: string) {
    this.playbackDeviceId = playbackDeviceId;
    Object.freeze(this);
  }

  /** Select the exact output device; selection does not open or record its audio. */
  public static output(playbackDeviceId: string): NativePlaybackReference {
    if (typeof playbackDeviceId !== 'string' || playbackDeviceId.trim().length === 0) {
      throw new TypeError('playbackDeviceId must identify one output device');
    }
    return new NativePlaybackReference(playbackDeviceId);
  }
}

/** Which previously authorized audio the caller provides to the processor. */
export type PlaybackReferenceCoverage =
  | 'selected-application'
  | 'authorized-output-mix'
  | 'caller-rendered-audio';

/** Permit use of a declared stream as a reference without opening another source. */
export class PlaybackReference {
  public readonly input: EchoAudioInput;
  public readonly coverage: PlaybackReferenceCoverage;

  private constructor(input: EchoAudioInput, coverage: PlaybackReferenceCoverage) {
    this.input = input;
    this.coverage = coverage;
    Object.freeze(this);
  }

  /** Other applications playing through the speakers are outside this reference. */
  public static selectedApplication(input: EchoAudioInput): PlaybackReference {
    return new PlaybackReference(input, 'selected-application');
  }

  /** The caller must separately authorize and capture this output mix. */
  public static outputMix(input: EchoAudioInput): PlaybackReference {
    return new PlaybackReference(input, 'authorized-output-mix');
  }

  /** Select caller-owned audio that is also submitted to a playback device. */
  public static renderedAudio(input: EchoAudioInput): PlaybackReference {
    return new PlaybackReference(input, 'caller-rendered-audio');
  }
}

/** Processing means the engine is running; it does not assert acoustic convergence. */
export type EchoCancellationState =
  | 'waiting-for-reference'
  | 'processing'
  | 'reset'
  | 'failed'
  | 'interrupted'
  | 'stopped';

/** A snapshot from Core, retained independently of the running Session. */
export interface EchoCancellationObservations {
  readonly state: EchoCancellationState;
  readonly processedMicrophoneFramesTotal: bigint;
  readonly outputFramesTotal: bigint;
  /** Computed frames discarded when their waiting request had already ended. */
  readonly discardedOutputFramesTotal: bigint;
  readonly tailFramesTotal: bigint;
  readonly tailPaddingSamplesTotal: bigint;
  readonly discardedTailGenerationsTotal: bigint;
  /** Nominal samples per channel; this does not assert a qualified measured delay. */
  readonly nominalDelaySamples: number;
  /** Bounded graceful-stop drain policy, in milliseconds. */
  readonly drainDurationMs: number;
  readonly discardedMicrophoneFramesTotal: bigint;
  readonly discardedReferenceFramesTotal: bigint;
  readonly resetsTotal: bigint;
  readonly processingGeneration: bigint;
  readonly microphoneQueueDepthFrames: bigint;
  readonly referenceQueueDepthFrames: bigint;
  readonly queueCapacityFrames: bigint;
  /** Full native command wall time, including queue wait, reset and audio processing. */
  readonly latestProcessingDurationNs: bigint;
  /** Maximum native command wall time; this is not algorithmic audio delay. */
  readonly maximumProcessingDurationNs: bigint;
  readonly latestReferenceAgeNs: bigint;
  readonly latestReferenceLeadNs: bigint;
  readonly maximumCadenceErrorNs: bigint;
  readonly analyzedReferenceFramesTotal: bigint;
  readonly interruptedRequestsTotal: bigint;
  readonly referenceSourceId?: SourceId;
  readonly microphoneSourceId?: SourceId;
  /** Undefined until Core qualifies the delay for this processor configuration. */
  readonly qualifiedAlgorithmicDelaySamples?: number;
  readonly lastError?: string;
}

/** Route the processed microphone as ordinary audio and inspect processing after stop. */
export class EchoCancelledAudio {
  public readonly audio: Stem;
  public readonly microphone: EchoAudioInput;
  public readonly reference: PlaybackReference;
  public readonly referenceCoverage: PlaybackReferenceCoverage;
  readonly #native: NativeEchoCancelledAudioHandle;

  private constructor(
    audio: Stem,
    microphone: EchoAudioInput,
    reference: PlaybackReference,
    native: NativeEchoCancelledAudioHandle,
  ) {
    this.audio = audio;
    this.microphone = microphone;
    this.reference = reference;
    this.referenceCoverage = native.referenceCoverage;
    this.#native = native;
    Object.freeze(this);
  }

  /** @internal */
  public static _create(
    audio: Stem,
    microphone: EchoAudioInput,
    reference: PlaybackReference,
    native: NativeEchoCancelledAudioHandle,
  ): EchoCancelledAudio {
    return new EchoCancelledAudio(audio, microphone, reference, native);
  }

  public observations(): EchoCancellationObservations {
    const value = nativeCallSync(() => this.#native.observations());
    return Object.freeze({
      state: value.state,
      processedMicrophoneFramesTotal: BigInt(value.processedMicrophoneFramesTotal),
      outputFramesTotal: BigInt(value.outputFramesTotal),
      discardedOutputFramesTotal: BigInt(value.discardedOutputFramesTotal),
      tailFramesTotal: BigInt(value.tailFramesTotal),
      tailPaddingSamplesTotal: BigInt(value.tailPaddingSamplesTotal),
      discardedTailGenerationsTotal: BigInt(value.discardedTailGenerationsTotal),
      nominalDelaySamples: value.nominalDelaySamples,
      drainDurationMs: value.drainDurationMs,
      discardedMicrophoneFramesTotal: BigInt(value.discardedMicrophoneFramesTotal),
      discardedReferenceFramesTotal: BigInt(value.discardedReferenceFramesTotal),
      resetsTotal: BigInt(value.resetsTotal),
      processingGeneration: BigInt(value.processingGeneration),
      microphoneQueueDepthFrames: BigInt(value.microphoneQueueDepthFrames),
      referenceQueueDepthFrames: BigInt(value.referenceQueueDepthFrames),
      queueCapacityFrames: BigInt(value.queueCapacityFrames),
      latestProcessingDurationNs: BigInt(value.latestProcessingDurationNs),
      maximumProcessingDurationNs: BigInt(value.maximumProcessingDurationNs),
      latestReferenceAgeNs: BigInt(value.latestReferenceAgeNs),
      latestReferenceLeadNs: BigInt(value.latestReferenceLeadNs),
      maximumCadenceErrorNs: BigInt(value.maximumCadenceErrorNs),
      analyzedReferenceFramesTotal: BigInt(value.analyzedReferenceFramesTotal),
      interruptedRequestsTotal: BigInt(value.interruptedRequestsTotal),
      referenceSourceId: value.referenceSourceId == null
        ? undefined : SourceId(BigInt(value.referenceSourceId)),
      microphoneSourceId: value.microphoneSourceId == null
        ? undefined : SourceId(BigInt(value.microphoneSourceId)),
      qualifiedAlgorithmicDelaySamples: value.qualifiedAlgorithmicDelaySamples ?? undefined,
      lastError: value.lastError ?? undefined,
    });
  }
}

/** Whether the installed native build includes AEC; device suitability is separate. */
export function aecAvailable(): boolean {
  return nativeCallSync(() => nativeAddon().aecAvailable());
}
