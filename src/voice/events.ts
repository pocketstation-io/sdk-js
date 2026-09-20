import {
  requireBoolean,
  requireNonEmpty,
  requireNonNegativeBigInt,
  requireOptionalNonEmpty,
  requireOptionalNonNegativeBigInt,
  requireOptionalPositiveBigInt,
  requireOptionalPositiveInteger,
} from './validation.js';

/** Fields retained for one measured voice lifecycle or timing event. */
export interface VoiceEventOptions {
  readonly kind: string;
  readonly timestampNs: bigint;
  readonly stage?: string;
  readonly providerId?: string;
  readonly turnId?: bigint;
  readonly utteranceId?: string;
  readonly transcriptRevision?: number;
  readonly responseId?: string;
  readonly outputGenerationId?: bigint;
  readonly durationNs?: bigint;
  readonly available?: boolean;
  readonly detail?: string;
}

/** One measured voice lifecycle or media-timing event. */
export class VoiceEvent {
  public readonly kind: string;
  public readonly timestampNs: bigint;
  public readonly stage: string | undefined;
  public readonly providerId: string | undefined;
  public readonly turnId: bigint | undefined;
  public readonly utteranceId: string | undefined;
  public readonly transcriptRevision: number | undefined;
  public readonly responseId: string | undefined;
  public readonly outputGenerationId: bigint | undefined;
  public readonly durationNs: bigint | undefined;
  public readonly available: boolean;
  public readonly detail: string | undefined;

  public constructor(options: VoiceEventOptions) {
    requireNonEmpty('kind', options.kind);
    requireNonNegativeBigInt('timestampNs', options.timestampNs);
    requireOptionalNonNegativeBigInt('durationNs', options.durationNs);
    requireOptionalPositiveBigInt('turnId', options.turnId);
    requireOptionalPositiveBigInt(
      'outputGenerationId',
      options.outputGenerationId,
    );
    requireOptionalPositiveInteger(
      'transcriptRevision',
      options.transcriptRevision,
    );
    requireOptionalNonEmpty('stage', options.stage);
    requireOptionalNonEmpty('providerId', options.providerId);
    requireOptionalNonEmpty('utteranceId', options.utteranceId);
    requireOptionalNonEmpty('responseId', options.responseId);
    requireBoolean('available', options.available ?? true);
    this.kind = options.kind;
    this.timestampNs = options.timestampNs;
    this.stage = options.stage;
    this.providerId = options.providerId;
    this.turnId = options.turnId;
    this.utteranceId = options.utteranceId;
    this.transcriptRevision = options.transcriptRevision;
    this.responseId = options.responseId;
    this.outputGenerationId = options.outputGenerationId;
    this.durationNs = options.durationNs;
    this.available = options.available ?? true;
    this.detail = options.detail;
    Object.freeze(this);
  }
}

/** Compatibility name for a retained voice event. */
export type ConversationEvent = VoiceEvent;
