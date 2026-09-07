import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

import { Session, SessionTrace, Source } from '../node/index.js';
import type {
  NativeEventQueueMetrics,
  NativeLatencyHistogram,
  NativePolledAudioMetrics,
  NativeRouteDeliveryMetrics,
  NativeSessionMetrics,
} from '../node/native.js';
import { _sessionMetricsFromNative } from '../node/observations.js';

const ZERO_LATENCY: NativeLatencyHistogram = {
  samplesTotal: '0',
  invalidOrderTotal: '0',
  missingTotal: '0',
  futureTotal: '0',
  p50Ns: '0',
  p95Ns: '0',
  p99Ns: '0',
  maxNs: '0',
};

const ZERO_DELIVERY: NativeRouteDeliveryMetrics = {
  queueCapacityFrames: '8',
  queueDepthFrames: '0',
  queuePeakFrames: '1',
  framesEnqueuedTotal: '1',
  framesDeliveredTotal: '1',
  framesDroppedTotal: '0',
  overrunsTotal: '0',
  receiverUnavailableDropsTotal: '0',
  queueFullDropsTotal: '0',
  sharedReferenceExhaustedDropsTotal: '0',
  branchPoolExhaustedDropsTotal: '0',
  invalidCopyPolicyDropsTotal: '0',
  freezeFailedDropsTotal: '0',
  discontinuitiesTotal: '0',
  sourceIdentityDiscontinuitiesTotal: '0',
  sequenceDiscontinuitiesTotal: '0',
  timestampDiscontinuitiesTotal: '0',
  lineageEpochDiscontinuitiesTotal: '0',
  manuallyReportedDiscontinuitiesTotal: '0',
  enqueueToReceive: ZERO_LATENCY,
  sourceTimestampToReceive: ZERO_LATENCY,
  workerFailuresTotal: '0',
  shutdownDiscardedTotal: '0',
};

function eventQueue(): NativeEventQueueMetrics {
  return {
    capacityCount: '16',
    maximumEventOwnedBytes: '4096',
    maximumBufferedOwnedBytes: '65536',
    depthCount: '0',
    depthOwnedBytes: '0',
    peakDepthCount: '0',
    peakDepthOwnedBytes: '0',
    enqueuedTotal: '0',
    droppedTotal: '0',
    droppedOversizedTotal: '0',
    receiverClosedTotal: '0',
  };
}

function polledAudio(registeredEndpoints: string): NativePolledAudioMetrics {
  return {
    registeredEndpoints,
    queueCapacityFrames: '8',
    queueDepthFrames: '0',
    queuePeakFrames: '0',
    queueDepthInvariantFailuresTotal: '0',
    framesReceivedTotal: '0',
    framesDeliveredTotal: '0',
    queueFullDropsTotal: '0',
    invalidOwnershipDropsTotal: '0',
    discardedOutputFramesTotal: '0',
    leaseCapacityCount: '8',
    outstandingLeases: '0',
    leaseExhaustedTotal: '0',
    batchesPolledTotal: '0',
    framesPolledTotal: '0',
  };
}

function fixture(counter = '0'): NativeSessionMetrics {
  return {
    eventQueue: eventQueue(),
    polledAudio: polledAudio(counter),
    sources: [],
    externalSources: [],
    routes: [
      {
        routeId: '1',
        endpointId: '2',
        delivery: ZERO_DELIVERY,
        endpoint: {
          observationStage: 'live',
          framesReceivedTotal: '1',
          framesDeliveredTotal: '1',
          framesDroppedTotal: '0',
          discontinuitiesTotal: '0',
          failuresTotal: '0',
          finalizationFailuresTotal: '0',
        },
        framesAttemptedTotal: '1',
        observationInterval: 'route-lifetime-to-snapshot',
        dropRatePct: 0,
        sourceLatencyMeasurement: 'source-monotonic-timestamp-to-route-receive',
        sourceLatencyUnit: 'nanoseconds',
      },
    ],
    operators: [],
    derivedRoutes: [],
    audioReentries: [],
    sourceCount: '0',
    externalSourceCount: '0',
    routeCount: '1',
    operatorCount: '0',
    derivedRouteCount: '0',
    audioReentryCount: '0',
  };
}

describe('Session observations', () => {
  it('reads immutable native metrics while a Session is running and after stop', async () => {
    const session = Session._conformance();
    session.capture(Source.defaultMicrophone()).send(session.audio());
    const running = await session.start();

    const live = await running.metrics();
    const stopped = await running.stop();

    expect(live.routes).toHaveLength(1);
    expect(live.routes[0]?.routeId).toBe(1n);
    expect(live.routes[0]?.delivery.queueCapacityFrames).toBeGreaterThan(0n);
    expect(live.routes[0]?.sourceLatencyUnit).toBe('nanoseconds');
    expect(Object.isFrozen(live)).toBe(true);
    expect(Object.isFrozen(live.routes)).toBe(true);
    expect(Object.isFrozen(live.routes[0])).toBe(true);
    expect(stopped.metrics).toBeDefined();
    expect(stopped.metricsUnavailableReason).toBeUndefined();
    expect(stopped.metrics?.routes[0]?.endpoint.observationStage).toBe('finalized');
    expect(stopped.terminalEvent?.type).toBe('terminal');
    expect(stopped.terminalEvent?.sourceFailures).toEqual([]);
    expect(Object.isFrozen(stopped)).toBe(true);
  });

  it('preserves counters beyond the safe integer range', () => {
    const metrics = _sessionMetricsFromNative(fixture('9007199254740993'));

    expect(metrics.polledAudio.registeredEndpoints).toBe(9007199254740993n);
    expect(typeof metrics.routes[0]?.delivery.framesDeliveredTotal).toBe('bigint');
    expect(metrics.routes[0]?.delivery.discardedOutputFramesTotal).toBeUndefined();
  });

  it('rejects native observation states this SDK does not understand', () => {
    const value = fixture();
    value.routes[0]!.endpoint.observationStage = 'future-stage';

    expect(() => _sessionMetricsFromNative(value)).toThrow(
      'unknown Endpoint observation stage',
    );
  });

  it('rejects an inconsistent native snapshot', () => {
    expect(() =>
      _sessionMetricsFromNative({ ...fixture(), routeCount: '2' }),
    ).toThrow('metrics counts are inconsistent');
  });

  it('returns recording and trace artifacts after finalization', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pocketstation-js-observations-'));
    const tracePath = join(directory, 'session.pkstrace');
    try {
      const session = new Session({
        recordingRoot: directory,
        trace: { path: tracePath, capacityRecords: 64 },
      });
      const input = session.audioInput('application');
      input.output.record('application');
      const running = await session.start();
      await input.write(new Float32Array(480));
      await wait(25);
      input.close();

      const result = await running.stop();

      expect(result.recording?.state).toBe('complete');
      expect(result.recording?.stems).toHaveLength(1);
      expect(result.recording?.manifestSchemaVersion).toBeGreaterThan(0);
      expect(result.trace?.path).toBe(tracePath);
      expect(result.trace?.complete).toBe(true);
      expect(result.trace?.recordsWrittenTotal).toBeGreaterThan(0n);
      expect(result.traceError).toBeUndefined();
      const trace = SessionTrace.read(tracePath);
      const validation = trace.validate();
      expect(trace.records()).toHaveLength(Number(trace.recordsTotal));
      expect(validation.sessionId).toBe(result.recording?.sessionId);
      expect(validation.terminalState).toBe('stopped');
      expect(validation.recordsValidatedTotal).toBe(trace.recordsTotal);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects unsafe trace queue settings before native work starts', () => {
    expect(() => new Session({ trace: { path: 'trace', capacityRecords: 0 } })).toThrow(
      'trace.capacityRecords',
    );
    expect(() => new Session({ trace: { path: ' ' } })).toThrow('trace.path');
  });
});
