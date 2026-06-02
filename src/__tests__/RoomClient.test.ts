/* eslint-disable @typescript-eslint/no-explicit-any */
import { RoomClient } from '../RoomClient.js';
import { PocketStationError } from '../types.js';

const TEST_CONFIG = { apiUrl: 'http://localhost:8090', relayUrl: 'ws://localhost:8080' };

class TestableRoomClient extends RoomClient {
  async createRoom() {
    return (this as any)._createRoom();
  }
}

function mockFetch(body: unknown, ok = true, status = 201): void {
  (global as any).fetch = async () => ({
    ok,
    status,
    json: async () => body,
  });
}

afterEach(() => { (global as any).fetch = undefined; });

describe('RoomClient._createRoom (mocked fetch)', () => {
  it('Given valid api-server response When createRoom Then credentials returned', async () => {
    mockFetch({ room_id: 'room-001', source_token: 'src', listener_token: 'lst' });
    const creds = await new TestableRoomClient(TEST_CONFIG).createRoom() as any;
    expect(creds.roomId).toBe('room-001');
    expect(creds.sourceToken).toBe('src');
  });

  it('Given api-server 500 When createRoom Then throws PocketStationError', async () => {
    mockFetch({}, false, 500);
    await expect(new TestableRoomClient(TEST_CONFIG).createRoom())
      .rejects.toBeInstanceOf(PocketStationError);
  });

  it('Given ice_servers in response When createRoom Then forwarded', async () => {
    mockFetch({
      room_id: 'r', source_token: 's', listener_token: 'l',
      ice_servers: [{ urls: ['stun:x:3478'] }, { urls: ['turn:x:3478'], username: 'u', credential: 'p' }],
    });
    const creds = await new TestableRoomClient(TEST_CONFIG).createRoom() as any;
    expect(creds.iceServers).toHaveLength(2);
  });
});

describe('RoomClient properties', () => {
  it('Given new client When roomId Then null', () => {
    expect(new RoomClient(TEST_CONFIG).roomId).toBeNull();
  });
  it('Given new client When remoteStream Then null', () => {
    expect(new RoomClient(TEST_CONFIG).remoteStream).toBeNull();
  });
  it('Given new client When getStats Then null', async () => {
    expect(await new RoomClient(TEST_CONFIG).getStats()).toBeNull();
  });
});
