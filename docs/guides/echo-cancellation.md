# Reduce playback echo in a microphone

Default native builds exclude the AEC engine. The API remains importable and
reports an explicit unavailable error when processing is requested without it.
Version 0.1.5 uses Core 1.1.13 for these APIs.
An AEC-enabled build of this same SDK is selected explicitly. It also requires
a C/C++ toolchain, Meson, Ninja, pkg-config, libclang and Rust's `llvm-tools`
component:

```sh
npm run build:native:aec
npm run build:typescript
```

After installing the resulting artifact, check its actual native capability:

```ts
import { aecAvailable } from 'pocketstation/node';
console.log(aecAvailable());
```

A runtime option does not remove compiled dependencies. Default native addons
omit the engine; explicitly enabled artifacts include it. No additional package
name is introduced. PocketStation does not automatically discover or enable
OS-provided AEC on any platform.
Availability here means this artifact includes the optional processor, not that
a microphone and playback route have been acoustically qualified.


Declare the microphone and playback reference in one `Session`, then route the
processed microphone to ordinary audio, recording or Connector destinations.
The original application and microphone streams remain available independently.

This API requires a native build containing Core's built-in AEC. It is not yet
available in the published Core 1.1.12 dependency. The current source integration
is under qualification; it does not establish physical acoustic quality or
Windows/Linux support. See [capability status](../JAVASCRIPT_CAPABILITY_MATRIX.md).

```ts
import { PlaybackReference, Session, Source } from 'pocketstation/node';

const session = new Session({ frameDurationMs: 10, recordingRoot: './recording' });
const application = session.capture(Source.application('Safari'));
const microphone = session.capture(Source.defaultMicrophone());
const processed = session.echoCancel(
  microphone,
  PlaybackReference.selectedApplication(application),
);
application.record('application');
processed.audio.record('microphone');

const running = await session.start();
try {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  console.log(processed.observations());
} finally {
  console.log(await running.stop());
  console.log(processed.observations());
}
```

Grant the operating-system capture permissions and select an application playing
audio. The code records for five seconds and awaits recording finalization. Check
the stop result and observations: `processing` means frames reached the engine,
not that cancellation converged or speech quality was qualified.

`PlaybackReference.selectedApplication()` uses only the declared application.
Other sound playing through the speakers is outside that reference. Use
`outputMix()` only for an output mix you separately authorized and captured, or
`renderedAudio()` for application-owned PCM also submitted to a playback device.
Creating a reference never opens another source or authorizes recording it.
An `AudioInput` provides its `.output`; registered Source outputs and derived
audio streams are also accepted. Every input must belong to the same Session.

Core owns reference admission, processing cadence, queues and error handling.
The supported format is 48 kHz mono or stereo with 10 or 20 millisecond Session
frames. Core negotiates microphone and reference channel layouts independently;
processed output retains the microphone layout. The current same-Session
`AudioInput` writer contract still uses a shared format. Inputs must declare the
same clock; mapping independently clocked capture devices is not yet qualified.
Inspect `lastError`, discarded-frame counters, resets and processing generation when a
reference becomes unavailable or changes. Failed processing does not silently
substitute raw microphone audio. The `qualifiedAlgorithmicDelaySamples` field
is absent while processor delay remains unqualified. `latestProcessingDurationNs`
and `maximumProcessingDurationNs` measure complete native command wall time,
including queue wait, resets, reference analysis and capture processing. They
are not algorithmic audio delay or audio-alignment offsets.

Processed `AudioFrame.processing` metadata retains the actual microphone input
identity, sequence and timestamp, processing generation, nominal delay and
terminal padding. Raw frames omit this metadata. `isTail` identifies internal
zero-input draining; it does not mean more microphone audio was captured. The
snapshot separately counts microphone inputs, total outputs, tail frames and
padding samples. `discardedOutputFramesTotal` counts computed frames whose
waiting request ended before the result could be delivered. Core's nominal
432-sample delay and bounded 40 ms graceful-stop drain are explicit policies;
the qualified delay remains unknown. Tail output
is included in Core recording finalization. Post-stop polled tails remain
readable through `running.audio` until its finite buffer reaches
`END_OF_STREAM`. `stop()` completes producers and finalizes recording; it does
not discard already accepted audio. `close()` stops and discards unread audio;
`cancel()` discards pending delivery immediately. Both release the retained
native receipt instead of holding queued PCM until garbage collection.

Application-only capture continues to require no microphone. Using both streams
does not mute the microphone while playback is active. The browser export does
not run this native processor.
