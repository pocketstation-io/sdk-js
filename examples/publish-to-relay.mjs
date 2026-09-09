import { once } from 'node:events';
import { Session, Source } from 'pocketstation/node';

const applicationName = process.argv[2];
if (!applicationName) {
  throw new Error('Run with: node publish-to-relay.mjs <application>');
}

const url = process.env.POCKETSTATION_RELAY_URL;
const sessionId = process.env.POCKETSTATION_RELAY_SESSION_ID;
const sourceToken = process.env.POCKETSTATION_RELAY_SOURCE_TOKEN;
if (!url || !sessionId || !sourceToken) {
  throw new Error(
    'Set POCKETSTATION_RELAY_URL, POCKETSTATION_RELAY_SESSION_ID, and POCKETSTATION_RELAY_SOURCE_TOKEN',
  );
}

const session = new Session();
const relay = session.relay({ url, sessionId, sourceToken });
const application = session.capture(Source.application(applicationName));

application.send(relay.audio('application'));

const running = await session.start();
console.log(`Publishing ${applicationName}. Press Ctrl+C to stop.`);
await once(process, 'SIGINT');
await running.stop();
