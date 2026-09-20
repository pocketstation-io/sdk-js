import type { TranscriptionCapabilities } from './capabilities.js';
import {
  characterCount,
  requireBoolean,
  requireInteger,
  requireNonEmpty,
  requireOptionalNonNegativeBigInt,
  requireOptionalPositiveBigInt,
} from './validation.js';

/** Fields retained for one recognized-speech revision. */
export interface TranscriptUpdateOptions {
  readonly utteranceId: string;
  readonly revision: number;
  readonly text: string;
  readonly stablePrefix?: string;
  readonly final?: boolean;
  readonly interrupts?: boolean;
  readonly sourceId?: bigint;
  readonly streamId?: bigint;
  readonly sourceSequence?: bigint;
  readonly sourceTimestampNs?: bigint;
  readonly audioStartNs?: bigint;
  readonly audioEndNs?: bigint;
  readonly providerTimestampNs?: bigint;
  readonly sessionTimestampNs?: bigint;
}

/** One revision of speech recognized from a source-aware audio stream. */
export class TranscriptUpdate {
  public readonly utteranceId: string;
  public readonly revision: number;
  public readonly text: string;
  public readonly stablePrefix: string;
  public readonly final: boolean;
  public readonly interrupts: boolean;
  public readonly sourceId: bigint | undefined;
  public readonly streamId: bigint | undefined;
  public readonly sourceSequence: bigint | undefined;
  public readonly sourceTimestampNs: bigint | undefined;
  public readonly audioStartNs: bigint | undefined;
  public readonly audioEndNs: bigint | undefined;
  public readonly providerTimestampNs: bigint | undefined;
  public readonly sessionTimestampNs: bigint | undefined;

  public constructor(options: TranscriptUpdateOptions) {
    const stablePrefix = options.stablePrefix ?? '';
    requireNonEmpty('utteranceId', options.utteranceId);
    if (characterCount(options.utteranceId) > 128) {
      throw new RangeError('utteranceId must not exceed 128 characters');
    }
    requireInteger('revision', options.revision, 1, Number.MAX_SAFE_INTEGER);
    requireBoolean('final', options.final ?? false);
    requireBoolean('interrupts', options.interrupts ?? true);
    if (!options.text.startsWith(stablePrefix)) {
      throw new RangeError('stablePrefix must be a prefix of text');
    }
    if (options.final && options.text.trim().length === 0) {
      throw new RangeError('a final transcript update must contain text');
    }
    if (options.final && stablePrefix !== options.text) {
      throw new RangeError(
        'a final transcript update must make all text stable',
      );
    }
    requireOptionalPositiveBigInt('sourceId', options.sourceId);
    requireOptionalPositiveBigInt('streamId', options.streamId);
    requireOptionalNonNegativeBigInt(
      'sourceSequence',
      options.sourceSequence,
    );
    const timestamps: readonly [string, bigint | undefined][] = [
      ['sourceTimestampNs', options.sourceTimestampNs],
      ['audioStartNs', options.audioStartNs],
      ['audioEndNs', options.audioEndNs],
      ['providerTimestampNs', options.providerTimestampNs],
      ['sessionTimestampNs', options.sessionTimestampNs],
    ];
    for (const [name, value] of timestamps) {
      requireOptionalNonNegativeBigInt(name, value);
    }
    if (
      options.audioStartNs !== undefined &&
      options.audioEndNs !== undefined &&
      options.audioEndNs < options.audioStartNs
    ) {
      throw new RangeError('audioEndNs must not precede audioStartNs');
    }
    this.utteranceId = options.utteranceId;
    this.revision = options.revision;
    this.text = options.text;
    this.stablePrefix = stablePrefix;
    this.final = options.final ?? false;
    this.interrupts = options.interrupts ?? true;
    this.sourceId = options.sourceId;
    this.streamId = options.streamId;
    this.sourceSequence = options.sourceSequence;
    this.sourceTimestampNs = options.sourceTimestampNs;
    this.audioStartNs = options.audioStartNs;
    this.audioEndNs = options.audioEndNs;
    this.providerTimestampNs = options.providerTimestampNs;
    this.sessionTimestampNs = options.sessionTimestampNs;
    Object.freeze(this);
  }
}

/** A declared transcript signal and its provider-specific decoder. */
export interface TranscriptionConnection<
  TSubscription = unknown,
  TEnvelope = unknown,
> {
  readonly subscription: TSubscription;
  decode(envelope: TEnvelope): TranscriptUpdate | undefined;
  start(): Promise<void>;
  close(): Promise<void>;
}

/** Existing Session values supplied when attaching speech recognition. */
export interface TranscriptionInput<TSession = unknown, TInput = unknown> {
  readonly session: TSession;
  readonly input: TInput;
}

/** Attach speech recognition to one existing Session audio stream. */
export interface StreamingTranscriber<
  TSession = unknown,
  TInput = unknown,
  TConnection extends TranscriptionConnection = TranscriptionConnection,
> {
  readonly capabilities: TranscriptionCapabilities;
  transcribe(input: TranscriptionInput<TSession, TInput>): TConnection;
}
