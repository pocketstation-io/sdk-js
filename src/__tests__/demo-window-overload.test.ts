/** Actual native graph/recording; only the held inference callback is MOCKED. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { EndOfStream, Session } from '../node/index.js';
import { WhisperTranscriber, WhisperTranscriberConfiguration } from '../demo/faster-whisper.js';

const FRAME_MS = 20;
const SATURATION_FRAMES = 100;
const RECOVERY_FRAMES = 20;
const ABORT_BUDGET_MS = 2000;

test.each(['recover', 'abort'] as const)('complete-window overload isolates recording and %s is bounded', async (mode) => {
  const directory = await mkdtemp(join(tmpdir(), 'pks-window-overload-'));
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let entered = false, calls = 0, active = 0, maximumActive = 0, cancelled = false;
  const model = {
    async transcribe() {
      entered = true; calls += 1; active += 1; maximumActive = Math.max(maximumActive, active);
      try { await held; return { segments: [{ start: 0, end: .1, text: 'finite model result' }],
        info: { language: 'en', languageProbability: 1 } }; }
      finally { active -= 1; }
    },
    cancel() { cancelled = true; release(); },
  };
  const session = new Session({ recordingRoot: directory, channels: 1 });
  const inputs = ['application', 'microphone'].map(name => session.audioInput(name,
    { capacityFrames: 32, frameSamplesPerChannel: 960 }));
  const transcriber = new WhisperTranscriber(new WhisperTranscriberConfiguration({
    windowSeconds: .1, maximumSources: 2, inferenceTimeoutS: 10,
  }), { modelFactory: () => model });
  const sub = transcriber.attachMany(session, inputs.map(input => input.output));
  inputs.forEach((input, index) => input.output.record(index === 0 ? 'application' : 'microphone'));
  const running = await session.start();
  const events: Record<string, unknown>[] = [];
  const stream = running.signals(sub);
  const drain = (async () => {
    for (;;) {
      const item = await stream.read({ timeoutMs: 100 });
      if (item instanceof EndOfStream) return;
      if (item === undefined) continue;
      if (item.payload.kind !== 'text') throw new Error('expected transcript');
      events.push(JSON.parse(item.payload.text) as Record<string, unknown>);
    }
  })();
  const feed = async (frames: number) => {
    for (let frame = 0; frame < frames; frame += 1) {
      for (const [index, input] of inputs.entries()) await input.write(new Float32Array(960).fill(index ? -.1 : .1));
      await delay(FRAME_MS);
    }
  };
  try {
    await feed(SATURATION_FRAMES);
    expect(entered).toBe(true);
    expect(calls).toBe(1);
    const saturated = await running.metrics();
    const inference = saturated.operators.find(operator => operator.inputPorts.some(port => port.portName === 'window'))!;
    expect(inference).toBeDefined();
    expect(inference.inputDelivery.framesDroppedTotal).toBeGreaterThan(0n);
    expect(inference.inputDelivery.queueCapacityFrames).toBeLessThanOrEqual(16n);
    expect(inference.inputDelivery.queuePeakFrames).toBeLessThanOrEqual(inference.inputDelivery.queueCapacityFrames);
    if (mode === 'recover') { release(); await feed(RECOVERY_FRAMES); }
    if (mode === 'recover') inputs.forEach(input => input.close());
    const started = performance.now();
    const outcome = mode === 'abort' ? await running.cancel() : await running.stop();
    const shutdownMs = performance.now() - started;
    await drain;
    expect(shutdownMs).toBeLessThan(ABORT_BUDGET_MS);
    expect(outcome.success).toBe(true);
    expect(outcome.recording?.complete).toBe(true);
    expect(maximumActive).toBe(1);
    expect(active).toBe(0);
    for (const stem of outcome.recording!.stems) {
      expect(stem.framesWrittenTotal).toBe(BigInt(SATURATION_FRAMES + (mode === 'recover' ? RECOVERY_FRAMES : 0)));
      expect(stem.framesDroppedTotal).toBe(0n);
      expect(stem.discontinuitiesTotal).toBe(0n);
    }
    for (const route of outcome.metrics.routes) expect(route.delivery.framesDroppedTotal).toBe(0n);
    expect(outcome.metrics.operators.every(operator => operator.worker.joined)).toBe(true);
    if (mode === 'abort') {
      expect(outcome.disposition).toBe('cancelled'); expect(cancelled).toBe(true);
      expect(calls).toBe(1); expect(events).toHaveLength(0);
    } else {
      for (const input of inputs) {
        const source = events.filter(event => event.source_id === String(input.sourceId));
        expect(source.some((event, index) => index > 0 && BigInt(String(event.sequence_start)) > BigInt(String(source[index - 1]!.sequence_end)) + 1n)).toBe(true);
      }
    }
    if (process.env.PKS_TEST_EVIDENCE_DIR) await writeFile(join(process.env.PKS_TEST_EVIDENCE_DIR, `js-overload-${mode}.json`),
      JSON.stringify({ classification: 'actual native PCM/recording; model callback MOCKED', mode, calls,
        maximumActive, shutdownMs, saturated: inference.inputDelivery, outcome, events },
      (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value, 2));
  } finally {
    release(); inputs.forEach(input => input.close());
    await running.cancel(); await drain; await rm(directory, { recursive: true, force: true });
  }
}, 10000);
