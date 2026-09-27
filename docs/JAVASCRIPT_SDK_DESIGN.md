# JavaScript SDK design

PocketStation for JavaScript has two separate exports:

- Node captures and processes desktop audio through the native Rust engine.
- Browsers receive one authorized Relay AudioBus as a WebRTC audio track. This
  export is qualified separately from native Node capture.

Browser code never loads the native addon. Node code never starts a Relay or
opens a microphone unless the application asks for it.

## Relay publishing and receiving

Node publishes named audio buses through one native Relay connection:

```ts
const relay = session.relay({ url, sessionId, sourceToken });

application.publish(relay, "application");
microphone.publish(relay, "microphone");
```

Each Source keeps its identity and independent delivery state. Reusing one
`RelayPublisher` shares the provider lifecycle without combining the buses.

The browser uses a separate export because it receives WebRTC audio and does
not need the native addon:

```ts
const receiver = new RelayReceiver({ locator: joinCode }, { controlPlaneUrl: controlUrl });
audio.srcObject = await receiver.connect();
```

Invitation redemption supplies subscriber access for one named bus. Direct
subscriber credentials are also accepted. Startup and shutdown have finite
deadlines, signaling errors stay observable after `connect()` returns, and
receiver statistics leave unsupported values unavailable.

## Node lifecycle

A `Session` is a declaration. Calling `Session.capture()` adds one Source and
returns a `Stem`. Calling `send()` routes that Stem to an Endpoint. `start()`
validates the complete declaration, opens native resources, and returns a
`RunningSession`.

The first supported Endpoint is the Session audio stream:

```ts
const output = session.audio();
const application = session.capture(Source.application("Spotify"));
application.send(output);
```

Several Sources can send to the same output. Frames retain the identity of the
Source and Stem that produced them.

## Application-owned PCM

`session.audioInput(name)` declares a Source for PCM already produced by the
application. Core creates its Source and stream identities, preallocates its
frame storage, and assigns sequence numbers, media timestamps, and
discontinuity epochs to accepted writes.

`tryWrite()` borrows a `Float32Array` or float32-LE `Buffer` only for the native
call and copies the samples into Core-owned storage before returning. It never
retains mutable JavaScript memory. `write()` adds a finite wait for that same
native capacity; it does not add another media queue.

An input is closed independently from its Session. Closing it rejects new
writes while previously accepted frames continue through normal shutdown. An
`AbortSignal` stops only a pending `write()` call.

## Processing and destinations

`SignalSpec`, `MediaCaps`, and `PortSpec` preserve the runtime identifiers used
by Core and the Python SDK. `RouteSettings` keeps accepted media separate from
delivery behavior. JavaScript construction, compatibility, negotiation, and
Session compilation call the native engine; TypeScript does not implement its
own graph compiler.

An `Operator` names an implementation registered with the Session. Its
`OperatorInstance` selects named inputs and outputs. An `EndpointDefinition`
does the same for a destination. These identifiers remain open so adding a
provider does not require a PocketStation release.

Application code can register typed Sources, Operators, Connectors, and
Endpoints. Each registration delegates execution to the corresponding Core
lifecycle. JavaScript implements only provider behavior:

- `SourceFactory` produces text, events, metrics, control data, or bytes.
- `OperatorFactory` processes named inputs and emits named outputs.
- `Connector` receives source-aware PCM through one configured destination.
- `EndpointFactory` receives named PCM or typed-signal inputs.

Core continues to assign identity, compile routes, retain queue and delivery
state, start every component transactionally, distinguish drain from abort,
and join finalization. Provider calls use a native dispatch queue with a fixed
capacity of 16 and a configurable deadline from 1 through 60,000 ms. Promise
rejections and thrown exceptions return through the Session outcome instead of
escaping a native worker.

`session.subscribe()` declares an Operator or Source output for JavaScript.
Core owns the signal queue and preserves the signal description, timing,
source identity, and Operator derivation. JavaScript receives a copied audio,
text, or byte payload only when the application reads it. Closing one
`SignalStream` does not stop capture or another subscription.

Recording is a native Endpoint declared with `stem.record(name)`. Generated PCM
returns through `reenterAudio()` as a normal Stem with Core-assigned identity
and lineage. JavaScript does not open recording files or copy generated audio
through a callback loop.

## Discovery and selection

`discoverSources()` reads one native snapshot and may filter it by application,
kind, stable key, or active playback. JavaScript does not rebuild or hash source
identity. Core supplies the stable key and immutable 64-bit Source identity.

`Source.application()` accepts an exact name or application ID, a process ID,
a discovered stable identity, or a process-instance selection. Name and
application-ID matching rejects missing and ambiguous results before capture
starts; it never selects the first partial match. `Source.fromDiscovered()`
chooses the strongest supported selector for a discovery result.

Permission inspection is non-prompting. `not-observable` means the operating
system did not provide an authoritative answer. It is never converted to
`allowed`, even if a later open succeeds.

## Native ownership

One Rust worker owns each running Core Session. JavaScript sends finite read,
state, stop, and cancel requests to that worker. Waiting for audio and joining
the Session happen outside the JavaScript event loop.

Core owns the media queues. The SDK does not add a second audio queue. A native
audio batch is copied into JavaScript-owned memory when it is read, after it has
left the realtime part of the engine.

## Extensions and managed processes

`loadNativeExtensionLibrary()` delegates absolute-name resolution, ABI
validation, transactional registration, executable lifetime, and callback
cleanup to Core. JavaScript receives an immutable receipt and can declare a
registered Source with `session.source()`. It never calls an extension function
pointer directly.

`registerSidecar()` delegates process creation, pipe ownership, PKSS framing,
the four-message control queue, configured data queues, readiness, shutdown,
kill, wait, and reap to Core. The Node addon copies each `Buffer` before the
request returns to JavaScript. `send()` attempts one enqueue and reports a full
data queue immediately.

All sidecar operations use the existing Session worker. A message read waits no
more than 1,000 ms per native call, and `AbortSignal` is checked between waits
of no more than 20 ms. `stop()` and `cancel()` return final process state and
queue counters as `sidecarOutcomes`.

## Stream ownership

`running.audio` permits one active reader across direct `read()` calls and async
iteration. A second reader fails immediately because silently dividing frames
between consumers would make delivery and shutdown ambiguous.

The normal API is an async iterator. Breaking the loop releases the reader; it
does not stop the Session. `AbortSignal` is checked between native waits of no
more than 20 ms. If an audio frame arrives while the signal is being aborted,
the SDK retains that frame for the next reader instead of discarding it. The
caller decides whether to stop or cancel the Session.

A direct read returns `undefined` when its wait expires and `END_OF_STREAM`
when the Session or subscription has ended. Async iteration requires a positive
wait so an empty stream cannot spin on the JavaScript event loop.

## Exact values

JavaScript `number` cannot represent every Rust `u64`. Source, Stem, Stream,
route, Session, sequence, epoch, and nanosecond fields are therefore public
`bigint` values. The native addon transfers them as decimal strings and the
TypeScript layer performs the exact conversion outside the media thread.

## Session observations

Core maintains queue, delivery, timing, provider, recording, and shutdown
state. `running.metrics()` asks the native Session worker for one snapshot and
converts it into immutable TypeScript values. The SDK verifies that every
reported collection count matches the collection it received.

Events use closed discriminated unions. Terminal events carry the complete
retained Source, Endpoint, rollback, and finalization failures in addition to
their totals. Unknown states and stages are rejected, which prevents a newer
native addon from being misread by an older TypeScript package.

`stop()` and `cancel()` return the final metrics, terminal event, multistem
recording result, trace result, and sidecar results that Core can provide. A
missing observation stays absent and carries a reason where Core supplies one.
The SDK never turns “not available” into a successful zero value.

Session traces are written by Core on a dedicated worker. JavaScript sets the
file and queue capacity before startup, then uses `SessionTrace.read()` to
verify the artifact checksum and `validate()` to check record order, Session
identity, timestamp order, lifecycle transitions, and terminal state.

## Failure behavior

Errors retain a stable PocketStation code and explain the failed operation.
Starting twice fails. A Source or Endpoint from another Session cannot be used.
An invalid selector fails before native resources start. A stopped Session ends
the iterator and makes later reads fail clearly.

`running.events` is the sole JavaScript reader for Core Session events. It
includes lifecycle changes, source disappearance, Endpoint failures, rollback,
finalization, and the terminal result. Source failures retain the platform,
stable key, Source identity, Stem identity, generation, native operation, and
recovery requirement. This avoids a separate source-only reader consuming and
hiding events needed by the rest of the application.

Dropping a running JavaScript object requests native shutdown without blocking
garbage collection. Applications that need recording or delivery outcomes must
call `stop()` or `cancel()` explicitly and await the result.

## Current platform evidence

The clean tarball consumer loads the native addon and exercises Session,
Source, Stem, signals, media requirements, route settings, and native compiler
diagnostics on macOS ARM64. It also validates the linked Extension ABI and
starts, exchanges a message with, closes, and reaps a real PKSS child process.
Repository tests compile and execute a real Rust dynamic-library Source. These
are component results, not provider or device results. A physical `afplay`
source also delivered twenty consecutive 10 ms stereo frames with source and
Stem identity and a clean stop.

A local system-audio Session also captured non-silent media into a complete
multistem recording with no runtime, lineage, delivery, or finalization
failures. That is one-machine macOS evidence, not cross-platform recording or
latency qualification.

That physical test uses the corrected CoreAudio implementation in the current
Core source. The normal Cargo manifest uses released Core `1.1.10`, so
publication waits for an approved Core `1.1.x` release containing the fix. No
Windows, Linux, microphone, system-audio, Relay, or performance claim follows
from the macOS result.

## Later work

Relay publication and same-host receipt now pass in Chromium, Firefox, and
WebKit for independent application and physical-microphone AudioBuses. Remaining
work includes voice composition, target-specific packages, WAN/TURN evidence,
and cross-platform execution evidence.
Those modules are added only with working behavior and tests; empty parity
files are not created.
