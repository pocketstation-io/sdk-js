# Route, process, and record media

A `Session` describes the Sources your application opens and every destination
that receives their media. PocketStation validates the complete description
before it opens capture resources. The Rust engine then owns capture, routing,
recording, and shutdown.

This model lets one captured Stem serve independent consumers. If an
application reader falls behind, recording can continue on its own route and
report its own result.

## Send audio to Node

Create the destination once, then connect any Stem that should appear in the
async iterator:

```ts
import { Session, Source } from "pocketstation/node";

const session = new Session({ frameDurationMs: 10 });
const audio = session.audio();

session.capture(Source.application("Spotify")).send(audio);

await using running = await session.start();
for await (const frame of running.audio) {
  console.log(frame.sourceId, frame.stemId, frame.timestampStartNs);
}
```

Adding a microphone is always explicit:

```ts
session.capture(Source.defaultMicrophone()).send(audio);
```

## Record each Source separately

Set one recording directory on the Session and name each Stem that should be
written:

```ts
const session = new Session({ recordingRoot: "./recordings" });
const application = session.capture(Source.application("Spotify"));
const microphone = session.capture(Source.defaultMicrophone());

application.record("application");
microphone.record("microphone");
```

Core creates one Session manifest, one WAV file per Stem, delivery metrics, and
permission and discontinuity records. Call and await `running.stop()` before
reading those files so every recorder has finalized.

## Describe processing by named ports

An `Operator` identifies processing code registered by a native extension or a
later provider package. PocketStation does not include a provider catalog.
Named ports let Core reject misspelled or incompatible connections before
capture starts.

The following declarations show what an installed provider package supplies;
they are not a standalone provider implementation:

```ts
import { Operator, secret } from "pocketstation/node";

const transcriber = session.operator(
  new Operator("io.example.transcriber.v1", {
    language: "en",
    token: secret(process.env.PROVIDER_TOKEN ?? ""),
  }),
);

application.connect(transcriber.input("audio"));
const transcript = transcriber.output("transcript");
```

`secret()` marks a value for native redaction. It does not load environment
variables, store credentials, or send configuration to a service on its own.

Operator authoring is not part of the current JavaScript package candidate.
Declaring an unknown Operator fails during `start()` with
`compile.unknown_async_operator`; it is never replaced by a JavaScript stub.

## Send a derived result to an Endpoint

`EndpointDefinition` describes a destination implemented outside the SDK. Its
node type and implementation identifier are open strings so provider packages
can add destinations without changing PocketStation:

```ts
import { EndpointDefinition } from "pocketstation/node";

const destination = session.endpoint(
  new EndpointDefinition(
    "io.example.transcript-destination.v1",
    "io.example.transcript-writer.v1",
  ),
);

transcript.send(destination, { input: "events" });
```

The destination implementation must already be registered with Core. Custom
Endpoint and Connector authoring is scheduled separately from this declaration
API.

## Return generated audio to the Session

When an Operator emits PCM, `reenterAudio()` turns that output into a normal
source-aware Stem:

```ts
const synthesizer = session.operator(
  new Operator("io.example.speech-synthesizer.v1"),
);
const generated = synthesizer.output("audio").reenterAudio();
generated.record("assistant");
generated.send(session.audio());
```

Core assigns the generated Stem identity and retains its Operator lineage. It
can then be recorded, read by Node, or connected to another registered
destination without creating a JavaScript media loop.

## Handle compiler failures

`Session.start()` returns a `SessionStartError` when Core rejects the complete
Session. The stable error code states the stage; `diagnostic` identifies the
Operator, node, port, or route when Core can do so precisely:

```ts
import { SessionStartError } from "pocketstation/node";

try {
  await session.start();
} catch (error) {
  if (error instanceof SessionStartError) {
    console.error(error.code, error.diagnostic);
  }
  throw error;
}
```

Do not parse the human-readable message. Use `code` and the typed diagnostic
fields for program behavior, and retain the message for logs or user support.

Continue with [route settings](../concepts/route-settings.md) when a destination
needs a specific media format or queue behavior.
