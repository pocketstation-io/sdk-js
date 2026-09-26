# Capture an application and microphone

Start Zoom (or edit `Zoom` in `capture-application.ts` to a running app),
allow microphone access, then run from this SDK checkout:

```bash
npm ci
npm run example:capture
```

The TypeScript example reads 100 live frames and prints a count for each
Source. It stops its Session when iteration ends. This requires a real capture
device and does not run in CI.

Other TypeScript integrations are available here:

| File | What it does | Additional requirement |
|---|---|---|
| `send-to-connector.ts` | Sends live app and mic frames to an application-owned Connector | Edit `Safari` to a playing app |
| `send-audio-to-websocket.ts` | Sends one application's 48 kHz mono float32 little-endian PCM to a WebSocket | `wss://` endpoint accepting raw PCM and `AUDIO_WEBSOCKET_TOKEN` |
| `publish-to-relay.ts` | Publishes one application to a Relay AudioBus | Running Relay, Session ID, source token |
| `transcribe-voice-app.ts` | Transcribes app and mic as separate Sources | Local model and installed `whisper-cli` |
| `debug-voice-ai.ts` | Records and publishes app, mic, and generated assistant audio | OpenAI key, Control Plane, Relay |

Run `npm run build:examples` to compile them. The resulting JavaScript is in
`.examples-dist/`. `npm run examples:check` compiles all public examples and
runs six generated-input checks under `tests/fixtures/sdk-example-smoke/`.
Those checks verify SDK mechanics; they do **not** prove live capture, Relay,
transcription, or voice-provider behavior.

To run the WebSocket example, set `AUDIO_WEBSOCKET_URL` and
`AUDIO_WEBSOCKET_TOKEN`, then run
`node .examples-dist/send-audio-to-websocket.js`. Enter a running application
when prompted. It opens one authenticated socket for that application and stops
on Ctrl-C or socket closure.
