import { loadNativePackage } from './native-package.js';
import type { EchoCancellationState, PlaybackReferenceCoverage } from './aec.js';

export interface NativeEchoCancellationObservations {
  state: EchoCancellationState;
  processedMicrophoneFramesTotal: string;
  outputFramesTotal: string;
  discardedOutputFramesTotal: string;
  tailFramesTotal: string;
  tailPaddingSamplesTotal: string;
  discardedTailGenerationsTotal: string;
  nominalDelaySamples: number;
  drainDurationMs: number;
  discardedMicrophoneFramesTotal: string;
  discardedReferenceFramesTotal: string;
  resetsTotal: string;
  processingGeneration: string;
  microphoneQueueDepthFrames: string;
  referenceQueueDepthFrames: string;
  queueCapacityFrames: string;
  latestProcessingDurationNs: string;
  maximumProcessingDurationNs: string;
  latestReferenceAgeNs: string;
  latestReferenceLeadNs: string;
  maximumCadenceErrorNs: string;
  analyzedReferenceFramesTotal: string;
  interruptedRequestsTotal: string;
  referenceSourceId?: string | null;
  microphoneSourceId?: string | null;
  qualifiedAlgorithmicDelaySamples?: number | null;
  lastError?: string | null;
}

export interface NativeEchoCancelledAudioHandle {
  audio(): NativeStemHandle;
  readonly referenceCoverage: PlaybackReferenceCoverage;
  observations(): NativeEchoCancellationObservations;
}

export interface NativeSourceHandle {}

export interface NativeSourceManifestHandle {}

interface NativeSourceManifestConstructor {
  new (
    sourceTypeId: string,
    outputs: NativePortSpecHandle[],
    revision: number,
    implementationGeneration: number,
  ): NativeSourceManifestHandle;
}

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
  readonly connectorId?: string | null;
}

export interface NativeRegisteredConnectorHandle {
  readonly sessionId: string;
}

export interface NativeConnectorConstraint {
  kind: string;
  minimum?: string | null;
  maximum?: string | null;
  values?: string[] | null;
}

export interface NativeConnectorConfigurationField {
  name: string;
  kind: string;
  requirement: string;
  documentation: string;
  defaultValue?: string | null;
  constraints?: NativeConnectorConstraint[] | null;
  deprecation?: string | null;
}

export interface NativeConnectorManifest {
  operatorId: string;
  nodeTypeId: string;
  packageVersion: string;
  manifestRevision: number;
  startupTimeoutMs: number;
  probeIntervalMs: number;
  successThreshold: number;
  failureThreshold: number;
  configurationRevision: number;
  configurationFields: NativeConnectorConfigurationField[];
  capabilities: { id: string; documentation: string }[];
  requirements: { id: string; required?: boolean; documentation: string }[];
}

export interface NativeRelayDestinationOptions {
  url: string;
  sessionId: string;
  sourceToken: string;
  busId: string;
  lowLatency?: boolean;
  startupTimeoutMs?: number;
  iceServers?: { urls: string[] }[];
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
  sourceGeneration: number;
  discontinuityEpoch: string;
  permissionEpoch: string;
  clockId: number;
  durationNs: string;
  connectorId?: string | null;
}

export interface NativeProviderCall {
  operation: string;
  instanceId?: string | null;
  timedOutOperation?: string | null;
  shutdownMode?: string | null;
  audio?: NativeProviderAudio | null;
  configuration?: NativeConfigurationEntry[] | null;
  sourceContext?: NativeSourceContext | null;
  cancelled?: boolean | null;
  inputPort?: string | null;
  signal?: NativeSignalEnvelope | null;
  routeId?: string | null;
  endpointId?: string | null;
  endpointInputs?: NativeEndpointInputDescriptor[] | null;
  endpointItems?: NativeEndpointItem[] | null;
  operatorContext?: NativeOperatorPrepareContext | null;
}

export interface NativeOperatorPortContext {
  edgeId?: string | null;
  portName: string;
  direction: string;
  capacitySignals: number;
  signal: NativeOperatorSignalSpec;
  media: NativeOperatorMediaCaps;
  routeSettings: NativeOperatorRouteSettings;
}

export interface NativeOperatorSignalSpec {
  kind: string;
  format?: string | null;
  customId?: string | null;
  role?: string | null;
  schema?: string | null;
}

export interface NativeOperatorMediaCaps {
  kind: string;
  format?: string | null;
  sampleRateHz?: number | null;
  frameSamples?: number | null;
  channelLayout?: string | null;
}

export interface NativeOperatorDeliveryPolicy {
  clock: string;
  latencyBudgetMs?: number | null;
  jitterBudgetMs?: number | null;
  backpressure: string;
  delivery: string;
  loss: string;
  copyPolicy: string;
  observability: string;
  maxPayloadBytes?: number | null;
}

export interface NativeOperatorRouteSettings {
  media: NativeOperatorMediaCaps;
  delivery: NativeOperatorDeliveryPolicy;
}

export interface NativeOperatorPrepareContext {
  executionPartition: string;
  inputs: NativeOperatorPortContext[];
  outputs: NativeOperatorPortContext[];
}

export interface NativeEndpointInputDescriptor {
  sessionId?: string | null;
  endpointId: string;
  connectorId?: string | null;
  routeId: string;
  portName: string;
  originKind?: string | null;
  sourceId?: string | null;
  streamId?: string | null;
  stemId?: string | null;
  sessionTimelineOriginNs?: string | null;
}

export interface NativeEndpointItem {
  inputPort: string;
  endpointId: string;
  routeId: string;
  audio?: NativeProviderAudio | null;
  signal?: NativeSignalEnvelope | null;
}

export interface NativeProviderResult {
  outcome?: string | null;
  outcomes?: string[] | null;
  emission?: NativeProviderEmission | null;
  emissions?: NativeProviderEmission[] | null;
  preparationGroup?: string | null;
  routePreparation?: boolean | null;
  idleEnabled?: boolean | null;
  endpointObservations?: NativeEndpointDriverObservations | null;
}

export interface NativeEndpointDriverObservations {
  framesReceivedTotal: string;
  framesDeliveredTotal: string;
  framesDroppedTotal: string;
  discontinuitiesTotal: string;
  failuresTotal: string;
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
  retainAudio(): NativeEndpointHandle;
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
  discardedOutputFramesTotal: string;
  cancelledOutputWritesTotal: string;
  cancelled: boolean;
  closed: boolean;
}

export interface NativeOutputGenerationHandle {
  readonly id: string;
  readonly active: boolean;
  cancel(): boolean;
}

export interface NativeAudioInputHandle {
  readonly sourceId: string;
  readonly streamId: string;
  readonly output: NativeSourceOutputHandle;
  beginOutput(): NativeOutputGenerationHandle;
  tryWriteF32(
    samples: Float32Array,
    discontinuity: boolean,
    generation?: NativeOutputGenerationHandle,
  ): void;
  tryWriteF32Le(
    samples: Buffer,
    discontinuity: boolean,
    generation?: NativeOutputGenerationHandle,
  ): void;
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
  retainAudio(): NativeEndpointHandle;
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
  withLoss(value: string): NativeDeliveryPolicyHandle;
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
  clockKind: string;
  clockOrigin: string;
  clockTickRateHz?: string | null;
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

export interface NativeAudioProcessing {
  inputSourceId: string;
  inputStreamId: string;
  inputSequenceNumber: string;
  inputTimestampNs: string;
  inputDurationNs: string;
  inputSourceGeneration: number;
  inputDiscontinuityEpoch: string;
  generation: string;
  nominalDelaySamples: number;
  paddingSamples: number;
  tailOffsetSamples: number;
  isTail: boolean;
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
  clockKind: string;
  clockOrigin: string;
  clockTickRateHz?: string;
  sequenceNumber: string;
  timestampStartNs: string;
  durationNs: string;
  sourceGeneration: number;
  discontinuityEpoch: string;
  permissionEpoch: string;
  outputGenerationId?: string;
  processing?: NativeAudioProcessing | null;
  endpointId: string;
  connectorId: string;
  routeId: string;
  routeEnqueuedAtNs: string;
  routeReceivedAtNs: string;
  endpointEnqueuedAtNs: string;
  polledAtNs: string;
  nativeReadResolvedAtNs: string;
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
  sourceNativeFormats: NativeSourceNativeFormatObservation[];
  sourceActivity: NativeSourceActivityObservations[];
  sourceSignal: NativeSourceSignalObservations[];
  sourceReplacements: NativeSourceReplacementObservations[];
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

export interface NativeCaptureFormat {
  sampleRateHz: number;
  channelCount: number;
  sampleRepresentation: string;
}

export interface NativeSourceNativeFormatObservation {
  stemId: string;
  openedNativeFormat?: NativeCaptureFormat | null;
}

export interface NativeSourceActivityObservations {
  sessionStartedAtNs: string;
  observedAtNs: string;
  firstFrameReceivedAtNs?: string | null;
  latestFrameReceivedAtNs?: string | null;
  framesReceivedTotal: string;
}

export interface NativeSourceSignalObservations {
  observedAtNs: string;
  samplesObservedTotal: string;
  exactZeroSamplesObservedTotal: string;
  nonzeroSamplesObservedTotal: string;
  nonfiniteSamplesObservedTotal: string;
  windowTimestampStartNs?: string | null;
  windowDurationNs: string;
  windowObservedAtNs?: string | null;
  windowSequenceNumber?: string | null;
  windowSourceGeneration: number;
  windowDiscontinuityEpoch: string;
  windowSamplesTotal: string;
  windowExactZeroSamplesTotal: string;
  windowNonzeroSamplesTotal: string;
  windowNonfiniteSamplesTotal: string;
  windowPeakLinear?: number | null;
  windowRmsLinear?: number | null;
  windowPeakDbfs?: number | null;
  windowRmsDbfs?: number | null;
  windowExactZeroRatio?: number | null;
  consecutiveExactZeroDurationNs: string;
}

export interface NativeSourceReplacementObservations {
  stemId: string;
  attemptsTotal: string;
  completedTotal: string;
  failedBeforeAttachTotal: string;
  responseTimeoutsTotal: string;
  attachedSourceId?: string | null;
  sourceGeneration: number;
  discontinuityEpoch: string;
  latestCompletedAtNs?: string | null;
}

export interface NativeSourceReplacement {
  stemId: string;
  previousSourceId: string;
  sourceId: string;
  sourceGeneration: number;
  discontinuityEpoch: string;
  openedNativeFormat?: NativeCaptureFormat | null;
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

export interface NativeClipInterval {
  startNs: string;
  endNs: string;
}

export interface NativeRecordedStem {
  label: string;
  sessionId: string;
  sourceId: string;
  stemId: string;
  clockId: string;
  sourceGeneration: number;
  permissionEpoch: string;
  sampleRateHz: number;
  channels: number;
  firstTimestampNs: string;
  finalTimestampNs: string;
}

export interface NativeRecordingClip {
  wav: Buffer;
  stem: NativeRecordedStem;
  requested: NativeClipInterval;
  actual: NativeClipInterval;
  firstSampleFrame: string;
  sampleFrames: string;
  discontinuities: NativeRecordingDiscontinuity[];
}

export interface NativeRecordedAudioHandle {
  stems(): NativeRecordedStem[];
  readClip(stemId: string, startNs: string, endNs: string): Promise<NativeRecordingClip>;
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
  relayOutcomes: NativeRelayPublishOutcome[];
  recording?: NativeRecordingOutcome | null;
  trace?: NativeTraceRecorderOutcome | null;
  traceError?: string | null;
  metrics?: NativeSessionMetrics | null;
  metricsUnavailableReason?: string | null;
  remainingEvents: NativeSessionEvent[];
}

export interface NativeRelayPublishOutcome {
  busId: string;
  endpointId: string;
  routeId: string;
  framesReceivedTotal: string;
  rtpPacketsSentTotal: string;
  rtpPayloadBytesSentTotal: string;
  ingressQueueDropsTotal: string;
  publisherStaleDropsTotal: string;
  cancelledOutputFramesTotal: string;
  cancelledOutputSamplesTotal: string;
  failuresTotal: string;
  error?: string | null;
}

export interface NativeRunningSessionHandle {
  readonly sessionId: string;
  readAudio(timeoutMs: number): Promise<NativeAudioRead>;
  discardAudio(): void;
  discardSignals(): void;
  monotonicTimestampNs(): string;
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
  replaceMicrophoneSource(
    stemId: string,
    source: NativeSourceHandle,
  ): Promise<NativeSourceReplacement>;
  reopenMicrophoneSource(
    stemId: string,
    source: NativeSourceHandle,
  ): Promise<NativeSourceReplacement>;
  sendSidecar(
    sidecarId: string,
    message: NativeSidecarMessage,
  ): Promise<void>;
  readSidecar(sidecarId: string, timeoutMs: number): Promise<NativeSidecarRead>;
  sidecarSnapshot(sidecarId: string): Promise<NativeSidecarSnapshot>;
  lifecycleState(): Promise<string>;
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
  audioHistory(retentionNs: string, maxPcmBytes: number, maxBuffers: number): NativeAudioHistoryHandle;
  readonly id: string;
  nativeAec(microphone: NativeStemHandle, playbackDeviceId: string): void;
  echoCancel(
    microphone: NativeStemHandle | NativeSourceOutputHandle | NativeDerivedStreamHandle,
    reference: NativeStemHandle | NativeSourceOutputHandle | NativeDerivedStreamHandle,
    coverage: PlaybackReferenceCoverage,
  ): NativeEchoCancelledAudioHandle;
  capture(source: NativeSourceHandle): NativeStemHandle;
  audioInput(
    sampleRateHz: number,
    channels: number,
    capacityFrames: number,
    frameSamplesPerChannel: number,
  ): NativeAudioInputHandle;
  audio(): NativeEndpointHandle;
  browser(receiverUri: string): NativeEndpointHandle;
  audioWithRoute(route: NativeRouteSettingsHandle): NativeEndpointHandle;
  relayAudio(options: NativeRelayDestinationOptions): NativeEndpointHandle;
  registerRelayRoute(
    busId: string,
    endpoint: NativeEndpointHandle,
    routeId: string,
  ): void;
  audioConnector(
    dispatch: (request: NativeProviderCall) => Promise<NativeProviderResult>,
    deadlineMs?: number,
    route?: NativeRouteSettingsHandle,
  ): NativeEndpointHandle;
  operator(operator: NativeOperatorHandle): NativeOperatorInstanceHandle;
  endpoint(definition: NativeEndpointDefinitionHandle): NativeEndpointHandle;
  source(
    sourceTypeId: string,
    configuration: NativeConfigurationEntry[],
  ): NativeSourceInstanceHandle;
  registerSource(
    manifest: NativeSourceManifestHandle,
    dispatch: (request: NativeProviderCall) => Promise<NativeProviderResult>,
    deadlineMs?: number,
  ): void;
  registerOperator(
    operatorId: string,
    revision: number,
    generation: number,
    inputs: NativePortSpecHandle[],
    outputs: NativePortSpecHandle[],
    queueCapacity: string,
    processTimeoutMs: number,
    networkAllowed: boolean,
    filesystemAllowed: boolean,
    drainQueued: boolean,
    continueOnFailure: boolean,
    terminalRoles: string[],
    dispatch: (request: NativeProviderCall) => Promise<NativeProviderResult>,
    deadlineMs?: number,
    inputDelivery?: NativeDeliveryPolicyHandle,
  ): void;
  registerEndpoint(
    operatorId: string,
    nodeTypeId: string,
    inputs: NativePortSpecHandle[],
    dispatch: (request: NativeProviderCall) => Promise<NativeProviderResult>,
    deadlineMs?: number,
    maximumBatchItems?: number,
  ): void;
  registerConnector(
    manifest: NativeConnectorManifest,
    inputs: NativePortSpecHandle[],
    dispatch: (request: NativeProviderCall) => Promise<NativeProviderResult>,
    deadlineMs: number | undefined,
    maximumBatchItems: number,
    worker: boolean,
  ): NativeRegisteredConnectorHandle;
  connectorEndpoint(
    registered: NativeRegisteredConnectorHandle,
    configuration: NativeConfigurationEntry[],
    route: NativeRouteSettingsHandle,
  ): NativeEndpointHandle;
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
  recordingClipWindow(startNs: string, endNs: string, beforeNs: string, afterNs: string): NativeClipInterval;
  openRecordedAudio(directory: string, sessionId: string): Promise<NativeRecordedAudioHandle>;

  aecAvailable(): boolean;
  NativeSource: NativeSourceConstructor;
  NativeSourceManifest: NativeSourceManifestConstructor;
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
  conformanceSourceReplacementError?: (caseName: string) => void;
}

let loadedAddon: NativeAddon | undefined;

export function nativeAddon(): NativeAddon {
  if (loadedAddon !== undefined) {
    return loadedAddon;
  }
  loadedAddon = loadNativePackage() as NativeAddon;
  return loadedAddon;
}

export interface NativeAudioHistoryObservations {
  readonly state: string;
  readonly retainedPcmBytes: number;
  readonly retainedBuffers: number;
  readonly receivedBuffersTotal: string;
  readonly evictedBuffersTotal: string;
  readonly rejectedBuffersTotal: string;
  readonly discontinuitiesTotal: string;
  readonly sourceResetsTotal: string;
}

export interface NativeAudioHistoryHandle {
  stems(): Promise<NativeRecordedStem[]>;
  readClip(stemId: string, startNs: string, endNs: string): Promise<NativeRecordingClip>;
  clear(): Promise<void>;
  observations(): Promise<NativeAudioHistoryObservations>;
}
