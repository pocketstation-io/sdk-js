import { defineOperator, PortSpec, SignalSpec, EndOfStream, Session } from '../node/index.js';

test.each([false, true])('Session stop retains accepted signals; explicit close discards: %s', async (explicitClose) => {
  const session = new Session({ channels: 1 });
  const source = session.audioInput('input', { frameSamplesPerChannel: 480 });
  const text = SignalSpec.text();
  let entered!: () => void;
  const processed = new Promise<void>((resolve) => { entered = resolve; });
  const operator = session.operator(defineOperator({
    id: 'test.receipt.tail', inputs: [PortSpec.input('audio', SignalSpec.audio())],
    outputs: [PortSpec.output('text', text)], create: () => ({
      process() { entered(); return [{ output: 'text', data: 'completed' }]; },
      flush() { return [{ output: 'text', data: 'tail' }]; },
    }),
  }));
  source.output.connect(operator.input('audio'));
  const subscription = session.subscribe(operator.output('text'), { signal: text });
  const running = await session.start();
  const stream = running.signals(subscription);
  await source.write(new Float32Array(480).fill(.1));
  await processed;
  source.close();
  expect((await running.stop()).success).toBe(true);
  if (explicitClose) stream.close();
  const values: string[] = [];
  for (;;) {
    const item = await stream.read({ timeoutMs: 1000 });
    if (item instanceof EndOfStream) break;
    if (item === undefined || item.payload.kind !== 'text') throw new Error('missing accepted signal');
    values.push(item.payload.text);
  }
  expect(values).toEqual(explicitClose ? [] : ['completed', 'tail']);
}, 5000);
