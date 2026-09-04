import {
  Endpoint,
  PocketStationError,
  Session,
  Source,
} from '../node/index.js';

describe('native Node Session', () => {
  it('Given a selected application When composed Then Core assigns exact identities', () => {
    const session = new Session({ frameDurationMs: 10 });
    const application = session.capture(
      Source.application('__pks_missing_application__'),
    );
    const audio = session.audio();

    expect(session.id).toBeGreaterThan(0n);
    expect(application.id).toBeGreaterThan(0n);
    expect(audio.id).toBeGreaterThan(0n);
    expect(application.send(audio)).toBeGreaterThan(0n);
  });

  it('Given resources from different Sessions When routed Then the SDK rejects them', () => {
    const first = new Session();
    const second = new Session();
    const application = first.capture(Source.application('Spotify'));

    expect(() => application.send(second.audio())).toThrow(
      'Stem and Endpoint belong to different Sessions',
    );
  });

  it('Given an unsupported frame duration When declared Then a coded error is raised', () => {
    let failure: unknown;
    try {
      new Session({ frameDurationMs: 15 as 10 });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(PocketStationError);
    expect((failure as PocketStationError).code).toBe(
      'session.invalid_frame_duration',
    );
  });

  it('Given an application that is not running When started Then startup fails clearly', async () => {
    const session = new Session();
    const application = session.capture(
      Source.application('__pks_missing_application__'),
    );
    application.send(session.audio());

    let failure: unknown;
    try {
      await session.start();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(PocketStationError);
    expect((failure as PocketStationError).code).toBe('session.start_failed');
  });

  it('Given a non-PocketStation Endpoint When sent Then it is rejected before native code', () => {
    const session = new Session();
    const application = session.capture(Source.application('Spotify'));

    expect(() => application.send({} as Endpoint)).toThrow(TypeError);
  });

  it('Exposes errors through the public Node entry point', () => {
    const failure = new PocketStationError('test.code', 'test message');
    expect(failure).toBeInstanceOf(Error);
    expect(failure.code).toBe('test.code');
  });
});
