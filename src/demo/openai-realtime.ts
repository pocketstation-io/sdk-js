import { Buffer } from 'node:buffer';

import { requirePackage } from '../require-package.cjs';
import type { AudioInput, OutputGeneration } from '../node/application-audio.js';
import type { Endpoint, RunningSession, Session } from '../node/session.js';
import type { AudioFrame } from '../node/streams.js';
import { DuplexVoiceCapabilities } from '../voice/capabilities.js';
import type { ConversationConfig } from '../voice/configuration.js';
import type {
  DuplexVoiceConnection,
  DuplexVoiceModel,
} from '../voice/duplex.js';
import { DuplexVoiceContext } from '../voice/duplex.js';
import { VoiceEvent } from '../voice/events.js';
import { ConversationOutcome } from '../voice/turns.js';

const MODEL_SAMPLE_RATE_HZ = 24_000;
const SESSION_SAMPLE_RATE_HZ = 48_000;
const MICROPHONE_FRAME_SAMPLE_COUNTS = new Set([480, 960]);
const OUTPUT_FRAME_SAMPLES = 480;
const DEFAULT_MAXIMUM_WEBSOCKET_BUFFERED_BYTES = 1_048_576;

/** Finite OpenAI Realtime connection and buffering policy. */
export class RealtimeVoiceConfig {
  public readonly model: string;
  public readonly voice: string;
  public readonly instructions: string;
  public readonly connectTimeoutS: number;
  public readonly closeTimeoutS: number;
  public readonly maximumSessionS: number;
  public readonly maximumOutputTokens: number;
  public readonly inputQueueFrames: number;
  public readonly maximumWebSocketBufferedBytes: number;
  public readonly outputQueueChunks: number;
  public readonly maximumBufferedOutputS: number;
  public readonly transcriptionModel: string;

  public constructor(options: {
    readonly model?: string;
    readonly voice?: string;
    readonly instructions?: string;
    readonly connectTimeoutS?: number;
    readonly closeTimeoutS?: number;
    readonly maximumSessionS?: number;
    readonly maximumOutputTokens?: number;
    readonly inputQueueFrames?: number;
    readonly maximumWebSocketBufferedBytes?: number;
    readonly outputQueueChunks?: number;
    readonly maximumBufferedOutputS?: number;
    readonly transcriptionModel?: string;
  } = {}) {
    this.model = nonEmpty(options.model ?? 'gpt-realtime-2.1', 'model');
    this.voice = nonEmpty(options.voice ?? 'marin', 'voice');
    this.instructions = nonEmpty(
      options.instructions ?? 'Answer clearly in under 20 seconds so the user can interrupt you.',
      'instructions',
    );
    this.connectTimeoutS = finite(options.connectTimeoutS ?? 10, 'connectTimeoutS', 0, 60);
    this.closeTimeoutS = finite(options.closeTimeoutS ?? 5, 'closeTimeoutS', 0, 60);
    this.maximumSessionS = finite(options.maximumSessionS ?? 300, 'maximumSessionS', 0, 3_600);
    this.maximumOutputTokens = integer(
      options.maximumOutputTokens ?? 512,
      'maximumOutputTokens',
      1,
      4_096,
    );
    this.inputQueueFrames = integer(options.inputQueueFrames ?? 64, 'inputQueueFrames', 1, 4_096);
    this.maximumWebSocketBufferedBytes = integer(
      options.maximumWebSocketBufferedBytes ?? DEFAULT_MAXIMUM_WEBSOCKET_BUFFERED_BYTES,
      'maximumWebSocketBufferedBytes',
      1_024,
      16_777_216,
    );
    this.outputQueueChunks = integer(
      options.outputQueueChunks ?? 1_024,
      'outputQueueChunks',
      1,
      1_024,
    );
    this.maximumBufferedOutputS = finite(
      options.maximumBufferedOutputS ?? 30,
      'maximumBufferedOutputS',
      0,
      300,
    );
    this.transcriptionModel = nonEmpty(
      options.transcriptionModel ?? 'gpt-4o-mini-transcribe',
      'transcriptionModel',
    );
    Object.freeze(this);
  }
}

/** Measured provider and generated-audio delivery counters. */
export interface RealtimeVoiceObservations {
  readonly inputReady: boolean;
  readonly inputFramesSent: number;
  readonly inputFramesDropped: number;
  readonly inputFramesDroppedBySocketPressure: number;
  readonly outputChunksReceived: number;
  readonly outputChunksDropped: number;
  readonly outputChunksCancelled: number;
  readonly outputChunksRejected: number;
  readonly outputFramesWritten: number;
  readonly outputFramesRejected: number;
  readonly outputGenerationsCancelled: number;
  readonly providerErrors: number;
  readonly mediaWorkerErrors: number;
}

/** Mutable state retained for one provider transcript item. */
export class TranscriptProgress {
  public text = '';
  public revision = 0;
}

/** Stable transcript values derived from OpenAI delta and completed events. */
export interface RealtimeTranscriptValues {
  readonly text: string;
  readonly stablePrefix: string;
  readonly utteranceId: string;
  readonly transcriptRevision: number;
  readonly final: boolean;
}

/** Encode one 48 kHz mono float32 Session frame as 24 kHz PCM16 base64. */
export function encodeRealtimeMicrophoneFrame(frame: Pick<
  AudioFrame,
  'sampleRateHz' | 'channelCount' | 'samplesF32le'
>): string {
  if (frame.sampleRateHz !== SESSION_SAMPLE_RATE_HZ || frame.channelCount !== 1) {
    throw new RangeError('the OpenAI Realtime adapter requires 48 kHz mono Session audio');
  }
  if (frame.samplesF32le.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new RangeError('microphone frame is not complete float32 PCM');
  }
  const bytes = Uint8Array.from(frame.samplesF32le);
  const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  if (!MICROPHONE_FRAME_SAMPLE_COUNTS.has(samples.length)) {
    throw new RangeError('the OpenAI Realtime adapter requires 10 ms or 20 ms Session frames');
  }
  const pcm = Buffer.allocUnsafe(samples.length);
  for (let index = 0; index < samples.length; index += 2) {
    const averaged = ((samples[index] ?? 0) + (samples[index + 1] ?? 0)) * 0.5;
    pcm.writeInt16LE(pcm16(averaged), index);
  }
  return pcm.toString('base64');
}

/** Apply one provider transcript event without inventing stable partial text. */
export function transcriptEventValues(
  transcripts: Map<string, TranscriptProgress>,
  eventType: string,
  event: Readonly<Record<string, unknown>>,
  text: unknown,
  maximumCharacters = 8_192,
): RealtimeTranscriptValues {
  integer(maximumCharacters, 'maximumCharacters', 1, 1_000_000);
  const itemId = requiredString(event, 'item_id');
  let progress = transcripts.get(itemId);
  if (progress === undefined) {
    progress = new TranscriptProgress();
    transcripts.set(itemId, progress);
  }
  progress.revision += 1;
  if (eventType.endsWith('.delta')) {
    if (typeof text !== 'string') throw new TypeError('OpenAI transcript delta is missing text');
    progress.text = `${progress.text}${text}`.slice(0, maximumCharacters);
    return Object.freeze({
      text: progress.text,
      stablePrefix: '',
      utteranceId: itemId,
      transcriptRevision: progress.revision,
      final: false,
    });
  }
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new TypeError('OpenAI final transcript is missing text');
  }
  progress.text = text.slice(0, maximumCharacters);
  return Object.freeze({
    text: progress.text,
    stablePrefix: progress.text,
    utteranceId: itemId,
    transcriptRevision: progress.revision,
    final: true,
  });
}

/** Minimal socket surface used by the provider and injectable in tests. */
export interface RealtimeSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: unknown) => void): this;
  on(event: 'close', listener: (code: number, reason: unknown) => void): this;
  on(event: 'error', listener: (failure: Error) => void): this;
}

export type RealtimeSocketFactory = (options: {
  readonly url: string;
  readonly apiKey: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}) => Promise<RealtimeSocket>;

/** Microphone input required by the Realtime demo adapter. */
export interface RealtimeInput {
  send(endpoint: Endpoint): bigint;
}

/** Demo-owned OpenAI Realtime provider over a PocketStation Session. */
export class OpenAIRealtime implements DuplexVoiceModel<
  Session,
  RealtimeInput,
  AudioInput,
  RunningSession
> {
  public readonly capabilities: DuplexVoiceCapabilities;
  readonly #apiKey: string;
  readonly #config: RealtimeVoiceConfig;
  readonly #socketFactory: RealtimeSocketFactory;
  #connection: OpenAIRealtimeConnection | undefined;

  public constructor(options: {
    readonly apiKey: string;
    readonly config?: RealtimeVoiceConfig;
    readonly socketFactory?: RealtimeSocketFactory;
  }) {
    this.#apiKey = nonEmpty(options.apiKey, 'apiKey');
    this.#config = options.config ?? new RealtimeVoiceConfig();
    this.#socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.capabilities = new DuplexVoiceCapabilities({
      transcriptRevisions: true,
      stablePrefix: false,
      providerSpeechDetection: true,
      interruption: true,
      interruptionTriggers: ['speech-started'],
      responseCancellation: true,
      providerHistoryTruncation: false,
      receiverPlayoutClear: false,
      playoutAcknowledgement: false,
      tools: false,
      usageReporting: false,
      inputFormats: ['pcm-s16le'],
      outputFormats: ['pcm-s16le'],
      supportedSampleRatesHz: [MODEL_SAMPLE_RATE_HZ],
      maximumSessionDurationS: this.#config.maximumSessionS,
    });
  }

  public connect(
    context: DuplexVoiceContext<Session, RealtimeInput, AudioInput>,
  ): DuplexVoiceConnection<RunningSession> {
    if (this.#connection !== undefined) {
      throw new Error('OpenAIRealtime can create only one connection');
    }
    if (context.output.config.sampleRateHz !== SESSION_SAMPLE_RATE_HZ
      || context.output.config.channels !== 1
      || context.output.config.frameSamplesPerChannel !== OUTPUT_FRAME_SAMPLES) {
      throw new RangeError('OpenAIRealtime output must be 48 kHz mono with 480-sample frames');
    }
    context.input.send(context.session.polledAudio());
    this.#connection = new OpenAIRealtimeConnection({
      apiKey: this.#apiKey,
      config: this.#config,
      conversationConfig: context.config,
      output: context.output,
      socketFactory: this.#socketFactory,
    });
    return this.#connection;
  }

  public get observations(): RealtimeVoiceObservations {
    if (this.#connection === undefined) throw new Error('OpenAIRealtime has not been connected');
    return this.#connection.observations;
  }
}

class OpenAIRealtimeConnection implements DuplexVoiceConnection<RunningSession> {
  readonly #apiKey: string;
  readonly #config: RealtimeVoiceConfig;
  readonly #conversationConfig: ConversationConfig;
  readonly #output: AudioInput;
  readonly #socketFactory: RealtimeSocketFactory;
  readonly #controller = new AbortController();
  readonly #inputQueue: BoundedQueue<string>;
  readonly #outputQueue: BoundedQueue<OutputChunk>;
  readonly #transcripts = new Map<string, TranscriptProgress>();
  readonly #responses = new Map<string, RealtimeResponseOutput>();
  readonly #events: VoiceEvent[] = [];
  readonly #socketClosed = deferred<void>();
  #socket: RealtimeSocket | undefined;
  #stopResolve: (() => void) | undefined;
  readonly #stopped = new Promise<void>((resolve) => { this.#stopResolve = resolve; });
  #tasks: Promise<void>[] = [];
  #failure: Error | undefined;
  #currentResponseId: string | undefined;
  #inputReady = false;
  #inputFramesSent = 0;
  #inputFramesDropped = 0;
  #inputFramesDroppedBySocketPressure = 0;
  #outputChunksReceived = 0;
  #outputChunksDropped = 0;
  #outputChunksCancelled = 0;
  #outputChunksRejected = 0;
  #outputFramesWritten = 0;
  #outputFramesRejected = 0;
  #outputGenerationsCancelled = 0;
  #providerErrors = 0;
  #mediaWorkerErrors = 0;
  #transcriptUpdatesReceived = 0;
  #turnsStarted = 0;
  #turnsCompleted = 0;
  #started = false;
  #closed = false;

  public constructor(options: {
    readonly apiKey: string;
    readonly config: RealtimeVoiceConfig;
    readonly conversationConfig: ConversationConfig;
    readonly output: AudioInput;
    readonly socketFactory: RealtimeSocketFactory;
  }) {
    this.#apiKey = options.apiKey;
    this.#config = options.config;
    this.#conversationConfig = options.conversationConfig;
    this.#output = options.output;
    this.#socketFactory = options.socketFactory;
    this.#inputQueue = new BoundedQueue(options.config.inputQueueFrames);
    const maximumOutputBytes = Math.trunc(
      options.config.maximumBufferedOutputS * MODEL_SAMPLE_RATE_HZ * 2,
    );
    this.#outputQueue = new BoundedQueue(
      options.config.outputQueueChunks,
      maximumOutputBytes,
      (chunk) => chunk.pcm16.byteLength,
    );
  }

  public get observations(): RealtimeVoiceObservations {
    return Object.freeze({
      inputReady: this.#inputReady,
      inputFramesSent: this.#inputFramesSent,
      inputFramesDropped: this.#inputFramesDropped,
      inputFramesDroppedBySocketPressure: this.#inputFramesDroppedBySocketPressure,
      outputChunksReceived: this.#outputChunksReceived,
      outputChunksDropped: this.#outputChunksDropped,
      outputChunksCancelled: this.#outputChunksCancelled,
      outputChunksRejected: this.#outputChunksRejected,
      outputFramesWritten: this.#outputFramesWritten,
      outputFramesRejected: this.#outputFramesRejected,
      outputGenerationsCancelled: this.#outputGenerationsCancelled,
      providerErrors: this.#providerErrors,
      mediaWorkerErrors: this.#mediaWorkerErrors,
    });
  }

  public async start(running: RunningSession, signal?: AbortSignal): Promise<void> {
    if (this.#started) throw new Error('OpenAIRealtime connection has already started');
    this.#started = true;
    linkAbort(signal, this.#controller);
    const ready = deferred<void>();
    try {
      const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.#config.model)}`;
      this.#socket = await this.#socketFactory({
        url,
        apiKey: this.#apiKey,
        signal: this.#controller.signal,
        timeoutMs: Math.round(this.#config.connectTimeoutS * 1_000),
      });
      this.#socket.on('message', (data) => this.#receiveMessage(data, ready));
      this.#socket.on('error', (failure) => {
        ready.reject(failure);
        this.#fail(failure);
      });
      this.#socket.on('close', () => {
        this.#socketClosed.resolve();
        ready.reject(new Error('OpenAI Realtime socket closed before the Session was ready'));
        this.#requestStop();
      });
      this.#sendCritical({
        type: 'session.update',
        session: {
          type: 'realtime',
          model: this.#config.model,
          instructions: this.#config.instructions,
          max_output_tokens: this.#config.maximumOutputTokens,
          output_modalities: ['audio'],
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: MODEL_SAMPLE_RATE_HZ },
              transcription: { model: this.#config.transcriptionModel },
              turn_detection: {
                type: 'server_vad',
                create_response: true,
                interrupt_response: this.#conversationConfig.interruption.enabled,
              },
            },
            output: {
              format: { type: 'audio/pcm', rate: MODEL_SAMPLE_RATE_HZ },
              voice: this.#config.voice,
            },
          },
        },
      });
      await withTimeout(ready.promise, this.#config.connectTimeoutS * 1_000, 'session.updated');
      this.#inputReady = true;
      this.#tasks = [
        this.#run(() => this.#readInput(running)),
        this.#run(() => this.#sendInput()),
        this.#run(() => this.#writeOutput()),
      ];
    } catch (failure) {
      const startupFailure = failure instanceof Error ? failure : new Error(String(failure));
      this.#fail(startupFailure);
      this.#closed = true;
      try {
        await withTimeout(
          this.#closeResources(),
          this.#config.closeTimeoutS * 1_000,
          'OpenAI Realtime startup cleanup',
        );
      } catch {
        // Preserve the startup failure after the bounded cleanup attempt.
      }
      throw startupFailure;
    }
  }

  public async wait(signal?: AbortSignal): Promise<ConversationOutcome> {
    if (!this.#started) throw new Error('start() must complete before wait()');
    await Promise.race([
      this.#stopped,
      aborted(signal),
      delay(this.#config.maximumSessionS * 1_000, this.#controller.signal),
    ]);
    if (this.#failure !== undefined) throw this.#failure;
    return this.#outcome('stopped');
  }

  public async interrupt(_signal?: AbortSignal): Promise<void> {
    this.#cancelCurrentResponse(true, 'interrupted');
  }

  public async cancelOutput(_signal?: AbortSignal): Promise<void> {
    this.#cancelCurrentResponse(false, 'output-cancelled');
  }

  public stop(): void {
    this.#requestStop();
  }

  public async close(signal?: AbortSignal): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await withTimeout(
      Promise.race([
        this.#closeResources(),
        aborted(signal),
      ]),
      this.#config.closeTimeoutS * 1_000,
      'OpenAI Realtime close',
    );
  }

  async #readInput(running: RunningSession): Promise<void> {
    for await (const frame of running.audio.frames({ signal: this.#controller.signal })) {
      if (!this.#inputQueue.push(encodeRealtimeMicrophoneFrame(frame))) {
        this.#inputFramesDropped += 1;
      }
    }
  }

  async #sendInput(): Promise<void> {
    while (!this.#controller.signal.aborted) {
      const audio = await this.#inputQueue.pop(this.#controller.signal);
      if (audio === undefined) return;
      if (this.#trySend({ type: 'input_audio_buffer.append', audio })) {
        this.#inputFramesSent += 1;
      } else {
        this.#inputFramesDropped += 1;
        this.#inputFramesDroppedBySocketPressure += 1;
      }
    }
  }

  async #writeOutput(): Promise<void> {
    while (!this.#controller.signal.aborted) {
      const chunk = await this.#outputQueue.pop(this.#controller.signal);
      if (chunk === undefined) return;
      if (chunk.response.cancelled || !chunk.response.generation.active) {
        this.#outputChunksRejected += 1;
        continue;
      }
      const frames = chunk.done
        ? chunk.response.converter.finish()
        : chunk.response.converter.append(chunk.pcm16);
      for (const frame of frames) {
        try {
          await this.#output.write(frame, {
            generation: chunk.response.generation,
            timeoutMs: Math.round(this.#conversationConfig.outputWriteTimeoutS * 1_000),
            signal: this.#controller.signal,
          });
          this.#outputFramesWritten += 1;
        } catch {
          this.#outputFramesRejected += 1;
          if (!chunk.response.generation.active) break;
        }
      }
      if (chunk.done) this.#responses.delete(chunk.response.responseId);
    }
  }

  #receiveMessage(data: unknown, ready: Deferred<void>): void {
    try {
      const text = socketText(data);
      if (Buffer.byteLength(text) > 262_144) throw new RangeError('Realtime event exceeds 262144 bytes');
      const event = JSON.parse(text) as Record<string, unknown>;
      const eventType = requiredString(event, 'type');
      if (eventType === 'session.updated') {
        ready.resolve();
        return;
      }
      if (eventType === 'error') {
        this.#providerErrors += 1;
        throw new Error(providerError(event));
      }
      if (eventType === 'input_audio_buffer.speech_started') {
        this.#turnsStarted += 1;
        if (this.#conversationConfig.interruption.enabled) {
          this.#cancelCurrentResponse(
            this.#conversationConfig.interruption.cancelProviderWork,
            'speech-started',
          );
        }
        this.#event(eventType);
        return;
      }
      if (eventType === 'response.created') {
        const response = event.response;
        if (response === null || typeof response !== 'object') {
          throw new TypeError('OpenAI response.created is missing response');
        }
        const responseId = requiredString(response as Record<string, unknown>, 'id');
        if (this.#responses.has(responseId)) {
          throw new Error(`OpenAI response ${responseId} was created more than once`);
        }
        if (this.#responses.size >= this.#conversationConfig.providerEventQueueCapacity) {
          throw new RangeError('OpenAI active response state capacity was exceeded');
        }
        const previousResponseId = this.#currentResponseId;
        if (previousResponseId !== undefined) {
          const previous = this.#responses.get(previousResponseId);
          if (previous !== undefined && !previous.cancelled && !previous.audioDone) {
            this.#cancelResponse(previous, true, 'superseded');
          }
        }
        this.#responses.set(responseId, {
          responseId,
          generation: this.#output.beginOutput(),
          converter: new Pcm24To48(),
          cancelled: false,
          audioDone: false,
        });
        this.#currentResponseId = responseId;
        return;
      }
      if (eventType === 'response.output_audio.delta') {
        const responseId = requiredString(event, 'response_id');
        const response = this.#responses.get(responseId);
        if (response === undefined || response.cancelled || response.audioDone) {
          this.#outputChunksRejected += 1;
          return;
        }
        const delta = requiredString(event, 'delta');
        this.#outputChunksReceived += 1;
        if (!this.#outputQueue.push({
          response,
          pcm16: Uint8Array.from(Buffer.from(delta, 'base64')),
          done: false,
        })) {
          this.#outputChunksDropped += 1;
          this.#cancelResponse(response, true, 'output-queue-full');
        }
        return;
      }
      if (eventType === 'response.output_audio.done') {
        const responseId = requiredString(event, 'response_id');
        const response = this.#responses.get(responseId);
        if (response === undefined || response.cancelled || response.audioDone) {
          this.#outputChunksRejected += 1;
          return;
        }
        response.audioDone = true;
        if (!this.#outputQueue.push({
          response,
          pcm16: new Uint8Array(),
          done: true,
        })) {
          this.#outputChunksRejected += 1;
          this.#cancelResponse(response, true, 'output-queue-full');
        }
        return;
      }
      if (
        eventType === 'conversation.item.input_audio_transcription.delta'
        || eventType === 'conversation.item.input_audio_transcription.completed'
      ) {
        const itemId = requiredString(event, 'item_id');
        if (
          !this.#transcripts.has(itemId)
          && this.#transcripts.size >= this.#conversationConfig.transcriptStateCapacity
        ) {
          throw new RangeError('OpenAI transcript state capacity was exceeded');
        }
        const values = transcriptEventValues(
          this.#transcripts,
          eventType,
          event,
          eventType.endsWith('.delta') ? event.delta : event.transcript,
          this.#conversationConfig.maximumTranscriptCharacters,
        );
        this.#transcriptUpdatesReceived += 1;
        if (values.final) {
          this.#turnsCompleted += 1;
          this.#transcripts.delete(itemId);
        }
        this.#event(eventType, values);
        return;
      }
      if (eventType === 'response.done') {
        const response = event.response;
        if (response === null || typeof response !== 'object') {
          throw new TypeError('OpenAI response.done is missing response');
        }
        const responseId = requiredString(response as Record<string, unknown>, 'id');
        const output = this.#responses.get(responseId);
        if (output !== undefined && !output.audioDone) {
          this.#cancelResponse(output, false, 'response-done-without-audio-done');
          this.#responses.delete(responseId);
        } else if (output?.cancelled === true) {
          this.#responses.delete(responseId);
        }
        if (this.#currentResponseId === responseId) this.#currentResponseId = undefined;
      }
    } catch (failure) {
      this.#fail(failure instanceof Error ? failure : new Error(String(failure)));
    }
  }

  #trySend(value: Readonly<Record<string, unknown>>): boolean {
    const socket = this.#socket;
    if (socket === undefined || socket.readyState !== 1) {
      throw new Error('OpenAI Realtime socket is not open');
    }
    if (!Number.isFinite(socket.bufferedAmount) || socket.bufferedAmount < 0) {
      throw new RangeError('OpenAI Realtime socket reported an invalid bufferedAmount');
    }
    const message = JSON.stringify(value);
    if (
      socket.bufferedAmount + Buffer.byteLength(message)
      > this.#config.maximumWebSocketBufferedBytes
    ) {
      return false;
    }
    socket.send(message);
    return true;
  }

  #sendCritical(value: Readonly<Record<string, unknown>>): void {
    if (!this.#trySend(value)) {
      throw new Error('OpenAI Realtime socket backpressure rejected a control event');
    }
  }

  #cancelCurrentResponse(notifyProvider: boolean, reason: string): void {
    const responseId = this.#currentResponseId;
    if (responseId === undefined) return;
    const response = this.#responses.get(responseId);
    if (response === undefined) return;
    this.#cancelResponse(response, notifyProvider, reason);
  }

  #cancelResponse(
    response: RealtimeResponseOutput,
    notifyProvider: boolean,
    reason: string,
  ): void {
    if (response.cancelled) return;
    response.cancelled = true;
    response.converter.clear();
    if (response.generation.active && response.generation.cancel()) {
      this.#outputGenerationsCancelled += 1;
    }
    this.#outputChunksCancelled += this.#outputQueue.discard(
      (chunk) => chunk.response === response,
    );
    this.#event(`response.output_audio.cancelled.${reason}`);
    if (notifyProvider) {
      this.#sendCritical({ type: 'response.cancel', response_id: response.responseId });
    }
  }

  async #closeResources(): Promise<void> {
    this.#inputReady = false;
    this.#controller.abort();
    this.#inputQueue.close();
    this.#outputQueue.close();
    for (const response of this.#responses.values()) {
      this.#cancelResponse(response, false, 'connection-closed');
    }
    const socket = this.#socket;
    if (socket !== undefined && socket.readyState !== 3) {
      socket.close(1000, 'PocketStation conversation closed');
    } else {
      this.#socketClosed.resolve();
    }
    await Promise.all([
      Promise.allSettled(this.#tasks).then(() => undefined),
      this.#socketClosed.promise,
    ]);
  }

  #event(eventType: string, transcript?: RealtimeTranscriptValues): void {
    this.#events.push(new VoiceEvent({
      kind: eventType,
      timestampNs: process.hrtime.bigint(),
      utteranceId: transcript?.utteranceId,
      transcriptRevision: transcript?.transcriptRevision,
    }));
    if (this.#events.length > this.#conversationConfig.eventCapacity) this.#events.shift();
  }

  #run(task: () => Promise<void>): Promise<void> {
    return task().catch((failure: unknown) => {
      if (this.#controller.signal.aborted) return;
      this.#mediaWorkerErrors += 1;
      this.#fail(failure instanceof Error ? failure : new Error(String(failure)));
    });
  }

  #fail(failure: Error): void {
    if (this.#failure === undefined) this.#failure = failure;
    this.#requestStop();
  }

  #requestStop(): void {
    this.#inputReady = false;
    this.#stopResolve?.();
    this.#stopResolve = undefined;
  }

  #outcome(disposition: 'stopped' | 'failed'): ConversationOutcome {
    return new ConversationOutcome({
      disposition: this.#failure === undefined ? disposition : 'failed',
      turnsStarted: this.#turnsStarted,
      turnsCompleted: this.#turnsCompleted,
      turnsInterrupted: this.#outputGenerationsCancelled,
      transcriptUpdatesReceived: this.#transcriptUpdatesReceived,
      speculativeResponsesStarted: 0,
      speculativeResponsesReused: 0,
      outputGenerationsCancelled: this.#outputGenerationsCancelled,
      outputFramesWritten: this.#outputFramesWritten,
      history: [],
      events: this.#events,
      failure: this.#failure?.message,
    });
  }
}

interface OutputChunk {
  readonly response: RealtimeResponseOutput;
  readonly pcm16: Uint8Array;
  readonly done: boolean;
}

interface RealtimeResponseOutput {
  readonly responseId: string;
  readonly generation: OutputGeneration;
  readonly converter: Pcm24To48;
  cancelled: boolean;
  audioDone: boolean;
}

class Pcm24To48 {
  #previous: number | undefined;
  #pending: number[] = [];

  public append(pcm16: Uint8Array): readonly Float32Array[] {
    if (pcm16.byteLength % 2 !== 0) throw new RangeError('provider PCM16 chunk has an odd byte count');
    const view = new DataView(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
    for (let offset = 0; offset < pcm16.byteLength; offset += 2) {
      const current = view.getInt16(offset, true) / 32_768;
      if (this.#previous !== undefined) {
        this.#pending.push(this.#previous, (this.#previous + current) * 0.5);
      }
      this.#previous = current;
    }
    return this.#takeFrames();
  }

  public finish(): readonly Float32Array[] {
    if (this.#previous !== undefined) {
      this.#pending.push(this.#previous, this.#previous);
      this.#previous = undefined;
    }
    const remainder = this.#pending.length % OUTPUT_FRAME_SAMPLES;
    if (remainder !== 0) this.#pending.push(...new Array(OUTPUT_FRAME_SAMPLES - remainder).fill(0));
    return this.#takeFrames();
  }

  public clear(): void {
    this.#previous = undefined;
    this.#pending = [];
  }

  #takeFrames(): readonly Float32Array[] {
    const result: Float32Array[] = [];
    while (this.#pending.length >= OUTPUT_FRAME_SAMPLES) {
      result.push(Float32Array.from(this.#pending.splice(0, OUTPUT_FRAME_SAMPLES)));
    }
    return result;
  }
}

class BoundedQueue<T> {
  readonly #capacity: number;
  readonly #maximumSize: number;
  readonly #sizeOf: (value: T) => number;
  readonly #values: T[] = [];
  #size = 0;
  #closed = false;
  #waiter: (() => void) | undefined;

  public constructor(
    capacity: number,
    maximumSize = Number.POSITIVE_INFINITY,
    sizeOf: (value: T) => number = () => 1,
  ) {
    this.#capacity = capacity;
    this.#maximumSize = maximumSize;
    this.#sizeOf = sizeOf;
  }

  public push(value: T): boolean {
    const size = this.#sizeOf(value);
    if (this.#closed || this.#values.length >= this.#capacity || this.#size + size > this.#maximumSize) {
      return false;
    }
    this.#values.push(value);
    this.#size += size;
    this.#waiter?.();
    this.#waiter = undefined;
    return true;
  }

  public async pop(signal: AbortSignal): Promise<T | undefined> {
    while (this.#values.length === 0 && !this.#closed) {
      await new Promise<void>((resolve, reject) => {
        const abortedListener = (): void => {
          this.#waiter = undefined;
          reject(signal.reason ?? new Error('queue wait aborted'));
        };
        this.#waiter = () => {
          signal.removeEventListener('abort', abortedListener);
          resolve();
        };
        signal.addEventListener('abort', abortedListener, { once: true });
        if (signal.aborted) abortedListener();
      });
    }
    const value = this.#values.shift();
    if (value !== undefined) this.#size -= this.#sizeOf(value);
    return value;
  }

  public discard(predicate: (value: T) => boolean): number {
    let discarded = 0;
    for (let index = this.#values.length - 1; index >= 0; index -= 1) {
      const value = this.#values[index];
      if (value !== undefined && predicate(value)) {
        this.#values.splice(index, 1);
        this.#size -= this.#sizeOf(value);
        discarded += 1;
      }
    }
    return discarded;
  }

  public close(): void {
    this.#closed = true;
    this.#waiter?.();
    this.#waiter = undefined;
  }
}

async function defaultSocketFactory(options: {
  readonly url: string;
  readonly apiKey: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}): Promise<RealtimeSocket> {
  let module: unknown;
  try {
    module = requirePackage('ws');
  } catch (failure) {
    throw new Error(
      'OpenAIRealtime requires the optional ws package; install it with npm install ws',
      { cause: failure },
    );
  }
  const WebSocket = (module as { WebSocket?: new (
    url: string,
    options: { readonly headers: Readonly<Record<string, string>> },
  ) => RealtimeSocket }).WebSocket;
  if (WebSocket === undefined) throw new TypeError('ws does not export WebSocket');
  const socket = new WebSocket(options.url, {
    headers: { Authorization: `Bearer ${options.apiKey}` },
  });
  await socketOpened(socket, options.timeoutMs, options.signal);
  return socket;
}

function socketOpened(socket: RealtimeSocket, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (socket.readyState === 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Realtime WebSocket open timed out')), timeoutMs);
    const finish = (operation: () => void): void => {
      clearTimeout(timeout);
      operation();
    };
    (socket as RealtimeSocket & { once?: (event: string, listener: (...args: unknown[]) => void) => unknown })
      .once?.('open', () => finish(resolve));
    socket.on('error', (failure) => finish(() => reject(failure)));
    signal?.addEventListener('abort', () => finish(() => reject(signal.reason)), { once: true });
  });
}

function socketText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  throw new TypeError('Realtime WebSocket message is not text or bytes');
}

function providerError(event: Readonly<Record<string, unknown>>): string {
  const error = event.error;
  if (error !== null && typeof error === 'object') {
    const message = optionalString(error as Record<string, unknown>, 'message');
    if (message !== undefined) return message;
  }
  return 'OpenAI Realtime returned an error event';
}

function pcm16(value: number): number {
  return Math.max(-32_768, Math.min(32_767, Math.round(value * 32_767)));
}

function requiredString(value: Readonly<Record<string, unknown>>, name: string): string {
  const result = value[name];
  if (typeof result !== 'string' || result.length === 0) throw new TypeError(`${name} must be a string`);
  return result;
}

function optionalString(value: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const result = value[name];
  return typeof result === 'string' && result.length > 0 ? result : undefined;
}

function nonEmpty(value: string, name: string): string {
  if (value.trim().length === 0) throw new TypeError(`${name} must not be empty`);
  return value;
}

function integer(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function finite(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || value <= minimum || value > maximum) {
    throw new RangeError(`${name} must be greater than ${minimum} and at most ${maximum}`);
  }
  return value;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(failure: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function linkAbort(signal: AbortSignal | undefined, controller: AbortController): void {
  if (signal === undefined) return;
  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
}

function aborted(signal: AbortSignal | undefined): Promise<never> {
  if (signal === undefined) return new Promise(() => undefined);
  return new Promise((_resolve, reject) => {
    const rejectAbort = (): void => reject(signal.reason ?? new Error('operation aborted'));
    if (signal.aborted) rejectAbort();
    else signal.addEventListener('abort', rejectAbort, { once: true });
  });
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    const abort = (): void => {
      clearTimeout(timeout);
      reject(signal.reason ?? new Error('delay aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
