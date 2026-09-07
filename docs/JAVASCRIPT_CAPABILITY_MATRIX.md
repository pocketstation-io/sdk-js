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
| Abort and deterministic stream close | `REAL` | `REAL` | `REAL`; reads check cancellation at most every 20 ms, final received audio is retained, and a signal subscription closes independently | `src/node/streams.ts`, `src/node/signals.ts` |
| PCM application input | `REAL` | `REAL` | `REAL`; Float32Array and explicit float32-LE Buffer writes, fixed capacity, discontinuity, timeout, AbortSignal, close, observations, identity, and timing pass through Core | `src/node/application-audio.ts`, `native/src/application_audio.rs` |
| Generated-audio reentry | `REAL` | `REAL` | `REAL` for the current component scope; JavaScript Operators emit exact PCM through Core with retained derivation and a generated Source identity; selected-output cancellation remains later work | `src/node/provider.ts`, `native/src/provider.rs` |
| Typed signals and `BusSubscription` | `REAL` | `REAL` | `REAL`; Core-backed audio, text, and bytes, lineage, derivation, one-reader ownership, explicit timeout/EOF, close, and queue metrics pass | `src/node/signals.ts`, `native/src/signals.rs` |
| Operators with named typed ports | `REAL` | `REAL` | `REAL` for off-realtime JavaScript implementations; validation, create, prepare, process, flush, cancel, close, named outputs, lineage, and exact PCM reentry pass through Core | `src/node/provider.ts`, `native/src/provider.rs` |
| Route settings, media requirements, and delivery policy | `REAL` | `REAL` | `REAL` for declaration, native validation, compatibility, and negotiation | `src/node/graph.ts`, `native/src/graph.rs` |
| Built-in and custom Endpoints | `REAL` | `REAL` | `REAL` for the current component scope; Node audio, recording, open native declarations, and class/function JavaScript Endpoints with audio or typed inputs execute through Core lifecycle and outcomes | `src/node/provider.ts`, `native/src/provider.rs` |
| Class and function Connector authoring | `REAL` | `REAL` | `REAL` for the current component scope; one object may receive multiple source-aware routes through one lifecycle, with finite dispatch, deadlines, cancellation, and exact cleanup | `src/node/connector.ts`, `native/src/provider.rs` |
| Source and Operator authoring | `REAL` | `REAL` | `REAL` for the current component scope; typed Source identity/timing and off-realtime Operator processing execute through Core; JavaScript PCM ingress remains `AudioInput` | `src/node/provider.ts`, `native/src/provider.rs` |
| Recording and per-stem outcomes | `REAL` | `REAL` | `REAL` for the component scope; final state, files, per-Stem delivery, errors, and discontinuities pass from Core without numeric precision loss | `src/node/observations.ts`, `native/src/observations.rs` |
| Events, metrics, traces, and terminal outcomes | `REAL` | `REAL` | `REAL` for the component scope; live and final metrics, closed event types, complete retained failures, checksummed trace reading and validation, and explicit unavailable results pass | `src/node/events.ts`, `src/node/observations.ts`, `native/src/observations.rs` |
| Native extension libraries | `REAL` | `REAL` | `REAL` for the component scope; ABI validation, absolute trusted-library loading, transactional registration, generic Source execution, lifetime retention, and packed exports pass on macOS | `src/node/extensions.ts`, `native/src/extensions.rs` |
| Managed sidecars | `REAL` | `REAL` | `REAL` for the component scope; copied `Buffer` messages, 64-message default capacity, immediate saturation errors, 1,000 ms maximum reads, Session ownership, PKSS failure, close/cancel, forced kill, reap counters, and packed execution pass on macOS | `src/node/sidecar.ts`, `native/src/sidecar.rs` |
| Shared Relay publication | `REAL` | `REAL` | absent in Node | Relay workflow wave |
| Browser Relay receiver | `REAL` in shared services | `REAL` through shared Relay | `PARTIAL` implementation, `MOCKED` tests | `src/browser` and Relay workflow wave |
| Provider-neutral voice composition | not a Core concern | `PARTIAL`; real orchestration, no bundled provider and no continuous-duplex proof | absent | voice wave after base parity |
| Installed target packages | crates.io | PyPI wheels and source package | `PARTIAL`; local macOS tarball consumer passes PCM, Extension ABI, and a real managed child process; npm and other targets remain | packaging and cross-platform waves |

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
