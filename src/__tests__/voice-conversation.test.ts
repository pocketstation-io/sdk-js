import {
  Conversation,
  ConversationConfig,
  ConversationContext,
  ConversationOutcome,
  type ConversationOutput,
  type ConversationOutputGeneration,
  type ConversationRunningSession,
  type ConversationSignalEnvelope,
  type ConversationSignalStream,
  type ConversationSubscription,
  DuplexVoiceCapabilities,
  InterruptionConfig,
  ResponseCapabilities,
  ResponseChunk,
  SpeechActivity,
  SpeechDetectionCapabilities,
  SynthesisCapabilities,
  SynthesisChunk,
  TranscriptUpdate,
  TranscriptionCapabilities,
  UnsupportedVoiceCapabilityError,
  VoiceConfigurationError,
} from '../voice/index.js';
import {
  PortSpec,
  RouteSettings,
  Session,
  SignalSpec,
  defineSource,
} from '../node/index.js';

const END = Object.freeze({ kind: 'end-of-stream' as const });

function envelope(
  text: string,
  sequence: bigint,
): ConversationSignalEnvelope {
  return Object.freeze({
    payload: Object.freeze({ kind: 'text', text }),
    timing: Object.freeze({
      sourceTimestampNs: sequence * 10_000_000n,
      observedTimestampNs: sequence * 10_000_000n + 1n,
      durationNs: 10_000_000n,
    }),
    lineage: Object.freeze({
      sourceId: 11n,
      streamId: 12n,
      sequenceNumber: sequence,
    }),
  });
}

class QueueStream implements ConversationSignalStream {
  readonly #values: (
    | ConversationSignalEnvelope
    | typeof END
    | undefined
  )[];
  readonly #blockAfterValues: boolean;
  readonly #beforeSecond: Promise<void> | undefined;
  #reads = 0;

  public constructor(
    values: ConversationSignalEnvelope[],
    options: {
      blockAfterValues?: boolean;
      beforeSecond?: Promise<void>;
    } = {},
  ) {
    this.#values = [...values];
    this.#blockAfterValues = options.blockAfterValues ?? false;
    this.#beforeSecond = options.beforeSecond;
  }

  public async read(options: { signal?: AbortSignal } = {}) {
    this.#reads += 1;
    if (this.#reads === 2) await this.#beforeSecond;
    const next = this.#values.shift();
    if (next !== undefined) return next;
    if (!this.#blockAfterValues) return END;
    return await new Promise<never>((_resolve, reject) => {
      const rejectAbort = (): void => {
        const error = new Error('read aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (options.signal?.aborted === true) rejectAbort();
      else options.signal?.addEventListener('abort', rejectAbort, { once: true });
    });
  }
}

class FakeGeneration implements ConversationOutputGeneration {
  readonly id: bigint;
  #active = true;
  readonly #cancel: () => void;

  public constructor(id: bigint, cancel: () => void) {
    this.id = id;
    this.#cancel = cancel;
  }

  public get active(): boolean {
    return this.#active;
  }

  public cancel(): boolean {
    if (!this.#active) return false;
    this.#active = false;
    this.#cancel();
    return true;
  }
}

class FakeOutput implements ConversationOutput<number> {
  public readonly config = Object.freeze({ sampleRateHz: 48_000, channels: 1 });
  public readonly output = Object.freeze({ sessionId: 1n });
  public readonly writes: {
    readonly samples: number;
    readonly generationId: bigint;
    readonly discontinuity: boolean;
  }[] = [];
  #nextGeneration = 1n;

  public beginOutput(): ConversationOutputGeneration {
    const id = this.#nextGeneration++;
    return new FakeGeneration(id, () => {
      const retained = this.writes.filter((write) => write.generationId !== id);
      this.writes.splice(0, this.writes.length, ...retained);
    });
  }

  public async write(
    samples: number,
    options: {
      discontinuity?: boolean;
      generation?: ConversationOutputGeneration;
      signal?: AbortSignal;
    } = {},
  ): Promise<void> {
    if (options.signal?.aborted === true) {
      const error = new Error('write aborted');
      error.name = 'AbortError';
      throw error;
    }
    if (options.generation?.active !== true) {
      const error = new Error('output cancelled');
      error.name = 'AbortError';
      throw error;
    }
    this.writes.push({
      samples,
      generationId: options.generation.id,
      discontinuity: options.discontinuity ?? false,
    });
  }

  public observations() {
    return Object.freeze({ bufferSlots: 3n, availableBuffers: 3n });
  }
}

class HangingOutput extends FakeOutput {
  public aborted = false;
  public receivedTimeoutMs: number | undefined;

  public override async write(
    _samples: number,
    options: {
      discontinuity?: boolean;
      generation?: ConversationOutputGeneration;
      timeoutMs?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<void> {
    this.receivedTimeoutMs = options.timeoutMs;
    return await new Promise<never>((_resolve, reject) => {
      const rejectAbort = (): void => {
        this.aborted = true;
        const error = new Error('write aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (options.signal?.aborted === true) rejectAbort();
      else options.signal?.addEventListener('abort', rejectAbort, { once: true });
    });
  }
}

class FakeRunning implements ConversationRunningSession {
  public readonly sessionId = 1n;
  readonly #stream: QueueStream;

  public constructor(stream: QueueStream) {
    this.#stream = stream;
  }

  public signals(_subscription: ConversationSubscription): QueueStream {
    return this.#stream;
  }

  public async metrics() {
    return Object.freeze({ routes: Object.freeze([]) });
  }
}

const subscription = Object.freeze({ sessionId: 1n });

function conversation(
  values: ConversationSignalEnvelope[],
  options: {
    respond?: (
      update: TranscriptUpdate,
      context: ConversationContext,
      signal: AbortSignal,
    ) => string | ResponseChunk | AsyncIterable<string | ResponseChunk> | Promise<string>;
    synthesize?: (
      chunk: ResponseChunk,
      signal: AbortSignal,
    ) => AsyncIterable<number> | Promise<AsyncIterable<number>>;
    output?: FakeOutput;
    config?: ConversationConfig;
    decodeTranscript?: (value: ConversationSignalEnvelope) => TranscriptUpdate;
    blockAfterValues?: boolean;
    beforeSecond?: Promise<void>;
  } = {},
) {
  const output = options.output ?? new FakeOutput();
  const respond =
    options.respond ??
    (async (update: TranscriptUpdate): Promise<string> => `answer:${update.text}`);
  const synthesize =
    options.synthesize ??
    (async function* (chunk: ResponseChunk): AsyncGenerator<number> {
      yield chunk.text.length;
    });
  const value = new Conversation({
    transcripts: subscription,
    respond,
    synthesize: (chunk, _turn, signal) => synthesize(chunk, signal),
    output,
    config: options.config,
    decodeTranscript: options.decodeTranscript,
  });
  return {
    conversation: value,
    output,
    running: new FakeRunning(
      new QueueStream(values, {
        blockAfterValues: options.blockAfterValues,
        beforeSecond: options.beforeSecond,
      }),
    ),
  };
}

describe('voice conversation orchestration', () => {
  it('runs through one real Core Session and generated-audio Source', async () => {
    const transcript = SignalSpec.text('utf8', { role: 'transcript.final' });
    const feed = defineSource({
      id: 'org.pocketstation.source.voice-conversation.v1',
      outputs: [PortSpec.output('transcript', transcript)],
      create: () => {
        let emitted = false;
        return {
          next: () => {
            if (emitted) return undefined;
            emitted = true;
            return {
              output: 'transcript',
              data: 'real session',
              sourceTimestampNs: 10_000_000n,
              durationNs: 10_000_000n,
              terminal: true,
            };
          },
        };
      },
    });
    const session = new Session({ frameDurationMs: 10 });
    const source = session.source(feed).output('transcript');
    const transcripts = session.subscribe(source, {
      signal: transcript,
      route: RouteSettings.buffered(),
    });
    const output = session.audioInput('assistant', {
      capacityFrames: 2,
      frameSamplesPerChannel: 480,
    });
    output.output.send(session.audio());
    let recognizedSourceId: bigint | undefined;
    const value = session.conversation({
      transcripts,
      respond: async (update) => {
        recognizedSourceId = update.sourceId;
        return 'real answer';
      },
      synthesize: async function* () {
        yield new Float32Array(480).fill(0.25);
      },
      output,
    });

    const running = await session.start();
    const audio = running.audio.read({ timeoutMs: 1_000 });
    const outcome = await value.run(running);
    const frame = await audio;
    output.close();
    const stopped = await running.stop();

    expect(outcome.success).toBe(true);
    expect(outcome.outputFramesWritten).toBe(1);
    expect(recognizedSourceId).toBe(source.sourceId);
    expect(frame).toMatchObject({
      outputGenerationId: 1n,
      samples: expect.any(Float32Array),
    });
    expect(stopped.success).toBe(true);
  });

  it('runs one source-aware turn with bounded history, events, and output', async () => {
    const item = conversation([envelope('ship the answer', 1n)], {
      respond: async (_update, context) => {
        expect(context.committed).toBe(true);
        expect(context.history.at(-1)).toMatchObject({
          role: 'user',
          content: 'ship the answer',
        });
        return 'completed';
      },
      synthesize: async function* () {
        yield 0.1;
        yield 0.2;
      },
    });

    const outcome = await item.conversation.run(item.running);

    expect(outcome.success).toBe(true);
    expect(outcome).toMatchObject({
      turnsStarted: 1,
      turnsCompleted: 1,
      outputFramesWritten: 2,
    });
    expect(outcome.history.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(outcome.events.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        'turn.started',
        'response.completed',
        'turn.completed',
        'output.drained',
      ]),
    );
    expect(outcome.events.find((event) => event.kind === 'turn.started')).toMatchObject({
      utteranceId: '11:1',
      transcriptRevision: 1,
    });
    expect(item.output.writes).toHaveLength(2);
    await expect(item.conversation.run(item.running)).rejects.toThrow('only once');
  });

  it('fails explicitly when generated output exceeds its configured bound', async () => {
    const item = conversation([envelope('too much audio', 1n)], {
      config: new ConversationConfig({ maximumOutputFramesPerTurn: 1 }),
      synthesize: async function* () {
        yield 1;
        yield 2;
      },
    });

    const outcome = await item.conversation.run(item.running);

    expect(outcome.success).toBe(false);
    expect(outcome.disposition).toBe('failed');
    expect(outcome.outputFramesWritten).toBe(1);
    expect(outcome.failure).toContain('maximumOutputFramesPerTurn');
  });

  it('enforces the output-write deadline when an output ignores timeout options', async () => {
    const output = new HangingOutput();
    const item = conversation([envelope('blocked output', 1n)], {
      output,
      config: new ConversationConfig({ outputWriteTimeoutS: 0.01 }),
    });

    const outcome = await item.conversation.run(item.running);

    expect(outcome.disposition).toBe('failed');
    expect(outcome.failure).toContain('output write exceeded');
    expect(output.receivedTimeoutMs).toBe(10);
    expect(output.aborted).toBe(true);
  });

  it('reuses only the speculative response matching the final revision', async () => {
    const values = [
      envelope('partial-1', 1n),
      envelope('partial-2', 2n),
      envelope('final', 3n),
    ];
    const updates = new Map([
      ['partial-1', new TranscriptUpdate({
        utteranceId: 'speech-1', revision: 1, text: 'hello', stablePrefix: 'hello',
      })],
      ['partial-2', new TranscriptUpdate({
        utteranceId: 'speech-1', revision: 2, text: 'hello there', stablePrefix: 'hello',
      })],
      ['final', new TranscriptUpdate({
        utteranceId: 'speech-1', revision: 3, text: 'hello there',
        stablePrefix: 'hello there', final: true,
      })],
    ]);
    const responseInputs: [string, boolean][] = [];
    const synthesized: string[] = [];
    const item = conversation(values, {
      decodeTranscript: (value) => {
        const payload = value.payload as { text: string };
        return updates.get(payload.text) as TranscriptUpdate;
      },
      respond: async (update, context) => {
        responseInputs.push([update.text, context.committed]);
        async function* chunks(): AsyncGenerator<ResponseChunk> {
          yield new ResponseChunk({ text: 'answer: ' });
          yield new ResponseChunk({ text: update.text });
        }
        return chunks();
      },
      synthesize: async function* (chunk) {
        synthesized.push(chunk.text);
        yield 1;
      },
    });

    const outcome = await item.conversation.run(item.running);

    expect(outcome.success).toBe(true);
    expect(outcome).toMatchObject({
      transcriptUpdatesReceived: 3,
      speculativeResponsesStarted: 2,
      speculativeResponsesReused: 1,
    });
    expect(responseInputs).toEqual([
      ['hello', false],
      ['hello there', false],
    ]);
    expect(synthesized).toEqual(['answer: ', 'hello there']);
  });

  it('aborts obsolete provider work and discards its selected output', async () => {
    let obsoleteCancelled = false;
    let releaseOldFrame: (() => void) | undefined;
    const oldFrameWritten = new Promise<void>((resolve) => {
      releaseOldFrame = resolve;
    });
    const item = conversation(
      [envelope('obsolete', 1n), envelope('current', 2n)],
      {
        beforeSecond: oldFrameWritten,
        respond: async (update) => `answer:${update.text}`,
        synthesize: async function* (chunk, signal) {
          if (chunk.text === 'answer:obsolete') {
            yield -0.5;
            releaseOldFrame?.();
            await new Promise<never>((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => {
                  obsoleteCancelled = true;
                  const error = new Error('cancelled');
                  error.name = 'AbortError';
                  reject(error);
                },
                { once: true },
              );
            });
          }
          await oldFrameWritten;
          yield 0.5;
        },
      },
    );

    const outcome = await item.conversation.run(item.running);

    expect(obsoleteCancelled).toBe(true);
    expect(outcome.success).toBe(true);
    expect(outcome).toMatchObject({
      turnsStarted: 2,
      turnsInterrupted: 1,
      turnsCompleted: 1,
      outputGenerationsCancelled: 1,
    });
    expect(item.output.writes).toEqual([
      expect.objectContaining({ samples: 0.5, discontinuity: true }),
    ]);
  });

  it('returns a cancelled outcome and closes lifecycle work on abort', async () => {
    let responseStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      responseStarted = resolve;
    });
    let cancelled = false;
    const item = conversation([envelope('wait for me', 1n)], {
      blockAfterValues: true,
      respond: async (_update, _context, signal) => {
        responseStarted?.();
        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              cancelled = true;
              const error = new Error('cancelled');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        });
      },
    });
    const runningConversation = await item.conversation.start(item.running);
    await started;

    const outcome = await runningConversation.close({ abort: true });

    expect(cancelled).toBe(true);
    expect(outcome.disposition).toBe('cancelled');
    expect(outcome.turnsInterrupted).toBe(1);
    expect(outcome.outputFramesWritten).toBe(0);
  });

  it('enforces transcript revisions and stable prefixes', async () => {
    const values = [envelope('one', 1n), envelope('two', 2n)];
    const item = conversation(values, {
      decodeTranscript: (value) => {
        const sequence = value.lineage?.sequenceNumber ?? 0n;
        return new TranscriptUpdate({
          utteranceId: 'same',
          revision: 1,
          text: sequence === 1n ? 'hello' : 'changed',
          stablePrefix: sequence === 1n ? 'hello' : '',
        });
      },
    });

    const outcome = await item.conversation.run(item.running);

    expect(outcome.disposition).toBe('failed');
    expect(outcome.failure).toContain('transcript revisions must increase');
  });

  it('bounds provider startup and still closes providers that started', async () => {
    const lifecycle: string[] = [];
    const responder = Object.assign(
      async (): Promise<string> => 'unused',
      {
        start: async () => {
          lifecycle.push('responder.started');
        },
        close: async () => {
          lifecycle.push('responder.closed');
        },
      },
    );
    const synthesizer = Object.assign(
      async function* (): AsyncGenerator<number> {
        yield 1;
      },
      {
        start: async () => await new Promise<never>(() => {}),
        close: async () => {
          lifecycle.push('synthesizer.closed');
        },
      },
    );
    const output = new FakeOutput();
    const value = new Conversation({
      transcripts: subscription,
      respond: responder,
      synthesize: synthesizer,
      output,
      config: new ConversationConfig({ providerStartTimeoutS: 0.01 }),
    });

    const outcome = await value.run(
      new FakeRunning(new QueueStream([envelope('unused', 1n)])),
    );

    expect(outcome.disposition).toBe('failed');
    expect(outcome.failure).toContain('provider start exceeded');
    expect(lifecycle).toEqual(['responder.started', 'responder.closed']);
  });

  it('starts providers once and closes them in reverse order', async () => {
    const lifecycle: string[] = [];
    const responder = Object.assign(
      async (): Promise<string> => 'answer',
      {
        start: async () => {
          lifecycle.push('responder.started');
        },
        close: async () => {
          lifecycle.push('responder.closed');
        },
      },
    );
    const synthesizer = Object.assign(
      async function* (): AsyncGenerator<number> {
        yield 1;
      },
      {
        start: async () => {
          lifecycle.push('synthesizer.started');
        },
        close: async () => {
          lifecycle.push('synthesizer.closed');
        },
      },
    );
    const value = new Conversation({
      transcripts: subscription,
      respond: responder,
      synthesize: synthesizer,
      output: new FakeOutput(),
    });

    const outcome = await value.run(
      new FakeRunning(new QueueStream([envelope('lifecycle', 1n)])),
    );

    expect(outcome.success).toBe(true);
    expect(lifecycle).toEqual([
      'responder.started',
      'synthesizer.started',
      'synthesizer.closed',
      'responder.closed',
    ]);
  });

  it('rejects unsupported separate-component policies before Session start', () => {
    const output = new FakeOutput();
    const connection = {
      subscription,
      decode: () => undefined,
      start: async () => {},
      close: async () => {},
    };
    const stt = {
      capabilities: new TranscriptionCapabilities({ streaming: true }),
      transcribe: () => connection,
    };
    const llm = {
      capabilities: new ResponseCapabilities({
        streaming: true,
        cancellation: true,
      }),
      respond: async () => 'answer',
      start: async () => {},
      close: async () => {},
    };
    const tts = {
      capabilities: new SynthesisCapabilities({
        streaming: true,
        cancellation: true,
      }),
      synthesize: async () => (async function* () {
        yield new SynthesisChunk({
          samples: 1,
          sampleRateHz: 48_000,
          channels: 1,
          sequence: 0,
        });
      })(),
      start: async () => {},
      close: async () => {},
    };

    expect(() =>
      Conversation.fromComponents({
        session: {},
        input: {},
        output,
        stt,
        llm,
        tts,
      }),
    ).toThrow(UnsupportedVoiceCapabilityError);
  });

  it('runs validated separate components and preserves synthesis format', async () => {
    const output = new FakeOutput();
    const connection = {
      subscription,
      decode: (value: ConversationSignalEnvelope) => {
        const payload = value.payload as { text: string };
        return new TranscriptUpdate({
          utteranceId: 'component',
          revision: 1,
          text: payload.text,
          stablePrefix: payload.text,
          final: true,
        });
      },
      start: async () => {},
      close: async () => {},
    };
    const stt = {
      capabilities: new TranscriptionCapabilities({ streaming: true }),
      transcribe: () => connection,
    };
    const llm = {
      capabilities: new ResponseCapabilities({
        streaming: true,
        cancellation: false,
      }),
      respond: async () => 'component answer',
      start: async () => {},
      close: async () => {},
    };
    const tts = {
      capabilities: new SynthesisCapabilities({
        streaming: true,
        cancellation: false,
      }),
      synthesize: async () => (async function* () {
        yield new SynthesisChunk({
          samples: 7,
          sampleRateHz: 48_000,
          channels: 1,
          sequence: 0,
        });
      })(),
      start: async () => {},
      close: async () => {},
    };
    const value = Conversation.fromComponents({
      session: {},
      input: {},
      output,
      stt,
      llm,
      tts,
      config: new ConversationConfig({
        interruption: new InterruptionConfig({ enabled: false }),
      }),
    });

    const outcome = await value.run(
      new FakeRunning(new QueueStream([envelope('component input', 1n)])),
    );

    expect(outcome.success).toBe(true);
    expect(output.writes.map((write) => write.samples)).toEqual([7]);
  });

  it('runs and closes one validated duplex connection', async () => {
    const calls: string[] = [];
    const expected = new ConversationOutcome({
      disposition: 'completed',
      turnsStarted: 1,
      turnsCompleted: 1,
      turnsInterrupted: 0,
      transcriptUpdatesReceived: 1,
      speculativeResponsesStarted: 0,
      speculativeResponsesReused: 0,
      outputGenerationsCancelled: 0,
      outputFramesWritten: 1,
      history: [],
      events: [],
    });
    const connection = {
      start: async () => {
        calls.push('start');
      },
      wait: async () => expected,
      interrupt: async () => {
        calls.push('interrupt');
      },
      cancelOutput: async () => {
        calls.push('cancelOutput');
      },
      stop: () => {
        calls.push('stop');
      },
      close: async () => {
        calls.push('close');
      },
    };
    const model = {
      capabilities: new DuplexVoiceCapabilities({
        interruption: true,
        interruptionTriggers: ['speech-started'],
        providerSpeechDetection: true,
        responseCancellation: true,
      }),
      connect: () => connection,
    };
    const value = Conversation.fromDuplex({
      session: {},
      input: {},
      output: new FakeOutput(),
      voiceModel: model,
    });

    const running = await value.start(new FakeRunning(new QueueStream([])));
    const outcome = await running.wait();
    const closed = await running.close();

    expect(outcome).toBe(expected);
    expect(closed).toBe(expected);
    expect(calls).toEqual(['start', 'close']);
  });

  it('rejects mixed Sessions and invalid component declarations', () => {
    const output = new FakeOutput();
    expect(() => new Conversation({
      transcripts: { sessionId: 2n },
      respond: async () => 'answer',
      synthesize: async function* () { yield 1; },
      output,
    })).toThrow(VoiceConfigurationError);
    expect(() => new Conversation({ output })).toThrow(VoiceConfigurationError);
  });

  it('interrupts active delivery after minimum detected speech', async () => {
    let emitSpeech: ((activity: SpeechActivity) => void) | undefined;
    const activities = {
      async *[Symbol.asyncIterator](): AsyncGenerator<SpeechActivity> {
        const activity = await new Promise<SpeechActivity>((resolve) => {
          emitSpeech = resolve;
        });
        yield activity;
        await new Promise<never>(() => {});
      },
    };
    let responseStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      responseStarted = resolve;
    });
    const value = new Conversation({
      transcripts: subscription,
      respond: async (_update, _context, signal) => {
        responseStarted?.();
        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('interrupted');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      },
      synthesize: async function* () { yield 1; },
      output: new FakeOutput(),
      speechActivity: activities,
      providers: [{
        start: async () => {},
        close: async () => {},
      }],
      config: new ConversationConfig({
        cancellationTimeoutS: 0.01,
        interruption: new InterruptionConfig({ minimumSpeechMs: 1 }),
      }),
    });
    const handle = await value.start(
      new FakeRunning(
        new QueueStream([envelope('active', 1n)], { blockAfterValues: true }),
      ),
    );
    await started;
    emitSpeech?.(new SpeechActivity({
      kind: 'speech.started',
      sourceId: 11n,
      streamId: 12n,
      audioTimestampNs: 1n,
      detectionTimestampNs: 2n,
      providerId: 'vad',
      final: false,
    }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    handle.stop();

    const outcome = await handle.wait();

    expect(outcome.disposition).toBe('stopped');
    expect(outcome.turnsInterrupted).toBe(1);
    expect(outcome.events.map((event) => event.kind)).toContain(
      'input.speech.started',
    );
  });

  it('retains finite speech-detection capability values', () => {
    const capabilities = new SpeechDetectionCapabilities({
      streaming: false,
      confidence: true,
      supportedSampleRatesHz: [16_000],
    });
    expect(capabilities).toMatchObject({
      streaming: false,
      confidence: true,
      supportedSampleRatesHz: [16_000],
    });
  });
});
