import {
  CapturePermissionLifecycle,
  Source,
  applicationCaptureAvailable,
  discoverSources,
  microphonePermissionObservation,
  type PermissionObservation,
} from '../node/index.js';

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
    expect(() => Source.application(0)).toThrow(RangeError);
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
  });

  it('discovers native sources and preserves exact pre-open evidence', async () => {
    const sources = await discoverSources();
    expect(applicationCaptureAvailable()).toBe(true);
    expect(sources.length).toBeGreaterThan(0);
    const system = sources.find((source) => source.stableId.kind === 'system-mix');
    expect(system).toBeDefined();
    expect(system?.stableId.sourceId).toBeGreaterThan(0n);
    expect(
      system?.authorizationBeforeOpen({
        osPermission: 'not-applicable',
        applicationPolicy: 'not-applicable',
        sessionGrant: 'granted-by-explicit-selection',
        permissionEpoch: 7n,
      }),
    ).toMatchObject({
      captureScope: 'system-mix',
      osPermission: 'not-applicable',
      permissionEpoch: 7n,
      openOutcome: 'not-attempted',
    });
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
});
