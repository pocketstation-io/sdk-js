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

  it('aborts a stalled Operator operation at the native deadline and cleans up once', async () => {
    const lifecycle: string[] = [];
    let processSignal: AbortSignal | undefined;
    const text = SignalSpec.text();
    const feed = defineSource({
      id: 'org.example.source.operator-deadline-input.v1',
      outputs: [PortSpec.output('text', text)],
      create: () => {
        let emitted = false;
        return { next: () => {
          if (emitted) return undefined;
          emitted = true;
          return { output: 'text', data: 'hello' };
        } };
      },
    });
    const stalled = defineOperator({
      id: 'org.example.operator.native-deadline.v1',
      inputs: [PortSpec.input('text', text)],
      outputs: [PortSpec.output('text', text)],
      deadlineMs: 20,
      create: () => ({
        process: async (_input, _inputPort, context) => {
          processSignal = context.signal;
          await waitForAbort(context.signal);
          return [];
        },
        cancel: () => { lifecycle.push('cancel'); },
        close: () => { lifecycle.push('close'); },
      }),
    });
    const session = new Session();
    const instance = session.operator(stalled);
    session.source(feed).output('text').connect(instance.input('text'));
    session.subscribe(instance.output('text'), { signal: text });

    const running = await session.start();
    await waitFor(() => processSignal?.aborted === true && lifecycle.includes('close'));
    const outcome = await running.stop();

    expect(outcome.success).toBe(false);
    expect(processSignal?.aborted).toBe(true);
    expect(lifecycle).toEqual(['cancel', 'close']);
  });

  it('closes an Operator node that resolves after the native creation deadline', async () => {
    let creates = 0;
    let closes = 0;
    let completeCreation!: (node: OperatorNode) => void;
    const creation = new Promise<OperatorNode>((resolve) => { completeCreation = resolve; });
    const text = SignalSpec.text();
    const delayed = defineOperator({
      id: 'org.example.operator.native-create-deadline.v1',
      inputs: [PortSpec.input('text', text)],
      outputs: [PortSpec.output('text', text)],
      // Allow admission/validation to finish, then hold creation until the
      // native deadline expires. A validation timeout never allocates a node.
      deadlineMs: 250,
      create: () => {
        creates += 1;
        return creation;
      },
    });
    const feed = defineSource({
      id: 'org.example.source.operator-create-deadline-input.v1',
      outputs: [PortSpec.output('text', text)],
      create: () => ({ next: () => undefined }),
    });
    const session = new Session();
    const instance = session.operator(delayed);
    session.source(feed).output('text').connect(instance.input('text'));
    session.subscribe(instance.output('text'), { signal: text });

    try {
      await expect(session.start()).rejects.toThrow('JavaScript provider promise exceeded its deadline');
      expect(creates).toBe(1);
      expect(closes).toBe(0);
    } finally {
      completeCreation({ process: () => [], close: () => { closes += 1; } });
    }
    await waitFor(() => closes === 1);

    expect(closes).toBe(1);
  });

  it('bounds an Operator close handler that ignores cancellation', async () => {
    const text = SignalSpec.text();
    let closes = 0;
    const operator = defineOperator({
      id: 'org.example.operator.stalled-close.v1',
      inputs: [PortSpec.input('text', text)],
      outputs: [PortSpec.output('text', text)],
      deadlineMs: 10,
      create: () => ({
        process: () => [],
        close: () => {
          closes += 1;
          return new Promise<void>(() => undefined);
        },
      }),
    });
    const instanceId = 'stalled-operator-close';
    await operator._dispatch({ operation: 'operator.create', instanceId });

    const startedAt = Date.now();
    await expect(operator._dispatch({ operation: 'operator.close', instanceId }))
      .rejects.toThrow('Operator close exceeded 10 milliseconds');

    expect(Date.now() - startedAt).toBeLessThan(500);
    await expect(operator._dispatch({ operation: 'operator.close', instanceId }))
      .resolves.toEqual({});
    expect(closes).toBe(1);
  });
});

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for Operator cleanup');
    await delay(5);
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
