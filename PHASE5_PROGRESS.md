# JavaScript SDK progress

## Active work

`W21-JAVASCRIPT-SOURCE-LIFECYCLE` is active under the recorded
`phase-exception-approved` decision.

The repository now contains a browser Relay client and the first working Node
binding for native capture. It must not yet be described as feature-equivalent
to the Rust or Python packages.

This step adds every built-in Core Source selection, native discovery,
non-prompting permission observations, pre-open authorization evidence,
permission-change tracking, and one typed Session event stream. The event
stream includes source disappearance without consuming or hiding other Session
events.

This step adds the first real Node slice:

```text
Source declaration
→ Rust Session
→ source-aware Stem
→ Core audio endpoint
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
permission inspection, declares each built-in Source form, and verifies a
typed startup failure without opening a microphone.

## Staff Bar Self-Check — JavaScript Source lifecycle

- Smallest correct design: yes — Core remains the source of discovery,
  permission, identity, and lifecycle truth; TypeScript provides safe values
  and explicit selection.
- Tests added or updated: yes — every selector, discovery filters, permission
  transitions, authorization evidence, Session event projection, reader
  exclusivity, abort, package exports, and a clean tarball consumer.
- Hot-path safe: yes — Core remains authoritative and the addon copies frames
  only after the native endpoint receives them.
- Public API changed: yes — the unpublished Node entry gains Source discovery,
  permissions, exact selectors, and Session events.
- New dependency: yes — the user-approved implementation uses released Core
  `1.1.10`, napi-rs, and API Extractor for the public API report. No provider or
  media-runtime dependency is added, and the installed package has no runtime
  npm dependency.
- Phase scope respected: yes — the execution task records
  `phase-exception-approved`.
- Unsafe added: no.
- Remaining risk: target-specific native packaging and real Windows/Linux
  execution are later gates and must not be inferred from the local macOS run.

## Intentionally not included in this step

- provider packages or API keys;
- Electron application code;
- application-owned PCM, custom Sources, graph Operators, Connectors, sidecars,
  extensions, Relay composition, or voice composition;
- publication, tags, or version selection;
- cross-platform or performance claims.
