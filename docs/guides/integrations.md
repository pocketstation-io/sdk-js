# Integrate application-owned processing

Use a `Connector` when PocketStation should deliver source-aware audio to code
your application owns. Use an `Operator` when the processing result must return
to the Session as another typed signal or generated-audio Stem.

## Send audio to an existing client

Install the package, then pass each immutable frame to your existing client:

```js
import { Session, Source, connector } from 'pocketstation/node';

const session = new Session();
const application = session.capture(Source.application('Zoom'));
const destination = session.destination(connector(async (frame) => {
  await existingClient.send(frame.samples);
}));
application.send(destination);

const running = await session.start();
// Later: const result = await running.stop();
```

The Connector runs outside the capture callback. Its route is bounded, so a
slow client produces explicit drops or failures rather than blocking capture.
The frame retains Source, stream, Stem, sequence, timing, and discontinuity
identity.

## Return typed results to the Session

Use `defineOperator()` for transcription, detection, transformation, or other
work whose output must be routed, recorded, or consumed by another Operator.
The [provider authoring guide](provider-authoring.md) covers lifecycle,
deadlines, cancellation, and structured errors. The
[signal-stream guide](signal-streams.md) shows how to subscribe to typed output.

Provider-specific clients and credentials remain application-owned. Keep
secrets out of frame metadata and use typed secret configuration for native
Connector declarations.

## Run the optional local Whisper demo

The `pocketstation/demo` entry point includes a finite reference adapter for an
installed `whisper-cli` executable. It does not download a model, start a
network client, or add a closed provider dependency to PocketStation Core.

Install whisper.cpp's `whisper-cli`, download a compatible model yourself, and
pass its path explicitly:

```ts
import {
  WhisperTranscriber,
  WhisperTranscriberConfiguration,
} from 'pocketstation/demo';
import { Capture } from 'pocketstation/node';

const live = new Capture({
  application: 'Zoom',
  microphone: true,
  streamAudio: false,
});
const transcriber = new WhisperTranscriber(
  new WhisperTranscriberConfiguration({
    model: '/models/ggml-base.bin',
    whisperCliExecutable: '/opt/whisper.cpp/bin/whisper-cli',
  }),
);
const transcripts = transcriber.transcribe(live);

await live.start();
try {
  for await (const transcript of transcripts) {
    console.log(transcript.sourceId, transcript.text);
  }
} finally {
  await live.close();
}
```

`attachMany` gives each selected stem its own window assembler and feeds their
complete windows to one shared inference Operator by default. Inference never blocks
frame assembly. Core's audio input edges hold eight frames; typed window edges hold
eight windows per producer. `queueCapacitySignals` describes the authoring
manifest, not a request to enlarge Core's compiled audio edges. If inference
cannot keep up, window-route drops remain visible in Session metrics while
recording and Relay continue independently.

The private window boundary stores mono 16 kHz PCM16 plus original source and
time metadata, bounded to 1 MiB per value (up to 30 seconds). PCM conversion is
finite and clipped to [-1, 1]. Five-second CPU windows are the default; `useGpu`
or the demo CLI `--gpu` opts into GPU execution, while `--no-gpu` explicitly
selects CPU. Windows shorter than 500 ms (or a smaller configured window) emit
`processing_outcome: "skipped-short-window"` without invoking the model. Their
duration remains visible and must not be counted as transcribed coverage.

Call `stop()` and keep draining the transcript subscription through EOF before
closing it. Graceful completion flushes each stem's tail; abort discards queued
model work. The CLI model owns and joins its child process on close, including
cancellation. The low-level `provider()` remains a direct single-Operator adapter;
use `attach`/`attachMany` for independently drained live stems.

Transcript identity and nanosecond timestamps use decimal strings on the JSON
wire so JavaScript does not truncate 64-bit values. Typed `Transcript` also exposes
optional `processingOutcome`, `durationMs`, and `inferenceDurationNs` fields.

## Verify the integration

Before shipping, exercise a stalled provider and stop the Session. Verify that:

- capture continues or fails according to the declared route policy;
- the terminal result contains the Connector or Endpoint failure;
- shutdown completes within the configured deadline;
- no provider work runs on an audio callback.

### Bound inference concurrency and supply application vocabulary

Set `inferenceConcurrency: 2` and `cpuThreads: 4` for two source-affine model
workers with two CPU threads each. The default is one worker. Worker count is
bounded to eight and cannot exceed the total CPU thread budget or selected
source count. Parallel mode requires `numWorkers: 1`; this avoids multiplying
the declared CPU budget through nested model workers. Uneven budgets distribute
one extra thread to the first workers. Each worker owns its model and shutdown;
Python's model has additional resident-memory cost, and JS owns at most one
whisper-cli child per worker. Source assignment is stable, while results across
different sources may arrive out of order. Original source/time lineage remains
on every transcript. A typed MANY-input Operator merges outputs through Core's
existing bounded queues; it does not schedule inference or grow an extra queue.

`initialPrompt` optionally supplies application vocabulary/context, bounded to
2048 UTF-8 bytes without NUL. It is sent literally to the local model; it is not
inferred from fixture names and does not guarantee accurate transcription.
For a fair comparison, declare the same prompt and decoding settings in both
live and reference runs. Whole-recording model output is not human ground truth.
The demo CLI exposes `--cpu-threads`, `--inference-concurrency` and
`--initial-prompt`. Defaults preserve the earlier single-worker behavior.

The low-level direct provider remains one Operator; parallel scheduling applies
to `attach`/`attachMany`. Model-route loss, failure and queue capacity remain
visible separately from recording/Relay. Cancel owns each active JS child and
joins it before return. This resource policy alone makes no latency or accuracy
claim; qualify it on the target machine and workload.
