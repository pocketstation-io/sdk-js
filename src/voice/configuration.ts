import {
  requireBoolean,
  requireFiniteNumber,
  requireInteger,
} from './validation.js';

/** Transcript or speech event that may interrupt active output. */
export type InterruptionTrigger = 'speech-started' | 'transcript-update';

/** Options for finite retained state and work limits. */
export interface VoiceLimitsOptions {
  readonly historyMessages?: number;
  readonly retainedEvents?: number;
  readonly transcriptStates?: number;
  readonly transcriptCharacters?: number;
  readonly responseCharacters?: number;
  readonly responseChunksPerTurn?: number;
  readonly toolObservationsPerTurn?: number;
  readonly generatedAudioFramesPerTurn?: number;
  readonly providerEventBytes?: number;
  readonly providerEventQueue?: number;
}

/** Finite retained state and work limits for voice composition. */
export class VoiceLimits {
  public readonly historyMessages: number;
  public readonly retainedEvents: number;
  public readonly transcriptStates: number;
  public readonly transcriptCharacters: number;
  public readonly responseCharacters: number;
  public readonly responseChunksPerTurn: number;
  public readonly toolObservationsPerTurn: number;
  public readonly generatedAudioFramesPerTurn: number;
  public readonly providerEventBytes: number;
  public readonly providerEventQueue: number;

  public constructor(options: VoiceLimitsOptions = {}) {
    const values = {
      historyMessages: options.historyMessages ?? 32,
      retainedEvents: options.retainedEvents ?? 128,
      transcriptStates: options.transcriptStates ?? 128,
      transcriptCharacters: options.transcriptCharacters ?? 32_768,
      responseCharacters: options.responseCharacters ?? 16_384,
      responseChunksPerTurn: options.responseChunksPerTurn ?? 1_024,
      toolObservationsPerTurn: options.toolObservationsPerTurn ?? 32,
      generatedAudioFramesPerTurn:
        options.generatedAudioFramesPerTurn ?? 3_000,
      providerEventBytes: options.providerEventBytes ?? 262_144,
      providerEventQueue: options.providerEventQueue ?? 128,
    };
    requireInteger('historyMessages', values.historyMessages, 1, 4_096);
    requireInteger('retainedEvents', values.retainedEvents, 1, 16_384);
    requireInteger('transcriptStates', values.transcriptStates, 1, 16_384);
    requireInteger(
      'transcriptCharacters',
      values.transcriptCharacters,
      1,
      1_000_000,
    );
    requireInteger(
      'responseCharacters',
      values.responseCharacters,
      1,
      1_000_000,
    );
    requireInteger(
      'responseChunksPerTurn',
      values.responseChunksPerTurn,
      1,
      65_536,
    );
    requireInteger(
      'toolObservationsPerTurn',
      values.toolObservationsPerTurn,
      1,
      4_096,
    );
    requireInteger(
      'generatedAudioFramesPerTurn',
      values.generatedAudioFramesPerTurn,
      1,
      1_000_000,
    );
    requireInteger(
      'providerEventBytes',
      values.providerEventBytes,
      1,
      4_194_304,
    );
    requireInteger(
      'providerEventQueue',
      values.providerEventQueue,
      1,
      16_384,
    );
    this.historyMessages = values.historyMessages;
    this.retainedEvents = values.retainedEvents;
    this.transcriptStates = values.transcriptStates;
    this.transcriptCharacters = values.transcriptCharacters;
    this.responseCharacters = values.responseCharacters;
    this.responseChunksPerTurn = values.responseChunksPerTurn;
    this.toolObservationsPerTurn = values.toolObservationsPerTurn;
    this.generatedAudioFramesPerTurn = values.generatedAudioFramesPerTurn;
    this.providerEventBytes = values.providerEventBytes;
    this.providerEventQueue = values.providerEventQueue;
    Object.freeze(this);
  }
}

/** Options for provider, output, cancellation, and shutdown deadlines. */
export interface VoiceDeadlinesOptions {
  readonly providerStartS?: number;
  readonly providerCloseS?: number;
  readonly responseS?: number;
  readonly synthesisS?: number;
  readonly outputWriteS?: number;
  readonly outputDrainS?: number;
  readonly cancellationS?: number;
  readonly signalWaitS?: number;
}

/** Deadlines for provider, output, cancellation, and shutdown work. */
export class VoiceDeadlines {
  public readonly providerStartS: number;
  public readonly providerCloseS: number;
  public readonly responseS: number;
  public readonly synthesisS: number;
  public readonly outputWriteS: number;
  public readonly outputDrainS: number;
  public readonly cancellationS: number;
  public readonly signalWaitS: number;

  public constructor(options: VoiceDeadlinesOptions = {}) {
    const values = {
      providerStartS: options.providerStartS ?? 10,
      providerCloseS: options.providerCloseS ?? 10,
      responseS: options.responseS ?? 60,
      synthesisS: options.synthesisS ?? 60,
      outputWriteS: options.outputWriteS ?? 1,
      outputDrainS: options.outputDrainS ?? 5,
      cancellationS: options.cancellationS ?? 2,
      signalWaitS: options.signalWaitS ?? 0.1,
    };
    requireFiniteNumber('providerStartS', values.providerStartS, 0, 300);
    requireFiniteNumber('providerCloseS', values.providerCloseS, 0, 300);
    requireFiniteNumber('responseS', values.responseS, 0, 900);
    requireFiniteNumber('synthesisS', values.synthesisS, 0, 900);
    requireFiniteNumber('outputWriteS', values.outputWriteS, 0, 60);
    requireFiniteNumber('outputDrainS', values.outputDrainS, 0, 60);
    requireFiniteNumber('cancellationS', values.cancellationS, 0, 60);
    requireFiniteNumber('signalWaitS', values.signalWaitS, 0, 1);
    this.providerStartS = values.providerStartS;
    this.providerCloseS = values.providerCloseS;
    this.responseS = values.responseS;
    this.synthesisS = values.synthesisS;
    this.outputWriteS = values.outputWriteS;
    this.outputDrainS = values.outputDrainS;
    this.cancellationS = values.cancellationS;
    this.signalWaitS = values.signalWaitS;
    Object.freeze(this);
  }
}

/** Options for cancelling active output after new input is observed. */
export interface InterruptionConfigOptions {
  readonly enabled?: boolean;
  readonly trigger?: InterruptionTrigger;
  readonly minimumSpeechMs?: number;
  readonly cancelProviderWork?: boolean;
  readonly cancelPendingOutput?: boolean;
  readonly requireReceiverObservation?: boolean;
}

/** Policy for cancelling a response after new input is observed. */
export class InterruptionConfig {
  public readonly enabled: boolean;
  public readonly trigger: InterruptionTrigger;
  public readonly minimumSpeechMs: number;
  public readonly cancelProviderWork: boolean;
  public readonly cancelPendingOutput: boolean;
  public readonly requireReceiverObservation: boolean;

  public constructor(options: InterruptionConfigOptions = {}) {
    const enabled = options.enabled ?? true;
    const trigger = options.trigger ?? 'speech-started';
    const cancelProviderWork = options.cancelProviderWork ?? true;
    const cancelPendingOutput = options.cancelPendingOutput ?? true;
    requireBoolean('enabled', enabled);
    requireBoolean('cancelProviderWork', cancelProviderWork);
    requireBoolean('cancelPendingOutput', cancelPendingOutput);
    requireBoolean(
      'requireReceiverObservation',
      options.requireReceiverObservation ?? false,
    );
    if (trigger !== 'speech-started' && trigger !== 'transcript-update') {
      throw new RangeError(
        'trigger must be speech-started or transcript-update',
      );
    }
    requireInteger(
      'minimumSpeechMs',
      options.minimumSpeechMs ?? 120,
      0,
      10_000,
    );
    if (enabled && !cancelProviderWork && !cancelPendingOutput) {
      throw new RangeError(
        'enabled interruption must cancel provider work, pending output, or both',
      );
    }
    this.enabled = enabled;
    this.trigger = trigger;
    this.minimumSpeechMs = options.minimumSpeechMs ?? 120;
    this.cancelProviderWork = cancelProviderWork;
    this.cancelPendingOutput = cancelPendingOutput;
    this.requireReceiverObservation =
      options.requireReceiverObservation ?? false;
    Object.freeze(this);
  }
}

/** Flat compatibility options for one bounded voice conversation. */
export interface ConversationConfigOptions {
  readonly historyCapacity?: number;
  readonly eventCapacity?: number;
  readonly transcriptStateCapacity?: number;
  readonly maximumTranscriptCharacters?: number;
  readonly maximumResponseCharacters?: number;
  readonly maximumResponseChunksPerTurn?: number;
  readonly maximumToolEventsPerTurn?: number;
  readonly maximumOutputFramesPerTurn?: number;
  readonly providerEventBytes?: number;
  readonly providerEventQueueCapacity?: number;
  readonly providerStartTimeoutS?: number;
  readonly providerCloseTimeoutS?: number;
  readonly responseTimeoutS?: number;
  readonly synthesisTimeoutS?: number;
  readonly outputWriteTimeoutS?: number;
  readonly outputDrainTimeoutS?: number;
  readonly cancellationTimeoutS?: number;
  readonly signalWaitTimeoutS?: number;
  readonly interruption?: InterruptionConfig;
}

/** Grouped construction options for one bounded voice conversation. */
export interface ConversationConfigParts {
  readonly limits?: VoiceLimits;
  readonly deadlines?: VoiceDeadlines;
  readonly interruption?: InterruptionConfig;
}

/** Validated limits, deadlines, and interruption policy for one run. */
export class ConversationConfig {
  public readonly historyCapacity: number;
  public readonly eventCapacity: number;
  public readonly transcriptStateCapacity: number;
  public readonly maximumTranscriptCharacters: number;
  public readonly maximumResponseCharacters: number;
  public readonly maximumResponseChunksPerTurn: number;
  public readonly maximumToolEventsPerTurn: number;
  public readonly maximumOutputFramesPerTurn: number;
  public readonly providerEventBytes: number;
  public readonly providerEventQueueCapacity: number;
  public readonly providerStartTimeoutS: number;
  public readonly providerCloseTimeoutS: number;
  public readonly responseTimeoutS: number;
  public readonly synthesisTimeoutS: number;
  public readonly outputWriteTimeoutS: number;
  public readonly outputDrainTimeoutS: number;
  public readonly cancellationTimeoutS: number;
  public readonly signalWaitTimeoutS: number;
  public readonly interruption: InterruptionConfig;

  public constructor(options: ConversationConfigOptions = {}) {
    const limits = new VoiceLimits({
      historyMessages: options.historyCapacity,
      retainedEvents: options.eventCapacity,
      transcriptStates: options.transcriptStateCapacity,
      transcriptCharacters: options.maximumTranscriptCharacters,
      responseCharacters: options.maximumResponseCharacters,
      responseChunksPerTurn: options.maximumResponseChunksPerTurn,
      toolObservationsPerTurn: options.maximumToolEventsPerTurn,
      generatedAudioFramesPerTurn: options.maximumOutputFramesPerTurn,
      providerEventBytes: options.providerEventBytes,
      providerEventQueue: options.providerEventQueueCapacity,
    });
    const deadlines = new VoiceDeadlines({
      providerStartS: options.providerStartTimeoutS,
      providerCloseS: options.providerCloseTimeoutS,
      responseS: options.responseTimeoutS,
      synthesisS: options.synthesisTimeoutS,
      outputWriteS: options.outputWriteTimeoutS,
      outputDrainS: options.outputDrainTimeoutS,
      cancellationS: options.cancellationTimeoutS,
      signalWaitS: options.signalWaitTimeoutS,
    });
    this.historyCapacity = limits.historyMessages;
    this.eventCapacity = limits.retainedEvents;
    this.transcriptStateCapacity = limits.transcriptStates;
    this.maximumTranscriptCharacters = limits.transcriptCharacters;
    this.maximumResponseCharacters = limits.responseCharacters;
    this.maximumResponseChunksPerTurn = limits.responseChunksPerTurn;
    this.maximumToolEventsPerTurn = limits.toolObservationsPerTurn;
    this.maximumOutputFramesPerTurn = limits.generatedAudioFramesPerTurn;
    this.providerEventBytes = limits.providerEventBytes;
    this.providerEventQueueCapacity = limits.providerEventQueue;
    this.providerStartTimeoutS = deadlines.providerStartS;
    this.providerCloseTimeoutS = deadlines.providerCloseS;
    this.responseTimeoutS = deadlines.responseS;
    this.synthesisTimeoutS = deadlines.synthesisS;
    this.outputWriteTimeoutS = deadlines.outputWriteS;
    this.outputDrainTimeoutS = deadlines.outputDrainS;
    this.cancellationTimeoutS = deadlines.cancellationS;
    this.signalWaitTimeoutS = deadlines.signalWaitS;
    this.interruption = options.interruption ?? new InterruptionConfig();
    Object.freeze(this);
  }

  /** Finite retained-state limits grouped for provider-neutral use. */
  public get limits(): VoiceLimits {
    return new VoiceLimits({
      historyMessages: this.historyCapacity,
      retainedEvents: this.eventCapacity,
      transcriptStates: this.transcriptStateCapacity,
      transcriptCharacters: this.maximumTranscriptCharacters,
      responseCharacters: this.maximumResponseCharacters,
      responseChunksPerTurn: this.maximumResponseChunksPerTurn,
      toolObservationsPerTurn: this.maximumToolEventsPerTurn,
      generatedAudioFramesPerTurn: this.maximumOutputFramesPerTurn,
      providerEventBytes: this.providerEventBytes,
      providerEventQueue: this.providerEventQueueCapacity,
    });
  }

  /** Provider and lifecycle deadlines grouped for provider-neutral use. */
  public get deadlines(): VoiceDeadlines {
    return new VoiceDeadlines({
      providerStartS: this.providerStartTimeoutS,
      providerCloseS: this.providerCloseTimeoutS,
      responseS: this.responseTimeoutS,
      synthesisS: this.synthesisTimeoutS,
      outputWriteS: this.outputWriteTimeoutS,
      outputDrainS: this.outputDrainTimeoutS,
      cancellationS: this.cancellationTimeoutS,
      signalWaitS: this.signalWaitTimeoutS,
    });
  }

  /** Construct the flat compatibility form from grouped limits and deadlines. */
  public static fromParts(parts: ConversationConfigParts = {}): ConversationConfig {
    const limits = parts.limits ?? new VoiceLimits();
    const deadlines = parts.deadlines ?? new VoiceDeadlines();
    return new ConversationConfig({
      historyCapacity: limits.historyMessages,
      eventCapacity: limits.retainedEvents,
      transcriptStateCapacity: limits.transcriptStates,
      maximumTranscriptCharacters: limits.transcriptCharacters,
      maximumResponseCharacters: limits.responseCharacters,
      maximumResponseChunksPerTurn: limits.responseChunksPerTurn,
      maximumToolEventsPerTurn: limits.toolObservationsPerTurn,
      maximumOutputFramesPerTurn: limits.generatedAudioFramesPerTurn,
      providerEventBytes: limits.providerEventBytes,
      providerEventQueueCapacity: limits.providerEventQueue,
      providerStartTimeoutS: deadlines.providerStartS,
      providerCloseTimeoutS: deadlines.providerCloseS,
      responseTimeoutS: deadlines.responseS,
      synthesisTimeoutS: deadlines.synthesisS,
      outputWriteTimeoutS: deadlines.outputWriteS,
      outputDrainTimeoutS: deadlines.outputDrainS,
      cancellationTimeoutS: deadlines.cancellationS,
      signalWaitTimeoutS: deadlines.signalWaitS,
      interruption: parts.interruption ?? new InterruptionConfig(),
    });
  }
}
