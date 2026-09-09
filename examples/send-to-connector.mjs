import { connector, Session } from 'pocketstation/node';

const received = [];
const destination = connector((frame) => {
  received.push({ sourceId: frame.sourceId, samples: frame.samples.length });
});

const session = new Session({ channels: 1, frameDurationMs: 10 });
const input = session.audioInput('provider audio');
input.output.sendTo(destination);

const result = await session.run(async () => {
  await input.write(new Float32Array(480));
  input.close();
});

console.log({ received, result });
