import {
  EndpointFactory,
  PortSpec,
  Session,
  SignalSpec,
  defineEndpoint,
  defineSource,
  type EndpointItem,
  type EndpointNode,
} from '../node/index.js';

describe('Endpoint authoring', () => {
  it('receives multiple source-aware audio inputs through one lifecycle', async () => {
    const lifecycle: string[] = [];
    const received: EndpointItem[] = [];

    class MemoryEndpoint implements EndpointNode {
      public prepare(): void {
        lifecycle.push('prepare');
      }

      public start(): void {
        lifecycle.push('start');
      }

      public receive(item: EndpointItem): void {
        received.push(item);
      }

      public stop(mode: 'drain' | 'abort'): void {
        lifecycle.push(`stop:${mode}`);
      }

      public close(): void {
        lifecycle.push('close');
      }
    }

    const provider = new EndpointFactory({
      id: 'org.example.endpoint.memory.v1',
      inputs: [
        PortSpec.input('application', SignalSpec.audio()),
        PortSpec.input('microphone', SignalSpec.audio()),
      ],
      create: (configuration) => {
        expect(configuration).toEqual({ destination: 'memory' });
        return new MemoryEndpoint();
      },
    });
    const session = new Session({ frameDurationMs: 10 });
    const application = session.audioInput('application');
    const microphone = session.audioInput('microphone');
    const destination = session.endpoint(provider, { destination: 'memory' });
    application.output.send(destination, { input: 'application' });
    microphone.output.send(destination, { input: 'microphone' });
    application.tryWrite(new Float32Array(480).fill(0.375));
    microphone.tryWrite(new Float32Array(480).fill(-0.25));
    application.close();
    microphone.close();

    const running = await session.start();
    await waitFor(() => received.length === 2);
    const outcome = await running.stop();

    expect(outcome.success).toBe(true);
    expect(lifecycle).toEqual(['prepare', 'start', 'stop:drain', 'close']);
    expect(received.map((item) => item.input).sort()).toEqual(['application', 'microphone']);
    expect(
      received
        .map((item) => (item.kind === 'audio' ? item.frame.samples[0] : Number.NaN))
        .sort(),
    ).toEqual([-0.25, 0.375]);
    expect(received.every((item) => item.endpointId > 0n && item.routeId > 0n)).toBe(true);
  });

  it('supports the concise receive function and rejects cross-Session reuse', async () => {
    let received: EndpointItem | undefined;
    let aborted = false;
    const text = SignalSpec.text();
    const destination = defineEndpoint(
      {
        id: 'org.example.endpoint.function.v1',
        inputs: [PortSpec.input('text', text)],
      },
      (item, context) => {
        received = item;
        context.signal.addEventListener('abort', () => {
          aborted = true;
        });
      },
    );
    const first = new Session({ frameDurationMs: 10 });
    const second = new Session({ frameDurationMs: 10 });
    const source = defineSource({
      id: 'org.example.source.endpoint-text.v1',
      outputs: [PortSpec.output('text', text)],
      create: () => {
        let emitted = false;
        return {
          next: () => {
            if (emitted) return undefined;
            emitted = true;
            return { output: 'text', data: 'ready', terminal: true };
          },
        };
      },
    });
    first.source(source).output('text').send(first.endpoint(destination), { input: 'text' });
    expect(() => second.endpoint(destination)).toThrow(
      'An Endpoint factory cannot be shared by different Sessions',
    );
    const running = await first.start();
    await waitFor(() => received !== undefined);
    const result = await running.cancel();

    expect(result.disposition).toBe('cancelled');
    expect(aborted).toBe(true);
    expect(received?.kind === 'signal' ? received.signal.payload : undefined).toEqual({
      kind: 'text',
      text: 'ready',
    });
  });

  it('ignores incidental values returned by void receive callbacks', async () => {
    const received: EndpointItem[] = [];
    const text = SignalSpec.text();
    const destination = defineEndpoint(
      {
        id: 'org.example.endpoint.incidental-return.v1',
        inputs: [PortSpec.input('text', text)],
      },
      (item) => received.push(item),
    );
    const source = defineSource({
      id: 'org.example.source.endpoint-incidental-return.v1',
      outputs: [PortSpec.output('text', text)],
      create: () => {
        let emitted = false;
        return {
          next: () => {
            if (emitted) return undefined;
            emitted = true;
            return { output: 'text', data: 'ready', terminal: true };
          },
        };
      },
    });
    const session = new Session({ frameDurationMs: 10 });
    session.source(source).output('text').send(session.endpoint(destination), { input: 'text' });

    const running = await session.start();
    await waitFor(() => received.length === 1);
    const outcome = await running.stop();

    expect(outcome.success).toBe(true);
    expect(outcome.endpointFinalizationFailuresTotal).toBe(0n);
  });

  it('closes an Endpoint whose preparation fails', async () => {
    const lifecycle: string[] = [];
    const endpoint = defineEndpoint({
      id: 'org.example.endpoint.rollback.v1',
      inputs: [PortSpec.input('audio', SignalSpec.audio())],
      create: () => ({
        prepare: () => {
          lifecycle.push('prepare');
          throw new Error('socket unavailable');
        },
        receive: () => {},
        stop: (mode) => {
          lifecycle.push(`stop:${mode}`);
        },
        close: () => {
          lifecycle.push('close');
        },
      }),
    });
    const session = new Session({ frameDurationMs: 10 });
    const audio = session.audioInput('rollback audio');
    audio.output.send(session.endpoint(endpoint), { input: 'audio' });

    await expect(session.start()).rejects.toMatchObject({
      code: 'session.endpoint_prepare_failed',
    });

    expect(lifecycle).toEqual(['prepare', 'stop:abort', 'close']);
  });

  it('aborts a stalled Endpoint operation at the native deadline and finalizes once', async () => {
    let signal: AbortSignal | undefined;
    const lifecycle: string[] = [];
    const endpoint = defineEndpoint({
      id: 'org.example.endpoint.native-deadline.v1',
      inputs: [PortSpec.input('audio', SignalSpec.audio())],
      deadlineMs: 20,
      create: () => ({
        prepare: async (context) => {
          signal = context.signal;
          await waitForAbort(context.signal);
        },
        receive: () => {},
        stop: (mode) => { lifecycle.push(`stop:${mode}`); },
        close: () => { lifecycle.push('close'); },
      }),
    });
    const session = new Session({ frameDurationMs: 10 });
    const audio = session.audioInput('deadline audio');
    audio.output.send(session.endpoint(endpoint), { input: 'audio' });

    await expect(session.start()).rejects.toBeInstanceOf(Error);
    await waitFor(() => lifecycle.includes('close'));

    expect(signal?.aborted).toBe(true);
    expect(lifecycle).toEqual(['stop:abort', 'close']);
  });

  it('preserves drain until its deadline, then performs one abort cleanup', async () => {
    const lifecycle: string[] = [];
    const endpoint = defineEndpoint({
      id: 'org.example.endpoint.native-drain-deadline.v1',
      inputs: [PortSpec.input('audio', SignalSpec.audio())],
      deadlineMs: 20,
      create: () => ({
        receive: () => {},
        stop: async (mode, context) => {
          lifecycle.push(`stop:${mode}`);
          if (mode === 'drain') await waitForAbort(context.signal);
        },
        close: () => { lifecycle.push('close'); },
      }),
    });
    const session = new Session({ frameDurationMs: 10 });
    const audio = session.audioInput('drain deadline audio');
    audio.output.send(session.endpoint(endpoint), { input: 'audio' });
    audio.close();

    const running = await session.start();
    const outcome = await running.stop();
    await waitFor(() => lifecycle.includes('close'));

    expect(outcome.success).toBe(false);
    expect(lifecycle).toEqual(['stop:drain', 'stop:abort', 'close']);
  });

  it('bounds non-cooperative Endpoint work and close during deadline cleanup', async () => {
    let preparationSignal: AbortSignal | undefined;
    let closes = 0;
    const endpoint = defineEndpoint({
      id: 'org.example.endpoint.noncooperative-deadline.v1',
      inputs: [PortSpec.input('audio', SignalSpec.audio())],
      deadlineMs: 10,
      create: () => ({
        prepare: (context) => {
          preparationSignal = context.signal;
          return new Promise<void>(() => undefined);
        },
        receive: () => {},
        close: () => {
          closes += 1;
          return new Promise<void>(() => undefined);
        },
      }),
    });
    const instanceId = 'noncooperative-endpoint';
    await endpoint._dispatch({ operation: 'endpoint.create', instanceId });
    const preparation = endpoint._dispatch({ operation: 'endpoint.prepare', instanceId });
    void preparation.catch(() => undefined);

    await endpoint._dispatch({
      operation: 'provider.deadline_exceeded',
      instanceId,
      timedOutOperation: 'endpoint.prepare',
    });
    const startedAt = Date.now();
    await expect(endpoint._dispatch({ operation: 'endpoint.close', instanceId }))
      .rejects.toThrow('Endpoint in-flight shutdown exceeded 10 milliseconds');

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(preparationSignal?.aborted).toBe(true);
    expect(closes).toBe(1);
    await expect(endpoint._dispatch({ operation: 'endpoint.close', instanceId }))
      .resolves.toEqual({});
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
    if (Date.now() >= deadline) throw new Error('timed out waiting for Endpoint delivery');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
