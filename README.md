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
> Windows and Linux packages, Relay publication, and the remaining Rust/Python
> features still require implementation or target-specific proof.

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

Operators and custom Endpoints use open identifiers and named ports. They may
be implemented in JavaScript, a trusted native extension, or a managed process.
Core validates the complete Session before capture starts and reports the exact
Operator, node, or port when compilation fails. The JavaScript package does not
compile a second execution plan.

Read [Route, process, and record media](docs/guides/compose-a-session.md) for
named ports, generated audio, compiler diagnostics, and delivery settings.

## Send audio to application code

Use a Connector for a socket, encoder, provider client, or another destination
that consumes source-aware PCM:

```ts
import { connector } from "pocketstation/node";

const destination = connector((frame) => {
  console.log(frame.sourceId, frame.sequenceNumber, frame.samples);
});

application.sendTo(destination);
```

The class form adds `start()`, `send()`, and `stop()` for destinations that own
resources. Sending application and microphone Stems to the same Connector uses
one instance and preserves both Source identities.

Read [Add JavaScript Sources, Operators, and destinations](docs/guides/provider-authoring.md)
for the class form, typed Sources, Operators, and multi-input Endpoints.

## Read an Operator result

Subscribe to a named output before starting the Session, then read it from the
running Session. Operators can come from application code, an installed
provider package, a native extension, or a managed process:

```ts
import {
  PortSpec,
  Session,
  SignalSpec,
  Source,
  defineOperator,
} from "pocketstation/node";

const audio = SignalSpec.audio();
const text = SignalSpec.text();
const levelMeter = defineOperator({
  id: "com.example.operator.level-meter.v1",
  inputs: [PortSpec.input("audio", audio)],
  outputs: [PortSpec.output("level", text)],
  create: () => ({
    process(value) {
      if (value.payload.kind !== "audio") return [];
      const peak = value.payload.samples.reduce(
        (current, sample) => Math.max(current, Math.abs(sample)),
        0,
      );
      return [{ output: "level", data: peak.toFixed(3) }];
    },
  }),
});

const session = new Session();
const application = session.capture(Source.application("Zoom"));
const meter = session.operator(levelMeter);
application.connect(meter.input("audio"));

const subscription = session.subscribe(meter.output("level"), { signal: text });

await using running = await session.start();
for await (const value of running.signals(subscription)) {
  if (value.payload.kind === "text") {
    console.log(value.payload.text);
  }
}
```

Each value includes the source and stream identity retained from its input.
Derived values also identify the Operator that produced them. A
subscription has one reader, can be closed without stopping the Session, and
reports its current queue depth and delivery totals through `metrics()`.

Read [Consume Operator output](docs/guides/signal-streams.md) for timeout,
end-of-stream, cancellation, queue, and payload behavior.

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

## Add compiled or process-isolated implementations

Load a trusted native extension when a Source, Operator, or Endpoint is shipped
as a PocketStation ABI library:

```ts
const session = new Session();
await session.loadNativeExtensionLibrary("/opt/acme/libacme_audio.dylib");

const source = session.source("com.acme.source.audio.v1");
source.output("audio").send(session.audio());
```

Use a `SidecarProcess` when an implementation runs in another language or
needs process isolation. Core starts it without a shell, completes the PKSS
handshake, applies explicit message sizes and deadlines, and reaps it during
Session shutdown.

Read [Run compiled extensions and managed processes](docs/guides/extensions-and-sidecars.md)
for security, configuration, queue saturation, finite reads, process state,
and cleanup.

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

Inspect current delivery and timing without consuming the audio stream:

```ts
const metrics = await running.metrics();

for (const route of metrics.routes) {
  console.log(route.routeId, route.delivery.framesDroppedTotal);
}
```

All counters, identities, and nanosecond values are `bigint`. The final result
retains the last metrics, the complete terminal event, and recording or trace
results when those features were enabled.

Read [Understand a running Session](docs/guides/observe-a-session.md) for queue
depth, latency percentiles, retained failures, multistem results, and trace
validation.

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

Enable a checksummed lifecycle trace when a reproducible shutdown record is
needed:

```ts
import { SessionTrace } from "pocketstation/node";

const session = new Session({ trace: { path: "./meeting.pkstrace" } });
// Declare Sources and destinations, then start and stop the Session.

const trace = SessionTrace.read("./meeting.pkstrace");
console.log(trace.validate());
```

Breaking an audio loop releases that reader; it does not stop the Session.
Pass an `AbortSignal` when the reader needs its own cancellation:

```ts
for await (const frame of running.audio.frames({ signal })) {
  consume(frame);
}
```

Direct reads distinguish a wait that expired from a stream that ended:

```ts
import { END_OF_STREAM } from "pocketstation/node";

const value = await running.audio.read({ timeoutMs: 100 });

if (value === undefined) {
  // No frame arrived within 100 ms.
} else if (value === END_OF_STREAM) {
  // The Session ended and no received frames remain.
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
