import {
  Endpoint,
  PocketStationError,
  RunningSession,
  Session,
  Source,
} from '../node/index.js';
import type {
  NativeRunningSessionHandle,
  NativeStopResult,
} from '../node/native.js';

const STOP_RESULT: NativeStopResult = {
  success: true,
  alreadyStopped: false,
  disposition: 'stopped',
  sessionState: 'stopped',
  runtimeWorkerPanicked: false,
  captureFinalizationFailuresTotal: '0',
  operatorFinalizationFailuresTotal: '0',
  endpointFinalizationFailuresTotal: '0',
  runtimeFailuresTotal: '0',
  lineageFailuresTotal: '0',
  sourceSendRejectionsTotal: '0',
  runtimeEventsTotal: '0',
  sidecarOutcomes: [],
  remainingEvents: [],
};

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
    expect((failure as PocketStationError).code).toBe('capture.backend_failed');
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

  it('Given successful Session work When run Then accepted work is drained', async () => {
    const session = Session._conformance();
    const input = session.audioInput('test input');
    input.output.send(session.audio());
    let active: RunningSession | undefined;

    const result = await session.run(async (running) => {
      active = running;
      expect(running.sessionId).toBe(session.id);
      expect(await running.state()).toBe('running');
      expect(await running.isStopped()).toBe(false);
      await running.metrics();
      input.close();
    });

    expect(result.disposition).toBe('stopped');
    expect(result.success).toBe(true);
    expect(active?.stopResult).toBe(result);
    await expect(active?.isStopped()).resolves.toBe(true);
  });

  it('Provides bounded Python-equivalent Session convenience methods', async () => {
    const session = Session._conformance();
    const input = session.audioInput('compatibility input', {
      frameSamplesPerChannel: 4,
    });
    input.output.send(session.audio());
    const running = await session.start();

    input.tryWrite(new Float32Array([0.1, 0.2, 0.3, 0.4]));
    input.close();
    const frame = await running.waitAudio({ timeoutMs: 1_000 });

    expect(frame?.length).toBe(1);
    await expect(running.pollAudio()).resolves.toBeUndefined();
    await expect(running.pollEvent()).resolves.toBeDefined();
    await running.close();
    expect(running.stopResult?.success).toBe(true);
  });

  it('Given failed Session work When run Then the Session is cancelled before rethrow', async () => {
    const session = Session._conformance();
    const input = session.audioInput('test input');
    input.output.send(session.audio());
    const failure = new Error('application failed');
    let runningSession: Awaited<ReturnType<Session['start']>> | undefined;

    await expect(
      session.run((running) => {
        runningSession = running;
        throw failure;
      }),
    ).rejects.toBe(failure);

    await expect(runningSession?.stop()).resolves.toMatchObject({
      disposition: 'cancelled',
    });
  });

  it('Given a temporary native shutdown refusal When retried Then the Session can still stop', async () => {
    let attempts = 0;
    const native = {
      sessionId: '1',
      readAudio: async () => ({ frames: [], sessionState: 'running' }),
      monotonicTimestampNs: () => '0',
      readEvent: async () => ({ sessionState: 'running' }),
      lifecycleState: async () => 'running',
      stop: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('native Session command queue is full; retry shutdown');
        }
        return STOP_RESULT;
      },
      cancel: async () => STOP_RESULT,
    } as NativeRunningSessionHandle;
    const running = RunningSession._create(native);

    await expect(running.stop()).rejects.toThrow('retry shutdown');
    await expect(running.stop()).resolves.toMatchObject({
      disposition: 'stopped',
    });
    expect(attempts).toBe(2);
  });
});
