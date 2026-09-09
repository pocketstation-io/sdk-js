# JavaScript capability status

This page compares the released Rust engine and Python SDK with the code that
exists in this repository. It states what an application can rely on today; it
is not a parity claim.

`REAL` means the JavaScript package contains working code and direct tests for
the named behavior. `PARTIAL` names the cases that work and leaves the missing
cases visible. Browser tests that replace the service with mocked fetch remain
`MOCKED`.

| Area | Rust 1.1.10 | Python 0.1.4 | JavaScript now |
|---|---|---|---|
| Session declaration and start | `REAL` | `REAL` | `PARTIAL`; native start and typed failure pass on macOS |
| Concise application capture | `REAL` | `REAL` | `REAL`; `capture()` uses the same Session, while microphone and recording remain opt-in |
| Application Source, including exact smart string selection | `REAL` | `REAL` | `PARTIAL`; declaration and physical macOS capture pass |
| Explicit microphone Source | `REAL` | `REAL` | `PARTIAL`; default and stable device declarations work, physical proof pending |
| Explicit system-audio Source | `REAL` | `REAL` | `PARTIAL`; declaration and a local Session start pass, audio proof pending |
| Source discovery and permission observations | `REAL` | `REAL` | `REAL` on the local macOS host; other targets remain unproven |
| Stable Source identity and process-instance selection | `REAL` | `REAL` | `REAL`; exact 64-bit identity and all Core selection forms pass |
| Source-aware audio frames and complete lineage | `REAL` | `REAL` | `PARTIAL`; macOS application frames preserve all current Core fields |
| 10 ms and 20 ms frame profiles | `REAL` | `REAL` | `PARTIAL`; both declare, and physical 10 ms macOS capture passes with an unreleased Core correction |
| Exclusive async stream readers | `REAL` | `REAL` | `REAL`; direct reads and iteration reject a concurrent reader |
| Abort and deterministic stream close | `REAL` | `REAL` | `REAL`; reads check cancellation at most every 20 ms, final received audio is retained, and a signal subscription closes independently |
| PCM application input | `REAL` | `REAL` | `REAL`; typed arrays and explicit float32-LE buffers, fixed capacity, discontinuity, timeout, `AbortSignal`, close, observations, identity, and timing pass through Core |
| Generated-audio reentry and selected-output cancellation | `REAL` | `REAL` | `REAL` for component tests; application PCM and JavaScript Operator audio enter Core with output identity, and one obsolete output can be cancelled without stopping capture or the Session |
| Typed signals and `BusSubscription` | `REAL` | `REAL` | `REAL`; Core-backed audio, text, and bytes, lineage, derivation, one-reader ownership, explicit timeout/end, close, and queue metrics pass |
| Operators with named typed ports | `REAL` | `REAL` | `REAL` for off-realtime JavaScript implementations; validation, create, prepare, process, flush, cancel, close, named outputs, lineage, and exact PCM reentry pass through Core |
| Route settings, media requirements, and delivery policy | `REAL` | `REAL` | `REAL` for declaration, native validation, compatibility, and negotiation |
| Built-in and custom Endpoints | `REAL` | `REAL` | `REAL` for component tests; Node audio, recording, open native declarations, and class/function JavaScript Endpoints with audio or typed inputs execute through Core lifecycle and outcomes |
| Class and function Connector authoring | `REAL` | `REAL` | `REAL` for component tests; one object may receive several source-aware routes through one lifecycle, with finite dispatch, deadlines, cancellation, and cleanup |
| Source and Operator authoring | `REAL` | `REAL` | `REAL` for component tests; typed Source identity and timing plus off-realtime Operator processing execute through Core; JavaScript PCM input remains `AudioInput` |
| Recording and per-stem outcomes | `REAL` | `REAL` | `REAL` for component tests; final state, files, per-Stem delivery, errors, and discontinuities pass from Core without numeric precision loss |
| Events, metrics, traces, and final outcomes | `REAL` | `REAL` | `REAL` for component tests; live and final metrics, closed event types, retained failures, checksummed trace validation, and explicit unavailable results pass |
| Native extension libraries | `REAL` | `REAL` | `REAL` for macOS component tests; ABI validation, trusted-library loading, transactional registration, generic Source execution, lifetime retention, and packed exports pass |
| Managed sidecars | `REAL` | `REAL` | `REAL` for macOS component tests; copied buffers, fixed capacity, immediate saturation errors, finite reads, Session ownership, protocol failure, close/cancel, forced kill, and process reaping pass |
| Shared Relay publication | `REAL` | `REAL` | `PARTIAL`; Node declares grouped named buses through released `pocketstation-relay 0.1.5`, while real service/browser proof remains active |
| Browser Relay receiver | `REAL` in shared services | `REAL` through shared Relay | `PARTIAL` implementation with `MOCKED` network tests |
| Provider-neutral voice composition | Not part of Core | `PARTIAL`; real orchestration, no bundled provider and no continuous-duplex proof | Not available |
| Installed target packages | crates.io | PyPI wheels and source package | `PARTIAL`; a local macOS tarball passes component use, while npm and other targets remain unavailable |

## Explicit Session API

Use the explicit Session when the application needs to add its own processing,
destinations, or recording before startup:

```ts
const session = new Session({ frameDurationMs: 10 });
const application = session.capture(Source.application("Spotify"));
application.send(session.audio());

await using running = await session.start();
for await (const frame of running.audio) {
  console.log(frame.sourceId, frame.timestampStartNs);
}
```

The concise `capture()` function creates the same declaration. Neither API opens
a microphone implicitly.

## Claim rule

JavaScript reaches Python capability coverage only after every row above is
implemented or explicitly removed from the supported scope, the packed package
runs from a clean consumer, and every claimed native artifact executes on its
target operating system. A local macOS addon proves only that local target.

The macOS 10 ms proof exposed a CoreAudio process-tap defect and passed with the
correction in the current Core source. The JavaScript package returns to a
released Core dependency before packaging, so npm publication waits for an
approved `1.1.x` release that contains the correction.
