import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { capture } from 'pocketstation/node';

const application = await applicationName();
const microphoneRequested = process.argv.includes('--microphone');
const live = await capture(application, {
  microphone: microphoneRequested,
  frameDurationMs: 10,
});
const sourceFrames = new Map();
let frames = 0;

for await (const frame of live) {
  const source = frame.sourceId.toString();
  sourceFrames.set(source, (sourceFrames.get(source) ?? 0) + 1);
  frames += 1;
  if (frames >= 100) {
    break;
  }
}

console.log({ application, microphoneRequested, sourceFrames, outcome: live.stopResult });

async function applicationName() {
  const argument = process.argv.slice(2).find((value) => !value.startsWith('--'));
  if (argument !== undefined) return argument;

  const prompt = createInterface({ input: stdin, output: stdout });
  const answer = (await prompt.question('Application to capture: ')).trim();
  prompt.close();
  if (answer.length === 0) {
    throw new Error('Enter the exact name or application ID of a running application');
  }
  return answer;
}
