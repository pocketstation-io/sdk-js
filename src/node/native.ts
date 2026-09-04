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
  remainingEvents: NativeSessionEvent[];
}

export interface NativeRunningSessionHandle {
  readonly sessionId: string;
  readAudio(timeoutMs: number): Promise<NativeAudioRead>;
  readEvent(timeoutMs: number): Promise<NativeEventRead>;
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
  operator(operator: NativeOperatorHandle): NativeOperatorInstanceHandle;
  endpoint(definition: NativeEndpointDefinitionHandle): NativeEndpointHandle;
  start(): Promise<NativeStartResultHandle>;
}

interface NativeSessionConstructor {
  new (options?: {
    sampleRateHz?: number;
    channels?: number;
    frameDurationMs?: number;
    recordingRoot?: string;
  }): NativeSessionHandle;
}

export interface NativeAddon {
  NativeSource: NativeSourceConstructor;
  NativeSession: NativeSessionConstructor;
  NativeCapturePermissionLifecycle: NativeCapturePermissionLifecycleConstructor;
  NativeSignalSpec: NativeSignalSpecConstructor;
  NativeMediaCaps: NativeMediaCapsConstructor;
  NativePortSpec: NativePortSpecConstructor;
  NativeDeliveryPolicy: NativeDeliveryPolicyConstructor;
  NativeRouteSettings: NativeRouteSettingsConstructor;
  NativeOperator: NativeOperatorConstructor;
  NativeEndpointDefinition: NativeEndpointDefinitionConstructor;
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
