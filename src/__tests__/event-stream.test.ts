import {
  EventStream,
  PocketStationError,
  SessionEventType,
  SessionLifecycleState,
} from '../node/index.js';
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
  metricsUnavailableReason: 'fixture does not provide final metrics',
  remainingEvents: [],
};

function nativeReader(reads: NativeEventRead[]): NativeRunningSessionHandle {
  return {
    sessionId: '1',
    readAudio: async () => ({ frames: [], sessionState: 'running' }),
    monotonicTimestampNs: () => '0',
    readEvent: async () => reads.shift() ?? { sessionState: 'stopped' },
    stop: async () => STOP_RESULT,
    cancel: async () => STOP_RESULT,
  };
}

describe('Session event stream', () => {
  it('exports the native lifecycle and event values', () => {
    expect(SessionEventType.SOURCE_FAILURE).toBe('source-failure');
    expect(SessionLifecycleState.RUNNING).toBe('running');
  });

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

    await expect(stream.poll()).resolves.toMatchObject({
      type: 'lifecycle',
      sessionId: 1n,
      state: 'running',
      lifecycleState: 'running',
      failures: [],
      failuresTotal: 0n,
    });
    expect(stream.readerMode).toBe('event_read');
    const sourceFailure = await stream.read();
    expect(sourceFailure).toMatchObject({
      type: 'source-failure',
      sessionId: 1n,
      stemId: 2n,
      failuresTotal: 1n,
      failure: {
        kind: 'source-unavailable',
        stemId: 2n,
        stableId: {
          platform: 'windows',
          kind: 'application',
          stableKey: 'wasapi:fixture',
          sourceId: 3n,
        },
        generation: 1,
        recoveryRequirement: 'explicit-rediscovery-and-new-session',
        operation: 'capture',
        failureClass: 'source-instance-exited',
        platformStatusCode: undefined,
        backendClass: undefined,
      },
    });
    expect(sourceFailure?.failures[0]).toMatchObject({
      kind: 'source',
      operation: 'capture',
      errorClass: 'source-instance-exited',
      stemId: 2n,
    });
    expect(Object.isFrozen(sourceFailure)).toBe(true);
    expect(
      sourceFailure?.type === 'source-failure' && Object.isFrozen(sourceFailure.failure),
    ).toBe(true);
  });

  it('supports application-owned poll, bounded wait, and closed callbacks', async () => {
    const events = [
      Object.freeze({
        type: 'lifecycle' as const,
        sessionId: 7n,
        state: 'running' as const,
        lifecycleState: 'running' as const,
        failures: Object.freeze([]),
        failuresTotal: 0n,
      }),
    ];
    const waits: number[] = [];
    let closed = false;
    const stream = new EventStream({
      pollEvent: () => events.shift(),
      waitEvent: async (timeoutMs) => {
        waits.push(timeoutMs);
        closed = true;
        return undefined;
      },
      isClosed: () => closed,
    });

    await expect(stream.poll()).resolves.toMatchObject({
      type: 'lifecycle',
      sessionId: 7n,
      state: 'running',
    });
    await expect(stream.read({ timeoutMs: 37 })).resolves.toBeUndefined();
    expect(waits).toEqual([37]);
    expect(stream.closed).toBe(true);
  });

  it('validates application-owned callbacks before any read starts', () => {
    expect(
      () => new EventStream({
        pollEvent: undefined as never,
        waitEvent: async () => undefined,
        isClosed: () => false,
      }),
    ).toThrow('pollEvent must be a function');
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

  it('preserves an event accepted while its read is aborted', async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new AbortController();
    const event = Object.freeze({
      type: 'lifecycle' as const,
      sessionId: 7n,
      state: 'running' as const,
      lifecycleState: 'running' as const,
      failures: Object.freeze([]),
      failuresTotal: 0n,
    });
    const stream = new EventStream({
      pollEvent: () => undefined,
      waitEvent: async () => {
        await wait;
        return event;
      },
      isClosed: () => false,
    });
    const read = stream.read({ signal: controller.signal });
    controller.abort(new Error('cancelled'));
    release?.();

    await expect(read).rejects.toThrow('cancelled');
    await expect(stream.read()).resolves.toBe(event);
  });

  it('delivers events retained during native shutdown before closing', async () => {
    const stream = EventStream._create(nativeReader([]));
    stream._finish([
      {
        eventType: 'terminal',
        sessionId: '1',
        sessionState: 'stopped',
        sourceFailuresTotal: '0',
        endpointFailuresTotal: '1',
        rollbackFailuresTotal: '0',
        finalizationFailuresTotal: '0',
        sourceFailures: [],
        endpointFailures: [
          {
            routeId: '3',
            endpointId: '4',
            failureStage: 'request-stop',
            failureMessage: 'provider did not stop',
            failureCode: 'provider.timeout',
            failureRetryability: 'retryable',
          },
        ],
        rollbackFailures: [],
        finalizationFailures: [],
      },
    ]);

    await expect(stream.read()).resolves.toMatchObject({
      type: 'terminal',
      state: 'stopped',
      terminalState: 'stopped',
      failuresTotal: 1n,
      sourceFailures: [],
      endpointFailures: [
        expect.objectContaining({
          routeId: 3n,
          endpointId: 4n,
          stage: 'request-stop',
          code: 'provider.timeout',
        }),
      ],
    });
    await expect(stream.read()).resolves.toBeUndefined();
    expect(stream.closed).toBe(true);
    expect(stream.isClosed).toBe(true);
  });
});
