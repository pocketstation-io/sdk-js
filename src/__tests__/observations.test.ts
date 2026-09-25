import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

import {
  EndpointObservationStage,
  evaluateSourceActivity,
  evaluateSourceSignal,
  RecordingDiscontinuityKind,
  RecordingState,
  RouteLatencyMeasurement,
  RouteLatencyUnit,
  RouteObservationInterval,
  SampleRepresentation,
  Session,
  SessionTrace,
  SessionTraceConfiguration,
  SessionTraceRecordType,
  Source,
  TerminationDisposition,
} from '../node/index.js';
import type { SourceActivityObservation, SourceSignalObservation } from '../node/index.js';
import type {
  NativeEventQueueMetrics,
  NativeLatencyHistogram,
  NativePolledAudioMetrics,
  NativeRouteDeliveryMetrics,
  NativeSessionMetrics,
} from '../node/native.js';
import { _captureNativeFormatFromNative, _sessionMetricsFromNative } from '../node/observations.js';

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
    sourceNativeFormats: [],
    sourceActivity: [],
    sourceSignal: [],
    sourceReplacements: [],
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
  it('exports exact native observation values and finite trace configuration', () => {
    expect(EndpointObservationStage.FINALIZED).toBe('finalized');
    expect(RecordingState.INCOMPLETE).toBe('incomplete');
    expect(RecordingDiscontinuityKind.SEQUENCE_GAP).toBe('sequence-gap');
    expect(RouteObservationInterval.ROUTE_LIFETIME_TO_SNAPSHOT).toBe(
      'route-lifetime-to-snapshot',
    );
    expect(RouteLatencyMeasurement.SOURCE_TIMESTAMP_TO_ROUTE_RECEIVE).toBe(
      'source-monotonic-timestamp-to-route-receive',
    );
    expect(RouteLatencyUnit.NANOSECONDS).toBe('nanoseconds');
    expect(SessionTraceRecordType.FINALIZATION_FAILURE).toBe(
      'finalization-failure',
    );
    expect(TerminationDisposition.ALREADY_STOPPED).toBe('already-stopped');
    expect(new SessionTraceConfiguration('/tmp/session.pkst').capacityRecords).toBe(256);
    for (const path of ['', ' ', '\t']) {
      expect(() => new SessionTraceConfiguration(path)).toThrow(
        'trace path cannot be empty',
      );
      expect(() => SessionTrace.read(path)).toThrow('trace path cannot be empty');
    }
    for (const capacity of [0, -1, 1.5, 1_000_001, true]) {
      expect(() => new SessionTraceConfiguration(
        '/tmp/session.pkst',
        capacity as number,
      )).toThrow('between 1 and 1000000');
    }
  });

  it('reads immutable native metrics while a Session is running and after stop', async () => {
    const session = Session._conformance();
    const stem = session.capture(Source.defaultMicrophone());
    stem.send(session.audio());
    const running = await session.start();

    await wait(30);

    const live = await running.metrics();
    await expect(running.replaceMicrophoneSource(stem, Source.systemAudio())).rejects.toThrow('Replacement Source must select a microphone');
    const foreignStem = new Session().capture(Source.microphoneDefault());
    await expect(running.reopenMicrophoneSource(foreignStem, Source.microphoneDefault())).rejects.toThrow('Stem belongs to a different Session');
    const replacement = await running.replaceMicrophoneSource(stem, Source.microphoneId('fixture-microphone'));
    const reopened = await running.reopenMicrophoneSource(stem, Source.microphoneDefault());
    const changed = await running.metrics();
    const stopped = await running.stop();

    expect(live.routes).toHaveLength(1);
    expect(live.routes[0]?.routeId).toBe(1n);
    expect(live.routes[0]?.delivery.queueCapacityFrames).toBeGreaterThan(0n);
    expect(live.routes[0]?.sourceLatencyUnit).toBe('nanoseconds');
    expect(Object.isFrozen(live)).toBe(true);
    expect(Object.isFrozen(live.routes)).toBe(true);
    expect(Object.isFrozen(live.routes[0])).toBe(true);
    expect(live.sourceNativeFormats).toEqual([{
      stemId: stem.id,
      openedNativeFormat: {
        sampleRateHz: 48_000,
        channelCount: 1,
        sampleRepresentation: 'float-32',
      },
    }]);
    expect(live.sourceActivities[0]?.framesReceivedTotal).toBeGreaterThan(0n);
    expect(live.sourceSignals[0]?.windowSamplesTotal).toBeGreaterThan(0n);
    expect(live.sourceSignals[0]?.windowPeakLinear).toBeCloseTo(0.5);
    expect(replacement.stemId).toBe(stem.id);
    expect(replacement.requestedSelectorKind).toBe('microphone-id');
    expect(replacement.requestedDeviceId).toBe('fixture-microphone');
    expect(replacement.sourceGeneration).toBeGreaterThan(0);
    expect(reopened.requestedSelectorKind).toBe('microphone-default');
    expect(reopened.sourceGeneration).toBeGreaterThan(replacement.sourceGeneration);
    expect(changed.sourceReplacements[0]?.completedTotal).toBe(2n);
    expect(changed.sourceReplacements[0]?.attachedSourceId).toBe(reopened.sourceId);
    expect(stopped.metrics).toBeDefined();
    expect(stopped.metricsUnavailableReason).toBeUndefined();
    expect(stopped.metrics?.routes[0]?.endpoint.observationStage).toBe('finalized');
    expect(stopped.terminalEvent?.type).toBe('terminal');
    expect(stopped.terminalEvent?.sourceFailures).toEqual([]);
    expect(Object.isFrozen(stopped)).toBe(true);
  });

  it('evaluates activity and signal using only caller-supplied thresholds', () => {
    const activity: SourceActivityObservation = {
      sessionStartedAtNs: 100n, observedAtNs: 200n,
      framesReceivedTotal: 0n,
    };
    expect(evaluateSourceActivity(activity, { firstFrameTimeoutNs: 101n, stallTimeoutNs: 20n }).state).toBe('awaiting-first-frame');
    expect(evaluateSourceActivity(activity, { firstFrameTimeoutNs: 100n, stallTimeoutNs: 20n }).state).toBe('first-frame-timed-out');
    expect(evaluateSourceActivity({ ...activity, latestFrameReceivedAtNs: 181n }, { firstFrameTimeoutNs: 100n, stallTimeoutNs: 20n }).state).toBe('active');
    expect(evaluateSourceActivity({ ...activity, latestFrameReceivedAtNs: 180n }, { firstFrameTimeoutNs: 100n, stallTimeoutNs: 20n }).state).toBe('stalled');
    expect(() => evaluateSourceActivity(activity, { firstFrameTimeoutNs: 0n, stallTimeoutNs: 20n })).toThrow(RangeError);

    const signal: SourceSignalObservation = {
      observedAtNs: 200n, samplesObservedTotal: 0n, exactZeroSamplesObservedTotal: 0n,
      nonzeroSamplesObservedTotal: 0n, nonfiniteSamplesObservedTotal: 0n,
      windowDurationNs: 0n, windowSourceGeneration: 0, windowDiscontinuityEpoch: 0n,
      windowSamplesTotal: 0n, windowExactZeroSamplesTotal: 0n, windowNonzeroSamplesTotal: 0n,
      windowNonfiniteSamplesTotal: 0n, consecutiveExactZeroDurationNs: 0n,
    };
    const policy = { minimumPeakDbfs: -40, minimumRmsDbfs: -50, exactZeroTimeoutNs: 40n };
    expect(evaluateSourceSignal(signal, policy).state).toBe('no-samples-observed');
    expect(evaluateSourceSignal({ ...signal, windowSamplesTotal: 2n, windowExactZeroSamplesTotal: 2n, consecutiveExactZeroDurationNs: 39n }, policy).state).toBe('exact-digital-zero-pending');
    expect(evaluateSourceSignal({ ...signal, windowSamplesTotal: 2n, windowExactZeroSamplesTotal: 2n, consecutiveExactZeroDurationNs: 40n }, policy).state).toBe('sustained-exact-digital-zero');
    expect(evaluateSourceSignal({ ...signal, windowSamplesTotal: 2n, windowNonzeroSamplesTotal: 2n, windowPeakDbfs: -30, windowRmsDbfs: -40 }, policy).state).toBe('meets-caller-thresholds');
    expect(evaluateSourceSignal({ ...signal, windowSamplesTotal: 2n, windowNonzeroSamplesTotal: 2n, windowPeakDbfs: -60, windowRmsDbfs: -70 }, policy).state).toBe('below-caller-thresholds');
    expect(evaluateSourceSignal({ ...signal, windowSamplesTotal: 2n, windowNonfiniteSamplesTotal: 1n }, policy).state).toBe('nonfinite-samples-observed');
    expect(() => evaluateSourceSignal(signal, { ...policy, minimumPeakDbfs: Number.NaN })).toThrow(RangeError);
  });

  it('rejects every out-of-range source-activity policy value', () => {
    const observation: SourceActivityObservation = {
      sessionStartedAtNs: 100n,
      observedAtNs: 200n,
      framesReceivedTotal: 0n,
    };
    const maximum = 18_446_744_073_709_551_615n;
    expect(() => evaluateSourceActivity(observation, {
      firstFrameTimeoutNs: maximum,
      stallTimeoutNs: maximum,
    })).not.toThrow();
    for (const invalid of [0n, maximum + 1n, true, 1]) {
      expect(() => evaluateSourceActivity(observation, {
        firstFrameTimeoutNs: invalid as bigint,
        stallTimeoutNs: 1n,
      })).toThrow(RangeError);
      expect(() => evaluateSourceActivity(observation, {
        firstFrameTimeoutNs: 1n,
        stallTimeoutNs: invalid as bigint,
      })).toThrow(RangeError);
    }
  });

  it('rejects every out-of-range source-signal policy value', () => {
    const observation: SourceSignalObservation = {
      observedAtNs: 200n,
      samplesObservedTotal: 2n,
      exactZeroSamplesObservedTotal: 2n,
      nonzeroSamplesObservedTotal: 0n,
      nonfiniteSamplesObservedTotal: 0n,
      windowDurationNs: 40n,
      windowSourceGeneration: 0,
      windowDiscontinuityEpoch: 0n,
      windowSamplesTotal: 2n,
      windowExactZeroSamplesTotal: 2n,
      windowNonzeroSamplesTotal: 0n,
      windowNonfiniteSamplesTotal: 0n,
      consecutiveExactZeroDurationNs: 40n,
    };
    const base = {
      minimumPeakDbfs: -40,
      minimumRmsDbfs: -50,
      exactZeroTimeoutNs: 40n,
    };
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, 0.1]) {
      expect(() => evaluateSourceSignal(observation, {
        ...base,
        minimumPeakDbfs: invalid,
      })).toThrow(RangeError);
      expect(() => evaluateSourceSignal(observation, {
        ...base,
        minimumRmsDbfs: invalid,
      })).toThrow(RangeError);
    }
    for (const invalid of [0n, 18_446_744_073_709_551_616n, false, 1]) {
      expect(() => evaluateSourceSignal(observation, {
        ...base,
        exactZeroTimeoutNs: invalid as bigint,
      })).toThrow(RangeError);
    }
  });

  it('preserves all Core native PCM representations and rejects unknown ones', () => {
    for (const sampleRepresentation of Object.values(SampleRepresentation)) {
      expect(_captureNativeFormatFromNative({ sampleRateHz: 48_000, channelCount: 2, sampleRepresentation }).sampleRepresentation).toBe(sampleRepresentation);
    }
    expect(() => _captureNativeFormatFromNative({ sampleRateHz: 48_000, channelCount: 2, sampleRepresentation: 'future-format' })).toThrow('unknown native PCM sample representation');
  });

  it('rejects microphone replacement and reopen after stop or cancel', async () => {
    for (const disposition of ['stop', 'cancel'] as const) {
      const session = Session._conformance();
      const stem = session.capture(Source.microphoneDefault());
      stem.send(session.audio());
      const running = await session.start();
      await running[disposition]();
      await expect(
        running.replaceMicrophoneSource(stem, Source.microphoneDefault()),
      ).rejects.toMatchObject({ code: 'source.session_not_running' });
      await expect(
        running.reopenMicrophoneSource(stem, Source.microphoneDefault()),
      ).rejects.toMatchObject({ code: 'source.session_not_running' });
    }
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
    expect(() =>
      _sessionMetricsFromNative({ ...fixture(), sourceActivity: [{
        sessionStartedAtNs: '0', observedAtNs: '0', framesReceivedTotal: '0',
      }] }),
    ).toThrow('source observation counts are inconsistent');
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
      await input.write(new Float32Array(960));
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
