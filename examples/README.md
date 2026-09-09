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
