import {
  MediaCaps,
  PortSpec,
  RouteSettings,
  Session,
  SignalSpec,
  SourceCancellation,
  SourceDeadlines,
  SourceEmission,
  SourceManifest,
  SourceProvider,
  defineEndpoint,
  defineSource,
  source,
  type AuthoredSourceDriver,
  type EndpointItem,
  type SourcePrepareContext,
} from '../node/index.js';

describe('advanced Source authoring', () => {
  it.each(['concise', 'authored'] as const)(
    'waits for actual %s next cleanup and preserves its accepted result after interruption',
    async (surface) => {
      const entered = deferred<void>();
      const cleanupStarted = deferred<void>();
      const cleanup = deferred<void>();
      const signal = SignalSpec.text();
      let nextSettled = false;
      let closed = 0;
      let cleanupDone = false;
      const driver: AuthoredSourceDriver = {
        next: async (cancellation) => {
          entered.resolve();
          try {
            await waitForAbort(cancellation.signal);
            return SourceEmission.text('events', 'already accepted', { signal });
          } finally {
            cleanupStarted.resolve();
            await cleanup.promise;
            cleanupDone = true;
          }
        },
        drain: () => { expect(cleanupDone).toBe(true); return undefined; },
        close: () => { expect(cleanupDone).toBe(true); closed += 1; },
      };
      const dispatch = sourceDispatch(surface, driver, signal);
      const instanceId = 'interruption-order';
      await dispatch({ operation: 'source.create', instanceId });
      const next = dispatch({ operation: 'source.next', instanceId }).finally(() => { nextSettled = true; });
      try {
        await entered.promise;
        await dispatch({ operation: 'source.interrupt', instanceId });
        await cleanupStarted.promise;
        expect(nextSettled).toBe(false);
        cleanup.resolve();
        await expect(next).resolves.toMatchObject({ emission: { text: 'already accepted' } });
        await expect(dispatch({ operation: 'source.drain', instanceId })).resolves.toEqual({});
      } finally {
        cleanup.resolve();
        await next;
        await dispatch({ operation: 'source.close', instanceId });
      }
      expect(closed).toBe(1);
    },
  );

  it.each([
    ['concise', 'requested'], ['authored', 'requested'],
    ['concise', 'independent'], ['authored', 'independent'],
  ] as const)('keeps %s %s next cancellation distinct', async (surface, reason) => {
    const entered = deferred<void>();
    const signal = SignalSpec.text();
    const independent = new Error('provider cleanup failed independently');
    let closed = 0;
    const dispatch = sourceDispatch(surface, {
      next: async (cancellation) => {
        entered.resolve();
        await waitForAbort(cancellation.signal);
        throw reason === 'requested' ? cancellation.signal.reason : independent;
      },
      close: () => { closed += 1; },
    }, signal);
    const instanceId = 'interruption-error';
    await dispatch({ operation: 'source.create', instanceId });
    const next = dispatch({ operation: 'source.next', instanceId });
    await entered.promise;
    await dispatch({ operation: 'source.interrupt', instanceId });
    if (reason === 'requested') await expect(next).resolves.toEqual({});
    else await expect(next).rejects.toBe(independent);
    await dispatch({ operation: 'source.close', instanceId });
    expect(closed).toBe(1);
  });

  it('keeps timed-out authored input cleanup ahead of drain and close', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let finished = false;
    let closes = 0;
    const signal = SignalSpec.text();
    const provider = SourceProvider.withDriver(new SourceManifest({
      sourceTypeId: 'org.example.source.pending-timeout.v1',
      outputs: [PortSpec.output('events', signal)],
    }), () => ({
      next: async () => {
        entered.resolve();
        await release.promise;
        finished = true;
        return undefined;
      },
      drain: () => { throw new Error('drain must not overlap next'); },
      close: () => { expect(finished).toBe(true); closes += 1; },
    }), { deadlines: new SourceDeadlines({ nextMs: 10, closeMs: 20 }) });
    const dispatch = provider._factory()._dispatch;
    const instanceId = 'pending-timeout';
    await dispatch({ operation: 'source.create', instanceId });
    const next = dispatch({ operation: 'source.next', instanceId });
    await entered.promise;
    await expect(next).rejects.toThrow('next exceeded 10 milliseconds');
    try {
      await expect(dispatch({ operation: 'source.drain', instanceId }))
        .rejects.toThrow('Source input cleanup is still pending');
      await expect(dispatch({ operation: 'source.close', instanceId }))
        .rejects.toThrow('close exceeded 20 milliseconds');
      expect(closes).toBe(0);
    } finally {
      release.resolve();
      await waitFor(() => closes === 1);
    }
  });

  it('does not advance an iterable to manufacture work during drain', async () => {
    let advances = 0;
    const signal = SignalSpec.text();
    const provider = SourceProvider.fromIterable(new SourceManifest({
      sourceTypeId: 'org.example.source.iterable-drain.v1',
      outputs: [PortSpec.output('events', signal)],
    }), function* () {
      advances += 1;
      yield SourceEmission.text('events', 'not yet accepted', { signal });
    });
    const dispatch = provider._factory()._dispatch;
    const instanceId = 'iterable-drain';
    await dispatch({ operation: 'source.create', instanceId });
    await expect(dispatch({ operation: 'source.drain', instanceId })).resolves.toEqual({});
    await dispatch({ operation: 'source.close', instanceId });
    expect(advances).toBe(0);
  });

  it.each(['concise', 'authored'] as const)(
    'drains previously accepted %s Source output through Core before closing',
    async (surface) => {
      const proof = await bufferedSourceProof(surface, 'stop');
      expect(proof.stopped.success).toBe(true);
      expect(proof.received.filter((item) => item.kind === 'signal'
        && item.signal.payload.kind === 'text'
        && item.signal.payload.text.startsWith('accepted-')))
        .toHaveLength(3);
      const signals = proof.received.flatMap((item) => item.kind === 'signal' ? [item.signal] : []);
      expect(signals.slice(-3).map((value) => value.payload)).toEqual([
        { kind: 'text', text: 'accepted-1' },
        { kind: 'text', text: 'accepted-2' },
        { kind: 'text', text: 'accepted-3' },
      ]);
      expect(signals.every((value) => value.lineage?.sourceId === proof.sourceId)).toBe(true);
      expect(signals.map((value) => value.lineage?.sequenceNumber))
        .toEqual(signals.map((_, index) => BigInt(index)));
      expect(proof.lifecycle.slice(-5)).toEqual(['drain', 'drain', 'drain', 'drain', 'close']);
      expect(proof.lifecycle.filter((value) => value === 'close')).toHaveLength(1);
    },
  );

  it.each(['concise', 'authored'] as const)(
    'skips %s Source drain on cancellation and still closes exactly once',
    async (surface) => {
      const proof = await bufferedSourceProof(surface, 'cancel');
      expect(proof.lifecycle).not.toContain('drain');
      expect(proof.lifecycle.filter((value) => value === 'close')).toHaveLength(1);
      expect(proof.received.some((item) => item.kind === 'signal'
        && item.signal.payload.kind === 'text'
        && item.signal.payload.text.startsWith('accepted-'))).toBe(false);
    },
  );

  it.each(['concise', 'authored'] as const)(
    'reports a %s Source drain failure through Core and closes exactly once',
    async (surface) => {
      const proof = await bufferedSourceProof(surface, 'stop', true);
      expect(proof.stopped.success).toBe(false);
      expect(proof.stopped.metrics?.externalSources[0]?.failureTotal).toBe(1n);
      expect(proof.lifecycle.filter((value) => value === 'close')).toHaveLength(1);
    },
  );

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

function sourceDispatch(surface: 'concise' | 'authored', driver: AuthoredSourceDriver, signal: SignalSpec) {
  const id = `org.example.source.interrupt-${surface}.v1`;
  const outputs = [PortSpec.output('events', signal)];
  return (surface === 'concise'
    ? defineSource({ id, outputs, create: () => driver })
    : SourceProvider.withDriver(new SourceManifest({ sourceTypeId: id, outputs }), () => driver)._factory())
    ._dispatch;
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function bufferedSourceProof(
  surface: 'concise' | 'authored',
  operation: 'stop' | 'cancel',
  failDrain = false,
) {
  const signal = SignalSpec.text('utf8', { role: 'buffered-source-test' });
  const lifecycle: string[] = [];
  const received: EndpointItem[] = [];
  // These are accepted before Session start, not produced by the drain hook.
  const accepted = ['accepted-1', 'accepted-2', 'accepted-3'];
  let notifyReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => { notifyReady = resolve; });
  let announced = false;
  const driver: AuthoredSourceDriver = {
    next: async (cancellation) => {
      if (!announced) {
        announced = true;
        return SourceEmission.text('events', 'active', { signal });
      }
      await waitForAbort(cancellation.signal);
      return undefined;
    },
    drain: () => {
      lifecycle.push('drain');
      if (failDrain) throw new Error('accepted Source buffer could not drain');
      const text = accepted.shift();
      return text === undefined ? undefined : SourceEmission.text('events', text, { signal });
    },
    close: () => { lifecycle.push('close'); accepted.length = 0; },
  };
  const id = `org.example.source.buffered-${surface}.v1`;
  const outputs = [PortSpec.output('events', signal)];
  const feed = surface === 'concise'
    ? defineSource({ id, outputs, create: () => driver })
    : SourceProvider.withDriver(new SourceManifest({ sourceTypeId: id, outputs }), () => driver);
  const session = new Session();
  const instance = session.source(feed);
  instance.output('events').send(session.endpoint(defineEndpoint({
    id: `org.example.endpoint.buffered-${surface}.v1`,
    inputs: [PortSpec.input('events', signal)],
    create: () => ({
      receive: (item) => { received.push(item); notifyReady(); },
    }),
  })), { input: 'events', route: RouteSettings.buffered() });
  const running = await session.start();
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([ready, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Source did not reach its Endpoint')), 1_000);
      })]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    const stopped = await running[operation]();
    return { stopped, lifecycle, received, sourceId: instance.sourceId };
  } finally {
    await running.close();
  }
}

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
