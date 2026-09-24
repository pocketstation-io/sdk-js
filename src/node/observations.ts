import type {
  NativeAudioReentryMetrics,
  NativeDerivedRouteMetrics,
  NativeEndpointMetrics,
  NativeEventQueueMetrics,
  NativeExternalSourceMetrics,
  NativeLatencyHistogram,
  NativeOperatorMetrics,
  NativeOperatorWorkerMetrics,
  NativePolledAudioMetrics,
  NativeRouteDeliveryMetrics,
  NativeRouteMetrics,
  NativeRecordingOutcome,
  NativeRecordingStemOutcome,
  NativeSessionMetrics,
  NativeCaptureFormat,
  NativeSourceNativeFormatObservation,
  NativeSourceActivityObservations,
  NativeSourceSignalObservations,
  NativeSourceReplacementObservations,
  NativeSessionTraceHandle,
  NativeSessionTraceRecord,
  NativeSessionTraceValidation,
  NativeSignalQueueMetrics,
  NativeSourceMetrics,
  NativeTraceRecorderOutcome,
} from './native.js';
import { nativeAddon } from './native.js';
import { nativeCallSync, PocketStationError } from './errors.js';
import { SourceId, StemId } from './identity.js';
import type {
  EndpointFailureStage,
  FinalizationFailureStage,
  RollbackFailureStage,
  SessionState,
} from './events.js';

/** Current state and delivery totals for one finite event queue. */
export interface EventQueueMetrics {
  readonly capacityCount: bigint;
  readonly maximumEventOwnedBytes: bigint;
  readonly maximumBufferedOwnedBytes: bigint;
  readonly depthCount: bigint;
  readonly depthOwnedBytes: bigint;
  readonly peakDepthCount: bigint;
  readonly peakDepthOwnedBytes: bigint;
  readonly enqueuedTotal: bigint;
  readonly droppedTotal: bigint;
  readonly droppedOversizedTotal: bigint;
  readonly receiverClosedTotal: bigint;
}

/** Current state of the Session Endpoint read by `running.audio`. */
export interface PolledAudioMetrics {
  readonly registeredEndpoints: bigint;
  readonly queueCapacityFrames: bigint;
  readonly queueDepthFrames: bigint;
  readonly queuePeakFrames: bigint;
  readonly queueDepthInvariantFailuresTotal: bigint;
  readonly framesReceivedTotal: bigint;
  readonly framesDeliveredTotal: bigint;
  readonly queueFullDropsTotal: bigint;
  readonly invalidOwnershipDropsTotal: bigint;
  readonly discardedOutputFramesTotal: bigint;
  readonly leaseCapacityCount: bigint;
  readonly outstandingLeases: bigint;
  readonly leaseExhaustedTotal: bigint;
  readonly batchesPolledTotal: bigint;
  readonly framesPolledTotal: bigint;
}

/** Distribution of one explicitly named latency measurement, in nanoseconds. */
export interface LatencyHistogram {
  readonly samplesTotal: bigint;
  readonly invalidOrderTotal: bigint;
  readonly missingTotal: bigint;
  readonly futureTotal: bigint;
  readonly p50Ns: bigint;
  readonly p95Ns: bigint;
  readonly p99Ns: bigint;
  readonly maxNs: bigint;
}

/** Queue, delivery, continuity, and timing state for one PCM route. */
export interface RouteDeliveryMetrics {
  readonly queueCapacityFrames: bigint;
  readonly queueDepthFrames: bigint;
  readonly queuePeakFrames: bigint;
  readonly framesEnqueuedTotal: bigint;
  readonly framesDeliveredTotal: bigint;
  readonly framesDroppedTotal: bigint;
  readonly overrunsTotal: bigint;
  readonly receiverUnavailableDropsTotal: bigint;
  readonly queueFullDropsTotal: bigint;
  readonly sharedReferenceExhaustedDropsTotal: bigint;
  readonly branchPoolExhaustedDropsTotal: bigint;
  readonly invalidCopyPolicyDropsTotal: bigint;
  readonly freezeFailedDropsTotal: bigint;
  readonly discontinuitiesTotal: bigint;
  readonly sourceIdentityDiscontinuitiesTotal: bigint;
  readonly sequenceDiscontinuitiesTotal: bigint;
  readonly timestampDiscontinuitiesTotal: bigint;
  readonly lineageEpochDiscontinuitiesTotal: bigint;
  readonly manuallyReportedDiscontinuitiesTotal: bigint;
  readonly enqueueToReceive: LatencyHistogram;
  readonly sourceTimestampToReceive: LatencyHistogram;
  readonly workerFailuresTotal: bigint;
  readonly shutdownDiscardedTotal: bigint;
  /** Frames removed after selected generated output was cancelled, when observed. */
  readonly discardedOutputFramesTotal?: bigint;
}

/** Availability and delivery totals reported by one Endpoint. */
export interface EndpointMetrics {
  readonly observationStage: 'unavailable' | 'live' | 'finalized';
  readonly framesReceivedTotal: bigint;
  readonly framesDeliveredTotal: bigint;
  readonly framesDroppedTotal: bigint;
  readonly discontinuitiesTotal: bigint;
  readonly failuresTotal: bigint;
  readonly finalizationFailuresTotal: bigint;
}

/** Current state for one Source-to-Endpoint PCM route. */
export interface RouteMetrics {
  readonly routeId: bigint;
  readonly endpointId: bigint;
  readonly delivery: RouteDeliveryMetrics;
  readonly endpoint: EndpointMetrics;
  readonly framesAttemptedTotal: bigint;
  readonly observationInterval: 'route-lifetime-to-snapshot';
  readonly dropRatePct: number;
  readonly sourceLatencyMeasurement: 'source-monotonic-timestamp-to-route-receive';
  readonly sourceLatencyUnit: 'nanoseconds';
}

/** Native capture and Session-ingress state for one built-in Source. */
export interface SourceMetrics {
  readonly stemId: bigint;
  readonly callbackBuffersTotal: bigint;
  readonly captureFramesEnqueuedTotal: bigint;
  readonly capturePoolExhaustedTotal: bigint;
  readonly captureDispatchQueueFullTotal: bigint;
  readonly captureInvalidBufferTotal: bigint;
  readonly captureOversizedBufferTotal: bigint;
  readonly captureStreamErrorsTotal: bigint;
  readonly captureTimestampEpochClampsTotal: bigint;
  readonly frameStreamDeliveredFramesTotal: bigint;
  readonly frameStreamDroppedNewestFramesTotal: bigint;
  readonly framesDiscardedBeforeStartTotal: bigint;
  readonly runtimeEventQueue: EventQueueMetrics;
  readonly ingressQueueCapacityFrames: bigint;
  readonly ingressQueueDepthFrames: bigint;
  readonly ingressQueuePeakFrames: bigint;
  readonly ingressFramesEnqueuedTotal: bigint;
  readonly ingressFramesDeliveredTotal: bigint;
  readonly ingressFramesRejectedFullTotal: bigint;
  readonly ingressFramesRejectedCancelledTotal: bigint;
  readonly ingressFramesDiscardedTotal: bigint;
}

/** Native PCM sample representation opened by a capture backend. */
export const SampleRepresentation = Object.freeze({
  SIGNED_INTEGER_8: 'signed-integer-8',
  SIGNED_INTEGER_16: 'signed-integer-16',
  SIGNED_INTEGER_24: 'signed-integer-24',
  SIGNED_INTEGER_32: 'signed-integer-32',
  SIGNED_INTEGER_64: 'signed-integer-64',
  UNSIGNED_INTEGER_8: 'unsigned-integer-8',
  UNSIGNED_INTEGER_16: 'unsigned-integer-16',
  UNSIGNED_INTEGER_24: 'unsigned-integer-24',
  UNSIGNED_INTEGER_32: 'unsigned-integer-32',
  UNSIGNED_INTEGER_64: 'unsigned-integer-64',
  FLOAT_32: 'float-32',
  FLOAT_64: 'float-64',
} as const);
export type SampleRepresentation =
  (typeof SampleRepresentation)[keyof typeof SampleRepresentation];

/** PCM format negotiated at the capture backend before Session conversion. */
export interface OpenedNativeFormat {
  readonly sampleRateHz: number;
  readonly channelCount: number;
  readonly sampleRepresentation: SampleRepresentation;
}

/** Native format opened for one built-in Source. */
export interface SourceNativeFormatObservation {
  readonly stemId: StemId;
  readonly openedNativeFormat?: OpenedNativeFormat;
}

/** Frame-delivery activity, including digitally silent frames. */
export interface SourceActivityObservation {
  readonly sessionStartedAtNs: bigint;
  readonly observedAtNs: bigint;
  readonly firstFrameReceivedAtNs?: bigint;
  readonly latestFrameReceivedAtNs?: bigint;
  readonly framesReceivedTotal: bigint;
}

/** Caller-owned time bounds for evaluating source activity. */
export interface SourceActivityPolicy {
  readonly firstFrameTimeoutNs: bigint;
  readonly stallTimeoutNs: bigint;
}

export type SourceActivityState =
  | 'awaiting-first-frame'
  | 'active'
  | 'first-frame-timed-out'
  | 'stalled';

export interface SourceActivityEvaluation {
  readonly state: SourceActivityState;
  readonly sessionAgeNs: bigint;
  readonly latestFrameAgeNs?: bigint;
}

/** Off-callback PCM measurements for one source. */
export interface SourceSignalObservation {
  readonly observedAtNs: bigint;
  readonly samplesObservedTotal: bigint;
  readonly exactZeroSamplesObservedTotal: bigint;
  readonly nonzeroSamplesObservedTotal: bigint;
  readonly nonfiniteSamplesObservedTotal: bigint;
  readonly windowTimestampStartNs?: bigint;
  readonly windowDurationNs: bigint;
  readonly windowObservedAtNs?: bigint;
  readonly windowSequenceNumber?: bigint;
  readonly windowSourceGeneration: number;
  readonly windowDiscontinuityEpoch: bigint;
  readonly windowSamplesTotal: bigint;
  readonly windowExactZeroSamplesTotal: bigint;
  readonly windowNonzeroSamplesTotal: bigint;
  readonly windowNonfiniteSamplesTotal: bigint;
  readonly windowPeakLinear?: number;
  readonly windowRmsLinear?: number;
  readonly windowPeakDbfs?: number;
  readonly windowRmsDbfs?: number;
  readonly windowExactZeroRatio?: number;
  readonly consecutiveExactZeroDurationNs: bigint;
}

/** Caller-owned thresholds for evaluating measured PCM. */
export interface SourceSignalPolicy {
  readonly minimumPeakDbfs: number;
  readonly minimumRmsDbfs: number;
  readonly exactZeroTimeoutNs: bigint;
}

export type SourceSignalState =
  | 'no-samples-observed'
  | 'nonfinite-samples-observed'
  | 'exact-digital-zero-pending'
  | 'sustained-exact-digital-zero'
  | 'below-caller-thresholds'
  | 'meets-caller-thresholds';

export interface SourceSignalEvaluation {
  readonly state: SourceSignalState;
  readonly peakDbfs?: number;
  readonly rmsDbfs?: number;
  readonly consecutiveExactZeroDurationNs: bigint;
}

/** Replacement totals and attached source identity for one microphone stem. */
export interface SourceReplacementObservation {
  readonly stemId: StemId;
  readonly attemptsTotal: bigint;
  readonly completedTotal: bigint;
  readonly failedBeforeAttachTotal: bigint;
  readonly responseTimeoutsTotal: bigint;
  readonly attachedSourceId?: SourceId;
  readonly sourceGeneration: number;
  readonly discontinuityEpoch: bigint;
  readonly latestCompletedAtNs?: bigint;
}

/** Evaluate source activity without starting recovery. */
export function evaluateSourceActivity(
  value: SourceActivityObservation,
  policy: SourceActivityPolicy,
): SourceActivityEvaluation {
  requirePositiveNanoseconds(policy.firstFrameTimeoutNs, 'firstFrameTimeoutNs');
  requirePositiveNanoseconds(policy.stallTimeoutNs, 'stallTimeoutNs');
  const sessionAgeNs = saturatingElapsed(value.observedAtNs, value.sessionStartedAtNs);
  if (value.latestFrameReceivedAtNs === undefined) {
    return Object.freeze({
      state:
        sessionAgeNs >= policy.firstFrameTimeoutNs
          ? 'first-frame-timed-out'
          : 'awaiting-first-frame',
      sessionAgeNs,
    }) as SourceActivityEvaluation;
  }
  const latestFrameAgeNs = saturatingElapsed(
    value.observedAtNs,
    value.latestFrameReceivedAtNs,
  );
  return Object.freeze({
    state: latestFrameAgeNs >= policy.stallTimeoutNs ? 'stalled' : 'active',
    sessionAgeNs,
    latestFrameAgeNs,
  }) as SourceActivityEvaluation;
}

/** Evaluate PCM measurements without inferring speech, permission, or routing. */
export function evaluateSourceSignal(
  value: SourceSignalObservation,
  policy: SourceSignalPolicy,
): SourceSignalEvaluation {
  if (!Number.isFinite(policy.minimumPeakDbfs) || policy.minimumPeakDbfs > 0) {
    throw new RangeError('minimumPeakDbfs must be finite and no greater than 0 dBFS');
  }
  if (!Number.isFinite(policy.minimumRmsDbfs) || policy.minimumRmsDbfs > 0) {
    throw new RangeError('minimumRmsDbfs must be finite and no greater than 0 dBFS');
  }
  requirePositiveNanoseconds(policy.exactZeroTimeoutNs, 'exactZeroTimeoutNs');
  let state: SourceSignalState;
  if (value.windowSamplesTotal === 0n) {
    state = 'no-samples-observed';
  } else if (value.windowNonfiniteSamplesTotal > 0n) {
    state = 'nonfinite-samples-observed';
  } else if (value.windowExactZeroSamplesTotal === value.windowSamplesTotal) {
    state =
      value.consecutiveExactZeroDurationNs >= policy.exactZeroTimeoutNs
        ? 'sustained-exact-digital-zero'
        : 'exact-digital-zero-pending';
  } else {
    state =
      (value.windowPeakDbfs ?? Number.NEGATIVE_INFINITY) >= policy.minimumPeakDbfs &&
      (value.windowRmsDbfs ?? Number.NEGATIVE_INFINITY) >= policy.minimumRmsDbfs
        ? 'meets-caller-thresholds'
        : 'below-caller-thresholds';
  }
  return Object.freeze({
    state,
    peakDbfs: value.windowPeakDbfs,
    rmsDbfs: value.windowRmsDbfs,
    consecutiveExactZeroDurationNs: value.consecutiveExactZeroDurationNs,
  });
}

function requirePositiveNanoseconds(value: bigint, name: string): void {
  if (typeof value !== 'bigint' || value <= 0n || value > 18_446_744_073_709_551_615n) {
    throw new RangeError(`${name} must be a nonzero unsigned 64-bit nanosecond value`);
  }
}

function saturatingElapsed(observedAtNs: bigint, earlierAtNs: bigint): bigint {
  return observedAtNs >= earlierAtNs ? observedAtNs - earlierAtNs : 0n;
}

/** Lifecycle and delivery totals for one application-authored Source. */
export interface ExternalSourceMetrics {
  readonly sourceInstanceId: bigint;
  readonly sourceId: bigint;
  readonly emittedTotal: bigint;
  readonly droppedTotal: bigint;
  readonly failureTotal: bigint;
  readonly cancellationTotal: bigint;
  readonly discontinuityTotal: bigint;
  readonly recoveryTotal: bigint;
  readonly policyChangeTotal: bigint;
  readonly ready: boolean;
  readonly joined: boolean;
}

/** Current state of one typed-signal route. */
export interface SignalQueueMetrics {
  readonly capacitySignals: bigint;
  readonly maxPayloadBytes: bigint;
  readonly maximumBufferedPayloadBytes: bigint;
  readonly depthSignals: bigint;
  readonly peakDepthSignals: bigint;
  readonly enqueuedTotal: bigint;
  readonly receivedTotal: bigint;
  readonly droppedTotal: bigint;
}

/** Work completed by one application-authored Operator worker. */
export interface OperatorWorkerMetrics {
  readonly inputAttemptedTotal: bigint;
  readonly inputDroppedTotal: bigint;
  readonly processedTotal: bigint;
  readonly outputEmittedTotal: bigint;
  readonly outputDroppedTotal: bigint;
  readonly outputNonterminalTotal: bigint;
  readonly outputTerminalTotal: bigint;
  readonly processFailureTotal: bigint;
  readonly timeoutTotal: bigint;
  readonly cancellationTotal: bigint;
  readonly gracefulFinishTotal: bigint;
  readonly idlePollTotal: bigint;
  readonly ready: boolean;
  readonly joined: boolean;
}

/** Delivery state for one named Operator input. */
export interface OperatorInputMetrics {
  readonly portName: string;
  readonly delivery: RouteDeliveryMetrics;
}

/** Input, worker, and shutdown state for one Operator instance. */
export interface OperatorMetrics {
  readonly operatorInstanceId: bigint;
  readonly inputDelivery: RouteDeliveryMetrics;
  readonly inputPorts: readonly OperatorInputMetrics[];
  readonly worker: OperatorWorkerMetrics;
  readonly finalizationFailuresTotal: bigint;
}

/** Typed-signal delivery from an Operator output to an Endpoint. */
export interface DerivedRouteMetrics {
  readonly routeId: bigint;
  readonly endpointId: bigint;
  readonly output: SignalQueueMetrics;
  readonly endpoint: EndpointMetrics;
}

/** Queue, pool, conversion, and shutdown state for generated PCM. */
export interface AudioReentryMetrics {
  readonly operatorInstanceId: bigint;
  readonly stemId: bigint;
  readonly queueCapacitySignals: bigint;
  readonly queueDepthSignals: bigint;
  readonly queuePeakSignals: bigint;
  readonly signalsEnqueuedTotal: bigint;
  readonly signalsReceivedTotal: bigint;
  readonly signalsDroppedTotal: bigint;
  readonly poolSlots: bigint;
  readonly frameCapacitySamples: bigint;
  readonly maximumBufferedAudioBytes: bigint;
  readonly normalizedTotal: bigint;
  readonly invalidTotal: bigint;
  readonly sharedAudioRejectedTotal: bigint;
  readonly poolExhaustedTotal: bigint;
  readonly ingressRejectedTotal: bigint;
  readonly audioFramesEnqueuedTotal: bigint;
  readonly cancellationTotal: bigint;
  readonly joined: boolean;
}

/** One immutable view of the current native Session state. */
export interface SessionMetrics {
  readonly eventQueue: EventQueueMetrics;
  readonly polledAudio: PolledAudioMetrics;
  readonly sources: readonly SourceMetrics[];
  readonly sourceNativeFormats: readonly SourceNativeFormatObservation[];
  readonly sourceActivities: readonly SourceActivityObservation[];
  readonly sourceSignals: readonly SourceSignalObservation[];
  readonly sourceReplacements: readonly SourceReplacementObservation[];
  readonly externalSources: readonly ExternalSourceMetrics[];
  readonly routes: readonly RouteMetrics[];
  readonly operators: readonly OperatorMetrics[];
  readonly derivedRoutes: readonly DerivedRouteMetrics[];
  readonly audioReentries: readonly AudioReentryMetrics[];
  readonly sourceCount: bigint;
  readonly externalSourceCount: bigint;
  readonly routeCount: bigint;
  readonly operatorCount: bigint;
  readonly derivedRouteCount: bigint;
  readonly audioReentryCount: bigint;
}

/** One gap, overlap, or sequence break retained in a multistem recording. */
export interface RecordingDiscontinuity {
  readonly stemId: bigint;
  readonly label: string;
  readonly kind: 'timestamp-gap' | 'sequence-gap' | 'overlap-rejected';
  readonly timestampStartNs: bigint;
  readonly timestampEndNs: bigint;
  readonly sequenceStart?: bigint;
  readonly sequenceEnd?: bigint;
}

/** Final write and delivery result for one named recording stem. */
export interface RecordingStemOutcome {
  readonly stemName: string;
  readonly framesWrittenTotal: bigint;
  readonly staleFramesTotal: bigint;
  readonly error?: string;
  readonly queueCapacityFrames: bigint;
  readonly queuePeakFrames: bigint;
  readonly framesDeliveredTotal: bigint;
  readonly framesDroppedTotal: bigint;
  readonly queueFullDropsTotal: bigint;
  readonly discontinuitiesTotal: bigint;
  readonly discontinuities: readonly RecordingDiscontinuity[];
}

/** Final state and artifact locations for one multistem recording. */
export interface RecordingOutcome {
  readonly sessionId: bigint;
  readonly groupId: string;
  readonly complete: boolean;
  readonly state: 'recording' | 'complete' | 'incomplete';
  readonly completedStems: bigint;
  readonly failedStems: bigint;
  readonly sessionDirectory: string;
  readonly manifestPath: string;
  readonly manifestSchemaVersion: number;
  readonly errorCode?: string;
  readonly stems: readonly RecordingStemOutcome[];
}

/** Final write totals for one native Session trace artifact. */
export interface SessionTraceOutcome {
  readonly path: string;
  readonly recordsAttemptedTotal: bigint;
  readonly recordsEnqueuedTotal: bigint;
  readonly recordsDroppedTotal: bigint;
  readonly recordsWrittenTotal: bigint;
  readonly rollingHash: bigint;
  readonly complete: boolean;
}

/** Kind of one record in a native Session trace. */
export type SessionTraceRecordKind =
  | 'lifecycle'
  | 'source-failure'
  | 'endpoint-failure'
  | 'rollback-failure'
  | 'finalization-failure'
  | 'terminal';

/** One validated record from a native Session trace. */
export interface SessionTraceRecord {
  readonly sequenceIndex: bigint;
  readonly observedAtNs: bigint;
  readonly sessionId: bigint;
  readonly kind: SessionTraceRecordKind;
  readonly lifecycleState?: SessionState;
  readonly terminalState?: 'stopped' | 'failed';
  readonly stemId?: bigint;
  readonly routeId?: bigint;
  readonly endpointId?: bigint;
  readonly endpointStage?: EndpointFailureStage;
  readonly rollbackStage?: RollbackFailureStage;
  readonly finalizationStage?: FinalizationFailureStage;
  readonly sourceFailuresTotal?: bigint;
  readonly endpointFailuresTotal?: bigint;
  readonly rollbackFailuresTotal?: bigint;
  readonly finalizationFailuresTotal?: bigint;
}

/** Result of validating record order, lifecycle order, identity, and terminal state. */
export interface SessionTraceValidation {
  readonly sessionId: bigint;
  readonly lifecycle: readonly SessionState[];
  readonly terminalState: 'stopped' | 'failed';
  readonly sourceFailuresTotal: bigint;
  readonly endpointFailuresTotal: bigint;
  readonly rollbackFailuresTotal: bigint;
  readonly finalizationFailuresTotal: bigint;
  readonly recordsValidatedTotal: bigint;
}

/** Opens and validates one native Session trace artifact. */
export class SessionTrace {
  readonly #native: NativeSessionTraceHandle;

  private constructor(native: NativeSessionTraceHandle) {
    this.#native = native;
  }

  /** Read one trace file and verify its binary layout and checksum. */
  public static read(path: string): SessionTrace {
    if (path.trim().length === 0) throw new RangeError('trace path cannot be empty');
    return new SessionTrace(
      nativeCallSync(() => nativeAddon().NativeSessionTrace.read(path)),
    );
  }

  /** Session identity stored in the trace header. */
  public get sessionId(): bigint {
    return BigInt(this.#native.sessionId);
  }

  /** Number of records stored in the artifact. */
  public get recordsTotal(): bigint {
    return BigInt(this.#native.recordsTotal);
  }

  /** Recorder totals stored in the artifact footer. */
  public get outcome(): SessionTraceOutcome {
    return _traceOutcomeFromNative(this.#native.outcome);
  }

  /** Return every typed trace record in sequence order. */
  public records(): readonly SessionTraceRecord[] {
    return Object.freeze(this.#native.records().map(traceRecordFromNative));
  }

  /** Validate lifecycle order, identity, timestamps, sequence, and terminal state. */
  public validate(): SessionTraceValidation {
    return traceValidationFromNative(nativeCallSync(() => this.#native.validate()));
  }
}

/** @internal */
export function _sessionMetricsFromNative(value: NativeSessionMetrics): SessionMetrics {
  const result = Object.freeze({
    eventQueue: eventQueue(value.eventQueue),
    polledAudio: polledAudio(value.polledAudio),
    sources: Object.freeze(value.sources.map(sourceMetrics)),
    sourceNativeFormats: Object.freeze(value.sourceNativeFormats.map(sourceNativeFormat)),
    sourceActivities: Object.freeze(value.sourceActivity.map(sourceActivity)),
    sourceSignals: Object.freeze(value.sourceSignal.map(sourceSignal)),
    sourceReplacements: Object.freeze(value.sourceReplacements.map(sourceReplacement)),
    externalSources: Object.freeze(value.externalSources.map(externalSourceMetrics)),
    routes: Object.freeze(value.routes.map(routeMetrics)),
    operators: Object.freeze(value.operators.map(operatorMetrics)),
    derivedRoutes: Object.freeze(value.derivedRoutes.map(derivedRouteMetrics)),
    audioReentries: Object.freeze(value.audioReentries.map(audioReentryMetrics)),
    sourceCount: BigInt(value.sourceCount),
    externalSourceCount: BigInt(value.externalSourceCount),
    routeCount: BigInt(value.routeCount),
    operatorCount: BigInt(value.operatorCount),
    derivedRouteCount: BigInt(value.derivedRouteCount),
    audioReentryCount: BigInt(value.audioReentryCount),
  });
  const expected = [
    result.sourceCount,
    result.externalSourceCount,
    result.routeCount,
    result.operatorCount,
    result.derivedRouteCount,
    result.audioReentryCount,
  ];
  const actual = [
    result.sources.length,
    result.externalSources.length,
    result.routes.length,
    result.operators.length,
    result.derivedRoutes.length,
    result.audioReentries.length,
  ].map(BigInt);
  if (expected.some((count, index) => count !== actual[index])) {
    throw new PocketStationError(
      'session.invalid_metrics_snapshot',
      'Native Session metrics counts are inconsistent',
    );
  }
  if (
    [
      result.sourceNativeFormats.length,
      result.sourceActivities.length,
      result.sourceSignals.length,
      result.sourceReplacements.length,
    ].some((count) => BigInt(count) !== result.sourceCount)
  ) {
    throw new PocketStationError(
      'session.invalid_metrics_snapshot',
      'Native source observation counts are inconsistent',
    );
  }
  return result;
}

/** @internal */
export function _recordingOutcomeFromNative(
  value: NativeRecordingOutcome,
): RecordingOutcome {
  const result: RecordingOutcome = Object.freeze({
    sessionId: BigInt(value.sessionId),
    groupId: value.groupId,
    complete: value.complete,
    state: choice(value.state, 'recording state', ['recording', 'complete', 'incomplete']),
    completedStems: BigInt(value.completedStems),
    failedStems: BigInt(value.failedStems),
    sessionDirectory: value.sessionDirectory,
    manifestPath: value.manifestPath,
    manifestSchemaVersion: value.manifestSchemaVersion,
    errorCode: value.errorCode ?? undefined,
    stems: Object.freeze(value.stems.map(recordingStemOutcome)),
  });
  if (result.complete !== (result.state === 'complete')) {
    throw new PocketStationError(
      'recording.invalid_outcome',
      'Native recording state is inconsistent',
    );
  }
  return result;
}

/** @internal */
export function _traceOutcomeFromNative(
  value: NativeTraceRecorderOutcome,
): SessionTraceOutcome {
  return Object.freeze({
    path: value.path,
    recordsAttemptedTotal: BigInt(value.recordsAttemptedTotal),
    recordsEnqueuedTotal: BigInt(value.recordsEnqueuedTotal),
    recordsDroppedTotal: BigInt(value.recordsDroppedTotal),
    recordsWrittenTotal: BigInt(value.recordsWrittenTotal),
    rollingHash: BigInt(value.rollingHash),
    complete: value.complete,
  });
}

function recordingStemOutcome(value: NativeRecordingStemOutcome): RecordingStemOutcome {
  return Object.freeze({
    stemName: value.stemName,
    framesWrittenTotal: BigInt(value.framesWrittenTotal),
    staleFramesTotal: BigInt(value.staleFramesTotal),
    error: value.error ?? undefined,
    queueCapacityFrames: BigInt(value.queueCapacityFrames),
    queuePeakFrames: BigInt(value.queuePeakFrames),
    framesDeliveredTotal: BigInt(value.framesDeliveredTotal),
    framesDroppedTotal: BigInt(value.framesDroppedTotal),
    queueFullDropsTotal: BigInt(value.queueFullDropsTotal),
    discontinuitiesTotal: BigInt(value.discontinuitiesTotal),
    discontinuities: Object.freeze(
      value.discontinuities.map((record) =>
        Object.freeze({
          stemId: BigInt(record.stemId),
          label: record.label,
          kind: choice(record.kind, 'recording discontinuity kind', [
            'timestamp-gap',
            'sequence-gap',
            'overlap-rejected',
          ]),
          timestampStartNs: BigInt(record.timestampStartNs),
          timestampEndNs: BigInt(record.timestampEndNs),
          sequenceStart:
            record.sequenceStart == null ? undefined : BigInt(record.sequenceStart),
          sequenceEnd:
            record.sequenceEnd == null ? undefined : BigInt(record.sequenceEnd),
        }),
      ),
    ),
  });
}

function traceRecordFromNative(value: NativeSessionTraceRecord): SessionTraceRecord {
  return Object.freeze({
    sequenceIndex: BigInt(value.sequenceIndex),
    observedAtNs: BigInt(value.observedAtNs),
    sessionId: BigInt(value.sessionId),
    kind: choice(value.kind, 'trace record kind', [
      'lifecycle',
      'source-failure',
      'endpoint-failure',
      'rollback-failure',
      'finalization-failure',
      'terminal',
    ]),
    lifecycleState:
      value.lifecycleState == null
        ? undefined
        : choice(value.lifecycleState, 'trace lifecycle state', SESSION_STATES),
    terminalState:
      value.terminalState == null
        ? undefined
        : choice(value.terminalState, 'trace terminal state', TERMINAL_STATES),
    stemId: value.stemId == null ? undefined : BigInt(value.stemId),
    routeId: value.routeId == null ? undefined : BigInt(value.routeId),
    endpointId: value.endpointId == null ? undefined : BigInt(value.endpointId),
    endpointStage:
      value.endpointStage == null
        ? undefined
        : choice(value.endpointStage, 'trace Endpoint failure stage', ENDPOINT_STAGES),
    rollbackStage:
      value.rollbackStage == null
        ? undefined
        : choice(value.rollbackStage, 'trace rollback stage', ROLLBACK_STAGES),
    finalizationStage:
      value.finalizationStage == null
        ? undefined
        : choice(value.finalizationStage, 'trace finalization stage', FINALIZATION_STAGES),
    sourceFailuresTotal:
      value.sourceFailuresTotal == null ? undefined : BigInt(value.sourceFailuresTotal),
    endpointFailuresTotal:
      value.endpointFailuresTotal == null ? undefined : BigInt(value.endpointFailuresTotal),
    rollbackFailuresTotal:
      value.rollbackFailuresTotal == null ? undefined : BigInt(value.rollbackFailuresTotal),
    finalizationFailuresTotal:
      value.finalizationFailuresTotal == null
        ? undefined
        : BigInt(value.finalizationFailuresTotal),
  });
}

function traceValidationFromNative(
  value: NativeSessionTraceValidation,
): SessionTraceValidation {
  return Object.freeze({
    sessionId: BigInt(value.sessionId),
    lifecycle: Object.freeze(
      value.lifecycle.map((state) => choice(state, 'trace lifecycle state', SESSION_STATES)),
    ),
    terminalState: choice(value.terminalState, 'trace terminal state', TERMINAL_STATES),
    sourceFailuresTotal: BigInt(value.sourceFailuresTotal),
    endpointFailuresTotal: BigInt(value.endpointFailuresTotal),
    rollbackFailuresTotal: BigInt(value.rollbackFailuresTotal),
    finalizationFailuresTotal: BigInt(value.finalizationFailuresTotal),
    recordsValidatedTotal: BigInt(value.recordsValidatedTotal),
  });
}

function eventQueue(value: NativeEventQueueMetrics): EventQueueMetrics {
  return bigints(value) as unknown as EventQueueMetrics;
}

function polledAudio(value: NativePolledAudioMetrics): PolledAudioMetrics {
  return bigints(value) as unknown as PolledAudioMetrics;
}

function latency(value: NativeLatencyHistogram): LatencyHistogram {
  return bigints(value) as unknown as LatencyHistogram;
}

function delivery(value: NativeRouteDeliveryMetrics): RouteDeliveryMetrics {
  return Object.freeze({
    ...bigints({
      queueCapacityFrames: value.queueCapacityFrames,
      queueDepthFrames: value.queueDepthFrames,
      queuePeakFrames: value.queuePeakFrames,
      framesEnqueuedTotal: value.framesEnqueuedTotal,
      framesDeliveredTotal: value.framesDeliveredTotal,
      framesDroppedTotal: value.framesDroppedTotal,
      overrunsTotal: value.overrunsTotal,
      receiverUnavailableDropsTotal: value.receiverUnavailableDropsTotal,
      queueFullDropsTotal: value.queueFullDropsTotal,
      sharedReferenceExhaustedDropsTotal: value.sharedReferenceExhaustedDropsTotal,
      branchPoolExhaustedDropsTotal: value.branchPoolExhaustedDropsTotal,
      invalidCopyPolicyDropsTotal: value.invalidCopyPolicyDropsTotal,
      freezeFailedDropsTotal: value.freezeFailedDropsTotal,
      discontinuitiesTotal: value.discontinuitiesTotal,
      sourceIdentityDiscontinuitiesTotal: value.sourceIdentityDiscontinuitiesTotal,
      sequenceDiscontinuitiesTotal: value.sequenceDiscontinuitiesTotal,
      timestampDiscontinuitiesTotal: value.timestampDiscontinuitiesTotal,
      lineageEpochDiscontinuitiesTotal: value.lineageEpochDiscontinuitiesTotal,
      manuallyReportedDiscontinuitiesTotal: value.manuallyReportedDiscontinuitiesTotal,
      workerFailuresTotal: value.workerFailuresTotal,
      shutdownDiscardedTotal: value.shutdownDiscardedTotal,
    }),
    enqueueToReceive: latency(value.enqueueToReceive),
    sourceTimestampToReceive: latency(value.sourceTimestampToReceive),
    discardedOutputFramesTotal:
      value.discardedOutputFramesTotal == null
        ? undefined
        : BigInt(value.discardedOutputFramesTotal),
  });
}

function endpointMetrics(value: NativeEndpointMetrics): EndpointMetrics {
  return Object.freeze({
    observationStage: choice(value.observationStage, 'Endpoint observation stage', [
      'unavailable',
      'live',
      'finalized',
    ]),
    framesReceivedTotal: BigInt(value.framesReceivedTotal),
    framesDeliveredTotal: BigInt(value.framesDeliveredTotal),
    framesDroppedTotal: BigInt(value.framesDroppedTotal),
    discontinuitiesTotal: BigInt(value.discontinuitiesTotal),
    failuresTotal: BigInt(value.failuresTotal),
    finalizationFailuresTotal: BigInt(value.finalizationFailuresTotal),
  });
}

function routeMetrics(value: NativeRouteMetrics): RouteMetrics {
  return Object.freeze({
    routeId: BigInt(value.routeId),
    endpointId: BigInt(value.endpointId),
    delivery: delivery(value.delivery),
    endpoint: endpointMetrics(value.endpoint),
    framesAttemptedTotal: BigInt(value.framesAttemptedTotal),
    observationInterval: choice(value.observationInterval, 'route observation interval', [
      'route-lifetime-to-snapshot',
    ]),
    dropRatePct: value.dropRatePct,
    sourceLatencyMeasurement: choice(
      value.sourceLatencyMeasurement,
      'route latency measurement',
      ['source-monotonic-timestamp-to-route-receive'],
    ),
    sourceLatencyUnit: choice(value.sourceLatencyUnit, 'route latency unit', [
      'nanoseconds',
    ]),
  });
}

function sourceMetrics(value: NativeSourceMetrics): SourceMetrics {
  return Object.freeze({
    ...bigints({
      stemId: value.stemId,
      callbackBuffersTotal: value.callbackBuffersTotal,
      captureFramesEnqueuedTotal: value.captureFramesEnqueuedTotal,
      capturePoolExhaustedTotal: value.capturePoolExhaustedTotal,
      captureDispatchQueueFullTotal: value.captureDispatchQueueFullTotal,
      captureInvalidBufferTotal: value.captureInvalidBufferTotal,
      captureOversizedBufferTotal: value.captureOversizedBufferTotal,
      captureStreamErrorsTotal: value.captureStreamErrorsTotal,
      captureTimestampEpochClampsTotal: value.captureTimestampEpochClampsTotal,
      frameStreamDeliveredFramesTotal: value.frameStreamDeliveredFramesTotal,
      frameStreamDroppedNewestFramesTotal: value.frameStreamDroppedNewestFramesTotal,
      framesDiscardedBeforeStartTotal: value.framesDiscardedBeforeStartTotal,
      ingressQueueCapacityFrames: value.ingressQueueCapacityFrames,
      ingressQueueDepthFrames: value.ingressQueueDepthFrames,
      ingressQueuePeakFrames: value.ingressQueuePeakFrames,
      ingressFramesEnqueuedTotal: value.ingressFramesEnqueuedTotal,
      ingressFramesDeliveredTotal: value.ingressFramesDeliveredTotal,
      ingressFramesRejectedFullTotal: value.ingressFramesRejectedFullTotal,
      ingressFramesRejectedCancelledTotal: value.ingressFramesRejectedCancelledTotal,
      ingressFramesDiscardedTotal: value.ingressFramesDiscardedTotal,
    }),
    runtimeEventQueue: eventQueue(value.runtimeEventQueue),
  }) as SourceMetrics;
}

/** @internal */
export function _captureNativeFormatFromNative(
  value: NativeCaptureFormat,
): OpenedNativeFormat {
  return Object.freeze({
    sampleRateHz: value.sampleRateHz,
    channelCount: value.channelCount,
    sampleRepresentation: choice(
      value.sampleRepresentation,
      'native PCM sample representation',
      Object.values(SampleRepresentation),
    ),
  });
}

function sourceNativeFormat(
  value: NativeSourceNativeFormatObservation,
): SourceNativeFormatObservation {
  return Object.freeze({
    stemId: StemId(BigInt(value.stemId)),
    openedNativeFormat:
      value.openedNativeFormat == null
        ? undefined
        : _captureNativeFormatFromNative(value.openedNativeFormat),
  });
}

function sourceActivity(value: NativeSourceActivityObservations): SourceActivityObservation {
  return Object.freeze({
    sessionStartedAtNs: BigInt(value.sessionStartedAtNs),
    observedAtNs: BigInt(value.observedAtNs),
    firstFrameReceivedAtNs:
      value.firstFrameReceivedAtNs == null
        ? undefined
        : BigInt(value.firstFrameReceivedAtNs),
    latestFrameReceivedAtNs:
      value.latestFrameReceivedAtNs == null
        ? undefined
        : BigInt(value.latestFrameReceivedAtNs),
    framesReceivedTotal: BigInt(value.framesReceivedTotal),
  });
}

function sourceSignal(value: NativeSourceSignalObservations): SourceSignalObservation {
  return Object.freeze({
    observedAtNs: BigInt(value.observedAtNs),
    samplesObservedTotal: BigInt(value.samplesObservedTotal),
    exactZeroSamplesObservedTotal: BigInt(value.exactZeroSamplesObservedTotal),
    nonzeroSamplesObservedTotal: BigInt(value.nonzeroSamplesObservedTotal),
    nonfiniteSamplesObservedTotal: BigInt(value.nonfiniteSamplesObservedTotal),
    windowTimestampStartNs:
      value.windowTimestampStartNs == null ? undefined : BigInt(value.windowTimestampStartNs),
    windowDurationNs: BigInt(value.windowDurationNs),
    windowObservedAtNs:
      value.windowObservedAtNs == null ? undefined : BigInt(value.windowObservedAtNs),
    windowSequenceNumber:
      value.windowSequenceNumber == null ? undefined : BigInt(value.windowSequenceNumber),
    windowSourceGeneration: value.windowSourceGeneration,
    windowDiscontinuityEpoch: BigInt(value.windowDiscontinuityEpoch),
    windowSamplesTotal: BigInt(value.windowSamplesTotal),
    windowExactZeroSamplesTotal: BigInt(value.windowExactZeroSamplesTotal),
    windowNonzeroSamplesTotal: BigInt(value.windowNonzeroSamplesTotal),
    windowNonfiniteSamplesTotal: BigInt(value.windowNonfiniteSamplesTotal),
    windowPeakLinear: value.windowPeakLinear ?? undefined,
    windowRmsLinear: value.windowRmsLinear ?? undefined,
    windowPeakDbfs: value.windowPeakDbfs ?? undefined,
    windowRmsDbfs: value.windowRmsDbfs ?? undefined,
    windowExactZeroRatio: value.windowExactZeroRatio ?? undefined,
    consecutiveExactZeroDurationNs: BigInt(value.consecutiveExactZeroDurationNs),
  });
}

function sourceReplacement(
  value: NativeSourceReplacementObservations,
): SourceReplacementObservation {
  return Object.freeze({
    stemId: StemId(BigInt(value.stemId)),
    attemptsTotal: BigInt(value.attemptsTotal),
    completedTotal: BigInt(value.completedTotal),
    failedBeforeAttachTotal: BigInt(value.failedBeforeAttachTotal),
    responseTimeoutsTotal: BigInt(value.responseTimeoutsTotal),
    attachedSourceId:
      value.attachedSourceId == null ? undefined : SourceId(BigInt(value.attachedSourceId)),
    sourceGeneration: value.sourceGeneration,
    discontinuityEpoch: BigInt(value.discontinuityEpoch),
    latestCompletedAtNs:
      value.latestCompletedAtNs == null ? undefined : BigInt(value.latestCompletedAtNs),
  });
}

function externalSourceMetrics(value: NativeExternalSourceMetrics): ExternalSourceMetrics {
  const { ready, joined, ...counts } = value;
  return Object.freeze({ ...bigints(counts), ready, joined }) as ExternalSourceMetrics;
}

function signalQueueMetrics(value: NativeSignalQueueMetrics): SignalQueueMetrics {
  return bigints(value) as unknown as SignalQueueMetrics;
}

function operatorWorkerMetrics(value: NativeOperatorWorkerMetrics): OperatorWorkerMetrics {
  const { ready, joined, ...counts } = value;
  return Object.freeze({ ...bigints(counts), ready, joined }) as OperatorWorkerMetrics;
}

function operatorMetrics(value: NativeOperatorMetrics): OperatorMetrics {
  return Object.freeze({
    operatorInstanceId: BigInt(value.operatorInstanceId),
    inputDelivery: delivery(value.inputDelivery),
    inputPorts: Object.freeze(
      value.inputPorts.map((port) =>
        Object.freeze({ portName: port.portName, delivery: delivery(port.delivery) }),
      ),
    ),
    worker: operatorWorkerMetrics(value.worker),
    finalizationFailuresTotal: BigInt(value.finalizationFailuresTotal),
  });
}

function derivedRouteMetrics(value: NativeDerivedRouteMetrics): DerivedRouteMetrics {
  return Object.freeze({
    routeId: BigInt(value.routeId),
    endpointId: BigInt(value.endpointId),
    output: signalQueueMetrics(value.output),
    endpoint: endpointMetrics(value.endpoint),
  });
}

function audioReentryMetrics(value: NativeAudioReentryMetrics): AudioReentryMetrics {
  const { joined, ...counts } = value;
  return Object.freeze({ ...bigints(counts), joined }) as AudioReentryMetrics;
}

function bigints<T extends object>(
  values: T,
): Readonly<{ [K in keyof T]: bigint }> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, BigInt(value as string)]),
    ),
  ) as { [K in keyof T]: bigint };
}

const SESSION_STATES = ['starting', 'running', 'stopping', 'stopped', 'failed'] as const;
const TERMINAL_STATES = ['stopped', 'failed'] as const;
const ENDPOINT_STAGES = [
  'prepare',
  'cancel-preparation',
  'start',
  'request-stop',
  'join-finalize',
] as const;
const ROLLBACK_STAGES = [
  'cancel-operator',
  'cancel-endpoint-preparation',
  'finalize-started-endpoint',
  'stop-opened-capture',
  'discard-runtime-queues',
] as const;
const FINALIZATION_STAGES = [
  'stop-capture',
  'drain-runtime',
  'drain-operator',
  'request-endpoint-stop',
  'join-endpoint',
  'finalize-endpoint',
  'drain-sidecar',
] as const;

function choice<const T extends readonly string[]>(
  value: string,
  name: string,
  accepted: T,
): T[number] {
  if (!(accepted as readonly string[]).includes(value)) {
    throw new PocketStationError(
      'session.invalid_observation',
      `Native Session returned an unknown ${name}: ${value}`,
    );
  }
  return value as T[number];
}
