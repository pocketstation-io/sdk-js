import { SignalSpec } from '../node/graph.js';

/** Source-aware final transcript signal emitted by batch transcription demos. */
export const TRANSCRIPT_SIGNAL = SignalSpec.text('json', {
  role: 'transcript.final',
  schema: 'io.pocketstation.transcript.batch.v1',
});

/** One decoded source-aware batch transcript. */
export class Transcript {
  /** Processing disposition; absent on legacy transcript payloads. */
  public readonly processingOutcome: string | undefined;
  public readonly durationMs: number | undefined;
  public readonly inferenceDurationNs: bigint | undefined;
  public readonly sourceId: bigint;
  public readonly text: string;
  public readonly language: string;
  public readonly timestampStartNs: bigint;
  public readonly timestampEndNs: bigint;
  public readonly discontinuityReasons: readonly string[];

  public constructor(options: {
    readonly processingOutcome?: string;
    readonly durationMs?: number;
    readonly inferenceDurationNs?: bigint;
    readonly sourceId: bigint;
    readonly text: string;
    readonly language: string;
    readonly timestampStartNs: bigint;
    readonly timestampEndNs: bigint;
    readonly discontinuityReasons?: readonly string[];
  }) {
    this.processingOutcome = options.processingOutcome;
    this.durationMs = options.durationMs;
    this.inferenceDurationNs = options.inferenceDurationNs;
    this.sourceId = options.sourceId;
    this.text = options.text;
    this.language = options.language;
    this.timestampStartNs = options.timestampStartNs;
    this.timestampEndNs = options.timestampEndNs;
    this.discontinuityReasons = Object.freeze([...(options.discontinuityReasons ?? [])]);
    Object.freeze(this);
  }

  public static fromJson(payload: string): Transcript {
    const value = JSON.parse(payload) as Record<string, unknown>;
    return new Transcript({
      processingOutcome: value.processing_outcome === undefined ? undefined : requiredString(value, 'processing_outcome'),
      durationMs: value.duration_ms === undefined ? undefined : requiredDuration(value),
      inferenceDurationNs: value.inference_duration_ns === undefined ? undefined : BigInt(requiredJsonInteger(value, 'inference_duration_ns')),
      sourceId: BigInt(requiredJsonInteger(value, 'source_id')),
      text: requiredString(value, 'text'),
      language: requiredString(value, 'language'),
      timestampStartNs: BigInt(requiredJsonInteger(value, 'timestamp_start_ns')),
      timestampEndNs: BigInt(requiredJsonInteger(value, 'timestamp_end_ns')),
      discontinuityReasons: requiredStrings(value, 'discontinuity_reasons'),
    });
  }
}

function requiredString(value: Record<string, unknown>, name: string): string {
  const field = value[name];
  if (typeof field !== 'string') throw new TypeError(`${name} must be a string`);
  return field;
}

function requiredJsonInteger(value: Record<string, unknown>, name: string): number | string {
  const field = value[name];
  if (
    (typeof field !== 'number' || !Number.isSafeInteger(field))
    && (typeof field !== 'string' || !/^-?[0-9]+$/.test(field))
  ) {
    throw new TypeError(`${name} must be an integer`);
  }
  return field;
}

function requiredStrings(value: Record<string, unknown>, name: string): readonly string[] {
  const field = value[name];
  if (!Array.isArray(field) || !field.every((item) => typeof item === 'string')) {
    throw new TypeError(`${name} must be an array of strings`);
  }
  return field;
}

function requiredDuration(value: Record<string, unknown>): number {
  const duration = Number(requiredJsonInteger(value, 'duration_ms'));
  if (!Number.isSafeInteger(duration) || duration < 0) throw new TypeError('duration_ms must be a nonnegative safe integer');
  return duration;
}
