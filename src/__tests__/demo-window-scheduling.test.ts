import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { EndOfStream, Session } from '../node/index.js';
import { WhisperCliModel, WhisperTranscriber, WhisperTranscriberConfiguration } from '../demo/faster-whisper.js';
import { createWhisperCliExecutable } from '../../tests/fixtures/whisper-cli-executable.js';

test('slow inference leaves frame readers independent and EOF tails source-aware', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pks-model-isolation-'));
  let calls = 0;
  const model = { async transcribe(audio: Float32Array) {
    calls += 1;
    await delay(200); // deliberately exceeds the old per-stem eight-frame budget
    return { segments: [{ start: 0, end: audio.length / 16000, text: audio[0]! > 0 ? 'application' : 'microphone' }],
      info: { language: 'en', languageProbability: 1 } };
  } };
  try {
    const session = new Session({ recordingRoot: directory, channels: 1 });
    const inputs = ['application', 'microphone'].map((name) => session.audioInput(name, { capacityFrames: 32, frameSamplesPerChannel: 960 }));
    const transcriber = new WhisperTranscriber(new WhisperTranscriberConfiguration({ windowSeconds: .5, maximumSources: 2 }), { modelFactory: () => model });
    const sub = transcriber.attachMany(session, inputs.map((input) => input.output));
    inputs.forEach((input, index) => input.output.record(index === 0 ? 'application' : 'microphone'));
    const running = await session.start();
    const events: Record<string, unknown>[] = [];
    const drain = (async () => {
      const stream = running.signals(sub);
      for (;;) {
        const envelope = await stream.read({ timeoutMs: 500 });
        if (envelope instanceof EndOfStream) return;
        if (envelope === undefined) continue;
        if (envelope.payload.kind !== 'text') throw new Error('expected transcript');
        const payload = JSON.parse(envelope.payload.text) as Record<string, unknown>;
        expect(String(envelope.lineage?.sourceId)).toBe(payload.source_id);
        events.push(payload);
      }
    })();
    try {
      for (let frame = 0; frame < 60; frame += 1) {
        await Promise.all(inputs.map((input, index) => input.write(new Float32Array(960).fill(index === 0 ? .1 : -.1))));
        await delay(20);
      }
    } finally {
      inputs.forEach((input) => input.close());
      const outcome = await running.stop();
      await drain;
      expect(outcome.success).toBe(true);
      for (const operator of outcome.metrics.operators) {
        expect(operator.inputDelivery.framesDroppedTotal).toBe(0n);
        expect(operator.worker.outputDroppedTotal).toBe(0n);
      }
      for (const route of outcome.metrics.routes) expect(route.delivery.framesDroppedTotal).toBe(0n);
    }
    expect(calls).toBe(4);
    expect(events).toHaveLength(6);
    expect(events.filter((event) => event.processing_outcome === 'skipped-short-window')).toHaveLength(2);
    for (const input of inputs) expect(events.filter((event) => event.source_id === String(input.sourceId))
      .reduce((sum, event) => sum + Number(event.duration_ms), 0)).toBe(1200);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 10_000);

test('closing a CLI model kills and joins its owned child and clears temporary audio', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pks-model-child-'));
  const statePath = join(directory, 'state.json');
  const executable = await createWhisperCliExecutable(directory, statePath);
  const model = new WhisperCliModel(new WhisperTranscriberConfiguration({ model: 'mock-model', whisperCliExecutable: executable }));
  const inference = model.transcribe(new Float32Array(16000), { beamSize: 1, language: 'en' });
  const observed = inference.then(() => null, (error: unknown) => error);
  try {
    let state: { pid: number; input: string } | undefined;
    const deadline = performance.now() + 2000;
    while (performance.now() < deadline && state === undefined) {
      try { state = JSON.parse(await readFile(statePath, 'utf8')) as typeof state; }
      catch { await delay(10); }
    }
    expect(state).toBeDefined();
    await model.close();
    expect(await observed).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
    expect(() => process.kill(state!.pid, 0)).toThrow();
    await expect(readFile(state!.input)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(model.transcribe(new Float32Array(1), { beamSize: 1, language: 'en' })).rejects.toThrow('closed');
  } finally { await model.close(); await rm(directory, { recursive: true, force: true }); }
});

