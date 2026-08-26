# PocketStation JavaScript SDK

Use TypeScript or JavaScript to connect browser media to PocketStation.

> **Status: early preview.** This package is not published to npm. Its current
> `RoomClient` prototype uses the earlier room-based Relay API and is not yet
> compatible with the current `RelaySession` and named `AudioBus` contract. Do
> not use it for a new integration yet.

## Develop locally

You need Node.js 22 or newer.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

The first supported quickstart will be added after the browser client uses the
current control-plane tokens, Relay signaling, and `BusSubscription` vocabulary.
Until then, the source and tests document the prototype behavior only.
