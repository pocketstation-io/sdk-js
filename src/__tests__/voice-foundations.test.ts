import {
  ConversationConfig,
  ConversationContext,
  ConversationMessage,
  ConversationOutcome,
  ConversationResponse,
  ConversationTurn,
  DuplexVoiceCapabilities,
  DuplexVoiceContext,
  InterruptionConfig,
  MissingProviderCredentialError,
  ProviderTimeoutError,
  ResponseCapabilities,
  ResponseChunk,
  ResponseRequest,
  SpeechActivity,
  SpeechDetectionCapabilities,
  SynthesisCapabilities,
  SynthesisChunk,
  SynthesisRequest,
  ToolEvent,
  TranscriptUpdate,
  TranscriptionCapabilities,
  UnsupportedVoiceCapabilityError,
  VoiceCapabilities,
  VoiceDeadlines,
  VoiceEvent,
  VoiceLimits,
  type DuplexVoiceConnection,
  type DuplexVoiceModel,
  type ResponseModel,
  type SpeechDetector,
  type SpeechSynthesizer,
  type StreamingTranscriber,
  type TranscriptionConnection,
} from '../voice/index.js';

describe('provider-neutral voice foundations', () => {
  it('Given Python defaults When JavaScript values are constructed Then every limit and deadline matches', () => {
    const limits = new VoiceLimits();
    const deadlines = new VoiceDeadlines();
    const config = new ConversationConfig();
    const grouped = ConversationConfig.fromParts({ limits, deadlines });

    expect(limits).toMatchObject({
      historyMessages: 32,
      retainedEvents: 128,
      transcriptStates: 128,
      transcriptCharacters: 32_768,
      responseCharacters: 16_384,
      responseChunksPerTurn: 1_024,
      toolObservationsPerTurn: 32,
      generatedAudioFramesPerTurn: 3_000,
      providerEventBytes: 262_144,
      providerEventQueue: 128,
    });
    expect(deadlines).toMatchObject({
      providerStartS: 10,
      providerCloseS: 10,
      responseS: 60,
      synthesisS: 60,
      outputWriteS: 1,
      outputDrainS: 5,
      cancellationS: 2,
      signalWaitS: 0.1,
    });
    expect(config.maximumOutputFramesPerTurn).toBe(3_000);
    expect(config.providerCloseTimeoutS).toBe(10);
    expect(config.interruption).toEqual(new InterruptionConfig());
    expect(grouped).toEqual(config);
    expect(Object.isFrozen(limits)).toBe(true);
    expect(Object.isFrozen(deadlines)).toBe(true);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('Given unbounded Python-equivalent values When constructed Then validation rejects each value', () => {
    expect(() => new ConversationConfig({ historyCapacity: 0 })).toThrow(
      /historyMessages/,
    );
    expect(() => new ConversationConfig({ responseTimeoutS: 0 })).toThrow(
      /responseS/,
    );
    expect(
      () => new ConversationConfig({ providerCloseTimeoutS: 0 }),
    ).toThrow(/providerCloseS/);
    expect(
      () => new ConversationConfig({ outputDrainTimeoutS: 0 }),
    ).toThrow(/outputDrainS/);
    expect(
      () =>
        new ConversationConfig({ maximumOutputFramesPerTurn: 1_000_001 }),
    ).toThrow(/generatedAudioFramesPerTurn/);
    expect(
      () =>
        new InterruptionConfig({
          enabled: true,
          cancelProviderWork: false,
          cancelPendingOutput: false,
        }),
    ).toThrow(/enabled interruption/);
  });

  it('Given provider declarations When composed Then capability rules and immutable arrays match Python', () => {
    const sampleRates = [16_000, 48_000];
    const transcription = new TranscriptionCapabilities({
      streaming: true,
      transcriptRevisions: true,
      stablePrefix: true,
      supportedSampleRatesHz: sampleRates,
      inputFormats: ['f32le'],
    });
    const response = new ResponseCapabilities({
      streaming: true,
      cancellation: true,
      maximumContextCharacters: 4_096,
    });
    const synthesis = new SynthesisCapabilities({
      streaming: true,
      cancellation: true,
      outputFormats: ['f32le'],
      supportedSampleRatesHz: [48_000],
    });
    const speechDetection = new SpeechDetectionCapabilities({
      confidence: true,
    });
    sampleRates[0] = 8_000;

    const separate = new VoiceCapabilities({
      transcription,
      response,
      synthesis,
      speechDetection,
    });
    const duplex = new DuplexVoiceCapabilities({
      interruption: true,
      interruptionTriggers: ['speech-started', 'transcript-update'],
      responseCancellation: true,
      inputFormats: ['f32le'],
      outputFormats: ['f32le'],
      supportedSampleRatesHz: [48_000],
    });

    expect(transcription.supportedSampleRatesHz).toEqual([16_000, 48_000]);
    expect(Object.isFrozen(transcription.supportedSampleRatesHz)).toBe(true);
    expect(separate.duplex).toBeUndefined();
    expect(new VoiceCapabilities({ duplex }).duplex).toBe(duplex);
    expect(
      () => new VoiceCapabilities({ duplex, transcription }),
    ).toThrow(/duplex capabilities/);
    expect(
      () =>
        new DuplexVoiceCapabilities({
          interruption: true,
          interruptionTriggers: [],
        }),
    ).toThrow(/interruptionTriggers is required/);
    expect(
      () =>
        new TranscriptionCapabilities({
          streaming: true,
          supportedSampleRatesHz: [48_000, 48_000],
        }),
    ).toThrow(/duplicates/);
  });

  it('Given transcript revisions When validated Then source lineage and final-state invariants are retained', () => {
    const update = new TranscriptUpdate({
      utteranceId: 'speech-1',
      revision: 2,
      text: 'hello world',
      stablePrefix: 'hello ',
      sourceId: 3n,
      streamId: 4n,
      sourceSequence: 5n,
      sourceTimestampNs: 10n,
      audioStartNs: 10n,
      audioEndNs: 20n,
      sessionTimestampNs: 30n,
    });
    const final = new TranscriptUpdate({
      utteranceId: 'speech-1',
      revision: 3,
      text: 'hello world',
      stablePrefix: 'hello world',
      final: true,
    });

    expect(update.sourceId).toBe(3n);
    expect(update.audioEndNs).toBe(20n);
    expect(final.final).toBe(true);
    expect(() =>
      new TranscriptUpdate({
        utteranceId: 'speech-1',
        revision: 1,
        text: '',
        final: true,
      }),
    ).toThrow(/final transcript update/);
    expect(() =>
      new TranscriptUpdate({
        utteranceId: 'speech-1',
        revision: 1,
        text: 'hello',
        stablePrefix: 'goodbye',
      }),
    ).toThrow(/stablePrefix/);
    expect(() =>
      new TranscriptUpdate({
        utteranceId: 'speech-1',
        revision: 1,
        text: 'hello',
        audioStartNs: 20n,
        audioEndNs: 10n,
      }),
    ).toThrow(/audioEndNs/);
  });

  it('Given response values When constructed Then content, tools, and context remain immutable', () => {
    const history = [
      new ConversationMessage({
        role: 'user',
        content: 'hello',
        turnId: 1n,
        timestampNs: 10n,
      }),
    ];
    const context = new ConversationContext(history, true);
    const transcript = new TranscriptUpdate({
      utteranceId: 'speech-1',
      revision: 1,
      text: 'hello',
      stablePrefix: 'hello',
      final: true,
    });
    const tools = [new ToolEvent('lookup', 'completed', 'local')];
    const chunk = new ResponseChunk({
      text: 'answer',
      toolEvents: tools,
      responseId: 'response-1',
      turnId: 1n,
      providerTimestampNs: 20n,
    });
    const response = new ConversationResponse('answer', tools);
    const request = new ResponseRequest(transcript, context);
    history.length = 0;
    tools.length = 0;

    expect(context.history).toHaveLength(1);
    expect(chunk.toolEvents).toHaveLength(1);
    expect(response.toolEvents).toHaveLength(1);
    expect(request.transcript).toBe(transcript);
    expect(Object.isFrozen(chunk.toolEvents)).toBe(true);
    expect(() => new ConversationResponse(' ')).toThrow(/response text/);
    expect(() => new ToolEvent('', 'completed')).toThrow(/tool event name/);
    expect(() => new ResponseChunk()).toThrow(/response chunk/);
    expect(new ResponseChunk({ final: true }).final).toBe(true);
  });

  it('Given a committed turn and terminal outcome When inspected Then identities, counters, and success match Python', () => {
    const turn = new ConversationTurn({
      id: 1n,
      utteranceId: 'speech-1',
      text: 'hello',
      sourceId: 3n,
      streamId: 4n,
      sourceSequence: 5n,
      sourceTimestampNs: 10n,
      audioStartNs: 10n,
      audioEndNs: 20n,
      receivedTimestampNs: 25n,
    });
    const message = new ConversationMessage({
      role: 'assistant',
      content: 'answer',
      turnId: turn.id,
      timestampNs: 30n,
    });
    const history = [message];
    const events = [new VoiceEvent({ kind: 'turn.completed', timestampNs: 30n })];
    const outcome = new ConversationOutcome({
      disposition: 'completed',
      turnsStarted: 1,
      turnsCompleted: 1,
      turnsInterrupted: 0,
      transcriptUpdatesReceived: 2,
      speculativeResponsesStarted: 0,
      speculativeResponsesReused: 0,
      outputGenerationsCancelled: 0,
      outputFramesWritten: 5,
      history,
      events,
    });
    history.length = 0;
    events.length = 0;

    expect(turn.sourceId).toBe(3n);
    expect(outcome.success).toBe(true);
    expect(outcome.history).toHaveLength(1);
    expect(outcome.events).toHaveLength(1);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(
      new ConversationOutcome({
        ...outcome,
        disposition: 'failed',
        failure: 'provider failed',
      }).success,
    ).toBe(false);
  });

  it('Given generated audio and speech activity When constructed Then units and source identity are validated', () => {
    const response = new ResponseChunk({ text: 'answer' });
    const turn = new ConversationTurn({
      id: 1n,
      utteranceId: 'speech-1',
      text: 'hello',
      receivedTimestampNs: 25n,
    });
    const request = new SynthesisRequest(response, turn);
    const observations = [{ provider: 'local' }];
    const chunk = new SynthesisChunk({
      samples: new Float32Array(480),
      sampleRateHz: 48_000,
      channels: 1,
      sequence: 0,
      responseId: 'response-1',
      turnId: 1n,
      timestampNs: 30n,
      providerObservations: observations,
    });
    const activity = new SpeechActivity({
      kind: 'speech.started',
      sourceId: 3n,
      streamId: 4n,
      audioTimestampNs: 10n,
      detectionTimestampNs: 12n,
      providerId: 'detector.local',
      final: false,
      confidence: 0.9,
    });
    observations.length = 0;

    expect(request.turn).toBe(turn);
    expect(chunk.sampleRateHz).toBe(48_000);
    expect(chunk.providerObservations).toHaveLength(1);
    expect(Object.isFrozen(chunk.providerObservations)).toBe(true);
    expect(activity.sourceId).toBe(3n);
    expect(() =>
      new SynthesisChunk({
        samples: new Float32Array(),
        sampleRateHz: 0,
        channels: 1,
        sequence: 0,
      }),
    ).toThrow(/sampleRateHz/);
    expect(() =>
      new SpeechActivity({
        kind: 'speech.started',
        sourceId: 1n,
        streamId: 1n,
        audioTimestampNs: 0n,
        detectionTimestampNs: 0n,
        providerId: 'detector.local',
        final: false,
        confidence: 1.1,
      }),
    ).toThrow(/confidence/);
  });

  it('Given voice failures When raised Then stable codes and recovery facts remain actionable', () => {
    const cause = new Error('credential source missing');
    const missing = new MissingProviderCredentialError('missing credential', {
      stage: 'provider.start',
      providerId: 'provider.local',
      cleanedUp: ['transcriber'],
      inputRemainsActive: true,
      nextAction: 'configure the provider credential',
      cause,
    });
    const unsupported = new UnsupportedVoiceCapabilityError(
      'cancellation is required',
      { stage: 'composition.validate' },
    );
    const timeout = new ProviderTimeoutError('response timed out', {
      stage: 'response.wait',
    });

    expect(missing.code).toBe('voice.missing_provider_credential');
    expect(missing.cleanedUp).toEqual(['transcriber']);
    expect(missing.inputRemainsActive).toBe(true);
    expect(missing.cause).toBe(cause);
    expect(Object.isFrozen(missing.cleanedUp)).toBe(true);
    expect(unsupported.code).toBe('voice.unsupported_capability');
    expect(timeout.code).toBe('voice.provider_timeout');
  });

  it('Given provider adapters When typed Then every Python lifecycle operation has a JavaScript equivalent', async () => {
    const transcriptionCapabilities = new TranscriptionCapabilities({
      streaming: true,
    });
    const connection: TranscriptionConnection<string, string> = {
      subscription: 'transcripts',
      decode: (envelope) =>
        new TranscriptUpdate({
          utteranceId: envelope,
          revision: 1,
          text: 'done',
          stablePrefix: 'done',
          final: true,
        }),
      start: async () => undefined,
      close: async () => undefined,
    };
    const transcriber: StreamingTranscriber<
      object,
      object,
      TranscriptionConnection<string, string>
    > = {
      capabilities: transcriptionCapabilities,
      transcribe: () => connection,
    };
    const responseModel: ResponseModel = {
      capabilities: new ResponseCapabilities({ streaming: true }),
      respond: () => new ConversationResponse('done'),
      start: async () => undefined,
      close: async () => undefined,
    };
    const synthesizer: SpeechSynthesizer<Float32Array> = {
      capabilities: new SynthesisCapabilities({ streaming: true }),
      synthesize: async () =>
        (async function* () {
          yield new Float32Array(480);
        })(),
      start: async () => undefined,
      close: async () => undefined,
    };
    const detector: SpeechDetector<object, object> = {
      capabilities: new SpeechDetectionCapabilities(),
      detect: async function* () {
        yield new SpeechActivity({
          kind: 'speech.stopped',
          sourceId: 1n,
          streamId: 1n,
          audioTimestampNs: 0n,
          detectionTimestampNs: 1n,
          providerId: 'detector.local',
          final: true,
        });
      },
      start: async () => undefined,
      close: async () => undefined,
    };
    const duplexConnection: DuplexVoiceConnection<object> = {
      start: async () => undefined,
      wait: async () =>
        new ConversationOutcome({
          disposition: 'stopped',
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
        }),
      interrupt: async () => undefined,
      cancelOutput: async () => undefined,
      stop: () => undefined,
      close: async () => undefined,
    };
    const duplexModel: DuplexVoiceModel<object, object, object, object> = {
      capabilities: new DuplexVoiceCapabilities(),
      connect: () => duplexConnection,
    };
    const duplexContext = new DuplexVoiceContext(
      {},
      {},
      {},
      new ConversationConfig(),
    );

    await connection.start();
    expect(connection.decode('speech-1')?.final).toBe(true);
    expect(transcriber.transcribe({ session: {}, input: {} })).toBe(connection);
    expect(responseModel.respond).toBeDefined();
    expect(synthesizer.synthesize).toBeDefined();
    expect(detector.detect).toBeDefined();
    expect(duplexModel.connect(duplexContext)).toBe(duplexConnection);
    await connection.close();
  });
});
