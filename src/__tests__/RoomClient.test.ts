/**
 * RoomClient unit tests — mocked network layer.
 * Phase scope: Phase 5.
 */
import { RoomClient } from '../RoomClient.js';
import { PocketStationError } from '../types.js';

const TEST_CONFIG = {
  apiUrl: 'http://localhost:8090',
  relayUrl: 'ws://localhost:8080',
};

describe('RoomClient._createRoom (mocked fetch)', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('Given valid api-server response When createRoom Then credentials returned', async () => {
    // Given
    const mockCredentials = {
      room_id: 'room-test-001',
      source_token: 'src-tok',
      listener_token: 'lst-tok',
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue(mockCredentials),
    } as unknown as Response);

    // When — trigger _createRoom indirectly via connect() short-circuit
    // We test the room creation logic by checking the returned credentials
    const client = new RoomClient(TEST_CONFIG);
    // Expose _createRoom for testing via a subclass
    class TestableRoomClient extends RoomClient {
      async createRoom() {
        return (this as unknown as { _createRoom: () => Promise<unknown> })._createRoom();
      }
    }
    const testClient = new TestableRoomClient(TEST_CONFIG);
    const creds = await testClient.createRoom() as { roomId: string; sourceToken: string };

    // Then
    expect(creds.roomId).toBe('room-test-001');
    expect(creds.sourceToken).toBe('src-tok');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8090/v1/rooms',
      expect.objectContaining({ method: 'POST' }),
    );
    void client; // suppress unused warning
  });

  it('Given api-server 500 When createRoom Then throws PocketStationError', async () => {
    // Given
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response);

    class TestableRoomClient extends RoomClient {
      async createRoom() {
        return (this as unknown as { _createRoom: () => Promise<unknown> })._createRoom();
      }
    }
    const client = new TestableRoomClient(TEST_CONFIG);

    // When / Then
    await expect(client.createRoom()).rejects.toBeInstanceOf(PocketStationError);
  });

  it('Given api-server returns ice_servers When createRoom Then ice_servers forwarded', async () => {
    // Given
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue({
        room_id: 'room-ice',
        source_token: 'src',
        listener_token: 'lst',
        ice_servers: [
          { urls: ['stun:relay.example.com:3478'] },
          { urls: ['turn:relay.example.com:3478'], username: 'u', credential: 'p' },
        ],
      }),
    } as unknown as Response);

    class TestableRoomClient extends RoomClient {
      async createRoom() {
        return (this as unknown as { _createRoom: () => Promise<unknown> })._createRoom();
      }
    }
    const client = new TestableRoomClient(TEST_CONFIG);
    const creds = await client.createRoom() as { iceServers?: RTCIceServer[] };

    // Then
    expect(creds.iceServers).toHaveLength(2);
  });
});

describe('RoomClient properties', () => {
  it('Given new client When roomId Then returns null', () => {
    const client = new RoomClient(TEST_CONFIG);
    expect(client.roomId).toBeNull();
  });

  it('Given new client When remoteStream Then returns null', () => {
    const client = new RoomClient(TEST_CONFIG);
    expect(client.remoteStream).toBeNull();
  });

  it('Given new client When getStats Then returns null', async () => {
    const client = new RoomClient(TEST_CONFIG);
    const stats = await client.getStats();
    expect(stats).toBeNull();
  });
});
