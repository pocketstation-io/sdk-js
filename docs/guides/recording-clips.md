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

This is finalized-recording extraction. Live rolling retention and wake-word
recognition are separate capabilities; detector models and provider integrations
remain outside Core. A detector can supply intervals without making Core depend
on that detector.
