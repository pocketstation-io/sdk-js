import {
  DuplexVoiceCapabilities,
  ResponseCapabilities,
  SpeechDetectionCapabilities,
  SynthesisCapabilities,
  TranscriptionCapabilities,
  VoiceCapabilities,
} from './capabilities.js';
import { ConversationConfig } from './configuration.js';
import type {
  DuplexVoiceConnection,
  DuplexVoiceModel,
} from './duplex.js';
import { DuplexVoiceContext } from './duplex.js';
import {
  UnsupportedVoiceCapabilityError,
  VoiceConfigurationError,
} from './errors.js';
import { VoiceEvent } from './events.js';
import {
  ConversationResponse,
  ResponseChunk,
  type ResponseItem,
  type ResponseModel,
  ResponseRequest,
} from './response.js';
import type {
  SpeechActivity,
  SpeechDetector,
} from './speech-detection.js';
import type { SpeechSynthesizer } from './synthesis.js';
import {
  SynthesisChunk,
  SynthesisRequest,
  type SynthesisItem,
} from './synthesis.js';
import type {
  StreamingTranscriber,
  TranscriptionConnection,
} from './transcription.js';
import { TranscriptUpdate } from './transcription.js';
import {
  ConversationContext,
  ConversationMessage,
  ConversationOutcome,
  ConversationTurn,
  type ConversationDisposition,
  type ConversationRole,
} from './turns.js';
import { characterCount } from './validation.js';

/** Source and Session timing carried by a transcript signal. */
export interface ConversationSignalTiming {
  readonly sourceTimestampNs?: bigint;
  readonly observedTimestampNs: bigint;
  readonly sessionTimestampNs?: bigint;
  readonly durationNs?: bigint;
}

/** Source identity carried by a transcript signal. */
export interface ConversationSignalLineage {
  readonly sourceId: bigint;
  readonly streamId: bigint;
  readonly sequenceNumber: bigint;
}

/** Minimum signal envelope required by conversation orchestration. */
export interface ConversationSignalEnvelope {
  readonly payload: unknown;
  readonly timing: ConversationSignalTiming;
  readonly lineage?: ConversationSignalLineage;
}

/** Stable subscription identity required by one running Session. */
export interface ConversationSubscription {
  readonly sessionId: bigint;
}

/** End marker returned by a bounded signal read. */
export interface ConversationEndOfStream {
  readonly kind: 'end-of-stream';
}

/** One bounded transcript-signal reader. */
export interface ConversationSignalStream<
  TEnvelope extends ConversationSignalEnvelope = ConversationSignalEnvelope,
> {
  read(options?: {
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
  }): Promise<TEnvelope | ConversationEndOfStream | undefined>;
}

/** Delivery counters used to prove that generated output drained. */
export interface ConversationRouteMetrics {
  readonly routeId: bigint;
  readonly endpointId: bigint;
  readonly delivery: {
    readonly queueDepthFrames: bigint;
    readonly framesDeliveredTotal: bigint;
    readonly framesDroppedTotal: bigint;
    readonly discardedOutputFramesTotal?: bigint;
  };
  readonly endpoint: {
    readonly framesDroppedTotal: bigint;
    readonly failuresTotal: bigint;
  };
}

/** Session metrics required by the generated-output drain gate. */
export interface ConversationSessionMetrics {
  readonly routes: readonly ConversationRouteMetrics[];
}

/** Started Session boundary used without importing a platform package. */
export interface ConversationRunningSession<
  TSubscription extends ConversationSubscription = ConversationSubscription,
  TEnvelope extends ConversationSignalEnvelope = ConversationSignalEnvelope,
> {
  readonly sessionId: bigint;
  signals(subscription: TSubscription): ConversationSignalStream<TEnvelope>;
  metrics(): Promise<ConversationSessionMetrics>;
}

/** Replaceable generated-output identity. */
export interface ConversationOutputGeneration {
  readonly id: bigint;
  readonly active: boolean;
  cancel(): boolean;
}

/** Routes declared from one generated-audio Source. */
export interface ConversationDeliveryTargets {
  readonly routeIds: readonly bigint[];
  readonly endpointIds: readonly bigint[];
}

/** Minimum generated-audio boundary required by the orchestrator. */
export interface ConversationOutput<TSamples = unknown> {
  readonly config: {
    readonly sampleRateHz: number;
    readonly channels: number;
  };
  readonly output: {
    readonly sessionId: bigint;
    _conversationDeliveryTargets?(): ConversationDeliveryTargets;
  };
  beginOutput(): ConversationOutputGeneration;
  write(
    samples: TSamples,
    options?: {
      readonly discontinuity?: boolean;
      readonly generation?: ConversationOutputGeneration;
      readonly timeoutMs?: number;
      readonly signal?: AbortSignal;
    },
  ): Promise<void>;
  observations(): {
    readonly bufferSlots: bigint;
    readonly availableBuffers: bigint;
  };
}

/** Decode one Session signal into a transcript revision. */
export type TranscriptDecoder<
  TEnvelope extends ConversationSignalEnvelope = ConversationSignalEnvelope,
> = (envelope: TEnvelope) => TranscriptUpdate | undefined;

/** Produce complete or incremental response values for one transcript. */
export type ResponseHandler = (
  transcript: TranscriptUpdate,
  context: ConversationContext,
  signal: AbortSignal,
) =>
  | ResponseItem
  | AsyncIterable<ResponseItem>
  | Promise<ResponseItem | AsyncIterable<ResponseItem>>;

/** Produce generated PCM incrementally for one response fragment. */
export type SynthesisHandler<TSamples = unknown> = (
  response: ResponseChunk,
  turn: ConversationTurn,
  signal: AbortSignal,
) => AsyncIterable<TSamples> | Promise<AsyncIterable<TSamples>>;

interface ProviderLifecycle {
  start?(signal?: AbortSignal): void | Promise<void>;
  close?(signal?: AbortSignal): void | Promise<void>;
}

/** Low-level component options over an already-declared Session graph. */
export interface ConversationOptions<
  TSubscription extends ConversationSubscription = ConversationSubscription,
  TSamples = unknown,
  TEnvelope extends ConversationSignalEnvelope = ConversationSignalEnvelope,
> {
  readonly transcripts?: TSubscription;
  readonly respond?: ResponseHandler;
  readonly synthesize?: SynthesisHandler<TSamples>;
  readonly output: ConversationOutput<TSamples>;
  readonly config?: ConversationConfig;
  readonly decodeTranscript?: TranscriptDecoder<TEnvelope>;
  readonly providers?: readonly ProviderLifecycle[];
  readonly speechActivity?: AsyncIterable<SpeechActivity>;
  readonly voiceModel?: DuplexVoiceModel;
  readonly voiceContext?: DuplexVoiceContext;
  readonly duplexConnection?: DuplexVoiceConnection;
  readonly capabilities?: VoiceCapabilities;
}

/** Separate STT, response, synthesis, and optional VAD declaration. */
export interface ComponentConversationOptions<
  TSession = unknown,
  TInput = unknown,
  TSubscription extends ConversationSubscription = ConversationSubscription,
  TSamples = unknown,
  TEnvelope extends ConversationSignalEnvelope = ConversationSignalEnvelope,
> {
  readonly session: TSession;
  readonly input: TInput;
  readonly output: ConversationOutput<TSamples>;
  readonly stt: StreamingTranscriber<
    TSession,
    TInput,
    TranscriptionConnection<TSubscription, TEnvelope>
  >;
  readonly llm: ResponseModel;
  readonly tts: SpeechSynthesizer<TSamples>;
  readonly vad?: SpeechDetector<TSession, TInput>;
  readonly config?: ConversationConfig;
}

/** Stateful duplex-provider declaration. */
export interface DuplexConversationOptions<
  TSession = unknown,
  TInput = unknown,
  TSamples = unknown,
  TRunning = unknown,
> {
  readonly session: TSession;
  readonly input: TInput;
  readonly output: ConversationOutput<TSamples>;
  readonly voiceModel: DuplexVoiceModel<TSession, TInput, ConversationOutput<TSamples>, TRunning>;
  readonly config?: ConversationConfig;
}

/** One Session-owned voice declaration using duplex, provider, or callback mode. */
export interface ConversationDeclarationOptions<
  TSession = unknown,
  TInput = unknown,
  TSubscription extends ConversationSubscription = ConversationSubscription,
  TSamples = unknown,
  TEnvelope extends ConversationSignalEnvelope = ConversationSignalEnvelope,
  TRunning = unknown,
> {
  readonly session: TSession;
  readonly input?: TInput;
  readonly output: ConversationOutput<TSamples>;
  readonly voiceModel?: DuplexVoiceModel<
    TSession,
    TInput,
    ConversationOutput<TSamples>,
    TRunning
  >;
  readonly stt?: StreamingTranscriber<
    TSession,
    TInput,
    TranscriptionConnection<TSubscription, TEnvelope>
  >;
  readonly llm?: ResponseModel;
  readonly tts?: SpeechSynthesizer<TSamples>;
  readonly vad?: SpeechDetector<TSession, TInput>;
  readonly transcripts?: TSubscription;
  readonly respond?: ResponseHandler;
  readonly synthesize?: SynthesisHandler<TSamples>;
  readonly config?: ConversationConfig;
  readonly decodeTranscript?: TranscriptDecoder<TEnvelope>;
}

/** Options for one started conversation. */
export interface ConversationRunOptions {
  /** Cancels provider/output work while preserving the owning Session. */
  readonly signal?: AbortSignal;
}

interface TranscriptRecord {
  readonly revision: number;
  readonly stablePrefix: string;
  readonly final: boolean;
}

class TranscriptState {
  readonly #capacity: number;
  readonly #maximumCharacters: number;
  readonly #records = new Map<string, TranscriptRecord>();

  public constructor(capacity: number, maximumCharacters: number) {
    this.#capacity = capacity;
    this.#maximumCharacters = maximumCharacters;
  }

  public accept(update: TranscriptUpdate): void {
    if (characterCount(update.text) > this.#maximumCharacters) {
      throw new RangeError('transcript exceeded maximumTranscriptCharacters');
    }
    const previous = this.#records.get(update.utteranceId);
    if (previous !== undefined) {
      if (previous.final) {
        throw new RangeError('a final utterance cannot receive another revision');
      }
      if (update.revision <= previous.revision) {
        throw new RangeError('transcript revisions must increase');
      }
      if (!update.stablePrefix.startsWith(previous.stablePrefix)) {
        throw new RangeError('stable transcript text cannot change or shrink');
      }
      this.#records.delete(update.utteranceId);
    } else if (this.#records.size >= this.#capacity) {
      const oldest = this.#records.entries().next().value as
        | [string, TranscriptRecord]
        | undefined;
      if (oldest === undefined || !oldest[1].final) {
        throw new Error('transcriptStateCapacity is exhausted');
      }
      this.#records.delete(oldest[0]);
    }
    this.#records.set(update.utteranceId, {
      revision: update.revision,
      stablePrefix: update.stablePrefix,
      final: update.final,
    });
  }
}

interface Speculation {
  readonly update: TranscriptUpdate;
  readonly controller: AbortController;
  readonly task: Promise<readonly ResponseChunk[]>;
}

interface Delivery {
  readonly turn: ConversationTurn;
  readonly generation: ConversationOutputGeneration;
  readonly controller: AbortController;
  readonly task: Promise<void>;
  settled: boolean;
  failure: unknown;
  interruptionCounted: boolean;
}

interface WatchedTask {
  readonly task: Promise<void>;
  settled: boolean;
  failure: unknown;
}

/**
 * Coordinate transcript, response, synthesis, and generated-audio work.
 *
 * The owning Session retains Sources, routing, recording, and capture. This
 * object owns only finite provider work and bounded conversation state.
 */
export class Conversation<
  TSubscription extends ConversationSubscription = ConversationSubscription,
  TSamples = unknown,
  TEnvelope extends ConversationSignalEnvelope = ConversationSignalEnvelope,
> {
  readonly #transcripts: TSubscription | undefined;
  readonly #respond: ResponseHandler | undefined;
  readonly #synthesize: SynthesisHandler<TSamples> | undefined;
  readonly #output: ConversationOutput<TSamples>;
  readonly #config: ConversationConfig;
  readonly #decodeTranscript: TranscriptDecoder<TEnvelope>;
  readonly #providers: readonly ProviderLifecycle[];
  readonly #speechActivity: AsyncIterable<SpeechActivity> | undefined;
  readonly #voiceModel: DuplexVoiceModel | undefined;
  readonly #duplexConnection: DuplexVoiceConnection | undefined;
  readonly #capabilities: VoiceCapabilities | undefined;
  readonly #transcriptState: TranscriptState;
  readonly #history: ConversationMessage[] = [];
  readonly #events: VoiceEvent[] = [];
  #stopRequested = false;
  #running = false;
  #hasRun = false;
  #discontinuityPending = false;
  #turnsStarted = 0;
  #turnsCompleted = 0;
  #turnsInterrupted = 0;
  #transcriptUpdatesReceived = 0;
  #speculativeResponsesStarted = 0;
  #speculativeResponsesReused = 0;
  #outputGenerationsCancelled = 0;
  #outputFramesWritten = 0;
  #providerTasksCancelled = 0;
  #outcome: ConversationOutcome | undefined;
  #activeDelivery: Delivery | undefined;
  #runController: AbortController | undefined;
  #readController: AbortController | undefined;
  #asynchronousFailure: unknown;

  public constructor(options: ConversationOptions<TSubscription, TSamples, TEnvelope>) {
    const componentMissing =
      options.transcripts === undefined ||
      options.respond === undefined ||
      options.synthesize === undefined;
    if (options.voiceModel === undefined && componentMissing) {
      throw new VoiceConfigurationError(
        'transcripts, respond, and synthesize are required for a component voice conversation',
        configurationErrorOptions(),
      );
    }
    if (options.voiceModel !== undefined && options.voiceContext === undefined) {
      throw new VoiceConfigurationError(
        'voiceContext is required with voiceModel',
        configurationErrorOptions(),
      );
    }
    if (
      options.voiceModel !== undefined &&
      options.duplexConnection === undefined
    ) {
      throw new VoiceConfigurationError(
        'duplexConnection is required with voiceModel',
        configurationErrorOptions(),
      );
    }
    if (
      options.voiceModel !== undefined &&
      (options.transcripts !== undefined ||
        options.respond !== undefined ||
        options.synthesize !== undefined)
    ) {
      throw new VoiceConfigurationError(
        'voiceModel cannot be combined with transcripts, respond, or synthesize',
        configurationErrorOptions(),
      );
    }
    if (
      options.transcripts !== undefined &&
      options.transcripts.sessionId !== options.output.output.sessionId
    ) {
      throw new VoiceConfigurationError(
        'transcripts and output must belong to the same Session',
        configurationErrorOptions(),
      );
    }
    this.#transcripts = options.transcripts;
    this.#respond = options.respond;
    this.#synthesize = options.synthesize;
    this.#output = options.output;
    this.#config = options.config ?? new ConversationConfig();
    this.#decodeTranscript =
      options.decodeTranscript ??
      (defaultTranscriptDecoder as TranscriptDecoder<TEnvelope>);
    this.#providers = Object.freeze([...(options.providers ?? [])]);
    this.#speechActivity = options.speechActivity;
    this.#voiceModel = options.voiceModel;
    this.#duplexConnection = options.duplexConnection;
    this.#capabilities = options.capabilities;
    this.#transcriptState = new TranscriptState(
      this.#config.transcriptStateCapacity,
      this.#config.maximumTranscriptCharacters,
    );
  }

  /** Declare separate STT, response, synthesis, and optional VAD stages. */
  public static fromComponents<
    TSession,
    TInput,
    TSubscription extends ConversationSubscription,
    TSamples,
    TEnvelope extends ConversationSignalEnvelope,
  >(
    options: ComponentConversationOptions<
      TSession,
      TInput,
      TSubscription,
      TSamples,
      TEnvelope
    >,
  ): Conversation<TSubscription, TSamples, TEnvelope> {
    const config = options.config ?? new ConversationConfig();
    const capabilities = validateComponents(
      options.stt,
      options.llm,
      options.tts,
      options.vad,
      config,
    );
    const transcription = options.stt.transcribe({
      session: options.session,
      input: options.input,
    });
    validateTranscriptionConnection(transcription);
    const speechActivity = options.vad?.detect({
      session: options.session,
      input: options.input,
    });
    const providers: ProviderLifecycle[] = [
      transcription,
      options.llm,
      options.tts,
    ];
    if (options.vad !== undefined) providers.push(options.vad);
    return new Conversation({
      transcripts: transcription.subscription,
      respond: (update, context, signal) =>
        options.llm.respond(new ResponseRequest(update, context, signal)),
      synthesize: synthesisAdapter(options.tts, options.output),
      output: options.output,
      config,
      decodeTranscript: (envelope) => transcription.decode(envelope),
      providers,
      speechActivity,
      capabilities,
    });
  }

  /** Declare one stateful duplex provider over existing Session boundaries. */
  public static fromDuplex<TSession, TInput, TSamples, TRunning>(
    options: DuplexConversationOptions<TSession, TInput, TSamples, TRunning>,
  ): Conversation<ConversationSubscription, TSamples> {
    const config = options.config ?? new ConversationConfig();
    const capabilities = validateDuplex(options.voiceModel, config);
    const context = new DuplexVoiceContext(
      options.session,
      options.input,
      options.output,
      config,
    );
    const connection = options.voiceModel.connect(context);
    validateDuplexConnection(connection);
    return new Conversation({
      output: options.output,
      config,
      voiceModel: options.voiceModel,
      voiceContext: context,
      duplexConnection: connection,
      capabilities,
    });
  }

  public get config(): ConversationConfig {
    return this.#config;
  }

  public get capabilities(): VoiceCapabilities | undefined {
    return this.#capabilities;
  }

  public get outcome(): ConversationOutcome | undefined {
    return this.#outcome;
  }

  public get history(): readonly ConversationMessage[] {
    return Object.freeze([...this.#history]);
  }

  public get events(): readonly VoiceEvent[] {
    return Object.freeze([...this.#events]);
  }

  /** Request a normal stop at the next finite signal wait. */
  public stop(): void {
    this.#stopRequested = true;
    this.#readController?.abort(abortError('conversation stop requested'));
    this.#duplexConnection?.stop();
  }

  /** Cancel active provider work and its selected pending output. */
  public async interrupt(): Promise<void> {
    if (this.#duplexConnection !== undefined) {
      await callWithTimeout(
        (signal) => this.#duplexConnection?.interrupt(signal),
        this.#config.cancellationTimeoutS,
        'duplex interruption',
      );
      return;
    }
    if (this.#activeDelivery !== undefined) {
      await this.#interruptDelivery(this.#activeDelivery);
    }
  }

  /** Cancel pending output without stopping unrelated Session work. */
  public async cancelOutput(): Promise<void> {
    if (this.#duplexConnection !== undefined) {
      await callWithTimeout(
        (signal) => this.#duplexConnection?.cancelOutput(signal),
        this.#config.cancellationTimeoutS,
        'duplex output cancellation',
      );
      return;
    }
    if (this.#activeDelivery !== undefined) {
      this.#cancelDeliveryOutput(this.#activeDelivery);
    }
  }

  /** Start once and return an independently controllable handle. */
  public async start(
    running: ConversationRunningSession<TSubscription, TEnvelope>,
  ): Promise<RunningConversation<TSubscription, TSamples, TEnvelope>> {
    const task = this.run(running);
    await Promise.resolve();
    return new RunningConversation(this, task);
  }

  /** Run until the transcript endpoint closes, stop is requested, or cancelled. */
  public async run(
    running: ConversationRunningSession<TSubscription, TEnvelope>,
    options: ConversationRunOptions = {},
  ): Promise<ConversationOutcome> {
    if (this.#running) throw new Error('Conversation is already running');
    if (this.#hasRun) throw new Error('Conversation can run only once');
    if (running.sessionId !== this.#output.output.sessionId) {
      throw new VoiceConfigurationError(
        'running Session does not own this conversation',
        configurationErrorOptions(),
      );
    }
    this.#running = true;
    this.#hasRun = true;
    this.#runController = new AbortController();
    const detachAbort = forwardAbort(options.signal, this.#runController);
    try {
      return this.#voiceModel === undefined
        ? await this.#runComponents(running, this.#runController.signal)
        : await this.#runDuplex(running, this.#runController.signal);
    } finally {
      detachAbort();
      this.#running = false;
      this.#activeDelivery = undefined;
      this.#runController = undefined;
    }
  }

  /** @internal */
  public _abort(): void {
    this.#runController?.abort(new Error('conversation aborted'));
  }

  async #runComponents(
    running: ConversationRunningSession<TSubscription, TEnvelope>,
    runSignal: AbortSignal,
  ): Promise<ConversationOutcome> {
    const transcripts = this.#transcripts;
    const respond = this.#respond;
    const synthesize = this.#synthesize;
    if (transcripts === undefined || respond === undefined || synthesize === undefined) {
      throw new VoiceConfigurationError(
        'component conversation is missing a required stage',
        configurationErrorOptions(),
      );
    }
    const stream = running.signals(transcripts);
    const startedProviders: ProviderLifecycle[] = [];
    let disposition: ConversationDisposition = 'completed';
    let failure: string | undefined;
    let delivery: Delivery | undefined;
    let speculation: Speculation | undefined;
    let speech: WatchedTask | undefined;
    let speechController: AbortController | undefined;
    try {
      for (const provider of uniqueProviders(
        ...this.#providers,
        respond as unknown as ProviderLifecycle,
        synthesize as unknown as ProviderLifecycle,
      )) {
        await providerLifecycle(
          provider,
          'start',
          this.#config.providerStartTimeoutS,
          runSignal,
        );
        startedProviders.push(provider);
      }
      if (this.#speechActivity !== undefined) {
        speechController = linkedController(runSignal);
        speech = watchTask(
          this.#watchSpeech(this.#speechActivity, speechController.signal),
        );
      }
      while (!this.#stopRequested) {
        throwIfAborted(runSignal, 'conversation cancelled');
        if (speech?.settled === true && speech.failure !== undefined) {
          throw speech.failure;
        }
        if (delivery?.settled === true) {
          if (delivery.failure !== undefined) throw delivery.failure;
          if (this.#activeDelivery === delivery) this.#activeDelivery = undefined;
          delivery = undefined;
        }
        const readController = linkedController(runSignal);
        this.#readController = readController;
        let result: TEnvelope | ConversationEndOfStream | undefined;
        try {
          result = await stream.read({
            timeoutMs: Math.max(
              1,
              Math.ceil(this.#config.signalWaitTimeoutS * 1_000),
            ),
            signal: readController.signal,
          });
        } catch (error) {
          if (this.#stopRequested && isAbort(error)) break;
          if (this.#asynchronousFailure !== undefined) {
            const asynchronousFailure = this.#asynchronousFailure;
            this.#asynchronousFailure = undefined;
            throw asynchronousFailure;
          }
          throw error;
        } finally {
          readController.abort(abortError('signal read completed'));
          if (this.#readController === readController) {
            this.#readController = undefined;
          }
        }
        if (isEndOfStream(result)) break;
        if (result === undefined) continue;
        const update = this.#decodeTranscript(result);
        if (update === undefined) continue;
        this.#transcriptState.accept(update);
        this.#transcriptUpdatesReceived += 1;
        this.#event('transcript.updated', { update });

        if (
          delivery !== undefined &&
          update.interrupts &&
          (this.#providers.length === 0 ||
            this.#config.interruption.trigger === 'transcript-update')
        ) {
          await this.#interruptDelivery(delivery, {
            cancelProviderWork: this.#config.interruption.cancelProviderWork,
            cancelPendingOutput: this.#config.interruption.cancelPendingOutput,
          });
          delivery = undefined;
          this.#activeDelivery = undefined;
        }

        if (!update.final) {
          if (update.text.trim().length === 0) continue;
          if (
            speculation !== undefined &&
            (speculation.update.utteranceId !== update.utteranceId ||
              speculation.update.text !== update.text)
          ) {
            await this.#cancelSpeculation(speculation);
            speculation = undefined;
          }
          if (speculation === undefined) {
            this.#speculativeResponsesStarted += 1;
            this.#event('response.preparing', { update });
            const controller = linkedController(runSignal);
            const task = this.#prepareResponse(update, controller.signal);
            // A speculative response may fail before the final revision arrives.
            // Retain the original rejection for the eventual await while also
            // marking it observed immediately so runtimes do not report an
            // unhandled rejection between transcript revisions.
            void task.catch(() => {});
            speculation = {
              update,
              controller,
              task,
            };
          }
          continue;
        }

        let prepared: readonly ResponseChunk[] | undefined;
        if (speculation !== undefined) {
          if (
            speculation.update.utteranceId === update.utteranceId &&
            speculation.update.text === update.text
          ) {
            prepared = await speculation.task;
            speculation.controller.abort(
              abortError('speculative response completed'),
            );
            this.#speculativeResponsesReused += 1;
            this.#event('response.prepared', { update });
          } else {
            await this.#cancelSpeculation(speculation);
          }
          speculation = undefined;
        }

        const turn = this.#turn(result, update);
        this.#turnsStarted += 1;
        this.#appendMessage('user', update.text, turn.id);
        this.#event('turn.started', { turn, update });
        const generation = this.#output.beginOutput();
        this.#event('output.started', { turn, update, generation });
        const controller = linkedController(runSignal);
        const task = this.#deliverResponse(
          turn,
          update,
          generation,
          prepared,
          controller.signal,
        );
        delivery = watchDelivery(turn, generation, controller, task);
        this.#activeDelivery = delivery;
        await Promise.resolve();
      }

      if (speculation !== undefined) await this.#cancelSpeculation(speculation);
      if (delivery !== undefined) {
        if (this.#stopRequested) {
          await this.#interruptDelivery(delivery);
          disposition = 'stopped';
        } else {
          await delivery.task;
          delivery.settled = true;
        }
      } else if (this.#stopRequested) {
        disposition = 'stopped';
      }
      await this.#waitOutputDrained(running, runSignal);
    } catch (error) {
      if (speculation !== undefined) {
        const pendingSpeculation = speculation;
        await settleCleanup(() => this.#cancelSpeculation(pendingSpeculation));
      }
      if (delivery !== undefined && !delivery.settled) {
        const pendingDelivery = delivery;
        await settleCleanup(() => this.#interruptDelivery(pendingDelivery));
      }
      if (isAbort(error) || runSignal.aborted) {
        disposition = 'cancelled';
      } else {
        disposition = 'failed';
        failure = boundedError(error, this.#config.providerEventBytes);
        this.#event('conversation.failed', { detail: failure });
      }
    } finally {
      if (speech !== undefined) {
        speechController?.abort(abortError('conversation finished'));
        const pendingSpeech = speech;
        await settleCleanup(() =>
          withDeadline(
            pendingSpeech.task,
            deadlineAfter(this.#config.cancellationTimeoutS),
            'speech activity cancellation',
          ),
        );
      }
      for (const provider of [...startedProviders].reverse()) {
        try {
          await providerLifecycle(
            provider,
            'close',
            this.#config.providerCloseTimeoutS,
          );
        } catch (error) {
          disposition = 'failed';
          failure = boundedText(
            `provider close failed: ${boundedError(error, this.#config.providerEventBytes)}`,
            this.#config.providerEventBytes,
          );
          this.#event('provider.close_failed', { detail: failure });
        }
      }
      this.#outcome = this.#createOutcome(disposition, failure);
    }
    return this.#outcome;
  }

  async #runDuplex(
    running: ConversationRunningSession<TSubscription, TEnvelope>,
    runSignal: AbortSignal,
  ): Promise<ConversationOutcome> {
    const connection = this.#duplexConnection;
    if (connection === undefined) {
      throw new VoiceConfigurationError(
        'duplex conversation is missing its connection',
        configurationErrorOptions(),
      );
    }
    let result: ConversationOutcome | undefined;
    try {
      await callWithTimeout(
        (signal) => connection.start(running, signal),
        this.#config.providerStartTimeoutS,
        'duplex provider start',
        runSignal,
      );
      const maximumDuration =
        this.#capabilities?.duplex?.maximumSessionDurationS;
      result = await withDeadline(
        Promise.resolve(connection.wait(runSignal)),
        maximumDuration === undefined
          ? Number.POSITIVE_INFINITY
          : deadlineAfter(maximumDuration),
        'duplex provider session',
        runSignal,
      );
      if (!(result instanceof ConversationOutcome)) {
        throw new TypeError('duplex wait() must return ConversationOutcome');
      }
    } catch (error) {
      if (isAbort(error) || runSignal.aborted) {
        await settleCleanup(() =>
          callWithTimeout(
            (signal) => connection.interrupt(signal),
            this.#config.cancellationTimeoutS,
            'duplex interruption',
          ),
        );
        result = emptyOutcome('cancelled');
      } else {
        const failure = boundedError(error, this.#config.providerEventBytes);
        this.#event('conversation.failed', { detail: failure });
        result = emptyOutcome('failed', failure);
      }
    } finally {
      try {
        await callWithTimeout(
          (signal) => connection.close(signal),
          this.#config.providerCloseTimeoutS,
          'duplex provider close',
        );
      } catch (error) {
        const failure = boundedText(
          `provider close failed: ${boundedError(error, this.#config.providerEventBytes)}`,
          this.#config.providerEventBytes,
        );
        this.#event('provider.close_failed', { detail: failure });
        result = emptyOutcome('failed', failure);
      }
      this.#outcome = result ?? emptyOutcome('failed', 'missing duplex outcome');
    }
    return this.#outcome;
  }

  async #watchSpeech(
    activities: AsyncIterable<SpeechActivity>,
    runSignal: AbortSignal,
  ): Promise<void> {
    let pending: AbortController | undefined;
    try {
      for await (const activity of iterableWithAbort(
        activities,
        runSignal,
        this.#config.cancellationTimeoutS,
      )) {
        this.#event(`input.${activity.kind}`, {
          stage: 'speech-detection',
          detail: activity.providerId,
        });
        if (
          activity.kind === 'speech.started' &&
          this.#config.interruption.enabled &&
          this.#config.interruption.trigger === 'speech-started'
        ) {
          pending?.abort();
          pending = linkedController(runSignal);
          void this.#interruptAfterMinimumSpeech(pending.signal).catch(
            (error: unknown) => {
              if (!isAbort(error)) {
                this.#asynchronousFailure = error;
                this.#readController?.abort(error);
              }
            },
          );
        } else if (
          activity.kind === 'speech.stopped' ||
          activity.kind === 'speech.cancelled'
        ) {
          pending?.abort();
          pending = undefined;
        }
      }
    } finally {
      pending?.abort();
    }
  }

  async #interruptAfterMinimumSpeech(signal: AbortSignal): Promise<void> {
    await sleep(this.#config.interruption.minimumSpeechMs, signal);
    const delivery = this.#activeDelivery;
    if (delivery === undefined) return;
    await this.#interruptDelivery(delivery, {
      cancelProviderWork: this.#config.interruption.cancelProviderWork,
      cancelPendingOutput: this.#config.interruption.cancelPendingOutput,
    });
  }

  async #prepareResponse(
    update: TranscriptUpdate,
    signal: AbortSignal,
  ): Promise<readonly ResponseChunk[]> {
    const chunks: ResponseChunk[] = [];
    let characters = 0;
    let toolCharacters = 0;
    for await (const chunk of this.#responseChunks(update, false, signal)) {
      if (chunk.toolEvents.length > 0) {
        throw new RangeError('a speculative response cannot request tool work');
      }
      chunks.push(chunk);
      characters += characterCount(chunk.text);
      this.#checkResponseBounds(chunks.length, characters, 0, toolCharacters);
    }
    if (!chunks.some((chunk) => chunk.text.length > 0)) {
      throw new RangeError('response provider produced no text');
    }
    return Object.freeze(chunks);
  }

  async #deliverResponse(
    turn: ConversationTurn,
    update: TranscriptUpdate,
    generation: ConversationOutputGeneration,
    prepared: readonly ResponseChunk[] | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const responseStarted = monotonicNs();
    const responseText: string[] = [];
    let responseChunks = 0;
    let responseCharacters = 0;
    let toolEvents = 0;
    let toolCharacters = 0;
    let frames = 0;
    let synthesisStarted: bigint | undefined;
    const synthesisDeadline = deadlineAfter(this.#config.synthesisTimeoutS);
    const chunks =
      prepared === undefined
        ? this.#responseChunks(update, true, signal)
        : preparedChunks(prepared, signal);

    for await (const chunk of chunks) {
      responseChunks += 1;
      responseCharacters += characterCount(chunk.text);
      toolEvents += chunk.toolEvents.length;
      toolCharacters += chunk.toolEvents.reduce(
        (total, tool) =>
          total +
          characterCount(tool.name) +
          characterCount(tool.outcome) +
          characterCount(tool.detail),
        0,
      );
      this.#checkResponseBounds(
        responseChunks,
        responseCharacters,
        toolEvents,
        toolCharacters,
      );
      responseText.push(chunk.text);
      this.#event('response.chunk', { turn, update, generation });
      for (const tool of chunk.toolEvents) {
        const detail = tool.detail.length === 0 ? '' : `: ${tool.detail}`;
        this.#appendMessage(
          'tool',
          `${tool.name}: ${tool.outcome}${detail}`,
          turn.id,
        );
        this.#event('tool.completed', {
          turn,
          update,
          generation,
          detail: `${tool.name}:${tool.outcome}`,
        });
      }
      if (chunk.text.length === 0) continue;
      if (synthesisStarted === undefined) {
        synthesisStarted = monotonicNs();
        this.#event('synthesis.started', { turn, update, generation });
      }
      const synthesize = this.#synthesize;
      if (synthesize === undefined) {
        throw new VoiceConfigurationError(
          'conversation synthesis stage is unavailable',
          configurationErrorOptions(),
        );
      }
      const produced = await withDeadline(
        Promise.resolve(synthesize(chunk, turn, signal)),
        synthesisDeadline,
        'synthesis',
        signal,
      );
      for await (const samples of iterateUntil(
        produced,
        synthesisDeadline,
        'synthesis',
        signal,
        this.#config.cancellationTimeoutS,
      )) {
        if (!generation.active) throw abortError('output generation cancelled');
        frames += 1;
        if (frames > this.#config.maximumOutputFramesPerTurn) {
          throw new RangeError('synthesis exceeded maximumOutputFramesPerTurn');
        }
        const remainingMs = remainingMilliseconds(
          synthesisDeadline,
          'synthesis',
        );
        const outputTimeoutMs = Math.max(
          1,
          Math.min(
            Math.ceil(this.#config.outputWriteTimeoutS * 1_000),
            remainingMs,
          ),
        );
        await callWithTimeout(
          (writeSignal) =>
            this.#output.write(samples, {
              discontinuity: this.#discontinuityPending,
              generation,
              timeoutMs: outputTimeoutMs,
              signal: writeSignal,
            }),
          outputTimeoutMs / 1_000,
          'output write',
          signal,
        );
        this.#discontinuityPending = false;
        this.#outputFramesWritten += 1;
      }
    }

    const text = responseText.join('');
    if (text.trim().length === 0) {
      throw new RangeError('response provider produced no text');
    }
    this.#event('response.completed', {
      turn,
      update,
      generation,
      durationNs: monotonicNs() - responseStarted,
    });
    this.#event('synthesis.completed', {
      turn,
      update,
      generation,
      durationNs:
        synthesisStarted === undefined
          ? undefined
          : monotonicNs() - synthesisStarted,
      detail: `frames=${frames}`,
    });
    this.#appendMessage('assistant', text, turn.id);
    this.#turnsCompleted += 1;
    this.#event('turn.completed', {
      turn,
      update,
      generation,
      durationNs: monotonicNs() - responseStarted,
    });
  }

  async *#responseChunks(
    update: TranscriptUpdate,
    committed: boolean,
    signal: AbortSignal,
  ): AsyncGenerator<ResponseChunk> {
    const respond = this.#respond;
    if (respond === undefined) {
      throw new VoiceConfigurationError(
        'conversation response stage is unavailable',
        configurationErrorOptions(),
      );
    }
    const deadline = deadlineAfter(this.#config.responseTimeoutS);
    const produced = await withDeadline(
      Promise.resolve(
        respond(
          update,
          new ConversationContext(this.#history, committed),
          signal,
        ),
      ),
      deadline,
      'response',
      signal,
    );
    if (isAsyncIterable<ResponseItem>(produced)) {
      for await (const value of iterateUntil(
        produced,
        deadline,
        'response',
        signal,
        this.#config.cancellationTimeoutS,
      )) {
        yield responseChunk(value);
      }
      return;
    }
    yield responseChunk(produced);
  }

  #checkResponseBounds(
    chunks: number,
    characters: number,
    toolEvents: number,
    toolCharacters: number,
  ): void {
    if (chunks > this.#config.maximumResponseChunksPerTurn) {
      throw new RangeError('response exceeded maximumResponseChunksPerTurn');
    }
    if (
      characters > this.#config.maximumResponseCharacters ||
      toolCharacters > this.#config.maximumResponseCharacters
    ) {
      throw new RangeError('response exceeded maximumResponseCharacters');
    }
    if (toolEvents > this.#config.maximumToolEventsPerTurn) {
      throw new RangeError('response exceeded maximumToolEventsPerTurn');
    }
  }

  async #interruptDelivery(
    delivery: Delivery,
    options: {
      readonly cancelProviderWork?: boolean;
      readonly cancelPendingOutput?: boolean;
    } = {},
  ): Promise<void> {
    const cancelProviderWork = options.cancelProviderWork ?? true;
    const cancelPendingOutput = options.cancelPendingOutput ?? true;
    if (cancelPendingOutput) this.#cancelDeliveryOutput(delivery);
    if (cancelProviderWork && !delivery.settled) {
      this.#event('response.cancel_requested', {
        turn: delivery.turn,
        generation: delivery.generation,
        stage: 'provider',
      });
      delivery.controller.abort(abortError('response cancelled'));
      try {
        await withDeadline(
          delivery.task,
          deadlineAfter(this.#config.cancellationTimeoutS),
          'provider cancellation',
        );
      } catch (error) {
        if (!isAbort(error)) throw error;
      }
      this.#providerTasksCancelled += 1;
      this.#event('response.cancelled', {
        turn: delivery.turn,
        generation: delivery.generation,
        stage: 'provider',
      });
    }
    if (!delivery.interruptionCounted) {
      this.#turnsInterrupted += 1;
      delivery.interruptionCounted = true;
      this.#event('turn.interrupted', { turn: delivery.turn });
    }
  }

  #cancelDeliveryOutput(delivery: Delivery): void {
    if (!delivery.generation.active) return;
    this.#event('output.cancel_requested', {
      turn: delivery.turn,
      generation: delivery.generation,
      stage: 'core',
    });
    delivery.generation.cancel();
    this.#outputGenerationsCancelled += 1;
    this.#discontinuityPending = true;
    this.#event('output.cancelled', {
      turn: delivery.turn,
      generation: delivery.generation,
      stage: 'core',
    });
    this.#event('connector.output_observation', {
      turn: delivery.turn,
      generation: delivery.generation,
      stage: 'connector',
      available: false,
      detail: 'connector queue acknowledgement unavailable',
    });
    this.#event('receiver.playout_observation', {
      turn: delivery.turn,
      generation: delivery.generation,
      stage: 'receiver',
      available: false,
      detail: 'receiver playout position unavailable',
    });
    this.#event('acoustic.hearing_observation', {
      turn: delivery.turn,
      generation: delivery.generation,
      stage: 'acoustic',
      available: false,
      detail: 'acoustic hearing cannot be inferred from sender state',
    });
  }

  async #cancelSpeculation(speculation: Speculation): Promise<void> {
    speculation.controller.abort(abortError('speculative response cancelled'));
    try {
      await withDeadline(
        speculation.task,
        deadlineAfter(this.#config.cancellationTimeoutS),
        'speculative response cancellation',
      );
    } catch (error) {
      if (!isAbort(error)) throw error;
      this.#event('response.preparation_cancelled', {
        update: speculation.update,
      });
    }
  }

  async #waitOutputDrained(
    running: ConversationRunningSession<TSubscription, TEnvelope>,
    signal: AbortSignal,
  ): Promise<void> {
    const deadline = deadlineAfter(this.#config.outputDrainTimeoutS);
    const targets = this.#output.output._conversationDeliveryTargets?.() ?? {
      routeIds: [],
      endpointIds: [],
    };
    const routeIds = new Set(targets.routeIds);
    const endpointIds = new Set(targets.endpointIds);
    let waitMs = 1;
    while (true) {
      throwIfAborted(signal, 'output drain cancelled');
      const observations = this.#output.observations();
      const metrics = await withDeadline(
        running.metrics(),
        deadline,
        'output drain metrics',
        signal,
      );
      const routes = metrics.routes.filter(
        (route) => routeIds.has(route.routeId) || endpointIds.has(route.endpointId),
      );
      if (
        routes.some(
          (route) =>
            route.delivery.framesDroppedTotal > 0n ||
            route.endpoint.framesDroppedTotal > 0n ||
            route.endpoint.failuresTotal > 0n,
        )
      ) {
        throw new Error('generated audio delivery failed before output drained');
      }
      const routesDrained =
        routes.length > 0 &&
        routes.every(
          (route) =>
            route.delivery.queueDepthFrames === 0n &&
            route.delivery.framesDeliveredTotal +
              (route.delivery.discardedOutputFramesTotal ?? 0n) >=
              BigInt(this.#outputFramesWritten),
        );
      const buffersReclaimed =
        observations.availableBuffers === observations.bufferSlots;
      const noDeclaredDelivery = routeIds.size === 0 && endpointIds.size === 0;
      if (routesDrained || (noDeclaredDelivery && buffersReclaimed)) {
        this.#event('output.drained');
        return;
      }
      const remaining = remainingMilliseconds(deadline, 'output drain');
      await sleep(Math.min(waitMs, remaining), signal);
      waitMs = Math.min(waitMs * 2, 5);
    }
  }

  #turn(envelope: TEnvelope, update: TranscriptUpdate): ConversationTurn {
    return new ConversationTurn({
      id: BigInt(this.#turnsStarted + 1),
      utteranceId: update.utteranceId,
      text: update.text,
      sourceId: update.sourceId ?? envelope.lineage?.sourceId,
      streamId: update.streamId ?? envelope.lineage?.streamId,
      sourceSequence:
        update.sourceSequence ?? envelope.lineage?.sequenceNumber,
      sourceTimestampNs:
        update.sourceTimestampNs ?? envelope.timing.sourceTimestampNs,
      audioStartNs: update.audioStartNs,
      audioEndNs: update.audioEndNs,
      receivedTimestampNs: monotonicNs(),
    });
  }

  #appendMessage(
    role: ConversationRole,
    content: string,
    turnId: bigint,
  ): void {
    this.#history.push(
      new ConversationMessage({
        role,
        content,
        turnId,
        timestampNs: monotonicNs(),
      }),
    );
    if (this.#history.length > this.#config.historyCapacity) this.#history.shift();
  }

  #event(
    kind: string,
    options: {
      readonly turn?: ConversationTurn;
      readonly update?: TranscriptUpdate;
      readonly generation?: ConversationOutputGeneration;
      readonly durationNs?: bigint;
      readonly stage?: string;
      readonly available?: boolean;
      readonly detail?: string;
    } = {},
  ): void {
    this.#events.push(
      new VoiceEvent({
        kind,
        timestampNs: monotonicNs(),
        stage: options.stage,
        turnId: options.turn?.id,
        utteranceId:
          options.update?.utteranceId ?? options.turn?.utteranceId,
        transcriptRevision: options.update?.revision,
        outputGenerationId: options.generation?.id,
        durationNs: options.durationNs,
        available: options.available ?? true,
        detail:
          options.detail === undefined
            ? undefined
            : boundedText(options.detail, this.#config.providerEventBytes),
      }),
    );
    if (this.#events.length > this.#config.eventCapacity) this.#events.shift();
  }

  #createOutcome(
    disposition: ConversationDisposition,
    failure?: string,
  ): ConversationOutcome {
    return new ConversationOutcome({
      disposition,
      turnsStarted: this.#turnsStarted,
      turnsCompleted: this.#turnsCompleted,
      turnsInterrupted: this.#turnsInterrupted,
      transcriptUpdatesReceived: this.#transcriptUpdatesReceived,
      speculativeResponsesStarted: this.#speculativeResponsesStarted,
      speculativeResponsesReused: this.#speculativeResponsesReused,
      outputGenerationsCancelled: this.#outputGenerationsCancelled,
      outputFramesWritten: this.#outputFramesWritten,
      history: this.#history,
      events: this.#events,
      failure,
      providerTasksCancelled: this.#providerTasksCancelled,
    });
  }
}

/** A started conversation that can be waited, interrupted, or stopped. */
export class RunningConversation<
  TSubscription extends ConversationSubscription = ConversationSubscription,
  TSamples = unknown,
  TEnvelope extends ConversationSignalEnvelope = ConversationSignalEnvelope,
> implements AsyncDisposable {
  readonly #conversation: Conversation<TSubscription, TSamples, TEnvelope>;
  readonly #task: Promise<ConversationOutcome>;
  #settled = false;

  public constructor(
    conversation: Conversation<TSubscription, TSamples, TEnvelope>,
    task: Promise<ConversationOutcome>,
  ) {
    this.#conversation = conversation;
    this.#task = task;
    void task.then(
      () => {
        this.#settled = true;
      },
      () => {
        this.#settled = true;
      },
    );
  }

  public get outcome(): ConversationOutcome | undefined {
    return this.#conversation.outcome;
  }

  public get events(): readonly VoiceEvent[] {
    return this.#conversation.events;
  }

  public async wait(): Promise<ConversationOutcome> {
    return await this.#task;
  }

  public async interrupt(): Promise<void> {
    await this.#conversation.interrupt();
  }

  public async cancelOutput(): Promise<void> {
    await this.#conversation.cancelOutput();
  }

  public stop(): void {
    this.#conversation.stop();
  }

  public async close(options: { readonly abort?: boolean } = {}): Promise<ConversationOutcome> {
    if (!this.#settled) {
      if (options.abort === true) this.#conversation._abort();
      else this.stop();
    }
    const timeoutS =
      this.#conversation.config.cancellationTimeoutS +
      this.#conversation.config.outputDrainTimeoutS +
      this.#conversation.config.providerCloseTimeoutS;
    return await withDeadline(
      this.#task,
      deadlineAfter(timeoutS),
      'conversation close',
    );
  }

  /** Python-parity alias for asynchronous close. */
  public async aclose(
    options: { readonly abort?: boolean } = {},
  ): Promise<ConversationOutcome> {
    return await this.close(options);
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

/** Select duplex, provider-component, or low-level callback composition. */
export function declareConversation<
  TSession,
  TInput,
  TSubscription extends ConversationSubscription,
  TSamples,
  TEnvelope extends ConversationSignalEnvelope,
  TRunning,
>(
  options: ConversationDeclarationOptions<
    TSession,
    TInput,
    TSubscription,
    TSamples,
    TEnvelope,
    TRunning
  >,
): Conversation<TSubscription, TSamples, TEnvelope> {
  const providerComponents = [options.stt, options.llm, options.tts, options.vad];
  const lowLevelComponents = [
    options.transcripts,
    options.respond,
    options.synthesize,
  ];
  if (options.voiceModel !== undefined) {
    if (options.input === undefined) {
      throw new VoiceConfigurationError(
        'input is required with voiceModel',
        configurationErrorOptions(),
      );
    }
    if (
      [...providerComponents, ...lowLevelComponents].some(
        (value) => value !== undefined,
      )
    ) {
      throw new VoiceConfigurationError(
        'voiceModel cannot be combined with stt, llm, tts, vad, ' +
          'transcripts, respond, or synthesize',
        configurationErrorOptions(),
      );
    }
    return Conversation.fromDuplex({
      session: options.session,
      input: options.input,
      output: options.output,
      voiceModel: options.voiceModel,
      config: options.config,
    }) as unknown as Conversation<TSubscription, TSamples, TEnvelope>;
  }

  if (providerComponents.some((value) => value !== undefined)) {
    if (
      options.input === undefined ||
      options.stt === undefined ||
      options.llm === undefined ||
      options.tts === undefined
    ) {
      throw new VoiceConfigurationError(
        'input, stt, llm, and tts are required for component voice composition',
        configurationErrorOptions(),
      );
    }
    if (lowLevelComponents.some((value) => value !== undefined)) {
      throw new VoiceConfigurationError(
        'stt, llm, and tts cannot be combined with low-level transcript callbacks',
        configurationErrorOptions(),
      );
    }
    return Conversation.fromComponents({
      session: options.session,
      input: options.input,
      output: options.output,
      stt: options.stt,
      llm: options.llm,
      tts: options.tts,
      vad: options.vad,
      config: options.config,
    });
  }

  if (
    options.transcripts === undefined ||
    options.respond === undefined ||
    options.synthesize === undefined
  ) {
    throw new VoiceConfigurationError(
      'transcripts, respond, and synthesize are required by the low-level callback API',
      configurationErrorOptions(),
    );
  }
  return new Conversation({
    transcripts: options.transcripts,
    respond: options.respond,
    synthesize: options.synthesize,
    output: options.output,
    config: options.config,
    decodeTranscript: options.decodeTranscript,
  });
}

function validateComponents(
  transcriber: { readonly capabilities: unknown },
  responseModel: { readonly capabilities: unknown },
  synthesizer: { readonly capabilities: unknown },
  speechDetector: { readonly capabilities: unknown } | undefined,
  config: ConversationConfig,
): VoiceCapabilities {
  const transcription = transcriber.capabilities;
  const response = responseModel.capabilities;
  const synthesis = synthesizer.capabilities;
  const speechDetection = speechDetector?.capabilities;
  if (!(transcription instanceof TranscriptionCapabilities)) {
    throw configurationError('stt.capabilities must be TranscriptionCapabilities');
  }
  if (!(response instanceof ResponseCapabilities)) {
    throw configurationError('llm.capabilities must be ResponseCapabilities');
  }
  if (!(synthesis instanceof SynthesisCapabilities)) {
    throw configurationError('tts.capabilities must be SynthesisCapabilities');
  }
  if (
    speechDetector !== undefined &&
    !(speechDetection instanceof SpeechDetectionCapabilities)
  ) {
    throw configurationError(
      'vad.capabilities must be SpeechDetectionCapabilities',
    );
  }
  if (!transcription.streaming) {
    throw unsupported('stt must provide streaming transcript updates');
  }
  if (!response.streaming) {
    throw unsupported('llm must produce response chunks incrementally');
  }
  if (!synthesis.streaming) {
    throw unsupported('tts must produce audio chunks incrementally');
  }
  if (config.interruption.enabled) {
    if (config.interruption.trigger === 'speech-started') {
      if (!(speechDetection instanceof SpeechDetectionCapabilities)) {
        throw unsupported(
          'vad is required when interruption is triggered by speech start',
        );
      }
      if (!speechDetection.streaming) {
        throw unsupported('vad must stream speech activity');
      }
    }
    if (config.interruption.cancelProviderWork && !response.cancellation) {
      throw unsupported(
        'llm must support cancellation when interruption is enabled',
      );
    }
    if (config.interruption.cancelProviderWork && !synthesis.cancellation) {
      throw unsupported(
        'tts must support cancellation when interruption is enabled',
      );
    }
    if (config.interruption.requireReceiverObservation) {
      throw unsupported(
        'separate voice components do not provide receiver playout observations',
      );
    }
  }
  return new VoiceCapabilities({
    transcription,
    response,
    synthesis,
    speechDetection:
      speechDetection instanceof SpeechDetectionCapabilities
        ? speechDetection
        : undefined,
  });
}

function validateDuplex(
  voiceModel: { readonly capabilities: unknown },
  config: ConversationConfig,
): VoiceCapabilities {
  const capabilities = voiceModel.capabilities;
  if (!(capabilities instanceof DuplexVoiceCapabilities)) {
    throw configurationError(
      'voiceModel.capabilities must be DuplexVoiceCapabilities',
    );
  }
  if (config.interruption.enabled) {
    if (!capabilities.interruption) {
      throw unsupported('voiceModel must support interruption');
    }
    if (!capabilities.interruptionTriggers.includes(config.interruption.trigger)) {
      throw unsupported(
        'voiceModel does not support the configured interruption trigger',
      );
    }
    if (
      config.interruption.trigger === 'speech-started' &&
      !capabilities.providerSpeechDetection
    ) {
      throw unsupported(
        'voiceModel must report speech activity for speech-started interruption',
      );
    }
    if (
      config.interruption.cancelProviderWork &&
      !capabilities.responseCancellation
    ) {
      throw unsupported(
        'voiceModel must support response cancellation when interruption is enabled',
      );
    }
    if (
      config.interruption.requireReceiverObservation &&
      (!capabilities.receiverPlayoutClear ||
        !capabilities.playoutAcknowledgement)
    ) {
      throw unsupported(
        'voiceModel must clear receiver playout and acknowledge the cutoff',
      );
    }
  }
  return new VoiceCapabilities({ duplex: capabilities });
}

function validateTranscriptionConnection(
  connection: TranscriptionConnection<ConversationSubscription, ConversationSignalEnvelope>,
): void {
  if (
    connection === null ||
    typeof connection !== 'object' ||
    connection.subscription === undefined ||
    typeof connection.subscription.sessionId !== 'bigint' ||
    typeof connection.decode !== 'function' ||
    typeof connection.start !== 'function' ||
    typeof connection.close !== 'function'
  ) {
    throw new TypeError(
      'stt.transcribe() must return a TranscriptionConnection',
    );
  }
}

function validateDuplexConnection(
  connection: DuplexVoiceConnection,
): void {
  for (const method of [
    'start',
    'wait',
    'interrupt',
    'cancelOutput',
    'stop',
    'close',
  ] as const) {
    if (typeof connection[method] !== 'function') {
      throw new TypeError(
        'voiceModel.connect() must return a DuplexVoiceConnection',
      );
    }
  }
}

function synthesisAdapter<TSamples>(
  synthesizer: SpeechSynthesizer<TSamples>,
  output: ConversationOutput<TSamples>,
): SynthesisHandler<TSamples> {
  return async (chunk, turn, signal) => {
    const produced = await synthesizer.synthesize(
      new SynthesisRequest(chunk, turn, signal),
    );
    return validateSynthesisChunks(produced, output);
  };
}

async function* validateSynthesisChunks<TSamples>(
  produced: AsyncIterable<SynthesisItem<TSamples>>,
  output: ConversationOutput<TSamples>,
): AsyncGenerator<TSamples> {
  for await (const value of produced) {
    if (!(value instanceof SynthesisChunk)) {
      throw new TypeError('SpeechSynthesizer must yield SynthesisChunk values');
    }
    if (value.sampleRateHz !== output.config.sampleRateHz) {
      throw new RangeError(
        'synthesis sample rate must match the AudioInput sample rate',
      );
    }
    if (value.channels !== output.config.channels) {
      throw new RangeError(
        'synthesis channel count must match the AudioInput channel count',
      );
    }
    yield value.samples;
  }
}

function defaultTranscriptDecoder(
  envelope: ConversationSignalEnvelope,
): TranscriptUpdate | undefined {
  let raw: string;
  if (typeof envelope.payload === 'string') raw = envelope.payload;
  else if (
    envelope.payload !== null &&
    typeof envelope.payload === 'object' &&
    'kind' in envelope.payload &&
    envelope.payload.kind === 'text' &&
    'text' in envelope.payload &&
    typeof envelope.payload.text === 'string'
  ) {
    raw = envelope.payload.text;
  } else {
    throw new TypeError('conversation transcript signals must contain text');
  }
  const text = raw.trim();
  if (text.length === 0) return undefined;
  const source = envelope.lineage?.sourceId.toString() ?? 'unknown';
  const sequence = envelope.lineage?.sequenceNumber ?? 0n;
  const audioStartNs = envelope.timing.sourceTimestampNs;
  const audioEndNs =
    audioStartNs === undefined || envelope.timing.durationNs === undefined
      ? undefined
      : audioStartNs + envelope.timing.durationNs;
  return new TranscriptUpdate({
    utteranceId: `${source}:${sequence}`,
    revision: 1,
    text,
    stablePrefix: text,
    final: true,
    sourceId: envelope.lineage?.sourceId,
    streamId: envelope.lineage?.streamId,
    sourceSequence: envelope.lineage?.sequenceNumber,
    sourceTimestampNs: envelope.timing.sourceTimestampNs,
    audioStartNs,
    audioEndNs,
  });
}

function responseChunk(value: ResponseItem): ResponseChunk {
  if (value instanceof ResponseChunk) return value;
  if (value instanceof ConversationResponse) {
    return new ResponseChunk({ text: value.text, toolEvents: value.toolEvents });
  }
  if (typeof value === 'string') return new ResponseChunk({ text: value });
  throw new TypeError(
    'response provider must return text, ConversationResponse, ' +
      'ResponseChunk, or an async iterable of those values',
  );
}

async function* preparedChunks(
  chunks: readonly ResponseChunk[],
  signal: AbortSignal,
): AsyncGenerator<ResponseChunk> {
  for (const chunk of chunks) {
    throwIfAborted(signal, 'prepared response cancelled');
    yield chunk;
  }
}

async function* iterateUntil<T>(
  values: AsyncIterable<T>,
  deadline: number,
  operation: string,
  signal?: AbortSignal,
  closeTimeoutS = 2,
): AsyncGenerator<T> {
  const iterator = values[Symbol.asyncIterator]();
  try {
    while (true) {
      const result = await withDeadline(
        iterator.next(),
        deadline,
        operation,
        signal,
      );
      if (result.done === true) return;
      yield result.value;
    }
  } finally {
    if (typeof iterator.return === 'function') {
      await settleCleanup(async () => {
        await withDeadline(
          Promise.resolve(iterator.return?.()),
          deadlineAfter(closeTimeoutS),
          `${operation} iterator close`,
        );
      });
    }
  }
}

async function* iterableWithAbort<T>(
  values: AsyncIterable<T>,
  signal: AbortSignal,
  closeTimeoutS: number,
): AsyncGenerator<T> {
  const iterator = values[Symbol.asyncIterator]();
  try {
    while (true) {
      const result = await withDeadline(
        iterator.next(),
        Number.POSITIVE_INFINITY,
        'speech activity',
        signal,
      );
      if (result.done === true) return;
      yield result.value;
    }
  } finally {
    if (typeof iterator.return === 'function') {
      await settleCleanup(async () => {
        await withDeadline(
          Promise.resolve(iterator.return?.()),
          deadlineAfter(closeTimeoutS),
          'speech activity iterator close',
        );
      });
    }
  }
}

function uniqueProviders(
  ...providers: readonly ProviderLifecycle[]
): readonly ProviderLifecycle[] {
  return [...new Set(providers)];
}

async function providerLifecycle(
  provider: ProviderLifecycle,
  method: 'start' | 'close',
  timeoutS: number,
  parentSignal?: AbortSignal,
): Promise<void> {
  const operation = provider[method];
  if (operation === undefined) return;
  await callWithTimeout(
    (signal) => operation.call(provider, signal),
    timeoutS,
    `provider ${method}`,
    parentSignal,
  );
}

async function callWithTimeout<T>(
  operation: (signal: AbortSignal) => T | Promise<T> | undefined,
  timeoutS: number,
  name: string,
  parentSignal?: AbortSignal,
): Promise<T | undefined> {
  const controller = linkedController(parentSignal);
  const deadline = deadlineAfter(timeoutS);
  try {
    return await withDeadline(
      Promise.resolve(operation(controller.signal)),
      deadline,
      name,
      controller.signal,
      controller,
    );
  } finally {
    controller.abort(abortError(`${name} finished`));
  }
}

function watchDelivery(
  turn: ConversationTurn,
  generation: ConversationOutputGeneration,
  controller: AbortController,
  task: Promise<void>,
): Delivery {
  const delivery: Delivery = {
    turn,
    generation,
    controller,
    task,
    settled: false,
    failure: undefined,
    interruptionCounted: false,
  };
  void task.then(
    () => {
      delivery.settled = true;
      controller.abort(abortError('response delivery completed'));
    },
    (error: unknown) => {
      delivery.settled = true;
      delivery.failure = error;
      controller.abort(error);
    },
  );
  return delivery;
}

function watchTask(task: Promise<void>): WatchedTask {
  const watched: WatchedTask = {
    task,
    settled: false,
    failure: undefined,
  };
  void task.then(
    () => {
      watched.settled = true;
    },
    (error: unknown) => {
      watched.settled = true;
      watched.failure = error;
    },
  );
  return watched;
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === 'function'
  );
}

function isEndOfStream(
  value: ConversationSignalEnvelope | ConversationEndOfStream | undefined,
): value is ConversationEndOfStream {
  return value !== undefined && 'kind' in value && value.kind === 'end-of-stream';
}

function monotonicNs(): bigint {
  return BigInt(Math.floor(performance.now() * 1_000_000));
}

function deadlineAfter(seconds: number): number {
  return performance.now() + seconds * 1_000;
}

function remainingMilliseconds(deadline: number, operation: string): number {
  const remaining = deadline - performance.now();
  if (remaining <= 0) {
    throw new Error(`${operation} exceeded its configured timeout`);
  }
  return Math.max(1, Math.ceil(remaining));
}

async function withDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  operation: string,
  signal?: AbortSignal,
  timeoutController?: AbortController,
): Promise<T> {
  throwIfAborted(signal, `${operation} cancelled`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbort = (): void => {};
  const timeout = new Promise<never>((_resolve, reject) => {
    if (Number.isFinite(deadline)) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        reject(new Error(`${operation} exceeded its configured timeout`));
        timeoutController?.abort(abortError(`${operation} timed out`));
        return;
      }
      timer = setTimeout(() => {
        reject(new Error(`${operation} exceeded its configured timeout`));
        timeoutController?.abort(abortError(`${operation} timed out`));
      }, remaining);
    }
    if (signal !== undefined) {
      const onAbort = (): void => reject(abortError(`${operation} cancelled`));
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbort = () => signal.removeEventListener('abort', onAbort);
    }
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    removeAbort();
  }
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal, 'bounded wait cancelled');
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError('bounded wait cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function linkedController(parent?: AbortSignal): AbortController {
  const controller = new AbortController();
  const detach = forwardAbort(parent, controller);
  if (controller.signal.aborted) detach();
  else controller.signal.addEventListener('abort', detach, { once: true });
  return controller;
}

function forwardAbort(
  source: AbortSignal | undefined,
  target: AbortController,
): () => void {
  if (source === undefined) return () => {};
  if (source.aborted) {
    target.abort(source.reason);
    return () => {};
  }
  const forward = (): void => target.abort(source.reason);
  source.addEventListener('abort', forward, { once: true });
  return () => source.removeEventListener('abort', forward);
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (signal?.aborted === true) throw abortError(message);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function settleCleanup(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch {
    // The primary failure remains authoritative; explicit events retain cleanup failures.
  }
}

function boundedError(error: unknown, maximumBytes: number): string {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : `Error: ${String(error)}`;
  return boundedText(message, maximumBytes);
}

function boundedText(value: string, maximumBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maximumBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(value.slice(0, middle)).byteLength <= maximumBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return value.slice(0, low);
}

function emptyOutcome(
  disposition: ConversationDisposition,
  failure?: string,
): ConversationOutcome {
  return new ConversationOutcome({
    disposition,
    turnsStarted: 0,
    turnsCompleted: 0,
    turnsInterrupted: 0,
    transcriptUpdatesReceived: 0,
    speculativeResponsesStarted: 0,
    speculativeResponsesReused: 0,
    outputGenerationsCancelled: 0,
    outputFramesWritten: 0,
    history: [],
    events: [],
    failure,
  });
}

function configurationErrorOptions() {
  return {
    stage: 'configuration',
    nextAction: 'select components whose declared capabilities match the policy',
  } as const;
}

function configurationError(message: string): VoiceConfigurationError {
  return new VoiceConfigurationError(message, configurationErrorOptions());
}

function unsupported(message: string): UnsupportedVoiceCapabilityError {
  return new UnsupportedVoiceCapabilityError(message, {
    stage: 'configuration',
    nextAction: 'select a provider with the required capability or change the policy',
  });
}
