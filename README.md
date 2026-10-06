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
> The current code has a real macOS selected-application capture proof.
> The installed macOS package also has same-host Relay receipt evidence in
> Chromium, Firefox, and WebKit. Windows and Linux packages, WAN/TURN behavior,
> and the remaining Rust/Python features still require their own proof.

## Package installation and module modes

The root `pocketstation` archive contains JavaScript and declarations. Its exact
versioned optional native dependency supplies the Node-API addon for macOS or
Windows on arm64/x64, or glibc Linux on arm64/x64. These six package definitions
are distribution targets; each release must separately qualify its advertised
binaries. Musl Linux is unsupported and fails with `package.unsupported_target`.

Install with optional dependencies enabled. `package.native_missing` names the
missing platform package and an explicit install command; a mismatched native
version fails with `package.version_mismatch`. There is no install script,
checkout-relative binary fallback, or download at runtime.

All six public entry points support Node ESM and CommonJS. In one Node process,
`import` and `require` share classes, errors and singleton values. The root,
browser, control and voice ESM builds remain available to browser tooling;
`pocketstation/node` and `pocketstation/demo` require Node. Browser code does not
load a native addon. Optional example transport `ws` remains separately installed.


## Capture an application

Choose the running application by its exact display name or application ID:

```ts
import { capture } from "pocketstation/node";

const audio = await capture("Spotify");
```

Read source-aware PCM frames. Leaving the loop finishes this concise Capture:

```ts
for await (const frame of audio) {
  console.log(frame.sourceId, frame.timestampStartNs, frame.samples);
}
```

`frame.samples` is interleaved `Float32Array` PCM. IDs, sequence numbers, and
nanosecond timestamps are `bigint`, so JavaScript does not round native 64-bit
values.

## Add a microphone

PocketStation never opens a microphone unless your code asks for one:

```ts
const audio = await capture("Zoom", { microphone: true });
```

Application and microphone frames share the iterator but keep different
`sourceId` and `stemId` values. A slow reader can therefore be diagnosed without
guessing which source produced a frame.

The concise object exposes `audio.session`, `audio.application`, and the optional
`audio.microphone` Stem. Advanced routing therefore extends the same Session;
there is no smaller second engine behind `capture()`.

To capture all desktop output instead of one application, declare it explicitly:

```ts
import { Session, Source } from "pocketstation/node";

const session = new Session();
const desktop = session.capture(Source.systemAudio());
desktop.send(session.audio());
```

## Own Session lifecycle from JavaScript

Use the separate, browser-safe control entry point when trusted application
code owns Session creation and receiver authorization. It uses web-standard
`fetch`; importing it does not load the native addon or the browser WebRTC
client:

```ts
import { ControlClient } from "pocketstation/control";

using control = new ControlClient("https://control.example");
const credentials = await control.createSession({
  requiredBuses: ["application", "microphone"],
});

const snapshot = await control.session(
  credentials.sessionId,
  credentials.sourceToken,
);
```

Every operation has a finite deadline and accepts an `AbortSignal`. Responses
are size-bounded and strictly decoded. `SecretToken` redacts normal string and
JSON conversion; `exposeSecret()` is the deliberate transport boundary.
Creating subscriber credentials and invitations requires the source-owner
token, so those operations belong in trusted application or server code—not an
untrusted phone or public browser bundle.

See [Control Session lifecycle](docs/reference/control-plane.md) for the full
create, inspect, subscribe, invite, delete, cancellation, and error contract.

## Define provider-neutral voice components

Import immutable voice values and provider lifecycle interfaces without loading
the Node native addon or browser WebRTC code:

```ts
import {
  ConversationConfig,
  ResponseCapabilities,
  TranscriptUpdate,
  TranscriptionCapabilities,
  VoiceCapabilities,
} from "pocketstation/voice";

const capabilities = new VoiceCapabilities({
  transcription: new TranscriptionCapabilities({ streaming: true }),
  response: new ResponseCapabilities({
    streaming: true,
    cancellation: true,
  }),
});

const config = new ConversationConfig();
const finalTranscript = new TranscriptUpdate({
  utteranceId: "speech-1",
  revision: 1,
  text: "ship the answer",
  stablePrefix: "ship the answer",
  final: true,
});
```

`pocketstation/voice` covers the provider-neutral capability, configuration,
transcript, turn, response, synthesis, speech-activity, duplex, event, failure,
and bounded conversation orchestration available in Python. Every retained
collection is copied and frozen, and every count or deadline has a finite
limit. Providers receive `AbortSignal` cancellation, while selected generated
output is cancelled without stopping capture or the owning Session.

After declaring a transcript `BusSubscription` and an `AudioInput`, compose the
workflow on the same Session:

```ts
const conversation = session.conversation({
  transcripts,
  output: assistantAudio,
  respond: async (update, context, signal) => answer(update, context, signal),
  synthesize: (chunk, turn, signal) => speech(chunk, turn, signal),
});

await using running = await session.start();
const outcome = await conversation.run(running);
```

Separate STT/response/synthesis/VAD providers and one stateful duplex provider
use the same finite lifecycle through `Conversation.fromComponents()` and
`Conversation.fromDuplex()`. The SDK does not bundle a model or provider.

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

## Publish independent Stems to Relay

Use `RelaySession` to own the remote Session and its renewable owner credential.
The service URL can point to standalone Relay or its managed control-plane
mount; both expose the same Session API. One publisher carries the named
AudioBuses while Core keeps application and microphone Stems independent:

```ts
import { RelaySession, Session, Source } from "pocketstation/node";

await using remote = await RelaySession.create({
  controlPlaneUrl: "https://service.example",
  requiredBuses: ["application", "microphone"],
});
const session = new Session();
const application = session.capture(Source.application("Zoom"));
const microphone = session.capture(Source.microphone());
const publisher = remote.publisher(session);
application.publish(publisher, "application");
microphone.publish(publisher, "microphone");

await using live = await session.start();
await remote.waitForPublisher();
const invitation = await remote.createReceiverInvitation({ busId: "application" });
// Deliberate credential disclosure: deliver only to the intended receiver.
const receiverUrl = invitation.exposeShareUrl();
// Keep this scope open while your application uses the live Session.
```

Create a separate invitation for the microphone bus when needed. Readable words
navigate to the Session; the URL's fragment carries the existing join credential.
Normal invitation formatting redacts that credential. `session.relay()` remains
available when the caller already owns the connection and credential lifecycle.

The Node addon uses the released Rust Relay Connector for Opus, RTP, WebRTC,
and signaling. JavaScript does not encode audio or maintain another media
queue. Relay startup completes before `session.start()` returns, uses a finite
deadline, and closes with the Session.

The microphone remains opt-in. A selected application can be the only
published source when that is all the receiver needs. See the
[runnable Relay example](examples/publish-to-relay.ts) for configuration.

## Publish caller-owned browser audio

The browser-only entry can publish one live `MediaStream` audio track to one
capability-scoped `AudioBus`. Your application obtains microphone permission
and retains track ownership:

```ts
import { RelayPublisher } from "pocketstation/browser";

const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const publisher = new RelayPublisher({
  signalUrl,
  sessionId,
  busId: "user-microphone",
  publisherToken,
  iceServers,
});

await publisher.publish(stream);
```

`publish()` resolves only after browser WebRTC statistics contain an outbound
audio packet. This proves media delivery started; it does not prove speech or
non-silence. `disconnect()` closes PocketStation resources but deliberately
does not stop the caller-owned track. Mint `publisherToken` with
`ControlClient.issuePublisherCredentials()`; never hand the Session-owner token
to browser media code. Keep bearer credentials out of URLs and browser storage.
See [Publish and receive Relay audio in a browser](docs/reference/browser-relay.md).

## Send audio to application code

Use a Connector for a socket, encoder, provider client, or another destination
that consumes source-aware PCM:

```ts
import { Capture, connector } from "pocketstation/node";

const destination = connector((frame) => {
  console.log(frame.sourceId, frame.sequenceNumber, frame.samples);
});

const declaration = new Capture({ application: "Zoom", streamAudio: false });
declaration.application.sendTo(destination);
await using live = await declaration.start();
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
import { Session } from "pocketstation/node";

const session = new Session({ frameDurationMs: 10 });
const input = session.audioInput("agent audio");
input.output.send(session.audio());

await session.run(async () => {
  await input.write(samples);
  input.close();
});
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
capacity, discontinuity, selected-output cancellation, and shutdown behavior.

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

Read [platform support](docs/operations/platform-support.md) for supported
environments and limitations, and [Session lifecycle](docs/concepts/session-lifecycle.md)
for native ownership, cancellation and shutdown.

Browser Relay receiving is exposed from `pocketstation/browser`. It stays
separate so browser builds never load a native addon:

```ts
import { RelayReceiver } from "pocketstation/browser";

const receiver = new RelayReceiver({ locator: joinCode }, { controlPlaneUrl: controlUrl });
audio.srcObject = await receiver.connect();
```

Read [Receive Relay audio in a browser](docs/reference/browser-relay.md) for
direct subscriber access, lifecycle handling, receiver observations, and the
current proof level.

## Develop from source

Node 20.17 or newer and the Rust toolchain are required while the npm package is
still in development.

```bash
npm install
npm run typecheck
npm test
npm run native:check
```

For source development, `npm run build:native` builds and stages the local
platform package under `npm/` and installs a copy in this checkout's
`node_modules`. `npm run build:typescript` builds both module forms without
loading native code. Packed-consumer gates install the root and real local
native tarballs into a separate temporary project.

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

Readable Relay names may use short natural words such as `owl-sun`, `rice-river`,
`silly-mountain` or `lemon-corpus`. They are navigation, not credentials: pass
the complete generated share URL. Clients accept the retained legacy compound
syntax without duplicating Relay's vocabulary or exposing a grammar prefix.

Readable receiver names follow Relay's configured allocation policy by default.
Pass integer `wordCount: 2` through `wordCount: 15` to `createInvitation` or
`createReceiverInvitation` only when a fixed length is needed. Deprecated
`visibility` still selects formatting; it cannot be combined with `wordCount`
and never changes authorization. Names do not carry authority: both formats
require the same opaque join credential, and links remain redacted by default.

Invitation and preview results expose the actual `wordCount`. Explicit response
counts must match the name; old responses without a count remain accepted only
for their original two/three-word formats. All readable locators have at most
134 ASCII bytes, 2–15 words and 3–24 letters per word (the latter preserves old
compound names). Vocabulary and phrase generation remain owned by Relay.
