import { Session } from 'pocketstation/node';

const session = new Session({ channels: 1, frameDurationMs: 10 });
const input = session.audioInput('generated audio');
input.output.send(session.audio());

await session.run(async (running) => {
  await input.write(new Float32Array(480));
  input.close();
  console.log(await running.audio.read({ timeoutMs: 1_000 }));
});
