# Add JavaScript Sources, Operators, and destinations

PocketStation lets an application add off-realtime JavaScript without moving
capture, routing, recording, timing, or shutdown out of Core. JavaScript code
runs on worker threads through a finite native dispatch queue. It never runs on
an audio callback.

Choose the smallest API that fits the work:

| You need to | Use |
|---|---|
| Send source-aware PCM to a socket, encoder, file, or provider client | `Connector` |
| Feed PCM already produced by JavaScript into a Session | `AudioInput` |
| Produce text, events, metrics, control data, or bytes | `SourceFactory` |
| Publish a reusable Source with explicit manifest, lifecycle, and deadlines | `SourceProvider` |
| Transform typed input into typed output or generated PCM | `OperatorFactory` |
| Publish a reusable Operator with explicit Core policy and compiled edge context | `OperatorProvider` |
| Receive several named audio or signal inputs in one destination | `EndpointFactory` |

Provider packages can expose these classes from their own npm packages.
PocketStation does not require a closed provider list.

## Send audio with a Connector

A Connector is the normal choice for an external audio destination. One object
represents one configured destination. Send several Stems to the same object
when they should share one connection and one lifecycle.

```ts
import {
  Connector,
  Session,
  Source,
  type ConnectorAudioFrame,
} from "pocketstation/node";
import { createWriteStream, type WriteStream } from "node:fs";
import { once } from "node:events";

class Float32File extends Connector {
  public constructor(private readonly filename: string) {
    super({ deadlineMs: 5_000 });
  }

  public start(): void {
    this.stream = createWriteStream(this.filename);
  }

  public async send(frame: ConnectorAudioFrame): Promise<void> {
    const bytes = Buffer.from(
      frame.samples.buffer,
      frame.samples.byteOffset,
      frame.samples.byteLength,
    );
    if (!this.stream.write(bytes)) await once(this.stream, "drain");
  }

  public async stop(): Promise<void> {
    this.stream.end();
    await once(this.stream, "close");
  }

  private stream!: WriteStream;
}

const session = new Session();
const destination = new Float32File("meeting.f32le");

session.capture(Source.application("Zoom")).sendTo(destination);
session.capture(Source.defaultMicrophone()).sendTo(destination);
```

Each frame includes `sourceId`, `streamId`, `sequenceNumber`, media time, route
time, sample rate, and channel count. The two Sources remain distinguishable
even though the destination shares one connection.

Use the function form when no setup or cleanup is required:

```ts
import { connector } from "pocketstation/node";

const frames: Float32Array[] = [];
const destination = connector((frame) => {
  frames.push(frame.samples);
});
```

Each Source route normally holds up to eight frames while JavaScript handles a
previous frame. Choose a larger finite queue when the destination has measured
short scheduling pauses:

```ts
const destination = connector(sendToProvider, { capacityFrames: 32 });
```

At a 20 ms frame duration, 32 frames can retain up to 640 ms of media. At 10
ms, the same setting retains up to 320 ms. Core rejects the arriving frame and
records a discontinuity when the queue is full. Read route metrics to confirm
that the selected capacity absorbs expected pauses without hiding a destination
that is persistently too slow.

### Build a reusable manifest-driven Connector

Use the advanced form when a provider needs typed configuration, explicit
readiness and health, reusable declarations, structured failures, or finite
native-owned batches. `Session.registerConnector()` registers the
implementation once; each `declare()` call supplies a validated configuration
and route policy.

```ts
import {
  Connector,
  ConnectorConfigurationField,
  ConnectorConfigurationSchema,
  ConnectorDriver,
  ConnectorManifest,
  ConnectorConfigurationValue,
  Session,
} from "pocketstation/node";

const configuration = new ConnectorConfigurationSchema([
  new ConnectorConfigurationField({
    name: "token",
    kind: "secret",
    documentation: "Provider credential.",
  }),
]);

const manifest = ConnectorManifest.audio("com.acme.connector.archive.v1", {
  packageVersion: "1.0.0",
  configuration,
  multiplicity: "many",
});

const archive = Connector.withDriver(manifest, async (inputs) => {
  const token = inputs[0]?.configuration.token?.exposeSecret();
  return new (class extends ConnectorDriver {
    public override start(context) {
      openProvider(token);
      context.setReady();
    }

    public deliver(item) {
      sendFrame(item.audio);
      return "delivered";
    }

    public override shutdown() {
      closeProvider();
    }
  })();
});

const session = new Session();
const registered = session.registerConnector(archive);
const endpoint = registered.declare({
  token: ConnectorConfigurationValue.secret(process.env.ACME_TOKEN ?? ""),
});
```

`Connector.withWorker()` uses the same contract but calls `deliverBatch()`
with at most `maximumBatchItems` items collected by the native Endpoint worker.
Preparation, start, delivery, and shutdown each have independent finite
deadlines. `RegisteredConnector.observations()` returns immutable readiness,
health, recovery, retry, failure, delivery, drop, and discontinuity counters.
Secrets remain redacted unless provider code calls `exposeSecret()`.

## Produce typed data with a Source

JavaScript Sources are intended for data that is not PCM: provider events,
transcripts, metrics, control messages, and opaque bytes. Use `AudioInput` for
PCM so Core can assign its audio identity, cadence, and storage directly.

```ts
import {
  PortSpec,
  Session,
  SignalSpec,
  defineSource,
} from "pocketstation/node";

const transcript = SignalSpec.text("utf8", { role: "transcript.final" });

const feed = defineSource({
  id: "com.acme.source.transcript.v1",
  outputs: [PortSpec.output("transcript", transcript)],
  validate(configuration) {
    if (configuration.language === undefined) {
      throw new Error("language is required");
    }
  },
  create() {
    const messages = ["hello", "world"][Symbol.iterator]();
    return {
      next() {
        const next = messages.next();
        return next.done
          ? undefined
          : { output: "transcript", data: next.value };
      },
    };
  },
});

const session = new Session();
const output = session.source(feed, { language: "en" }).output("transcript");
```

Returning `undefined` from `next()` ends that Source. Core assigns the Session,
Source, and stream identities and adds sequence and timing information to each
accepted value.

### Build a reusable manifest-driven Source

`SourceProvider` is the complete reusable contract. `SourceManifest` is
validated by the native Core contract when constructed, including the stable
Source identifier, output directions, non-PCM restriction, revision, and
implementation generation. JavaScript's Promise-native API covers both the
synchronous and asyncio Python authoring forms.

```ts
import {
  PortSpec,
  SignalSpec,
  SourceEmission,
  SourceManifest,
  source,
} from "pocketstation/node";

const transcript = SignalSpec.text("utf8", { role: "transcript.final" });

const feed = source(new SourceManifest({
  sourceTypeId: "com.acme.source.transcript.v1",
  outputs: [PortSpec.output("transcript", transcript)],
}))(async function* (configuration) {
  yield SourceEmission.text("transcript", configuration.text ?? "", {
    signal: transcript,
    sourceTimestampNs: 10n,
    durationNs: 5n,
    terminal: true,
  });
});

const registered = session.registerSource(feed);
const instance = registered.declare({ text: "hello" });
```

Use `SourceProvider.withDriver()` when each configured declaration needs a
stateful driver. Its `prepare()` receives the actual Core-assigned Session,
Source, output-port, and stream identities. `next()` receives a
`SourceCancellation`; `close()` runs exactly once. `SourceDeadlines` bounds
create, prepare, next, and close independently.

`SourceEmission.text()` and `.bytes()` validate payload versus `SignalSpec`,
copy byte views at construction, validate every timing/continuity integer, and
preserve the declared output contract. Core still owns sequence numbers,
lineage, bounded fan-out, failure accounting, and terminal Session state. PCM
continues to use `Session.audioInput()` so no JavaScript Source creates a
second audio queue.

## Process data with an Operator

An Operator has named inputs and outputs. The example below turns transcript
text into normalized text while Core retains the input lineage and records the
Operator that produced the result.

```ts
import {
  PortSpec,
  SignalSpec,
  defineOperator,
} from "pocketstation/node";

const text = SignalSpec.text();

const normalize = defineOperator({
  id: "com.acme.operator.normalize.v1",
  inputs: [PortSpec.input("text", text)],
  outputs: [PortSpec.output("text", text)],
  create() {
    return {
      process(input) {
        if (input.payload.kind !== "text") return [];
        return [{
          output: "text",
          data: input.payload.text.trim(),
        }];
      },
    };
  },
});

const operator = session.operator(normalize);
output.connect(operator.input("text"));
```

An Operator may emit a complete `Float32Array` frame from an output declared
with exact PCM media settings. Call `reenterAudio()` on that output when the
generated audio should be recorded or routed like any other Stem.

Pass configuration when the Operator is declared. Mark credentials with
`secret()` so PocketStation redacts them from its diagnostics:

```ts
import { secret } from "pocketstation/node";

const securedOperator = session.operator(normalize, {
  token: secret(process.env.PROVIDER_TOKEN ?? ""),
});
```

### Build a reusable manifest-driven Operator

Use `OperatorProvider` when the implementation needs the complete contract
rather than the concise `defineOperator()` defaults. The manifest controls
revision and implementation generation, Core queue capacity, Core's process
deadline, network/filesystem permission declarations, drain/discard policy,
failure continuation, and terminal output roles. None of these values is
silently widened by the JavaScript binding.

```ts
import {
  OperatorEmission,
  OperatorManifest,
  OperatorProvider,
  PortSpec,
  SignalSpec,
} from "pocketstation/node";

const request = SignalSpec.text("utf8", { role: "request" });
const result = SignalSpec.text("utf8", { role: "result.final" });

const uppercase = OperatorProvider.withNode(
  new OperatorManifest({
    operatorId: "com.acme.operator.uppercase.v1",
    inputs: [PortSpec.input("request", request)],
    outputs: [PortSpec.output("result", result)],
    processTimeoutMs: 5_000,
    terminalRoles: ["result.final"],
  }),
  async () => ({
    prepare(context) {
      // These are the actual graph-compiled edges and capacities.
      console.log(context.inputs[0]?.edgeId, context.inputs[0]?.capacitySignals);
    },
    async process(inputPort, envelope) {
      if (inputPort !== "request" || envelope.payload.kind !== "text") return [];
      return [OperatorEmission.text(envelope.payload.text.toUpperCase(), {
        signal: result,
      })];
    },
  }),
);

const registered = session.registerOperator(uppercase);
const instance = registered.declare({ language: "en" });
```

JavaScript is asynchronous by default, so one API covers the synchronous and
asyncio Python authoring forms. `OperatorDeadlines` bounds create, prepare,
process/flush, cancel, and close separately; its process deadline may not
exceed the Core manifest deadline. `OperatorEmission` copies bytes and PCM at
construction, validates payload versus `SignalSpec`, and can infer a unique
output from that signal. Core still owns derivation, input lineage, the bounded
worker queue, the PCM output pool, generated-audio reentry, and recording.

An Operator is not ready merely because its factory returned. `prepare()` sees
the compiled input/output port names, edge identities, directions, capacities,
signals, media, and route settings before processing starts. Wrong PCM frame
sizes, non-concrete PCM output formats, payloads larger than the route bound,
and native pool exhaustion terminate explicitly instead of becoming silence.

The provider's `validate()` and `create()` functions receive the original
string values. Provider code must not place credentials in its own errors,
events, or logs.

## Receive named inputs with an Endpoint

Use an Endpoint when the destination needs typed signals or several named
inputs. `defineEndpoint()` accepts either a factory for class-based state or a
single receive function.

```ts
import {
  EndpointFactory,
  PortSpec,
  SignalSpec,
  type EndpointItem,
  type EndpointNode,
} from "pocketstation/node";

class TimelineWriter implements EndpointNode {
  public readonly items: EndpointItem[] = [];

  public async receive(item: EndpointItem): Promise<void> {
    this.items.push(item);
  }
}

const writer = new EndpointFactory({
  id: "com.acme.endpoint.timeline.v1",
  inputs: [
    PortSpec.input("application", SignalSpec.audio()),
    PortSpec.input("transcript", SignalSpec.text()),
  ],
  create: () => new TimelineWriter(),
});

const destination = session.endpoint(writer);
application.send(destination, { input: "application" });
transcript.send(destination, { input: "transcript" });
```

Core may start independent Endpoint instances for inputs that use different
runtime media systems, such as PCM and typed signals. `create()` must therefore
return independent state. Inputs of the same kind that belong to one Endpoint
declaration start together and share that instance.

### Build a reusable manifest-driven Endpoint

Use the advanced contract when the destination owns resources across
prepare/start/shutdown, needs stable grouping for several declarations, or
must return final observations. Registration is idempotent within one Session;
each `declare()` call creates a configured Core Endpoint.

```ts
import {
  EndpointDriverObservations,
  EndpointManifest,
  EndpointProvider,
  PreparedEndpointDriver,
  RunningEndpointDriver,
} from "pocketstation/node";

class RunningArchive extends RunningEndpointDriver {
  private received = 0;

  public receive(delivery): void {
    if (delivery.item.kind === "audio") this.received += 1;
  }

  public joinAndFinalize(): EndpointDriverObservations {
    return new EndpointDriverObservations({
      framesReceivedTotal: this.received,
      framesDeliveredTotal: this.received,
    });
  }
}

class PreparedArchive extends PreparedEndpointDriver {
  public start(gate): RunningEndpointDriver {
    if (gate.isOpen) throw new Error("start transaction opened too early");
    return new RunningArchive();
  }
}

const archive = new EndpointProvider({
  manifest: EndpointManifest.audio("com.acme.endpoint.archive.v1"),
  factory: () => new PreparedArchive(),
  maximumBatchItems: 32,
  deadlines: {
    prepareMs: 5_000,
    startMs: 5_000,
    deliveryMs: 30_000,
    shutdownMs: 5_000,
  },
});

const registered = session.registerEndpoint(archive);
application.send(registered.declare({ region: "local" }));
```

Core owns the bounded input receivers, route metrics, delivery accounting, and
the start transaction. JavaScript receives push deliveries through
`receive()` or finite `receiveBatch()` calls; the SDK deliberately does not
add a second JavaScript media queue. `EndpointPortInput` retains the exact
Session, Endpoint, route, Source, Stream, Stem, timeline-origin, signal, media,
route-policy, and configuration context for its input.

The gate passed to `start()` stays closed until every Session component has
started, then opens before the first delivery. `requestShutdown()` and
`joinAndFinalize()` provide ordered cleanup. `EndpointDriverError` retains a
stable code, lifecycle stage, and retry guidance in the terminal Session
result. `RegisteredEndpoint.observations()` retains immutable driver counters
after finalization.

`preparationGroup` may return one stable key when several compatible routes
must share one prepared driver. Otherwise each route is prepared independently.
The same `EndpointProvider` object cannot be shared across Sessions because its
active runtimes and cancellation ownership are Session-scoped.

## Lifecycle and failure behavior

The Session performs the lifecycle in this order:

```text
validate configuration
→ create instance state
→ prepare resources
→ start after the Session is ready
→ deliver data
→ drain accepted work or abort pending work
→ close exactly once
```

Each JavaScript call has a 5,000 ms deadline by default and may be configured
from 1 through 60,000 ms. Native-to-JavaScript dispatch holds at most 16 pending
calls. A full queue, rejected Promise, thrown exception, or expired deadline is
reported through the owning Session; it does not run uncaught on a native
worker.

`running.stop()` lets accepted work finish. `running.cancel()` aborts provider
signals first, discards pending Core work, and then closes each instance.
Preparation failures call cleanup before `Session.start()` returns the error.

One factory object belongs to one Session because its active instances share
that Session's cancellation signal. Create another factory object for another
Session. A Connector object follows the same rule.

These APIs are for off-realtime integration code. Code that must execute inside
a realtime partition belongs in a trusted native extension. Code that needs
process isolation belongs in a managed sidecar.
