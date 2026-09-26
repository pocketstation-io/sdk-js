import {
  MediaCaps,
  PortSpec,
  Session,
  SignalSpec,
  SourceCancellation,
  SourceDeadlines,
  SourceEmission,
  SourceManifest,
  SourceProvider,
  source,
  type AuthoredSourceDriver,
  type SourcePrepareContext,
} from '../node/index.js';

describe('advanced Source authoring', () => {
  it('runs the async iterable helper through Core with exact timing and lineage', async () => {
    const signal = SignalSpec.text('utf8', { role: 'transcript' });
    const manifest = new SourceManifest({
      sourceTypeId: 'org.example.source.async-iterable.v1',
      outputs: [PortSpec.output('events', signal, { multiplicity: 'many' })],
      revision: 3,
      implementationGeneration: 7,
    });
    let validated: Readonly<Record<string, string>> | undefined;
    const events = source(manifest, {
      validateConfig: (configuration) => { validated = configuration; },
    })(async function* (configuration) {
      await Promise.resolve();
      yield SourceEmission.text('events', configuration.text ?? '', {
        signal,
        sourceTimestampNs: 10n,
        observedTimestampNs: 12n,
        durationNs: 5n,
        discontinuityEpoch: 2n,
        terminal: true,
      });
    });

    const session = new Session();
    const registered = session.registerSource(events);
    expect(session.registerSource(events)).toBe(registered);
    expect(registered.sourceTypeId).toBe(manifest.sourceTypeId);
    expect(registered.sessionId).toBe(session.id);
    const instance = registered.declare({ text: 'hello' });
    const output = instance.output('events');
    const subscription = session.subscribe(output, { signal });

    const running = await session.start();
    const value = await running.signals(subscription).read({ timeoutMs: 1_000 });
    const stopped = await running.stop();

    expect(stopped.success).toBe(true);
    expect(validated).toEqual({ text: 'hello' });
    expect(value).toMatchObject({
      payload: { kind: 'text', text: 'hello' },
      lineage: {
        sessionId: session.id,
        sourceId: instance.sourceId,
        streamId: output.streamId,
        sequenceNumber: 0n,
        discontinuityEpoch: 2n,
      },
      timing: {
        sourceTimestampNs: 10n,
        observedTimestampNs: 12n,
        durationNs: 5n,
      },
    });
  });

  it('runs an async driver with Core identities, cancellation state, and exact close', async () => {
    const signal = SignalSpec.text('utf8', { role: 'status' });
    const manifest = new SourceManifest({
      sourceTypeId: 'org.example.source.driver.v1',
      outputs: [PortSpec.output('events', signal)],
    });
    let prepared: SourcePrepareContext | undefined;
    let closed = 0;
    let sent = false;

    class Driver implements AuthoredSourceDriver {
      public async prepare(context: SourcePrepareContext): Promise<void> {
        await Promise.resolve();
        prepared = context;
      }

      public async next(cancellation: SourceCancellation) {
        await Promise.resolve();
        expect(cancellation.cancelled).toBe(false);
        if (sent) return undefined;
        sent = true;
        return SourceEmission.text('events', 'ready', { signal });
      }

      public async close(): Promise<void> {
        await Promise.resolve();
        closed += 1;
      }
    }

    const provider = SourceProvider.withDriver(
      manifest,
      async () => new Driver(),
      { deadlines: new SourceDeadlines({ createMs: 500, prepareMs: 500, nextMs: 500, closeMs: 500 }) },
    );
    const session = new Session();
    const instance = session.source(provider);
    const output = instance.output('events');
    const subscription = session.subscribe(output, { signal });

    const running = await session.start();
    const value = await running.signals(subscription).read({ timeoutMs: 1_000 });
    const stopped = await running.stop();

    expect(stopped.success).toBe(true);
    expect(value?.payload).toEqual({ kind: 'text', text: 'ready' });
    expect(prepared).toBeInstanceOf(Object);
    expect(prepared?.sourceTypeId).toBe(manifest.sourceTypeId);
    expect(prepared?.sessionId).toBe(session.id);
    expect(prepared?.sourceId).toBe(instance.sourceId);
    expect(prepared?.outputs[0]).toMatchObject({
      outputPort: 'events',
      name: 'events',
      streamId: output.streamId,
    });
    expect(closed).toBe(1);
  });

  it('validates manifests, deadlines, payload contracts, and byte ownership immediately', () => {
    const text = SignalSpec.text();
    const binary = SignalSpec.binary();
    expect(() => new SourceManifest({
      sourceTypeId: 'invalid',
      outputs: [PortSpec.output('events', text)],
    })).toThrow('bounded reverse-domain syntax');
    expect(() => new SourceManifest({
      sourceTypeId: 'org.example.source.audio.v1',
      outputs: [PortSpec.output('audio', SignalSpec.audio(), { media: MediaCaps.audio() })],
    })).toThrow('Session.audioInput()');
    expect(() => new SourceDeadlines({ nextMs: 0 })).toThrow('1 through 300000');
    expect(() => SourceEmission.text('events', 'bad', { signal: binary })).toThrow(
      'does not match its SignalSpec',
    );
    expect(() => SourceEmission.bytes('events', new Uint8Array([1]), { signal: text })).toThrow(
      'does not match its SignalSpec',
    );
    expect(() => SourceEmission.text('events', 'bad', {
      signal: text,
      sourceGeneration: 0,
    })).toThrow('sourceGeneration must be a positive integer');

    const original = new Uint8Array([1, 2, 3, 4]);
    const owned = SourceEmission.bytes('events', original.subarray(1, 3), { signal: binary });
    original[1] = 9;
    expect(owned.data).toEqual(new Uint8Array([2, 3]));
  });

  it('rejects a typed emission sent to an incompatible declared output', async () => {
    const text = SignalSpec.text();
    const provider = SourceProvider.fromAsyncIterable(
      new SourceManifest({
        sourceTypeId: 'org.example.source.incompatible-emission.v1',
        outputs: [PortSpec.output('events', text)],
      }),
      async function* () {
        yield SourceEmission.bytes('events', new Uint8Array([1]), {
          signal: SignalSpec.binary(),
        });
      },
    );
    const session = new Session();
    const instance = session.source(provider);
    session.subscribe(instance.output('events'), { signal: text });

    const running = await session.start();
    const stopped = await running.stop();

    expect(stopped.success).toBe(false);
    expect(stopped.runtimeFailuresTotal).toBe(1n);
    expect(stopped.metrics?.externalSources[0]?.failureTotal).toBe(1n);
    expect(stopped.metrics?.externalSources[0]?.emittedTotal).toBe(0n);
  });

  it('bounds a stalled next call, propagates cancellation, and closes exactly once', async () => {
    const signal = SignalSpec.text();
    let cancellation: SourceCancellation | undefined;
    let closed = 0;
    const provider = SourceProvider.withDriver(
      new SourceManifest({
        sourceTypeId: 'org.example.source.next-timeout.v1',
        outputs: [PortSpec.output('events', signal)],
      }),
      async () => ({
        next: async (value) => {
          cancellation = value;
          await new Promise<void>((resolve) => {
            value.signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return undefined;
        },
        close: async () => { closed += 1; },
      }),
      {
        deadlines: new SourceDeadlines({
          createMs: 500,
          prepareMs: 500,
          nextMs: 20,
          closeMs: 500,
        }),
      },
    );
    const session = new Session();
    const instance = session.source(provider);
    session.subscribe(instance.output('events'), { signal });

    const running = await session.start();
    const deadline = Date.now() + 1_000;
    while ((await running.metrics()).externalSources[0]?.failureTotal !== 1n) {
      if (Date.now() >= deadline) throw new Error('Source next deadline did not fail');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const stopped = await running.stop();

    expect(stopped.success).toBe(false);
    expect(cancellation?.cancelled).toBe(true);
    expect(closed).toBe(1);
  });

  it('closes a driver that resolves after the creation deadline exactly once', async () => {
    const signal = SignalSpec.text();
    let closed = 0;
    const provider = SourceProvider.withDriver(
      new SourceManifest({
        sourceTypeId: 'org.example.source.late-creation.v1',
        outputs: [PortSpec.output('events', signal)],
      }),
      async () => {
        await delay(30);
        return {
          next: () => undefined,
          close: () => { closed += 1; },
        };
      },
      {
        deadlines: new SourceDeadlines({
          createMs: 10,
          prepareMs: 100,
          nextMs: 100,
          closeMs: 100,
        }),
      },
    );
    const dispatch = provider._factory()._dispatch;

    await expect(dispatch({
      operation: 'source.create',
      instanceId: 'late-creation',
    })).rejects.toThrow('creation exceeded 10 milliseconds');
    await waitFor(() => closed === 1);
    await dispatch({ operation: 'source.close', instanceId: 'late-creation' });

    expect(closed).toBe(1);
  });

  it('closes an invalid factory result before rejecting it', async () => {
    const signal = SignalSpec.text();
    let closed = 0;
    const provider = SourceProvider.withDriver(
      new SourceManifest({
        sourceTypeId: 'org.example.source.invalid-driver.v1',
        outputs: [PortSpec.output('events', signal)],
      }),
      () => ({ close: () => { closed += 1; } }) as unknown as AuthoredSourceDriver,
    );

    await expect(provider._factory()._dispatch({
      operation: 'source.create',
      instanceId: 'invalid-driver',
    })).rejects.toThrow('Source factory must return a driver with next()');

    expect(closed).toBe(1);
  });

  it('aborts the prepared Source signal when its preparation deadline expires', async () => {
    const signal = SignalSpec.text();
    let preparedSignal: AbortSignal | undefined;
    let closed = 0;
    const provider = SourceProvider.withDriver(
      new SourceManifest({
        sourceTypeId: 'org.example.source.prepare-timeout.v1',
        outputs: [PortSpec.output('events', signal)],
      }),
      () => ({
        prepare: async (context) => {
          preparedSignal = context.signal;
          await waitForAbort(context.signal);
        },
        next: () => undefined,
        close: () => { closed += 1; },
      }),
      {
        deadlines: new SourceDeadlines({
          createMs: 100,
          prepareMs: 10,
          nextMs: 100,
          closeMs: 100,
        }),
      },
    );
    const dispatch = provider._factory()._dispatch;
    const instanceId = 'prepare-timeout';
    await dispatch({ operation: 'source.create', instanceId });

    await expect(dispatch({
      operation: 'source.prepare',
      instanceId,
      sourceContext: {
        sourceTypeId: provider.manifest.sourceTypeId,
        sessionId: '1',
        sourceId: '2',
        outputs: [{ name: 'events', streamId: '3' }],
      },
    })).rejects.toThrow('prepare exceeded 10 milliseconds');
    await dispatch({ operation: 'source.close', instanceId });

    expect(preparedSignal?.aborted).toBe(true);
    expect(closed).toBe(1);
  });
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for Source state');
    await delay(5);
  }
}
