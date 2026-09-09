# Browser Relay status

`pocketstation/browser` is a browser-only Relay client. It does not capture a
desktop application and it never loads the native Node addon.

The current implementation can:

- request temporary Relay credentials from a PocketStation control service;
- exchange a WebRTC offer, answer, and ICE candidates over WebSocket signaling;
- publish one browser `MediaStreamTrack`;
- receive one remote audio `MediaStream`;
- read a small set of WebRTC statistics.

This code is `PARTIAL`. Its automated tests replace the control service and
Relay with test doubles. A deployed control service, Relay, TURN route, and real
browser session have not passed the JavaScript acceptance gate yet.

The current implementation also lacks connection deadlines, reconnect policy,
multi-stem publication, durable asynchronous error delivery, receiver playout
observations, and joined asynchronous shutdown. Applications should not treat
it as a production-qualified Relay client.

Browser qualification is tracked separately from the Node API. Until that work
passes, `pocketstation/browser` is suitable for API evaluation and local
integration work only.
