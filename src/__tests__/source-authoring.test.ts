import {
  EndOfStream,
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
  it('returns every accepted final signal before stable EOF after graceful stop', async () => {
    const accepted = ['final-1', 'final-2', 'final-3'];
    let started = false;
    const feed = defineSource({
      id: 'org.example.source.final-signal-eof.v1',
      outputs: [PortSpec.output('text', SignalSpec.text())],
      create: () => ({
        next: async (context) => {
          if (!started) {
            started = true;
            return { output: 'text', data: 'ready' };
          }
          await waitForAbort(context.signal);
          return undefined;
        },
        drain: () => {
          const data = accepted.shift();
          return data === undefined ? undefined : { output: 'text', data };
        },
      }),
    });
    const session = new Session();
    const source = session.source(feed);
    const subscription = session.subscribe(source.output('text'), {
      signal: SignalSpec.text(), route: RouteSettings.buffered(),
    });
    const running = await session.start();
    const stream = running.signals(subscription);
    try {
      expect(await stream.read({ timeoutMs: 1_000 })).toMatchObject({ payload: { text: 'ready' } });
      expect((await running.stop()).success).toBe(true);
      for (let index = 0; index < 3; index += 1) {
        expect(await stream.poll()).toMatchObject({
          payload: { kind: 'text', text: `final-${index + 1}` },
          lineage: { sourceId: source.sourceId, sequenceNumber: BigInt(index + 1) },
        });
      }
      expect(await stream.poll()).toBeInstanceOf(EndOfStream);
      expect(await stream.poll()).toBeInstanceOf(EndOfStream);
    } finally {
      stream.close();
      await running.close();
    }
  });

  it.each(['cancel', 'close', 'stop-cancel', 'stop-close'] as const)('discards queued signals on Session %s', async (operation) => {
    let index = 0;
    const feed = defineSource({
      id: `org.example.source.signal-${operation}.v1`,
      outputs: [PortSpec.output('text', SignalSpec.text())],
      create: () => ({
        next: () => index < 3
          ? { output: 'text', data: `queued-${++index}`, terminal: index === 3 }
          : undefined,
      }),
    });
    const session = new Session();
    const output = session.source(feed).output('text');
    const subscription = session.subscribe(output, {
      signal: SignalSpec.text(), route: RouteSettings.buffered(),
    });
    const unopened = session.subscribe(output, {
      signal: SignalSpec.text(), route: RouteSettings.buffered(),
    });
    const running = await session.start();
    const stream = running.signals(subscription);
    try {
      await waitFor(async () => (await stream.metrics()).depthSignals === 3n);
      if (operation.startsWith('stop-')) expect((await running.stop()).success).toBe(true);
      if (operation.endsWith('cancel')) await running.cancel();
      else await running.close();
      expect(await stream.poll()).toBeInstanceOf(EndOfStream);
      expect(await stream.poll()).toBeInstanceOf(EndOfStream);
      const lateReader = running.signals(unopened);
      expect(lateReader.isClosed).toBe(true);
      expect(await lateReader.poll()).toBeInstanceOf(EndOfStream);
    } finally {
      stream.close();
      await running.close();
    }
  });

  it('interrupts a pending next on graceful stop without turning it into failure', async () => {
    let notifyEntered: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => { notifyEntered = resolve; });
    let interrupted = false;
    let closes = 0;
    const feed = defineSource({
      id: 'org.example.source.graceful-next-interruption.v1',
      outputs: [PortSpec.output('text', SignalSpec.text())],
      deadlineMs: 200,
      create: () => ({
        next: async (context) => {
          notifyEntered();
          await waitForAbort(context.signal);
          interrupted = true;
          return undefined;
        },
        close: () => { closes += 1; },
      }),
    });
    const session = new Session();
    session.subscribe(session.source(feed).output('text'), { signal: SignalSpec.text() });
    const running = await session.start();
    try {
      await entered;
      const stopped = await running.stop();
      expect(stopped.success).toBe(true);
      expect(stopped.metrics?.externalSources[0]?.failureTotal).toBe(0n);
      expect(interrupted).toBe(true);
      expect(closes).toBe(1);
    } finally {
      await running.close();
    }
  });

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

  it('preserves legacy drivers that omit drain', async () => {
    let nextCalls = 0;
    let closes = 0;
    const feed = defineSource({
      id: 'org.example.source.no-drain.v1',
      outputs: [PortSpec.output('text', SignalSpec.text())],
      create: () => ({
        next: () => { nextCalls += 1; return undefined; },
        close: () => { closes += 1; },
      }),
    });
    const instanceId = 'no-drain';
    await feed._dispatch({ operation: 'source.create', instanceId });
    await expect(feed._dispatch({ operation: 'source.drain', instanceId })).resolves.toEqual({});
    await feed._dispatch({ operation: 'source.close', instanceId });
    expect(nextCalls).toBe(0);
    expect(closes).toBe(1);
  });

  it('recognizes an initial Core interruption without awaiting a second notification', async () => {
    const feed = defineSource({
      id: 'org.example.source.initial-interruption.v1',
      outputs: [PortSpec.output('text', SignalSpec.text())],
      create: () => ({ next: (context) => { throw context.signal.reason; } }),
    });
    const instanceId = 'initial-interruption';
    await feed._dispatch({ operation: 'source.create', instanceId });
    await expect(feed._dispatch({ operation: 'source.next', instanceId, cancelled: true }))
      .resolves.toEqual({});
    await feed._dispatch({ operation: 'source.close', instanceId });
  });

  it('does not relabel an existing provider error when Core interruption follows', async () => {
    const failure = new Error('independent provider error');
    const feed = defineSource({
      id: 'org.example.source.error-before-interruption.v1',
      outputs: [PortSpec.output('text', SignalSpec.text())],
      create: () => ({ next: (context) => { throw context.signal.reason ?? failure; } }),
    });
    const instanceId = 'error-before-interruption';
    await feed._dispatch({ operation: 'source.create', instanceId });
    await expect(feed._dispatch({ operation: 'source.next', instanceId })).rejects.toBe(failure);
    await feed._dispatch({ operation: 'source.interrupt', instanceId });
    await expect(feed._dispatch({ operation: 'source.next', instanceId, cancelled: true })).rejects.toBe(failure);
    await feed._dispatch({ operation: 'source.close', instanceId });
  });

  it('bounds a stalled drain and releases its signal before exact cleanup', async () => {
    let signal: AbortSignal | undefined;
    let closes = 0;
    const feed = defineSource({
      id: 'org.example.source.stalled-drain.v1',
      outputs: [PortSpec.output('text', SignalSpec.text())],
      deadlineMs: 20,
      create: () => ({
        prepare: (context) => { signal = context.signal; },
        next: () => undefined,
        drain: async () => { await waitForAbort(signal!); return undefined; },
        close: () => { closes += 1; },
      }),
    });
    const instanceId = 'stalled-drain';
    await feed._dispatch({ operation: 'source.create', instanceId });
    await feed._dispatch({ operation: 'source.prepare', instanceId, sourceContext: {
      sourceTypeId: feed.id, sessionId: '1', sourceId: '2',
      outputs: [{ name: 'text', streamId: '3' }],
    } });
    await expect(feed._dispatch({ operation: 'source.drain', instanceId }))
      .rejects.toThrow('Source drain exceeded 20 milliseconds');
    expect(signal?.aborted).toBe(true);
    await feed._dispatch({ operation: 'source.close', instanceId });
    await feed._dispatch({ operation: 'source.close', instanceId });
    expect(closes).toBe(1);
  });
});

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for Source cleanup');
    await delay(5);
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
