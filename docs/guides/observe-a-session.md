# Understand a running Session

PocketStation reports what happened to media from capture through delivery. You
can inspect a Session while it runs, react to failures as they occur, and keep
the final result with a recording or trace artifact.

This information comes from the Rust engine. JavaScript converts native
64-bit values to `bigint`; it does not estimate missing timestamps, infer
success, or replace an unavailable measurement with zero.

## Inspect delivery while the Session runs

Call `metrics()` when you need a current view of queues, delivery, timing, or
worker state:

```ts
const metrics = await running.metrics();

for (const route of metrics.routes) {
  console.log({
    routeId: route.routeId,
    waitingFrames: route.delivery.queueDepthFrames,
    deliveredFrames: route.delivery.framesDeliveredTotal,
    droppedFrames: route.delivery.framesDroppedTotal,
    p95Nanoseconds: route.delivery.sourceTimestampToReceive.p95Ns,
  });
}
```

The snapshot includes:

- the Session event queue and Node audio reader;
- native and application-authored Sources;
- every PCM route and Endpoint;
- Operators, named inputs, and typed-signal routes;
- generated PCM returned through `reenterAudio()`.

Every count, identity, and nanosecond value is a `bigint`. `dropRatePct` is a
`number` because Core reports it as a floating-point percentage. Route latency
names both its measurement and its unit:

```ts
route.sourceLatencyMeasurement;
// "source-monotonic-timestamp-to-route-receive"

route.sourceLatencyUnit;
// "nanoseconds"
```

`discardedOutputFramesTotal` is optional on a route. Its absence means the
Endpoint cannot report selected-output cancellation; it does not mean zero
frames were discarded.

## Measure delivery to Node

Each `AudioFrame` keeps the native times needed to distinguish capture and
routing work from delivery to Node:

```ts
const routeToNodeMs = Number(
  frame.nodeReadResolvedAtNs - frame.routeReceivedAtNs,
) / 1_000_000;
```

`routeReceivedAtNs` records when Core received the frame for this route.
`polledAtNs` records when the native audio Endpoint returned it.
`nodeReadResolvedAtNs` records when the Node main thread completed the native
read. These values use the same monotonic clock.

This measurement does not include later JavaScript work, a provider request,
Relay delivery, browser playout, or sound from a speaker. Measure those stages
where they run and report them separately.

## React to failures

The event stream separates lifecycle changes from Source, Endpoint, startup,
and shutdown failures:

```ts
for await (const event of running.events) {
  switch (event.type) {
    case "source-failure":
      console.error(event.failure.stableId, event.failure.operation);
      break;
    case "endpoint-failure":
      console.error(event.routeId, event.stage, event.code, event.message);
      break;
    case "terminal":
      console.log(event.state, event.finalizationFailures);
      break;
  }
}
```

Event discriminators and lifecycle stages are closed TypeScript unions. If a
native addon returns a value the installed SDK does not understand, the SDK
fails with `session.invalid_event` instead of treating the value as a known
state.

The terminal event retains every reported failure, not only aggregate counts.
This makes the final result useful even when earlier events were not consumed
by a live event reader.

## Keep the final result

Always await `stop()` or `cancel()` when the application needs final delivery,
recording, or trace information:

```ts
const result = await running.stop();

console.log(result.success);
console.log(result.metrics?.routes);
console.log(result.terminalEvent?.finalizationFailures);
```

`stop()` lets accepted work finish. `cancel()` asks providers and Core to stop
without waiting for pending media to drain. Calls through one `RunningSession`
are idempotent and return the same immutable result.

The result may contain:

- final Session metrics;
- the complete terminal event;
- one multistem recording result;
- one trace writer result;
- managed-process results.

When final metrics cannot be produced, `metrics` is absent and
`metricsUnavailableReason` explains why. Trace finalization follows the same
rule through `trace` and `traceError`.

## Check a multistem recording

Declare each recording before starting the Session:

```ts
const session = new Session({ recordingRoot: "./recordings" });
const application = session.capture(Source.application("Zoom"));
const microphone = session.capture(Source.defaultMicrophone());

application.record("application");
microphone.record("microphone");
```

After shutdown, inspect each Stem independently:

```ts
const result = await running.stop();
const recording = result.recording;

if (recording === undefined || !recording.complete) {
  console.error(recording?.errorCode, recording?.stems);
}
```

Each Stem result includes frames written, stale frames, queue pressure, dropped
frames, and timestamp or sequence discontinuities. File locations come from
Core and point to the Session directory and manifest created by the recorder.

## Write and validate a Session trace

A Session trace records lifecycle and failure events in a checksummed native
artifact. The destination must not already exist.

```ts
import { Session, SessionTrace } from "pocketstation/node";

const session = new Session({
  trace: {
    path: "./meeting.pkstrace",
    capacityRecords: 256,
  },
});
```

Trace storage has a fixed queue capacity. If records cannot be written, the
final trace is marked incomplete rather than presented as complete evidence.

Read and validate the artifact after the Session stops:

```ts
const trace = SessionTrace.read("./meeting.pkstrace");
const validation = trace.validate();

console.log(validation.lifecycle);
console.log(validation.terminalState);
console.log(trace.records());
```

`read()` verifies the file layout and checksum. `validate()` then checks record
sequence, Session identity, timestamp order, lifecycle transitions, and the
terminal result. Invalid artifacts fail with a stable `trace.*` error code.

## Know what is and is not observable

Source discovery reports capture availability and permission evidence before
capture starts. Session metrics report work Core actually observed after
startup. Provider-specific usage, network state, browser playout, and acoustic
hearing are not invented by this SDK; those require observations from the
provider, Relay, receiver, or device that owns them.

Use the value closest to the question:

| Question | Read |
|---|---|
| Can this host capture the selected Source? | discovery and authorization observations |
| Is media waiting or being dropped now? | `running.metrics()` |
| Did a Source or Endpoint fail? | `running.events` |
| Did recording finish and where are its files? | `result.recording` |
| Did shutdown complete cleanly? | `result.success` and `result.terminalEvent` |
| Is the saved lifecycle evidence complete? | `SessionTrace.read(...).validate()` |

Repository tests exercise these APIs with deterministic Core fixtures and
application-owned PCM. They prove SDK behavior, not physical-device latency,
browser playout, provider availability, or cross-platform package support.
