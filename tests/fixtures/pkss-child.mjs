import { readSync, writeSync } from 'node:fs';

const HEADER_BYTES = 52;
const KINDS = Object.freeze({
  signal: 1,
  ready: 2,
  cancel: 4,
  close: 5,
  hello: 6,
  manifest: 7,
  configure: 8,
  closed: 10,
});

function readExact(size) {
  const output = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(0, output, offset, size - offset, null);
    if (count === 0) throw new Error('unexpected end of input');
    offset += count;
  }
  return output;
}

function readMessage() {
  const size = readExact(4).readUInt32LE(0);
  const frame = readExact(size);
  if (frame.length < HEADER_BYTES || frame.subarray(0, 4).toString() !== 'PKSS') {
    throw new Error('invalid PKSS frame');
  }
  return { kind: frame[8], frame };
}

function makeMessage(kind, payload = Buffer.alloc(0), signalId = 'pks.sidecar.control.v1') {
  const signal = Buffer.from(signalId);
  const frame = Buffer.alloc(HEADER_BYTES + signal.length + payload.length);
  frame.write('PKSS', 0);
  frame.writeUInt16LE(1, 4);
  frame.writeUInt16LE(0, 6);
  frame[8] = kind;
  frame.writeUInt32LE(signal.length, 36);
  frame.writeUInt32LE(payload.length, 48);
  signal.copy(frame, HEADER_BYTES);
  payload.copy(frame, HEADER_BYTES + signal.length);
  return frame;
}

function writeMessage(kind, payload, source) {
  const frame = source === undefined
    ? makeMessage(kind, payload)
    : Buffer.from(source);
  frame[8] = kind;
  const size = Buffer.alloc(4);
  size.writeUInt32LE(frame.length);
  writeSync(1, size);
  writeSync(1, frame);
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function main() {
  const mode = process.argv[2] ?? 'healthy';
  if (readMessage().kind !== KINDS.hello) process.exit(2);
  writeMessage(KINDS.hello);
  if (mode === 'malformed') {
    const size = Buffer.alloc(4);
    size.writeUInt32LE(4);
    writeSync(1, size);
    writeSync(1, Buffer.from('NOPE'));
    process.exit(3);
  }
  writeMessage(KINDS.manifest, Buffer.from('{"ports":["signal"]}'));
  if (readMessage().kind !== KINDS.configure) process.exit(4);
  writeMessage(KINDS.ready);
  if (mode === 'crash') process.exit(17);
  if (mode === 'saturated') wait(250);
  while (true) {
    const { kind, frame } = readMessage();
    if (kind === KINDS.signal) {
      writeMessage(KINDS.signal, undefined, frame);
      continue;
    }
    if (kind === KINDS.close || kind === KINDS.cancel) {
      if (mode === 'hang') wait(30_000);
      writeMessage(KINDS.closed);
      return;
    }
  }
}

try {
  main();
} catch (failure) {
  if (failure?.code !== 'EPIPE') throw failure;
}
