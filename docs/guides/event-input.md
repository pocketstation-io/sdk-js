# Feed application events into a Session

Use `Session.eventInput()` when an application callback, WebSocket, provider,
or framework already owns structured events that should enter the same typed,
source-aware Session as captured audio.

```js
import { RouteSettings, Session } from 'pocketstation/node';

const session = new Session();
const events = session.eventInput('provider-events', {
  capacityEvents: 256,
  maximumEventBytes: 16_384,
});
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
await running.stop();
```

`tryWrite()` performs deterministic JSON serialization and never waits for
capacity. It throws `EventInputFullError` when its finite pre-Core queue is
full and `EventInputClosedError` after close. `observations()` reports current
depth and cumulative accepted/full totals.

An accepted event keeps its Source and stream identity through Core. The
optional `timestampNs` is a monotonic source timestamp; when omitted,
PocketStation samples Node's monotonic clock. Closing stops new writes while
previously accepted events remain eligible to drain.

This input owns only JSON serialization and one bounded application queue.
Core still owns routing, subscription backpressure, sequence numbers, Session
time translation, and downstream failures. Application-owned PCM belongs in
`Session.audioInput()` instead.
