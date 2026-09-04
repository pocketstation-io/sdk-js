import { createRequire } from 'node:module';

export interface NativeSourceHandle {}

export interface NativeSourceConstructor {
  application(nameOrApplicationId: string): NativeSourceHandle;
  systemAudio(): NativeSourceHandle;
  defaultMicrophone(): NativeSourceHandle;
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
}

export interface NativeRunningSessionHandle {
  readonly sessionId: string;
  readAudio(timeoutMs: number): Promise<NativeAudioRead>;
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
