import { jest } from '@jest/globals';
import {
  CapturePermissionLifecycle,
  DiscoveredSource,
  Source,
  applicationCaptureAvailable,
  discoverSources,
  microphonePermissionObservation,
  type PermissionObservation,
} from '../node/index.js';
import { CaptureError } from '../node/errors.js';

describe('native Source lifecycle', () => {
  it('constructs every built-in application and microphone selection', () => {
    expect(() => Source.application('Zoom')).not.toThrow();
    expect(() => Source.applicationName('Zoom')).not.toThrow();
    expect(() => Source.applicationId('us.zoom.xos')).not.toThrow();
    expect(() => Source.application(42)).not.toThrow();
    expect(() =>
      Source.application({
        platform: 'linux',
        kind: 'application',
        stableKey: 'pw-app:42',
      }),
    ).not.toThrow();
    expect(() =>
      Source.application({
        processId: 42,
        stableId: {
          platform: 'windows',
          kind: 'application',
          stableKey: 'wasapi:pid:42:fixture',
        },
      }),
    ).not.toThrow();
    expect(() => Source.systemAudio()).not.toThrow();
    expect(() => Source.defaultMicrophone()).not.toThrow();
    expect(() => Source.microphone()).not.toThrow();
    expect(() => Source.microphone('device-1')).not.toThrow();
  });

  it('rejects empty, zero, and mismatched application selections', () => {
    expect(() => Source.application(' ')).toThrow('cannot be empty');
    expect(() => Source.application(0)).toThrow('integer from 1 through 4294967295');
    expect(() =>
      Source.application({
        platform: 'macos',
        kind: 'input-device',
        stableKey: 'mic',
      }),
    ).toThrow('must identify an application');
  });

  it('tracks permission changes without inventing a transition', () => {
    const lifecycle = new CapturePermissionLifecycle('allowed');
    expect(lifecycle.current).toBe('allowed');
    expect(lifecycle.permissionEpoch).toBe(1n);
    expect(lifecycle.observe('allowed')).toBeUndefined();
    expect(lifecycle.observe('denied')).toEqual({
      kind: 'permission-revoked',
      previous: 'allowed',
      current: 'denied',
      permissionEpoch: 2n,
    });
    const restored = lifecycle.observe('allowed');
    expect(restored).toEqual({
      kind: 'permission-changed',
      previous: 'denied',
      current: 'allowed',
      permissionEpoch: 3n,
    });
    expect(Object.isFrozen(restored)).toBe(true);
  });

  it('discovers native sources and preserves exact pre-open evidence', async () => {
    const sources = await discoverSources();
    expect(applicationCaptureAvailable()).toBe(true);
    expect(sources.length).toBeGreaterThan(0);
    const system = sources.find((source) => source.stableId.kind === 'system-mix');
    expect(system).toBeDefined();
    expect(system?.stableId.sourceId).toBeGreaterThan(0n);
    const authorization = system?.authorizationBeforeOpen({
        osPermission: 'not-applicable',
        applicationPolicy: 'not-applicable',
        sessionGrant: 'granted-by-explicit-selection',
        permissionEpoch: 7n,
      });
    expect(authorization).toMatchObject({
      captureScope: 'system-mix',
      osPermission: 'not-applicable',
      permissionEpoch: 7n,
      openOutcome: 'not-attempted',
    });
    expect(Object.isFrozen(authorization)).toBe(true);
  });

  it('filters discovery with typed queries', async () => {
    const microphones = await discoverSources({
      type: 'kind',
      kind: 'input-device',
    });
    expect(microphones.every((source) => source.stableId.kind === 'input-device')).toBe(true);
  });

  it('keeps every supported permission observation distinct', async () => {
    const observation: PermissionObservation = await microphonePermissionObservation();
    expect([
      'allowed',
      'denied',
      'restricted',
      'not-determined',
      'revoked',
      'not-observable',
      'not-applicable',
    ]).toContain(observation);
  });

  it.each([
    ['permission observation', { osPermission: 'unknown' }, 'capture.invalid_permission_observation'],
    ['application policy', { applicationPolicy: 'unknown' }, 'capture.invalid_application_policy'],
    ['Session grant', { sessionGrant: 'unknown' }, 'capture.invalid_session_grant'],
  ])('rejects an invalid %s before native authorization', (_label, options, code) => {
    const { source, authorize } = authorizationFixture();
    const operation = () => source.authorizationBeforeOpen(options as never);

    expect(operation).toThrow(CaptureError);
    expectCaptureCode(operation, code);
    expect(authorize).not.toHaveBeenCalled();
  });

  it('preserves the authorization defaults and nanosecond/integer units', () => {
    const { source, authorize } = authorizationFixture();
    const snapshot = source.authorizationBeforeOpen();

    expect(snapshot).toMatchObject({
      osPermission: 'not-observable',
      applicationPolicy: 'not-observable',
      sessionGrant: 'not-evaluated',
      permissionEpoch: 1n,
      observedAtNs: 1n,
      openOutcome: 'not-attempted',
    });
    expect(typeof snapshot.permissionEpoch).toBe('bigint');
    expect(typeof snapshot.observedAtNs).toBe('bigint');
    expect(authorize).toHaveBeenCalledWith({
      osPermission: undefined,
      applicationPolicy: undefined,
      sessionGrant: undefined,
      permissionEpoch: undefined,
    });
  });

  it.each([null, true, [], 'invalid'])(
    'rejects malformed authorization options %p without leaking a JavaScript runtime error',
    (options) => {
      const { source, authorize } = authorizationFixture();
      const operation = () => source.authorizationBeforeOpen(options as never);

      expectCaptureCode(operation, 'capture.invalid_authorization_options');
      expect(authorize).not.toHaveBeenCalled();
    },
  );

  it.each([-1n, 1n << 64n, true, 1])(
    'rejects invalid permission epoch %p with the shared integer code',
    (permissionEpoch) => {
      const { source, authorize } = authorizationFixture();
      const operation = () =>
        source.authorizationBeforeOpen({ permissionEpoch } as never);

      expectCaptureCode(operation, 'capture.invalid_integer');
      expect(authorize).not.toHaveBeenCalled();
    },
  );

  it('preserves the Core error for permission epoch zero', () => {
    const { source, authorize } = authorizationFixture();
    expectCaptureCode(
      () => source.authorizationBeforeOpen({ permissionEpoch: 0n }),
      'capture.invalid_permission_epoch',
    );
    expect(authorize).not.toHaveBeenCalled();
  });

  it.each([1n, (1n << 64n) - 1n])(
    'accepts positive unsigned 64-bit permission epoch boundary %p',
    (permissionEpoch) => {
      const { source, authorize } = authorizationFixture();
      const snapshot = source.authorizationBeforeOpen({ permissionEpoch });

      expect(snapshot.permissionEpoch).toBe(permissionEpoch);
      expect(authorize).toHaveBeenCalledWith({
        osPermission: undefined,
        applicationPolicy: undefined,
        sessionGrant: undefined,
        permissionEpoch: permissionEpoch.toString(),
      });
    },
  );

  it('uses the same typed permission error for lifecycle construction and updates', () => {
    expectCaptureCode(
      () => new CapturePermissionLifecycle('unknown' as never),
      'capture.invalid_permission_observation',
    );

    const lifecycle = new CapturePermissionLifecycle('allowed');
    expectCaptureCode(
      () => lifecycle.observe('unknown' as never),
      'capture.invalid_permission_observation',
    );
  });
});

function authorizationFixture(): {
  source: DiscoveredSource;
  authorize: jest.Mock;
} {
  const authorize = jest.fn((options: { permissionEpoch?: string }) => ({
    capability: 'available',
    osPermission: 'not-observable',
    applicationPolicy: 'not-observable',
    sessionGrant: 'not-evaluated',
    captureScope: 'exact-application',
    scopeStableId: 'fixture:application',
    identityStrength: 'platform-stable-id',
    permissionEpoch: options.permissionEpoch ?? '1',
    observedAtNs: '1',
    openOutcome: 'not-attempted',
  }));
  const source = new DiscoveredSource({
    platform: 'macos',
    kind: 'application',
    stableKey: 'fixture:application',
    sourceId: '1',
    name: 'Fixture',
    processId: 1,
    applicationId: 'io.pocketstation.fixture',
    deviceUid: null,
    state: 'available',
    sampleRateHz: 48_000,
    channelCount: 2,
    identityStrength: 'platform-stable-id',
    selectorPersistenceScope: 'application-identity',
    processTreeScope: 'application-identity',
    authorizationBeforeOpen: authorize,
  });
  return { source, authorize };
}

function expectCaptureCode(operation: () => unknown, code: string): void {
  let captured: unknown;
  try {
    operation();
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(CaptureError);
  expect(captured).toMatchObject({ code });
}
