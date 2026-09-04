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
}

export interface NativeStemHandle {
  readonly id: string;
  send(endpoint: NativeEndpointHandle): string;
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

export interface NativeSessionHandle {
  readonly id: string;
  capture(source: NativeSourceHandle): NativeStemHandle;
  audio(): NativeEndpointHandle;
  start(): Promise<NativeRunningSessionHandle>;
}

interface NativeSessionConstructor {
  new (options?: {
    sampleRateHz?: number;
    channels?: number;
    frameDurationMs?: number;
  }): NativeSessionHandle;
}

export interface NativeAddon {
  NativeSource: NativeSourceConstructor;
  NativeSession: NativeSessionConstructor;
  NativeCapturePermissionLifecycle: NativeCapturePermissionLifecycleConstructor;
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
