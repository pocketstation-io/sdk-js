import { createRequire } from 'node:module';

export interface NativeSourceHandle {}

export interface NativeSourceConstructor {
  application(nameOrApplicationId: string): NativeSourceHandle;
  applicationName(name: string): NativeSourceHandle;
  applicationId(applicationId: string): NativeSourceHandle;
  applicationProcessId(processId: number): NativeSourceHandle;
  applicationStableId(platform: string, stableKey: string): NativeSourceHandle;
  applicationProcessInstance(
    processId: number,
    platform: string,
    stableKey: string,
  ): NativeSourceHandle;
  systemAudio(): NativeSourceHandle;
  defaultMicrophone(): NativeSourceHandle;
  microphoneId(deviceId: string): NativeSourceHandle;
}

export interface NativeAuthorizationOptions {
  osPermission?: string;
  applicationPolicy?: string;
  sessionGrant?: string;
  permissionEpoch?: string;
}

export interface NativeCaptureAuthorizationSnapshot {
  capability: string;
  osPermission: string;
  applicationPolicy: string;
  sessionGrant: string;
  captureScope: string;
  scopeStableId?: string | null;
  identityStrength: string;
  permissionEpoch: string;
  observedAtNs: string;
  openOutcome: string;
}

export interface NativeDiscoveredSourceHandle {
  readonly platform: string;
  readonly kind: string;
  readonly stableKey: string;
  readonly sourceId: string;
  readonly name: string;
  readonly processId?: number | null;
  readonly applicationId?: string | null;
  readonly deviceUid?: string | null;
  readonly state: string;
  readonly sampleRateHz: number;
  readonly channelCount: number;
  readonly identityStrength: string;
  readonly selectorPersistenceScope?: string | null;
  readonly processTreeScope?: string | null;
  authorizationBeforeOpen(
    options?: NativeAuthorizationOptions,
  ): NativeCaptureAuthorizationSnapshot;
}

export interface NativeCapturePermissionTransition {
  kind: string;
  previous: string;
  current: string;
  permissionEpoch: string;
}

export interface NativeCapturePermissionLifecycleHandle {
  readonly current: string;
  readonly permissionEpoch: string;
  observe(current: string): NativeCapturePermissionTransition | null | undefined;
}

interface NativeCapturePermissionLifecycleConstructor {
  new (current: string): NativeCapturePermissionLifecycleHandle;
}

export interface NativeEndpointHandle {
  readonly id: string;
  readonly sessionId: string;
}

export interface NativeProviderAudio {
  samplesF32Le: Buffer;
  sampleCount: number;
  sampleRateHz: number;
  channelCount: number;
  sourceId: string;
  streamId: string;
  sequenceNumber: string;
  timestampNs: string;
  routeEnqueuedAtNs: string;
  routeReceivedAtNs: string;
  outputGenerationId?: string | null;
}

export interface NativeProviderCall {
  operation: string;
  instanceId?: string | null;
  shutdownMode?: string | null;
  audio?: NativeProviderAudio | null;
  configuration?: NativeConfigurationEntry[] | null;
  sourceContext?: NativeSourceContext | null;
  cancelled?: boolean | null;
  inputPort?: string | null;
  signal?: NativeSignalEnvelope | null;
  routeId?: string | null;
  endpointId?: string | null;
}

export interface NativeProviderResult {
  outcome?: string | null;
  emission?: NativeProviderEmission | null;
  emissions?: NativeProviderEmission[] | null;
}

export interface NativeSourceContext {
  sourceTypeId: string;
  sessionId?: string | null;
  sourceId?: string | null;
  outputs: { name: string; streamId: string }[];
}

export interface NativeProviderEmission {
  output: string;
  payloadKind: string;
  text?: string | null;
  bytes?: Buffer | null;
  samplesF32Le?: Buffer | null;
  sourceTimestampNs?: string | null;
  observedTimestampNs?: string | null;
  durationNs?: string | null;
  sourceGeneration?: number | null;
  discontinuityEpoch?: string | null;
  policyEpoch?: string | null;
  clockId?: number | null;
  terminal?: boolean | null;
}

export interface NativeSourceOutputHandle {
  readonly sessionId: string;
  readonly sourceInstanceId: string;
  readonly sourceId: string;
  readonly streamId: string;
  readonly outputPort: string;
  connect(input: NativeOperatorInputHandle): string;
  send(endpoint: NativeEndpointHandle, inputPort?: string): string;
  through(
    operator: NativeOperatorHandle,
    inputPort?: string,
    outputPort?: string,
  ): NativeDerivedStreamHandle;
  record(name: string): NativeEndpointHandle;
}

export interface NativeSourceInstanceHandle {
  readonly sessionId: string;
  readonly instanceId: string;
  readonly sourceId: string;
  output(name: string): NativeSourceOutputHandle;
}

export interface NativeExtensionAbiVersion {
  structSizeBytes: number;
  abiMajor: number;
  abiMinor: number;
}

export interface NativeExtensionPort {
  name: string;
  direction: string;
  required: boolean;
  signalId: string;
  semanticRole: string;
  schema: string;
}

export interface NativeExtensionRegistration {
  id: string;
  kind: string;
  revision: number;
  generation: number;
}

export interface NativeExtensionLibrary {
  canonicalPath: string;
  registrations: NativeExtensionRegistration[];
}

export interface NativeSidecarProcessSpec {
  id: string;
  program: string;
  arguments: string[];
  configuration: Buffer;
  dataCapacityMessages: number;
  maxSignalIdBytes: number;
  maxRoleBytes: number;
  maxSchemaBytes: number;
  maxPayloadBytes: number;
  readyTimeoutMs: number;
  processingTimeoutMs: number;
  shutdownTimeoutMs: number;
}

export interface NativeSidecarMessage {
  kind: string;
  streamId: string;
  sequenceNumber: string;
  timestampNs: string;
  signalId: string;
  payload: Buffer;
  terminal: boolean;
  role?: string;
  schema?: string;
}

export interface NativeSidecarSnapshot {
  sidecarId: string;
  state: string;
  stateTransitions: string;
  dataEnqueuedTotal: string;
  dataReceivedTotal: string;
  dataDroppedTotal: string;
  protocolFailuresTotal: string;
  timeoutsTotal: string;
  forcedKillsTotal: string;
  reapsTotal: string;
}

export interface NativeSidecarRead {
  status: string;
  message?: NativeSidecarMessage | null;
}

export interface NativeAudioInputObservations {
  capacityFrames: string;
  bufferSlots: string;
  availableBuffers: string;
  acceptedTotal: string;
  fullTotal: string;
  invalidTotal: string;
  cancelled: boolean;
  closed: boolean;
}

export interface NativeAudioInputHandle {
  readonly sourceId: string;
  readonly streamId: string;
  readonly output: NativeSourceOutputHandle;
  tryWriteF32(samples: Float32Array, discontinuity: boolean): void;
  tryWriteF32Le(samples: Buffer, discontinuity: boolean): void;
  close(): void;
  observations(): NativeAudioInputObservations;
}

export interface NativeStemHandle {
  readonly id: string;
  send(endpoint: NativeEndpointHandle, inputPort?: string): string;
  connect(input: NativeOperatorInputHandle): string;
  through(
    operator: NativeOperatorHandle,
    inputPort?: string,
    outputPort?: string,
  ): NativeDerivedStreamHandle;
  record(name: string): NativeEndpointHandle;
}

export interface NativeSignalOptions {
  format?: string;
  customId?: string;
  role?: string;
  schema?: string;
}

export interface NativeSignalSpecHandle {
  readonly kind: string;
  readonly format?: string | null;
  readonly customId?: string | null;
  readonly role?: string | null;
  readonly schema?: string | null;
  readonly wireId: string;
  readonly isAudio: boolean;
  isCompatibleWith(other: NativeSignalSpecHandle): boolean;
}

interface NativeSignalSpecConstructor {
  new (kind: string, options?: NativeSignalOptions): NativeSignalSpecHandle;
}

export interface NativeMediaOptions {
  format?: string;
  sampleRateHz?: number;
  frameSamples?: number;
  channelLayout?: string;
}

export interface NativeMediaCapsHandle {
  readonly kind: string;
  readonly format?: string | null;
  readonly sampleRateHz?: number | null;
  readonly frameSamples?: number | null;
  readonly channelLayout?: string | null;
  isCompatibleWith(other: NativeMediaCapsHandle): boolean;
  negotiate(other: NativeMediaCapsHandle): NativeMediaCapsHandle | null | undefined;
  supportsSignal(signal: NativeSignalSpecHandle): boolean;
}

interface NativeMediaCapsConstructor {
  new (kind: string, options?: NativeMediaOptions): NativeMediaCapsHandle;
}

export interface NativePortSpecHandle {
  readonly name: string;
  readonly direction: string;
  readonly signal: NativeSignalSpecHandle;
  readonly media: NativeMediaCapsHandle;
  readonly multiplicity: string;
  readonly required: boolean;
}

interface NativePortSpecConstructor {
  new (
    name: string,
    direction: string,
    signal: NativeSignalSpecHandle,
    media: NativeMediaCapsHandle,
    multiplicity: string,
    required: boolean,
  ): NativePortSpecHandle;
}

export interface NativeDeliveryPolicyHandle {
  readonly clock: string;
  readonly latencyBudgetMs?: number | null;
  readonly jitterBudgetMs?: number | null;
  readonly backpressure: string;
  readonly delivery: string;
  readonly loss: string;
  readonly copyPolicy: string;
  readonly observability: string;
  readonly maxPayloadBytes?: number | null;
  withBackpressure(value: string): NativeDeliveryPolicyHandle;
  withCopyPolicy(value: string): NativeDeliveryPolicyHandle;
  withJitterBudgetMs(value?: number): NativeDeliveryPolicyHandle;
  withMaxPayloadBytes(value: number): NativeDeliveryPolicyHandle;
}

interface NativeDeliveryPolicyConstructor {
  realtimeAudio(): NativeDeliveryPolicyHandle;
  buffered(): NativeDeliveryPolicyHandle;
}

export interface NativeRouteSettingsHandle {
  readonly media: NativeMediaCapsHandle;
  readonly deliveryPolicy: NativeDeliveryPolicyHandle;
  withMedia(media: NativeMediaCapsHandle): NativeRouteSettingsHandle;
  withDelivery(delivery: NativeDeliveryPolicyHandle): NativeRouteSettingsHandle;
}

interface NativeRouteSettingsConstructor {
  new (
    media: NativeMediaCapsHandle,
    delivery: NativeDeliveryPolicyHandle,
  ): NativeRouteSettingsHandle;
  realtimeAudio(): NativeRouteSettingsHandle;
  buffered(): NativeRouteSettingsHandle;
}

export interface NativeConfigurationEntry {
  key: string;
  value: string;
  sensitive?: boolean;
}

export interface NativeOperatorHandle {}

interface NativeOperatorConstructor {
  new (
    operatorId: string,
    configuration?: NativeConfigurationEntry[],
  ): NativeOperatorHandle;
}

export interface NativeEndpointDefinitionHandle {}

interface NativeEndpointDefinitionConstructor {
  new (
    nodeType: string,
    operatorId: string,
    configuration?: NativeConfigurationEntry[],
    route?: NativeRouteSettingsHandle,
  ): NativeEndpointDefinitionHandle;
}

export interface NativeOperatorInputHandle {
  readonly portName: string;
}

export interface NativeOperatorInstanceHandle {
  readonly instanceId: string;
  input(portName: string): NativeOperatorInputHandle;
  output(portName: string): NativeDerivedStreamHandle;
}

export interface NativeDerivedStreamHandle {
  readonly operatorInstanceId: string;
  readonly outputPort?: string | null;
  output(portName: string): NativeDerivedStreamHandle;
  connect(input: NativeOperatorInputHandle): string;
  send(endpoint: NativeEndpointHandle, inputPort?: string): string;
  through(
    operator: NativeOperatorHandle,
    inputPort?: string,
    outputPort?: string,
  ): NativeDerivedStreamHandle;
  reenterAudio(): NativeStemHandle;
}

export interface NativeBusSubscriptionHandle {
  readonly id: string;
  readonly sessionId: string;
  readonly routeId: string;
  readonly signal: NativeSignalSpecHandle;
  readonly routeSettings: NativeRouteSettingsHandle;
}

export interface NativeSignalTiming {
  sourceTimestampNs?: string | null;
  observedTimestampNs: string;
  sessionTimestampNs?: string | null;
  durationNs?: string | null;
}

export interface NativeSignalLineage {
  sessionId: string;
  streamId: string;
  sourceId: string;
  clockId: number;
  sequenceNumber: string;
  sourceGeneration: number;
  discontinuityEpoch: string;
  policyEpoch: string;
}

export interface NativeSignalDerivation {
  upstreamLineage: NativeSignalLineage;
  upstreamTiming: NativeSignalTiming;
  operatorId: string;
  operatorRevision: number;
  operatorGeneration: number;
  connectorId?: string | null;
}

export interface NativeSignalAudio {
  samplesF32Le: Buffer;
  sampleCount: number;
  sampleRateHz: number;
  channelCount: number;
  streamId: string;
  sourceId: string;
  sequenceNumber: string;
  timestampNs: string;
}

export interface NativeSignalEnvelope {
  signalKind: string;
  signalFormat?: string | null;
  signalCustomId?: string | null;
  signalRole?: string | null;
  signalSchema?: string | null;
  signalWireId: string;
  timing: NativeSignalTiming;
  lineage?: NativeSignalLineage | null;
  derivation?: NativeSignalDerivation | null;
  payloadKind: string;
  text?: string | null;
  bytes?: Buffer | null;
  audio?: NativeSignalAudio | null;
}

export interface NativeSignalRead {
  status: string;
  envelope?: NativeSignalEnvelope | null;
  error?: string | null;
}

export interface NativeSignalMetrics {
  capacitySignals: string;
  maxPayloadBytes: string;
  maximumBufferedPayloadBytes: string;
  depthSignals: string;
  peakDepthSignals: string;
  enqueuedTotal: string;
  receivedTotal: string;
  droppedTotal: string;
}

export interface NativeAudioFrame {
  samplesF32Le: Buffer;
  sampleCount: number;
  sampleRateHz: number;
  channelCount: number;
  sessionId: string;
  streamId: string;
  sourceId: string;
  stemId: string;
  clockId: number;
  sequenceNumber: string;
  timestampStartNs: string;
  durationNs: string;
  sourceGeneration: number;
  discontinuityEpoch: string;
  permissionEpoch: string;
  outputGenerationId?: string;
  endpointId: string;
  connectorId: string;
  routeId: string;
  routeEnqueuedAtNs: string;
  routeReceivedAtNs: string;
  endpointEnqueuedAtNs: string;
  polledAtNs: string;
}

export interface NativeAudioRead {
  frames: NativeAudioFrame[];
  sessionState: string;
}

export interface NativeEventQueueMetrics {
  capacityCount: string;
  maximumEventOwnedBytes: string;
  maximumBufferedOwnedBytes: string;
  depthCount: string;
  depthOwnedBytes: string;
  peakDepthCount: string;
  peakDepthOwnedBytes: string;
  enqueuedTotal: string;
  droppedTotal: string;
  droppedOversizedTotal: string;
  receiverClosedTotal: string;
}

export interface NativePolledAudioMetrics {
  registeredEndpoints: string;
  queueCapacityFrames: string;
  queueDepthFrames: string;
  queuePeakFrames: string;
  queueDepthInvariantFailuresTotal: string;
  framesReceivedTotal: string;
  framesDeliveredTotal: string;
  queueFullDropsTotal: string;
  invalidOwnershipDropsTotal: string;
  discardedOutputFramesTotal: string;
  leaseCapacityCount: string;
  outstandingLeases: string;
  leaseExhaustedTotal: string;
  batchesPolledTotal: string;
  framesPolledTotal: string;
}

export interface NativeLatencyHistogram {
  samplesTotal: string;
  invalidOrderTotal: string;
  missingTotal: string;
  futureTotal: string;
  p50Ns: string;
  p95Ns: string;
  p99Ns: string;
  maxNs: string;
}

export interface NativeRouteDeliveryMetrics {
  queueCapacityFrames: string;
  queueDepthFrames: string;
  queuePeakFrames: string;
  framesEnqueuedTotal: string;
  framesDeliveredTotal: string;
  framesDroppedTotal: string;
  overrunsTotal: string;
  receiverUnavailableDropsTotal: string;
  queueFullDropsTotal: string;
  sharedReferenceExhaustedDropsTotal: string;
  branchPoolExhaustedDropsTotal: string;
  invalidCopyPolicyDropsTotal: string;
  freezeFailedDropsTotal: string;
  discontinuitiesTotal: string;
  sourceIdentityDiscontinuitiesTotal: string;
  sequenceDiscontinuitiesTotal: string;
  timestampDiscontinuitiesTotal: string;
  lineageEpochDiscontinuitiesTotal: string;
  manuallyReportedDiscontinuitiesTotal: string;
  enqueueToReceive: NativeLatencyHistogram;
  sourceTimestampToReceive: NativeLatencyHistogram;
  workerFailuresTotal: string;
  shutdownDiscardedTotal: string;
  discardedOutputFramesTotal?: string | null;
}

export interface NativeEndpointMetrics {
  observationStage: string;
  framesReceivedTotal: string;
  framesDeliveredTotal: string;
  framesDroppedTotal: string;
  discontinuitiesTotal: string;
  failuresTotal: string;
  finalizationFailuresTotal: string;
}

export interface NativeRouteMetrics {
  routeId: string;
  endpointId: string;
  delivery: NativeRouteDeliveryMetrics;
  endpoint: NativeEndpointMetrics;
  framesAttemptedTotal: string;
  observationInterval: string;
  dropRatePct: number;
  sourceLatencyMeasurement: string;
  sourceLatencyUnit: string;
}

export interface NativeSourceMetrics {
  stemId: string;
  callbackBuffersTotal: string;
  captureFramesEnqueuedTotal: string;
  capturePoolExhaustedTotal: string;
  captureDispatchQueueFullTotal: string;
  captureInvalidBufferTotal: string;
  captureOversizedBufferTotal: string;
  captureStreamErrorsTotal: string;
  captureTimestampEpochClampsTotal: string;
  frameStreamDeliveredFramesTotal: string;
  frameStreamDroppedNewestFramesTotal: string;
  framesDiscardedBeforeStartTotal: string;
  runtimeEventQueue: NativeEventQueueMetrics;
  ingressQueueCapacityFrames: string;
  ingressQueueDepthFrames: string;
  ingressQueuePeakFrames: string;
  ingressFramesEnqueuedTotal: string;
  ingressFramesDeliveredTotal: string;
  ingressFramesRejectedFullTotal: string;
  ingressFramesRejectedCancelledTotal: string;
  ingressFramesDiscardedTotal: string;
}

export interface NativeExternalSourceMetrics {
  sourceInstanceId: string;
  sourceId: string;
  emittedTotal: string;
  droppedTotal: string;
  failureTotal: string;
  cancellationTotal: string;
  discontinuityTotal: string;
  recoveryTotal: string;
  policyChangeTotal: string;
  ready: boolean;
  joined: boolean;
}

export interface NativeSignalQueueMetrics {
  capacitySignals: string;
  maxPayloadBytes: string;
  maximumBufferedPayloadBytes: string;
  depthSignals: string;
  peakDepthSignals: string;
  enqueuedTotal: string;
  receivedTotal: string;
  droppedTotal: string;
}

export interface NativeOperatorWorkerMetrics {
  inputAttemptedTotal: string;
  inputDroppedTotal: string;
  processedTotal: string;
  outputEmittedTotal: string;
  outputDroppedTotal: string;
  outputNonterminalTotal: string;
  outputTerminalTotal: string;
  processFailureTotal: string;
  timeoutTotal: string;
  cancellationTotal: string;
  gracefulFinishTotal: string;
  idlePollTotal: string;
  ready: boolean;
  joined: boolean;
}

export interface NativeOperatorInputMetrics {
  portName: string;
  delivery: NativeRouteDeliveryMetrics;
}

export interface NativeOperatorMetrics {
  operatorInstanceId: string;
  inputDelivery: NativeRouteDeliveryMetrics;
  inputPorts: NativeOperatorInputMetrics[];
  worker: NativeOperatorWorkerMetrics;
  finalizationFailuresTotal: string;
}

export interface NativeDerivedRouteMetrics {
  routeId: string;
  endpointId: string;
  output: NativeSignalQueueMetrics;
  endpoint: NativeEndpointMetrics;
}

export interface NativeAudioReentryMetrics {
  operatorInstanceId: string;
  stemId: string;
  queueCapacitySignals: string;
  queueDepthSignals: string;
  queuePeakSignals: string;
  signalsEnqueuedTotal: string;
  signalsReceivedTotal: string;
  signalsDroppedTotal: string;
  poolSlots: string;
  frameCapacitySamples: string;
  maximumBufferedAudioBytes: string;
  normalizedTotal: string;
  invalidTotal: string;
  sharedAudioRejectedTotal: string;
  poolExhaustedTotal: string;
  ingressRejectedTotal: string;
  audioFramesEnqueuedTotal: string;
  cancellationTotal: string;
  joined: boolean;
}

export interface NativeSessionMetrics {
  eventQueue: NativeEventQueueMetrics;
  polledAudio: NativePolledAudioMetrics;
  sources: NativeSourceMetrics[];
  externalSources: NativeExternalSourceMetrics[];
  routes: NativeRouteMetrics[];
  operators: NativeOperatorMetrics[];
  derivedRoutes: NativeDerivedRouteMetrics[];
  audioReentries: NativeAudioReentryMetrics[];
  sourceCount: string;
  externalSourceCount: string;
  routeCount: string;
  operatorCount: string;
  derivedRouteCount: string;
  audioReentryCount: string;
}

export interface NativeRecordingDiscontinuity {
  stemId: string;
  label: string;
  kind: string;
  timestampStartNs: string;
  timestampEndNs: string;
  sequenceStart?: string | null;
  sequenceEnd?: string | null;
}

export interface NativeRecordingStemOutcome {
  stemName: string;
  framesWrittenTotal: string;
  staleFramesTotal: string;
  error?: string | null;
  queueCapacityFrames: string;
  queuePeakFrames: string;
  framesDeliveredTotal: string;
  framesDroppedTotal: string;
  queueFullDropsTotal: string;
  discontinuitiesTotal: string;
  discontinuities: NativeRecordingDiscontinuity[];
}

export interface NativeRecordingOutcome {
  sessionId: string;
  groupId: string;
  complete: boolean;
  state: string;
  completedStems: string;
  failedStems: string;
  sessionDirectory: string;
  manifestPath: string;
  manifestSchemaVersion: number;
  errorCode?: string | null;
  stems: NativeRecordingStemOutcome[];
}

export interface NativeTraceRecorderOutcome {
  path: string;
  recordsAttemptedTotal: string;
  recordsEnqueuedTotal: string;
  recordsDroppedTotal: string;
  recordsWrittenTotal: string;
  rollingHash: string;
  complete: boolean;
}

export interface NativeSessionTraceRecord {
  sequenceIndex: string;
  observedAtNs: string;
  sessionId: string;
  kind: string;
  lifecycleState?: string | null;
  terminalState?: string | null;
  stemId?: string | null;
  routeId?: string | null;
  endpointId?: string | null;
  endpointStage?: string | null;
  rollbackStage?: string | null;
  finalizationStage?: string | null;
  sourceFailuresTotal?: string | null;
  endpointFailuresTotal?: string | null;
  rollbackFailuresTotal?: string | null;
  finalizationFailuresTotal?: string | null;
}

export interface NativeSessionTraceValidation {
  sessionId: string;
  lifecycle: string[];
  terminalState: string;
  sourceFailuresTotal: string;
  endpointFailuresTotal: string;
  rollbackFailuresTotal: string;
  finalizationFailuresTotal: string;
  recordsValidatedTotal: string;
}

export interface NativeSessionTraceHandle {
  readonly sessionId: string;
  readonly recordsTotal: string;
  readonly outcome: NativeTraceRecorderOutcome;
  records(): NativeSessionTraceRecord[];
  validate(): NativeSessionTraceValidation;
}

interface NativeSessionTraceConstructor {
  read(path: string): NativeSessionTraceHandle;
}

export interface NativeSourceFailure {
  sourceEventKind: string;
  stemId: string;
  sourcePlatform: string;
  sourceKind: string;
  sourceStableKey: string;
  sourceId: string;
  sourceGeneration: number;
  sourceRecoveryRequirement?: string | null;
  sourceFailureOperation: string;
  sourceFailureClass: string;
  sourcePlatformStatusCode?: number | null;
  sourceBackendClass?: string | null;
}

export interface NativeEndpointFailure {
  routeId: string;
  endpointId: string;
  failureStage: string;
  failureMessage: string;
  failureCode?: string | null;
  failureRetryability?: string | null;
}

export interface NativeControlFailure {
  failureStage: string;
  componentKind: string;
  componentId: string;
  failureOperation: string;
  failureErrorClass: string;
}

export interface NativeSessionEvent {
  eventType: string;
  sessionId: string;
  sessionState?: string | null;
  sourceEventKind?: string | null;
  stemId?: string | null;
  sourcePlatform?: string | null;
  sourceKind?: string | null;
  sourceStableKey?: string | null;
  sourceId?: string | null;
  sourceGeneration?: number | null;
  sourceRecoveryRequirement?: string | null;
  sourceFailureOperation?: string | null;
  sourceFailureClass?: string | null;
  sourcePlatformStatusCode?: number | null;
  sourceBackendClass?: string | null;
  routeId?: string | null;
  endpointId?: string | null;
  failureStage?: string | null;
  failureMessage?: string | null;
  failureCode?: string | null;
  failureRetryability?: string | null;
  componentKind?: string | null;
  componentId?: string | null;
  failureOperation?: string | null;
  failureErrorClass?: string | null;
  sourceFailuresTotal?: string | null;
  endpointFailuresTotal?: string | null;
  rollbackFailuresTotal?: string | null;
  finalizationFailuresTotal?: string | null;
  sourceFailures?: NativeSourceFailure[] | null;
  endpointFailures?: NativeEndpointFailure[] | null;
  rollbackFailures?: NativeControlFailure[] | null;
  finalizationFailures?: NativeControlFailure[] | null;
}

export interface NativeEventRead {
  event?: NativeSessionEvent | null;
  sessionState: string;
}

export interface NativeStopResult {
  success: boolean;
  alreadyStopped: boolean;
  disposition: string;
  sessionState: string;
  runtimeWorkerPanicked: boolean;
  captureFinalizationFailuresTotal: string;
  operatorFinalizationFailuresTotal: string;
  endpointFinalizationFailuresTotal: string;
  runtimeFailuresTotal: string;
  lineageFailuresTotal: string;
  sourceSendRejectionsTotal: string;
  runtimeEventsTotal: string;
  sidecarOutcomes: NativeSidecarSnapshot[];
  recording?: NativeRecordingOutcome | null;
  trace?: NativeTraceRecorderOutcome | null;
  traceError?: string | null;
  metrics?: NativeSessionMetrics | null;
  metricsUnavailableReason?: string | null;
  remainingEvents: NativeSessionEvent[];
}

export interface NativeRunningSessionHandle {
  readonly sessionId: string;
  readAudio(timeoutMs: number): Promise<NativeAudioRead>;
  readEvent(timeoutMs: number): Promise<NativeEventRead>;
  readSignal(
    subscription: NativeBusSubscriptionHandle,
    timeoutMs: number,
  ): Promise<NativeSignalRead>;
  closeSignal(subscription: NativeBusSubscriptionHandle): void;
  signalMetrics(
    subscription: NativeBusSubscriptionHandle,
  ): Promise<NativeSignalMetrics>;
  metrics(): Promise<NativeSessionMetrics>;
  sendSidecar(
    sidecarId: string,
    message: NativeSidecarMessage,
  ): Promise<void>;
  readSidecar(sidecarId: string, timeoutMs: number): Promise<NativeSidecarRead>;
  sidecarSnapshot(sidecarId: string): Promise<NativeSidecarSnapshot>;
  stop(): Promise<NativeStopResult>;
  cancel(): Promise<NativeStopResult>;
}

export interface NativeCompileDiagnostic {
  code: string;
  nodeIndex?: number | null;
  edgeIndex?: number | null;
  operatorId?: string | null;
  operatorInstanceId?: string | null;
  nodeTypeId?: string | null;
  sourceTypeId?: string | null;
  portName?: string | null;
  direction?: string | null;
  expected?: string | null;
  actual?: string | null;
}

export interface NativeStartFailure {
  code: string;
  message: string;
  diagnostic?: NativeCompileDiagnostic | null;
}

export interface NativeStartResultHandle {
  readonly failure?: NativeStartFailure | null;
  takeRunning(): NativeRunningSessionHandle | null | undefined;
}

export interface NativeSessionHandle {
  readonly id: string;
  capture(source: NativeSourceHandle): NativeStemHandle;
  audioInput(
    sampleRateHz: number,
    channels: number,
    capacityFrames: number,
    frameSamplesPerChannel: number,
  ): NativeAudioInputHandle;
  audio(): NativeEndpointHandle;
  audioWithRoute(route: NativeRouteSettingsHandle): NativeEndpointHandle;
  audioConnector(
    dispatch: (request: NativeProviderCall) => Promise<NativeProviderResult>,
    deadlineMs?: number,
  ): NativeEndpointHandle;
  operator(operator: NativeOperatorHandle): NativeOperatorInstanceHandle;
  endpoint(definition: NativeEndpointDefinitionHandle): NativeEndpointHandle;
  source(
    sourceTypeId: string,
    configuration: NativeConfigurationEntry[],
  ): NativeSourceInstanceHandle;
  registerSource(
    sourceTypeId: string,
    revision: number,
    generation: number,
    outputs: NativePortSpecHandle[],
    dispatch: (request: NativeProviderCall) => Promise<NativeProviderResult>,
    deadlineMs?: number,
  ): void;
  registerOperator(
    operatorId: string,
    revision: number,
    generation: number,
    inputs: NativePortSpecHandle[],
    outputs: NativePortSpecHandle[],
    queueCapacity: number,
    dispatch: (request: NativeProviderCall) => Promise<NativeProviderResult>,
    deadlineMs?: number,
  ): void;
  registerEndpoint(
    operatorId: string,
    nodeTypeId: string,
    inputs: NativePortSpecHandle[],
    dispatch: (request: NativeProviderCall) => Promise<NativeProviderResult>,
    deadlineMs?: number,
  ): void;
  registerSidecar(spec: NativeSidecarProcessSpec): string;
  loadNativeExtensionLibrary(path: string): Promise<NativeExtensionLibrary>;
  subscribeDerived(
    stream: NativeDerivedStreamHandle,
    signal: NativeSignalSpecHandle,
    route: NativeRouteSettingsHandle,
  ): NativeBusSubscriptionHandle;
  subscribeSourceOutput(
    stream: NativeSourceOutputHandle,
    signal: NativeSignalSpecHandle,
    route: NativeRouteSettingsHandle,
  ): NativeBusSubscriptionHandle;
  start(): Promise<NativeStartResultHandle>;
}

interface NativeSessionConstructor {
  new (options?: {
    sampleRateHz?: number;
    channels?: number;
    frameDurationMs?: number;
    recordingRoot?: string;
    tracePath?: string;
    traceCapacityRecords?: number;
  }): NativeSessionHandle;
  conformance?: (saturation?: boolean) => NativeSessionHandle;
}

export interface NativeAddon {
  NativeSource: NativeSourceConstructor;
  NativeSession: NativeSessionConstructor;
  NativeSessionTrace: NativeSessionTraceConstructor;
  NativeCapturePermissionLifecycle: NativeCapturePermissionLifecycleConstructor;
  NativeSignalSpec: NativeSignalSpecConstructor;
  NativeMediaCaps: NativeMediaCapsConstructor;
  NativePortSpec: NativePortSpecConstructor;
  NativeDeliveryPolicy: NativeDeliveryPolicyConstructor;
  NativeRouteSettings: NativeRouteSettingsConstructor;
  NativeOperator: NativeOperatorConstructor;
  NativeEndpointDefinition: NativeEndpointDefinitionConstructor;
  extensionAbiVersion(): NativeExtensionAbiVersion;
  extensionAbiIsCompatible(
    abiMajor: number,
    abiMinor: number,
    structSizeBytes: number,
  ): void;
  validateExtensionDescriptor(
    extensionId: string,
    kind: string,
    revision: number,
    generation: number,
    abiMajor: number,
    abiMinor: number,
    ports: NativeExtensionPort[],
  ): void;
  validateExtensionDescriptor(
    extensionId: string,
    kind: string,
    revision: number,
    generation: number,
    abiMajor: number,
    abiMinor: number,
    ports: NativeExtensionPort[],
  ): void;
  discoverSources(
    queryKind?: string,
    value?: string,
  ): Promise<NativeDiscoveredSourceHandle[]>;
  applicationCaptureAvailable(): boolean;
  microphonePermissionObservation(): Promise<string>;
}

const require = createRequire(import.meta.url);

function localAddonName(): string {
  const platform = process.platform;
  const architecture = process.arch;
  if (platform === 'darwin' && architecture === 'arm64') {
    return 'pocketstation-js.darwin-arm64.node';
  }
  if (platform === 'darwin' && architecture === 'x64') {
    return 'pocketstation-js.darwin-x64.node';
  }
  if (platform === 'win32' && architecture === 'x64') {
    return 'pocketstation-js.win32-x64-msvc.node';
  }
  if (platform === 'win32' && architecture === 'arm64') {
    return 'pocketstation-js.win32-arm64-msvc.node';
  }
  if (platform === 'linux' && architecture === 'x64') {
    return 'pocketstation-js.linux-x64-gnu.node';
  }
  if (platform === 'linux' && architecture === 'arm64') {
    return 'pocketstation-js.linux-arm64-gnu.node';
  }
  throw new Error(`PocketStation has no native package for ${platform}/${architecture}`);
}

let loadedAddon: NativeAddon | undefined;

export function nativeAddon(): NativeAddon {
  if (loadedAddon !== undefined) {
    return loadedAddon;
  }
  loadedAddon = require(`../../native-dist/${localAddonName()}`) as NativeAddon;
  return loadedAddon;
}
