# JavaScript SDK progress

## W21 JavaScript performance and resource qualification

The active task measures the JavaScript work required to consume media that
Core already captured and routed. Each frame now records when the Node main
thread completes its native read, so Core route time and Node delivery time can
be reported separately.

The first concurrency check found a native integration problem that single-
Session tests could not expose. Each pending audio read used Node's shared
worker pool while it waited for Core. Twelve simultaneous Sessions exhausted
that pool in groups of four and delayed an unrelated file read by about 74 ms.
The public Promise API was not the cause; the native work behind each Promise
was blocking the wrong threads.

Session startup, audio reads, events, signals, observations, sidecar calls, and
shutdown now await a one-shot response from the Session worker. Signal waits
use an asynchronous timer, and joining a finished Session runs outside Node's
shared worker pool. The same twelve-Session test now resolves all audio reads
together and leaves unrelated Node work responsive. With
`UV_THREADPOOL_SIZE=4`, the accepted run measured:

- startup completion spread: 0.134 ms; unrelated file read: 0.343 ms;
- audio-read completion spread: 0.604 ms; unrelated file read: 0.090 ms;
- cancellation completion spread: 5.361 ms; unrelated file read: 0.137 ms.

This check uses twelve application-owned PCM Sessions and idle 20 ms reads. It
proves that waiting Sessions do not consume Node's shared worker pool. It does
not establish a twelve-device capture limit, physical-device latency, or Relay
capacity. The physical measurement also records which Source ID belongs to the
selected application and which belongs to the microphone, so their capture age
cannot be confused in the result.

Fresh Node processes pass the declared component thresholds at both supported
media profiles. The 10 ms case delivers 100 frames per second and the 20 ms
case delivers 50 frames per second with no route loss, discontinuity, retained
process resource, or unsuccessful shutdown. The complete TypeScript, Jest,
native Rust, API-report, package-export, and packed-consumer gates pass.

The first physical run found that the deployed Core `1.1.10` still forwards
the 32-frame remainder of a 512-frame CoreAudio callback after each complete
480-frame voice frame. The performance tool now records the sample count and
duration of every frame and rejects any frame that does not match the selected
10 ms or 20 ms profile. A diagnostic build against local Core commit `720c050`
confirms the existing Core correction: application and microphone Sources both
deliver only 480-sample frames at approximately 100 frames per second with no
delivery loss. The application Source still measures 34–45 ms from its first
sample timestamp to route receipt in the 10 ms run, so the physical latency
gate remains open. Node delivery is not the cause; its measured p95 was
0.099 ms in the same run.

The measurement record now identifies the Core package Cargo actually built
into the native addon. It records the package version and registry source for a
release build, or the exact Core commit for a workspace diagnostic. A nearby
Core checkout can no longer be mistaken for the code inside a crates.io build.

A later diagnostic against Core `ce96e08` confirms correct frame sizes for both
profiles: 480 samples at 10 ms and 960 samples at 20 ms. The 20 ms application
and microphone run completed without loss or runtime failure. Its selected-app
source age remained in the 67.108864 ms p95 histogram bucket, above the declared
45 ms gate. The 10 ms run also encountered one physical microphone stream error;
that result remains failed and requires a clean rerun rather than being ignored.

The performance gate now calculates exact source-to-route percentiles from each
frame's source timestamp and Core route-receipt timestamp. Core's compact
power-of-two histogram remains in the artifact for runtime observation, but it
is no longer used to judge a millisecond threshold that falls inside one broad
histogram bucket.

The component run uses application-owned PCM. It does not establish physical
capture latency, browser playout, WAN or TURN behavior, provider performance,
acoustic hearing, or Windows and Linux package performance. The physical
selected-application and microphone measurements remain the next acceptance
step.

## W21 JavaScript notebook proof

The notebook and real-path tasks are complete. Deno 2.9.6 is the qualified
kernel/runtime for this proof. Its first-party Jupyter kernel executed the
packed PocketStation package with the native-code permission required by the
Node-API addon.

The accepted artifact captures a controlled desktop application and an
explicitly selected physical microphone as independent Stems. The same Session
sends both to an application Connector, publishes named Relay AudioBuses, and
records separate WAV files while Chromium, Firefox, and WebKit receive them.

The first complete run passed capture, Relay, every browser, and both
recordings, then failed the zero-loss gate because the Deno kernel paused the
JavaScript Connector for about 177 ms. Connector routes previously always used
Core's eight-frame default. `ConnectorOptions.capacityFrames` now selects a
finite per-Source queue from 1 through 63 frames; a full queue rejects the
arriving frame and records the discontinuity. The notebook selects 32 frames
for its observation-only Connector and leaves Relay and recording settings
unchanged.

## W21 JavaScript Relay and browser workflow

The Node publisher slice now uses the released `pocketstation-relay 0.1.5`
crate directly from crates.io. `Session.relay()` creates one Session-owned
publisher and `relay.audio(name)` declares a destination for each selected
AudioBus. Several Stems therefore share one connector lifecycle while Core
retains their source, Stem, route, and bus identities.

The public JavaScript API does not expose the connector manifest or construct a
second WebRTC publisher. Relay values are validated before startup, source
credentials stay in Core's secret-aware configuration, and the current
publisher rejects unsupported TURN credentials explicitly. Unit tests cover
shared publication, distinct bus destinations, input validation, and the
unsupported TURN case. The complete SDK suite, strict TypeScript, API report,
documentation, examples, package exports, and a clean tarball consumer pass.

The installed package now passes the same-host Relay workflow with a controlled
macOS application process and a physical microphone. Chromium, Firefox, and
WebKit each receive both named buses, reconnect both receivers, cancel an
in-flight connection, and close signaling cleanly. Core reports no active
capture error, route loss, discontinuity, or recording loss. Both independent
WAV stems finalize successfully.

This is `REAL-DEVICE-PROVEN` for the named same-host workflow at the 20 ms media
profile. It does not prove WAN or TURN behavior, physical loudspeaker output,
Windows or Linux packages, or the loaded 10 ms voice profile.

## W21 JavaScript API and developer experience

`W21-JAVASCRIPT-API-PARITY-DEVELOPER-EXPERIENCE` is complete in the current
source candidate and ready for its final execution-state check.

The normal application-capture workflow is now:

```ts
const audio = await capture("Spotify");

for await (const frame of audio) {
  consume(frame);
}
```

This calls the same Core-backed `Session` used by the explicit API. Microphone
capture and recording remain opt-in. Leaving the iterator finishes the Session;
an aborted iterator cancels it. Applications that add their own Sources,
Operators, Connectors, or Endpoints can use `Session.run()` for scoped startup
and shutdown or retain `start()`, `stop()`, and `cancel()` for direct control.

Application-owned PCM now supports selected-output cancellation. Each output
has an identity assigned by Core. Starting a newer output deactivates the older
one, and cancelling one output discards its later writes without closing its
`AudioInput`, stopping capture, or stopping the Session. Tests verify the
discard through Core route metrics and reject cross-input output identities.

The public documentation now starts with concise capture, then introduces
Sources and permissions, Session lifecycle, source identity and timing,
application-owned PCM, provider authoring, observations, platform support, and
troubleshooting. Copied maintainer architecture, ADR, and standards files were
removed from public SDK documentation. Documentation links and code blocks have
an automated check, and the runnable examples execute through Core.

The npm tarball includes generated JavaScript, declarations, source maps,
matching TypeScript source, the native addon for the current target, README,
and license. It excludes tests, execution records, and copied maintainer files.
Package exports and a clean tarball installation pass.

Current evidence is component and installed-package evidence on macOS arm64.
It does not establish npm publication, Windows or Linux packages, a deployed
Relay, a real browser session, a provider call, WAN behavior, or voice parity.
The browser Relay export remains `PARTIAL` with mocked network tests and was not
implemented by this task.

## Completed work

`W21-JAVASCRIPT-APPLICATION-AUDIO-INGRESS` is complete under the recorded
`phase-exception-approved` decision.

`W21-JAVASCRIPT-STREAM-PROTOCOLS` is complete in the current source candidate.
Its acceptance artifact and commit are recorded before the task is closed.

`W21-JAVASCRIPT-EXTENSIONS-SIDECARS` is complete in commit
`4ca0350e550d8007646821fc30bf5f6d942d25e7`.

`W21-JAVASCRIPT-PROVIDER-AUTHORING` is complete in the current source
candidate. Connector, typed Source, off-realtime Operator, and advanced
Endpoint tests pass. The package exports and a clean installation from the
packed tarball also pass. Exact commits and file hashes are recorded in the
task evidence.

The repository now contains a browser Relay client and the first working Node
binding for native capture. It must not yet be described as feature-equivalent
to the Rust or Python packages.

This step added application-owned PCM through `Float32Array` and explicit
float32-LE `Buffer` writes. Core remains the owner of capacity, source and
stream identity, sequence, media time, discontinuities, routing, and shutdown.

The current Node slice is:

```text
Source declaration
→ Rust Session
→ source-aware Stem or registered Operator
→ named routes and native Endpoints
→ recording, generated audio, or Node audio
→ native Session worker
→ JavaScript async iterator
```

The Rust engine continues to own capture, routing, queue limits, timestamps,
and shutdown. The JavaScript layer owns type-safe composition, async iteration,
`AbortSignal`, and actionable errors. It does not run JavaScript on an audio
callback and does not implement another media engine.

## Capability status

- Browser Relay client: `REAL-DEVICE-PROVEN` for same-host receipt of independent
  application and physical-microphone buses in Chromium, Firefox, and WebKit.
  Invitation authorization, reconnection, connection cancellation, receiver
  statistics, signaling shutdown, and source isolation pass. WAN, TURN, and
  acoustic output remain unproven.
- Node native capture: `PARTIAL`; a clean macOS ARM64 tarball consumer loads the
  addon, and physical selected-application capture delivered twenty consecutive
  10 ms stereo frames with source and Stem identity.
- Full Rust/Python API coverage: not complete. The current row-by-row status is
  recorded in `docs/JAVASCRIPT_CAPABILITY_MATRIX.md`.
- Source lifecycle: `PARTIAL`; all built-in selectors and local macOS
  discovery, permission inspection, lifecycle transitions, and Session events
  pass. Windows and Linux target execution remain later gates.
- Graph declarations: `REAL` for the current component scope; native validation,
  negotiation, route settings, named-port composition, recording declarations,
  generated-audio lowering, compiler diagnostics, and application-owned
  provider implementations pass.
- Stream consumption: `REAL` for the current component scope. Audio and typed
  signal reads have one reader, finite waits, `AbortSignal`, separate timeout
  and end results, early iterator release, independent subscription close, and
  retained final audio. Typed PCM, text, and bytes retain timing, lineage, and
  Operator derivation. Queue depth and delivery totals come from Core.
- Recording: `PARTIAL`; a real local macOS system-audio Session captured five
  non-silent frames and finalized a 917,572-byte WAV with no recorded gaps or
  Session failures. Per-Stem outcome projection remains later observation work.
- Application-owned PCM: `REAL` for the current component scope;
  `Float32Array` and float32-LE `Buffer` inputs copy into Core-owned storage,
  fixed capacity and typed failures are visible, `write()` has a finite timeout
  and `AbortSignal`, and accepted frames preserve native identity and timing.
- Native extensions: `REAL` for the current component scope. The linked ABI
  version and descriptors are validated by Core; trusted libraries load only
  from absolute names; registration is transactional; a real Rust dynamic
  library registers and executes a Source; Core retains executable code for the
  Session lifetime.
- Managed processes: `REAL` for the current component scope. A real PKSS child
  completes startup, exchanges copied `Buffer` messages, reports saturation at
  the configured queue capacity, exposes process and queue counters, and is
  closed or cancelled and reaped. A child that ignores shutdown is killed after
  the configured deadline and still reaped.
- Connector authoring: `REAL` for the current component scope. Class and
  function forms receive source-aware PCM. Several routes may share one
  configured Connector and one start/stop lifecycle. Provider calls have finite
  dispatch capacity and deadlines, and cancellation reaches `AbortSignal`.
- Source authoring: `REAL` for typed non-PCM values in the current component
  scope. Core assigns Source and stream identity, sequence, timing, and
  lifecycle. Preparation failure closes the JavaScript instance. PCM produced
  by JavaScript uses the existing `AudioInput` API.
- Operator authoring: `REAL` for off-realtime JavaScript in the current
  component scope. Named inputs and outputs, configuration validation,
  lifecycle, typed payloads, lineage, derivation, and exact PCM reentry execute
  through Core.
- Endpoint authoring: `REAL` for the current component scope. Factory and
  receive-function forms accept named PCM or typed-signal inputs. Core retains
  grouping, transactional preparation, drain/abort, observations, and final
  outcomes; JavaScript preparation failures clean up their instance.
- npm package: not published.

The browser entry uses `RelayReceiver`, shares `PocketStationError` with the
Node entry, resolves one-time invitations, and never supplies a hardcoded ICE
server when the control service does not return one. Signaling, ICE, connection,
observation, and shutdown waits have finite limits. The old unpublished
`RoomClient` and `RelaySession` APIs are removed rather than retained as aliases.
The real-browser workflow passes after Relay closes completed signaling peers
and the test starts each independent receiver in a known order. Both receivers
remain live together after startup.

The physical 10 ms run exposed variable CoreAudio process-tap callback sizes.
Core commit `a2bb0e12e3d38aca6bf72eee02773e6830d58ccb` assembles those native batches
into the selected Session frame size. A later loaded 10 ms application,
microphone, Relay, browser, and recording run triggered a CoreAudio IO overload
at microphone startup. This step therefore qualifies the 20 ms media profile
and leaves loaded 10 ms startup as a separate Core performance gate.

## Acceptance for this step

```bash
npm run typecheck
npm run native:check
npm test
npm run api:check
npm run test:exports
npm run test:packed
npm audit
```

The installed-package gate packs the package into a new directory, installs
only the tarball, loads the native addon, performs native discovery and
permission inspection, declares each built-in Source form, and validates native
signal and route values. It also writes application-owned PCM through a real
Core Session and verifies copied samples, source and stream identity,
discontinuity, explicit end-of-stream, and clean shutdown. It does not open a
microphone. It also validates the linked Extension ABI and runs a real managed
child through the installed package, including one signal round trip and final
reap evidence.

Typed signal delivery is tested against a deterministic Core Session compiled
only for tests. Real Core Operators emit PCM, text, and bytes through the same
subscription Endpoint used by production builds. The fixture is absent from
the normal native addon and is not physical-device or provider evidence.

## Staff Bar Self-Check — JavaScript application-owned PCM

- Smallest correct design: yes — the addon borrows caller memory only during a
  synchronous call and writes directly into Core-owned storage. JavaScript does
  not own a media queue, clock, sequence, or Source identity.
- Tests added or updated: yes — native and TypeScript tests cover sample copies,
  both input representations, capacity, timeout, abort, invalid frames,
  discontinuity, close, identity, timing, package exports, and a packed consumer.
- Hot-path safe: yes — application writes happen outside capture callbacks and
  no JavaScript function is called from a realtime partition.
- Public API changed: yes — the unpublished Node entry gains `AudioInput`,
  `SourceOutput`, typed write failures, observations, and Session composition.
- New dependency: no — this work uses the existing released Core `1.1.10`,
  napi-rs binding, API Extractor gate, and Node built-ins. The installed package
  still has no runtime npm dependency.
- Phase scope respected: yes — the execution task records
  `phase-exception-approved`.
- Unsafe added: no.
- Remaining risk: selected-output cancellation, per-Stem recording outcomes,
  target packages, and real Windows/Linux execution are later gates and must
  not be inferred from the local macOS run.

## Staff Bar Self-Check — JavaScript stream consumption

- Smallest correct design: yes — Core owns every audio and signal queue. Node
  performs finite reads and copies values only after they leave realtime work.
- Tests added or updated: yes — native receipt state plus JavaScript audio,
  PCM/text/bytes signals, lineage, derivation, timeout, end-of-stream, abort,
  one-reader ownership, independent close, slow-consumer metrics, exports, and
  packed consumption.
- Hot-path safe: yes — signal receipt polling and JavaScript conversion run on
  worker tasks, never on capture callbacks or realtime partitions.
- Public API changed: yes — `BusSubscription`, `SignalStream`, typed payloads,
  `END_OF_STREAM`, `StreamAbortError`, and `Session.subscribe()` are added to
  the unpublished Node entry.
- New dependency: no — production still depends only on released Core 1.1.10.
  The existing Core conformance feature is enabled only by the test build.
- Phase scope respected: yes — only audio and typed-signal consumption changed.
- Unsafe added: no.
- Remaining risk: this is component evidence. It does not prove a physical
  Source, provider, Relay, browser, Windows/Linux package, or performance claim.

## Staff Bar Self-Check — JavaScript extensions and managed processes

- Smallest correct design: yes — Core remains responsible for native library
  validation and lifetime, process spawn, PKSS framing, queue capacity,
  lifecycle deadlines, kill, wait, and reap. TypeScript supplies declarations,
  copied bytes, async reads, `AbortSignal`, and typed failures.
- Tests added or updated: yes — linked ABI and descriptor validation, absolute
  library names, transactional duplicate rejection, real dynamic-library Source
  execution, healthy and malformed PKSS startup, exact message round trip,
  queue saturation, cross-Session handles, aborted reads, graceful close,
  forced kill, reap counters, exports, API report, and packed consumption.
- Hot-path safe: yes — no JavaScript callback runs from capture or realtime
  work. Extension ABI v1 admits only the execution roles Core already validates;
  sidecar calls run through the existing native Session worker.
- Public API changed: yes — the unpublished Node entry gains Extension ABI
  types, trusted library loading, generic registered Sources, `SidecarProcess`,
  `SidecarConnection`, finite message reads, process snapshots, and final
  sidecar outcomes.
- New dependency: no — production still depends on released Core `1.1.10`,
  napi-rs, and Node built-ins. Test fixtures compile with the existing Rust
  toolchain and run with the current Node executable.
- Phase scope respected: yes — provider implementations, voice behavior,
  Relay publication, release work, and target-package claims are unchanged.
- Unsafe added: yes — three C ABI calls mirror Core's frozen exported records.
  Borrowed records live for each synchronous call and no pointer is retained.
  Executing a loaded library remains an explicit caller trust decision.
- Remaining risk: the current fixtures prove SDK mechanics on macOS. They do
  not prove a provider, physical device, remote service, Windows/Linux package,
  or production deployment.

## Staff Bar Self-Check — JavaScript provider authoring

- Smallest correct design: yes — JavaScript implements provider behavior while
  Core retains Session compilation, identity, timing, route queues, delivery
  state, rollback, drain/abort, and finalization.
- Tests added or updated: yes — focused tests cover class and function
  Connectors, shared multi-Source delivery, typed Sources, configuration
  rejection, Source preparation cleanup, named Operator processing, exact PCM
  reentry, class and function Endpoints, multi-input grouping, cancellation,
  Endpoint preparation cleanup, and cross-Session rejection.
- Hot-path safe: yes — JavaScript calls run only through worker-owned native
  dispatch. The fixed-capacity dispatch uses nonblocking submissions and every
  JavaScript Promise has a finite deadline.
- Public API changed: yes — the unpublished Node entry gains `Connector`,
  `SourceFactory`, `OperatorFactory`, `EndpointFactory`, their concise function
  forms, lifecycle context, and typed delivery values.
- New dependency: yes — the native addon uses `futures` and `futures-timer` for
  caught Promise completion with finite deadlines. Neither is an npm runtime
  dependency.
- Phase scope respected: yes — no provider implementation, credential,
  inference model, Relay change, browser behavior, or second media runtime is
  included.
- Unsafe added: no.
- Remaining risk: target operating-system execution still remains. Component
  fixtures and the installed-package consumer do not prove a real provider,
  physical device, WAN, browser, or performance claim.

## Intentionally not included in this step

- provider packages or API keys;
- Electron application code;
- Relay composition or voice composition;
- publication, tags, or version selection;
- cross-platform or performance claims.

## Staff Bar Self-Check — JavaScript Session observations

- Smallest correct design: yes — Core remains the source of events, metrics,
  trace records, recording results, and shutdown state. The addon copies one
  snapshot through the Session worker; TypeScript only validates and converts
  it into immutable values.
- Tests added or updated: yes — deterministic Core and application-PCM tests
  cover live and final metrics, values beyond JavaScript's safe integer range,
  collection-count consistency, closed state values, retained terminal
  failures, recording results, trace writing, checksum reading, lifecycle
  validation, invalid settings, exports, and packed-package execution.
- Hot-path safe: yes — snapshots and conversions run through the existing
  Session worker. Trace records use Core's dedicated writer and configured
  queue; JavaScript never runs on capture callbacks or realtime partitions.
- Public API changed: yes — the unpublished Node entry gains `SessionMetrics`,
  typed recording results, `SessionTrace`, trace configuration and validation,
  closed failure stages, complete terminal failures, and final observations on
  `StopResult`.
- New dependency: no — production continues to use released Core 1.1.10,
  napi-rs, and Node built-ins.
- Phase scope respected: yes — no Relay, browser, voice, provider package,
  release, or target-platform claim is included.
- Unsafe added: no.
- Remaining risk: the tests establish component and installed-package behavior
  on macOS. They do not prove a physical Source, provider, browser, WAN,
  Windows/Linux package, or latency result.
