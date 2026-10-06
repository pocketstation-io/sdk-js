# PocketStation for JavaScript release notes

## Unreleased

## 0.1.5 — 2026-10-06

The Node entry point adds Core-owned live audio history and finalized recording
clips. Declare `Session.audioHistory()`, route selected sources with
`retainAudio()`, and read owned WAV Buffers with exact source, stem, clock and
sample provenance. Default retention is 30 seconds, 16 MiB of PCM and 4096
buffers shared across the selected stems. Missing, expired and not-yet-captured
context are explicit errors. Native read work runs outside the event loop;
callers control request concurrency. Timestamps and sample counters preserve
their full integer range with `bigint`. See the
[recording guide](docs/guides/recording-clips.md).

The matching Core version is 1.1.13. Default addons omit the portable AEC engine;
explicit AEC builds use the same existing package names. Session composition
rejects two AEC stages on one microphone. Native output-device processing is an
explicit request that requires an attested active route. Native macOS/Linux AEC
routes remain unavailable, and Windows acoustic qualification remains in
progress. No automatic processing or scope widening is introduced.

Installed macOS artifacts passed the controlled-PCM Lab workflow with the
Python consumer, concurrent recording, history reads, expiry and cancellation.
This is a same-host integration result, not physical acoustic qualification.
