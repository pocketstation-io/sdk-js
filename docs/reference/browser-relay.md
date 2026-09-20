# Publish and receive Relay audio in a browser

Use `pocketstation/browser` when a web page needs to publish or receive one
named audio bus through PocketStation Relay. The browser package contains no
native addon and cannot capture another desktop application. It operates on a
caller-owned browser `MediaStream` or receives only the bus named by a
subscriber credential.

## Publish one browser audio stream

Obtain microphone permission in your application, then pass the resulting
stream to a capability-scoped publisher:

```ts
import { RelayPublisher } from "pocketstation/browser";

const microphone = await navigator.mediaDevices.getUserMedia({
  audio: true,
  video: false,
});

const publisher = new RelayPublisher({
  signalUrl: "wss://relay.example.com/v1/signal",
  sessionId,
  busId: "user-microphone",
  publisherToken,
  iceServers,
});

await publisher.publish(microphone);
```

`publish()` requires exactly one live audio track. It resolves only after
WebRTC statistics report at least one outbound audio packet, rather than after
signaling or ICE alone. A packet is delivery evidence, not proof of speech,
audibility, or non-silence.

The application owns permission UX, source selection, and the `MediaStream`.
`disconnect()` is bounded and idempotent but never calls `stop()` on the
caller's track. Stop the microphone separately when your product policy says
its ownership ends:

```ts
await publisher.disconnect();
for (const track of microphone.getTracks()) track.stop();
```

Use `observe()` to read fields the browser actually exposes:

```ts
const observation = await publisher.observe();

console.log({
  packetsSent: observation.packetsSent,
  bytesSent: observation.bytesSent,
  trackState: observation.trackState,
  trackMuted: observation.trackMuted,
});
```

Unavailable statistics remain `null`. An ended source track is a typed
publisher failure. A disconnected PeerConnection becomes `disconnected`; the
application may call `reconnect()` with the same still-live stream or an
explicit replacement. Relay treats that attachment as a new source generation,
so applications must not invent continuity across the boundary.

Publisher capabilities are bearer credentials. Mint them with
`ControlClient.issuePublisherCredentials()`, deliver them through your trusted
pairing/application boundary, keep them out of URLs and persistent browser
storage, and give them finite expiry. A publisher capability is scoped to one
AudioBus and cannot read, mutate, invite receivers to, or delete its Session.
The SDK does not implement authentication UI or agent authorization policy.

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

Start several receivers in a known order, then keep their streams live
together:

```ts
const applicationStream = await applicationReceiver.connect();
const microphoneStream = await microphoneReceiver.connect();
```

This avoids coupling WebRTC startup to browser scheduling. It does not serialize
media after connection; both AudioBuses continue independently.

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

Invitation exchange, WebSocket and WebRTC setup, first-packet readiness,
browser statistics, and joined shutdown may wait for network or browser work.
Their methods return Promises so applications can cancel, time out, and handle
failure normally. Desktop application capture remains in the native Node
package; no JavaScript function runs inside a native capture callback.

## Current qualification

An installed package has published controlled application audio and a physical
microphone through the real control plane and Relay on macOS. Chromium, Firefox,
and WebKit each received both named AudioBuses, reconnected them, cancelled a
separate connection attempt, read WebRTC statistics, and closed signaling. The
20 ms run reported no active capture error, route loss, discontinuity, browser
packet loss, or recording loss.

The public publisher API has component coverage for exact-bus signaling,
first-packet readiness, failed authorization, reconnection, observations,
caller stream ownership, and idempotent teardown. Until the retained
browser→Relay→Core artifact is accepted, it is not a product-path claim.

Existing receiver evidence proves the same-host workflow. It does not prove a
physical phone, WAN or TURN connectivity, mobile backgrounding, network
handoff, Windows or Linux packages, physical loudspeaker output, or that a
person heard the audio.
