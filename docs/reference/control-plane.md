# Control Session lifecycle

`pocketstation/control` is the trusted JavaScript control-plane client. It is a
separate package entry point from native capture (`pocketstation/node`) and the
browser WebRTC media edge (`pocketstation/browser`). It uses only web-standard
HTTP primitives and can run in Node, a browser, or a serverless worker that
provides `fetch`.

## Create and inspect a Session

```ts
import { ControlClient } from "pocketstation/control";

using control = new ControlClient("https://control.example", {
  timeoutMs: 10_000,
});

const credentials = await control.createSession({
  requiredBuses: ["application", "microphone"],
});

const snapshot = await control.session(
  credentials.sessionId,
  credentials.sourceToken,
);
```

`createSession()` defaults to the `application` and `microphone` AudioBuses.
The returned `SessionCredentials` contains the validated Session ID,
source-owner token, optional WHIP/WHEP endpoints, and bounded ICE configuration.
`session()` returns a frozen snapshot with bus, generation, subscription,
readiness, revision, and codec state.

## Authorize a publisher or receiver

Issue a media-only publisher capability before giving a remote browser or
device access to Relay:

```ts
const publisher = await control.issuePublisherCredentials(
  credentials.sessionId,
  credentials.sourceToken,
  { busId: "microphone" },
);

const publisherToken = publisher.publisherToken.exposeSecret();
```

The publisher token is accepted for media publication on that exact AudioBus
and rejected for Session reads, deletion, invitations, or additional
credential issuance. `SecretToken.exposeSecret()` makes the trusted-to-media
credential boundary explicit.

Issue direct receiver credentials for one AudioBus:

Issue direct credentials for one AudioBus:

```ts
const receiver = await control.issueSubscriberCredentials(
  credentials.sessionId,
  credentials.sourceToken,
  { busId: "application" },
);
```

Or create a time-limited invitation:

```ts
const invitation = await control.createInvitation(
  credentials.sessionId,
  credentials.sourceToken,
  { busId: "application" },
);
```

All credential and invitation operations require the source-owner token. They
should execute in trusted application or server code.

Delete is explicit and idempotent only to the extent guaranteed by the service:

```ts
await control.deleteSession(
  credentials.sessionId,
  credentials.sourceToken,
);
```

## Deadlines, cancellation, and close

Every request has a finite deadline. A per-operation value overrides the client
default without permitting an unbounded request:

```ts
const cancellation = new AbortController();

await control.session(credentials.sessionId, credentials.sourceToken, {
  timeoutMs: 2_000,
  signal: cancellation.signal,
});
```

`close()` is idempotent, cancels active requests, and rejects later work. The
client also implements explicit resource management through `Symbol.dispose`.

Stable `ControlPlaneError.code` values distinguish HTTP status, transport,
deadline, cancellation, closure, oversized response, and response-decoding
failures. An unexpected HTTP status is retained as `statusCode`.

## Bounds and secret handling

The client enforces the same wire bounds as the Python control client:

- error response: 4,096 bytes;
- successful JSON response: 65,536 bytes;
- Session ID: 128 UTF-8 bytes and one safe URL segment;
- credential: 4,096 UTF-8 bytes;
- required buses: 1–16 unique identifiers;
- ICE servers: at most 32, each with at most 16 URLs;
- subscriptions: at most 1,024;
- request deadline: greater than zero and at most 300,000 ms.

`SecretToken` uses a private field. String and JSON conversion return only a
redacted marker. The raw token is available solely through `exposeSecret()` so
the authentication boundary is visible in application code. The client also
redacts that token from HTTP, transport, and response-stream error messages.

These safeguards do not make source-owner credentials safe to ship to an
untrusted client. Issue the exact-bus publisher or subscriber capability needed
by that client instead.
