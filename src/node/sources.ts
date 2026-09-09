import { PocketStationError, nativeCall, nativeCallSync } from './errors.js';
import {
  nativeAddon,
  type NativeCaptureAuthorizationSnapshot,
  type NativeCapturePermissionLifecycleHandle,
  type NativeDiscoveredSourceHandle,
  type NativeSourceHandle,
} from './native.js';

/** Operating system that produced a discovered source identity. */
export type Platform =
  | 'macos'
  | 'windows'
  | 'linux'
  | 'ios'
  | 'android'
  | 'web'
  | 'unknown';

/** Native source category reported by discovery. */
export type SourceKind =
  | 'application'
  | 'output-device'
  | 'input-device'
  | 'system-mix';

/** State observed during the discovery snapshot. */
export type SourceState =
  | 'available'
  | 'playing'
  | 'silent'
  | 'unavailable'
  | 'permission-blocked';

/** Native evidence used to distinguish a discovered source. */
export type SourceIdentityStrength =
  | 'application-id-and-process-id'
  | 'stable-application-id'
  | 'process-id'
  | 'stable-device-uid'
  | 'platform-stable-id';

/** How long a discovered selector may be reused without rediscovery. */
export type SelectorPersistenceScope =
  | 'process-lifetime'
  | 'application-identity'
  | 'device-identity'
  | 'session-default-device'
  | 'platform-identity';

/** Processes included by an application selection on its native platform. */
export type ProcessTreeScope =
  | 'selected-process-only'
  | 'selected-process-and-descendants'
  | 'application-identity'
  | 'not-applicable';

/** Authoritative permission state, including hosts that cannot report it. */
export type PermissionObservation =
  | 'allowed'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'revoked'
  | 'not-observable'
  | 'not-applicable';

/** Host-reported application capture policy. */
export type ApplicationPolicyObservation =
  | 'allowed'
  | 'denied'
  | 'not-observable'
  | 'not-applicable';

/** Whether the host application granted this Session access to the source. */
export type CaptureSessionGrant =
  | 'granted-by-explicit-selection'
  | 'denied'
  | 'not-evaluated';

/** Whether the selected capture capability is available on this host. */
export type CaptureCapabilityState =
  | 'available'
  | 'unavailable'
  | 'unsupported';

/** Exact source scope represented by authorization evidence. */
export type CaptureScope =
  | 'exact-application'
  | 'exact-input-device'
  | 'exact-output-device'
  | 'system-mix';

/** Result of opening a source, or `not-attempted` for pre-open evidence. */
export type CaptureOpenOutcome =
  | 'not-attempted'
  | 'succeeded'
  | 'permission-denied'
  | 'source-unavailable'
  | 'backend-failed';

/** Stable source identity returned by native discovery. */
export interface StableSourceId {
  /** Platform that assigned this identity. */
  readonly platform: Platform;
  /** Source category. */
  readonly kind: SourceKind;
  /** Native stable key retained without re-hashing. */
  readonly stableKey: string;
  /** Immutable Core Source identity when the value came from discovery. */
  readonly sourceId?: bigint;
}

/** Exact application process and the stable identity observed for it. */
export interface ProcessInstanceSelector {
  /** Process identifier observed during discovery. */
  readonly processId: number;
  /** Stable identity observed for that exact process instance. */
  readonly stableId: StableSourceId;
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
  readonly captureScope: CaptureScope;
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
      sourceId: BigInt(native.sourceId),
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
  }

  /** Record what the host knows before it opens this exact source. */
  public authorizationBeforeOpen(
    options: AuthorizationOptions = {},
  ): CaptureAuthorizationSnapshot {
    const native = nativeCallSync(() =>
      this.#native.authorizationBeforeOpen({
        osPermission: options.osPermission,
        applicationPolicy: options.applicationPolicy,
        sessionGrant: options.sessionGrant,
        permissionEpoch: options.permissionEpoch?.toString(),
      }),
    );
    return authorizationFromNative(native);
  }
}

/** Native discovery filter. */
export type SourceQuery =
  | { readonly type: 'all' }
  | { readonly type: 'application'; readonly name: string }
  | { readonly type: 'kind'; readonly kind: SourceKind }
  | { readonly type: 'stable-key'; readonly stableKey: string }
  | { readonly type: 'playing' };

/** Supported concise selections for one running application. */
export type ApplicationSelection =
  | string
  | number
  | StableSourceId
  | ProcessInstanceSelector;

const handles = new WeakMap<Source, NativeSourceHandle>();

/** Describes audio that a Session should open when it starts. */
export class Source {
  private constructor(native: NativeSourceHandle) {
    handles.set(this, native);
  }

  /**
   * Select a running application by exact name, application ID, process ID,
   * or an identity returned by discovery.
   */
  public static application(selection: ApplicationSelection): Source {
    if (typeof selection === 'string') {
      return new Source(
        nativeCallSync(() => nativeAddon().NativeSource.application(selection)),
      );
    }
    if (typeof selection === 'number') {
      return Source.applicationProcessId(selection);
    }
    if ('processId' in selection) {
      requireApplicationIdentity(selection.stableId);
      return new Source(
        nativeCallSync(() =>
          nativeAddon().NativeSource.applicationProcessInstance(
            selection.processId,
            selection.stableId.platform,
            selection.stableId.stableKey,
          ),
        ),
      );
    }
    requireApplicationIdentity(selection);
    return Source.applicationStableId(selection);
  }

  /** Select a running application by exact display name. */
  public static applicationName(name: string): Source {
    return new Source(
      nativeCallSync(() => nativeAddon().NativeSource.applicationName(name)),
    );
  }

  /** Select a running application by its native application identifier. */
  public static applicationId(applicationId: string): Source {
    return new Source(
      nativeCallSync(() => nativeAddon().NativeSource.applicationId(applicationId)),
    );
  }

  /** Select the currently running process with this process ID. */
  public static applicationProcessId(processId: number): Source {
    requireUint32('processId', processId, false);
    return new Source(
      nativeCallSync(() =>
        nativeAddon().NativeSource.applicationProcessId(processId),
      ),
    );
  }

  /** Select an application using a stable identity returned by discovery. */
  public static applicationStableId(stableId: StableSourceId): Source {
    requireApplicationIdentity(stableId);
    return new Source(
      nativeCallSync(() =>
        nativeAddon().NativeSource.applicationStableId(
          stableId.platform,
          stableId.stableKey,
        ),
      ),
    );
  }

  /** Capture the computer's complete desktop audio mix. */
  public static systemAudio(): Source {
    return new Source(nativeCallSync(() => nativeAddon().NativeSource.systemAudio()));
  }

  /** Capture the operating system's current default microphone. */
  public static defaultMicrophone(): Source {
    return new Source(
      nativeCallSync(() => nativeAddon().NativeSource.defaultMicrophone()),
    );
  }

  /** Capture the default microphone, or select one by its stable device identifier. */
  public static microphone(deviceId?: string): Source {
    if (deviceId === undefined) return Source.defaultMicrophone();
    return new Source(
      nativeCallSync(() => nativeAddon().NativeSource.microphoneId(deviceId)),
    );
  }

  /** Choose the strongest supported Session selection for a discovery result. */
  public static fromDiscovered(source: DiscoveredSource): Source {
    switch (source.stableId.kind) {
      case 'application':
        return source.processId === undefined
          ? Source.application(source.stableId)
          : Source.application({
              processId: source.processId,
              stableId: source.stableId,
            });
      case 'input-device':
        return Source.microphone(source.deviceUid ?? source.stableId.stableKey);
      case 'system-mix':
        return Source.systemAudio();
      case 'output-device':
        throw new PocketStationError(
          'source.unsupported_session_kind',
          'Output devices can be discovered but cannot be declared as a built-in Session Source',
        );
    }
  }
}

/** One host-supplied capture permission change. */
export interface CapturePermissionTransition {
  /** Whether permission changed or was revoked after previously being allowed. */
  readonly kind: 'permission-changed' | 'permission-revoked';
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
    const transition = nativeCallSync(() => this.#native.observe(current));
    return transition == null
      ? undefined
      : {
          kind: transition.kind as CapturePermissionTransition['kind'],
          previous: transition.previous as PermissionObservation,
          current: transition.current as PermissionObservation,
          permissionEpoch: BigInt(transition.permissionEpoch),
        };
  }
}

/** Discover applications, microphones, output devices, and the system mix. */
export async function discoverSources(
  query: SourceQuery = { type: 'all' },
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
  return {
    capability: native.capability as CaptureCapabilityState,
    osPermission: native.osPermission as PermissionObservation,
    applicationPolicy: native.applicationPolicy as ApplicationPolicyObservation,
    sessionGrant: native.sessionGrant as CaptureSessionGrant,
    captureScope: native.captureScope as CaptureScope,
    scopeStableId: native.scopeStableId ?? undefined,
    identityStrength: native.identityStrength as SourceIdentityStrength,
    permissionEpoch: BigInt(native.permissionEpoch),
    observedAtNs: BigInt(native.observedAtNs),
    openOutcome: native.openOutcome as CaptureOpenOutcome,
  };
}

function nativeQuery(query: SourceQuery): [string, string | undefined] {
  switch (query.type) {
    case 'all':
      return ['any', undefined];
    case 'application':
      return ['application', requireText('application query', query.name)];
    case 'kind':
      return ['kind', query.kind];
    case 'stable-key':
      return ['stable-key', requireText('stable source key', query.stableKey)];
    case 'playing':
      return ['playing', undefined];
  }
}

function requireApplicationIdentity(stableId: StableSourceId): void {
  if (stableId.kind !== 'application') {
    throw new TypeError('stableId must identify an application');
  }
  requireText('application stable identifier', stableId.stableKey);
}

function requireText(label: string, value: string): string {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} cannot be empty`);
  }
  return value;
}

function requireUint32(label: string, value: number, allowZero: boolean): void {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(value) || value < minimum || value > 0xffff_ffff) {
    throw new RangeError(`${label} must be an integer from ${minimum} through 4294967295`);
  }
}
