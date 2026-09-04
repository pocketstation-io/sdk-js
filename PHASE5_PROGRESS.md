# JavaScript SDK progress

## Active work

`W21-JAVASCRIPT-SDK-STRUCTURE` is active under the recorded
`phase-exception-approved` decision.

The repository now contains a browser Relay client and the first working Node
binding for native capture. It must not yet be described as feature-equivalent
to the Rust or Python packages.

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

The installed-package gate will pack the package into a new directory, install
only the tarball, load the native addon, declare selected-application capture,
and close the Session cleanly. Physical capture evidence is recorded separately
because a compile or synthetic test cannot prove a real desktop source.

## Staff Bar Self-Check — JavaScript SDK structure

- Smallest correct design: yes — one real Session/source/stream slice before
  graph, Relay, provider authoring, and voice composition.
- Tests added or updated: yes — native build checks, TypeScript behavior,
  exclusive-reader and abort races, package exports, a clean tarball consumer,
  and a physical macOS source.
- Hot-path safe: yes — Core remains authoritative and the addon copies frames
  only after the native endpoint receives them.
- Public API changed: yes — the unpublished package gains explicit `node` and
  `browser` entry points.
- New dependency: yes — the user-approved implementation uses released Core
  `1.1.10`, napi-rs, and API Extractor for the public API report. No provider or
  media-runtime dependency is added, and the installed package has no runtime
  npm dependency.
- Phase scope respected: yes — the execution task records
  `phase-exception-approved`.
- Unsafe added: no.
- Remaining risk: target-specific native packaging and real Windows/Linux/macOS
  execution are later gates and must not be inferred from a local build.

## Intentionally not included in this step

- provider packages or API keys;
- Electron application code;
- graph Operators, custom Sources, Connectors, sidecars, extensions, Relay, or
  voice composition;
- publication, tags, or version selection;
- cross-platform or performance claims.
