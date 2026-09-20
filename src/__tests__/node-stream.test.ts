import {
  AudioBatch,
  AudioStream,
  END_OF_STREAM,
  PocketStationError,
  Session,
  Source,
  StreamAbortError,
  StreamInUseError,
  StreamModeError,
} from '../node/index.js';
import type {
  NativeAudioRead,
  NativeRunningSessionHandle,
  NativeStopResult,
} from '../node/native.js';

const STOP_RESULT: NativeStopResult = {
  success: true,
  alreadyStopped: false,
  disposition: 'stopped',
  sessionState: 'stopped',
  runtimeWorkerPanicked: false,
  captureFinalizationFailuresTotal: '0',
  operatorFinalizationFailuresTotal: '0',
  endpointFinalizationFailuresTotal: '0',
  runtimeFailuresTotal: '0',
  lineageFailuresTotal: '0',
  sourceSendRejectionsTotal: '0',
  runtimeEventsTotal: '0',
  sidecarOutcomes: [],
  remainingEvents: [],
};

function nativeReader(reads: NativeAudioRead[]): NativeRunningSessionHandle {
  return {
    sessionId: '1',
    readAudio: async () =>
      reads.shift() ?? { frames: [], sessionState: 'stopped' },
    monotonicTimestampNs: () => '13',
    readEvent: async () => ({ sessionState: 'stopped' }),
    stop: async () => STOP_RESULT,
    cancel: async () => STOP_RESULT,
  };
}

describe('Node audio stream', () => {
  it('Given a terminal native read When iterated Then the stream ends', async () => {
    const stream = AudioStream._create(
      nativeReader([{ frames: [], sessionState: 'stopped' }]),
    );
    const received = [];

    for await (const frame of stream) {
      received.push(frame);
    }

    expect(received).toHaveLength(0);
    expect(stream.closed).toBe(true);
  });

  it('Given two concurrent readers When both start Then the second fails clearly', async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const native = nativeReader([]);
    native.readAudio = async () => {
      await wait;
      return { frames: [], sessionState: 'stopped' };
    };
    const stream = AudioStream._create(native);
    const first = stream.frames().next();

    let failure: unknown;
    try {
      await stream.frames().next();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(PocketStationError);
    expect(failure).toBeInstanceOf(StreamInUseError);
    expect((failure as PocketStationError).code).toBe('stream.in_use');
    release?.();
    await first;
  });

  it('Given one direct read is pending When another direct read starts Then it fails immediately', async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const native = nativeReader([]);
    native.readAudio = async () => {
      await wait;
      return { frames: [nativeFrame('1')], sessionState: 'running' };
    };
    const stream = AudioStream._create(native);
    const first = stream.read();

    await expect(stream.read({ timeoutMs: 0 })).rejects.toMatchObject({
      code: 'stream.in_use',
      mode: 'read',
    });
    release?.();
    await expect(first).resolves.toMatchObject({ sequenceNumber: 1n });
  });

  it('Given an aborted signal When read Then native work is not requested', async () => {
    let reads = 0;
    const native = nativeReader([]);
    native.readAudio = async () => {
      reads += 1;
      return { frames: [], sessionState: 'running' };
    };
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(
      AudioStream._create(native).read({ signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
      code: 'stream.aborted',
      reason: expect.any(Error),
    });
    expect(reads).toBe(0);
  });

  it('Given a running stream with no frame When read expires Then it returns undefined', async () => {
    const stream = AudioStream._create(
      nativeReader([{ frames: [], sessionState: 'running' }]),
    );

    await expect(stream.read({ timeoutMs: 0 })).resolves.toBeUndefined();
    expect(stream.closed).toBe(false);
  });

  it('Given a closed stream When read Then it returns the end marker', async () => {
    const stream = AudioStream._create(
      nativeReader([{ frames: [], sessionState: 'stopped' }]),
    );

    await expect(stream.read()).resolves.toBe(END_OF_STREAM);
    await expect(stream.read()).resolves.toBe(END_OF_STREAM);
  });

  it('Given a direct read chose frame mode When iteration starts Then switching mode fails', async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const native = nativeReader([]);
    native.readAudio = async () => {
      await wait;
      return { frames: [], sessionState: 'stopped' };
    };
    const stream = AudioStream._create(native);
    const first = stream.read();

    await expect(stream.frames().next()).rejects.toMatchObject({
      code: 'stream.mode_conflict',
      activeMode: 'read',
      requestedMode: 'frames',
    });
    release?.();
    await first;
  });

  it('Given abort during a native read When frames arrive Then they remain available', async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const native = nativeReader([]);
    native.readAudio = async () => {
      await wait;
      return {
        frames: [nativeFrame('7')],
        sessionState: 'running',
      };
    };
    const stream = AudioStream._create(native);
    const controller = new AbortController();
    const read = stream.read({ signal: controller.signal });
    controller.abort(new Error('cancelled'));
    release?.();

    await expect(read).rejects.toBeInstanceOf(StreamAbortError);
    await expect(stream.read()).resolves.toMatchObject({ sequenceNumber: 7n });
  });

  it('Given a waiting read When aborted Then it stops within one wait slice', async () => {
    const native = nativeReader([]);
    native.readAudio = async (timeoutMs) => {
      await new Promise((resolve) => setTimeout(resolve, timeoutMs));
      return { frames: [], sessionState: 'running' };
    };
    const controller = new AbortController();
    const startedAt = performance.now();
    const read = AudioStream._create(native).read({
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort('test complete'), 5);

    await expect(read).rejects.toMatchObject({
      name: 'AbortError',
      reason: 'test complete',
    });
    expect(performance.now() - startedAt).toBeLessThan(100);
  });

  it('Given zero wait When iteration starts Then it rejects instead of spinning', async () => {
    const stream = AudioStream._create(nativeReader([]));

    await expect(stream.frames({ timeoutMs: 0 }).next()).rejects.toThrow(
      'frames() requires timeoutMs to be greater than zero',
    );
  });

  it.each([-1, 1_001, 0.5])(
    'Given invalid timeout %p When read starts Then it is rejected before native work',
    async (timeoutMs) => {
      let reads = 0;
      const native = nativeReader([]);
      native.readAudio = async () => {
        reads += 1;
        return { frames: [], sessionState: 'running' };
      };

      await expect(
        AudioStream._create(native).read({ timeoutMs }),
      ).rejects.toThrow('timeoutMs must be an integer between 0 and 1000');
      expect(reads).toBe(0);
    },
  );

  it('Given zero wait When batch iteration starts Then it rejects instead of spinning', async () => {
    const stream = AudioStream._create(nativeReader([]));

    await expect(stream.batches({ timeoutMs: 0 }).next()).rejects.toThrow(
      'batches() requires timeoutMs to be greater than zero',
    );
  });

  it('Given two frames in one native batch When read twice Then native is polled once', async () => {
    const native = nativeReader([]);
    let reads = 0;
    native.readAudio = async () => {
      reads += 1;
      return {
        frames: [nativeFrame('1'), nativeFrame('2')],
        sessionState: 'running',
      };
    };
    const stream = AudioStream._create(native);

    await expect(stream.read()).resolves.toMatchObject({ sequenceNumber: 1n });
    await expect(stream.read()).resolves.toMatchObject({ sequenceNumber: 2n });
    expect(reads).toBe(1);
    expect(stream.readerMode).toBe('read');
  });

  it('Given an iterator ends early When reading resumes Then mode stays permanent', async () => {
    const stream = AudioStream._create(
      nativeReader([
        { frames: [nativeFrame('1')], sessionState: 'running' },
        { frames: [nativeFrame('2')], sessionState: 'running' },
      ]),
    );
    const iterator = stream.frames();

    await expect(iterator.next()).resolves.toMatchObject({
      value: { sequenceNumber: 1n, nodeReadResolvedAtNs: 13n },
    });
    await iterator.return(undefined);

    await expect(stream.read()).rejects.toMatchObject({
      code: 'stream.mode_conflict',
      activeMode: 'frames',
      requestedMode: 'read',
    });
    await expect(stream.read()).rejects.toBeInstanceOf(StreamModeError);
    await expect(stream.frames().next()).resolves.toMatchObject({
      value: { sequenceNumber: 2n },
    });
  });

  it('Given one native batch When batch APIs read Then frame order and EOF stay explicit', async () => {
    const stream = AudioStream._create(
      nativeReader([
        {
          frames: [nativeFrame('1'), nativeFrame('2')],
          sessionState: 'stopped',
        },
      ]),
    );

    const result = await stream.readResult();

    expect(result).toBeInstanceOf(AudioBatch);
    const batch = result as AudioBatch;
    expect(batch.length).toBe(2);
    expect(batch.at(-1)?.sequenceNumber).toBe(2n);
    expect([...batch].map((frame) => frame.sequenceNumber)).toEqual([1n, 2n]);
    expect(batch.frames()).not.toBe(batch.frames());
    expect(stream.readerMode).toBe('batches');
    expect(stream.isClosed).toBe(true);
    await expect(stream.poll()).resolves.toBe(END_OF_STREAM);
  });

  it('Given frame metadata When read Then PCM bytes and clock authority match Core', async () => {
    const stream = AudioStream._create(
      nativeReader([{ frames: [nativeFrame('1')], sessionState: 'stopped' }]),
    );

    const result = await stream.read();

    expect(result).toMatchObject({
      sampleCount: 2,
      sampleFormat: 'f32le',
      connectorId: undefined,
      endpointEnqueuedAtNs: 11n,
      polledAtNs: 12n,
      clock: {
        id: 5,
        kind: 'provider-defined',
        origin: 'provider-defined',
        tickRateHz: 1_000_000_000n,
      },
    });
    expect(result).not.toBe(END_OF_STREAM);
    expect(result).toBeDefined();
    if (result !== undefined && result !== END_OF_STREAM) {
      expect(result.samplesF32Le.byteLength).toBe(8);
      expect([...result.samples]).toEqual([0.25, -0.25]);
    }
  });

  it('Given an empty running batch read When polled Then empty differs from EOF', async () => {
    const stream = AudioStream._create(
      nativeReader([
        { frames: [], sessionState: 'running' },
        { frames: [], sessionState: 'stopped' },
      ]),
    );

    await expect(stream.poll()).resolves.toBeUndefined();
    await expect(stream.poll()).resolves.toBe(END_OF_STREAM);
  });

  it('Given copied frames When the Session closes Then pending frames remain readable', async () => {
    const stream = AudioStream._create(
      nativeReader([
        {
          frames: [nativeFrame('1'), nativeFrame('2')],
          sessionState: 'running',
        },
      ]),
    );

    await expect(stream.read()).resolves.toMatchObject({ sequenceNumber: 1n });
    stream._close();
    await expect(stream.read()).resolves.toMatchObject({ sequenceNumber: 2n });
    await expect(stream.read()).resolves.toBe(END_OF_STREAM);
  });

  it('Given terminal frames When iterated Then all final frames are delivered', async () => {
    const stream = AudioStream._create(
      nativeReader([
        {
          frames: [nativeFrame('1'), nativeFrame('2')],
          sessionState: 'stopped',
        },
      ]),
    );
    const sequences: bigint[] = [];

    for await (const frame of stream) {
      sequences.push(frame.sequenceNumber);
    }

    expect(sequences).toEqual([1n, 2n]);
  });

  it('Given the real Core Session When frames are consumed Then two stems and clock lineage survive', async () => {
    const session = Session._conformance();
    const endpoint = session.audio();
    session.capture(Source.application('PocketStation JavaScript Fixture')).send(endpoint);
    session.capture(Source.defaultMicrophone()).send(endpoint);
    const running = await session.start();
    const stream = running.audio;
    const iterator = stream.frames({ timeoutMs: 100 });
    const stems = new Set<bigint>();

    try {
      for (let reads = 0; reads < 20 && stems.size < 2; reads += 1) {
        const result = await iterator.next();
        if (result.done) break;
        const frame = result.value;
        stems.add(frame.stemId);
        expect(frame.clock).toEqual({
          id: frame.clockId,
          kind: 'process-monotonic',
          origin: 'process-start',
          tickRateHz: 1_000_000_000n,
        });
        expect(frame.routeReceivedAtNs).toBeGreaterThanOrEqual(
          frame.routeEnqueuedAtNs,
        );
        expect(frame.endpointEnqueuedAtNs).toBeDefined();
        expect(frame.polledAtNs).toBeDefined();
        expect(frame.sampleCount).toBe(frame.samples.length);
        expect(frame.samplesF32Le.byteLength).toBe(
          frame.sampleCount * Float32Array.BYTES_PER_ELEMENT,
        );
      }
    } finally {
      await iterator.return(undefined);
      await running.stop();
    }

    expect(stems.size).toBe(2);
    expect(stream.readerMode).toBe('frames');
  });

  it('Given the real Core Session When batches are consumed Then native batching is public', async () => {
    const session = Session._conformance();
    session.capture(Source.defaultMicrophone()).send(session.audio());
    const running = await session.start();

    const batch = await running.audio.readResult({ timeoutMs: 1_000 });
    await running.stop();

    expect(batch).toBeInstanceOf(AudioBatch);
    expect(batch).not.toBe(END_OF_STREAM);
    expect((batch as AudioBatch).length).toBeGreaterThan(0);
    expect(running.audio.readerMode).toBe('batches');
  });
});

function nativeFrame(sequenceNumber: string): NativeAudioRead['frames'][number] {
  const samples = new Float32Array([0.25, -0.25]);
  return {
    samplesF32Le: new Uint8Array(samples.buffer),
    sampleCount: 2,
    sampleRateHz: 48_000,
    channelCount: 1,
    sessionId: '1',
    streamId: '2',
    sourceId: '3',
    stemId: '4',
    clockId: 5,
    clockKind: 'provider-defined',
    clockOrigin: 'provider-defined',
    clockTickRateHz: '1000000000',
    sequenceNumber,
    timestampStartNs: '6',
    durationNs: '10000000',
    sourceGeneration: 1,
    discontinuityEpoch: '0',
    permissionEpoch: '0',
    endpointId: '7',
    connectorId: '0',
    routeId: '8',
    routeEnqueuedAtNs: '9',
    routeReceivedAtNs: '10',
    endpointEnqueuedAtNs: '11',
    polledAtNs: '12',
    nativeReadResolvedAtNs: '13',
  };
}
