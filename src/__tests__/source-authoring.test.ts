import {
  PortSpec,
  RouteSettings,
  Session,
  SignalSpec,
  SourceFactory,
  defineSource,
  type SourceDriver,
  type SourcePrepareContext,
} from '../node/index.js';

describe('Source authoring', () => {
  it('runs a class through Core with source identity, timing, and exact cleanup', async () => {
    const lifecycle: string[] = [];
    let prepared: SourcePrepareContext | undefined;

    class TranscriptFeed implements SourceDriver {
      #index = 0;

      public prepare(context: SourcePrepareContext): void {
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
});
