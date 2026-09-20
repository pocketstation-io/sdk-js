# Consume Operator output

Operators can emit PCM audio, text, events, metrics, or package-defined bytes.
Use a signal subscription when JavaScript needs to read that output. The Rust
engine keeps the queue, timing, source identity, and delivery totals; the Node
SDK converts a value only when your code reads it.

The Operator implementation must already be registered with Core by a native
extension or provider package. A subscription does not create an Operator and
does not replace a missing provider with example behavior.

## Declare a subscription

Choose the output and describe the signal it emits:

```ts
import { Operator, Session, SignalSpec, Source } from "pocketstation/node";

const session = new Session();
const application = session.capture(Source.application("Zoom"));
const transcriber = session.operator(
  new Operator("io.example.streaming-transcriber.v1"),
);

application.connect(transcriber.input("audio"));
const transcripts = session.subscribe(transcriber.output("transcript"), {
  signal: SignalSpec.text("json", { role: "transcript.update" }),
});
```

Core checks the signal and media settings when the Session starts. An unknown
Operator, missing port, or incompatible signal fails before capture begins.

## Read values

Open the subscription from the running Session:

```ts
await using running = await session.start();

for await (const value of running.signals(transcripts)) {
  switch (value.payload.kind) {
    case "text":
      console.log(value.payload.text);
      break;
    case "audio":
      consumeAudio(value.payload.samples);
      break;
    case "bytes":
      decode(value.payload.data);
      break;
  }
}
```

The payload is a discriminated union, so TypeScript narrows the available
fields from `payload.kind`. Audio is interleaved `Float32Array` PCM. Text is a
JavaScript string. Other encodings arrive as an owned `Uint8Array` snapshot.

One `SignalStream` has one reader and one permanent consumption mode. The first
`read()` or `poll()` selects direct mode; the first `values()` or
`iterSignals()` selects iteration mode. Concurrent use raises `stream.in_use`,
and switching modes raises `stream.mode_conflict`. Breaking a loop releases the
active reader so a new iterator can resume the same mode without changing the
stream's delivery contract.

## Distinguish timeout from end-of-stream

`read()` has three outcomes:

```ts
import { END_OF_STREAM } from "pocketstation/node";

const value = await running.signals(transcripts).read({ timeoutMs: 100 });

if (value === undefined) {
  // The subscription is still open; no value arrived within 100 ms.
} else if (value === END_OF_STREAM) {
  // The subscription ended and no value remains.
} else {
  console.log(value.timing.observedTimestampNs, value.payload);
}
```

`poll()` is the explicit zero-wait spelling. `readerMode` reports
`"signal_read"` or `"signals"`, while `isClosed` distinguishes a terminal
subscription from a temporary empty read.

Timeouts are integers from 0 through 1,000 milliseconds. A zero timeout is
valid for a direct poll. Async iteration requires a positive timeout so an
empty stream cannot repeatedly schedule immediate reads.

## Cancel one reader

An `AbortSignal` stops the current read or iterator without stopping the
Session:

```ts
for await (const value of running.signals(transcripts).values({ signal })) {
  consume(value);
}
```

The SDK checks the signal between native waits of no more than 20 ms and raises
`StreamAbortError`, whose standard error name is `AbortError`. The error keeps
the value passed to `AbortController.abort()` in its `reason` field.

## Inspect delivery

Queue state and delivery totals come from the Core route:

```ts
const stream = running.signals(transcripts);
const state = await stream.metrics();

console.log(state.depthSignals, state.peakDepthSignals, state.droppedTotal);
```

`capacitySignals` is the fixed number of values the route may retain.
`maximumBufferedPayloadBytes` is the corresponding byte ceiling. A slow
consumer can therefore be detected from actual queue growth and drops instead
of inferred from model latency.

## Close one subscription

Call `close()` when JavaScript no longer needs an output:

```ts
const stream = running.signals(transcripts);
stream.close();
```

Closing is idempotent. It ends that stream without stopping the Session,
capture, recording, or another subscription. `stop()` and `cancel()` close all
remaining streams as part of Session shutdown. `aclose()` provides the same
operation for code that uniformly awaits resource shutdown.
