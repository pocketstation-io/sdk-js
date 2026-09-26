import { capture } from 'pocketstation/node';

// Change Zoom to an application currently running on your computer.
const live = await capture('Zoom', { microphone: true });
const sourceFrames = new Map<string, number>();
let frames = 0;

for await (const frame of live) {
  const source = frame.sourceId.toString();
  sourceFrames.set(source, (sourceFrames.get(source) ?? 0) + 1);
  frames += 1;
  if (frames === 100) break;
}

console.log({ sourceFrames: Object.fromEntries(sourceFrames), outcome: live.stopResult });
