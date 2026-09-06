# Run compiled extensions and managed processes

PocketStation supports two ways to add implementations that cannot run as
ordinary JavaScript:

| Choose | When it fits |
|---|---|
| Native extension | You have a trusted `.dylib`, `.so`, or `.dll` that implements the PocketStation Extension ABI. It runs inside the Node process. |
| Sidecar process | You have a program in another language or need process isolation. It exchanges typed messages with the Session over PKSS 1.0. |

Both options join the same native `Session`. Core owns registration, startup,
message limits, failure reporting, cancellation, and shutdown. JavaScript does
not create another media scheduler or invoke callbacks from realtime capture
code.

## Load a native extension

Load the library before declaring the Source, Operator, or Endpoint that it
provides:

```ts
import { Session, SignalSpec } from "pocketstation/node";

const session = new Session();
const loaded = await session.loadNativeExtensionLibrary(
  "/opt/acme/libacme_transcript.dylib",
);

const source = session.source("com.acme.source.transcript.v1");
const transcript = source.output("transcript");
const subscription = session.subscribe(transcript, {
  signal: SignalSpec.text("json"),
});

await using running = await session.start();
for await (const value of running.signals(subscription)) {
  if (value.payload.kind === "text") console.log(value.payload.text);
}
```

`loaded.canonicalPath` is the exact file retained by Core.
`loaded.registrations` lists every imported identifier, kind, revision, and
generation. Registration is transactional: if one entry is invalid or already
registered, none of that library's entries are added to the Session.

### Validate descriptors without loading a library

Provider packages can validate metadata during tests:

```ts
import {
  ExtensionAbiVersion,
  ExtensionDescriptor,
  ExtensionPort,
} from "pocketstation/node";

const abi = ExtensionAbiVersion.current();
abi.requireCompatible();

new ExtensionDescriptor({
  id: "com.acme.source.transcript.v1",
  kind: "source",
  ports: [
    new ExtensionPort({
      name: "transcript",
      direction: "output",
      signalId: "com.acme.signal.transcript.v1",
      schema: "https://acme.example/schemas/transcript-v1.json",
    }),
  ],
});
```

This uses the C ABI linked into the installed addon. It catches incompatible
versions, malformed identifiers, duplicate ports, invalid directions, and
other structural errors before packaging.

### Native-code trust

An extension executes in the Node process with the same operating-system
access as the application. PocketStation validates the absolute file name,
ABI version, descriptor records, port records, callback availability, and
registration set. It cannot prove publisher identity or memory safety.

Use an extension only when you trust its publisher and distribution channel.
Use code signing or package signatures appropriate to your application. Choose
a sidecar when process isolation and forced termination are more important
than in-process calls.

## Run a sidecar process

Declare the executable and finite resource settings, register it, and start the
Session:

```ts
import {
  Session,
  SidecarMessage,
  SidecarProcess,
} from "pocketstation/node";

const session = new Session();
const handle = session.registerSidecar(new SidecarProcess({
  id: 7n,
  program: "/opt/acme/bin/transcriber",
  arguments: ["serve", "--stdio"],
  dataCapacityMessages: 64,
  protocolLimits: { maxPayloadBytes: 1_048_576 },
  deadlines: {
    readyMs: 5_000,
    processingMs: 5_000,
    shutdownMs: 2_000,
  },
}));

await using running = await session.start();
const transcriber = running.sidecar(handle);

await transcriber.send(SidecarMessage.signal(audioBytes, {
  signalId: "com.acme.signal.audio.v1",
  streamId: frame.streamId,
  sequenceNumber: frame.sequenceNumber,
  timestampNs: frame.timestampStartNs,
  role: "application-audio",
  schema: "audio/pcm;rate=48000;channels=1;format=f32le",
}));
```

Core starts the executable directly; it never invokes a shell. Standard input
and standard output are reserved for PKSS frames. Send logs to standard error
or another destination.

`send()` copies the `Buffer` and attempts one immediate enqueue. The default
data queue holds 64 messages. If it is full, `send()` throws
`SidecarBackpressureError` with code `sidecar.queue_full`; it does not wait and
does not block capture.

Read replies with a deadline or an `AbortSignal`:

```ts
const reply = await transcriber.messages.read({
  timeoutMs: 250,
  signal: abortController.signal,
});

if (reply === undefined) {
  // No message arrived within 250 ms.
}
```

`undefined` means the wait expired. `END_OF_STREAM` means the process channel
ended. The stream permits one direct or async-iterator reader at a time.
`AbortSignal` stops only that read; it does not stop the Session or child.

## Inspect process state

Use `snapshot()` while the Session is running:

```ts
const current = await transcriber.snapshot();

console.log(current.state);
console.log(current.dataEnqueuedTotal);
console.log(current.dataReceivedTotal);
console.log(current.dataDroppedTotal);
```

Snapshots report the current state plus message, protocol, timeout, forced-kill,
and reap counters. After `stop()` or `cancel()`, the final values are returned
with the Session:

```ts
const outcome = await running.stop();

for (const process of outcome.sidecarOutcomes) {
  console.log(process.sidecarId, process.state, process.reapsTotal);
}
```

`stop()` sends `close`, waits up to `shutdownMs`, and then kills and reaps a
child that does not exit. `cancel()` sends `cancel` and follows the same finite
cleanup rule. A completed shutdown reports `state === "reaped"` and
`reapsTotal === 1n`. Forced termination remains visible through
`timeoutsTotal` and `forcedKillsTotal`.

## Keep source identity

PKSS signals carry `streamId`, `sequenceNumber`, and `timestampNs`. Copy those
values from the PocketStation frame or signal that caused the request. Add a
stable `signalId`, `role`, and `schema` so the child and application agree on
the payload meaning.

Do not create replacement sequence numbers or timestamps in JavaScript. When a
sidecar emits generated audio, return it through `Session.audioInput()` so Core
assigns the normal Source and stream identities before routing or recording it.

## Test a provider package

A provider package should cover these cases before release:

- the declared Extension ABI version is accepted;
- a malformed library changes no Session registrations;
- every child completes `hello`, `manifest`, `configure`, and `ready` within
  `readyMs`;
- queue saturation raises `sidecar.queue_full` and increments
  `dataDroppedTotal`;
- malformed frames fail startup or the affected operation explicitly;
- a child that ignores `close` and `cancel` is killed and reaped within
  `shutdownMs` plus operating-system scheduling time;
- buffers are copied before JavaScript can reuse them;
- a handle from another Session is rejected;
- the packed npm artifact runs the same checks from a new directory.

The repository fixtures prove these SDK mechanics. They are not evidence for a
specific provider, physical device, remote service, or production deployment.
