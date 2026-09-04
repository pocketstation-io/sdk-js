import {
  Codec,
  DeliveryPolicy,
  EndpointDefinition,
  MediaCaps,
  Operator,
  PocketStationError,
  PortSpec,
  RouteSettings,
  Session,
  SignalSpec,
  Source,
  secret,
} from '../node/index.js';

describe('native graph declarations', () => {
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

    expect(() => SignalSpec.custom('')).toThrow(PocketStationError);
    expect(() => SignalSpec.text('json', { role: '' })).toThrow(
      'role cannot be empty',
    );
  });

  it('uses Core for media negotiation and named-port validation', () => {
    const anyAudio = MediaCaps.audio();
    const exactAudio = MediaCaps.audio({
      sampleRateHz: 48_000,
      frameSamples: 480,
      channelLayout: 'mono',
    });
    const stereo = MediaCaps.audio({
      sampleRateHz: 48_000,
      frameSamples: 480,
      channelLayout: 'stereo',
    });

    expect(anyAudio.negotiate(exactAudio)?.sampleRateHz).toBe(48_000);
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
    const delivery = DeliveryPolicy.buffered()
      .withQueuePressure('drop-oldest')
      .withFrameOwnership('copy')
      .withJitterBudgetMs(25)
      .withMaxPayloadBytes(4096);
    const route = RouteSettings.create(MediaCaps.text(), delivery);

    expect(route.media.kind).toBe('text');
    expect(route.delivery.queuePressure).toBe('drop-oldest');
    expect(route.delivery.frameOwnership).toBe('copy');
    expect(route.delivery.jitterBudgetMs).toBe(25);
    expect(route.delivery.maxPayloadBytes).toBe(4096);
    expect(() => delivery.withMaxPayloadBytes(0)).toThrow(PocketStationError);
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
      new EndpointDefinition(
        'org.example.transcript-endpoint.v1',
        'org.example.transcript-writer.v1',
        { route: RouteSettings.buffered() },
      ),
    );

    const input = transcriber.input('audio');
    const firstRoute = application.connect(input);
    const transcript = transcriber.output('transcript');
    const secondRoute = transcript.send(destination, { input: 'events' });
    const generated = transcript.reenterAudio();
    generated.send(session.audio());
    application.record('application');

    expect(input.name).toBe('audio');
    expect(transcript.outputName).toBe('transcript');
    expect(firstRoute).toBeGreaterThan(0n);
    expect(secondRoute).toBeGreaterThan(firstRoute);
    expect(generated.id).toBeGreaterThan(application.id);
  });

  it('rejects resources from different Sessions', () => {
    const first = new Session();
    const second = new Session();
    const stem = first.capture(Source.systemAudio());
    const operator = second.operator(new Operator('org.example.operator.v1'));

    expect(() => stem.connect(operator.input('audio'))).toThrow(
      'resources belong to different Sessions',
    );
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
