import { Capture, Session, capture } from '../node/index.js';

describe('concise capture workflow', () => {
  test('uses the canonical Session and leaves the microphone closed by default', () => {
    const live = new Capture({ application: 'PocketStation Test Source' });

    expect(live).toBeInstanceOf(Capture);
    expect(live.session).toBeInstanceOf(Session);
    expect(live.microphone).toBeUndefined();
    expect(live.stems).toEqual([live.application]);
    expect(Object.isFrozen(live.stems)).toBe(true);
    expect(live.applicationRouteId).toEqual(expect.any(BigInt));
    expect(live.microphoneRouteId).toBeUndefined();
  });

  test('adds a microphone and recording only when requested', () => {
    const live = new Capture({
      application: 42,
      microphone: true,
      recordTo: './recordings',
      streamAudio: false,
    });

    expect(live.microphone).toBeDefined();
    expect(live.stems).toHaveLength(2);
    expect(live.applicationRouteId).toBeUndefined();
    expect(live.microphoneRouteId).toBeUndefined();
  });

  test('reports when its concise audio stream was disabled', () => {
    const live = new Capture({
      application: 'PocketStation Test Source',
      streamAudio: false,
    });

    expect(() => live.audio).toThrow(
      'Capture audio is disabled because streamAudio is false',
    );
  });

  test('rejects an empty microphone device ID before startup', () => {
    expect(() => new Capture({ application: 'Zoom', microphone: ' ' })).toThrow(
      'microphone device ID cannot be empty',
    );
  });

  test('requires startup before reading or stopping', async () => {
    const live = new Capture({ application: 'Zoom' });

    expect(() => live.audio).toThrow('Capture has not started');
    await expect(live.stop()).rejects.toThrow('Capture has not started');
  });

  test('opens the concise function in one awaited call', async () => {
    await expect(capture('__pks_missing_application__')).rejects.toMatchObject({
      code: 'capture.backend_failed',
    });
  });
});
