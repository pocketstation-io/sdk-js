# Compose a source-aware voice workflow

Use `pocketstation/voice` to connect transcription, response, and synthesis
providers without moving provider code into the capture runtime.

## Result

One Session can capture an application and microphone independently, feed a
streaming transcriber, generate a response, and return synthesized PCM through
a new source-aware Stem.

```js
import { Session, Source } from 'pocketstation/node';
import { ConversationConfig, declareConversation } from 'pocketstation/voice';

const session = new Session({ frameDurationMs: 10 });
const microphone = session.capture(Source.defaultMicrophone());

const conversation = declareConversation({
  session,
  input: microphone,
  config: new ConversationConfig(),
  stt: myStreamingTranscriber,
  llm: myResponseProvider,
  tts: mySynthesisProvider,
});

const running = await session.start();
const voice = await conversation.start(running);
// Later: await voice.stop(); await running.stop();
```

The provider objects are application-owned implementations of the exported
voice interfaces. Their work runs on asynchronous workers, never on the audio
callback. Conversation limits, turn history, output frames, deadlines, and
cancellation are finite.

## Source identity and interruption

Transcript updates retain Source and stream identity. Revisions are monotonic,
and a provider must not claim stable partial text it cannot guarantee. When a
new speech turn interrupts output, PocketStation cancels that output generation
instead of allowing obsolete synthesized PCM to enter the Session.

## Failure behavior

A provider failure is reported as a typed voice failure and does not become
silence. Stop both the conversation and Session during cleanup. Use
`await using` where supported so `Symbol.asyncDispose` performs the same
idempotent close path.

PocketStation does not bundle provider credentials or a closed provider
catalog. Integrate those clients in the application or a separately versioned
package.

## Optional OpenAI Realtime demo adapter

`pocketstation/demo` also contains an application-owned OpenAI Realtime
adapter. The base PocketStation install does not install a WebSocket client.
Install the optional transport only when using this adapter:

```bash
npm install ws
```

The adapter requires an API key supplied by the application. It defaults to a
`gpt-realtime-2.1` speech-to-speech Session with `server_vad` and uses
`gpt-4o-mini-transcribe` only for the asynchronous input transcript. The
transcript is guidance about the input audio, not a claim about the exact audio
the Realtime model understood. Do not substitute `gpt-live-transcribe` in this
conversation setup: OpenAI documents that model for a `transcription` Session
with turn detection omitted or set to `null`.

Both PCM queues and WebSocket buffered bytes are bounded. Microphone frames
rejected by socket pressure are counted. If generated audio cannot enter its
bounded queue, the adapter cancels that exact provider response and its
PocketStation output generation so later chunks cannot resume after a hidden
gap. Completed transcript state is released, late audio for a cancelled
response is rejected, and socket/task cleanup uses the configured close
deadline.

See OpenAI's official [Realtime conversation](https://developers.openai.com/api/docs/guides/realtime-conversations)
and [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
guides for the provider wire behavior. See
[`examples/debug-voice-ai.ts`](../../examples/debug-voice-ai.ts) for the full
application, microphone, assistant-output, recording, and Relay composition.
