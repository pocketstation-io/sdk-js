/** Native graph/recording with finite MOCKED models; no device or service access. */
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { EndOfStream, Session } from '../node/index.js';
import { WhisperCliModel, WhisperTranscriber, WhisperTranscriberConfiguration } from '../demo/faster-whisper.js';

test.each([0, 9, 1.5, NaN, null])('rejects invalid inferenceConcurrency %p', value => {
  expect(() => new WhisperTranscriberConfiguration({ inferenceConcurrency: value as number })).toThrow();
});
test('validates total CPU and prompt bounds without disclosing prompt text', () => {
  expect(() => new WhisperTranscriberConfiguration({ inferenceConcurrency: 2, cpuThreads: 1 })).toThrow('budget');
  expect(() => new WhisperTranscriberConfiguration({ inferenceConcurrency: 2, numWorkers: 2 })).toThrow('numWorkers');
  for (const initialPrompt of ['', ' ', 'a\0b', 'é'.repeat(1025), null]) {
    expect(() => new WhisperTranscriberConfiguration({ initialPrompt: initialPrompt as string })).toThrow('initialPrompt');
  }
  expect(new WhisperTranscriberConfiguration({ initialPrompt: 'é'.repeat(1024) }).initialPrompt).toHaveLength(1024);
  expect(new WhisperTranscriberConfiguration().inferenceConcurrency).toBe(1);
});

test('CLI model forwards configured context literally to an owned executable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pks-prompt-model-'));
  const executable = join(directory, 'mock-whisper.mjs');
  await writeFile(executable, `#!${process.execPath}\nimport fs from 'node:fs';\nconst a=process.argv;\nconst prompt=a[a.indexOf('--prompt')+1];\nfs.writeFileSync(a[a.indexOf('-of')+1]+'.json',JSON.stringify({transcription:[{text:prompt,offsets:{from:0,to:10}}],result:{language:'en'}}));\n`);
  await chmod(executable, 0o700);
  const model = new WhisperCliModel(new WhisperTranscriberConfiguration({
    model: 'mock', whisperCliExecutable: executable, initialPrompt: 'Café application vocabulary',
  }));
  try {
    const result = await model.transcribe(new Float32Array(160), { beamSize: 1, language: 'en' });
    expect(result.segments[0]!.text).toBe('Café application vocabulary');
    await expect(model.transcribe(new Float32Array(160), { beamSize: 1, language: 'en', initialPrompt: 'x\0y' })).rejects.toThrow('initialPrompt');
  } finally { await model.close(); await rm(directory, { recursive: true, force: true }); }
});

test.each(['stop', 'cancel'] as const)('parallel source-affine inference preserves identity and %s joins', async mode => {
  const directory = await mkdtemp(join(tmpdir(), 'pks-parallel-model-'));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const budgets: number[] = [], modelSources: Set<boolean>[] = [];
  let active = 0, maximumActive = 0, closed = 0, cancelled = 0, calls = 0;
  const configuration = new WhisperTranscriberConfiguration({ windowSeconds: .1,
    inferenceConcurrency: 2, cpuThreads: 5, maximumSources: 2, initialPrompt: 'application vocabulary' });
  const model = new WhisperTranscriber(configuration, { modelFactory: worker => {
    budgets.push(worker.cpuThreads);
    const sources = new Set<boolean>(); modelSources.push(sources);
    let localActive = false, aborted = false;
    return {
      async transcribe(audio, options) {
        expect(localActive).toBe(false); localActive = true;
        expect(options.initialPrompt).toBe(configuration.initialPrompt);
        sources.add(audio.reduce((sum, sample) => sum + sample, 0) > 0);
        calls++; active++; maximumActive = Math.max(maximumActive, active);
        try { await held; await delay(10); return { segments: [{ start: 0, end: .1, text: 'finite result' }],
          info: { language: 'en', languageProbability: 1 } }; }
        finally { active--; localActive = false; }
      },
      cancel() { if (!aborted) cancelled++; aborted = true; release(); },
      close() { closed++; },
    };
  } });
  const session = new Session({ recordingRoot: directory, channels: 1 });
  const inputs = ['application', 'microphone'].map(name => session.audioInput(name,
    { capacityFrames: 32, frameSamplesPerChannel: 960 }));
  const subscription = model.attachMany(session, inputs.map(input => input.output));
  inputs.forEach((input, index) => input.output.record(index === 0 ? 'application' : 'microphone'));
  const running = await session.start();
  const events: { source: string; payloadSource: string }[] = [];
  const stream = running.signals(subscription);
  const drain = (async () => {
    for (;;) {
      const event = await stream.read({ timeoutMs: 100 });
      if (event instanceof EndOfStream) return;
      if (event === undefined) continue;
      if (event.payload.kind !== 'text') throw new Error('expected text');
      events.push({ source: String(event.lineage.sourceId), payloadSource: JSON.parse(event.payload.text).source_id });
    }
  })();
  try {
    for (let frame = 0; frame < 20; frame++) {
      for (const [index, input] of inputs.entries()) await input.write(new Float32Array(960).fill(index === 0 ? .1 : -.1));
      await delay(20);
    }
    expect(active).toBe(2); expect(calls).toBe(2);
    expect(budgets.sort()).toEqual([2, 3]);
    const started = performance.now();
    let outcome;
    if (mode === 'stop') { release(); inputs.forEach(input => input.close()); outcome = await running.stop(); }
    else outcome = await running.cancel();
    await drain;
    expect(performance.now() - started).toBeLessThan(2000);
    expect(outcome.success).toBe(true);
    expect(outcome.recording?.complete).toBe(true);
    expect(outcome.recording?.stems.map(stem => stem.framesWrittenTotal)).toEqual([20n, 20n]);
    expect(outcome.metrics.operators.every(operator => operator.worker.joined)).toBe(true);
    expect(active).toBe(0); expect(maximumActive).toBe(2); expect(closed).toBe(2);
    expect(modelSources.every(sources => sources.size === 1)).toBe(true);
    if (mode === 'stop') {
      expect(events).toHaveLength(8);
      expect(events.every(event => event.source === event.payloadSource)).toBe(true);
      expect(new Set(events.map(event => event.source))).toEqual(new Set(inputs.map(input => String(input.sourceId))));
    } else { expect(cancelled).toBe(2); expect(events).toHaveLength(0); expect(calls).toBe(2); }
  } finally {
    release(); inputs.forEach(input => input.close()); await running.cancel(); await drain;
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);
