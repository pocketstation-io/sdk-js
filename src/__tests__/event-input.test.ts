import { Buffer } from 'node:buffer';

import {
  EventInputClosedError,
  EventInputFullError,
  RouteSettings,
  Session,
} from '../node/index.js';

describe('application-owned event ingress', () => {
  it('preserves canonical JSON, source identity, and timing through one real Session', async () => {
    const session = new Session();
    const events = session.eventInput('provider-events', { capacityEvents: 2 });
    const subscription = session.subscribe(events.output, {
      signal: events.signal,
      route: RouteSettings.buffered(),
    });
    const running = await session.start();

    events.tryWrite(
      { type: 'speech.started', revision: 1 },
      { timestampNs: 42n },
    );
    const envelope = await running
      .signals(subscription)
      .read({ timeoutMs: 1_000 });
    await events.close();
    const stopped = await running.stop();

    expect(envelope).toBeDefined();
    if (envelope === undefined || envelope.kind === 'end-of-stream') {
      throw new Error('event input did not emit its accepted event');
    }
    expect(envelope.payload.kind).toBe('bytes');
    if (envelope.payload.kind !== 'bytes') {
      throw new Error('event input emitted a non-byte payload');
    }
    expect(Buffer.from(envelope.payload.data).toString('utf8')).toBe(
      '{"revision":1,"type":"speech.started"}',
    );
    expect(envelope.timing.sourceTimestampNs).toBe(42n);
    expect(envelope.timing.observedTimestampNs).toBe(42n);
    expect(envelope.lineage?.sourceId).toBe(events.output.sourceId);
    expect(events.observations()).toMatchObject({
      capacityEvents: 2,
      depthEvents: 0,
      acceptedTotal: 1n,
      fullTotal: 0n,
      closed: true,
    });
    expect(stopped.success).toBe(true);
  });

  it('reports finite capacity before Session start and rejects writes after close', async () => {
    const session = new Session();
    const events = session.eventInput('provider-events', { capacityEvents: 1 });
    const subscription = session.subscribe(events.output, {
      signal: events.signal,
      route: RouteSettings.buffered(),
    });

    events.tryWrite({ type: 'first' });
    expect(() => events.tryWrite({ type: 'second' })).toThrow(
      EventInputFullError,
    );
    expect(events.observations()).toEqual({
      capacityEvents: 1,
      depthEvents: 1,
      acceptedTotal: 1n,
      fullTotal: 1n,
      closed: false,
    });

    await events.close();
    expect(() => events.tryWrite({ type: 'late' })).toThrow(
      EventInputClosedError,
    );

    const running = await session.start();
    const accepted = await running
      .signals(subscription)
      .read({ timeoutMs: 1_000 });
    const stopped = await running.stop();
    expect(accepted).toBeDefined();
    expect(stopped.success).toBe(true);
  });

  it('validates identity, finite bounds, timestamps, and JSON values', async () => {
    const session = new Session();

    expect(() => session.eventInput('')).toThrow(RangeError);
    expect(() => session.eventInput('bad/name')).toThrow(RangeError);
    expect(() => session.eventInput('events', { capacityEvents: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      session.eventInput('events', { maximumEventBytes: 1_048_577 }),
    ).toThrow(RangeError);

    const events = session.eventInput('validated-events', {
      maximumEventBytes: 8,
    });
    expect(() => events.tryWrite({ value: 'too large' })).toThrow(RangeError);
    expect(() => events.tryWrite({ value: Number.NaN })).toThrow(TypeError);
    expect(() => events.tryWrite({ ok: true }, { timestampNs: -1n })).toThrow(
      RangeError,
    );
    expect(() =>
      events.tryWrite({ ok: true }, { timestampNs: 1n << 64n }),
    ).toThrow(RangeError);

    session.subscribe(events.output, {
      signal: events.signal,
      route: RouteSettings.buffered(),
    });
    await events.close();
    const running = await session.start();
    const stopped = await running.stop();
    expect(stopped.success).toBe(true);
  });
});
