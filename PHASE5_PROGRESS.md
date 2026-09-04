# JavaScript SDK progress

## Completed work

`W21-JAVASCRIPT-APPLICATION-AUDIO-INGRESS` is complete under the recorded
`phase-exception-approved` decision.

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

- Browser Relay client: `PARTIAL`; current tests use mocked fetch and do not
  prove a deployed Relay or browser receiver.
- Node native capture: `PARTIAL`; a clean macOS ARM64 tarball consumer loads the
  addon, and physical selected-application capture delivered twenty consecutive
  10 ms stereo frames with source and Stem identity.
- Full Rust/Python API coverage: not complete. The current row-by-row status is
  recorded in `docs/JAVASCRIPT_CAPABILITY_MATRIX.md`.
- Source lifecycle: `PARTIAL`; all built-in selectors and local macOS
  discovery, permission inspection, lifecycle transitions, and Session events
  pass. Windows and Linux target execution remain later gates.
- Graph declarations: `PARTIAL`; native validation, negotiation, route settings,
  named-port composition, recording declarations, generated-audio lowering, and
  compiler diagnostics pass. JavaScript provider implementations and typed
  signal consumption remain later work.
- Recording: `PARTIAL`; a real local macOS system-audio Session captured five
  non-silent frames and finalized a 917,572-byte WAV with no recorded gaps or
  Session failures. Per-Stem outcome projection remains later observation work.
- Application-owned PCM: `REAL` for the current component scope;
  `Float32Array` and float32-LE `Buffer` inputs copy into Core-owned storage,
  fixed capacity and typed failures are visible, `write()` has a finite timeout
  and `AbortSignal`, and accepted frames preserve native identity and timing.
- npm package: not published.

The browser entry now uses `RelaySession`, shares `PocketStationError` with the
Node entry, and never supplies a hardcoded ICE server when the control service
does not return one. The old unpublished `RoomClient` API and its generated
files are removed rather than retained as aliases.

The physical 10 ms run exposed variable CoreAudio process-tap callback sizes.
Core commit `a2bb0e12e3d38aca6bf72eee02773e6830d58ccb` now assembles those native
batches into the selected Session frame size and passes the complete Core test
and clippy gates. The SDK manifest has returned to released Core `1.1.10`;
publication waits for an approved Core `1.1.x` release containing that fix.

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
discontinuity, and clean shutdown. It does not open a microphone.

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
- Remaining risk: provider execution, selected-output cancellation, typed
  signal consumption, per-Stem
  recording outcomes, target packages, and real Windows/Linux execution are
  later gates and must not be inferred from the local macOS run.

## Intentionally not included in this step

- provider packages or API keys;
- Electron application code;
- JavaScript Operator or Endpoint implementations, Connectors, sidecars,
  extensions, Relay composition, or voice composition;
- publication, tags, or version selection;
- cross-platform or performance claims.
