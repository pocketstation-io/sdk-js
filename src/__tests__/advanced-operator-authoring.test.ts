import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MediaCaps,
  OperatorDeadlines,
  OperatorEmission,
  OperatorManifest,
  OperatorProvider,
  PortSpec,
  Session,
  SignalSpec,
  defineSource,
  operator,
  secret,
  type AuthoredOperatorNode,
  type OperatorPrepareContext,
  type SignalEnvelope,
} from '../node/index.js';

describe('advanced Operator authoring', () => {
  it('runs a manifest-driven async Operator with compiled context and inferred output', async () => {
    const inputSignal = SignalSpec.text('utf8', { role: 'prompt' });
    const outputSignal = SignalSpec.text('utf8', { role: 'transcript.final' });
    const manifest = new OperatorManifest({
      operatorId: 'org.example.operator.manifest-uppercase.v1',
      inputs: [PortSpec.input('prompt', inputSignal)],
      outputs: [PortSpec.output('transcript', outputSignal)],
      revision: 3,
      implementationGeneration: 7,
      queueCapacitySignals: 4,
      processTimeoutMs: 1_000,
      networkAllowed: true,
      filesystemAllowed: false,
      drainQueued: true,
      continueOnFailure: false,
      terminalRoles: ['transcript.final'],
    });
    const lifecycle: string[] = [];
    let prepared: OperatorPrepareContext | undefined;
    let validatorConfiguration: Readonly<Record<string, string>> | undefined;

    class Uppercase implements AuthoredOperatorNode {
      public prepare(context: OperatorPrepareContext): void {
        lifecycle.push('prepare');
        prepared = context;
      }

      public process(inputPort: string, envelope: SignalEnvelope) {
        lifecycle.push(`process:${inputPort}`);
        const text = envelope.payload.kind === 'text' ? envelope.payload.text : '';
        return [OperatorEmission.text(text.toUpperCase(), {
          signal: outputSignal,
        })];
      }

      public close(): void {
        lifecycle.push('close');
      }
    }

    const provider = OperatorProvider.withNode(manifest, {
      validateConfig: (configuration) => { validatorConfiguration = configuration; },
      create: async (configuration) => {
        expect(configuration).toEqual({ locale: 'en', token: 'private' });
        return new Uppercase();
      },
    }, {
      deadlines: new OperatorDeadlines({
        createMs: 500,
        prepareMs: 500,
        processMs: 500,
        closeMs: 500,
      }),
    });
    const feed = defineSource({
      id: 'org.example.source.operator-manifest-input.v1',
      outputs: [PortSpec.output('prompt', inputSignal)],
      create: () => {
        let emitted = false;
        return {
          next: () => {
            if (emitted) return undefined;
            emitted = true;
            return { output: 'prompt', data: 'hello' };
          },
        };
      },
    });

    const session = new Session();
    const registered = session.registerOperator(provider);
    expect(registered.operatorId).toBe(manifest.operatorId);
    expect(registered.sessionId).toBe(session.id);
    const instance = registered.declare({ locale: 'en', token: secret('private') });
    session.source(feed).output('prompt').connect(instance.input('prompt'));
    const subscription = session.subscribe(instance.output('transcript'), { signal: outputSignal });

    const running = await session.start();
    const result = await running.signals(subscription).read({ timeoutMs: 1_000 });
    const stopped = await running.stop();

    expect(stopped.success).toBe(true);
    expect(validatorConfiguration).toEqual({ locale: 'en', token: 'private' });
    expect(result).toMatchObject({
      payload: { kind: 'text', text: 'HELLO' },
      derivation: {
        operatorId: manifest.operatorId,
        operatorRevision: 3,
        operatorGeneration: 7,
      },
    });
    expect(prepared?.executionPartition).toBe('async-worker');
    expect(prepared?.inputs).toHaveLength(1);
    expect(prepared?.outputs).toHaveLength(1);
    expect(prepared?.inputs[0]).toMatchObject({
      portName: 'prompt',
      direction: 'input',
      capacitySignals: 8,
    });
    expect(prepared?.inputs[0]?.edgeId).toBeDefined();
    expect(prepared?.inputs[0]?.signal.wireId).toBe(inputSignal.wireId);
    expect(prepared?.inputs[0]?.routeSettings.deliveryPolicy.queuePressure).toBe('drop-newest');
    expect(prepared?.inputs[0]?.routeSettings.deliveryPolicy.frameOwnership).toBe('copy');
    expect(prepared?.outputs[0]?.signal.wireId).toBe(outputSignal.wireId);
    expect(lifecycle).toEqual(['prepare', 'process:prompt', 'close']);
  });

  it('runs the async function helper on the Node event loop without a factory validator shim', async () => {
    const inputSignal = SignalSpec.text('utf8', { role: 'async.request' });
    const outputSignal = SignalSpec.text('utf8', { role: 'async.result' });
    const manifest = new OperatorManifest({
      operatorId: 'org.example.operator.async-helper.v1',
      inputs: [PortSpec.input('input', inputSignal)],
      outputs: [PortSpec.output('output', outputSignal)],
    });
    let validated: Readonly<Record<string, string>> | undefined;
    const uppercase = operator(manifest, {
      validateConfig: (configuration) => { validated = configuration; },
    })(async (inputPort, envelope) => {
      await Promise.resolve();
      expect(inputPort).toBe('input');
      if (envelope.payload.kind !== 'text') return [];
      return [OperatorEmission.text(envelope.payload.text.toUpperCase(), {
        signal: outputSignal,
      })];
    });
    const feed = defineSource({
      id: 'org.example.source.async-helper-input.v1',
      outputs: [PortSpec.output('events', inputSignal)],
      create: () => {
        let emitted = false;
        return { next: () => {
          if (emitted) return undefined;
          emitted = true;
          return { output: 'events', data: 'hello' };
        } };
      },
    });
    const session = new Session();
    const registered = session.registerOperator(uppercase);
    expect(session.registerOperator(uppercase)).toBe(registered);
    const instance = session.operator(uppercase, { locale: 'en' });
    session.source(feed).output('events').connect(instance.input('input'));
    const subscription = session.subscribe(instance.output('output'), { signal: outputSignal });

    const running = await session.start();
    const result = await running.signals(subscription).read({ timeoutMs: 1_000 });
    const stopped = await running.stop();

    expect(stopped.success).toBe(true);
    expect(validated).toEqual({ locale: 'en' });
    expect(result?.payload).toEqual({ kind: 'text', text: 'HELLO' });
  });

  it('rejects invalid policy, media, deadlines, and emission contracts before work starts', () => {
    const input = PortSpec.input('input', SignalSpec.text());
    const output = PortSpec.output('output', SignalSpec.text('utf8', { role: 'text.final' }));
    expect(() => new OperatorManifest({
      operatorId: 'org.example.operator.bad-terminal.v1',
      inputs: [input],
      outputs: [output],
      terminalRoles: ['missing.role'],
    })).toThrow('not a declared output role');
    expect(() => new OperatorManifest({
      operatorId: 'org.example.operator.mixed-media.v1',
      inputs: [input],
      outputs: [output, PortSpec.output('audio', SignalSpec.audio())],
    })).toThrow('share one compatible edge media contract');
    const manifest = new OperatorManifest({
      operatorId: 'org.example.operator.deadline.v1',
      inputs: [input],
      outputs: [output],
      processTimeoutMs: 10,
    });
    expect(() => OperatorProvider.withNode(
      manifest,
      () => ({ process: () => [] }),
      { deadlines: new OperatorDeadlines({ processMs: 11 }) },
    )).toThrow('cannot exceed the Core manifest deadline');
    expect(() => OperatorEmission.audio(new Float32Array(8), {
      signal: SignalSpec.text(),
    })).toThrow('does not match its SignalSpec');
  });

  it('accepts Core-valid capacities and timeouts above the former JavaScript limits', () => {
    const signal = SignalSpec.text();
    const manifest = new OperatorManifest({
      operatorId: 'org.example.operator.large-bounds.v1',
      inputs: [PortSpec.input('input', signal)],
      outputs: [PortSpec.output('output', signal)],
      queueCapacitySignals: 0x1_0000_0000,
      processTimeoutMs: 600_000,
    });

    expect(manifest.queueCapacitySignals).toBe(0x1_0000_0000);
    expect(manifest.processTimeoutMs).toBe(600_000);
    const provider = OperatorProvider.withNode(manifest, () => ({ process: () => [] }));
    expect(provider.deadlines.processMs).toBe(30_000);
    expect(() => new Session().registerOperator(provider)).not.toThrow();
    expect(() => new OperatorManifest({
      operatorId: 'org.example.operator.invalid-safe-integer.v1',
      inputs: [PortSpec.input('input', signal)],
      outputs: [PortSpec.output('output', signal)],
      queueCapacitySignals: Number.MAX_SAFE_INTEGER + 1,
    })).toThrow('positive safe integer');
  });

  it('aborts a rich Operator preparation deadline and performs exact cleanup', async () => {
    const signal = SignalSpec.text();
    const lifecycle: string[] = [];
    let preparationSignal: AbortSignal | undefined;
    const manifest = new OperatorManifest({
      operatorId: 'org.example.operator.rich-prepare-deadline.v1',
      inputs: [PortSpec.input('input', signal)],
      outputs: [PortSpec.output('output', signal)],
      processTimeoutMs: 100,
    });
    const provider = OperatorProvider.withNode(manifest, () => ({
      prepare: async (context) => {
        preparationSignal = context.signal;
        await waitForAbort(context.signal);
      },
      process: () => [],
      cancel: () => { lifecycle.push('cancel'); },
      close: () => { lifecycle.push('close'); },
    }), {
      deadlines: new OperatorDeadlines({
        createMs: 50,
        prepareMs: 10,
        processMs: 50,
        closeMs: 20,
      }),
    });
    const feed = defineSource({
      id: 'org.example.source.rich-prepare-deadline-input.v1',
      outputs: [PortSpec.output('text', signal)],
      create: () => ({ next: () => undefined }),
    });
    const session = new Session();
    const instance = session.registerOperator(provider).declare();
    session.source(feed).output('text').connect(instance.input('input'));
    session.subscribe(instance.output('output'), { signal });

    await expect(session.start()).rejects.toBeInstanceOf(Error);
    await waitFor(() => lifecycle.includes('close'));

    expect(preparationSignal?.aborted).toBe(true);
    expect(lifecycle).toEqual(['cancel', 'close']);
  });

  it('closes a rich Operator node that resolves after its creation deadline', async () => {
    const signal = SignalSpec.text();
    let closes = 0;
    const provider = OperatorProvider.withNode(new OperatorManifest({
      operatorId: 'org.example.operator.rich-create-deadline.v1',
      inputs: [PortSpec.input('input', signal)],
      outputs: [PortSpec.output('output', signal)],
      processTimeoutMs: 100,
    }), async () => {
      await delay(40);
      return {
        process: () => [],
        close: () => { closes += 1; },
      };
    }, {
      deadlines: new OperatorDeadlines({
        createMs: 10,
        prepareMs: 50,
        processMs: 50,
        closeMs: 50,
      }),
    });
    const feed = defineSource({
      id: 'org.example.source.rich-create-deadline-input.v1',
      outputs: [PortSpec.output('text', signal)],
      create: () => ({ next: () => undefined }),
    });
    const session = new Session();
    const instance = session.registerOperator(provider).declare();
    session.source(feed).output('text').connect(instance.input('input'));
    session.subscribe(instance.output('output'), { signal });

    await expect(session.start()).rejects.toBeInstanceOf(Error);
    await waitFor(() => closes === 1);

    expect(closes).toBe(1);
  });

  it('emits owned PCM through Core reentry and multistem recording', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pocketstation-js-operator-'));
    try {
      const signal = SignalSpec.audio({ role: 'audio.generated' });
      const media = MediaCaps.audio({
        sampleRateHz: 48_000,
        frameSamples: 480,
        channelLayout: 'mono',
      });
      const generated = new Float32Array(480);
      generated.set([0.25, -0.25, 0.5, -0.5]);
      let closed = false;
      const provider = OperatorProvider.withNode(new OperatorManifest({
        operatorId: 'org.example.operator.pcm.v1',
        inputs: [PortSpec.input('input', signal, { media })],
        outputs: [PortSpec.output('output', signal, { media })],
        queueCapacitySignals: 2,
      }), () => ({
        process: () => [OperatorEmission.audio(generated, { signal })],
        close: () => { closed = true; },
      }));
      const session = new Session({ recordingRoot: directory, frameDurationMs: 10 });
      const source = session.audioInput('operator-input', { frameSamplesPerChannel: 480 });
      const instance = session.registerOperator(provider).declare();
      source.output.connect(instance.input('input'));
      const output = instance.output('output').reenterAudio();
      output.send(session.audio());
      output.record('generated');

      const running = await session.start();
      await source.write(new Float32Array(480));
      const frame = await running.audio.read({ timeoutMs: 1_000 });
      const stopped = await running.stop();

      expect(frame).not.toBeNull();
      expect(frame && 'samples' in frame ? [...frame.samples.slice(0, 4)] : []).toEqual([
        0.25,
        -0.25,
        0.5,
        -0.5,
      ]);
      expect(frame && 'sampleRateHz' in frame ? frame.sampleRateHz : 0).toBe(48_000);
      expect(frame && 'channelCount' in frame ? frame.channelCount : 0).toBe(1);
      expect(frame && 'sourceId' in frame ? frame.sourceId : 0n).not.toBe(source.sourceId);
      expect(frame && 'stemId' in frame ? frame.stemId : 0n).toBe(output.id);
      expect(stopped.success).toBe(true);
      expect(stopped.recording?.state).toBe('complete');
      expect(stopped.recording?.stems.map((stem) => stem.stemName)).toEqual(['generated']);
      expect(closed).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('enforces exact PCM contracts, payload bounds, ownership, frame size, and pool capacity', async () => {
    const signal = SignalSpec.audio({ role: 'audio.generated' });
    const exactMedia = MediaCaps.audio({
      sampleRateHz: 48_000,
      frameSamples: 480,
      channelLayout: 'mono',
    });
    const node = () => ({ process: () => [] });
    const incomplete = OperatorProvider.withNode(new OperatorManifest({
      operatorId: 'org.example.operator.pcm-incomplete.v1',
      inputs: [PortSpec.input('input', signal)],
      outputs: [PortSpec.output('output', signal)],
    }), node);
    expect(() => new Session().registerOperator(incomplete)).toThrow('exact sample rate');

    const oversized = OperatorProvider.withNode(new OperatorManifest({
      operatorId: 'org.example.operator.pcm-oversized.v1',
      inputs: [PortSpec.input('input', signal, { media: exactMedia })],
      outputs: [PortSpec.output('output', signal, {
        media: MediaCaps.audio({
          sampleRateHz: 48_000,
          frameSamples: 262_145,
          channelLayout: 'mono',
        }),
      })],
    }), node);
    expect(() => new Session().registerOperator(oversized)).toThrow('payload bound');

    const original = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const owned = OperatorEmission.audio(original.subarray(1, 3), { signal });
    original[1] = 0.9;
    expect(owned.data).toEqual(new Float32Array([0.2, 0.3]));

    const failure = async (id: string, frames: readonly Float32Array[], capacity: number) => {
      const provider = OperatorProvider.withNode(new OperatorManifest({
        operatorId: id,
        inputs: [PortSpec.input('input', signal, { media: exactMedia })],
        outputs: [PortSpec.output('output', signal, { media: exactMedia })],
        queueCapacitySignals: capacity,
      }), () => ({
        process: () => frames.map((samples) => OperatorEmission.audio(samples, { signal })),
      }));
      const session = new Session({ frameDurationMs: 10 });
      const source = session.audioInput('operator-input', { frameSamplesPerChannel: 480 });
      const instance = session.registerOperator(provider).declare();
      source.output.connect(instance.input('input'));
      instance.output('output').reenterAudio().send(session.audio());
      const running = await session.start();
      await source.write(new Float32Array(480));
      await running.audio.read({ timeoutMs: 200 });
      return running.stop();
    };

    const wrongSize = await failure(
      'org.example.operator.pcm-wrong-size.v1',
      [new Float32Array(479)],
      2,
    );
    expect(wrongSize.success).toBe(false);
    expect(wrongSize.terminalEvent?.finalizationFailures[0]?.errorClass).toContain('expected 480');

    const saturated = await failure(
      'org.example.operator.pcm-saturated.v1',
      [new Float32Array(480), new Float32Array(480)],
      1,
    );
    expect(saturated.success).toBe(false);
    expect(saturated.terminalEvent?.finalizationFailures[0]?.errorClass).toContain('buffer pool is full');
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
    if (Date.now() >= deadline) throw new Error('timed out waiting for rich Operator cleanup');
    await delay(5);
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
