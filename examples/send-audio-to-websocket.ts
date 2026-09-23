import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';

import { connector, Session, Source } from 'pocketstation/node';

const prompt = createInterface({ input: process.stdin, output: process.stdout });
const application = (await prompt.question('Application to capture: ')).trim();
prompt.close();
if (!application) throw new Error('Choose a running application');
const url = process.env.AUDIO_WEBSOCKET_URL;
const token = process.env.AUDIO_WEBSOCKET_TOKEN;
if (!url || !token) throw new Error('Set AUDIO_WEBSOCKET_URL and AUDIO_WEBSOCKET_TOKEN');
if (new URL(url).protocol !== 'wss:') throw new Error('A secure wss:// WebSocket is required');

const require = createRequire(import.meta.url);
type Socket = {
  once(event: 'open' | 'error' | 'close', listener: (...args: unknown[]) => void): void;
  send(data: Buffer, callback: (error?: Error) => void): void;
  close(): void;
};
const WebSocket = (require('ws') as {
  WebSocket: new (address: string, options: { headers: { Authorization: string } }) => Socket;
}).WebSocket;
const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
await new Promise<void>((resolve, reject) => {
  socket.once('open', () => resolve());
  socket.once('error', reject);
});

const session = new Session({ sampleRateHz: 48_000, channels: 1 });
session.capture(Source.application(application)).sendTo(connector((frame) =>
  new Promise<void>((resolve, reject) => {
    const samples = Buffer.allocUnsafe(frame.samples.length * Float32Array.BYTES_PER_ELEMENT);
    for (let index = 0; index < frame.samples.length; index += 1) {
      samples.writeFloatLE(frame.samples[index]!, index * Float32Array.BYTES_PER_ELEMENT);
    }
    socket.send(samples, (error) => error ? reject(error) : resolve());
  }),
));

const finished = new Promise<void>((resolve, reject) => {
  process.once('SIGINT', resolve);
  socket.once('close', () => resolve());
  socket.once('error', reject);
});
try {
  const result = await session.run(async () => { await finished; });
  if (!result.success) throw new Error('Capture Session stopped with a delivery failure');
} finally {
  socket.close();
}
