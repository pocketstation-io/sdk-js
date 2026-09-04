# Mock and incomplete behavior

This file records behavior that could be mistaken for product evidence. Delete
a row only when the named real test replaces it.

| Behavior | Status | Current evidence | What is still required |
|---|---|---|---|
| Browser Relay session | `PARTIAL` | `src/browser` contains real fetch, WebSocket, and WebRTC code; unit tests simulate only the control-service response | Run the packed browser entry against the deployed control service and Relay in a real browser, including authentication, ICE, received audio, reconnect, and shutdown |
| Browser Relay tests | `MOCKED` | `src/__tests__/relay-session.test.ts` replaces `fetch` and does not create a WebRTC connection | Complete `W21-JAVASCRIPT-RELAY-BROWSER-WORKFLOW` |

The Node Session, Source declaration, native startup failure, stream-reader
rules, package exports, and local packed consumer use working code. Their
platform status is recorded separately in
`docs/JAVASCRIPT_CAPABILITY_MATRIX.md`; component tests are not physical-device
or cross-platform evidence.
