import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Session, Source } from 'pocketstation/node';

const arguments_ = process.argv.slice(2);
const microphoneRequested = arguments_.includes('--microphone');
let application = arguments_.find((value) => !value.startsWith('--'));

if (application === undefined) {
  const prompt = createInterface({ input: stdin, output: stdout });
  application = (await prompt.question('Application to capture: ')).trim();
  prompt.close();
}

if (application.length === 0) {
  throw new Error('Enter the exact name or application ID of a running application');
}

const session = new Session({ frameDurationMs: 10 });
const audio = session.audio();
session.capture(Source.application(application)).send(audio);

if (microphoneRequested) {
  session.capture(Source.defaultMicrophone()).send(audio);
}

const running = await session.start();
const sourceFrames = new Map();
let frames = 0;

try {
  for await (const frame of running.audio) {
    const source = frame.sourceId.toString();
    sourceFrames.set(source, (sourceFrames.get(source) ?? 0) + 1);
    frames += 1;
    if (frames >= 100) {
      break;
    }
  }
} finally {
  const outcome = await running.stop();
  console.log({ application, microphoneRequested, sourceFrames, outcome });
}
