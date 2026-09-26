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

Application and microphone frames retain independent Source identity while one
bounded Operator owns the model. Transcript identity and nanosecond timestamps
use decimal strings on the JSON wire so JavaScript does not truncate 64-bit
values; the typed `Transcript` converts them back to `bigint`.

## Verify the integration

Before shipping, exercise a stalled provider and stop the Session. Verify that:

- capture continues or fails according to the declared route policy;
- the terminal result contains the Connector or Endpoint failure;
- shutdown completes within the configured deadline;
- no provider work runs on an audio callback.
