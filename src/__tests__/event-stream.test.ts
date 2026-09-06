import { EventStream, PocketStationError } from '../node/index.js';
import type {
  NativeEventRead,
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

function nativeReader(reads: NativeEventRead[]): NativeRunningSessionHandle {
  return {
    sessionId: '1',
    readAudio: async () => ({ frames: [], sessionState: 'running' }),
    readEvent: async () => reads.shift() ?? { sessionState: 'stopped' },
    stop: async () => STOP_RESULT,
    cancel: async () => STOP_RESULT,
  };
}

describe('Session event stream', () => {
  it('projects lifecycle and source failures without losing identity', async () => {
    const stream = EventStream._create(
      nativeReader([
        {
          sessionState: 'running',
          event: {
            eventType: 'lifecycle',
            sessionId: '1',
            sessionState: 'running',
          },
        },
        {
          sessionState: 'running',
          event: {
            eventType: 'source-failure',
            sessionId: '1',
            sourceEventKind: 'source-unavailable',
            stemId: '2',
            sourcePlatform: 'windows',
            sourceKind: 'application',
            sourceStableKey: 'wasapi:fixture',
            sourceId: '3',
            sourceGeneration: 1,
            sourceRecoveryRequirement: 'explicit-rediscovery-and-new-session',
            sourceFailureOperation: 'capture',
            sourceFailureClass: 'source-instance-exited',
          },
        },
      ]),
    );

    await expect(stream.read()).resolves.toEqual({
      type: 'lifecycle',
      sessionId: 1n,
      state: 'running',
    });
    await expect(stream.read()).resolves.toMatchObject({
      type: 'source-failure',
      failure: {
        stemId: 2n,
        stableId: {
          platform: 'windows',
          kind: 'application',
          stableKey: 'wasapi:fixture',
          sourceId: 3n,
        },
      },
    });
  });

  it('rejects concurrent event readers', async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const native = nativeReader([]);
    native.readEvent = async () => {
      await wait;
      return { sessionState: 'stopped' };
    };
    const stream = EventStream._create(native);
    const first = stream.read();

    let failure: unknown;
    try {
      await stream.read();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(PocketStationError);
    expect((failure as PocketStationError).code).toBe('stream.in_use');
    release?.();
    await first;
  });

  it('stops before native work when already aborted', async () => {
    let reads = 0;
    const native = nativeReader([]);
    native.readEvent = async () => {
      reads += 1;
      return { sessionState: 'running' };
    };
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(
      EventStream._create(native).read({ signal: controller.signal }),
    ).rejects.toThrow('cancelled');
    expect(reads).toBe(0);
  });

  it('delivers events retained during native shutdown before closing', async () => {
    const stream = EventStream._create(nativeReader([]));
    stream._finish([
      {
        eventType: 'terminal',
        sessionId: '1',
        sessionState: 'stopped',
        sourceFailuresTotal: '0',
        endpointFailuresTotal: '0',
        rollbackFailuresTotal: '0',
        finalizationFailuresTotal: '0',
      },
    ]);

    await expect(stream.read()).resolves.toMatchObject({
      type: 'terminal',
      state: 'stopped',
    });
    await expect(stream.read()).resolves.toBeUndefined();
    expect(stream.closed).toBe(true);
  });
});
