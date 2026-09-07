import {
  MediaCaps,
  PortSpec,
  Session,
  SignalSpec,
  defineOperator,
  defineSource,
  secret,
  type OperatorNode,
} from '../node/index.js';

describe('Operator authoring', () => {
  it('processes a typed Source and returns text and generated PCM through Core', async () => {
    const lifecycle: string[] = [];
    const text = SignalSpec.text();
    const feed = defineSource({
      id: 'org.example.source.operator-input.v1',
      outputs: [PortSpec.output('text', text)],
      create: () => {
        let emitted = false;
        return {
          next: () => {
            if (emitted) return undefined;
            emitted = true;
            return { output: 'text', data: 'hello' };
          },
        };
      },
    });

    class UppercaseAndTone implements OperatorNode {
      public prepare(): void {
        lifecycle.push('prepare');
      }

      public process() {
        return [
          { output: 'text', data: 'HELLO' },
          { output: 'audio', data: new Float32Array(480).fill(0.125) },
        ];
      }

      public close(): void {
        lifecycle.push('close');
      }
    }

    const operator = defineOperator({
      id: 'org.example.operator.uppercase-and-tone.v1',
      inputs: [PortSpec.input('text', text)],
      outputs: [
        PortSpec.output('text', text),
        PortSpec.output('audio', SignalSpec.audio(), {
          media: MediaCaps.audio({
            sampleRateHz: 48_000,
            frameSamples: 480,
            channelLayout: 'mono',
          }),
        }),
      ],
      create: (configuration) => {
        expect(configuration).toEqual({ language: 'en', token: 'private' });
        return new UppercaseAndTone();
      },
    });
    const session = new Session({ frameDurationMs: 10 });
    const source = session.source(feed).output('text');
    const runningOperator = session.operator(operator, {
      language: 'en',
      token: secret('private'),
    });
    source.connect(runningOperator.input('text'));
    const textOutput = runningOperator.output('text');
    const subscription = session.subscribe(textOutput, { signal: text });
    runningOperator.output('audio').reenterAudio().send(session.audio());

    const running = await session.start();
    const transcript = await running.signals(subscription).read({ timeoutMs: 1_000 });
    const audio = await running.audio.read({ timeoutMs: 1_000 });
    const outcome = await running.stop();

    expect(outcome.success).toBe(true);
    expect(transcript).toMatchObject({
      payload: { kind: 'text', text: 'HELLO' },
      derivation: {
        operatorId: 'org.example.operator.uppercase-and-tone.v1',
        operatorRevision: 1,
      },
    });
    expect(audio?.samples[0]).toBeCloseTo(0.125);
    expect(audio?.sourceId).toBeGreaterThan(0n);
    expect(audio?.timestampStartNs).toBe(transcript?.timing.observedTimestampNs);
    expect(lifecycle).toEqual(['prepare', 'close']);
  });

  it('rejects an Operator without both sides of its typed interface', () => {
    expect(() =>
      defineOperator({
        id: 'org.example.operator.invalid.v1',
        inputs: [],
        outputs: [PortSpec.output('text', SignalSpec.text())],
        create: () => ({ process: () => [] }),
      }),
    ).toThrow('at least one input and one output');
  });
});
