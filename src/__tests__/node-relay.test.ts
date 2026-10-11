import { relayWebsocketAvailable, Session, Source } from '../node/index.js';
import { nativeAddon } from '../node/native.js';

const connection = {
  url: 'http://127.0.0.1:4800',
  sessionId: 'session-001',
  sourceToken: 'source-token',
} as const;

describe('native Relay destinations', () => {
  it('reports the expected qualified build capability', () => {
    expect(relayWebsocketAvailable()).toBe(true);
  });

  it.each([null, 7, {}, 'unknown-private-mode'])('rejects invalid transport before consuming the publisher declaration: %p', (transport) => {
    const session = new Session();
    expect(() => session.relay({ ...connection, transport } as never)).toThrow(
      expect.objectContaining({ code: 'relay.invalid_transport' }),
    );
    expect(() => session.relay(connection)).not.toThrow();
  });

  it('refuses WebSocket when an older addon lacks the availability export', () => {
    const addon = nativeAddon();
    const descriptor = Object.getOwnPropertyDescriptor(addon, 'relayWebsocketAvailable');
    Object.defineProperty(addon, 'relayWebsocketAvailable', { configurable: true, value: undefined });
    try {
      const session = new Session();
      expect(relayWebsocketAvailable()).toBe(false);
      expect(() => session.relay({ ...connection, transport: 'websocket' })).toThrow(
        expect.objectContaining({ code: 'relay.transport_unavailable' }),
      );
      expect(() => session.relay(connection)).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(addon, 'relayWebsocketAvailable', descriptor);
      else Reflect.deleteProperty(addon, 'relayWebsocketAvailable');
    }
  });

  it('uses WebSocket only when the installed native capability permits both buses', () => {
    const session = new Session();
    if (!relayWebsocketAvailable()) {
      expect(() => session.relay({ ...connection, transport: 'websocket' })).toThrow(
        expect.objectContaining({ code: 'relay.transport_unavailable' }),
      );
      return;
    }
    const relay = session.relay({ ...connection, transport: 'websocket', iceServers: [{ urls: 'turn:unused.example:3478' }] });
    const application = session.audioInput('application PCM').output.publish(relay, 'application');
    const microphone = session.audioInput('microphone PCM').output.publish(relay, 'microphone');
    expect(application.busId).toBe('application');
    expect(microphone.busId).toBe('microphone');
    expect(application.routeId).not.toBe(microphone.routeId);
  });
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
