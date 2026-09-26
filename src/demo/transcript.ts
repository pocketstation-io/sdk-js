import { SignalSpec } from '../node/graph.js';

/** Source-aware final transcript signal emitted by batch transcription demos. */
export const TRANSCRIPT_SIGNAL = SignalSpec.text('json', {
  role: 'transcript.final',
  schema: 'io.pocketstation.transcript.batch.v1',
});

/** One decoded source-aware batch transcript. */
export class Transcript {
  public readonly sourceId: bigint;
  public readonly text: string;
  public readonly language: string;
  public readonly timestampStartNs: bigint;
  public readonly timestampEndNs: bigint;
  public readonly discontinuityReasons: readonly string[];

  public constructor(options: {
    readonly sourceId: bigint;
    readonly text: string;
    readonly language: string;
    readonly timestampStartNs: bigint;
    readonly timestampEndNs: bigint;
    readonly discontinuityReasons?: readonly string[];
  }) {
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
