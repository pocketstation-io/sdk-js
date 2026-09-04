# PocketStation for JavaScript

The Node API is designed to capture audio from a desktop application, the whole
computer, or a microphone on macOS, Windows, and Linux. Each source stays
separate and every frame includes its source, stream, timing, and sequence
information. The current platform evidence is listed below; it does not yet
cover all three operating systems.

The package uses the PocketStation Rust engine for capture, routing, and
shutdown. JavaScript receives audio after it leaves the realtime capture code,
so model calls and application work do not run on an audio callback.

> The Node SDK is under active development and is not published to npm yet.
> The current candidate has a real macOS selected-application capture proof.
> Windows, Linux, Connectors, Relay publication, and the remaining
> Rust/Python features still require implementation or target-specific proof.

## Capture an application

Choose the running application by its exact display name or application ID:

```ts
import { Session, Source } from "pocketstation/node";

const session = new Session({ frameDurationMs: 10 });
const application = session.capture(Source.application("Spotify"));
application.send(session.audio());
```

Start the Session and read source-aware PCM frames:

```ts
await using running = await session.start();

for await (const frame of running.audio) {
  console.log(frame.sourceId, frame.timestampStartNs, frame.samples);
}
```

`frame.samples` is interleaved `Float32Array` PCM. IDs, sequence numbers, and
nanosecond timestamps are `bigint`, so JavaScript does not round native 64-bit
values.

## Add a microphone

PocketStation never opens a microphone unless your code asks for one:

```ts
const microphone = session.capture(Source.defaultMicrophone());
microphone.send(session.audio());
```

Application and microphone frames share the iterator but keep different
`sourceId` and `stemId` values. A slow reader can therefore be diagnosed without
guessing which source produced a frame.

To capture all desktop output instead of one application, choose it explicitly:

```ts
const desktop = session.capture(Source.systemAudio());
```

## Record or process the same Stem

Capture does not need to be repeated for each destination. The same Stem can be
read by Node and recorded as a separate WAV file:

```ts
const session = new Session({ recordingRoot: "./recordings" });
const application = session.capture(Source.application("Spotify"));

application.send(session.audio());
application.record("application");
```

Operators and custom Endpoints use open identifiers and named ports. Core
validates the complete Session before capture starts and reports the exact
Operator, node, or port when compilation fails. The JavaScript package does not
compile a second execution plan.

The Operator and destination implementations must be installed and registered
with Core. JavaScript authoring for those implementations is a later package
step; the current API does not pretend an unknown provider exists.

Read [Route, process, and record media](docs/guides/compose-a-session.md) for
named ports, generated audio, compiler diagnostics, and delivery settings.

## Feed audio your application already has

Use an `AudioInput` when a provider, network connection, decoder, or voice
model already gives your application PCM:

```ts
const input = session.audioInput("agent audio");
input.output.send(session.audio());
await input.write(samples);
input.close();
```

`samples` is normally a `Float32Array` containing one complete interleaved
frame. A `Buffer` is also accepted when it contains little-endian IEEE 754
float32 values. PocketStation copies an accepted frame before the write
returns, so the producer can reuse its array immediately.

The default input holds at most eight frames waiting for Core. `tryWrite()`
reports `AudioInputFullError` immediately. `write()` waits up to one second and
accepts an `AbortSignal`; timing out or aborting that wait does not close the
input or stop the Session.

Read [Feed application-owned PCM](docs/guides/application-audio.md) for format,
capacity, discontinuity, cancellation, and shutdown behavior.

## Discover sources before capture

Discovery lets an application present the real sources reported by the host
instead of asking a user to type a name:

```ts
import { Source, discoverSources } from "pocketstation/node";

const applications = await discoverSources({
  type: "kind",
  kind: "application",
});

const selected = Source.fromDiscovered(applications[0]);
```

Each result includes its display name, native application or device identity,
current state, audio format, and how long its selector may be reused. A
discovered output device is informational; application, input-device, and
system-mix results can be turned into Session Sources.

Read microphone permission without prompting:

```ts
import { microphonePermissionObservation } from "pocketstation/node";

const permission = await microphonePermissionObservation();
```

`not-observable` is kept distinct from `allowed` and `denied`. PocketStation
does not infer permission from a generic capture failure. The host application
remains responsible for explaining and requesting operating-system permission.

## Observe source failure

The Session reports lifecycle and failure events separately from audio:

```ts
for await (const event of running.events) {
  if (event.type === "source-failure") {
    console.error(event.failure.stableId, event.failure.operation);
  }
}
```

When an application or device disappears, the event keeps its Source and Stem
identity and states whether rediscovery and a new Session are required. It does
not silently switch to another application or microphone.

## Stop or cancel

`stop()` finishes accepted work and returns the Session outcome. `cancel()` asks
the engine to stop without draining pending work. Both operations are
idempotent through the JavaScript `RunningSession` object.

```ts
const outcome = await running.stop();

if (!outcome.success) {
  console.error(outcome);
}
```

Breaking an audio loop releases that reader; it does not stop the Session.
Pass an `AbortSignal` when the reader needs its own cancellation:

```ts
for await (const frame of running.audio.frames({ signal })) {
  consume(frame);
}
```

## Current API status

The [capability status](docs/JAVASCRIPT_CAPABILITY_MATRIX.md) records what works
today and what remains. The [SDK design](docs/JAVASCRIPT_SDK_DESIGN.md) explains
native ownership, frame copying, cancellation, and browser separation.

Browser Relay receiving is exposed from `pocketstation/browser`. It is kept
separate so browser builds never try to load a native addon. Its current tests
use a simulated service and are not evidence of a deployed Relay session.

## Develop from source

Node 20.17 or newer and the Rust toolchain are required while the npm package is
still in development.

```bash
npm install
npm run typecheck
npm test
npm run native:check
```

After the build, run the application-capture example and enter the name of a
running application when prompted:

```bash
npm run example:capture
```

Add `-- --microphone` only when you also want the default microphone.

The repository uses the released `pocketstation` Rust crate in normal builds.
Local source overrides are used only for an explicitly recorded Core
qualification and are removed before packaging.

## License

MIT
