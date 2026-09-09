# Capture a desktop application

PocketStation opens the application you select and returns live PCM with its
Source identity, Stem identity, sequence number, and media time. It does not
open a microphone or start recording unless you ask for those features.

## Install from this repository

The JavaScript package is not on npm yet. Build and pack the repository:

```bash
npm install
npm run build
npm pack
```

Install the resulting archive in the application that will own capture. The
published package will use the same `pocketstation/node` import.

## Start with one application

```ts
import { capture } from "pocketstation/node";

const audio = await capture("Spotify");
```

The string is matched as an exact application display name or application ID.
Missing and ambiguous matches fail during startup instead of choosing an
arbitrary process.

Read frames directly. Leaving the loop finishes this concise Capture:

```ts
for await (const frame of audio) {
  console.log(frame.sourceId, frame.timestampStartNs, frame.samples);
}
```

Use `await using` when the project enables explicit resource management:

```ts
await using audio = await capture("Spotify");
for await (const frame of audio.audio) {
  consume(frame);
}
```

## Add a microphone or recording explicitly

```ts
const live = await capture("Zoom", {
  microphone: true,
  recordTo: "./recordings",
});
```

`live.application` and `live.microphone` are normal Stems, and `live.session`
is the public Session used underneath. `capture()` returns after that Session
has started. When an application needs to add an Operator, Connector, recording
destination, or typed subscription, declare a `Capture` first and start it
after composition:

```ts
import { Capture } from "pocketstation/node";

const declaration = new Capture({ application: "Zoom", streamAudio: false });
declaration.application.sendTo(destination);

await using live = await declaration.start();
```

## Choose a discovered application

Use discovery when several processes have similar names or the application
needs a reusable identity:

```ts
import { capture, discoverSources } from "pocketstation/node";

const applications = await discoverSources({ type: "kind", kind: "application" });
const selected = applications.find((source) => source.name === "Zoom");
if (selected === undefined) throw new Error("Zoom is not running");

const live = await capture(selected.stableId);
```

Continue with [Sources and permissions](../concepts/sources-and-permissions.md)
or [route, process, and record media](../guides/compose-a-session.md).
