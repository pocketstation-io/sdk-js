import { Buffer } from 'node:buffer';

import { RouteSettings, Session } from 'pocketstation/node';

const session = new Session();
const events = session.eventInput('provider-events', { capacityEvents: 4 });
const subscription = session.subscribe(events.output, {
  signal: events.signal,
  route: RouteSettings.buffered(),
});

events.tryWrite({ type: 'provider.ready', revision: 1 });
await events.close();

const running = await session.start();
const envelope = await running.signals(subscription).read({ timeoutMs: 1_000 });
const result = await running.stop();

if (envelope === undefined || 'kind' in envelope) {
  throw new Error('accepted event was not delivered');
}
if (envelope.payload.kind !== 'bytes') {
  throw new Error('event input returned a non-byte payload');
}

console.log({
  event: JSON.parse(Buffer.from(envelope.payload.data).toString('utf8')),
  sourceId: envelope.lineage?.sourceId,
  timestampNs: envelope.timing.sourceTimestampNs,
  observations: events.observations(),
  result,
});
