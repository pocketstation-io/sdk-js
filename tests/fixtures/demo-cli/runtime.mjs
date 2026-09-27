import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const mode = process.env.PKS_DEMO_TEST_MODE;
const record = (event) => appendFileSync(process.env.PKS_DEMO_TEST_TRACE, `${event}\n`);
let drained = 0;
let running = false;
export class Capture {
  constructor(options) {
    assert.equal(options.frameDurationMs, 10);
    this.session = {};
    this.application = { publish() {} };
    this.microphone = options.microphone ? { publish() {} } : undefined;
    this.stems = [this.application, ...(this.microphone ? [this.microphone] : [])];
  }
  get isRunning() { return running; }
  async start() { running = true; }
  signals() {
    return { async *iterSignals({ signal }) {
      while (running && !signal.aborted) await delay(1);
    } };
  }
  async *audioBatches({ signal }) {
    while (running && !signal.aborted) {
      await delay(1);
      if (mode === 'early-stream') return;
      drained++;
      yield { sourceId: BigInt(drained % 2 + 1) };
    }
  }
  async stop() { running = false; return { success: mode !== 'failed-outcome' }; }
  async cancel() { running = false; record('cancel'); return { success: false }; }
  async close() {
    running = false;
    record('capture-close');
    if (mode === 'close-failure') throw new Error('capture close failure');
  }
}
export class WhisperTranscriberConfiguration {
  constructor(options) { assert.equal(options.inputFrameSamplesPerChannel, 480); }
}
export class WhisperTranscriber {
  attachMany() { return {}; }
}
export class Transcript {}
export class RelaySession {
  static async create(options) {
    assert.deepEqual(options.requiredBuses, ['application', 'microphone']);
    return new RelaySession();
  }
  publisher() { return {}; }
  async waitForPublisher() {
    await delay(25);
    assert.ok(drained > 0, 'audio must drain during publisher activation');
    record('publisher');
  }
  async createReceiverInvitation(options) {
    assert.equal(options.visibility, 'private');
    record(`invite:${options.busId}`);
    return {
      shareAlias: `${options.busId}-words`,
      exposeShareUrl: () => `https://receiver.invalid/s/${options.busId}-words#private-secret`,
    };
  }
  async waitForReceiver() {
    if (mode === 'receiver-failure') throw new Error('receiver activation failed');
    await delay(10);
    record('receiver');
  }
  async close() { record('remote-close'); }
}
