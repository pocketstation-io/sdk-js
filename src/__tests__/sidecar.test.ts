import { fileURLToPath } from 'node:url';

import {
  END_OF_STREAM,
  Session,
  SidecarBackpressureError,
  SidecarMessage,
  SidecarProcess,
  Source,
  StreamAbortError,
} from '../node/index.js';

const CHILD = fileURLToPath(
  new URL('../../tests/fixtures/pkss-child.mjs', import.meta.url),
);

function sessionWithSources(): Session {
  const session = Session._conformance();
  const audio = session.audio();
  session.capture(Source.application('PocketStation JavaScript Fixture')).send(audio);
  session.capture(Source.defaultMicrophone()).send(audio);
  return session;
}

function process(
  mode: string,
  options: { id?: bigint; capacity?: number; shutdownMs?: number } = {},
): SidecarProcess {
  return new SidecarProcess({
    id: options.id ?? 7n,
    program: globalThis.process.execPath,
    arguments: [CHILD, mode],
    dataCapacityMessages: options.capacity ?? 2,
    deadlines: {
      readyMs: 1_000,
      processingMs: 1_000,
      shutdownMs: options.shutdownMs ?? 200,
    },
  });
}

function message(sequenceNumber = 1n, payload = Buffer.from('hello')): SidecarMessage {
  return SidecarMessage.signal(payload, {
    signalId: 'io.pocketstation.test.signal.v1',
    streamId: 11n,
    sequenceNumber,
    timestampNs: sequenceNumber * 1_000n,
    role: 'transcript',
    schema: 'application/octet-stream',
  });
}

describe('Session-owned sidecars', () => {
  it('round-trips owned bytes and reaps the child on stop', async () => {
    const session = sessionWithSources();
    const handle = session.registerSidecar(process('healthy'));
    const running = await session.start();
    const sidecar = running.sidecar(handle);

    const payload = Buffer.from('hello');
    const outbound = message(1n, payload);
    payload.fill(0);
    await sidecar.send(outbound);
    const received = await sidecar.messages.read({ timeoutMs: 1_000 });
    expect(received).toBeInstanceOf(SidecarMessage);
    if (!(received instanceof SidecarMessage)) throw new Error('missing sidecar message');
    expect(received.payload.toString()).toBe('hello');
    expect(received.streamId).toBe(11n);
    expect(received.sequenceNumber).toBe(1n);
    expect(received.role).toBe('transcript');

    const live = await sidecar.snapshot();
    expect(live.state).toBe('running');
    expect(live.dataEnqueuedTotal).toBe(1n);
    expect(live.dataReceivedTotal).toBe(1n);

    const stopped = await running.stop();
    expect(stopped.success).toBe(true);
    expect(stopped.sidecarOutcomes).toHaveLength(1);
    const [final] = stopped.sidecarOutcomes;
    expect(final?.state).toBe('reaped');
    expect(final?.reapsTotal).toBe(1n);
    expect(final?.visited('closing')).toBe(true);
    expect(final?.visited('closed')).toBe(true);
    expect(final?.visited('reaped')).toBe(true);
    expect(await sidecar.messages.read()).toBe(END_OF_STREAM);
  });

  it('reports finite queue saturation with a typed error and counter', async () => {
    const session = sessionWithSources();
    const handle = session.registerSidecar(
      process('saturated', { capacity: 1 }),
    );
    const running = await session.start();
    const sidecar = running.sidecar(handle);
    const payload = Buffer.alloc(65_536, 1);
    let saturated = false;
    for (let sequence = 1n; sequence <= 1_000n; sequence += 1n) {
      try {
        await sidecar.send(message(sequence, payload));
      } catch (failure) {
        expect(failure).toBeInstanceOf(SidecarBackpressureError);
        expect((failure as SidecarBackpressureError).code).toBe('sidecar.queue_full');
        saturated = true;
        break;
      }
    }
    expect(saturated).toBe(true);
    expect((await sidecar.snapshot()).dataDroppedTotal).toBeGreaterThanOrEqual(1n);
    await running.cancel();
  });

  it('fails Session start when the child violates PKSS', async () => {
    const session = sessionWithSources();
    session.registerSidecar(process('malformed'));
    await expect(session.start()).rejects.toMatchObject({
      code: 'session.runtime_start_failed',
    });
  });

  it('kills and reaps a child that misses the shutdown deadline', async () => {
    const session = sessionWithSources();
    const handle = session.registerSidecar(
      process('hang', { shutdownMs: 50 }),
    );
    const running = await session.start();
    expect((await running.sidecar(handle).snapshot()).state).toBe('running');

    const started = performance.now();
    const stopped = await running.stop();
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(stopped.success).toBe(false);
    const [final] = stopped.sidecarOutcomes;
    expect(final?.state).toBe('reaped');
    expect(final?.timeoutsTotal).toBeGreaterThanOrEqual(1n);
    expect(final?.forcedKillsTotal).toBe(1n);
    expect(final?.reapsTotal).toBe(1n);
  });

  it('rejects a handle from another Session', async () => {
    const first = sessionWithSources();
    const second = sessionWithSources();
    const handle = first.registerSidecar(process('healthy'));
    const running = await second.start();
    try {
      expect(() => running.sidecar(handle)).toThrow(
        'SidecarHandle belongs to a different Session',
      );
    } finally {
      await running.stop();
    }
  });

  it('supports AbortSignal without stopping the Session', async () => {
    const session = sessionWithSources();
    const handle = session.registerSidecar(process('healthy'));
    const running = await session.start();
    const controller = new AbortController();
    controller.abort('test complete');
    await expect(
      running.sidecar(handle).messages.read({ signal: controller.signal }),
    ).rejects.toBeInstanceOf(StreamAbortError);
    const cancelled = await running.cancel();
    expect(cancelled.success).toBe(true);
    const [final] = cancelled.sidecarOutcomes;
    expect(final?.visited('cancelling')).toBe(true);
    expect(final?.visited('reaped')).toBe(true);
    expect(final?.reapsTotal).toBe(1n);
  });

  it('allows only one message reader at a time', async () => {
    const session = sessionWithSources();
    const handle = session.registerSidecar(process('healthy'));
    const running = await session.start();
    const sidecar = running.sidecar(handle);
    const iterator = sidecar.messages.messages({ timeoutMs: 100 });
    const pending = iterator.next();

    await expect(sidecar.messages.read()).rejects.toMatchObject({
      code: 'stream.in_use',
    });
    await sidecar.send(message());
    await expect(pending).resolves.toMatchObject({ done: false });
    await iterator.return(undefined);
    await running.cancel();
  });
});
