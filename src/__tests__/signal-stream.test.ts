import {
  END_OF_STREAM,
  EndOfStream,
  Operator,
  PortSpec,
  RouteSettings,
  Session,
  SignalSpec,
  SignalStream,
  Source,
  STREAM_EOF,
  StreamAbortError,
  StreamError,
  defineSource,
} from '../node/index.js';
import { _envelopeFromNative } from '../node/signals.js';
import type {
  NativeBusSubscriptionHandle,
  NativeRunningSessionHandle,
} from '../node/native.js';

const TEST_SUBSCRIPTION = {
  _nativeHandle: () => ({ id: '1', sessionId: '1', routeId: '1' }) as NativeBusSubscriptionHandle,
} as Parameters<typeof SignalStream._create>[1];

describe('typed signal streams', () => {
  it('keeps a required sibling route live for values produced after explicit close', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let sent = false;
    const signal = SignalSpec.text();
    const session = new Session();
    const output = session.source(defineSource({
      id: 'org.example.source.subscription-revocation.v1',
      outputs: [PortSpec.output('text', signal)],
      create: () => ({ next: async () => {
        if (sent) return undefined;
        await gate;
        sent = true;
        return { output: 'text', data: 'after-close' };
      } }),
    })).output('text');
    const first = session.subscribe(output, { signal, route: RouteSettings.buffered() });
    const second = session.subscribe(output, { signal, route: RouteSettings.buffered() });
    const running = await session.start();
    const firstStream = running.signals(first);
    const secondStream = running.signals(second);
    try {
      firstStream.close();
      release();
      expect(await secondStream.read({ timeoutMs: 1_000 }))
        .toMatchObject({ payload: { text: 'after-close' } });
      expect(await firstStream.poll()).toBe(END_OF_STREAM);
      const stopped = await running.stop();
      expect(stopped.success).toBe(true);
      expect(stopped.metrics?.externalSources[0]?.failureTotal).toBe(0n);
      expect(stopped.metrics?.derivedRoutes.find((route) => route.routeId === first.routeId)?.output)
        .toMatchObject({ depthSignals: 0n, enqueuedTotal: 0n, droppedTotal: 1n });
    } finally {
      release();
      await running.close();
    }
  });

  it.each(['pending', 'cached'] as const)('discards a %s native value on explicit close', async (stage) => {
    let release: () => void = () => undefined;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let closes = 0;
    const running = {
      closeSignal: () => { closes += 1; },
      readSignal: async () => {
        await wait;
        return {
          status: 'item',
          envelope: {
            signalKind: 'text', signalFormat: 'utf8', signalWireId: SignalSpec.text().wireId,
            timing: { observedTimestampNs: '13' }, payloadKind: 'text', text: 'discarded',
          },
        };
      },
    } as NativeRunningSessionHandle;
    const stream = SignalStream._create(running, TEST_SUBSCRIPTION);
    const controller = new AbortController();
    const read = stream.read({ signal: controller.signal });
    if (stage === 'cached') {
      controller.abort();
      release();
      await expect(read).rejects.toBeInstanceOf(StreamAbortError);
      stream.close();
    } else {
      stream.close();
      release();
      await expect(read).resolves.toBe(END_OF_STREAM);
    }
    stream.close();
    expect(closes).toBe(1);
    expect(await stream.poll()).toBe(END_OF_STREAM);
  });

  it.each(['audio', 'text', 'bytes', 'future'])(
    'rejects malformed native %s payloads with the shared stream code',
    (payloadKind) => {
      expect(() => _envelopeFromNative({
        signalKind: 'text',
        signalFormat: 'utf8',
        signalWireId: SignalSpec.text().wireId,
        timing: { observedTimestampNs: '0' },
        payloadKind,
      })).toThrow(StreamError);
      try {
        _envelopeFromNative({
          signalKind: 'text',
          signalFormat: 'utf8',
          signalWireId: SignalSpec.text().wireId,
          timing: { observedTimestampNs: '0' },
          payloadKind,
        });
      } catch (error) {
        expect(error).toMatchObject({ code: 'stream.invalid_read' });
      }
    },
  );

  it('reads audio, text, and bytes from real Core Operators', async () => {
    const session = Session._conformance();
    const source = session.capture(Source.defaultMicrophone());
    const audio = source.through(
      new Operator(
        'org.pocketstation.javascript.conformance.audio-pass-through.v1',
      ),
      { input: 'audio-in', output: 'audio-out' },
    );
    const text = source.through(
      new Operator('org.pocketstation.javascript.conformance.audio-to-text.v1'),
      { input: 'audio-in', output: 'text-out' },
    );
    const bytes = source.through(
      new Operator('org.pocketstation.javascript.conformance.audio-to-bytes.v1'),
      { input: 'audio-in', output: 'bytes-out' },
    );
    const subscriptions = [
      session.subscribe(audio, { signal: SignalSpec.audio() }),
      session.subscribe(text, { signal: SignalSpec.text() }),
      session.subscribe(bytes, { signal: SignalSpec.binary() }),
    ];

    const running = await session.start();
    const streams = subscriptions.map((subscription) =>
      running.signals(subscription),
    );
    const received = await Promise.all(
      streams.map((stream) => stream.read({ timeoutMs: 1_000 })),
    );
    const metrics = await Promise.all(streams.map((stream) => stream.metrics()));
    const result = await running.stop();

    for (const value of received) {
      expect(value).toBeDefined();
      expect(value).not.toBeInstanceOf(EndOfStream);
    }
    const [audioValue, textValue, bytesValue] = received;
    if (
      audioValue == null || audioValue instanceof EndOfStream ||
      textValue == null || textValue instanceof EndOfStream ||
      bytesValue == null || bytesValue instanceof EndOfStream
    ) {
      throw new Error('expected three signal envelopes');
    }
    expect(audioValue.payload.kind).toBe('audio');
    expect(textValue.payload.kind).toBe('text');
    expect(bytesValue.payload.kind).toBe('bytes');
    expect(audioValue.lineage).toBeDefined();
    expect(audioValue.lineage?.clock.id).toBe(audioValue.lineage?.clockId);
    expect(audioValue.lineage?.clock.kind).toBe('process-monotonic');
    if (audioValue.payload.kind !== 'audio') {
      throw new Error('expected audio payload');
    }
    expect(audioValue.payload.sampleFormat).toBe('f32le');
    expect(audioValue.payload.sampleCount).toBe(audioValue.payload.samples.length);
    expect(audioValue.payload.samplesF32le.byteLength).toBe(
      audioValue.payload.sampleCount * Float32Array.BYTES_PER_ELEMENT,
    );
    expect(audioValue.derivation?.operatorId).toContain('audio-pass-through');
    expect(textValue.derivation?.operatorId).toContain('audio-to-text');
    expect(bytesValue.derivation?.operatorId).toContain('audio-to-bytes');
    for (const value of metrics) {
      expect(value.capacitySignals).toBeGreaterThan(0n);
      expect(value.enqueuedTotal).toBeGreaterThanOrEqual(1n);
      expect(value.receivedTotal).toBeGreaterThanOrEqual(1n);
    }
    expect(result.success).toBe(true);
    expect(STREAM_EOF).toBe(END_OF_STREAM);
    for (const stream of streams) {
      await expect(stream.read({ timeoutMs: 0 })).resolves.toBe(END_OF_STREAM);
    }
  });

  it('exposes the canonical route settings on a BusSubscription', () => {
    const session = Session._conformance();
    const source = session.capture(Source.defaultMicrophone());
    const audio = source.through(
      new Operator(
        'org.pocketstation.javascript.conformance.audio-pass-through.v1',
      ),
      { input: 'audio-in', output: 'audio-out' },
    );
    const subscription = session.subscribe(audio, { signal: SignalSpec.audio() });

    expect(subscription.routeSettings).toBe(subscription.route);
  });

  it('returns the same stream and closes one subscription without stopping the Session', async () => {
    const session = Session._conformance();
    const source = session.capture(Source.defaultMicrophone());
    const audio = source.through(
      new Operator(
        'org.pocketstation.javascript.conformance.audio-pass-through.v1',
      ),
      { input: 'audio-in', output: 'audio-out' },
    );
    const first = session.subscribe(audio, {
      signal: SignalSpec.audio(),
    });
    const second = session.subscribe(audio, {
      signal: SignalSpec.audio(),
    });
    const running = await session.start();
    const firstStream = running.signals(first);
    const secondStream = running.signals(second);

    expect(running.signals(first)).toBe(firstStream);
    firstStream.close();
    firstStream.close();

    await expect(firstStream.read({ timeoutMs: 0 })).resolves.toBe(
      END_OF_STREAM,
    );
    const received = await secondStream.read({ timeoutMs: 1_000 });
    expect(received).not.toBe(END_OF_STREAM);
    expect(received).toBeDefined();
    expect((await running.stop()).success).toBe(true);
  });

  it('rejects a subscription owned by another Session', async () => {
    const first = Session._conformance();
    first.capture(Source.defaultMicrophone()).send(first.audio());
    const second = Session._conformance();
    const source = second.capture(Source.defaultMicrophone());
    const audio = source.through(
      new Operator(
        'org.pocketstation.javascript.conformance.audio-pass-through.v1',
      ),
      { input: 'audio-in', output: 'audio-out' },
    );
    const subscription = second.subscribe(audio, {
      signal: SignalSpec.audio(),
    });
    const running = await first.start();

    expect(() => running.signals(subscription)).toThrow(
      'BusSubscription belongs to a different Session',
    );
    expect((await running.stop()).success).toBe(true);
  });

  it('uses a stable abort error before requesting native work', async () => {
    const session = Session._conformance();
    const source = session.capture(Source.defaultMicrophone());
    const audio = source.through(
      new Operator(
        'org.pocketstation.javascript.conformance.audio-pass-through.v1',
      ),
      { input: 'audio-in', output: 'audio-out' },
    );
    const subscription = session.subscribe(audio, {
      signal: SignalSpec.audio(),
    });
    const running = await session.start();
    const controller = new AbortController();
    controller.abort('test complete');

    await expect(
      running.signals(subscription).read({ signal: controller.signal }),
    ).rejects.toBeInstanceOf(StreamAbortError);
    expect((await running.stop()).success).toBe(true);
  });

  it('preserves a signal accepted while its read is aborted', async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = {
      readSignal: async () => {
        await wait;
        return {
          status: 'item',
          envelope: {
            signalKind: 'text',
            signalFormat: 'utf8',
            signalWireId: SignalSpec.text().wireId,
            timing: { observedTimestampNs: '13' },
            payloadKind: 'text',
            text: 'retained',
          },
        };
      },
    } as NativeRunningSessionHandle;
    const stream = SignalStream._create(running, TEST_SUBSCRIPTION);
    const controller = new AbortController();
    const read = stream.read({ signal: controller.signal });
    controller.abort('test complete');
    release?.();

    await expect(read).rejects.toBeInstanceOf(StreamAbortError);
    await expect(stream.read()).resolves.toMatchObject({
      payload: { kind: 'text', text: 'retained' },
    });
  });

  it('rejects zero-timeout iteration instead of spinning', async () => {
    const session = Session._conformance();
    const source = session.capture(Source.defaultMicrophone());
    const audio = source.through(
      new Operator(
        'org.pocketstation.javascript.conformance.audio-pass-through.v1',
      ),
      { input: 'audio-in', output: 'audio-out' },
    );
    const subscription = session.subscribe(audio, {
      signal: SignalSpec.audio(),
    });
    const running = await session.start();

    await expect(
      running.signals(subscription).values({ timeoutMs: 0 }).next(),
    ).rejects.toThrow('values() requires timeoutMs to be greater than zero');
    expect((await running.stop()).success).toBe(true);
  });

  it('reports finite queue growth when a signal consumer is slow', async () => {
    const session = Session._conformance(true);
    const source = session.capture(Source.defaultMicrophone());
    const text = source.through(
      new Operator('org.pocketstation.javascript.conformance.audio-to-text.v1'),
      { input: 'audio-in', output: 'text-out' },
    );
    const subscription = session.subscribe(text, {
      signal: SignalSpec.text(),
    });
    const running = await session.start();
    const stream = running.signals(subscription);

    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const metrics = await stream.metrics();

    expect(metrics.capacitySignals).toBeGreaterThan(0n);
    expect(metrics.peakDepthSignals).toBeGreaterThan(0n);
    expect(metrics.depthSignals).toBeLessThanOrEqual(metrics.capacitySignals);
    expect(metrics.enqueuedTotal).toBeGreaterThan(metrics.receivedTotal);
    await running.cancel();
  });

  it('releases ownership but permanently retains the selected reader mode', async () => {
    const session = Session._conformance();
    const source = session.capture(Source.defaultMicrophone());
    const text = source.through(
      new Operator('org.pocketstation.javascript.conformance.audio-to-text.v1'),
      { input: 'audio-in', output: 'text-out' },
    );
    const subscription = session.subscribe(text, {
      signal: SignalSpec.text(),
    });
    const running = await session.start();
    const stream = running.signals(subscription);
    const iterator = stream.values();

    const first = await iterator.next();
    expect(first.done).toBe(false);
    await iterator.return(undefined);
    await expect(stream.read({ timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'stream.mode_conflict',
    });
    const second = await stream.iterSignals({ timeoutMs: 1_000 }).next();

    expect(second.value).toBeDefined();
    expect(second.value).not.toBeInstanceOf(EndOfStream);
    expect(stream.readerMode).toBe('signals');
    expect((await running.stop()).success).toBe(true);
  });

  it('exposes poll, close state, and idempotent asynchronous close', async () => {
    const session = Session._conformance();
    const source = session.capture(Source.defaultMicrophone());
    const text = source.through(
      new Operator('org.pocketstation.javascript.conformance.audio-to-text.v1'),
      { input: 'audio-in', output: 'text-out' },
    );
    const subscription = session.subscribe(text, { signal: SignalSpec.text() });
    const running = await session.start();
    const stream = running.signals(subscription);

    expect(stream.isClosed).toBe(false);
    await stream.aclose();
    await stream.aclose();
    expect(stream.isClosed).toBe(true);
    await expect(stream.poll()).resolves.toBe(END_OF_STREAM);
    expect(stream.readerMode).toBe('signal_read');
    expect((await running.stop()).success).toBe(true);
  });
});
