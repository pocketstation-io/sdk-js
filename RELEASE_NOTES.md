# PocketStation for JavaScript release notes

## Unreleased

## 0.1.6 — 2026-10-31

The native binding uses published PocketStation Core 1.1.15. The Node API adds
immutable process observations with exact `bigint` start times and explicit
capture of 1–32 original application process instances. `captureProcessSet()`
returns the existing `SourceOutput`, so selected audio can fan out through the
same Session routes.

Exact process sets require macOS 26 or newer; unsupported platforms return a
typed error. Surviving original members may continue after another exits, but
replacement processes are never followed. Losing every original member fails
explicitly, and selecting fresh membership requires a new Session. There is no
microphone, application or system-audio fallback.

Ordinary native packages continue to omit AEC and retain Relay connector 0.1.6.
All six native archives and the root package passed installed-consumer
qualification across Node 20.17.0, 20, 22, 24 and 26 before publication.
Physical capture and Relay evidence remain separate from that component proof.

## 0.1.5 — 2026-10-26

Ordinary native packages include Relay WebSocket publication by default through
the released `pocketstation-relay 0.1.6` Connector. Applications can query
availability before explicitly selecting WebSocket; unsupported addons fail
without silently falling back to another transport. Static WebSocket sessions
ignore unused advertised ICE metadata, while WebRTC retains its existing TURN
and credential-bearing ICE restrictions.

The Node entry point adds Core-owned live audio history and finalized recording
clips. Declare `Session.audioHistory()`, route selected sources with
`retainAudio()`, and read owned WAV Buffers with exact source, stem, clock and
sample provenance. Default retention is 30 seconds, 16 MiB of PCM and 4096
buffers shared across the selected stems. Missing, expired and not-yet-captured
context are explicit errors. Native read work runs outside the event loop;
callers control request concurrency. Timestamps and sample counters preserve
their full integer range with `bigint`. See the
[recording guide](docs/guides/recording-clips.md).

The matching Core version is 1.1.14. Default addons omit the portable AEC engine;
explicit AEC builds use the same existing package names. Session composition
rejects two AEC stages on one microphone. Native output-device processing is an
explicit request that requires an attested active route. Native macOS/Linux AEC
routes remain unavailable, and Windows acoustic qualification remains in
progress. No automatic processing or scope widening is introduced.

Installed macOS artifacts passed the controlled-PCM Lab workflow with the
Python consumer, concurrent recording, history reads, expiry and cancellation.
This is a same-host integration result, not physical acoustic qualification.
