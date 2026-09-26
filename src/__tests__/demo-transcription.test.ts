import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  WhisperTranscriber,
  WhisperTranscriberConfiguration,
  WhisperCliModel,
  readUtf8WithLimit,
  type WhisperModel,
} from '../demo/faster-whisper.js';
import { Transcript } from '../demo/transcript.js';
import { EndOfStream, Multiplicity, Session, type Capture } from '../node/index.js';

describe('demo batch transcription', () => {
  it('can forbid model downloads in the declared Operator permission policy', () => {
    const transcription = new WhisperTranscriber(
      new WhisperTranscriberConfiguration({
        model: '/opt/models/ggml-base.bin',
      }),
      { modelFactory: () => sourceModel() },
    );

    expect(transcription.manifest.networkAllowed).toBe(false);
    expect(transcription.manifest.filesystemAllowed).toBe(true);
    expect(transcription.manifest.inputs[0]?.multiplicity).toBe(Multiplicity.MANY);
  });

  it('shares one bounded model while preserving two source identities', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pks-js-transcription-'));
    let modelCreations = 0;
    let modelCalls = 0;
    const model: WhisperModel = {
      transcribe: (audio, options) => {
        modelCalls += 1;
        expect(audio).toHaveLength(4_800);
        expect(options).toEqual({ beamSize: 1, language: 'en' });
        const text = audio.reduce((total, sample) => total + sample, 0) > 0
          ? 'application source'
          : 'microphone source';
        return {
          segments: [{ start: 0, end: 0.1, text }],
          info: { language: 'en', languageProbability: 1 },
        };
      },
    };
    const transcription = new WhisperTranscriber(
      new WhisperTranscriberConfiguration({
        model: 'test-model',
        language: 'en',
        beamSize: 1,
        windowSeconds: 0.1,
        maximumSources: 2,
        inputFrameSamplesPerChannel: 960,
      }),
      {
        modelFactory: () => {
          modelCreations += 1;
          return model;
        },
        audioConverter: (window) => new Float32Array(window.samples),
      },
    );

    try {
      const session = new Session({ recordingRoot: directory });
      const application = session.audioInput('application', {
        capacityFrames: 16,
        frameSamplesPerChannel: 960,
      });
      const microphone = session.audioInput('microphone', {
        capacityFrames: 16,
        frameSamplesPerChannel: 960,
      });
      const subscription = transcription.attachMany(session, [
        application.output,
        microphone.output,
      ]);
      application.output.record('application');
      microphone.output.record('microphone');

      const running = await session.start();
      const received = new Map<bigint, Record<string, unknown>>();
      try {
        for (let index = 0; index < 5; index += 1) {
          await application.write(new Float32Array(960).fill(0.1));
          await microphone.write(new Float32Array(960).fill(-0.1));
          await delay(10);
        }
        application.close();
        microphone.close();
        const stream = running.signals(subscription);
        const deadline = performance.now() + 5_000;
        while (received.size < 2 && performance.now() < deadline) {
          const envelope = await stream.read({ timeoutMs: 500 });
          if (envelope === undefined) continue;
          if (envelope instanceof EndOfStream) break;
          if (envelope.payload.kind !== 'text') throw new Error('expected transcript text');
          const value = JSON.parse(envelope.payload.text) as Record<string, unknown>;
          received.set(BigInt(value.source_id as string), value);
        }
      } finally {
        const outcome = await running.stop();
        expect(outcome.success).toBe(true);
        expect(outcome.recording?.state).toBe('complete');
      }

      expect(modelCreations).toBe(1);
      expect(modelCalls).toBe(2);
      expect(new Set(received.keys())).toEqual(new Set([application.sourceId, microphone.sourceId]));
      expect(received.get(application.sourceId)?.text).toBe('application source');
      expect(received.get(microphone.sourceId)?.text).toBe('microphone source');
      for (const value of received.values()) {
        expect(value.sequence_start).toBe('0');
        expect(value.sequence_end).toBe('4');
        expect(value.clock_id).toBe(1);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('attaches the Operator before Session compilation', async () => {
    const session = new Session();
    const input = session.audioInput('application');
    const transcription = new WhisperTranscriber(
      new WhisperTranscriberConfiguration({ windowSeconds: 0.1 }),
      { modelFactory: () => sourceModel() },
    );
    const capture = {
      session,
      stems: [input.output],
      async *signals(): AsyncGenerator<never> {},
    } as unknown as Capture;

    const transcripts = transcription.transcribe(capture);
    const running = await session.start();
    try {
      await expect(transcripts.next()).resolves.toEqual({ done: true, value: undefined });
    } finally {
      await running.cancel();
    }
  });

  it('rejects a whisper-cli result that exceeds maximumOutputBytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pks-js-whisper-limit-'));
    const result = join(directory, 'transcript.json');
    try {
      await writeFile(result, 'x'.repeat(1_025));
      await expect(readUtf8WithLimit(result, 1_024))
        .rejects.toThrow('whisper-cli transcript exceeds maximumOutputBytes');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('decodes source identity and timestamps beyond JavaScript safe-integer precision', () => {
    const sourceId = 9_007_199_254_740_993n;
    const timestampStartNs = 18_014_398_509_481_986n;
    const timestampEndNs = timestampStartNs + 960_000n;

    const transcript = Transcript.fromJson(JSON.stringify({
      source_id: sourceId.toString(),
      text: 'precise identity',
      language: 'en',
      timestamp_start_ns: timestampStartNs.toString(),
      timestamp_end_ns: timestampEndNs.toString(),
      discontinuity_reasons: [],
    }));

    expect(transcript.sourceId).toBe(sourceId);
    expect(transcript.timestampStartNs).toBe(timestampStartNs);
    expect(transcript.timestampEndNs).toBe(timestampEndNs);
  });

  it.each([
    true,
    1.5,
    '1.5',
    null,
    9_007_199_254_740_992,
  ])('rejects a non-integer JSON source identity: %p', (sourceId) => {
    expect(() => Transcript.fromJson(JSON.stringify({
      source_id: sourceId,
      text: 'unsafe identity',
      language: 'en',
      timestamp_start_ns: '1',
      timestamp_end_ns: '2',
      discontinuity_reasons: [],
    }))).toThrow('source_id must be an integer');
  });

  const realModel = process.env.PKS_REAL_TRANSCRIPTION_MODEL;
  (realModel === undefined ? it.skip : it)(
    'uses the real installed whisper-cli when a Lab model fixture is supplied',
    async () => {
      const configuration = new WhisperTranscriberConfiguration({
        model: realModel,
        language: 'en',
      });
      const result = await new WhisperCliModel(configuration).transcribe(
        new Float32Array(16_000),
        { beamSize: 1, language: 'en' },
      );
      expect(result.info.language).toBeTruthy();
      expect(Array.isArray(result.segments)).toBe(true);
    },
    130_000,
  );
});

function sourceModel(): WhisperModel {
  return {
    transcribe: () => ({
      segments: [{ start: 0, end: 0.1, text: 'pocket station' }],
      info: { language: 'en', languageProbability: 0.99 },
    }),
  };
}
