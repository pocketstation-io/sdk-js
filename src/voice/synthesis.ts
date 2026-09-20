import type { SynthesisCapabilities } from './capabilities.js';
import type { ResponseChunk } from './response.js';
import type { ConversationTurn } from './turns.js';
import {
  immutableArray,
  requireBoolean,
  requireInteger,
  requireNonNegativeInteger,
  requireOptionalNonEmpty,
  requireOptionalNonNegativeBigInt,
  requireOptionalPositiveBigInt,
} from './validation.js';

/** One response fragment selected for speech synthesis. */
export class SynthesisRequest {
  public readonly response: ResponseChunk;
  public readonly turn: ConversationTurn;
  public readonly signal: AbortSignal | undefined;

  public constructor(
    response: ResponseChunk,
    turn: ConversationTurn,
    signal?: AbortSignal,
  ) {
    this.response = response;
    this.turn = turn;
    this.signal = signal;
    Object.freeze(this);
  }
}

/** Fields retained for one generated PCM chunk. */
export interface SynthesisChunkOptions<
  TSamples = unknown,
  TObservation = unknown,
> {
  readonly samples: TSamples;
  readonly sampleRateHz: number;
  readonly channels: number;
  readonly sequence: number;
  readonly responseId?: string;
  readonly turnId?: bigint;
  readonly timestampNs?: bigint;
  readonly final?: boolean;
  readonly providerObservations?: readonly TObservation[];
}

/** One generated PCM chunk with response and turn ownership. */
export class SynthesisChunk<TSamples = unknown, TObservation = unknown> {
  public readonly samples: TSamples;
  public readonly sampleRateHz: number;
  public readonly channels: number;
  public readonly sequence: number;
  public readonly responseId: string | undefined;
  public readonly turnId: bigint | undefined;
  public readonly timestampNs: bigint | undefined;
  public readonly final: boolean;
  public readonly providerObservations: readonly TObservation[];

  public constructor(options: SynthesisChunkOptions<TSamples, TObservation>) {
    requireInteger(
      'sampleRateHz',
      options.sampleRateHz,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    requireInteger('channels', options.channels, 1, 32);
    requireNonNegativeInteger('sequence', options.sequence);
    requireOptionalNonEmpty('responseId', options.responseId);
    requireOptionalPositiveBigInt('turnId', options.turnId);
    requireOptionalNonNegativeBigInt('timestampNs', options.timestampNs);
    requireBoolean('final', options.final ?? false);
    this.samples = options.samples;
    this.sampleRateHz = options.sampleRateHz;
    this.channels = options.channels;
    this.sequence = options.sequence;
    this.responseId = options.responseId;
    this.turnId = options.turnId;
    this.timestampNs = options.timestampNs;
    this.final = options.final ?? false;
    this.providerObservations = immutableArray(
      options.providerObservations ?? [],
    );
    Object.freeze(this);
  }
}

/** One value produced by a speech synthesizer. */
export type SynthesisItem<TSamples = unknown, TObservation = unknown> =
  | SynthesisChunk<TSamples, TObservation>
  | TSamples;

/** Incremental result returned by a speech synthesizer. */
export type SynthesisResult<TSamples = unknown, TObservation = unknown> =
  | AsyncIterable<SynthesisItem<TSamples, TObservation>>
  | Promise<AsyncIterable<SynthesisItem<TSamples, TObservation>>>;

/** Produce PCM incrementally for one response fragment. */
export interface SpeechSynthesizer<
  TSamples = unknown,
  TObservation = unknown,
> {
  readonly capabilities: SynthesisCapabilities;
  synthesize(
    request: SynthesisRequest,
  ): SynthesisResult<TSamples, TObservation>;
  start(signal?: AbortSignal): Promise<void>;
  close(signal?: AbortSignal): Promise<void>;
}
