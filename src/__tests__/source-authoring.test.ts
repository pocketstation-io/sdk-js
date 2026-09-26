import {
  PortSpec,
  RouteSettings,
  Session,
  SignalSpec,
  SourceFactory,
  defineSource,
  type SourceDriver,
  type SourceDriverPrepareContext,
} from '../node/index.js';

describe('Source authoring', () => {
  it('runs a class through Core with source identity, timing, and exact cleanup', async () => {
    const lifecycle: string[] = [];
    let prepared: SourceDriverPrepareContext | undefined;

    class TranscriptFeed implements SourceDriver {
      #index = 0;

      public prepare(context: SourceDriverPrepareContext): void {
        prepared = context;
        lifecycle.push('prepare');
      }

      public next() {
        const messages = ['hello', 'world'];
        const text = messages[this.#index++];
        return text === undefined
          ? undefined
          : {
              output: 'transcript',
              data: text,
              sourceTimestampNs: BigInt(this.#index * 10_000_000),
              durationNs: 10_000_000n,
              terminal: this.#index === messages.length,
            };
      }

      public close(): void {
        lifecycle.push('close');
      }
    }

    const transcript = SignalSpec.text('utf8', { role: 'transcript.final' });
    const feed = defineSource({
      id: 'org.example.source.transcript.v1',
      outputs: [PortSpec.output('transcript', transcript)],
      create: (configuration) => {
        expect(configuration).toEqual({ language: 'en' });
        return new TranscriptFeed();
      },
      validate: (configuration) => {
        if (configuration.language !== 'en') throw new Error('unsupported language');
      },
    });
    const session = new Session();
    const output = session.source(feed, { language: 'en' }).output('transcript');
    const subscription = session.subscribe(output, {
      signal: transcript,
      route: RouteSettings.buffered(),
    });

    const running = await session.start();
    const stream = running.signals(subscription);
    const first = await stream.read({ timeoutMs: 1_000 });
    const second = await stream.read({ timeoutMs: 1_000 });
    const outcome = await running.stop();

    expect(outcome.success).toBe(true);
    expect(first).toMatchObject({
      payload: { kind: 'text', text: 'hello' },
      lineage: { sequenceNumber: 0n },
      timing: { sourceTimestampNs: 10_000_000n, durationNs: 10_000_000n },
    });
    expect(second).toMatchObject({
      payload: { kind: 'text', text: 'world' },
      lineage: { sequenceNumber: 1n },
    });
    expect(first?.lineage?.sourceId).toBe(prepared?.sourceId);
    expect(first?.lineage?.streamId).toBe(prepared?.outputs[0]?.streamId);
    expect(lifecycle).toEqual(['prepare', 'close']);
  });

  it('rejects configuration before the Source is prepared', async () => {
    let created = false;
    const feed = defineSource({
      id: 'org.example.source.validation.v1',
      outputs: [PortSpec.output('events', SignalSpec.text())],
      validate: () => {
        throw new Error('missing project');
      },
      create: () => {
        created = true;
        return { next: () => undefined };
      },
    });
    const session = new Session();
    const signal = SignalSpec.text();
    session.subscribe(session.source(feed).output('events'), { signal });

    await expect(session.start()).rejects.toMatchObject({
      code: 'session.compile_failed',
    });
    expect(created).toBe(false);
  });

  it('validates Source definitions at declaration time', () => {
    expect(
      () =>
        new SourceFactory({
          id: 'org.example.source.empty.v1',
          outputs: [],
          create: () => ({ next: () => undefined }),
        }),
    ).toThrow('at least one output');
    expect(
      () =>
        defineSource({
          id: 'org.example.source.audio.v1',
          outputs: [PortSpec.output('audio', SignalSpec.audio())],
          create: () => ({ next: () => undefined }),
        }),
    ).toThrow('Session.audioInput()');
  });

  it('closes a Source whose preparation fails', async () => {
    const lifecycle: string[] = [];
    const feed = defineSource({
      id: 'org.example.source.prepare-failure.v1',
      outputs: [PortSpec.output('text', SignalSpec.text())],
      create: () => ({
        prepare: () => {
          lifecycle.push('prepare');
          throw new Error('provider unavailable');
        },
        next: () => undefined,
        close: () => {
          lifecycle.push('close');
        },
      }),
    });
    const session = new Session();
    session.subscribe(session.source(feed).output('text'), {
      signal: SignalSpec.text(),
    });

    await expect(session.start()).rejects.toMatchObject({
      code: 'session.runtime_prepare_failed',
    });
    expect(lifecycle).toEqual(['prepare', 'close']);
  });

  it('aborts a stalled Source operation at the native deadline and closes exactly once', async () => {
    let signal: AbortSignal | undefined;
    let closes = 0;
    const feed = defineSource({
      id: 'org.example.source.native-deadline.v1',
      outputs: [PortSpec.output('text', SignalSpec.text())],
      deadlineMs: 20,
      create: () => ({
        next: async (context) => {
          signal = context.signal;
          await waitForAbort(context.signal);
          return undefined;
        },
        close: () => { closes += 1; },
      }),
    });
    const session = new Session();
    session.subscribe(session.source(feed).output('text'), { signal: SignalSpec.text() });

    const running = await session.start();
    await waitFor(() => signal?.aborted === true && closes === 1);
    const outcome = await running.stop();

    expect(outcome.success).toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(closes).toBe(1);
  });

  it('closes a Source driver that resolves after the native creation deadline', async () => {
    let closes = 0;
    const feed = defineSource({
      id: 'org.example.source.native-create-deadline.v1',
      outputs: [PortSpec.output('text', SignalSpec.text())],
      deadlineMs: 10,
      create: async () => {
        await delay(40);
        return {
          next: () => undefined,
          close: () => { closes += 1; },
        };
      },
    });
    const session = new Session();
    session.subscribe(session.source(feed).output('text'), { signal: SignalSpec.text() });

    await expect(session.start()).rejects.toBeInstanceOf(Error);
    await waitFor(() => closes === 1);

    expect(closes).toBe(1);
  });

  it('bounds a Source close handler that ignores cancellation', async () => {
    let closes = 0;
    const feed = defineSource({
      id: 'org.example.source.stalled-close.v1',
      outputs: [PortSpec.output('text', SignalSpec.text())],
      deadlineMs: 10,
      create: () => ({
        next: () => undefined,
        close: () => {
          closes += 1;
          return new Promise<void>(() => undefined);
        },
      }),
    });
    const instanceId = 'stalled-source-close';
    await feed._dispatch({ operation: 'source.create', instanceId });

    const startedAt = Date.now();
    await expect(feed._dispatch({ operation: 'source.close', instanceId }))
      .rejects.toThrow('Source close exceeded 10 milliseconds');

    expect(Date.now() - startedAt).toBeLessThan(500);
    await expect(feed._dispatch({ operation: 'source.close', instanceId }))
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
    if (Date.now() >= deadline) throw new Error('timed out waiting for Source cleanup');
    await delay(5);
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
