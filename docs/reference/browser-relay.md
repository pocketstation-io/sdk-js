# Receive Relay audio in a browser

Use `pocketstation/browser` when a web page needs to play or process one named
audio bus from PocketStation Relay. The browser package contains no native
addon and cannot capture another desktop application. A Node process publishes
desktop audio; a browser receives only the bus named by its subscriber
credential.

## Join with an invitation

The normal browser flow starts with a one-time invitation from your application
server or PocketStation control plane:

```ts
import { RelayReceiver } from "pocketstation/browser";

const receiver = new RelayReceiver({
  controlUrl: "https://control.example.com",
  joinCode,
});

const audio = document.querySelector("audio");
audio.srcObject = await receiver.connect();
await audio.play();
```

`connect()` resolves the invitation, opens Relay signaling, completes WebRTC
negotiation, and returns after the selected audio track arrives. Its default
deadline is 20 seconds. The one-time code is exchanged for a subscriber token
scoped to one RelaySession and one AudioBus; do not put source credentials in a
web page.

Disconnect when the page no longer needs the stream:

```ts
await receiver.disconnect();
```

`disconnect()` stops the WebRTC connection, starts the WebSocket close
handshake, and waits up to two seconds for the socket to close. Relay treats
the closed signaling connection as the subscriber leaving and releases its
Session resources. It is safe to call more than once.

## Use direct subscriber access

A trusted web application may receive already-issued subscriber access:

```ts
const receiver = new RelayReceiver({
  signalUrl: "wss://relay.example.com/v1/signal",
  sessionId,
  busId: "application",
  subscriberToken,
  iceServers,
});
```

The token must already be restricted to the requested bus. Use a different
receiver for each independent bus. This keeps application and microphone audio
separate in the browser instead of mixing their identity before the page can
choose what to do with them.

## Handle lifecycle changes

Callbacks are optional and run on the browser event loop:

```ts
const receiver = new RelayReceiver(access, {
  connectTimeoutMs: 15_000,
  disconnectTimeoutMs: 2_000,
  onStateChange(state) {
    status.textContent = state;
  },
  onError(error) {
    showConnectionError(error);
  },
});
```

The receiver reports `idle`, invitation resolution, signaling, connection,
connection loss, failure, and final closure as distinct states. It does not
reconnect without the application asking. Call `reconnect()` after a temporary
connection loss when the existing subscriber access is still valid.

## Read receiver observations

`observe()` reads one browser WebRTC statistics snapshot:

```ts
const observation = await receiver.observe();

console.log({
  packets: observation.packetsReceived,
  lost: observation.packetsLost,
  jitterMs: observation.jitterMs,
  track: observation.trackState,
});
```

Fields that the current browser does not report remain `null`. WebRTC statistics
can show that encoded media reached the receiver and entered browser playout;
they cannot prove that a loudspeaker emitted sound or that a person heard it.
`acousticOutput` therefore remains `"unavailable"`.

## Why these methods are asynchronous

Invitation exchange, WebSocket and WebRTC setup, browser statistics, and joined
shutdown may wait for network or browser work. Their methods return Promises so
applications can cancel, time out, and handle failure normally. Desktop audio
capture remains in the native Node package; no JavaScript function runs inside
a native capture callback.

## Current qualification

The implementation validates current control-plane invitation fields, Relay
signaling messages, finite response sizes, finite ICE candidate storage,
connection deadlines, explicit asynchronous errors, and joined shutdown.
Network tests that replace the services remain `MOCKED`. Browser and Relay
status is promoted only after the installed package passes the real
control-plane and Relay workflow in Chromium, Firefox, and WebKit.
