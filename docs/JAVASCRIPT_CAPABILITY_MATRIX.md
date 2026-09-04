# JavaScript capability status

This page compares the released Rust engine and Python SDK with the code that
exists in this repository. It is a work list, not a parity claim.

`REAL` means the JavaScript package contains working code and direct tests for
the named behavior. `PARTIAL` names the cases that work and leaves the missing
cases visible. Browser tests that replace the service with mocked fetch remain
`MOCKED`.

| Area | Rust 1.1.10 | Python 0.1.4 | JavaScript now | JavaScript owner |
|---|---|---|---|---|
| Session declaration and start | `REAL` | `REAL` | `PARTIAL`; native start and typed failure pass on macOS | `src/node/session.ts`, `native/src/session.rs` |
| Application Source, including exact smart string selection | `REAL` | `REAL` | `PARTIAL`; declaration and physical macOS capture pass | `src/node/sources.ts`, `native/src/sources.rs` |
| Explicit microphone Source | `REAL` | `REAL` | `PARTIAL`; default and stable device declarations work, physical proof pending | `src/node/sources.ts`, `native/src/sources.rs` |
| Explicit system-audio Source | `REAL` | `REAL` | `PARTIAL`; declaration and real local Session start pass, audio proof pending | `src/node/sources.ts`, `native/src/sources.rs` |
| Source discovery and permission observations | `REAL` | `REAL` | `REAL` on the local macOS host; target evidence pending | `src/node/sources.ts`, `native/src/sources.rs` |
| Stable Source identity and process-instance selection | `REAL` | `REAL` | `REAL`; exact 64-bit identity and all Core selection forms pass | `src/node/sources.ts`, `native/src/sources.rs` |
| Source-aware audio frames and full lineage | `REAL` | `REAL` | `PARTIAL`; macOS application frames preserve all current Core fields | `src/node/streams.ts`, `native/src/streams.rs` |
| 10 ms and 20 ms frame profiles | `REAL` | `REAL` | `PARTIAL`; both declare, physical 10 ms macOS proof passes with unreleased Core fix | `src/node/session.ts`, native Session construction |
| Exclusive async stream readers | `REAL` | `REAL` | `REAL`; direct reads and iteration reject a concurrent reader | stream protocols wave |
| Abort and deterministic stream close | `REAL` | `REAL` | `PARTIAL`; reader abort and final-frame delivery pass, target shutdown proof pending | stream protocols wave |
| PCM application input and generated-audio reentry | `REAL` | `REAL` | `PARTIAL`; generated-audio declarations lower through Core, application-owned PCM and real provider execution remain | provider-authoring wave |
| Typed signals and `BusSubscription` | `REAL` | `REAL` | absent | graph and stream waves |
| Operators with named typed ports | `REAL` | `REAL` | `PARTIAL`; declarations and native compiler diagnostics pass, JavaScript implementations remain | provider-authoring wave |
| Route settings, media requirements, and delivery policy | `REAL` | `REAL` | `REAL` for declaration, native validation, compatibility, and negotiation | `src/node/graph.ts`, `native/src/graph.rs` |
| Built-in and custom Endpoints | `REAL` | `REAL` | `PARTIAL`; Node audio, recording, and open native Endpoint declarations work; authoring remains | provider-authoring wave |
| Class and function Connector authoring | `REAL` | `REAL` | absent | provider-authoring wave |
| Source and Operator authoring | `REAL` | `REAL` | absent | provider-authoring wave |
| Recording and per-stem outcomes | `REAL` | `REAL` | `PARTIAL`; real local system-audio recording passes, typed per-Stem outcome remains | observation wave |
| Events, metrics, traces, and terminal outcomes | `REAL` | `REAL` | `PARTIAL`; lifecycle, source, Endpoint, rollback, finalization, and terminal events work; metrics and traces remain | `src/node/events.ts`, observation wave |
| Native extension libraries | `REAL` | `REAL` | absent | extensions and sidecars wave |
| Managed sidecars | `REAL` | `REAL` | absent | extensions and sidecars wave |
| Shared Relay publication | `REAL` | `REAL` | absent in Node | Relay workflow wave |
| Browser Relay receiver | `REAL` in shared services | `REAL` through shared Relay | `PARTIAL` implementation, `MOCKED` tests | `src/browser` and Relay workflow wave |
| Provider-neutral voice composition | not a Core concern | `PARTIAL`; real orchestration, no bundled provider and no continuous-duplex proof | absent | voice wave after base parity |
| Installed target packages | crates.io | PyPI wheels and source package | `PARTIAL`; local macOS tarball consumer passes, npm and other targets pending | packaging and cross-platform waves |

## First completion slice

The first slice is deliberately small but real:

```ts
const session = new Session({ frameDurationMs: 10 });
const application = session.capture(Source.application("Spotify"));
application.send(session.audio());

await using running = await session.start();
for await (const frame of running.audio) {
  console.log(frame.sourceId, frame.timestampStartNs);
}
```

The microphone is never opened implicitly. A later convenience function must
compile into the same Session declarations rather than hide a separate runtime.

## Claim rule

JavaScript reaches Python capability coverage only after every row above is
implemented or explicitly removed from the supported scope, the packed package
runs from a clean consumer, and every claimed native artifact executes on its
target operating system. A local macOS addon proves only that local target.

The macOS 10 ms proof exposed a CoreAudio process-tap defect and passed after
Core commit `a2bb0e12e3d38aca6bf72eee02773e6830d58ccb`. The JavaScript package
returns to the released Core dependency before packaging. A publishable SDK
therefore waits for that Core fix to receive an approved `1.1.x` release.
