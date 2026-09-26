import { connector, Session, Source } from 'pocketstation/node';

// Change Zoom to an application currently playing audio on your computer.
const session = new Session();
const received = new Map<string, number>();
const destination = connector((frame) => {
  const source = frame.sourceId.toString();
  received.set(source, (received.get(source) ?? 0) + 1);
});

session.capture(Source.application('Zoom')).sendTo(destination);
session.capture(Source.defaultMicrophone()).sendTo(destination);

const running = await session.start();
try {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
} finally {
  console.log({ framesBySource: Object.fromEntries(received), outcome: await running.stop() });
}
