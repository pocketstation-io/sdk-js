import {
  AudioCaps,
  BackpressurePolicy,
  BinaryFormat,
  ChannelLayout,
  ClockDomain,
  Codec,
  CopyPolicy,
  DeliveryPolicy,
  DeliverySemantics,
  EndpointConfiguration,
  EndpointDescriptor,
  EventFormat,
  GraphError,
  LossPolicy,
  MediaCaps,
  MediaKind,
  Multiplicity,
  Operator,
  OperatorConfiguration,
  PocketStationError,
  PortDirection,
  PortSpec,
  RouteObservability,
  RouteSettings,
  SampleFormat,
  Session,
  SignalSpec,
  SignalKind,
  Source,
  SourceConfiguration,
  TextFormat,
  secret,
} from '../node/index.js';

describe('native graph declarations', () => {
  it('exports every language-neutral graph value at runtime', () => {
    expect(SignalKind.PCM_AUDIO).toBe('pcm-audio');
    expect(Codec.OPUS).toBe('opus');
    expect(TextFormat.MARKDOWN).toBe('markdown');
    expect(EventFormat.PROTOBUF).toBe('protobuf');
    expect(BinaryFormat.CBOR).toBe('cbor');
    expect(MediaKind.AUDIO_PCM).toBe('audio-pcm');
    expect(ChannelLayout.channelCount(ChannelLayout.MONO)).toBe(1);
    expect(ChannelLayout.channelCount(ChannelLayout.STEREO)).toBe(2);
    expect(ChannelLayout.channelCount(ChannelLayout.ANY)).toBeUndefined();
    expect(SampleFormat.F32_INTERLEAVED).toBe('f32-interleaved');
    expect(PortDirection.INPUT).toBe('input');
    expect(Multiplicity.MANY).toBe('many');
    expect(ClockDomain.isRealtime(ClockDomain.CAPTURE)).toBe(true);
    expect(ClockDomain.isRealtime(ClockDomain.NETWORK)).toBe(false);
    expect(DeliverySemantics.ORDERED).toBe('ordered');
    expect(LossPolicy.MUST_DELIVER_OR_FAIL).toBe('must-deliver-or-fail');
    expect(RouteObservability.rank(RouteObservability.FULL)).toBe(2);
  });

  it('uses Core for signal identity, compatibility, and validation', () => {
    const transcript = SignalSpec.text('json', {
      role: 'transcript.final',
      schema: 'https://example.test/transcript.schema.json',
    });

    expect(transcript.wireId).toBe('pks.signal.text.json.v1');
    expect(transcript.kind).toBe('text');
    expect(transcript.role).toBe('transcript.final');
    expect(transcript.isAudio).toBe(false);
    expect(transcript.isCompatibleWith(SignalSpec.text('json'))).toBe(true);
    expect(transcript.isCompatibleWith(SignalSpec.audio())).toBe(false);
    expect(SignalSpec.encodedAudio(Codec.Opus).wireId).toBe(
      'pks.signal.encoded.opus.v1',
    );

    try {
      SignalSpec.custom('');
      throw new Error('SignalSpec.custom accepted an empty identifier');
    } catch (failure) {
      expect(failure).toBeInstanceOf(GraphError);
      expect(failure).toMatchObject({ code: 'graph.invalid_contract' });
    }
    expect(() => SignalSpec.text('json', { role: '' })).toThrow(
      'role cannot be empty',
    );
  });

  it('uses Core for media negotiation and named-port validation', () => {
    const anyAudio = MediaCaps.audio();
    const exactRequirements = new AudioCaps({
      sampleRateHz: 48_000,
      frameSamples: 480,
      channelLayout: ChannelLayout.MONO,
    });
    const exactAudio = MediaCaps.audio(exactRequirements);
    const stereo = MediaCaps.audio({
      sampleRateHz: 48_000,
      frameSamples: 480,
      channelLayout: 'stereo',
    });

    expect(anyAudio.negotiate(exactAudio)?.sampleRateHz).toBe(48_000);
    expect(exactAudio.audioCaps).toEqual(exactRequirements);
    expect(exactAudio.audioCaps?.format).toBe(SampleFormat.F32_INTERLEAVED);
    expect(MediaCaps.text().audioCaps).toBeUndefined();
    expect(exactAudio.isCompatibleWith(stereo)).toBe(false);
    expect(exactAudio.supportsSignal(SignalSpec.audio())).toBe(true);
    expect(() => MediaCaps.audio({ sampleRateHz: 0 })).toThrow(
      'sampleRateHz must be greater than zero',
    );
    expect(() => MediaCaps.audio({ frameSamples: 0 })).toThrow(
      'frameSamples must be greater than zero',
    );

    const input = PortSpec.input('audio', SignalSpec.audio(), {
      media: exactAudio,
      multiplicity: 'many',
    });
    expect(input.direction).toBe('input');
    expect(input.multiplicity).toBe('many');
    expect(input.media.frameSamples).toBe(480);
    expect(() =>
      PortSpec.input('audio', SignalSpec.text(), { media: exactAudio }),
    ).toThrow(PocketStationError);
  });

  it('keeps media requirements separate from delivery behavior', () => {
    const delivery = DeliveryPolicy.boundedAsync()
      .withBackpressure(BackpressurePolicy.DROP_OLDEST)
      .withCopyPolicy(CopyPolicy.COPY_TO_BRANCH_POOL)
      .withJitterBudgetMs(25)
      .withMaxPayloadBytes(4096);
    const route = RouteSettings.create(MediaCaps.text(), delivery);

    expect(route.media.kind).toBe('text');
    expect(route.backpressure).toBe(BackpressurePolicy.DROP_OLDEST);
    expect(route.copyPolicy).toBe(CopyPolicy.COPY_TO_BRANCH_POOL);
    expect(route.jitterBudgetMs).toBe(25);
    expect(route.maxPayloadBytes).toBe(4096);
    expect(route.delivery).toBe(DeliverySemantics.ORDERED);
    expect(route.deliveryPolicy).toBeInstanceOf(DeliveryPolicy);
    expect(
      RouteSettings.boundedAsync()
        .withBackpressure(BackpressurePolicy.BLOCK_FORBIDDEN)
        .withCopyPolicy(CopyPolicy.SHARE_READ_ONLY)
        .withJitterBudgetMs(10)
        .withMaxPayloadBytes(512),
    ).toMatchObject({
      backpressure: BackpressurePolicy.BLOCK_FORBIDDEN,
      copyPolicy: CopyPolicy.SHARE_READ_ONLY,
      jitterBudgetMs: 10,
      maxPayloadBytes: 512,
    });
    expect(() => delivery.withMaxPayloadBytes(0)).toThrow(PocketStationError);
  });

  it('requires explicit loss permission without weakening the original policy', () => {
    const required = DeliveryPolicy.boundedAsync();
    const lossy = required.withLoss(LossPolicy.DROP_ALLOWED);
    expect(required.loss).toBe(LossPolicy.MUST_DELIVER_OR_FAIL);
    expect(lossy.loss).toBe(LossPolicy.DROP_ALLOWED);
    expect(RouteSettings.create(MediaCaps.text(), lossy).deliveryPolicy.loss)
      .toBe(LossPolicy.DROP_ALLOWED);
    expect(() => required.withLoss('silent-success' as LossPolicy)).toThrow(PocketStationError);
  });

  it('keeps open Operator, Source, and Endpoint configuration immutable', () => {
    const operatorConfiguration = new OperatorConfiguration([
      ['language', 'en'],
      ['token', secret('not-logged')],
    ]);
    const operator = new Operator(
      'org.example.transcriber.v1',
      operatorConfiguration,
    );
    expect(operator.operatorId).toBe('org.example.transcriber.v1');
    expect(operator.configuration).toBe(operatorConfiguration);
    expect(JSON.stringify(operatorConfiguration)).not.toContain('not-logged');
    expect(JSON.stringify(operatorConfiguration)).toContain('<redacted>');
    expect(new OperatorConfiguration({ z: 'last', 'ä': 'unicode' }).values).toEqual([
      ['z', 'last'],
      ['ä', 'unicode'],
    ]);
    expect(new OperatorConfiguration({ '\u{10000}': 'non-bmp', '\uE000': 'bmp' }).values).toEqual([
      ['\uE000', 'bmp'],
      ['\u{10000}', 'non-bmp'],
    ]);
    expect(
      () => new OperatorConfiguration({ attempts: 1 as unknown as string }),
    ).toThrow('configuration values must be strings or SecretValue');
    expect(
      () => new EndpointConfiguration({
        token: { value: 'forged', secret: true } as ReturnType<typeof secret>,
      }),
    ).toThrow('configuration values must be strings or SecretValue');
    expect(operatorConfiguration.withValue('language', 'fr').values[0]).toEqual([
      'language',
      'fr',
    ]);

    const sourceConfiguration = new SourceConfiguration({ device: 'default' });
    expect(sourceConfiguration.withValue('mode', 'voice').values).toEqual([
      ['device', 'default'],
      ['mode', 'voice'],
    ]);
    expect(
      () => new SourceConfiguration([['device', 'a'], ['device', 'b']]),
    ).toThrow(TypeError);
    expect(() => new SourceConfiguration({ '': 'missing-key' })).toThrow(
      'configuration keys must be non-empty strings',
    );
    expect(new SourceConfiguration({ z: 'last', 'ä': 'unicode' }).values).toEqual([
      ['z', 'last'],
      ['ä', 'unicode'],
    ]);

    const endpointConfiguration = new EndpointConfiguration({ path: '/tmp/out' });
    const descriptor = new EndpointDescriptor(
      'org.example.endpoint-node.v1',
      'org.example.endpoint.v1',
      {
        configuration: endpointConfiguration,
        routeSettings: RouteSettings.boundedAsync(),
      },
    );
    expect(descriptor.nodeTypeId).toBe('org.example.endpoint-node.v1');
    expect(descriptor.operatorId).toBe('org.example.endpoint.v1');
    expect(descriptor.configuration).toBe(endpointConfiguration);
    expect(descriptor.routeSettings).toBeInstanceOf(RouteSettings);
    expect(Object.isFrozen(descriptor)).toBe(true);
  });

  it('declares operators, named ports, endpoints, recording, and generated audio on one Session', () => {
    const session = new Session({ recordingRoot: '/tmp/pocketstation-js-recordings' });
    const application = session.capture(Source.application('PocketStation Fixture'));
    const transcriber = session.operator(
      new Operator('org.example.transcriber.v1', {
        language: 'en',
        token: secret('not-logged'),
      }),
    );
    const destination = session.endpoint(
      new EndpointDescriptor(
        'org.example.transcript-endpoint.v1',
        'org.example.transcript-writer.v1',
        { routeSettings: RouteSettings.boundedAsync() },
      ),
    );

    const input = transcriber.input('audio');
    const firstRoute = application.connect(input);
    const transcript = transcriber.output('transcript');
    const secondRoute = transcript.send(destination, { inputPort: 'events' });
    const generated = transcript.reenterAudio();
    generated.send(session.audio());
    application.record('application');

    expect(input.name).toBe('audio');
    expect(input.portName).toBe('audio');
    expect(transcriber.sessionId).toBe(session.id);
    expect(transcriber.instanceId).toBe(transcriber.id);
    expect(application.sessionId).toBe(session.id);
    expect(transcript.outputName).toBe('transcript');
    expect(transcript.outputPort).toBe('transcript');
    expect(transcript.operatorInstanceId).toBe(transcriber.id);
    expect(transcript.sessionId).toBe(session.id);
    expect(firstRoute).toBeGreaterThan(0n);
    expect(secondRoute).toBeGreaterThan(firstRoute);
    expect(generated.id).toBeGreaterThan(application.id);
    expect(generated.sessionId).toBe(session.id);
  });

  it('rejects resources from different Sessions', () => {
    const first = new Session();
    const second = new Session();
    const stem = first.capture(Source.systemAudio());
    const operator = second.operator(new Operator('org.example.operator.v1'));

    expect(() => stem.connect(operator.input('audio'))).toThrow(
      expect.objectContaining({
        name: 'SessionDeclarationError',
        code: 'session.foreign_endpoint',
      }),
    );
  });

  it('declares the shared browser Endpoint and validates its URI', () => {
    const session = new Session();
    const browser = session.browser('https://receiver.example.test');

    expect(browser.sessionId).toBe(session.id);
    expect(browser.id).toBeGreaterThan(0n);
    expect(() => session.browser('   ')).toThrow(
      expect.objectContaining({
        name: 'SessionDeclarationError',
        code: 'session.invalid_endpoint',
      }),
    );
  });

  it('uses canonical route option names and guards conflicting legacy aliases', () => {
    const session = new Session();
    const input = session.audioInput('route-options');
    const endpoint = session.polledAudio();
    const routeSettings = RouteSettings.boundedAsync();

    expect(input.output.send(endpoint, { inputPort: 'audio' })).toBeGreaterThan(0n);
    const subscription = session.subscribe(input.output, {
      signal: SignalSpec.audio(),
      routeSettings,
    });
    expect(subscription.routeSettings).toBe(routeSettings);
    expect(() => input.output.send(endpoint, {
      inputPort: 'audio',
      input: 'other',
    })).toThrow('inputPort and deprecated input must match');
    expect(() => session.subscribe(input.output, {
      signal: SignalSpec.audio(),
      routeSettings,
      route: RouteSettings.boundedAsync(),
    })).toThrow('routeSettings and deprecated route must match');
  });

  it('specializes default subscription media to the declared signal', () => {
    const session = new Session();
    const input = session.audioInput('default-route-media');
    const audio = session.subscribe(input.output, { signal: SignalSpec.audio() });

    expect(audio.routeSettings.media.kind).toBe('audio-pcm');
  });

  it('lets the Core compiler reject an unregistered Operator before capture starts', async () => {
    const session = new Session();
    const audio = session.capture(Source.systemAudio());
    audio
      .through(new Operator('org.example.missing.v1'))
      .send(session.audio());

    await expect(session.start()).rejects.toMatchObject({
      code: 'session.compile_failed',
      diagnostic: {
        code: 'compile.unknown_async_operator',
        operatorId: 'org.example.missing.v1',
      },
    });
  });
});
