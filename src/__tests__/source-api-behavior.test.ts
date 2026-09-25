import {
  ApplicationPolicyObservation,
  CaptureCapabilityState,
  CaptureOpenOutcome,
  CapturePermissionTransitionKind,
  CaptureScopeKind,
  CaptureSessionGrant,
  PermissionObservation,
  Platform,
  ProcessTreeScope,
  SelectorPersistenceScope,
  Source,
  SourceFailureClass,
  SourceIdentityStrength,
  SourceKind,
  SourceQuery,
  SourceRecoveryRequirement,
  SourceRuntimeEventKind,
  SourceSelectorKind,
  SourceState,
  discoverSources,
  type DiscoveredSource,
} from '../node/index.js';
import { SessionDeclarationError } from '../node/errors.js';

describe('Source API behavior parity', () => {
  it('exports immutable runtime values for every Python source enum', () => {
    expect(Platform).toEqual({
      MACOS: 'macos',
      WINDOWS: 'windows',
      LINUX: 'linux',
      IOS: 'ios',
      ANDROID: 'android',
      WEB: 'web',
      UNKNOWN: 'unknown',
    });
    expect(SourceKind).toEqual({
      APPLICATION: 'application',
      OUTPUT_DEVICE: 'output-device',
      INPUT_DEVICE: 'input-device',
      SYSTEM_MIX: 'system-mix',
    });
    expect(SourceState).toEqual({
      AVAILABLE: 'available',
      PLAYING: 'playing',
      SILENT: 'silent',
      UNAVAILABLE: 'unavailable',
      PERMISSION_BLOCKED: 'permission-blocked',
    });
    expect(SourceIdentityStrength).toEqual({
      APPLICATION_ID_AND_PROCESS_ID: 'application-id-and-process-id',
      STABLE_APPLICATION_ID: 'stable-application-id',
      PROCESS_ID: 'process-id',
      STABLE_DEVICE_UID: 'stable-device-uid',
      PLATFORM_STABLE_ID: 'platform-stable-id',
    });
    expect(SelectorPersistenceScope).toEqual({
      PROCESS_LIFETIME: 'process-lifetime',
      APPLICATION_IDENTITY: 'application-identity',
      DEVICE_IDENTITY: 'device-identity',
      SESSION_DEFAULT_DEVICE: 'session-default-device',
      PLATFORM_IDENTITY: 'platform-identity',
    });
    expect(ProcessTreeScope).toEqual({
      SELECTED_PROCESS_ONLY: 'selected-process-only',
      SELECTED_PROCESS_AND_DESCENDANTS: 'selected-process-and-descendants',
      APPLICATION_IDENTITY: 'application-identity',
      NOT_APPLICABLE: 'not-applicable',
    });
    expect(PermissionObservation).toEqual({
      ALLOWED: 'allowed',
      DENIED: 'denied',
      RESTRICTED: 'restricted',
      NOT_DETERMINED: 'not-determined',
      REVOKED: 'revoked',
      NOT_OBSERVABLE: 'not-observable',
      NOT_APPLICABLE: 'not-applicable',
    });
    expect(CapturePermissionTransitionKind).toEqual({
      CHANGED: 'permission-changed',
      REVOKED: 'permission-revoked',
    });
    expect(CaptureCapabilityState).toEqual({
      AVAILABLE: 'available',
      UNAVAILABLE: 'unavailable',
      UNSUPPORTED: 'unsupported',
    });
    expect(ApplicationPolicyObservation).toEqual({
      ALLOWED: 'allowed',
      DENIED: 'denied',
      NOT_OBSERVABLE: 'not-observable',
      NOT_APPLICABLE: 'not-applicable',
    });
    expect(CaptureSessionGrant).toEqual({
      GRANTED_BY_EXPLICIT_SELECTION: 'granted-by-explicit-selection',
      DENIED: 'denied',
      NOT_EVALUATED: 'not-evaluated',
    });
    expect(CaptureScopeKind).toEqual({
      EXACT_APPLICATION: 'exact-application',
      EXACT_INPUT_DEVICE: 'exact-input-device',
      EXACT_OUTPUT_DEVICE: 'exact-output-device',
      SYSTEM_MIX: 'system-mix',
    });
    expect(CaptureOpenOutcome).toEqual({
      NOT_ATTEMPTED: 'not-attempted',
      SUCCEEDED: 'succeeded',
      PERMISSION_DENIED: 'permission-denied',
      SOURCE_UNAVAILABLE: 'source-unavailable',
      BACKEND_FAILED: 'backend-failed',
    });
    expect(SourceSelectorKind).toEqual({
      APPLICATION_NAME: 'application-name',
      APPLICATION_BUNDLE_ID: 'application-bundle-id',
      APPLICATION_PROCESS_ID: 'application-process-id',
      APPLICATION_STABLE_ID: 'application-stable-id',
      APPLICATION_PROCESS_INSTANCE: 'application-process-instance',
      MICROPHONE_DEFAULT: 'microphone-default',
      MICROPHONE_ID: 'microphone-id',
      SYSTEM_MIX: 'system-mix',
    });
    expect(SourceRuntimeEventKind).toEqual({
      SOURCE_UNAVAILABLE: 'source-unavailable',
      BACKEND_FAILURE: 'backend-failure',
    });
    expect(SourceRecoveryRequirement).toEqual({
      EXPLICIT_REDISCOVERY_AND_NEW_SESSION: 'explicit-rediscovery-and-new-session',
    });
    expect(SourceFailureClass).toEqual({
      SOURCE_INSTANCE_EXITED: 'source-instance-exited',
      PLATFORM_STATUS: 'platform-status',
      BACKEND_CLASS: 'backend-class',
    });

    for (const values of [
      Platform,
      SourceKind,
      SourceState,
      SourceIdentityStrength,
      SelectorPersistenceScope,
      ProcessTreeScope,
      PermissionObservation,
      CapturePermissionTransitionKind,
      CaptureCapabilityState,
      ApplicationPolicyObservation,
      CaptureSessionGrant,
      CaptureScopeKind,
      CaptureOpenOutcome,
      SourceSelectorKind,
      SourceRuntimeEventKind,
      SourceRecoveryRequirement,
      SourceFailureClass,
    ]) {
      expect(Object.isFrozen(values)).toBe(true);
    }
  });

  it('retains exact immutable metadata for every Python Source selector', () => {
    const declarations = [
      [
        Source.application('Zoom'),
        SourceKind.APPLICATION,
        SourceSelectorKind.APPLICATION_NAME,
        'Zoom',
      ],
      [
        Source.applicationBundleId('us.zoom.xos'),
        SourceKind.APPLICATION,
        SourceSelectorKind.APPLICATION_BUNDLE_ID,
        'us.zoom.xos',
      ],
      [
        Source.applicationProcessId(42),
        SourceKind.APPLICATION,
        SourceSelectorKind.APPLICATION_PROCESS_ID,
        42,
      ],
      [
        Source.applicationStableId(Platform.MACOS, 'bundle:us.zoom.xos'),
        SourceKind.APPLICATION,
        SourceSelectorKind.APPLICATION_STABLE_ID,
        {
          platform: Platform.MACOS,
          kind: SourceKind.APPLICATION,
          stableKey: 'bundle:us.zoom.xos',
        },
      ],
      [
        Source.applicationProcessInstance(42, Platform.WINDOWS, 'process:zoom'),
        SourceKind.APPLICATION,
        SourceSelectorKind.APPLICATION_PROCESS_INSTANCE,
        {
          processId: 42,
          stableId: {
            platform: Platform.WINDOWS,
            kind: SourceKind.APPLICATION,
            stableKey: 'process:zoom',
          },
        },
      ],
      [
        Source.systemAudio(),
        SourceKind.SYSTEM_MIX,
        SourceSelectorKind.SYSTEM_MIX,
        undefined,
      ],
      [
        Source.microphoneDefault(),
        SourceKind.INPUT_DEVICE,
        SourceSelectorKind.MICROPHONE_DEFAULT,
        undefined,
      ],
      [
        Source.microphoneId('device-1'),
        SourceKind.INPUT_DEVICE,
        SourceSelectorKind.MICROPHONE_ID,
        'device-1',
      ],
    ] as const;

    for (const [source, kind, selectorKind, selectorValue] of declarations) {
      expect(source).toMatchObject({ kind, selectorKind, selectorValue });
      expect(Object.isFrozen(source)).toBe(true);
      if (typeof selectorValue === 'object' && selectorValue !== null) {
        expect(Object.isFrozen(source.selectorValue)).toBe(true);
      }
    }

    expect(Source.applicationId('com.example.app').selectorKind).toBe(
      SourceSelectorKind.APPLICATION_BUNDLE_ID,
    );
    expect(Source.defaultMicrophone().selectorKind).toBe(
      SourceSelectorKind.MICROPHONE_DEFAULT,
    );
    expect(Source.microphone().selectorKind).toBe(SourceSelectorKind.MICROPHONE_DEFAULT);
    expect(Source.microphone('mic-2').selectorKind).toBe(SourceSelectorKind.MICROPHONE_ID);
  });

  it('provides typed immutable query factories and keeps structural queries compatible', async () => {
    const discovered = await discoverSources(SourceQuery.any());
    expect(Object.isFrozen(discovered)).toBe(true);
    expect(discovered.length).toBeGreaterThan(0);
    expect(discovered.every(Object.isFrozen)).toBe(true);
    expect(discovered.every((source) => Object.isFrozen(source.stableId))).toBe(true);

    const system = discovered.find(
      (source) => source.stableId.kind === SourceKind.SYSTEM_MIX,
    );
    expect(system).toBeDefined();
    expect(await discoverSources(SourceQuery.kind(SourceKind.SYSTEM_MIX))).toHaveLength(1);
    expect(
      await discoverSources(SourceQuery.stableKey(system?.stableId.stableKey ?? 'missing')),
    ).toHaveLength(1);
    expect(Array.isArray(await discoverSources(SourceQuery.playing()))).toBe(true);
    await expect(discoverSources(SourceQuery.application('no-such-app'))).resolves.toEqual(
      [],
    );
    expect(
      Array.isArray(
        await discoverSources({
          type: 'kind',
          kind: SourceKind.INPUT_DEVICE,
        }),
      ),
    ).toBe(true);

    expect(Object.isFrozen(SourceQuery.any())).toBe(true);
    expect(() => SourceQuery.application(' ')).toThrow('cannot be empty');
    expect(() => SourceQuery.stableKey(' ')).toThrow('cannot be empty');
  });

  it('lowers discovery results to the strongest supported Session selector', async () => {
    const discovered = await discoverSources();
    const system = discovered.find(
      (source) => source.stableId.kind === SourceKind.SYSTEM_MIX,
    );
    expect(system).toBeDefined();
    expect(Source.fromDiscovered(system as DiscoveredSource)).toMatchObject({
      kind: SourceKind.SYSTEM_MIX,
      selectorKind: SourceSelectorKind.SYSTEM_MIX,
    });

    const input = {
      stableId: {
        platform: Platform.MACOS,
        kind: SourceKind.INPUT_DEVICE,
        stableKey: 'input:fixture',
      },
      deviceUid: 'input:device-uid',
    } as unknown as DiscoveredSource;
    expect(Source.fromDiscovered(input)).toMatchObject({
      kind: SourceKind.INPUT_DEVICE,
      selectorKind: SourceSelectorKind.MICROPHONE_ID,
      selectorValue: 'input:device-uid',
    });

    const application = {
      stableId: {
        platform: Platform.WINDOWS,
        kind: SourceKind.APPLICATION,
        stableKey: 'application:fixture',
      },
      processId: 44,
    } as unknown as DiscoveredSource;
    expect(Source.fromDiscovered(application)).toMatchObject({
      kind: SourceKind.APPLICATION,
      selectorKind: SourceSelectorKind.APPLICATION_PROCESS_INSTANCE,
      selectorValue: { processId: 44 },
    });

    const output = {
      stableId: {
        platform: Platform.MACOS,
        kind: SourceKind.OUTPUT_DEVICE,
        stableKey: 'output:fixture',
      },
    } as unknown as DiscoveredSource;
    expect(() => Source.fromDiscovered(output)).toThrow(
      'Output devices can be discovered but cannot be declared',
    );
  });

  it('rejects invalid selector identities at the declaration boundary', () => {
    expect(() => Source.applicationBundleId(' ')).toThrow('cannot be empty');
    expect(() => Source.applicationProcessId(0)).toThrow(SessionDeclarationError);
    expect(() => Source.applicationProcessInstance(0, Platform.MACOS, 'app')).toThrow(
      SessionDeclarationError,
    );
    expect(() => Source.applicationStableId(Platform.MACOS, ' ')).toThrow(
      'cannot be empty',
    );
    expect(() => Source.microphoneId(' ')).toThrow('cannot be empty');
    expect(() =>
      Source.applicationStableId({
        platform: Platform.MACOS,
        kind: SourceKind.INPUT_DEVICE,
        stableKey: 'mic',
      }),
    ).toThrow('must identify an application');
  });
});
