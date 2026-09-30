# JavaScript SDK progress

## Graceful custom Source drain projection — 2026-09-30

Status: `PARTIAL`; local macOS binding qualification passes, while Core pressure
semantics and physical/release qualification remain open.
Both concise `SourceDriver` and authored `AuthoredSourceDriver` optionally expose
Core's graceful `drain()` hook. It returns previously accepted emissions through
the existing native validation, lineage and fan-out path. Missing hooks return
no output; iterable helpers do not fetch new values during stop. Cancellation
skips draining and existing exact-close cleanup remains responsible for resource
release. No new cancellation callback or deadline configuration is introduced.

The native bridge uses one bounded dispatch/Promise wait capped at one second.
The authored adapter reuses the close deadline with the same cap; Core owns the
cumulative drain budget. A synchronous JavaScript callback blocking its event
loop cannot be forcibly interrupted, and this limitation is documented.

A real pending-input regression on the prior native artifact exposed a missing
interruption notification: graceful stop timed out waiting for `next()`. The
bridge now wakes the existing AbortSignal only after Core requests interruption,
then waits for the actual Promise and its cleanup. Already accepted results
survive; unrelated provider failures remain errors. Authored callback deadlines
retain a completion barrier so timed-out input cleanup cannot overlap drain or
close. No additional worker or persistent queue is introduced.

Signal EOF now performs an Acquire-fenced final dequeue after one observed
producer abandonment. Stop preserves accepted signals; explicit Session close
or cancellation discards native receipts, cached and in-flight values, including
subscriptions opened after termination or cancellation after an earlier stop.
Explicit close also discards when stop fails. Individual read abortion still
retains accepted values until the stream is explicitly closed.

TypeScript, API extraction, docs, notices and seventeen selected adapter/read
barrier regressions pass. All 23 native Rust tests and strict all-target,
all-feature Clippy pass against frozen Core
`5559610c82e1e2c7b23bc7f9bc2471fb91494ef1`. The normal host NAPI production build
and package staging pass. All 46 production-native Source, signal and AEC tests
pass, including the previously failing pending-next stop. Isolated root/native
tarball installation passes the 400-frame proof with echo power ratio 0.006853,
near-end ratio 0.899031, unchanged raw input and four actually consumed terminal
frames (1,920 padding samples). Normal package assembly also passes.

Normal host NAPI production and fixture packaging both pass. Final full Jest
passes all 45 suites with 606 tests and one existing optional real-model skip.
The first full run exposed two stale test doubles and a Source-drain fixture
that saturated the route with unrestricted heartbeat emissions. The drain
fixture now emits one readiness value and waits for cancellation; exact
contiguous sequence and all three accepted drain-value assertions remain.
CLI and performance-statistics checks also pass. Eight adversarial native-matrix
verifier tests pass without claiming the unrun target matrix.

The original sequence gap prompted a separate bounded diagnostic. On frozen
Core `5559610`, twenty normal signals sent to a `MustDeliverOrFail` route produce
nine deliveries and eleven explicitly counted drops, but no Source failure and
a successful stop. Core's typed fan-out applies its required-delivery failure
check only to terminal emissions. This is an open Core policy defect; the
passing SDK drain tests do not resolve it or qualify release. The execution
owner has the counter report and owning source locations.

Earlier sandbox build failures, aborted approval attempts, the initial npm
cache failure and the first full-suite failure remain preserved. The former
installed-package symlink was moved without modifying its historical target;
normal staging now uses its own local package directory. Package versions and
the published Core dependency pin remain unchanged. These are local package
and component proofs, not registry publication, physical AEC qualification or
cross-platform acceptance.
Scaffold inventory: no new live scaffold; test doubles are confined to tests.
This checkpoint changes no dependency/version, tag, push or publication.

## Built-in AEC language binding preparation — 2026-09-30

Status: `PARTIAL`. `Session.echoCancel()` delegates to Core's built-in processor
using explicit `PlaybackReference` constructors. Inputs use existing Stem,
SourceOutput and DerivedStream handles; the processed output is an ordinary
Stem. Immutable observations preserve u64 counters and nanoseconds as bigint
and remain available after stop. Audio frame metadata retains actual input
provenance, processing generation, nominal delay and terminal padding. Raw
streams and app-only capture remain independent. The SDK adds no DSP, timing
correction, persistent PCM queue or implicit capture.

Graceful stop retains Core's existing bounded receipt until its accepted frames
are drained. Explicit close/cancel discards cached delivery and drops the native
receipt, including late read results; the Session worker exits normally. Reads
remain bounded to one second. Reciprocal review corrected an EOF race by
observing producer completion before polling the final queue.

Broader testing exposed an actual Endpoint lifecycle bug: requesting Drain set
the JavaScript driver to a state that rejected accepted final deliveries. An
immediate start/stop reproducer failed 24 of 25 attempts. The adapter now uses
an explicit draining state until close, while Abort rejects delivery. The same
25 attempts pass, and deterministic single/batch/idle/gate regressions preserve
the boundary. The original failure and complete terminal diagnostics remain.

Against immutable Core `51eef90916a3593b2cb9e78b0237a656c5f29de6`, separate
production and conformance native builds pass. The final broad Jest run passes
all 45 suites with 579 tests and one existing optional real-model test skipped.
All 23 native Rust tests and all-target/all-feature Clippy pass. TypeScript,
public API extraction, docs, bundled AEC notices and eight adversarial matrix
verifier tests pass. An isolated installation of local root/native tarballs
passes the 400-frame synthetic echo/near-end test: echo energy ratio 0.00685,
near-end ratio 0.899, unchanged raw reference, retained observations and four
actual post-stop tail frames with 1,920 padding samples per channel. Tests also
cover 10/20 ms mono, anti-phase stereo, input provenance and read/stop races.

The native projection targets unreleased Core source. Package versions and the
published Core dependency pin remain unchanged. These local development-profile
artifacts do not qualify registry installation or physical speaker cancellation.
Normal NAPI Rust compilation succeeded, but its packaging reconciliation failed
with sandbox process-inspection EPERM. Diagnostic assembly copies the exact
hashed cdylib; normal NAPI packaging remains unpassed. Earlier source/build/test
failures are preserved, including the preceding 571-test checkpoint.

CI explicitly installs pinned Meson, Ninja and LLVM tools. This does not qualify
Windows/MSVC portability: the pinned engine still assumes Unix tools/archive
names. All six target builds and thirty Node runtime cells remain required.
Both packed and matrix consumers use the same AEC quality and actual-tail proof;
qualification rejects missing/nonfinite metrics, muting, pass-through or missing
tail delivery. Full target qualification, release and physical acoustic proof
remain pending. Terminal receipts, source snapshots and binary hashes are in
W21-AEC-CORE-INTEGRATION/release-preparation-138/js-bindings.

Staff Bar Self-Check: thin Core projection and existing lifecycle repair; public
API changed; no new SDK dependency, unsafe code, hot-path change or live scaffold.
Synthetic PCM and explicit test doubles are component evidence. Existing phase
exception applies. No tag, push, publication or deployment performed.

## W21 graph execution parity — 2026-09-25

- Status: `SAFE-TO-TEST`. The Node graph surface now uses the same Core-owned
  signal, media, route, configuration, Operator, Endpoint, and Connector
  semantics as Python for the active graph-execution inventory. Exact graph and
  Endpoint contract codes, source configuration keys, signal-specific default
  subscription media, queue capacities above the former u32 ceiling, and exact
  u32 revision, generation, and timeout bounds are covered directly.
- Exact staged-tree gates pass TypeScript checking, 89 focused native-backed
  assertions, 20 native unit tests, API extraction, all-feature Clippy, and
  diff checks. The installed wheel/npm referee remains required before this
  slice can be accepted.
- This adds no media queue, provider implementation, scaffold, mock,
  loopback-only product path, physical-device claim, deployment, or release.
  Core remains authoritative for compilation, capacity, lifecycle, delivery,
  cancellation, and shutdown.

## W21 Session lifecycle parity — 2026-09-25

- Status: `SAFE-TO-TEST`. `RunningSession` now exposes the Core-owned lifecycle
  state, terminal-state check, cached stop result, deterministic `close()`, and
  bounded audio/event convenience methods matching the Python SDK without
  adding a JavaScript media queue.
- The native addon reads lifecycle state through the existing bounded Session
  command channel. Focused TypeScript and native-backed tests pass for running,
  stopped, repeated shutdown, finite audio reads, and event polling.
- This is local component behavior. Installed wheel/tarball comparison and
  cross-platform package qualification remain part of the active parity task.
- Staff Bar Self-Check: Core remains authoritative; public API changed; no new
  dependency, scaffold, mock, loopback path, realtime allocation, lock, log, or
  panic was added.

## W21 microphone recovery command failures — 2026-09-24

- Status: `SAFE-TO-MERGE` for the Node native command mappings. A full
  replacement queue now projects `source.replacement_queue_full`; a disconnected
  Session worker or dropped response projects `source.runtime_stopped`. Stopped
  Sessions continue to project `source.session_not_running`, and all nine Core
  microphone recovery failures remain `SourceError` values in JavaScript.
- Native regression tests exercise a full command queue, a disconnected command
  receiver, and a dropped response without opening a physical device. The
  focused JavaScript tests pass 29 assertions; the complete JavaScript suite
  passes 29 suites and 266 tests. Rust format, Clippy, all 19 native tests,
  TypeScript, API extraction, and package export checks pass against the exact
  unpublished Core source used for this candidate.
- The SDK does not add an independent response timer. Core owns the microphone
  replacement operation and its response deadline. Timing out only the outer
  Promise would allow a queued replacement to run after the caller had observed
  failure. A platform capture open that blocks indefinitely must be bounded or
  cancelled in Core before the SDK can report a safe timeout.
- Staff Bar Self-Check — recovery command failures: smallest correct design:
  yes, shared mapping helpers with direct queue-state tests; tests added or
  updated: yes; hot-path safe: yes, the command worker is outside the audio
  callback and remains nonblocking on submission; public API changed: no; new
  dependency: no; phase scope respected: yes; unsafe added: no; remaining risk:
  no physical microphone was opened, and Core `1.1.11` is not yet available
  from the public registry.

## W21 Python/JavaScript source error-code parity — 2026-09-23

- Restored the existing `source.unsupported_session_kind` code for a discovered
  output device; the interim `..._category` spelling came from a blanket
  rename and would break caller error handling. Python's current committed
  source and test already use the original code; the uncommitted rename there
  was removed without changing unrelated Python work.
- Added a dedicated JavaScript regression test for the exact error code. The
  focused test and full JavaScript rerun pass (35 suites, 302 passed, one
  skipped). The complete Python suite passes 285 tests with 29 skips, and
  Ruff plus MyPy pass. JavaScript typecheck also passes.
- This is one semantic row, not full Python/JavaScript parity or release
  evidence. The corrected Lab audit now records 303 supported rows and 3,377
  partial rows out of 3,680. No VM or historical evidence data changed.

## W21 real WebSocket example parity — 2026-09-23

- Status: `PARTIAL` for release, component pass for the missing repository
  workflow. `examples/send-audio-to-websocket.ts` now opens a bearer-authenticated
  `wss://` socket and sends one selected application's 48 kHz mono PCM as owned
  float32 little-endian frames through a bounded SDK Connector. The Session
  and socket close on interruption, remote closure, or failure. No new package
  dependency or provider code was added.
- Six public TypeScript examples compile; `npm run examples:check`,
  `npm run docs:check`, `npm run typecheck`, and the complete `npm test`
  (34 suites, 301 passed, one skipped) pass on this macOS host.
- The neutral Lab inventory contains 3,680 rows. A later auditor correction
  prevents same-named declarations and file-wide test groups from receiving
  automatic parity credit: 302 rows have explicit equivalent dispositions and
  3,378 remain `PARTIAL`. The three new frame-duration rows point to direct
  JavaScript tests. The
  WebSocket row is source-level workflow parity, not live device or
  external-provider proof.
- Staff Bar Self-Check — WebSocket example: smallest correct design: yes,
  example-only transport using the existing optional `ws`; tests added: no new
  live-path test because it requires a selected playing application and an
  authenticated provider, but existing Connector tests plus example compile
  and audit pass; hot-path safe: not applicable, Connector delivery is async;
  public API changed: no; new dependency: no; phase scope respected: yes;
  unsafe added: no; remaining risk: current SDK/Lab trees are dirty,
  installed-public-npm and real WebSocket/device proof are not established.

## W21 native release load and Node example types — 2026-09-23

- Status: `PARTIAL` for a complete JavaScript release. The normal macOS 27
  release-built addon initially failed Node `dlopen` with a misaligned LINKEDIT
  string pool; the debug build and a controlled optimized build with line
  tables loaded. Setting release profile `debug = 1` makes the normal
  `npm test` build load on this host without an environment override.
- `npm test` passed 34 suites / 301 tests with one skipped after adding
  direct parity tests for 44.1 kHz defaults, explicit frame-size override,
  and actual 20 ms delivery.
  The first parallel run had one intermittent advanced Endpoint stop-success
  assertion failure; serial and subsequent parallel runs passed. That
  reliability question remains open, not silently dismissed.
- `npm run typecheck`, `npm run api:check`, `npm run test:exports`, and
  `npm run examples:check` passed. The installed-tarball consumer passed with
  `npm_config_offline=true`; the default online attempt stalled in the
  temporary consumer's `npm install` and was interrupted. No VM or evidence
  data was touched. The example TypeScript config now explicitly selects
  the already installed `@types/node` so Node globals such as `process` are
  unambiguous to editors; no dependency was added.
- This is local macOS component evidence, not an npm publication or full
  Python/JavaScript parity claim. The latest neutral parity run still reports
  four ledger gaps (one partial WebSocket example and three Python
  frame-duration regression rows awaiting map review against the new JavaScript
  tests). No real-device, cross-platform, or
  installed-public-npm claim follows.
- Staff Bar Self-Check — native release load: smallest correct design: yes,
  one Cargo profile setting after a failing/working build comparison; tests
  added: no, existing build, loader, full suite and packed consumer exercise
  the failure; hot-path safe: not applicable; public API changed: no; new
  dependency: no; phase scope respected: yes; unsafe added: no; remaining
  risks: the toolchain workaround needs revalidation on future macOS/Rust
  versions, the Endpoint stop assertion is intermittent, and whole-SDK
  parity/public release remain gated.

## W21 Python/JavaScript parity slice — Source control plane

- Status: `SAFE-TO-MERGE` for `pocketstation.source_authoring` and
  `pocketstation.aio.source_authoring`; the neutral Lab ledger reports 38/38
  and 42/42 equivalent rows respectively. Whole-SDK Python parity remains
  false at 1,788/3,674 rows and is not claimed.
- The public Node API now exposes Core-validated Source manifests, reusable
  registrations and declarations, driver/factory and synchronous or async
  iterable forms, optional configuration validation, finite per-stage
  deadlines, Core-owned cancellation, actual Session/Source/output/stream
  preparation identity, immutable owned emissions, and exact timing,
  generation, discontinuity, policy, clock, and terminal metadata.
- The native boundary accepts the already validated Core Source manifest.
  Core remains the authority for identity, sequence numbers, lineage,
  bounded fan-out, failure accounting, and terminal Session state. Authored
  PCM still uses `Session.audioInput()`; this slice adds no second audio queue.
- Four advanced tests plus the existing concise Source suite cover both
  iterable modes, Promise-native drivers, validation, registration reuse,
  actual Core identity and timing, cancellation state, exactly-once close,
  manifest/deadline/payload/ownership rejection, and an incompatible-emission
  failure retained in Core metrics. The complete gate passes 26 suites / 236
  tests; 15 native Rust tests, TypeScript, API extraction, documentation, nine
  syntax examples / seven Core examples, package exports, and the isolated
  installed-tarball consumer also pass.
- The npm audit endpoint failed twice under the host's default TLS trust with
  `unable to get local issuer certificate`; an explicit one-command
  `--strict-ssl=false` retry reported zero vulnerabilities. No dependency
  changed in this slice, and the TLS bypass was not persisted to npm config.
- This is local macOS component evidence. It introduces no provider
  implementation, extra media queue, mock, scaffold, loopback-only product
  path, release, deployment, push, outreach, physical-device claim, or
  Windows/Linux execution claim.
- Staff review: `PASS`. Product-proof line enabled: reusable application-owned
  typed Sources enter the same bounded source-aware graph as native capture.
  Architecture boundary: Node Source authoring and its native Core bridge.
  CODE_PROTOCOL gates: TypeScript, Rust formatting/Clippy/tests, full Jest,
  API, docs, examples, exports, packed consumer, parity audit, and diff checks.
  Scaffold inventory: n/a.

## W21 Python/JavaScript parity slice — Operator control plane

- Status: `SAFE-TO-MERGE` for `pocketstation.operator_authoring` and
  `pocketstation.aio.operator_authoring`; the neutral Lab ledger reports 50/50
  and 49/49 equivalent rows respectively. Whole-SDK Python parity remains
  false at 1,703/3,674 rows and is not claimed.
- The public Node API now exposes manifest-driven reusable Operator
  registration, exact Core policy, configured declarations, synchronous or
  asynchronous factories and handlers, per-stage finite deadlines, compiled
  prepare context, typed emissions, and convenience function authoring.
  JavaScript's single Promise-native surface covers Python's synchronous and
  asyncio facades.
- The native bridge now preserves the actual graph-compiled edge identity,
  capacity, signal, media, and complete route delivery policy. It rejects any
  future compiled route policy that cannot be represented exactly rather than
  reconstructing an approximation. Core retains ownership of worker queues,
  processing deadlines, permission/cancellation/failure policy, derivation,
  audio pools, reentry, fan-out, and recording.
- Five advanced tests plus the existing concise tests cover lifecycle,
  compiled context, configuration and secrets, handler/factory forms,
  registration reuse, async execution, output inference, derivation,
  terminal roles, exact PCM contracts, owned typed-array copies, payload and
  frame bounds, native-pool saturation, generated-audio reentry, and multistem
  recording. The complete gate passes 25 suites / 231 tests; 15 native Rust
  tests, API extraction, documentation, eight syntax examples / six Core
  examples, package exports, the isolated installed-tarball consumer, and the
  dependency audit also pass.
- This is local macOS component evidence. It introduces no provider
  implementation, extra media queue, mock, scaffold, loopback-only product
  path, release, deployment, push, outreach, physical-device claim, or
  Windows/Linux execution claim.
- Staff review: `PASS`. Product-proof line enabled: application-owned typed
  computation over source-aware stems without leaving Core's bounded graph.
  Architecture boundary: Node Operator authoring and its native Core bridge.
  CODE_PROTOCOL gates: TypeScript, Rust formatting/Clippy/tests, full Jest,
  API, docs, examples, exports, packed consumer, dependency audit, parity
  audit, and diff checks. Scaffold inventory: n/a.

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

## Python parity closure and provider workflows — 2026-09-21

- Source version is aligned to `0.1.4`; no npm publication or deployment was
  performed.
- `pocketstation/demo` now supplies source-aware bounded local transcription
  and an OpenAI Realtime adapter outside Core. Direct tests cover two-source
  lineage, format conversion, transcript revisions, bounded transport, audio
  reentry, cancellation, and a real Core Session route. The real local-model
  test remains opt-in and was not claimed without a configured model file.
- `EventStream` now has a public callback-backed constructor as well as the
  native Session path, with direct tests for polling, finite waits, closure,
  reader ownership, retained events, and cancellation.
- The installed tarball exposes and loads root, Node, browser, control, demo,
  and voice entry points plus the CLI. API reports include the demo entry.
- The Deno/Jupyter notebook, its public guide, and notebook-only active Lab
  runners were removed. Runnable examples remain JavaScript ES modules.
- Full JavaScript result: 34 suites, 299 passed, one opt-in local-model test
  skipped. Native addon result: fmt/clippy passed and 15 tests passed.
- No scaffold, mock product path, release, deployment, WAN, Windows/Linux,
  provider-adoption, or physical-device claim was introduced.

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
## 2026-09-24: microphone source-truth projection

Status: `SAFE-TO-TEST` locally against the additive Core candidate; public
registry build remains `BLOCKED` on PocketStation Core `1.1.11` publication.

- The Node API now reports each built-in source's opened native format, first
  and latest frame activity, off-callback signal measurements, and explicit
  microphone replacement observations.
- Activity and signal evaluation use caller-supplied thresholds and do not
  choose a fallback source or start recovery.
- `replaceMicrophoneSource` and `reopenMicrophoneSource` retain the logical Stem,
  increment Core-owned generations/discontinuities, and normalize every native
  replacement failure into the `source.*` namespace.
- `SampleRepresentation` and `runtimeCompatibility` are public installed-package
  values. The compatibility report names exact Core `1.1.11`.
- Local validation used Core commit
  `e38b12d3c3459474263ed2aa224fd7660e807efa`, temporarily versioned as `1.1.11`.
  TypeScript checking, API extraction, focused Jest tests, native check/Clippy,
  the nine-code Rust mapping test, and an offline packed consumer passed.
- Qualification exposed and closed two Node-runtime defects. Provider
  ThreadsafeFunctions are weak event-loop references, so an unstarted
  JavaScript Endpoint no longer prevents Node from exiting. A gate-open
  notification that races an already-requested Endpoint shutdown is now an
  idempotent no-op instead of a false start failure. The Endpoint path passed
  30 consecutive focused stress runs after the repair.
- Full serial and normal Jest runs both pass 29 suites and 266 tests without an
  open-handle or forced-worker-exit warning. TypeScript checking, API
  extraction, documentation links, examples, and package exports also pass.
- The JavaScript package, native addon crate, root export, and compatibility
  report use SDK version `0.1.4`, matching the Python package version required
  by the parity gate. The release-mode addon was packed offline as
  `pocketstation-0.1.4.tgz` with SHA-256
  `3fab305eabaf0a6c38a5292577ef10d12763bd51b91d030b0dffca8a233319f3`.
  A new empty consumer installed that tarball offline and exercised public
  activity/signal evaluation, `SampleRepresentation`, microphone selection,
  recovery method exports, compatibility metadata, and real source discovery.
- The checked-in lock remains the last registry lock with its real checksum.
  `cargo check --locked` correctly rejects the `=1.1.11` manifest until that
  crate is published. No path dependency or synthetic registry checksum is
  committed.
- No Bluetooth/HFP, Teams, physical-device, automatic fallback, or Minutes
  integration claim is made by this component evidence.

## 2026-09-25: installed Session audio-input parity

- `Session.pcmSource()` accepts one resolved `AudioInputConfig`, and
  `Session.polledAudio()` names the bounded managed-language Endpoint used by
  the equivalent Python API.
- Both methods delegate to the existing `audioInput()` and `audio()`
  implementations; they add no queue, worker, native media path, or alternate
  lifecycle.
- TypeScript checking, focused Session/audio-input tests, and the clean packed
  wheel/npm cross-language consumer pass. The result is `LOOPBACK-ONLY` and
  makes no physical-device, browser, network, or release claim.

## 2026-09-25: stream, recording, and observation parity

- Audio, signal, and Session-event reads use a 100 ms default and distinguish
  finite timeout from sticky end of stream. Frames already copied from a
  terminal native batch are drained before EOF.
- If an AbortSignal races with native delivery, the cancelled read still
  rejects while the accepted audio, signal, or event remains available to the
  next reader. Retention is finite and covered by controlled race tests.
- Stop results expose the terminal Session state, retained terminal event, and
  exactly one of final metrics or an explicit unavailable reason. Ambiguous
  native outcomes fail with `session.invalid_stop_result`.
- Projected Session events and trace records use the precise `type` field;
  externally defined native fields retain their specified names.
- Trace paths reject blank values and trace capacity is restricted to
  1 through 1,000,000 records.
- TypeScript, Node API extraction, and all 31 candidate JavaScript suites pass:
  372 tests pass. Installed npm-tarball comparison is
  owned by the Lab referee and is not a publication or platform claim.

## 2026-09-25: Relay, sidecar, extension, and provider lifecycle parity

- A Node Relay Session derives and validates its Relay origin from the exact
  WHIP/WHEP endpoints returned by the control plane. Explicit overrides must
  match, and post-create validation failure attempts remote cleanup.
- One Session owns at most one Relay publisher. Source stems publish through
  their public `publish()` operation, and Relay outcomes remain observable in
  the final Session result.
- Sidecar identifiers, deadlines, polling, process specifications, protocol
  failures, and cleanup use the same finite bounds in direct and async Node
  workflows.
- Source, Operator, and Endpoint authoring now receive exact native deadline
  notifications. The corresponding AbortSignal is cancelled immediately;
  late-created resources and timed-out resources are finalized exactly once,
  with cleanup itself bounded.
- Voice and extension inputs are validated and copied before use; mutable
  caller data cannot silently change a running declaration.
- TypeScript, public API extraction, examples, documentation, package exports,
  and isolated packed-consumer checks pass. All 33 exact-candidate JavaScript
  suites pass with 406 tests; native format, strict Clippy, and all 23 native
  tests pass.
- This remains a local candidate. No npm publication, tag, push, hosted
  deployment, WAN, cross-platform, browser-audibility, or physical-device
  claim is made by this step.

## 2026-09-26: browser authority and media ownership hardening

- `RelayPublisher` and `RelayReceiver` copy and freeze validated signaling
  authority, nested ICE URLs, finite deadlines, and observer callbacks at
  construction. Later caller mutation can no longer redirect a bearer token or
  replace a previously validated bound.
- WebRTC RTP observations now select the standards-defined `kind === "audio"`
  field exactly. Video and missing-identity reports cannot satisfy audio
  readiness or supply audio observations.
- Observer callback exceptions are isolated from the media lifecycle. They are
  reported through the error observer where possible and cannot tear down a
  healthy publisher or receiver.
- Publisher reconnect-before-publish now returns a rejected Promise instead of
  throwing during default-argument evaluation. Receiver teardown explicitly
  stops the remote tracks it owns; publisher teardown continues to preserve the
  caller-owned source track.
- TypeScript and twenty-three focused publisher/receiver tests pass. The
  installed three-browser Relay proof remains required before this candidate
  can be accepted. No WAN, TURN-only, acoustic-output, physical-device,
  deployment, publication, or release claim is made.

## 2026-09-26: browser-local ICE ordering

- Publisher and receiver ICE candidates produced during
  `setLocalDescription()` are retained in a bounded queue until the authorized
  `PUBLISH` or `SUBSCRIBE` message has created the corresponding Relay
  attachment. This prevents early WebKit candidates from being sent before
  Relay has an attachment that can consume them.
- Browser publication declares one explicit `sendonly` transceiver for the
  caller-owned audio track. This avoids relying on engine-specific `addTrack`
  direction inference and mirrors the receiver's explicit `recvonly` intent.
- The queue is capped at the same 64-candidate bound as pre-answer remote ICE,
  is cleared on close, and fails explicitly on overflow. It does not introduce
  another transport or unbounded signaling state.
- Regression tests emit local ICE synchronously from
  `setLocalDescription()` and require the signaling order to be authorization
  first, candidate second. All 36 JavaScript suites pass with 425 tests and one
  intentional skip; TypeScript and all public API extractors pass.
- The installed Chromium, Firefox, and WebKit proof still decides whether this
  is accepted. No hosted, WAN, acoustic-output, physical-device, publication,
  or release claim is made here.

## 2026-09-26: flat-root runtime compatibility parity

- The environment-neutral `pocketstation` entry point now exports the same
  immutable runtime compatibility facts already available from
  `pocketstation/node`, matching the Python package's flat-root access.
- Direct tests bind those facts to the package manifest and exact native Core,
  Relay connector, Node version and Node-API requirements. Package-resolution
  and isolated packed-consumer checks cover the public root import.
- This closes one public projection gap only. It does not establish whole-SDK
  parity, a clean release candidate, registry publication, hosted operation,
  browser execution, another platform or physical-device behavior.

## 2026-09-26: installed demo integration parity

- `pocketstation/demo` is an isolated optional entry point. It provides one
  finite local `whisper-cli` Operator and one bounded OpenAI Realtime example
  without adding provider code or credentials to Core or the root import.
- Application and microphone windows retain independent Source identity.
  Every 64-bit identity, sequence, epoch, and nanosecond timestamp uses a
  lossless decimal-string JSON representation and decodes to `bigint`.
- Audio batching validates finite formats, frame alignment, aggregate bounds,
  duration, ownership, and resampling before retaining state. Returned windows
  are copies, so caller mutation cannot alter queued PCM.
- The installed CLI preflights its local model and executable, declares
  transcription before Session start, and preserves optional multistem
  recording and Relay publication with bounded cancellation and cleanup.
- The base npm package does not install `ws`; the Realtime demo reports the
  explicit opt-in install command when the optional peer is absent.
- The full JavaScript suite passes with 457 tests and one opt-in real-model
  test skipped. API extraction with an exact eighteen-symbol cross-entrypoint
  allowlist, documentation, six public TypeScript examples,
  six internal smoke fixtures, package exports, and an isolated packed
  consumer pass. Registry publication and non-macOS execution are not claimed.

## 2026-09-26: deterministic qualification statistics

- The existing performance runner now uses one tested nearest-rank percentile
  helper for p50, p95 and p99 summaries instead of retaining an untested local
  implementation.
- Direct Node tests cover 0, 1, 50, 95, 99 and 100 percentiles and reject empty,
  non-finite and out-of-range inputs. This is qualification-tool parity only;


## 2026-09-26: root and native package assembly — Candidate 114

Status: `SAFE-TO-TEST` locally. Phase 2 implementation uses the recorded
`phase-exception-approved` JavaScript SDK closure. Publication and the remaining
platform/performance/OSS gates are still pending.

- The root npm archive contains JavaScript and declarations. Six exact-version
  optional native package manifests target macOS arm64/x64, Windows arm64/x64,
  and glibc Linux arm64/x64. The local Darwin arm64 package contains the real
  release addon; no other platform binary is fabricated or claimed qualified.
- Native loading uses normal package resolution, checks the exact SDK version,
  rejects unsupported CPU/OS/libc, and preserves actionable typed failures. It
  has no checkout-relative fallback, install downloader or compilation hook.
- Node ESM wrappers and CommonJS share one runtime implementation and class/error
  identities. Browser/default ESM remains separate. The TypeScript compiler
  generates wrapper exports without evaluating native-dependent demo modules.
- Local gates passed TypeScript, six API reports, 37 suites / 457 assertions
  (one existing opt-in test skipped), docs/examples, native format, Clippy and
  all 23 Rust tests. Separate installed root/native consumers cover real PCM
  Session execution, shared ESM/CJS identities, mixed-mode NodeNext types,
  browser graph separation, and missing/version/unsupported-target failures.
  The existing complete packed consumer also passed. The assembly consumer now
  runs in `test:packed` so CI cannot omit it.
- Invariants/ownership: sdk-js owns packaging and module loading; Core retains
  capture, routing, timing and lifecycle. Runtime version remains 0.1.4.
  Failure is explicit; no silent source fallback or second runtime is added.
- The canonical workspace's seven tracked edits and old tarball are preserved
  byte-for-byte. This candidate starts from accepted ea94849 in a separate
  branch/worktree and does not incorporate or erase that unrelated work.
- Staff Bar Self-Check: smallest correct design: normal npm optional packages
  and shared Node implementation; tests added/updated: real installed consumers;
  hot-path safe: setup/build only; public API: existing exports unchanged, CJS
  added; new third-party dependency: none; phase scope: existing exception;
  unsafe added: no; scaffold inventory: n/a. Remaining risks: other target
  binaries, installed performance, independent browser bundle/runtime,
  supply-chain notices and public npm publication require subsequent gates.
  Historical 10 ms physical failure and its thresholds remain unchanged.

## 2026-09-26: installed package performance — Candidate115 resumed

- Pin published Core1.1.12, which repairs the physical microphone timestamp
  discontinuities found in the exact Core1.1.11 package preflight. The SDK version
  remains0.1.4; compatibility facts and installed-consumer assertions match.
- Measurement loads the public installed Node entry and records the selected
  native addon hash, refusing checkout fallback or ambiguous binary identity.
  Existing latency, cadence, CPU/RSS, queue and cleanup limits are unchanged.
- The previous C114 archives and failed C115 physical result are retained.
  Fresh archives need installed-consumer and performance acceptance; no npm,
  cross-platform,10ms physical-latency or endurance claim is made here.
- Core owns the capture fix; no SDK runtime behavior or dependency is added.
  Scaffold inventory:n/a. Validation is recorded below after the gates run.

- Validation: production build and TypeScript pass; all37SDK test suites/457
  assertions pass(one existing opt-in skip), public exports and complete packed
  consumer pass against Core1.1.12. Measurement scripts pass Node syntax checks.


## 2026-09-26: native npm target qualification — Candidate 119

- Phase 2 uses the existing JavaScript phase exception. SDK packaging owns the
  six native package matrix; Core keeps all runtime semantics. No version change.
- Build one binary-free root archive and six production native archives from
  locked dependencies. Execute each frozen pair on its actual OS/CPU with
  Node 20.17.0, 20, 22, 24 and 26. Linux builds and consumers use pinned
  manylinux 2.34 containers; shared-library requirements are retained.
- Consumers compare every installed file with the archive, exercise all six
  ESM/CommonJS exports with shared identities, and run real native PCM through
  Source/stream/output identity, cancelled generation rejection and Session stop.
- The verifier rejects different artifact hashes, source commits, OS/CPU/libc,
  Node versions, incomplete observations and missing matrix cells.
- Local Darwin arm64 Node 20 consumer passes; 5 verifier tests cover 17 altered
  report cases. Hosted target results remain pending until actual CI completion.
- These are component claims. Physical capture, performance, permissions, WAN,
  browser hearing and registry publication are separate evidence. No scaffold
  or mock enters the package; synthetic verifier unit reports are test-only.
- Staff review: invariant is build once/consume identical archives; failures stop
  qualification; no Core or hot-path changes, new runtime dependency or API.
  Scaffold inventory: n/a. Checks: Python/Node syntax, verifier tests, local
  installed consumer and whitespace. Decision: SAFE-TO-TEST; hosted gates pending.


### Candidate 119 follow-up: exact-artifact CI publication preparation

- The user directed publication through CI. The former tag-triggered root-only
  rebuild/publish workflow is replaced by explicit dispatch, defaulting to a
  dry run. The release consumes the successful native qualification artifact
  without rebuilding it and requires an independently approved manifest digest.
- A successful run receipt must match the repository, workflow and exact source
  commit. Every target/report/archive is independently recomputed; native package
  archives precede the root. Actual upload additionally requires the matching
  `v<version>` tag and GitHub Actions. Retry accepts an existing version only
  when its registry integrity equals the retained archive. Partial receipts
  survive failed publication.
- OIDC is preferred; an optional CI secret supports initial package publication.
  Public-repository provenance is enabled; private repositories cannot claim npm
  provenance. Local npm login is not a release gate. There is no configured CI
  publishing secret and package trust is not established by this implementation.
- Every target consumer now also compiles strict NodeNext ESM and CJS consumers
  with exact TypeScript/Node declaration tooling. Local macOS arm64 Node 20
  installed runtime and type checks pass. Eight test cases pass across publisher
  integrity/order, CI receipt rejection and matrix observation validation.
- Hosted run 36271801171 attempts 1 and 2 were refused before any steps because
  GitHub reported failed payments or a spending limit. No hosted target result,
  dry-run publication or real upload is claimed. The task remains unaccepted.
- Staff review: no product runtime, public API, version, hot-path or dependency
  changes. No new scaffold; verifier fixtures are explicit synthetic unit inputs.
  Checks: Python/Node syntax, YAML parsing, adversarial tests, real local consumer
  and whitespace. SAFE-TO-TEST; hosted qualification and release gates pending.

## 2026-09-26: readable exact-bus receiver invitations

- Status: `SAFE-TO-TEST`. `ControlClient` creates public or private
  invitations only for a caller-selected AudioBus, exposes non-consuming
  inspection, and consumes authority only through
  `POST /v1/invitations/{locator}/redeem`. Expired, revoked, invalid, and
  replayed invitations share one `InvitationUnavailableError` so clients do
  not gain a state oracle.
- Private receiver URLs, fragment secrets, subscriber tokens, and TURN
  credentials require explicit exposure. Ordinary string conversion, JSON,
  object inspection, and failure messages retain redaction. Browser invitation
  locations carry only the locator and fragment secret; a separately trusted
  `controlPlaneUrl` selects the redemption authority.
- The browser and Node Relay surfaces snapshot exact authority and ICE values,
  retain W3C `type` and `kind` field names, redeem with POST, and preserve the
  selected AudioBus returned by the control plane. Receiver close continues to
  stop owned remote tracks; publisher close continues to leave caller-owned
  source tracks alone.
- TypeScript, public API extraction, package export resolution, 69 focused
  invitation/browser/Node assertions, and the complete suite pass: 37 suites,
  463 tests passed, and one opt-in real-model test was skipped. The existing
  isolated packed-consumer gate passes against a clean npm tarball.
- This adds no media queue, provider, scaffold, mock, loopback product path,
  deployment, publication, or release. The Lab-installed client run against
  the real control-plane and Relay product code remains the acceptance owner
  for cross-language, single-use, exact-bus evidence.

## 2026-09-27: current-package readable invitation integration — Candidate 123

The real installed Lab memory proof failed importing InvitationUnavailableError
from pocketstation/browser. Commit 95760df existed on a separate historical
branch and had never entered the current 9bdd144 package line. This candidate
integrates that preserved implementation while retaining the split native
packages, generated ESM/CJS wrappers and Core 1.1.12 dependency. Only progress
had a merge conflict; both histories are retained. No SDK version or native code
changes. Full SDK gates and a fresh installed real-memory/Relay proof are required.
No new scaffold, mock or provider; no release, deployment or hardware claim.

Pre-commit validation: all 58 focused control/browser assertions, TypeScript,
public API reports, 24-document check and both example compilation gates pass.
Full native-backed suite and installed memory proof remain acceptance gates.

## 2026-09-27: Candidate 124 live demo integration repair

The packaged demo used a 10 ms Capture with a 20 ms Whisper input declaration,
printed a SecretUrl through redacted conversion, issued only one invitation,
and waited for a receiver before draining its bounded audio stream. It now
uses 480 samples per 48 kHz frame, drains during activation, counts its requested
frames after receiver activation, and issues private application/microphone
invitations separately. Links remain redacted unless --show-private-links is
explicitly requested. Early audio termination and unsuccessful finalization
exit nonzero; remote cleanup runs even if capture close fails.

Validation: existing CLI argument checks plus six explicit MOCKED lifecycle
regressions exercise these branches, including receiver failure and capture
close failure. Real capture/browser/model evidence belongs to the parallel
Candidate 124 Lab run and remains pending. Package exports pass. Initial packed
consumer invocation lacked native-dist in the new worktree; staging the exact
unchanged accepted production binary is the prerequisite for its rerun.
Packed consumer rerun and the 24-document check pass.
No version, native/Core code, provider, dependency, hot path or live scaffold
change. This remains SAFE-TO-TEST until the real-path Lab proof is accepted.

Candidate 124 physical compilation then exposed a second demo-owned defect:
application sources declare stereo while the physical microphone declares mono.
Whisper's fixed default mono port demanded an unregistered mono-mix adapter;
forcing stereo moved the failure to the microphone edge. Neither the control
plane nor Relay caused it: the isolated Capture + Whisper graph failed alone.
The existing bounded window converter already downmixes each source using its
own channel count. Its declaration now defaults inputChannels to 'any'; explicit
1/2 constraints remain available. Public API reports reflect the additive type.
Mono and stereo two-source tests exercise real native routing and the real
converter with a mock model. A first test attempted mixed AudioInput layouts,
which Core correctly rejects; physical app/mic mixing remains the Lab gate.

The full updated SDK suite passes: 37 suites, all 467 assertions including the
real whisper-cli/model opt-in case. Physical Lab evidence at 4f3da5b confirms
mixed stereo app/mono mic compile and live transcript/browser media. It also
observes explicit model-input backpressure (shared Python/Core route behavior),
while recording and Relay delivery remain separate. The CLI now prints exact
model input dropped-frame/discontinuity totals instead of hiding them inside
collapsed metrics objects. The six lifecycle regressions verify this output.
This does not claim lossless transcription or change any queue capacity.


## 2026-09-27 — Readable navigation preserves existing join authority

Words now navigate into the original opaque join-code capability flow. Two- and
three-word visibility is deprecated formatting only. Both URL formats carry
`#join=…` and always redact credentials. New clients POST opaque codes in the
body to `/v1/join`; readable paths require the matching body `join_code`.
Deprecated secret options alias that same code and reject obsolete separate
secrets. Redirects never forward credentials. Regression cases cover words
alone, conflicting credentials, wire equivalence, redaction and opaque URLs.

Validation: 38 Jest suites / 471 assertions including actual whisper-cli model passed; API extraction, docs and TypeScript passed. Native payload unchanged; installed
archive / real service gates are recorded separately by the integrated Lab.
Staff review: purpose/API boundary is SDK control-client compatibility; enables
existing exact-bus browser joining, no new authorization model or capture path.
Unit HTTP fixtures are MOCKED and make no new real-media claim. No live scaffold
introduced; inventory n/a. CODE_PROTOCOL whitespace/type/test gates passed.
Decision: SAFE-TO-TEST pending exact packaged live integration. No release.

## 2026-09-27 — Malformed response diagnostics preserve credentials

The successful-response JSON/UTF-8 decoder now emits a fixed diagnostic. Node
parser messages can quote response bytes, including an unknown newly issued
capability; redacting only request credentials is insufficient. The error
retains its existing control.response_decode classification and no raw cause.
HTTP status, transport and body-read failures also retain only typed failure
classification/status, never arbitrary response bytes or exception messages.
Regressions cover known authorization and newly issued credentials. Scope is
control-client failure reporting; no API, native, capture, dependency or live
scaffold change. Focused control suite, typecheck and TypeScript build pass.
Final packaged Lab qualification is separate from predecessor e1ebf37 evidence.

The final independent review also replaces the malformed publisher signal-URL
parser diagnostic with a fixed message, avoiding runtime-dependent URL excerpts.
A focused regression covers the unknown credential marker and absent raw cause.
Control tests, typecheck and build pass; native/API behavior is unchanged.

## 2026-09-27 — Relay short-word navigation compatibility

Actual standalone Relay/browser qualification exposed a client mismatch: Relay
now emits ordinary three-letter words, while SDK control and browser validators
required four. Both parsers now accept 3–24 lowercase ASCII letters per word;
the upper bound preserves retained legacy compounds. Clients do not duplicate
Relay's vocabulary, generate names or derive permission from names.

72 focused control/browser assertions pass, including actual response decoding
for owl-sun and owl-sun-elm, requested natural examples, legacy compatibility,
wrong/missing capabilities and malformed two-/25-letter or four-word locators.
TypeScript build passes. The HTTP fixtures are MOCKED; exact packed consumer
qualification against real standalone/managed services belongs to Lab. No new
scaffold, native/API/dependency/version change. Inventory n/a. SAFE-TO-TEST.


## 2026-09-27 — C127 Relay-owned default name allocation

ControlClient and RelaySession omit formatting when callers do not choose it,
allowing Relay's configured default and collision fallback to apply. Additive
`wordCount: 2 | 3` selects a fixed length; deprecated `visibility` remains a
format-only compatibility option. Combining both or supplying an invalid count
fails before transport. Responses still validate their actual returned format
and preserve the same secret/redaction and exact-bus authorization boundaries.
The demo no longer forces three words. No client dictionary or policy duplicate.

Validation: 73 focused assertions, API reports/build/typecheck/docs, exports and
six demo CLI lifecycle cases PASS. All 38 Jest suites pass (497 assertions),
plus the optional real whisper-cli component passes separately, covering all
498 current assertions. The native conformance addon is the unchanged cached
Core1.1.12 artifact; production native restored before packaging. Mocked control
responses are component proof only; installed real-service Lab evidence is
separate. No new scaffold/dependency/native/version change, inventory n/a.
CODE_PROTOCOL/whitespace gates pass. SAFE-TO-TEST pending exact C127 installed
service matrix; no broader parity or model-quality claim.


C127 follow-up: the demo's primary reveal flag is `--show-links`, with neutral
credential-bearing-link copy for both name formats. `--show-private-links`
remains a deprecated, tested alias. Seven focused mocked CLI lifecycle cases
and TypeScript pass. No control/native code changed after the full suite;
package provenance is refreshed for this exact copy/flag change.


## 2026-09-27 — C128 configurable two through fifteen word names

Invitation options accept integer `wordCount` 2–15 while omission still delegates
to Relay. Created invitations, preview metadata and ReceiverInvitation expose
actual returned `wordCount`; deprecated visibility labels no longer imply three
words when a count is present. Responses must match alias cardinality, label and
any explicit requested count. Old responses missing count remain valid only for
two/three-word formatting. Null, booleans, fractions, invalid ranges and combined
count/visibility selectors fail before HTTP. Malformed response diagnostics do
not retain unknown response credentials.

Control and browser entry points share one private bounded syntax validator:
2–15 lowercase 3–24-letter words and at most134ASCIIbytes. The long per-word
compatibility bound preserves old compounds; Relay alone owns the dictionary,
phrase construction and allocation policy. No authorization behavior changes.

Validation: full38Jest suites/534cases including real whisper-cli PASS; final
focused110cases PASS adds a fifteenth-word RelaySession forwarding/count test,
so all535 current cases have executed. API reports/check, TypeScript build,
docs, package exports and seven mocked demo CLI lifecycle cases PASS. Native
production/conformance artifacts are unchanged Core1.1.12; production restored
before packing. No new dependency/native/version/live scaffold; inventory n/a.
CODE_PROTOCOL and whitespace review PASS. SAFE-TO-TEST pending installed final
C128 Lab service qualification; no broad parity, physical/model-quality or WAN
claim follows from mocked HTTP fixtures.


## W21 accepted signal drain on Session finalization — iteration129

A real finite-source model regression found final flush signals were accepted
by Core but discarded by native BusSubscription endpoint finalization. Keep the
existing bounded receipt alive after producer shutdown so consumers can drain
through natural EOF. Explicit subscription close and preparation cancellation
retain their immediate-discard behavior. No additional queue, worker, hot-path
change or public API is introduced.

New real-native regressions check queued process/flush output after stop and
explicit close. Typecheck and Rust formatting pass; current old-addon run is
expected to fail retention and the exact rebuilt Core8aa addon gate is pending.
Python equivalent now passes the two-source final-tail/lineage regression.
This step is SAFE-TO-TEST pending exact native rebuild, not a model-quality or
physical-device claim. Scaffold inventory n/a; no mock production path added.


## W21 bounded live model assembly and owned child shutdown — iteration129

The default attach/attachMany path declares one window assembler per stem and
one shared inference Operator. This prevents slow inference from blocking audio
frame assembly. A finite mono16k PCM16 window boundary preserves source/time
metadata; short fragments emit skipped-short-window duration rather than invoke
the model. Typed Transcript exposes duration/outcome/inference timing. Five-second
CPU windows are default; explicit --gpu opts in, --no-gpu states CPU selection.
The CLI child is owned, killed and joined on close; temporary audio is removed
only after child exit. The demo listens for owner renewal failure and aborts its
owned capture. Low-level direct providers remain documented separately.

Validation: typecheck, API update, docs, mocked CLI lifecycle, bounded codec and
owned-child cancellation regressions pass. Per-stem native EOF/lineage proof
awaits rebuilt Core8aa addon; Python same graph passes. Prior failed ordinary
model and split diagnostics remain in iteration129 evidence. No semantic/latency
or physical proof is inferred from these tests; exact installed real-model gates
follow. New queue values remain bounded by existing Core edges and1MiB payloads.
No provider code moves into Core; no production scaffold added. SAFE-TO-TEST.
## W21 bounded automatic Session ownership — 2026-09-27

RelaySession now bootstraps and serially renews its owner capability before
expiry. Public ControlClient.renewSession and SessionOwner.maintain provide the
same lifecycle to direct control callers. Scheduling uses half the authoritative
remaining lifetime (maximum five-minute wait), at most three transient attempts,
and bounded request deadlines. Current credentials are immutable snapshots;
close stops timers, joins the bounded in-flight renewal, then deletes with its
newest capability. Invalid bootstrap responses trigger RelaySession cleanup.
Terminal failures are sanitized and observable through renewalFailureSignal and
renewalFailure; cleanup cannot turn a renewal failure into false success.

The native publisher still admits once and treats signaling loss as terminal;
management renewal does not implement media reattachment. Documentation describes
that boundary and the required owner-before-ControlClient disposal order.

Validation: 59 focused control/owner/Relay tests PASS; full39 suites/540 tests PASS
with one optional real-whisper fixture skipped. Prior qualified Core1.1.12
conformance addon99f248d82754222923ed201b34c6132709809716ea3f792db61c026511627d36
was mounted through an owned dependency projection without modifying archived
packages. NewCore5de native qualification and physical proof are separately
owned; this result qualifies the JavaScript lifecycle delta only. API reports and
API check/TypeScript build,24 documentation files and package exports PASS.
Initial host-pressure timeout and production-addon conformance-unavailable run
are retained in evidence rather than discarded. New tests cover repeated expiry
cycles, transient/permanent failure, redaction, invalid bootstrap, and close racing
a successful renewal. No new dependency, native edit, release, or live scaffold.
Scaffold inventory n/a. CODE_PROTOCOL/whitespace review PASS. SAFE-TO-TEST pending
root's integrated current-native Lab qualification. Evidence:
/private/tmp/pks-renewal-129-evidence/js.


### Accepted-output wrapper follow-up

The rebuilt native receipt exposed a second early-EOF path: the TypeScript
Session wrapper marked all signal streams closed after stop. Remove that mark;
readers now drain the bounded native receipt and observe its actual EOF. Four
real-native tests pass: two-stem slow inference with all EOF tails and correct
outer lineage, child cancellation cleanup, and retained versus explicitly
closed subscriptions. The executable demo file mode is preserved after editing.
Native tree remains c02e4e11; no additional native rebuild required.


### Combined C129 qualification

Owner renewal2cd61c is integrated with model/receipt fixes. Exact native tree
c02e4e11 rebuilt against Core8aa: all42 Jest suites pass546 assertions with
one separately exercised optional real-model case. Real retained-WAV inference
uses CPU4 (the shipped default),5s windows,beam1: application WER4.55%, microphone
WER0%, full11s/4s coverage, zero drops, workloadRTF0.281, first application result
6.024s and finalization1.515s. The CPU2 follow-up missed2s finalization (2.684s)
and is retained as a failure. A finite4s microphone cannot form a5s full window;
its first tail arrives at Session finalization, so this case does not qualify a
7s microphone first-result claim. Long equal-duration Lab replay must test that.
All evidence is LOOPBACK-ONLY retained audio, not new physical capture. API,
docs, typecheck, mocked CLI lifecycle, bounded child cleanup and exports pass.


### C129 deterministic complete-window overload follow-up (test-only)

Two actual native PCM/recording tests hold one mocked model inference while
feeding both stems, filling the existing16-window aggregate capacity. Each
observes23 dropped complete model windows, zero audio/recording loss, and
source sequence gaps after recovery. Recover and abort finalize in107/165ms
(2s budget); all workers join. Abort calls the owned model cancellation hook,
produces no late transcript, and does not run queued inference. No model quality
or physical-device claim follows from this MOCKED callback/LOOPBACK-ONLY gate.
Focused Jest2/2 and TypeScript pass. Only tests and this progress file changed;
production source/native trees and the105a812 package remain byte-identical.


## C130 — explicit bounded source-affine model concurrency

Purpose: first-window inference on one stem must not necessarily wait for the
other stem's complete model call. `inferenceConcurrency` (default1, maximum8)
assigns sources stably to owned inference Operators; `cpuThreads` is their total
budget, and parallel mode requires numWorkers1. Per-stem assemblers and Core's
existing finite edges remain unchanged. A typed MANY-input forwarding Operator
merges parallel transcripts with original lineage and no second scheduler. Each
worker owns cancellation/close of its model child. General optional initialPrompt
is bounded to2048 UTF-8 bytes, forwarded literally, and never fixture-specific.
The installed demo exposes explicit concurrency/thread/prompt flags.

Native mock regressions verify simultaneous inference,5-thread budget split2+3,
source affinity, outer/payload lineage, both-source EOF, recording completeness
and joined stop/abort. Literal executable prompt forwarding and invalid limits
are covered. Existing serial overload isolation remains passing. Full44 Jest
suites pass557 assertions with one optional real-model test left to Lab; API,
TypeScript, docs, installed CLI mock lifecycle and exports pass. Native/Core
source and bytes are unchanged from129; production addon restored after using
the exact matching conformance addon. No native rebuild or new dependency.

Existing unprompted ComfyUI45s quality FAIL is preserved. Exact18-window offline
equivalence and bounded2xCPU2 feasibility motivate the change but do not qualify
new latency/quality. Prompt-assisted/independent-reference real-path acceptance
belongs to Lab. Tests here use MOCKED finite models and LOOPBACK-ONLY native
PCM; no physical-device or full-parity claim. Scaffold inventory: no new live
scaffold; mock-only test doubles explicit. CODE_PROTOCOL: provider outsideCore,
Session/Operator vocabulary, finitequeues/lifecycle, units, type/API/docs gates
and diff whitespace check PASS. Staff decision SAFE-TO-TEST pending realmodelLab.

## Product130: explicit local encoder-context budget

The demo-owned whisper-cli adapter accepts optional audioContextSeconds, bounded
by the configured input window and thirty seconds. It maps seconds to fifty
encoder positions per second (rounded up); direct model input exceeding that
context fails rather than truncates. Omission preserves existing backend
defaults. Per-source workers inherit the setting and the CLI exposes it. This
changes padding/encoder work and potentially text, never input window length,
Session clocks, model queues or acceptance thresholds. Python faster-whisper
has no equivalent variable encoder-context API; no false symmetry was added.

The unchanged corpus replay passed coverage, WER, loss and workload gates but
failed first-result latency at7.32/7.35seconds. Offline first-window diagnosis
with the same model/audio/CPU4 found the default context took2.056/2.045seconds;
ten-second context took1.016/.756seconds. A single subsequent18-window corpus
diagnostic scored WER.2653/.1549 against the same published text, retaining
silence outputs in the score. These are feasibility results, not integrated
acceptance; all old failed evidence remains unchanged.

Focused native/mock tests31pass (one optional realmodel case skipped), type/API,
docs, exports and seven mocked CLI lifecycle cases pass. Tests reject invalid
context/window combinations and oversized direct input, check default omission,
literal CLI unit conversion and worker propagation. Native source/artifacts and
dependencies remain unchanged. Evidence is retained under
/private/tmp/pks-product-130-evidence/model/first-result-diagnostic. No live
scaffold (inventory n/a); provider ownership, bounded resources, units and
whitespace CODE_PROTOCOL checks pass. SAFE-TO-TEST pending the fresh declared
ten-second-context Lab profile with all original thresholds.


### Consolidation 131 — accepted work and preserved canonical edits

Local main fast-forwards to accepted 56b580b before reconciliation. Exact original
staged/unstaged/untracked bytes and Git stash objects are retained in root
`consolidation-131/sdk-js` evidence and `refs/preserve/consolidation-131/`.
Retain the useful owned RelaySession README journey using current per-bus,
redacted invitation APIs, and the explicit PCM-source lifecycle test variant;
the adjacent audioInput compatibility test remains. Preserve accepted complete
progress, required lifecycle mock, readable formatting, equivalent selector
checks, and native bytes instead of replaying older deletions/cosmetic edits.
The preserved historical source/authorization parity note remains available in
the exact snapshot; it is not a fresh qualification of current artifacts.

Validation is recorded in consolidation-131 evidence. No native implementation,
model behavior, package version, or product-proof claim changes in this step.
Staff gate: ownership and vocabulary preserved; no new scaffold; component
qualification only, retained live evidence remains scoped to its original bytes.

Canonical qualification: 44 Jest suites / 566 passed assertions, one explicitly
optional real-model test skipped; API/type, docs, CLI, export-resolution and
example compilation gates PASS. Initial stale-dist package check failure was
retained, TypeScript regenerated, then the complete suite rerun. Production
native and TypeScript source bytes match accepted 56b580b; this commit changes
only documentation/progress and the explicit PCM lifecycle regression variant.
