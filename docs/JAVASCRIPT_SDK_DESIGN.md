# JavaScript SDK design

PocketStation for JavaScript has two independent uses:

- Node captures and processes desktop audio through the native Rust engine.
- Browsers receive audio that a Session publishes through PocketStation Relay.

Browser code never loads the native addon. Node code never starts a Relay or
opens a microphone unless the application asks for it.

## Node lifecycle

A `Session` is a declaration. Calling `capture()` adds one Source and returns a
`Stem`. Calling `send()` routes that Stem to an Endpoint. `start()` validates
the complete declaration, opens native resources, and returns a
`RunningSession`.

The first supported Endpoint is the Session audio stream:

```ts
const output = session.audio();
const application = session.capture(Source.application("Spotify"));
application.send(output);
```

Several Sources can send to the same output. Frames retain the identity of the
Source and Stem that produced them.

## Discovery and selection

`discoverSources()` reads one native snapshot and may filter it by application,
kind, stable key, or active playback. JavaScript does not rebuild or hash source
identity. Core supplies the stable key and immutable 64-bit Source identity.

`Source.application()` accepts an exact name or application ID, a process ID,
a discovered stable identity, or a process-instance selection. Name and
application-ID matching rejects missing and ambiguous results before capture
starts; it never selects the first partial match. `Source.fromDiscovered()`
chooses the strongest supported selector for a discovery result.

Permission inspection is non-prompting. `not-observable` means the operating
system did not provide an authoritative answer. It is never converted to
`allowed`, even if a later open succeeds.

## Native ownership

One Rust worker owns each running Core Session. JavaScript sends finite read,
state, stop, and cancel requests to that worker. Waiting for audio and joining
the Session happen outside the JavaScript event loop.

Core owns the media queues. The SDK does not add a second audio queue. A native
audio batch is copied into JavaScript-owned memory when it is read, after it has
left the realtime part of the engine.

## Stream ownership

`running.audio` permits one active reader across direct `read()` calls and async
iteration. A second reader fails immediately because silently dividing frames
between consumers would make delivery and shutdown ambiguous.

The normal API is an async iterator. Breaking the loop releases the reader; it
does not stop the Session. `AbortSignal` is checked before and after each native
wait, which is limited to 100 ms by default. If a frame arrives while the signal
is being aborted, the SDK retains that frame for the next reader instead of
discarding it. The caller decides whether to stop or cancel the Session.

## Exact values

JavaScript `number` cannot represent every Rust `u64`. Source, Stem, Stream,
route, Session, sequence, epoch, and nanosecond fields are therefore public
`bigint` values. The native addon transfers them as decimal strings and the
TypeScript layer performs the exact conversion outside the media thread.

## Failure behavior

Errors retain a stable PocketStation code and explain the failed operation.
Starting twice fails. A Source or Endpoint from another Session cannot be used.
An invalid selector fails before native resources start. A stopped Session ends
the iterator and makes later reads fail clearly.

`running.events` is the sole JavaScript reader for Core Session events. It
includes lifecycle changes, source disappearance, Endpoint failures, rollback,
finalization, and the terminal result. Source failures retain the platform,
stable key, Source identity, Stem identity, generation, native operation, and
recovery requirement. This avoids a separate source-only reader consuming and
hiding events needed by the rest of the application.

Dropping a running JavaScript object requests native shutdown without blocking
garbage collection. Applications that need recording or delivery outcomes must
call `stop()` or `cancel()` explicitly and await the result.

## Current platform evidence

The clean tarball consumer loads the native addon and exercises Session,
Source, Stem, route, and startup failure on macOS ARM64. A physical `afplay`
source also delivered twenty consecutive 10 ms stereo frames with source and
Stem identity and a clean stop.

That physical test uses Core commit
`a2bb0e12e3d38aca6bf72eee02773e6830d58ccb`, which fixes variable CoreAudio
process-tap callback sizes. The normal Cargo manifest uses released Core
`1.1.10`, so publication waits for an approved Core `1.1.x` release containing
the fix. No Windows, Linux, microphone, system-audio, Relay, or performance
claim follows from the macOS result.

## Later work

The same ownership model extends to PCM input, typed signals, Operators,
Connectors, recording, metrics, traces, Relay, extensions, sidecars, and voice
composition. Those modules are added only with working behavior and tests;
empty parity files are not created.
