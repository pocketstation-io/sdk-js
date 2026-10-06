# Source-aware recording clips in Node.js

`RecordedAudio` reads a finalized Session recording without opening devices.
Core owns verification, sample slicing and source provenance; Node projects
the same results and runs filesystem work on native workers.

```typescript
import { RecordedAudio, RecordingClipWindow } from 'pocketstation/node';

// `outcome` is (await running.stop()).recording; authorize its directory.
const reader = await RecordedAudio.fromOutcome(outcome);
const stem = reader.stems.find((item) => item.label === 'application')!;
const origin = stem.firstTimestampNs;
const window = RecordingClipWindow.around(
  origin + 60_000_000n, origin + 100_000_000n, 20_000_000n, 20_000_000n,
);
const clip = await reader.readClip(stem.stemId, window);
// clip.wav is an owned Buffer containing float32 WAV, with every channel intact.
```

`RecordedAudio.open(directory, sessionId)` verifies an explicitly authorized
directory for the exact runtime Session. `fromOutcome` rejects incomplete
outcomes. The reader is Node-only; browser packages do not pretend to have local
filesystem access.

Intervals are half-open Session nanoseconds. `firstTimestampNs` is normalized
WAV sample zero, not a wall-clock date or raw device timestamp. Core floors the
start and ceils the end to sample boundaries, then clips to available audio.
`requested` preserves the caller's interval; `actual`, `firstSampleFrame` and
`sampleFrames` describe returned PCM samples per channel, not capture buffers.

The stem preserves Session, source, stem, original clock, generation and
permission epoch. Intersecting original gaps appear in `discontinuities`.
All Core u64 identities, nanoseconds and counts are bigint; clock-domain IDs
are numbers because Core defines them as u32. Never convert bigint timestamps
to number. Buffers are owned per result; modifying one cannot change the stored
recording or another read.

Native reads run outside the Node event loop. A rejected or abandoned Promise
does not forcibly abort started file I/O; applications own request concurrency.
The API does not promise hard interruption of blocking filesystem calls.

Core accepts complete schema-2 float32 WAV recordings only. Limits: requested
interval 120 seconds, encoded clip 32 MiB, selected source WAV 1 GiB, manifest
2 MiB, 64 stems and 1,024 gaps per stem. `RecordingClipError` carries stable
`recording.clip_*` codes for invalid windows, unknown stems, missing audio,
changed recordings, unsupported manifests and file failures.

The recorder checksum detects corruption and is not cryptographic authenticity.
Callers authorize directories and prevent hostile concurrent writers. The reader
checks the manifest and selected WAV on each read; it never widens capture scope.

For recent audio during capture, configure history before starting and explicitly
route authorized source outputs:

```typescript
import { Session } from 'pocketstation/node';

const session = new Session();
const history = session.audioHistory({ retentionNs: 30000000000n });
const input = session.audioInput('authorized-audio');
input.output.retainAudio();
const running = await session.start();
// Feed/capture audio; metadata appears after its first real frame.
// const clip = await history.readClip(exactStemId, detectorWindow);
input.close();
await running.stop();
```

Default shared limits: 30 seconds, 16 MiB PCM, 4096 buffers and at most 64 stems.
`maxPcmBytes` and `maxBuffers` configure the two memory-related caps separately.
`getStems()`, `observations()`, `readClip()` and `clear()` are asynchronous native
worker operations. Declaration and `retainAudio()` are synchronous. Continuous
PCM preserves exact sample indexes; source resets discard that stem's older
generation. Clear discards retained audio while other destinations continue.
Graceful stop keeps the bounded tail; cancellation purges history.

`AudioHistoryError.code` distinguishes future post-context (`recording.history_not_ready`),
expired context, missing/discontinuous context, ended capture, cancellation and
failure. Live history does not invent silence or shorten missing context. Bound
retries and concurrent reads in your app; abandoning a Promise does not interrupt
an already started native operation. All u64 observations use bigint.

These APIs are qualified against matching local native builds. Registry
publication and physical capture qualification are separate. Detector models,
wake-word recognition and provider integrations remain outside Core.
