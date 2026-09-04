import { AudioStream, PocketStationError } from '../node/index.js';
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
};

function nativeReader(reads: NativeAudioRead[]): NativeRunningSessionHandle {
  return {
    sessionId: '1',
    readAudio: async () =>
      reads.shift() ?? { frames: [], sessionState: 'stopped' },
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
    ).rejects.toThrow('cancelled');
    expect(reads).toBe(0);
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

    await expect(read).rejects.toThrow('cancelled');
    await expect(stream.read()).resolves.toMatchObject({ sequenceNumber: 7n });
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
  };
}
