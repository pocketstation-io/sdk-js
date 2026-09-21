# JavaScript SDK progress

## W21 Python/JavaScript parity slice — Endpoint control plane

- Status: `SAFE-TO-MERGE` for `pocketstation.endpoint_authoring` and
  `pocketstation.aio.endpoint_authoring`; the neutral Lab ledger reports 71/71
  and 76/76 strict-equivalent rows respectively. Whole-SDK Python parity
  remains false at 1,594/3,674 rows and is not claimed.
- The public Node API now exposes manifest-driven Endpoint registration,
  reusable configured declarations, exact Session/Endpoint/route and
  Source/Stream/Stem context, signal/media/route metadata, shared or
  route-local preparation, the real Core start gate, finite native-owned
  batches, per-stage deadlines, explicit delivery outcomes, structured
  failure stage/retryability, rollback, shutdown, joined finalization, and
  immutable observations.
- Core continues to own every bounded receiver and the abandonment/drain loop.
  JavaScript receives push callbacks instead of duplicating Python's polling
  receiver and adding a second media queue. Explicit drops and thrown driver
  failures feed Core accounting; final driver counters are validated as u64,
  returned across the native boundary, and retained in Core terminal metrics.
- Eleven direct tests cover complete provenance, configuration including an
  explicit secret, transactional gate order, shared grouping, finite batches,
  drops, typed signals, structured delivery and request-stop failures,
  transactional rollback, start timeout cleanup, registration reuse,
  cross-Session rejection, validation, route overrides, and final Core
  observations. The complete SDK gate passes 24 suites / 226 tests; 15 native
  Rust tests, API extraction, documentation, five executable Core examples,
  package exports, and the isolated installed-tarball consumer also pass.
- This is component evidence on the local macOS build. It introduces no
  provider implementation, extra media queue, mock, scaffold, loopback-only
  product path, release, deployment, push, outreach, physical-device claim, or
  Windows/Linux execution claim.
- Staff review: `PASS`. The boundary is generic Endpoint authoring in the Node
  SDK plus its native Core bridge; the product-proof line enabled is reusable
  source-aware multi-input destinations. CODE_PROTOCOL gates run: TypeScript
  typecheck, Rust format/Clippy/tests, bounded hot-path review, full tests, API,
  docs, examples, exports, packed consumer, and diff check. Scaffold inventory:
  n/a. The npm registry audit endpoint remains externally blocked by the
  host's local certificate issuer and no dependency changed in this slice.

## W21 Python/JavaScript parity slice — Connector control plane

- Status: `SAFE-TO-MERGE` for `pocketstation.connector` and
  `pocketstation.aio.connector`; the neutral Lab ledger reports 192/192 and
  197/197 strict-equivalent rows respectively. Whole-SDK Python parity remains
  false and is not claimed.
- Manifest-driven JavaScript Connectors now register through Core's actual
  Connector contract rather than a generic Endpoint approximation. Core owns
  Connector and Endpoint identity, typed configuration resolution, grouped
  preparation, bounded receiver execution, readiness supervision, delivery
  accounting, shutdown, rollback, and terminal failure retention.
- The public Node API includes typed/default/secret-safe configuration,
  manifests, capabilities and requirements, reusable declarations, route
  settings, driver and finite native-owned batch-worker forms, independent
  prepare/start/delivery/shutdown deadlines, delivery outcomes, structured
  error stage/retryability, readiness/health/recovery state, immutable
  observations, context expiry, idle work, and Core-assigned Connector lineage.
- Eighteen direct behavior tests cover shared and independent lifecycles,
  convenience and decorator forms, native registration reuse and identity,
  typed configuration and redaction, manifest rejection, full PCM lineage,
  route metadata, grouping, finite batching, drop accounting, deadline
  failure, structured terminal errors, rollback cleanup, context expiry,
  implementation collision, explicit idle work, and exactly-once shutdown.
  A packaged-consumer regression also proves that an incidental return from a
  void Endpoint callback cannot corrupt native delivery accounting or fail
  Session finalization. The complete SDK gate passes 23 suites / 215 tests.
- This is component evidence on the local macOS build. It introduces no
  provider implementation, mock, scaffold, loopback-only product path,
  release, deployment, push, outreach, physical-device claim, or
  Windows/Linux execution claim.

## W21 Python/JavaScript parity slice — bounded event ingress

- Status: `SAFE-TO-MERGE` for `pocketstation.aio.event_input`; the neutral
  ledger refresh remains owned by `pocketstation-lab`, and whole-SDK Python
  parity remains false.
- `Session.eventInput()` now exposes application-owned JSON as one normal
  source-aware typed output. Canonical UTF-8 serialization, event size,
  pre-Core queue capacity, and timestamp range are validated before acceptance.
- `tryWrite()` is immediate and reports typed full/closed failures. Accepted
  events retain source/stream identity and exact source time through Core;
  observations expose finite capacity, current depth, accepted/full totals,
  and closure. Close is idempotent and lets already accepted events drain.
- Three focused tests cover the two Python reference behaviors plus identity,
  validation, canonical serialization, close, exact counters, and real Core
  delivery. The complete JavaScript suite passes 23 suites / 202 tests;
  typecheck, all API reports, documentation, package exports, the isolated
  packed consumer, and three executable Core examples pass.
- The queue runs off the realtime audio callback and introduces no unbounded
  storage, provider/model code, scaffold, mock product path, release,
  deployment, PR, push, outreach, or platform claim.

## W21 Python/JavaScript parity slice — conversation orchestration

- Status: `SAFE-TO-MERGE` for the Python voice-orchestration family;
  whole-SDK Python parity remains false until the neutral row ledger is
  independently refreshed and every other family gap is closed.
- `Conversation` and `RunningConversation` now coordinate low-level callbacks,
  separate STT/response/synthesis/VAD providers, or one duplex provider through
  one environment-neutral asynchronous contract. `Session.conversation()`
  binds the same orchestration to the Node Session without moving capture,
  routing, recording, or PCM ingestion out of Core.
- Transcript revisions, speculative responses, history, events, response text,
  tool observations, generated frames, and provider event detail are bounded.
  Provider start, close, response, synthesis, writes, drain, cancellation, and
  iterator cleanup all have finite deadlines.
- `AbortSignal` propagates cancellation to JavaScript providers. Interruption
  cancels only selected response/output generations, preserves capture, marks
  replacement PCM discontinuous, and retains explicit unavailable connector,
  receiver, and acoustic observations.
- Sixteen focused orchestration tests cover all eight Python reference-test
  behaviors plus capability rejection, separate components, duplex lifecycle,
  Session ownership, finite startup, reverse cleanup, speech-triggered
  interruption, and one actual Core Session with source-aware transcript and
  generated-audio reentry. The complete JavaScript suite passes 22 suites / 199
  tests; the three Python reference suites pass 8 tests. Type checking, API
  extraction, documentation, package exports, the isolated packed consumer,
  and the dependency audit also pass.
- No bundled provider, credential, model policy, extra media queue, callback
  hot-path work, scaffold, mock product path, release, deployment, push, or
  continuous-duplex/provider-production claim is introduced.

## W21 Python/JavaScript parity slice — voice foundations

- Status: `SAFE-TO-MERGE` for the provider-neutral foundation modules; the
  separate orchestration slice above supplies `Conversation` and
  `RunningConversation`.
- The new `pocketstation/voice` subpath implements immutable capabilities,
  validated limits/deadlines/interruption policy, typed failure and event
  records, turns and outcomes, transcript lineage, response and tool chunks,
  generated-audio chunks, speech activity, and separate or duplex provider
  lifecycle contracts.
- Python and JavaScript use the same configuration defaults and finite bounds.
  JavaScript uses one asynchronous provider lifecycle instead of duplicating
  Python's synchronous and asyncio facades.
- The voice subpath is environment-neutral: it imports neither the Node native
  addon nor browser WebRTC code. Package-structure tests enforce that boundary,
  and the isolated packed consumer imports and executes the subpath.
- Nine focused voice tests cover defaults, validation, immutability, lineage,
  response/tool data, turns/outcomes, generated audio, speech activity, error
  recovery facts, and provider lifecycle contracts. The complete JavaScript
  suite passes 21 suites / 183 tests, and the three Python voice orchestration
  suites pass 8 tests as the reference behavior gate.
- This slice adds no provider implementation, media queue, native callback
  work, scaffold, mock product path, loopback path, release, deployment, push,
  or claim that JavaScript voice orchestration is complete.

## W21 Python/JavaScript parity slice — bounded streams

- Status: `SAFE-TO-MERGE` for the stream capability family; whole-SDK Python
  parity remains false until the neutral row ledger reaches zero gaps.
- `AudioStream` now exposes native batch polling, bounded batch reads, explicit
  timeout-versus-EOF results, batch iteration, permanent reader modes, and
  compatible frame-first iteration without creating an unbounded JavaScript
  media queue.
- `AudioFrame` now exposes the owned `f32le` bytes, sample count and format,
  optional observations, and the same Core-derived clock-domain descriptor as
  Python. `AudioBatch` provides ordered iteration, indexed access, length, and
  owned array snapshots.
- `SignalStream` now exposes `poll()`, `iterSignals()`, `readerMode`,
  `isClosed`, and `aclose()` while enforcing Python's one-mode/one-reader
  contract.
- `StreamError`, `StreamModeError`, and `StreamInUseError` retain stable error
  codes plus the active/requested mode fields needed to act on ownership
  failures without parsing messages.
- Focused mock-boundary and real-Core tests cover batch states, EOF, timeout,
  mode conflict, concurrent ownership, abort retention, two independent Stems,
  clock lineage, PCM metadata, signal polling, and idempotent close.
- The complete JavaScript suite passes 20 suites / 173 tests. Rust formatting,
  Clippy with warnings denied, native tests, API extraction, documentation,
  package exports, and the isolated packed consumer also pass.
- No scaffold, mock product path, extra native queue, provider, deployment,
  release, or cross-platform/physical-device claim is introduced.

## W21 browser Relay authority and lifecycle hardening

The control plane now issues one media-only publisher capability for one exact
AudioBus. `ControlClient.issuePublisherCredentials()` validates that response,
keeps the token redacted, and exposes Relay signaling and ICE configuration.
`RelayPublisher` requires the resulting `publisherToken`; it no longer asks a
browser application for the broader Session-owner credential.

Browser signaling no longer silently accepts unsupported semantics. Codec
guidance is validated, exposed, and applies the supported bitrate setting;
latency observations are bounded and reportable in both directions; Relay ICE
recovery performs a bounded reattachment; encrypted SFrame media and
direction-invalid messages fail explicitly. Receiver Session/AudioBus identity
is verified before state is accepted, and raw wire-message unions are no longer
part of the public browser API.

Focused control/browser tests pass, the complete JavaScript suite passes 20
suites / 150 tests, and API, docs, package exports, and packed-consumer gates
pass. The real same-host control→Relay path proves owner credential → two
independently scoped publisher capabilities → two named buses → receiver RTP,
and proves a publisher token cannot read control-plane Session state. No mock,
scaffold, fallback, release, push, deployment, or WAN/physical-device claim is
introduced.

## W21 JavaScript control-plane parity

The package now exposes trusted Session lifecycle through a dedicated
`pocketstation/control` subpath. It is asynchronous by default and provides the
language-idiomatic equivalent of both Python's synchronous
`pocketstation.control` client and its `pocketstation.aio.control` facade.
Create, snapshot, subscriber-credential, invitation, delete, and close
operations use the same wire routes and status expectations as Python.

The client uses web-standard `fetch` and never imports the native Node addon or
the WebRTC browser client. Successful JSON and error bodies are streamed under
65,536-byte and 4,096-byte bounds. Session IDs, AudioBus identifiers,
credentials, required-bus counts, ICE configuration, snapshots, and
subscription state are validated before use. Every request has a finite
deadline, supports caller cancellation, and is cancelled when the client
closes. Returned records and arrays are frozen. `SecretToken` uses a private
field, redacts string and JSON conversion, and is also removed from HTTP,
transport, and response-stream error details.

Twenty-seven focused JavaScript tests cover the complete lifecycle, Python
wire defaults and bounds, malformed responses, unsafe paths, timeout,
cancellation, closure, and secret handling. The full JavaScript gate passes 20
suites / 146 tests. API extraction, package subpath resolution, documentation,
the clean tarball consumer, and npm audit also pass. The packed consumer imports
and runs `pocketstation/control` separately from `pocketstation/node`.

A fresh local real-service check ran the built JavaScript client against the
actual PocketStation control-plane process. It completed Session creation,
initial snapshot, subscriber credential issuance, authenticated Relay-state
replacement, ready snapshot, invitation creation, deletion, and the expected
post-delete 404. This is a local control-contract proof, not a deployed-service
or WAN claim.

`pocketstation/browser` remains the caller-owned WebRTC media edge. It does not
own Session creation or mint credentials. No release, npm publication, push,
deployment, or external mutation occurred.

## W21 exhaustive Python-to-JavaScript parity correction

The historical `W21-JAVASCRIPT-API-PARITY-DEVELOPER-EXPERIENCE` task proved a
bounded developer-experience slice, but its broad parity label was wrong. Its
own envelope excluded voice composition, while Python publicly ships the
provider-neutral `pocketstation.voice` runtime. Passing independent Python and
JavaScript suites also does not prove that the languages expose the same API or
behavior.

The cross-repository referee now lives in `pocketstation-lab`, not in this SDK.
At the guarded Python and JavaScript commits it expands 50 public Python modules
into 3,674 individually addressable API, member/signature, behavior, workflow,
and package rows. Only 5 package-policy rows are presently strict-equivalent;
1,041 declaration candidates remain `PARTIAL`, 2,365 rows are `ABSENT`, 248
Python test behaviors are `UNTESTED` one-to-one in JavaScript, and 15 workflows
are `UNPROVED`. These conservative results are an audit baseline, not an
assertion that every partial declaration is semantically wrong.

The largest clear gaps include the complete voice/conversation family,
`ControlClient`, event ingress, much of the rich Connector authoring contract,
branded identity/compatibility surfaces, one-to-one behavior tests, Python demo
and documentation workflows, npm publication, and non-macOS native packages.
No full Python-parity, cross-platform-parity, or deployment claim is valid.

The audit introduces no SDK implementation, mock, scaffold, fallback, or
loopback product path. JavaScript product changes must be split into explicit
owning tasks after this ledger is hash-accepted.

## W21 browser AudioBus publisher to Core Source

The active bounded task adds a browser-only `RelayPublisher`. The application
supplies exactly one live audio `MediaStream` track and retains permission,
selection, and track ownership. The publisher owns only capability-scoped
WebSocket/WebRTC publication, finite startup, real outbound-packet readiness,
observations, explicit reconnect, and bounded teardown. It never stops the
caller track and does not add another PCM queue or media engine.

The public state distinguishes signaling, connecting, actual publication,
disconnection, failure, and closure. `publish()` cannot resolve from signaling
or ICE alone: browser `outbound-rtp.packetsSent` must be positive. Unsupported
or unavailable WebRTC statistics remain `null`; an ended caller track is a
typed failure. Reconnecting is an explicit new Relay source attachment rather
than invented continuity.

Component tests cover exact Session/AudioBus signaling, first-packet
readiness, no-packet timeout, capability rejection, explicit reconnect,
observations, one-live-track validation, caller track ownership, and idempotent
disconnect. The product gate remains the Lab browser→Relay→accepted
connector→Core recording proof.

An acceptance rerun exposed an intermittent Node failure in the no-packet
deadline: a composite made with `AbortSignal.any()` could remain pending after
its timeout source should have fired. The original test reproduced both pass
and five-second hang outcomes. Publisher, receiver, and invitation startup now
share one explicit operation controller with a strongly referenced timer and
deterministic listener/timer disposal. The publisher regression test runs eight
consecutive absent-packet deadlines so this failure cannot hide behind one
passing timeout.

No scaffold or mock is added to product code. Test doubles cover component
state transitions, and the real proof will be labeled `LOOPBACK-ONLY`. This
task does not claim a physical phone, microphone permission UX, iOS/Android
backgrounding, WAN/TURN, Wi-Fi/cellular handoff, remote-device clock lineage,
speech, physical hearing, coding-agent integration, or production scale.

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

The bounded developer-experience implementation from
`W21-JAVASCRIPT-API-PARITY-DEVELOPER-EXPERIENCE` remains present, but that task
is no longer a valid full-capability parity acceptance point. The Lab-owned
exhaustive audit supersedes the broad claim.

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

## Python/JavaScript parity slice — application-owned PCM

- `AudioInput` now implements an exported `PcmSource` contract, matching the
  advanced Python source surface while retaining JavaScript's asynchronous
  finite-wait `write()` method on the concrete convenience class.
- PCM writes accept the cross-SDK `generation` name; the existing `output`
  spelling remains a compatibility alias and conflicting aliases fail before
  native dispatch.
- input observations now include Core's
  `discardedOutputFramesTotal`, alongside the already exposed capacity,
  acceptance, fullness, invalidity, cancelled-write, cancelled, and closed
  state.
- native and TypeScript tests cover the shared bounded-capacity, exact slot
  recovery, identity, continuity, output replacement, cancellation, close,
  invalid-buffer, timeout, and no-background-write behavior.
- No scaffold, mock, loopback-only path, provider, or second media runtime was
  introduced. This closes only the application-owned PCM family; it is not an
  all-SDK Python-parity claim.

## Python/JavaScript parity slice — concise Capture

- `Capture` now exposes direct bounded `pollAudio()`, `waitAudio()`,
  `audioBatches()`, `pollEvent()`, and `waitEvent()` composition over the same
  Core-owned `AudioStream` and `EventStream`; no extra JavaScript media queue
  exists.
- `recordingOutcome`, `applicationStem`, and `microphoneStem` provide the
  cross-SDK names while existing concise names remain compatible.
- `close()` is idempotent and powers `Symbol.asyncDispose`; application and
  microphone selectors are rejected before Session declaration when their
  runtime shape is invalid.
- This is component and API evidence. It does not add physical-device,
  Windows/Linux, deployment, release, or provider claims, and introduces no
  scaffold, mock, or loopback-only path.

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
