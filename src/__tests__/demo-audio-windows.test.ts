import {
  AudioWindowBuffer,
  downmix,
  resample,
} from '../demo/audio-windows.js';
import {
  ClockDomainId,
  RuntimeSessionId,
  SignalSpec,
  SourceId,
  StreamId,
  type SignalEnvelope,
} from '../node/index.js';

describe('demo audio windows', () => {
  it.each([
    [{ windowSeconds: Number.NaN, maximumSources: 1 }, 'windowSeconds'],
    [{ windowSeconds: 0, maximumSources: 1 }, 'windowSeconds'],
    [{ windowSeconds: 31, maximumSources: 1 }, 'windowSeconds'],
    [{ windowSeconds: 1, maximumSources: 0 }, 'maximumSources'],
    [{ windowSeconds: 1, maximumSources: 1.5 }, 'maximumSources'],
    [{ windowSeconds: 1, maximumSources: 65 }, 'maximumSources'],
  ])('rejects unsafe window storage options %#', (options, expectedName) => {
    expect(() => new AudioWindowBuffer(options)).toThrow(expectedName);
  });

  it.each([
    [7_999, 1, 'sampleRateHz'],
    [384_001, 1, 'sampleRateHz'],
    [Number.NaN, 1, 'sampleRateHz'],
    [48_000, 0, 'channelCount'],
    [48_000, 1.5, 'channelCount'],
    [48_000, 65, 'channelCount'],
  ])(
    'rejects unsafe PCM format values rate=%p channels=%p',
    (sampleRateHz, channelCount, expectedName) => {
      const buffer = new AudioWindowBuffer({ windowSeconds: 0.1, maximumSources: 1 });
      expect(() => buffer.push(audioEnvelope(new Float32Array(2), {
        sampleRateHz,
        channelCount,
      }))).toThrow(expectedName);
    },
  );

  it('rejects mismatched, unaligned, and oversized frames before retaining source state', () => {
    const buffer = new AudioWindowBuffer({ windowSeconds: 0.1, maximumSources: 1 });

    expect(() => buffer.push(audioEnvelope(new Float32Array(2), {
      sampleCount: 1,
    }))).toThrow('audio payload size does not match sampleCount');
    expect(() => buffer.push(audioEnvelope(new Float32Array(3), {
      channelCount: 2,
      sampleCount: 3,
    }))).toThrow('complete interleaved channel frames');
    expect(() => buffer.push(audioEnvelope(new Float32Array(262_145)))).toThrow(
      'sampleCount must be an integer from 1 through 262144',
    );

    const accepted = new Float32Array(800).fill(0.25);
    expect(buffer.push(audioEnvelope(accepted, { sourceId: 2n, streamId: 2n }))).toHaveLength(1);
  });

  it('rejects aggregate windows that exceed the finite sample bound', () => {
    const buffer = new AudioWindowBuffer({ windowSeconds: 30, maximumSources: 1 });
    expect(() => buffer.push(audioEnvelope(new Float32Array(64), {
      sampleRateHz: 384_000,
      channelCount: 64,
    }))).toThrow('window sample count exceeds 16777216');
  });

  it('rejects nonpositive explicit duration before retaining source state', () => {
    const buffer = new AudioWindowBuffer({ windowSeconds: 0.1, maximumSources: 1 });
    expect(() => buffer.push(audioEnvelope(new Float32Array(400), {
      durationNs: 0n,
    }))).toThrow('durationNs must be greater than zero');

    expect(buffer.push(audioEnvelope(new Float32Array(800), {
      sourceId: 2n,
      streamId: 2n,
    }))).toHaveLength(1);
  });

  it('returns owned window snapshots that cannot mutate buffered or caller PCM', () => {
    const buffer = new AudioWindowBuffer({ windowSeconds: 0.1, maximumSources: 1 });
    const firstSamples = new Float32Array(400).fill(0.25);
    const secondSamples = new Float32Array(400).fill(0.5);

    expect(buffer.push(audioEnvelope(firstSamples))).toHaveLength(0);
    firstSamples.fill(9);
    const completed = buffer.push(audioEnvelope(secondSamples, {
      sequenceNumber: 1n,
      timestampNs: 50_000_000n,
    }));

    expect(completed).toHaveLength(1);
    expect(Object.isFrozen(completed)).toBe(true);
    expect(Object.isFrozen(completed[0])).toBe(true);
    expect(completed[0]?.samples.slice(0, 400)).toEqual(new Float32Array(400).fill(0.25));
    completed[0]!.samples.fill(-1);
    expect(firstSamples[0]).toBe(9);
    expect(secondSamples[0]).toBe(0.5);

    const nextSamples = new Float32Array(200).fill(0.75);
    expect(buffer.push(audioEnvelope(nextSamples, {
      sequenceNumber: 2n,
      timestampNs: 100_000_000n,
    }))).toHaveLength(0);
    const flushed = buffer.flush();
    nextSamples.fill(5);
    expect(flushed[0]?.samples).toEqual(new Float32Array(200).fill(0.75));
  });

  it('requires complete interleaved frames when downmixing', () => {
    expect(() => downmix(new Float32Array([1, 2, 3]), 2)).toThrow(
      'complete interleaved channel frames',
    );
    expect(() => downmix(new Float32Array([1, 2]), 0)).toThrow('channelCount');
    expect(downmix(new Float32Array([1, 3, 2, 4]), 2)).toEqual(
      new Float32Array([2, 3]),
    );
  });

  it('validates resampling rates, bounds output, and never aliases caller samples', () => {
    const samples = new Float32Array([0.25, 0.5]);
    const copied = resample(samples, 16_000, 16_000);
    copied[0] = 1;
    expect(samples[0]).toBe(0.25);

    expect(() => resample(samples, 0)).toThrow('sourceRateHz');
    expect(() => resample(samples, 16_000, Number.POSITIVE_INFINITY)).toThrow(
      'targetRateHz',
    );
    expect(() => resample(new Float32Array(400_000), 8_000, 384_000)).toThrow(
      'resampled output exceeds',
    );
  });
});

function audioEnvelope(
  samples: Float32Array,
  options: {
    readonly sampleCount?: number;
    readonly sampleRateHz?: number;
    readonly channelCount?: number;
    readonly sessionId?: bigint;
    readonly sourceId?: bigint;
    readonly streamId?: bigint;
    readonly sequenceNumber?: bigint;
    readonly timestampNs?: bigint;
    readonly durationNs?: bigint;
  } = {},
): SignalEnvelope {
  const sessionId = RuntimeSessionId(options.sessionId ?? 1n);
  const sourceId = SourceId(options.sourceId ?? 1n);
  const streamId = StreamId(options.streamId ?? 1n);
  const sequenceNumber = options.sequenceNumber ?? 0n;
  const timestampNs = options.timestampNs ?? 0n;
  const clockId = ClockDomainId(1);
  return {
    signal: SignalSpec.audio(),
    timing: {
      sourceTimestampNs: timestampNs,
      observedTimestampNs: timestampNs,
      sessionTimestampNs: timestampNs,
      durationNs: options.durationNs ?? 50_000_000n,
    },
    lineage: {
      sessionId,
      sourceId,
      streamId,
      clockId,
      clock: {
        id: clockId,
        kind: 'process-monotonic',
        origin: 'process-start',
        tickRateHz: 1_000_000_000n,
      },
      sequenceNumber,
      sourceGeneration: 1,
      discontinuityEpoch: 0n,
      policyEpoch: 0n,
    },
    payload: {
      kind: 'audio',
      samplesF32le: new Uint8Array(
        samples.buffer,
        samples.byteOffset,
        samples.byteLength,
      ),
      sampleCount: options.sampleCount ?? samples.length,
      sampleFormat: 'f32le',
      samples,
      sampleRateHz: options.sampleRateHz ?? 8_000,
      channelCount: options.channelCount ?? 1,
      sourceId,
      streamId,
      sequenceNumber,
      timestampNs,
    },
  };
}
