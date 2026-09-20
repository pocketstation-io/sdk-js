import type { ResponseCapabilities } from './capabilities.js';
import type { TranscriptUpdate } from './transcription.js';
import type { ConversationContext } from './turns.js';
import {
  immutableArray,
  requireBoolean,
  requireNonEmpty,
  requireOptionalNonEmpty,
  requireOptionalNonNegativeBigInt,
  requireOptionalPositiveBigInt,
} from './validation.js';

/** One bounded observation returned by provider-managed tool work. */
export class ToolEvent {
  public readonly name: string;
  public readonly outcome: string;
  public readonly detail: string;

  public constructor(name: string, outcome: string, detail = '') {
    requireNonEmpty('tool event name', name);
    requireNonEmpty('tool event outcome', outcome);
    this.name = name;
    this.outcome = outcome;
    this.detail = detail;
    Object.freeze(this);
  }
}

/** A transcript revision and finite history presented to a response model. */
export class ResponseRequest {
  public readonly transcript: TranscriptUpdate;
  public readonly context: ConversationContext;

  public constructor(
    transcript: TranscriptUpdate,
    context: ConversationContext,
  ) {
    this.transcript = transcript;
    this.context = context;
    Object.freeze(this);
  }
}

/** Fields supplied for one ordered response fragment. */
export interface ResponseChunkOptions {
  readonly text?: string;
  readonly toolEvents?: readonly ToolEvent[];
  readonly responseId?: string;
  readonly turnId?: bigint;
  readonly final?: boolean;
  readonly providerTimestampNs?: bigint;
}

/** One ordered response fragment. */
export class ResponseChunk {
  public readonly text: string;
  public readonly toolEvents: readonly ToolEvent[];
  public readonly responseId: string | undefined;
  public readonly turnId: bigint | undefined;
  public readonly final: boolean;
  public readonly providerTimestampNs: bigint | undefined;

  public constructor(options: ResponseChunkOptions = {}) {
    const text = options.text ?? '';
    const toolEvents = options.toolEvents ?? [];
    const final = options.final ?? false;
    requireBoolean('final', final);
    if (text.length === 0 && toolEvents.length === 0 && !final) {
      throw new RangeError(
        'a response chunk must contain text, a tool event, or final',
      );
    }
    requireOptionalNonEmpty('responseId', options.responseId);
    requireOptionalPositiveBigInt('turnId', options.turnId);
    requireOptionalNonNegativeBigInt(
      'providerTimestampNs',
      options.providerTimestampNs,
    );
    this.text = text;
    this.toolEvents = immutableArray(toolEvents);
    this.responseId = options.responseId;
    this.turnId = options.turnId;
    this.final = final;
    this.providerTimestampNs = options.providerTimestampNs;
    Object.freeze(this);
  }
}

/** Compatibility value for a complete non-streaming response. */
export class ConversationResponse {
  public readonly text: string;
  public readonly toolEvents: readonly ToolEvent[];

  public constructor(text: string, toolEvents: readonly ToolEvent[] = []) {
    requireNonEmpty('conversation response text', text);
    this.text = text;
    this.toolEvents = immutableArray(toolEvents);
    Object.freeze(this);
  }
}

/** Compatibility name for an ordered response fragment. */
export type ConversationResponseChunk = ResponseChunk;

/** One value returned by a response model. */
export type ResponseItem = string | ConversationResponse | ResponseChunk;

/** Complete or incremental result returned by a response model. */
export type ResponseResult =
  | ResponseItem
  | AsyncIterable<ResponseItem>
  | Promise<ResponseItem | AsyncIterable<ResponseItem>>;

/** Produce finite incremental text from a transcript and retained history. */
export interface ResponseModel {
  readonly capabilities: ResponseCapabilities;
  respond(request: ResponseRequest): ResponseResult;
  start(): Promise<void>;
  close(): Promise<void>;
}
