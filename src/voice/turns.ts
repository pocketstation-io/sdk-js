import {
  immutableArray,
  requireBoolean,
  requireNonEmpty,
  requireNonNegativeBigInt,
  requireNonNegativeInteger,
  requireOptionalNonNegativeBigInt,
  requireOptionalPositiveBigInt,
  requirePositiveBigInt,
} from './validation.js';

/** Participant represented by one retained conversation message. */
export type ConversationRole = 'user' | 'assistant' | 'tool';

/** Terminal state of one bounded conversation run. */
export type ConversationDisposition =
  | 'completed'
  | 'stopped'
  | 'cancelled'
  | 'failed';

/** Fields retained for one committed transcript turn. */
export interface ConversationTurnOptions {
  readonly id: bigint;
  readonly utteranceId: string;
  readonly text: string;
  readonly sourceId?: bigint;
  readonly streamId?: bigint;
  readonly sourceSequence?: bigint;
  readonly sourceTimestampNs?: bigint;
  readonly audioStartNs?: bigint;
  readonly audioEndNs?: bigint;
  readonly receivedTimestampNs: bigint;
}

/** A final transcript with its source identity and Session timing. */
export class ConversationTurn {
  public readonly id: bigint;
  public readonly utteranceId: string;
  public readonly text: string;
  public readonly sourceId: bigint | undefined;
  public readonly streamId: bigint | undefined;
  public readonly sourceSequence: bigint | undefined;
  public readonly sourceTimestampNs: bigint | undefined;
  public readonly audioStartNs: bigint | undefined;
  public readonly audioEndNs: bigint | undefined;
  public readonly receivedTimestampNs: bigint;

  public constructor(options: ConversationTurnOptions) {
    requirePositiveBigInt('id', options.id);
    requireNonEmpty('utteranceId', options.utteranceId);
    requireOptionalPositiveBigInt('sourceId', options.sourceId);
    requireOptionalPositiveBigInt('streamId', options.streamId);
    requireOptionalNonNegativeBigInt('sourceSequence', options.sourceSequence);
    requireOptionalNonNegativeBigInt(
      'sourceTimestampNs',
      options.sourceTimestampNs,
    );
    requireOptionalNonNegativeBigInt('audioStartNs', options.audioStartNs);
    requireOptionalNonNegativeBigInt('audioEndNs', options.audioEndNs);
    requireNonNegativeBigInt(
      'receivedTimestampNs',
      options.receivedTimestampNs,
    );
    if (
      options.audioStartNs !== undefined &&
      options.audioEndNs !== undefined &&
      options.audioEndNs < options.audioStartNs
    ) {
      throw new RangeError('audioEndNs must not precede audioStartNs');
    }
    this.id = options.id;
    this.utteranceId = options.utteranceId;
    this.text = options.text;
    this.sourceId = options.sourceId;
    this.streamId = options.streamId;
    this.sourceSequence = options.sourceSequence;
    this.sourceTimestampNs = options.sourceTimestampNs;
    this.audioStartNs = options.audioStartNs;
    this.audioEndNs = options.audioEndNs;
    this.receivedTimestampNs = options.receivedTimestampNs;
    Object.freeze(this);
  }
}

/** Fields retained for one finite-history message. */
export interface ConversationMessageOptions {
  readonly role: ConversationRole;
  readonly content: string;
  readonly turnId: bigint;
  readonly timestampNs: bigint;
}

/** One message retained in finite conversation history. */
export class ConversationMessage {
  public readonly role: ConversationRole;
  public readonly content: string;
  public readonly turnId: bigint;
  public readonly timestampNs: bigint;

  public constructor(options: ConversationMessageOptions) {
    if (options.role !== 'user' && options.role !== 'assistant' && options.role !== 'tool') {
      throw new RangeError('role must be user, assistant, or tool');
    }
    requirePositiveBigInt('turnId', options.turnId);
    requireNonNegativeBigInt('timestampNs', options.timestampNs);
    this.role = options.role;
    this.content = options.content;
    this.turnId = options.turnId;
    this.timestampNs = options.timestampNs;
    Object.freeze(this);
  }
}

/** Immutable history and commit state presented to a response model. */
export class ConversationContext {
  public readonly history: readonly ConversationMessage[];
  public readonly committed: boolean;

  public constructor(
    history: readonly ConversationMessage[],
    committed: boolean,
  ) {
    requireBoolean('committed', committed);
    this.history = immutableArray(history);
    this.committed = committed;
    Object.freeze(this);
  }
}

/** Terminal facts retained from one bounded conversation run. */
export interface ConversationOutcomeOptions {
  readonly disposition: ConversationDisposition;
  readonly turnsStarted: number;
  readonly turnsCompleted: number;
  readonly turnsInterrupted: number;
  readonly transcriptUpdatesReceived: number;
  readonly speculativeResponsesStarted: number;
  readonly speculativeResponsesReused: number;
  readonly outputGenerationsCancelled: number;
  readonly outputFramesWritten: number;
  readonly history: readonly ConversationMessage[];
  readonly events: readonly unknown[];
  readonly failure?: string;
  readonly providerTasksCancelled?: number;
  readonly connectorQueuesCleared?: number;
  readonly receiverObservationsReceived?: number;
  readonly acousticHearingKnown?: boolean;
}

/** Terminal facts from one bounded conversation run. */
export class ConversationOutcome {
  public readonly disposition: ConversationDisposition;
  public readonly turnsStarted: number;
  public readonly turnsCompleted: number;
  public readonly turnsInterrupted: number;
  public readonly transcriptUpdatesReceived: number;
  public readonly speculativeResponsesStarted: number;
  public readonly speculativeResponsesReused: number;
  public readonly outputGenerationsCancelled: number;
  public readonly outputFramesWritten: number;
  public readonly history: readonly ConversationMessage[];
  public readonly events: readonly unknown[];
  public readonly failure: string | undefined;
  public readonly providerTasksCancelled: number;
  public readonly connectorQueuesCleared: number;
  public readonly receiverObservationsReceived: number;
  public readonly acousticHearingKnown: boolean;

  public constructor(options: ConversationOutcomeOptions) {
    if (!['completed', 'stopped', 'cancelled', 'failed'].includes(options.disposition)) {
      throw new RangeError(
        'disposition must be completed, stopped, cancelled, or failed',
      );
    }
    const counters: readonly [string, number][] = [
      ['turnsStarted', options.turnsStarted],
      ['turnsCompleted', options.turnsCompleted],
      ['turnsInterrupted', options.turnsInterrupted],
      ['transcriptUpdatesReceived', options.transcriptUpdatesReceived],
      ['speculativeResponsesStarted', options.speculativeResponsesStarted],
      ['speculativeResponsesReused', options.speculativeResponsesReused],
      ['outputGenerationsCancelled', options.outputGenerationsCancelled],
      ['outputFramesWritten', options.outputFramesWritten],
      ['providerTasksCancelled', options.providerTasksCancelled ?? 0],
      ['connectorQueuesCleared', options.connectorQueuesCleared ?? 0],
      [
        'receiverObservationsReceived',
        options.receiverObservationsReceived ?? 0,
      ],
    ];
    for (const [name, value] of counters) requireNonNegativeInteger(name, value);
    requireBoolean(
      'acousticHearingKnown',
      options.acousticHearingKnown ?? false,
    );
    this.disposition = options.disposition;
    this.turnsStarted = options.turnsStarted;
    this.turnsCompleted = options.turnsCompleted;
    this.turnsInterrupted = options.turnsInterrupted;
    this.transcriptUpdatesReceived = options.transcriptUpdatesReceived;
    this.speculativeResponsesStarted = options.speculativeResponsesStarted;
    this.speculativeResponsesReused = options.speculativeResponsesReused;
    this.outputGenerationsCancelled = options.outputGenerationsCancelled;
    this.outputFramesWritten = options.outputFramesWritten;
    this.history = immutableArray(options.history);
    this.events = immutableArray(options.events);
    this.failure = options.failure;
    this.providerTasksCancelled = options.providerTasksCancelled ?? 0;
    this.connectorQueuesCleared = options.connectorQueuesCleared ?? 0;
    this.receiverObservationsReceived =
      options.receiverObservationsReceived ?? 0;
    this.acousticHearingKnown = options.acousticHearingKnown ?? false;
    Object.freeze(this);
  }

  /** Whether the run ended normally and retained no failure. */
  public get success(): boolean {
    return (
      (this.disposition === 'completed' || this.disposition === 'stopped') &&
      this.failure === undefined
    );
  }
}
