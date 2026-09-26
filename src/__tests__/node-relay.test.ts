import { Session, Source } from '../node/index.js';

const connection = {
  url: 'http://127.0.0.1:4800',
  sessionId: 'session-001',
  sourceToken: 'source-token',
} as const;

describe('native Relay destinations', () => {
  it('shares one publisher while keeping AudioBus destinations distinct', () => {
    const session = Session._conformance();
    const relay = session.relay(connection);
    const application = session.capture(Source.systemAudio()).publish(
      relay,
      'application',
    );
    const microphone = session.capture(Source.defaultMicrophone()).publish(
      relay,
      'microphone',
    );

    expect(application.busId).toBe('application');
    expect(microphone.busId).toBe('microphone');
    expect(microphone.routeId).not.toBe(application.routeId);
  });

  it.each([
    ['url', { ...connection, url: '' }],
    ['sessionId', { ...connection, sessionId: '' }],
    ['sourceToken', { ...connection, sourceToken: '' }],
  ] as const)('rejects an empty %s before native registration', (_name, options) => {
    expect(() => new Session().relay(options)).toThrow(RangeError);
  });

  it('rejects empty bus names and invalid startup deadlines', () => {
    const session = Session._conformance();
    expect(() => session.relay({ ...connection, startupTimeoutMs: 0 })).toThrow(
      RangeError,
    );
    const relay = session.relay(connection);
    expect(() => session.capture(Source.systemAudio()).publish(relay, ' ')).toThrow(
      RangeError,
    );
  });

  it('rejects TURN configuration before a Session starts', () => {
    const session = Session._conformance();
    const relay = session.relay({
      ...connection,
      iceServers: [{ urls: 'turn:relay.example.com:3478' }],
    });

    expect(() => session.capture(Source.systemAudio()).publish(
      relay,
      'application',
    )).toThrow(
      expect.objectContaining({ code: 'relay.invalid_configuration' }),
    );
  });

  it('refuses to start a declared Relay publisher with no published AudioBus', async () => {
    const session = Session._conformance();
    session.relay(connection);

    await expect(session.start()).rejects.toMatchObject({
      code: 'session.declaration_invalid',
    });
  });

  it('permits one Relay publisher with multiple named AudioBuses', () => {
    const session = Session._conformance();
    session.relay(connection);

    expect(() => session.relay({
      ...connection,
      sessionId: 'another-session',
    })).toThrow(expect.objectContaining({ code: 'session.invalid_endpoint' }));
  });
});
