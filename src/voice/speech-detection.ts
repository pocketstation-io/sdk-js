import type { SpeechDetectionCapabilities } from './capabilities.js';
import {
  requireBoolean,
  requireInclusiveNumber,
  requireNonEmpty,
  requireNonNegativeBigInt,
  requirePositiveBigInt,
} from './validation.js';

/** Kind of speech-activity update observed by a detector. */
export type SpeechActivityKind =
  | 'speech.started'
  | 'speech.updated'
  | 'speech.stopped'
  | 'speech.cancelled';

/** Fields retained for one speech-activity update. */
export interface SpeechActivityOptions {
  readonly kind: SpeechActivityKind;
  readonly sourceId: bigint;
  readonly streamId: bigint;
  readonly audioTimestampNs: bigint;
  readonly detectionTimestampNs: bigint;
  readonly providerId: string;
  readonly final: boolean;
  readonly confidence?: number;
}

/** One speech-activity update from a source-aware audio stream. */
export class SpeechActivity {
  public readonly kind: SpeechActivityKind;
  public readonly sourceId: bigint;
  public readonly streamId: bigint;
  public readonly audioTimestampNs: bigint;
  public readonly detectionTimestampNs: bigint;
  public readonly providerId: string;
  public readonly final: boolean;
  public readonly confidence: number | undefined;

  public constructor(options: SpeechActivityOptions) {
    if (
      options.kind !== 'speech.started' &&
      options.kind !== 'speech.updated' &&
      options.kind !== 'speech.stopped' &&
      options.kind !== 'speech.cancelled'
    ) {
      throw new RangeError('kind must be a supported speech activity value');
    }
    requirePositiveBigInt('sourceId', options.sourceId);
    requirePositiveBigInt('streamId', options.streamId);
    requireNonNegativeBigInt('audioTimestampNs', options.audioTimestampNs);
    requireNonNegativeBigInt(
      'detectionTimestampNs',
      options.detectionTimestampNs,
    );
    requireNonEmpty('providerId', options.providerId);
    requireBoolean('final', options.final);
    if (options.confidence !== undefined) {
      requireInclusiveNumber('confidence', options.confidence, 0, 1);
    }
    this.kind = options.kind;
    this.sourceId = options.sourceId;
    this.streamId = options.streamId;
    this.audioTimestampNs = options.audioTimestampNs;
    this.detectionTimestampNs = options.detectionTimestampNs;
    this.providerId = options.providerId;
    this.final = options.final;
    this.confidence = options.confidence;
    Object.freeze(this);
  }
}

/** Existing Session values supplied to a speech detector. */
export interface SpeechDetectionInput<TSession = unknown, TInput = unknown> {
  readonly session: TSession;
  readonly input: TInput;
}

/** Observe speech activity without deciding conversation policy. */
export interface SpeechDetector<TSession = unknown, TInput = unknown> {
  readonly capabilities: SpeechDetectionCapabilities;
  detect(
    input: SpeechDetectionInput<TSession, TInput>,
  ): AsyncIterable<SpeechActivity>;
  start(): Promise<void>;
  close(): Promise<void>;
}
