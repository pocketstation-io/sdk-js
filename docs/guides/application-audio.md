# Feed application-owned PCM

An `AudioInput` adds audio that your application already receives or creates to
a PocketStation `Session`. Common producers include a model, TTS service,
decoder, media server, WebSocket, or test signal.

This is different from desktop capture. It does not open an application, the
whole computer, or a microphone. Your producer supplies the samples;
PocketStation assigns source identity and media time, then routes the frames to
recording, Node, or any other declared destination.

## Create an input

Declare the input before starting the Session, then route its output like any
other Source:

```ts
import { Session } from "pocketstation/node";

const session = new Session({ frameDurationMs: 10 });
const input = session.audioInput("agent audio");

input.output.send(session.audio());
```

`AudioInput` implements the exported `PcmSource` contract. Accept `PcmSource` in
advanced components that need source identity, `output`, `beginOutput()`,
`tryWrite()`, `observations()`, and `close()` but do not require the
finite-wait `write()` convenience.

The input defaults to 48 kHz mono with 480 samples per channel in each write.
That is one 10 ms frame. Set the values explicitly when the producer uses a
different supported format:

```ts
const input = session.audioInput("stereo decoder", {
  sampleRateHz: 48_000,
  channels: 2,
  frameSamplesPerChannel: 960,
  capacityFrames: 4,
});
```

All application-owned inputs in one Session use the Session sample rate and
channel count. Core rejects an incompatible input while the Session is still
being declared.

## Write one frame

`Float32Array` is the normal representation. Stereo samples are interleaved:
left, right, left, right.

```ts
await input.write(samples);
```

`write()` copies the frame into storage owned by Core before it resolves. The
producer may reuse or modify `samples` after the call.

Node `Buffer` is useful when PCM arrives as bytes. Its format is explicit:
little-endian IEEE 754 float32, with four bytes per sample.

```ts
await input.write(pcmFloat32LE);
```

A Buffer whose byte length is not divisible by four fails. Both representations
must contain exactly `frameSamplesPerChannel * channels` samples.

## Choose how to handle capacity

Every input has a fixed number of frames that may wait for Core. The default is
eight frames. At a 10 ms cadence, that is 80 ms of producer capacity; it never
grows with process lifetime.

Use `tryWrite()` when the producer must make its own immediate decision:

```ts
import { AudioInputFullError } from "pocketstation/node";

try {
  input.tryWrite(samples);
} catch (error) {
  if (error instanceof AudioInputFullError) {
    // Drop, retry, or stop according to the producer's own policy.
  }
}
```

Use `write()` when a short wait is appropriate:

```ts
await input.write(samples, {
  timeoutMs: 250,
  signal: controller.signal,
});
```

The wait does not create another PCM queue in JavaScript. It retries the same
Core input until capacity becomes available, the deadline expires, or the
signal is aborted. A timeout raises `AudioInputTimeoutError`. An abort raises
`AudioInputAbortError` with the standard `AbortError` name. Neither operation
closes the input or affects other Sources.

## Report missing media

Mark the first frame after media was lost or intentionally skipped:

```ts
input.tryWrite(samples, { discontinuity: true });
```

Core advances the discontinuity epoch only when it accepts that frame. A write
rejected because the input is full does not advance sequence, timestamp, or
discontinuity state.

## Replace generated output without stopping capture

Use an output identity for audio that may become irrelevant while it is still
waiting for delivery. Voice responses are the common example:

```ts
const response = input.beginOutput();

await input.write(firstFrame, { generation: response });
await input.write(secondFrame, { generation: response });

response.cancel();
```

Cancellation makes later writes for that output fail with
`OutputCancelledError`. Core also removes its pending frames from Session
routes. Other audio inputs, captured Sources, and the Session remain active.

Starting a new output also deactivates the previous one:

```ts
const previous = input.beginOutput();
const current = input.beginOutput();

console.log(previous.active); // false
console.log(current.active);  // true
```

Each delivered frame retains `outputGenerationId`. Route metrics report how
many pending frames Core discarded. This proves what Core removed; it does not
claim that a remote player or physical speaker stopped unless that receiver
reports its own playout result.

## Observe and close the input

Capacity and lifecycle state come directly from Core:

```ts
const state = input.observations();

console.log(
  state.acceptedTotal,
  state.fullTotal,
  state.availableBuffers,
  state.discardedOutputFramesTotal,
  state.cancelledOutputWritesTotal,
);
```

Call `close()` after the producer sends its last frame. New writes then fail
with `AudioInputClosedError`. Frames already accepted continue through the
normal Session shutdown.

```ts
input.close();
const outcome = await running.stop();
```

Cancelling the Session is different from closing one input. A write rejected
because its Session was cancelled raises `AudioInputCancelledError`.

## Compose with processing and recording

`input.output` is a normal `SourceOutput`. It can be sent, connected to a named
Operator input, processed, or recorded without copying PCM through another
JavaScript callback:

```ts
input.output.connect(transcriber.input("audio"));
input.output.record("agent");
```

The Operator must be supplied by a registered implementation. Declaring an
unknown Operator still fails during `session.start()`; PocketStation does not
replace it with example behavior.
