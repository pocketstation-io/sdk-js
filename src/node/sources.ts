import {
  CaptureError,
  PocketStationError,
  SessionDeclarationError,
  nativeCall,
  nativeCallSync,
} from './errors.js';
import { SourceId } from './identity.js';
import {
  nativeAddon,
  type NativeCaptureAuthorizationSnapshot,
  type NativeCapturePermissionLifecycleHandle,
  type NativeDiscoveredSourceHandle,
  type NativeSourceHandle,
} from './native.js';

/** Operating system that produced a discovered source identity. */
export const Platform = Object.freeze({
  MACOS: 'macos',
  WINDOWS: 'windows',
  LINUX: 'linux',
  IOS: 'ios',
  ANDROID: 'android',
  WEB: 'web',
  UNKNOWN: 'unknown',
} as const);
export type Platform = (typeof Platform)[keyof typeof Platform];

/** Native source kind reported by discovery. */
export const SourceKind = Object.freeze({
  APPLICATION: 'application',
  OUTPUT_DEVICE: 'output-device',
  INPUT_DEVICE: 'input-device',
  SYSTEM_MIX: 'system-mix',
} as const);
export type SourceKind = (typeof SourceKind)[keyof typeof SourceKind];

/** State observed during the discovery snapshot. */
export const SourceState = Object.freeze({
  AVAILABLE: 'available',
  PLAYING: 'playing',
  SILENT: 'silent',
  UNAVAILABLE: 'unavailable',
  PERMISSION_BLOCKED: 'permission-blocked',
} as const);
export type SourceState = (typeof SourceState)[keyof typeof SourceState];

/** Native evidence used to distinguish a discovered source. */
export const SourceIdentityStrength = Object.freeze({
  APPLICATION_ID_AND_PROCESS_ID: 'application-id-and-process-id',
  STABLE_APPLICATION_ID: 'stable-application-id',
  PROCESS_ID: 'process-id',
  STABLE_DEVICE_UID: 'stable-device-uid',
  PLATFORM_STABLE_ID: 'platform-stable-id',
} as const);
export type SourceIdentityStrength =
  (typeof SourceIdentityStrength)[keyof typeof SourceIdentityStrength];

/** How long a discovered selector may be reused without rediscovery. */
export const SelectorPersistenceScope = Object.freeze({
  PROCESS_LIFETIME: 'process-lifetime',
  APPLICATION_IDENTITY: 'application-identity',
  DEVICE_IDENTITY: 'device-identity',
  SESSION_DEFAULT_DEVICE: 'session-default-device',
  PLATFORM_IDENTITY: 'platform-identity',
} as const);
export type SelectorPersistenceScope =
  (typeof SelectorPersistenceScope)[keyof typeof SelectorPersistenceScope];

/** Processes included by an application selection on its native platform. */
export const ProcessTreeScope = Object.freeze({
  SELECTED_PROCESS_ONLY: 'selected-process-only',
  SELECTED_PROCESS_AND_DESCENDANTS: 'selected-process-and-descendants',
  APPLICATION_IDENTITY: 'application-identity',
  NOT_APPLICABLE: 'not-applicable',
} as const);
export type ProcessTreeScope = (typeof ProcessTreeScope)[keyof typeof ProcessTreeScope];

/** Authoritative permission state, including hosts that cannot report it. */
export const PermissionObservation = Object.freeze({
  ALLOWED: 'allowed',
  DENIED: 'denied',
  RESTRICTED: 'restricted',
  NOT_DETERMINED: 'not-determined',
  REVOKED: 'revoked',
  NOT_OBSERVABLE: 'not-observable',
  NOT_APPLICABLE: 'not-applicable',
} as const);
export type PermissionObservation =
  (typeof PermissionObservation)[keyof typeof PermissionObservation];

/** Kind of authoritative permission transition. */
export const CapturePermissionTransitionKind = Object.freeze({
  CHANGED: 'permission-changed',
  REVOKED: 'permission-revoked',
} as const);
export type CapturePermissionTransitionKind =
  (typeof CapturePermissionTransitionKind)[keyof typeof CapturePermissionTransitionKind];

/** Host-reported application capture policy. */
export const ApplicationPolicyObservation = Object.freeze({
  ALLOWED: 'allowed',
  DENIED: 'denied',
  NOT_OBSERVABLE: 'not-observable',
  NOT_APPLICABLE: 'not-applicable',
} as const);
export type ApplicationPolicyObservation =
  (typeof ApplicationPolicyObservation)[keyof typeof ApplicationPolicyObservation];

/** Whether the host application granted this Session access to the source. */
export const CaptureSessionGrant = Object.freeze({
  GRANTED_BY_EXPLICIT_SELECTION: 'granted-by-explicit-selection',
  DENIED: 'denied',
  NOT_EVALUATED: 'not-evaluated',
} as const);
export type CaptureSessionGrant =
  (typeof CaptureSessionGrant)[keyof typeof CaptureSessionGrant];

/** Whether the selected capture capability is available on this host. */
export const CaptureCapabilityState = Object.freeze({
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  UNSUPPORTED: 'unsupported',
} as const);
export type CaptureCapabilityState =
  (typeof CaptureCapabilityState)[keyof typeof CaptureCapabilityState];

/** Exact source scope represented by authorization evidence. */
export const CaptureScopeKind = Object.freeze({
  EXACT_APPLICATION: 'exact-application',
  EXACT_INPUT_DEVICE: 'exact-input-device',
  EXACT_OUTPUT_DEVICE: 'exact-output-device',
  SYSTEM_MIX: 'system-mix',
} as const);
export type CaptureScopeKind = (typeof CaptureScopeKind)[keyof typeof CaptureScopeKind];
/** Compatibility alias for the original JavaScript name. */
export type CaptureScope = CaptureScopeKind;

/** Result of opening a source, or `not-attempted` for pre-open evidence. */
export const CaptureOpenOutcome = Object.freeze({
  NOT_ATTEMPTED: 'not-attempted',
  SUCCEEDED: 'succeeded',
  PERMISSION_DENIED: 'permission-denied',
  SOURCE_UNAVAILABLE: 'source-unavailable',
  BACKEND_FAILED: 'backend-failed',
} as const);
export type CaptureOpenOutcome =
  (typeof CaptureOpenOutcome)[keyof typeof CaptureOpenOutcome];

/** Stable selector form retained by a Source declaration. */
export const SourceSelectorKind = Object.freeze({
  APPLICATION_NAME: 'application-name',
  APPLICATION_BUNDLE_ID: 'application-bundle-id',
  APPLICATION_PROCESS_ID: 'application-process-id',
  APPLICATION_STABLE_ID: 'application-stable-id',
  APPLICATION_PROCESS_INSTANCE: 'application-process-instance',
  MICROPHONE_DEFAULT: 'microphone-default',
  MICROPHONE_ID: 'microphone-id',
  SYSTEM_MIX: 'system-mix',
} as const);
export type SourceSelectorKind =
  (typeof SourceSelectorKind)[keyof typeof SourceSelectorKind];

/** Native source failure kind. */
export const SourceRuntimeEventKind = Object.freeze({
  SOURCE_UNAVAILABLE: 'source-unavailable',
  BACKEND_FAILURE: 'backend-failure',
} as const);
export type SourceRuntimeEventKind =
  (typeof SourceRuntimeEventKind)[keyof typeof SourceRuntimeEventKind];

/** Recovery action required after a native source lifetime ends. */
export const SourceRecoveryRequirement = Object.freeze({
  EXPLICIT_REDISCOVERY_AND_NEW_SESSION: 'explicit-rediscovery-and-new-session',
} as const);
export type SourceRecoveryRequirement =
  (typeof SourceRecoveryRequirement)[keyof typeof SourceRecoveryRequirement];

/** Stable class of native source failure evidence. */
export const SourceFailureClass = Object.freeze({
  SOURCE_INSTANCE_EXITED: 'source-instance-exited',
  PLATFORM_STATUS: 'platform-status',
  BACKEND_CLASS: 'backend-class',
} as const);
export type SourceFailureClass =
  (typeof SourceFailureClass)[keyof typeof SourceFailureClass];

/** Stable source identity returned by native discovery. */
export interface StableSourceId {
  /** Platform that assigned this identity. */
  readonly platform: Platform;
  /** Source kind. */
  readonly kind: SourceKind;
  /** Native stable key retained without re-hashing. */
  readonly stableKey: string;
  /** Immutable Core Source identity when the value came from discovery. */
  readonly sourceId?: SourceId;
}

/** Exact application process and the stable identity observed for it. */
export interface ProcessInstanceSelector {
  /** Process identifier observed during discovery. */
  readonly processId: number;
  /** Stable identity observed for that exact process instance. */
  readonly stableId: StableSourceId;
}

/** Typed native source disappearance or backend-failure observation. */
export interface SourceRuntimeEvent {
  readonly kind: SourceRuntimeEventKind;
  readonly stableId: StableSourceId;
  readonly generation: number;
  readonly recoveryRequirement?: SourceRecoveryRequirement;
  readonly operation: string;
  readonly failureClass: SourceFailureClass;
  readonly platformStatusCode?: number;
  readonly backendClass?: string;
}

/** Evidence available before PocketStation tries to open a discovered source. */
export interface CaptureAuthorizationSnapshot {
  /** Availability of the capture capability. */
  readonly capability: CaptureCapabilityState;
  /** Permission value reported by the operating system. */
  readonly osPermission: PermissionObservation;
  /** Application capture policy reported by the operating system. */
  readonly applicationPolicy: ApplicationPolicyObservation;
  /** Access decision made by the host application. */
  readonly sessionGrant: CaptureSessionGrant;
  /** Source scope covered by this evidence. */
  readonly captureScope: CaptureScopeKind;
  /** Stable native identity for an exact application or device. */
  readonly scopeStableId?: string;
  /** Native evidence used to distinguish the source. */
  readonly identityStrength: SourceIdentityStrength;
  /** Permission generation assigned by the host. */
  readonly permissionEpoch: bigint;
  /** Monotonic observation time in nanoseconds. */
  readonly observedAtNs: bigint;
  /** Source open result; pre-open evidence is always `not-attempted`. */
  readonly openOutcome: CaptureOpenOutcome;
}

/** Values supplied when creating pre-open authorization evidence. */
export interface AuthorizationOptions {
  /** Authoritative operating-system permission observation. */
  readonly osPermission?: PermissionObservation;
  /** Authoritative application capture policy observation. */
  readonly applicationPolicy?: ApplicationPolicyObservation;
  /** Explicit access decision made by the host application. */
  readonly sessionGrant?: CaptureSessionGrant;
  /** Non-zero host permission generation. Defaults to one. */
  readonly permissionEpoch?: bigint;
}

/** One source returned by native discovery. */
export class DiscoveredSource {
  readonly #native: NativeDiscoveredSourceHandle;
  /** Stable identity assigned by Core. */
  readonly stableId: StableSourceId;
  /** Display name reported by the operating system. */
  readonly name: string;
  /** Current process identifier, when the source is an application. */
  readonly processId: number | undefined;
  /** Native application identifier, when the platform reports one. */
  readonly applicationId: string | undefined;
  /** Stable device identifier, when the source is a device. */
  readonly deviceUid: string | undefined;
  /** State observed during this discovery call. */
  readonly state: SourceState;
  /** Native sample rate in hertz. */
  readonly sampleRateHz: number;
  /** Native channel count. */
  readonly channelCount: number;
  /** Evidence used to distinguish this source. */
  readonly identityStrength: SourceIdentityStrength;
  /** How long this selector may be reused without rediscovery. */
  readonly selectorPersistenceScope: SelectorPersistenceScope | undefined;
  /** Processes included when this application source is opened. */
  readonly processTreeScope: ProcessTreeScope | undefined;

  /** @internal */
  public constructor(native: NativeDiscoveredSourceHandle) {
    this.#native = native;
    this.stableId = Object.freeze({
      platform: native.platform as Platform,
      kind: native.kind as SourceKind,
      stableKey: native.stableKey,
      sourceId: SourceId(BigInt(native.sourceId)),
    });
    this.name = native.name;
    this.processId = native.processId ?? undefined;
    this.applicationId = native.applicationId ?? undefined;
    this.deviceUid = native.deviceUid ?? undefined;
    this.state = native.state as SourceState;
    this.sampleRateHz = native.sampleRateHz;
    this.channelCount = native.channelCount;
    this.identityStrength = native.identityStrength as SourceIdentityStrength;
    this.selectorPersistenceScope = (native.selectorPersistenceScope ?? undefined) as
      | SelectorPersistenceScope
      | undefined;
    this.processTreeScope = (native.processTreeScope ?? undefined) as
      | ProcessTreeScope
      | undefined;
    Object.freeze(this);
  }

  /** Record what the host knows before it opens this exact source. */
  public authorizationBeforeOpen(
    options: AuthorizationOptions = {},
  ): CaptureAuthorizationSnapshot {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new CaptureError(
        'capture.invalid_authorization_options',
        'authorization options must be an object',
      );
    }
    const permissionEpoch = optionalPermissionEpoch(options.permissionEpoch);
    optionalPermissionObservation(options.osPermission);
    optionalApplicationPolicy(options.applicationPolicy);
    optionalSessionGrant(options.sessionGrant);
    const native = nativeCallSync(() =>
      this.#native.authorizationBeforeOpen({
        osPermission: options.osPermission,
        applicationPolicy: options.applicationPolicy,
        sessionGrant: options.sessionGrant,
        permissionEpoch,
      }),
    );
    return authorizationFromNative(native);
  }
}

/** Structural discovery filter accepted for backwards compatibility. */
export type SourceQueryInput =
  | { readonly type: 'all' }
  | { readonly type: 'application'; readonly name: string }
  | { readonly type: 'kind'; readonly kind: SourceKind }
  | { readonly type: 'stable-key'; readonly stableKey: string }
  | { readonly type: 'playing' };

const queryValues = new WeakMap<SourceQuery, SourceQueryInput>();

/** Immutable typed query for native source discovery. */
export class SourceQuery {
  private constructor(value: SourceQueryInput) {
    queryValues.set(this, Object.freeze({ ...value }));
    Object.freeze(this);
  }

  public static any(): SourceQuery {
    return new SourceQuery({ type: 'all' });
  }

  public static application(name: string): SourceQuery {
    return new SourceQuery({
      type: 'application',
      name: requireText('application query', name),
    });
  }

  public static kind(kind: SourceKind): SourceQuery {
    return new SourceQuery({ type: 'kind', kind: requireSourceKind(kind) });
  }

  public static stableKey(stableKey: string): SourceQuery {
    return new SourceQuery({
      type: 'stable-key',
      stableKey: requireText('stable source key', stableKey),
    });
  }

  public static playing(): SourceQuery {
    return new SourceQuery({ type: 'playing' });
  }

}

/** Supported concise selections for one running application. */
export type ApplicationSelection =
  | string
  | number
  | StableSourceId
  | ProcessInstanceSelector;

const handles = new WeakMap<Source, NativeSourceHandle>();

export type SourceSelectorValue =
  | string
  | number
  | StableSourceId
  | ProcessInstanceSelector
  | undefined;

/** Describes audio that a Session should open when it starts. */
export class Source {
  public readonly kind: SourceKind;
  public readonly selectorKind: SourceSelectorKind;
  public readonly selectorValue: SourceSelectorValue;

  private constructor(
    native: NativeSourceHandle,
    kind: SourceKind,
    selectorKind: SourceSelectorKind,
    selectorValue?: SourceSelectorValue,
  ) {
    handles.set(this, native);
    this.kind = kind;
    this.selectorKind = selectorKind;
    this.selectorValue = selectorValue;
    Object.freeze(this);
  }

  /**
   * Select a running application by exact name, application ID, process ID,
   * or an identity returned by discovery.
   */
  public static application(selection: ApplicationSelection): Source {
    if (typeof selection === 'string') {
      return Source.applicationName(selection);
    }
    if (typeof selection === 'number') {
      return Source.applicationProcessId(selection);
    }
    if (
      typeof selection === 'object' &&
      selection !== null &&
      'processId' in selection
    ) {
      const stableId = freezeStableId(selection.stableId);
      requireApplicationIdentity(stableId);
      return Source.applicationProcessInstance(
        selection.processId,
        stableId.platform,
        stableId.stableKey,
      );
    }
    if (typeof selection !== 'object' || selection === null) {
      throw invalidSelector('application selection is not recognized');
    }
    return Source.applicationStableId(selection);
  }

  /** Select a running application by exact display name. */
  public static applicationName(name: string): Source {
    const selectedName = requireText('application name', name);
    return new Source(
      nativeCallSync(() => nativeAddon().NativeSource.applicationName(selectedName)),
      SourceKind.APPLICATION,
      SourceSelectorKind.APPLICATION_NAME,
      selectedName,
    );
  }

  /** Select a running application by its native application identifier. */
  public static applicationId(applicationId: string): Source {
    return Source.applicationBundleId(applicationId);
  }

  /** Select a running application by its native bundle/application identifier. */
  public static applicationBundleId(bundleId: string): Source {
    const selectedBundleId = requireText('application identifier', bundleId);
    return new Source(
      nativeCallSync(() => nativeAddon().NativeSource.applicationId(selectedBundleId)),
      SourceKind.APPLICATION,
      SourceSelectorKind.APPLICATION_BUNDLE_ID,
      selectedBundleId,
    );
  }

  /** Select the currently running process with this process ID. */
  public static applicationProcessId(processId: number): Source {
    requireProcessId(processId);
    return new Source(
      nativeCallSync(() =>
        nativeAddon().NativeSource.applicationProcessId(processId),
      ),
      SourceKind.APPLICATION,
      SourceSelectorKind.APPLICATION_PROCESS_ID,
      processId,
    );
  }

  /** Select an application using a stable identity returned by discovery. */
  public static applicationStableId(stableId: StableSourceId): Source;
  public static applicationStableId(platform: Platform, stableKey: string): Source;
  public static applicationStableId(
    stableIdOrPlatform: StableSourceId | Platform,
    stableKey?: string,
  ): Source {
    const stableId = typeof stableIdOrPlatform === 'string'
      ? stableApplicationIdentity(
          requirePlatform(stableIdOrPlatform),
          requiredText(stableKey, 'stableKey'),
        )
      : freezeStableId(stableIdOrPlatform);
    requireApplicationIdentity(stableId);
    return new Source(
      nativeCallSync(() =>
        nativeAddon().NativeSource.applicationStableId(
          stableId.platform,
          stableId.stableKey,
        ),
      ),
      SourceKind.APPLICATION,
      SourceSelectorKind.APPLICATION_STABLE_ID,
      stableId,
    );
  }

  /** Select an exact process instance plus its stable application identity. */
  public static applicationProcessInstance(
    processId: number,
    platform: Platform,
    stableKey: string,
  ): Source {
    requireProcessId(processId);
    const stableId = stableApplicationIdentity(
      requirePlatform(platform),
      requireText('stableKey', stableKey),
    );
    const selector = Object.freeze({ processId, stableId });
    return new Source(
      nativeCallSync(() =>
        nativeAddon().NativeSource.applicationProcessInstance(
          processId,
          platform,
          stableId.stableKey,
        ),
      ),
      SourceKind.APPLICATION,
      SourceSelectorKind.APPLICATION_PROCESS_INSTANCE,
      selector,
    );
  }

  /** Capture the computer's complete desktop audio mix. */
  public static systemAudio(): Source {
    return new Source(
      nativeCallSync(() => nativeAddon().NativeSource.systemAudio()),
      SourceKind.SYSTEM_MIX,
      SourceSelectorKind.SYSTEM_MIX,
    );
  }

  /** Capture the operating system's current default microphone. */
  public static defaultMicrophone(): Source {
    return Source.microphoneDefault();
  }

  /** Capture the operating system's current default microphone. */
  public static microphoneDefault(): Source {
    return new Source(
      nativeCallSync(() => nativeAddon().NativeSource.defaultMicrophone()),
      SourceKind.INPUT_DEVICE,
      SourceSelectorKind.MICROPHONE_DEFAULT,
    );
  }

  /** Capture the default microphone, or select one by its stable device identifier. */
  public static microphone(deviceId?: string): Source {
    if (deviceId === undefined) return Source.microphoneDefault();
    return Source.microphoneId(deviceId);
  }

  /** Select one microphone by its stable device identifier. */
  public static microphoneId(deviceId: string): Source {
    const selectedDeviceId = requireText('microphone device ID', deviceId);
    return new Source(
      nativeCallSync(() => nativeAddon().NativeSource.microphoneId(selectedDeviceId)),
      SourceKind.INPUT_DEVICE,
      SourceSelectorKind.MICROPHONE_ID,
      selectedDeviceId,
    );
  }

  /** Choose the strongest supported Session selection for a discovery result. */
  public static fromDiscovered(source: DiscoveredSource): Source {
    if (typeof source !== 'object' || source === null) {
      throw invalidSelector('source must be a PocketStation DiscoveredSource');
    }
    const stableId = freezeStableId(source.stableId);
    switch (stableId.kind) {
      case 'application':
        return source.processId === undefined
          ? Source.application(stableId)
          : Source.application({
              processId: source.processId,
              stableId,
            });
      case 'input-device':
        return Source.microphone(source.deviceUid ?? stableId.stableKey);
      case 'system-mix':
        return Source.systemAudio();
      case 'output-device':
        throw new PocketStationError(
          'source.unsupported_session_kind',
          'Output devices can be discovered but cannot be declared as a built-in Session Source',
        );
      default:
        throw invalidSelector('discovered source kind is not recognized');
    }
  }
}

/** One host-supplied capture permission change. */
export interface CapturePermissionTransition {
  /** Whether permission changed or was revoked after previously being allowed. */
  readonly kind: CapturePermissionTransitionKind;
  /** Previous host observation. */
  readonly previous: PermissionObservation;
  /** Current host observation. */
  readonly current: PermissionObservation;
  /** Permission generation after the change. */
  readonly permissionEpoch: bigint;
}

/** Tracks authoritative permission observations for one source lifetime. */
export class CapturePermissionLifecycle {
  readonly #native: NativeCapturePermissionLifecycleHandle;

  public constructor(current: PermissionObservation) {
    requirePermissionObservation(current);
    this.#native = nativeCallSync(
      () => new (nativeAddon().NativeCapturePermissionLifecycle)(current),
    );
  }

  /** Most recent host observation. */
  public get current(): PermissionObservation {
    return this.#native.current as PermissionObservation;
  }

  /** Current permission generation. */
  public get permissionEpoch(): bigint {
    return BigInt(this.#native.permissionEpoch);
  }

  /** Record a new platform observation; unchanged values return `undefined`. */
  public observe(
    current: PermissionObservation,
  ): CapturePermissionTransition | undefined {
    requirePermissionObservation(current);
    const transition = nativeCallSync(() => this.#native.observe(current));
    return transition == null
      ? undefined
      : Object.freeze({
          kind: transition.kind as CapturePermissionTransition['kind'],
          previous: transition.previous as PermissionObservation,
          current: transition.current as PermissionObservation,
          permissionEpoch: BigInt(transition.permissionEpoch),
        });
  }
}

/** Discover applications, microphones, output devices, and the system mix. */
export async function discoverSources(
  query: SourceQuery | SourceQueryInput = SourceQuery.any(),
): Promise<readonly DiscoveredSource[]> {
  const [queryKind, value] = nativeQuery(query);
  const sources = await nativeCall(() => nativeAddon().discoverSources(queryKind, value));
  return Object.freeze(sources.map((source) => new DiscoveredSource(source)));
}

/** Check whether application capture is available without opening a source. */
export function applicationCaptureAvailable(): boolean {
  return nativeCallSync(() => nativeAddon().applicationCaptureAvailable());
}

/** Read microphone permission state without prompting the user. */
export async function microphonePermissionObservation(): Promise<PermissionObservation> {
  return (await nativeCall(() =>
    nativeAddon().microphonePermissionObservation()
  )) as PermissionObservation;
}

/** @internal */
export function nativeSource(source: Source): NativeSourceHandle {
  const handle = handles.get(source);
  if (handle === undefined) {
    throw new TypeError('source must be a PocketStation Source');
  }
  return handle;
}

function authorizationFromNative(
  native: NativeCaptureAuthorizationSnapshot,
): CaptureAuthorizationSnapshot {
  return Object.freeze({
    capability: native.capability as CaptureCapabilityState,
    osPermission: native.osPermission as PermissionObservation,
    applicationPolicy: native.applicationPolicy as ApplicationPolicyObservation,
    sessionGrant: native.sessionGrant as CaptureSessionGrant,
    captureScope: native.captureScope as CaptureScopeKind,
    scopeStableId: native.scopeStableId ?? undefined,
    identityStrength: native.identityStrength as SourceIdentityStrength,
    permissionEpoch: BigInt(native.permissionEpoch),
    observedAtNs: BigInt(native.observedAtNs),
    openOutcome: native.openOutcome as CaptureOpenOutcome,
  });
}

function nativeQuery(query: SourceQuery | SourceQueryInput): [string, string | undefined] {
  const value = query instanceof SourceQuery ? queryValues.get(query) : query;
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    throw invalidSelector('query must be a PocketStation SourceQuery or query input');
  }
  switch (value.type) {
    case 'all':
      return ['any', undefined];
    case 'application':
      return ['application', requireText('application query', value.name)];
    case 'kind':
      return ['kind', requireSourceKind(value.kind)];
    case 'stable-key':
      return ['stable-key', requireText('stable source key', value.stableKey)];
    case 'playing':
      return ['playing', undefined];
    default:
      throw invalidSelector('source query type is not recognized');
  }
}

function requireApplicationIdentity(stableId: StableSourceId): void {
  if (stableId.kind !== 'application') {
    throw invalidSelector('stableId must identify an application');
  }
}

function freezeStableId(stableId: unknown): StableSourceId {
  if (typeof stableId !== 'object' || stableId === null || Array.isArray(stableId)) {
    throw invalidSelector('stableId must be a stable source identity');
  }
  const candidate = stableId as Partial<StableSourceId>;
  const platform = requireKnownPlatform(candidate.platform);
  const kind = requireSourceKind(candidate.kind as SourceKind);
  const stableKey = requireText('stableKey', candidate.stableKey as string);
  if (
    candidate.sourceId !== undefined &&
    (
      typeof candidate.sourceId !== 'bigint' ||
      candidate.sourceId < 1n ||
      candidate.sourceId > MAX_UNSIGNED_64
    )
  ) {
    throw invalidSelector('stableId sourceId must be a positive unsigned 64-bit bigint');
  }
  const exact = Object.freeze({
    platform,
    kind,
    stableKey,
    ...(candidate.sourceId === undefined ? {} : { sourceId: candidate.sourceId }),
  });
  return exact;
}

function stableApplicationIdentity(platform: Platform, stableKey: string): StableSourceId {
  return Object.freeze({
    platform: requirePlatform(platform),
    kind: SourceKind.APPLICATION,
    stableKey: requireText('stableKey', stableKey),
  });
}

function requirePlatform(value: unknown): Platform {
  if (typeof value !== 'string') {
    throw invalidSelector('platform must be a Platform value or platform name');
  }
  return value as Platform;
}

function requireKnownPlatform(value: unknown): Platform {
  const platform = requirePlatform(value);
  if (!Object.values(Platform).includes(platform)) {
    throw invalidSelector('platform is not recognized');
  }
  return platform;
}

function requiredText(value: string | undefined, label: string): string {
  if (value === undefined) throw invalidSelector(`${label} is required`);
  return requireText(label, value);
}

function requireText(label: string, value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidSelector(`${label} cannot be empty`);
  }
  return value;
}

function requireProcessId(value: number): void {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 0xffff_ffff
  ) {
    throw invalidSelector(
      'application process identifier must be an integer from 1 through 4294967295',
    );
  }
}

function requireSourceKind(value: SourceKind): SourceKind {
  if (!Object.values(SourceKind).includes(value)) {
    throw invalidSelector('source kind is not recognized');
  }
  return value;
}

function invalidSelector(message: string): SessionDeclarationError {
  return new SessionDeclarationError('session.invalid_selector', message);
}

function requirePermissionObservation(value: PermissionObservation): void {
  if (!Object.values(PermissionObservation).includes(value)) {
    throw new CaptureError(
      'capture.invalid_permission_observation',
      'permission observation is not recognized',
    );
  }
}

function optionalPermissionObservation(
  value: PermissionObservation | undefined,
): void {
  if (value !== undefined) requirePermissionObservation(value);
}

function optionalApplicationPolicy(
  value: ApplicationPolicyObservation | undefined,
): void {
  if (
    value !== undefined &&
    !Object.values(ApplicationPolicyObservation).includes(value)
  ) {
    throw new CaptureError(
      'capture.invalid_application_policy',
      'application policy observation is not recognized',
    );
  }
}

function optionalSessionGrant(value: CaptureSessionGrant | undefined): void {
  if (value !== undefined && !Object.values(CaptureSessionGrant).includes(value)) {
    throw new CaptureError(
      'capture.invalid_session_grant',
      'capture Session grant is not recognized',
    );
  }
}

const MAX_UNSIGNED_64 = (1n << 64n) - 1n;

function optionalPermissionEpoch(value: bigint | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'bigint' || value < 0n || value > MAX_UNSIGNED_64) {
    throw new CaptureError(
      'capture.invalid_integer',
      'permissionEpoch must be an unsigned 64-bit integer',
    );
  }
  if (value === 0n) {
    throw new CaptureError(
      'capture.invalid_permission_epoch',
      'permissionEpoch must be greater than zero',
    );
  }
  return value.toString();
}
