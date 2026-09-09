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

    const application = relay.audio('application');
    const microphone = relay.audio('microphone');

    expect(relay.audio('application')).toBe(application);
    expect(microphone.id).not.toBe(application.id);
    expect(() => session.capture(Source.systemAudio()).send(application)).not.toThrow();
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
    expect(() => session.relay(connection).audio(' ')).toThrow(RangeError);
  });

  it('rejects TURN configuration before a Session starts', () => {
    const relay = Session._conformance().relay({
      ...connection,
      iceServers: [{ urls: 'turn:relay.example.com:3478' }],
    });

    expect(() => relay.audio('application')).toThrow(
      expect.objectContaining({ code: 'relay.invalid_configuration' }),
    );
  });
});
