import {
  END_OF_STREAM,
  EndOfStream,
  Operator,
  Session,
  SignalSpec,
  Source,
  StreamAbortError,
} from '../node/index.js';

describe('typed signal streams', () => {
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
    expect(audioValue.derivation?.operatorId).toContain('audio-pass-through');
    expect(textValue.derivation?.operatorId).toContain('audio-to-text');
    expect(bytesValue.derivation?.operatorId).toContain('audio-to-bytes');
    for (const value of metrics) {
      expect(value.capacitySignals).toBeGreaterThan(0n);
      expect(value.enqueuedTotal).toBeGreaterThanOrEqual(1n);
      expect(value.receivedTotal).toBeGreaterThanOrEqual(1n);
    }
    expect(result.success).toBe(true);
    for (const stream of streams) {
      await expect(stream.read({ timeoutMs: 0 })).resolves.toBe(END_OF_STREAM);
    }
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
