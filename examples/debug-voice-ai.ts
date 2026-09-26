import { OpenAIRealtime } from 'pocketstation/demo';
import { RelaySession, Session, Source } from 'pocketstation/node';

const applicationName = process.argv[2];
if (!applicationName) throw new Error('Run with a running browser application name');

const apiKey = requiredEnvironment('OPENAI_API_KEY');
const controlPlaneUrl = requiredEnvironment('POCKETSTATION_CONTROL_PLANE_URL');
const relayUrl = requiredEnvironment('POCKETSTATION_RELAY_URL');
const remote = await RelaySession.create({
  controlPlaneUrl,
  relayUrl,
  requiredBuses: ['application', 'microphone', 'assistant'],
});
const session = new Session({
  frameDurationMs: 10,
  recordingRoot: 'recordings/voice-agent-debug',
});
const application = session.capture(Source.application(applicationName));
const microphone = session.capture(Source.defaultMicrophone());
const assistant = session.audioInput('assistant', { frameSamplesPerChannel: 480 });
const publisher = remote.publisher(session);

application.record('application');
application.publish(publisher, 'application');
microphone.record('microphone');
microphone.publish(publisher, 'microphone');
assistant.output.record('assistant');
assistant.output.publish(publisher, 'assistant');

const model = new OpenAIRealtime({ apiKey });
const conversation = session.conversation({
  input: microphone,
  output: assistant,
  voiceModel: model,
});
const running = await session.start();
let voice;
try {
  const invitation = await remote.waitForPublisherAndInvitation({
    busId: 'assistant',
    timeoutMs: 30_000,
  });
  console.log(`Invitation: ${invitation.joinCode}  ${invitation.joinUrl}`);
  await remote.waitForReceiver({ timeoutMs: 30_000 });
  voice = await conversation.start(running);
  console.log(await voice.wait());
} finally {
  if (voice !== undefined) await voice.close({ abort: true });
  assistant.close();
  console.log(await running.stop());
  await remote.close();
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
}
