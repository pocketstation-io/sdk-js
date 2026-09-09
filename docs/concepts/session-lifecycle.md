# Session lifecycle and limits

A Session is a declaration. Add Sources, Operators, destinations, recordings,
and subscriptions before calling `start()`. Core validates the complete
declaration before it opens capture resources.

```text
declare → validate → prepare → start → run → stop or cancel → finalize
```

`stop()` finishes accepted work before closing resources. Use it when files or
provider delivery must complete. `cancel()` asks the runtime to discard pending
work and finish promptly. Both return the final state that Core could observe.

Every queue has a fixed capacity. Delivery settings decide whether a full
route waits, drops new media, or replaces older media. Metrics keep accepted,
delivered, dropped, rejected, and discarded counts separate, so a slow
consumer cannot become silent data loss.

JavaScript runs after media leaves realtime capture. Core owns capture,
routing, timestamps, sequence numbers, recording, and shutdown. The SDK copies
frames into JavaScript memory only when application code reads or receives
them.

One audio stream or signal subscription permits one reader at a time. Create
another declared destination when two consumers need the same Stem; do not
divide one iterator between them.

Use `await using` or a `finally` block so shutdown is explicit. Garbage
collection requests cleanup but cannot return recording or delivery results.

Use `session.run()` when one callback owns the complete operation:

```ts
const result = await session.run(async (running) => {
  for await (const frame of running.audio) consume(frame);
});
```

It drains accepted work after a successful callback and cancels pending work
before rethrowing a callback failure. `start()` remains available when the
application needs to choose or coordinate shutdown itself.

## Why lifecycle operations return Promises

Starting a Session may wait for native source readiness. Reading waits for
media, a capacity-aware write may wait for Core to accept a frame, and shutdown
waits for owned resources to finish. These operations return Promises so they
do not block the Node.js event loop.

PocketStation does not use a Promise to run a native audio callback in
JavaScript. Capture remains in Rust and JavaScript receives work only after it
has left realtime audio code. Use `tryWrite()` when a producer needs an
immediate result instead of waiting for capacity.

See [Route settings](route-settings.md), [Session observations](../guides/observe-a-session.md),
and [Errors and outcomes](../reference/events-and-errors.md).
