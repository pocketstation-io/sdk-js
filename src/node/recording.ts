import type { Buffer } from 'node:buffer';

import {
  nativeCall,
  nativeCallSync,
  RecordingClipError,
  AudioHistoryError,
} from './errors.js';
import {
  ClockDomainId,
  RuntimeSessionId,
  SourceId,
  StemId,
} from './identity.js';
import {
  nativeAddon,
  type NativeAudioHistoryHandle,
  type NativeRecordingClip,
  type NativeClipInterval,
  type NativeRecordedAudioHandle,
  type NativeRecordedStem,
} from './native.js';
import type {
  RecordingDiscontinuity,
  RecordingDiscontinuityKind,
  RecordingOutcome,
} from './observations.js';

function u64(value: bigint, label: string, code: string): string {
  if (
    typeof value !== 'bigint' ||
    value < 0n ||
    value > 0xffff_ffff_ffff_ffffn
  ) {
    const Failure = code.startsWith('recording.history_')
      ? AudioHistoryError
      : RecordingClipError;
    throw new Failure(code, `${label} must be an unsigned 64-bit bigint`);
  }
  return value.toString();
}

/** Nonempty half-open Session interval in ns, limited by Core to 120 seconds. */
export class RecordingClipWindow {
  public readonly startNs: bigint;
  public readonly endNs: bigint;

  public constructor(startNs: bigint, endNs: bigint) {
    const code = 'recording.clip_invalid_window';
    const value = nativeCallSync(() =>
      nativeAddon().recordingClipWindow(
        u64(startNs, 'startNs', code),
        u64(endNs, 'endNs', code),
        '0',
        '0',
      ),
    );
    this.startNs = BigInt(value.startNs);
    this.endNs = BigInt(value.endNs);
    Object.freeze(this);
  }

  /** Explicit before/after context; Core clamps at zero and rejects overflow. */
  public static around(
    startNs: bigint,
    endNs: bigint,
    beforeNs: bigint,
    afterNs: bigint,
  ): RecordingClipWindow {
    const code = 'recording.clip_invalid_window';
    const value = nativeCallSync(() =>
      nativeAddon().recordingClipWindow(
        u64(startNs, 'startNs', code),
        u64(endNs, 'endNs', code),
        u64(beforeNs, 'beforeNs', code),
        u64(afterNs, 'afterNs', code),
      ),
    );
    return intervalFromNative(value);
  }
}

/** Actual sample-rounded native intervals are already validated by Core. */
function intervalFromNative(value: NativeClipInterval): RecordingClipWindow {
  const result = Object.create(
    RecordingClipWindow.prototype,
  ) as RecordingClipWindow;
  Object.defineProperties(result, {
    startNs: { value: BigInt(value.startNs), enumerable: true },
    endNs: { value: BigInt(value.endNs), enumerable: true },
  });
  return Object.freeze(result);
}

/** Exact persisted source identity, format and normalized recording origin. */
export interface RecordedStem {
  readonly label: string;
  readonly sessionId: RuntimeSessionId;
  readonly sourceId: SourceId;
  readonly stemId: StemId;
  readonly clockId: ClockDomainId;
  readonly sourceGeneration: number;
  readonly permissionEpoch: bigint;
  readonly sampleRateHz: number;
  readonly channels: number;
  readonly firstTimestampNs: bigint;
  readonly finalTimestampNs: bigint;
}

/** Owned float32 WAV bytes, actual sample bounds and original gap observations. */
export interface RecordingClip {
  readonly wav: Buffer;
  readonly stem: RecordedStem;
  readonly requested: RecordingClipWindow;
  readonly actual: RecordingClipWindow;
  readonly firstSampleFrame: bigint;
  readonly sampleFrames: bigint;
  readonly discontinuities: readonly RecordingDiscontinuity[];
}

function recordedStem(value: NativeRecordedStem): RecordedStem {
  return Object.freeze({
    label: value.label,
    sessionId: RuntimeSessionId(BigInt(value.sessionId)),
    sourceId: SourceId(BigInt(value.sourceId)),
    stemId: StemId(BigInt(value.stemId)),
    clockId: ClockDomainId(Number(value.clockId)),
    sourceGeneration: value.sourceGeneration,
    permissionEpoch: BigInt(value.permissionEpoch),
    sampleRateHz: value.sampleRateHz,
    channels: value.channels,
    firstTimestampNs: BigInt(value.firstTimestampNs),
    finalTimestampNs: BigInt(value.finalTimestampNs),
  });
}

/** Verified finalized recording; all filesystem work runs outside the Node event loop. */
export class RecordedAudio {
  readonly #native: NativeRecordedAudioHandle;

  private constructor(value: NativeRecordedAudioHandle) {
    this.#native = value;
  }

  /** Inspect an authorized directory for this exact runtime Session. */
  public static async open(
    directory: string,
    sessionId: RuntimeSessionId,
  ): Promise<RecordedAudio> {
    const value = await nativeCall(() =>
      nativeAddon().openRecordedAudio(
        directory,
        u64(sessionId, 'sessionId', 'recording.clip_invalid_recording'),
      ),
    );
    return new RecordedAudio(value);
  }

  /** Reopen a Session's finalized recording outcome; no device is opened. */
  public static async fromOutcome(
    outcome: RecordingOutcome,
  ): Promise<RecordedAudio> {
    if (!outcome.complete) {
      throw new RecordingClipError(
        'recording.clip_invalid_recording',
        'Recording is not finalized',
      );
    }
    return RecordedAudio.open(outcome.sessionDirectory, outcome.sessionId);
  }

  public get stems(): readonly RecordedStem[] {
    return Object.freeze(this.#native.stems().map(recordedStem));
  }

  /** Extract exact channels, bounds and gaps. Limits: 120 s/32 MiB clip, 1 GiB source.
   * Started native I/O cannot be forcibly aborted; the caller controls concurrency.
   */
  public async readClip(
    stemId: StemId,
    window: RecordingClipWindow,
  ): Promise<RecordingClip> {
    if (!(window instanceof RecordingClipWindow))
      throw new TypeError('window must be RecordingClipWindow');
    const value = await nativeCall(() =>
      this.#native.readClip(
        u64(stemId, 'stemId', 'recording.clip_unknown_stem'),
        window.startNs.toString(),
        window.endNs.toString(),
      ),
    );
    return recordingClip(value);
  }
}

function recordingClip(value: NativeRecordingClip): RecordingClip {
  return Object.freeze({
    wav: value.wav,
    stem: recordedStem(value.stem),
    requested: intervalFromNative(value.requested),
    actual: intervalFromNative(value.actual),
    firstSampleFrame: BigInt(value.firstSampleFrame),
    sampleFrames: BigInt(value.sampleFrames),
    discontinuities: Object.freeze(
      value.discontinuities.map((gap): RecordingDiscontinuity =>
        Object.freeze({
          stemId: StemId(BigInt(gap.stemId)),
          label: gap.label,
          kind: gap.kind as RecordingDiscontinuityKind,
          timestampStartNs: BigInt(gap.timestampStartNs),
          timestampEndNs: BigInt(gap.timestampEndNs),
          sequenceStart:
            gap.sequenceStart == null ? undefined : BigInt(gap.sequenceStart),
          sequenceEnd:
            gap.sequenceEnd == null ? undefined : BigInt(gap.sequenceEnd),
        }),
      ),
    ),
  });
}

export interface AudioHistoryConfig {
  readonly retentionNs?: bigint;
  readonly maxPcmBytes?: number;
  readonly maxBuffers?: number;
}

export type AudioHistoryState =
  'preparing' | 'running' | 'complete' | 'cancelled' | 'failed';

export interface AudioHistoryObservations {
  readonly state: AudioHistoryState;
  readonly retainedPcmBytes: number;
  readonly retainedBuffers: number;
  readonly receivedBuffersTotal: bigint;
  readonly evictedBuffersTotal: bigint;
  readonly rejectedBuffersTotal: bigint;
  readonly discontinuitiesTotal: bigint;
  readonly sourceResetsTotal: bigint;
}

/** Recent Core-owned PCM. Native work runs outside the Node event loop.
 * Session owns the capture worker. Cancel discards retained audio; stop keeps
 * finite history. Callers limit concurrent reads and not-ready retries.
 */
export class AudioHistory {
  readonly #native: NativeAudioHistoryHandle;
  private constructor(native: NativeAudioHistoryHandle) {
    this.#native = native;
  }

  /** @internal Construct only from the Session's Core-owned receipt. */
  public static _create(native: NativeAudioHistoryHandle): AudioHistory {
    return new AudioHistory(native);
  }

  public async getStems(): Promise<readonly RecordedStem[]> {
    const stems = await nativeCall(() => this.#native.stems());
    return Object.freeze(stems.map(recordedStem));
  }

  public async readClip(
    stemId: StemId,
    window: RecordingClipWindow,
  ): Promise<RecordingClip> {
    if (!(window instanceof RecordingClipWindow))
      throw new TypeError('window must be RecordingClipWindow');
    const value = await nativeCall(() =>
      this.#native.readClip(
        u64(stemId, 'stemId', 'recording.history_unknown_stem'),
        window.startNs.toString(),
        window.endNs.toString(),
      ),
    );
    return recordingClip(value);
  }

  public async clear(): Promise<void> {
    await nativeCall(() => this.#native.clear());
  }

  public async observations(): Promise<AudioHistoryObservations> {
    const value = await nativeCall(() => this.#native.observations());
    return Object.freeze({
      state: value.state as AudioHistoryState,
      retainedPcmBytes: value.retainedPcmBytes,
      retainedBuffers: value.retainedBuffers,
      receivedBuffersTotal: BigInt(value.receivedBuffersTotal),
      evictedBuffersTotal: BigInt(value.evictedBuffersTotal),
      rejectedBuffersTotal: BigInt(value.rejectedBuffersTotal),
      discontinuitiesTotal: BigInt(value.discontinuitiesTotal),
      sourceResetsTotal: BigInt(value.sourceResetsTotal),
    });
  }
}
