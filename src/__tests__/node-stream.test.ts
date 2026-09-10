import {
  AudioStream,
  END_OF_STREAM,
  PocketStationError,
  StreamAbortError,
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
    expect((failure as PocketStationError).code).toBe('stream.in_use');
    release?.();
    await first;
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

  it('Given a direct read in progress When iteration starts Then it fails clearly', async () => {
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
      code: 'stream.in_use',
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

  it('Given an iterator ends early When another reader starts Then ownership is released', async () => {
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

    await expect(stream.read()).resolves.toMatchObject({ sequenceNumber: 2n });
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
