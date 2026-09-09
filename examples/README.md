# JavaScript examples

Build the package once before running an example:

```bash
npm install
npm run build
```

## Capture a running application

```bash
node examples/capture-application.mjs Spotify
```

The microphone stays closed. Add it only when both sides are needed:

```bash
node examples/capture-application.mjs Zoom --microphone
```

The example reads 100 source-aware frames and then completes the Session.
Application and microphone frames retain different Source and Stem identities.

## Feed existing PCM into a Session

```bash
node examples/feed-audio.mjs
```

This deterministic example needs no capture permission or audio device. It
writes one 10 ms PCM frame into Core and reads the copied frame from the Node
audio stream.

## Create a Connector

```bash
node examples/send-to-connector.mjs
```

The function form is useful when a destination needs only one `send` callback.
Use the class form in the [provider authoring guide](../docs/guides/provider-authoring.md)
when a connection owns startup and shutdown resources.

## Publish an application to Relay

Create a RelaySession through your PocketStation control plane, then set the
returned connection values:

```bash
export POCKETSTATION_RELAY_URL=http://127.0.0.1:4800
export POCKETSTATION_RELAY_SESSION_ID=<session-id>
export POCKETSTATION_RELAY_SOURCE_TOKEN=<source-token>
```

Run the example with the exact name or application ID of a running app:

```bash
node examples/publish-to-relay.mjs Spotify
```

The example publishes only the selected application. Add a microphone Stem
and send it to `relay.audio('microphone')` when the workflow requires both.

## Explore the complete workflow in a notebook

Open [capture-and-share.ipynb](notebooks/capture-and-share.ipynb) with Deno's
Jupyter kernel. It starts with one selected application and keeps the
microphone, recording, and Relay off until you enable them.

The notebook uses one Session to send each selected Stem to a small Connector,
optional Relay AudioBuses, and optional independent recordings. It then shows
source identities, delivery measurements, and the terminal Session result.
Read the [notebook guide](../docs/guides/notebooks.md) for installation,
permissions, Relay configuration, and security.
