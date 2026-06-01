/**
 * Unit tests for SDK types and error classes.
 * Phase scope: Phase 5.
 */
import { PocketStationError } from '../types.js';

describe('PocketStationError', () => {
  it('Given code and message When constructed Then properties are set', () => {
    const err = new PocketStationError('connection failed', 'ws_error');
    expect(err.message).toBe('connection failed');
    expect(err.code).toBe('ws_error');
    expect(err.name).toBe('PocketStationError');
  });

  it('Given PocketStationError When thrown Then instanceof Error is true', () => {
    const err = new PocketStationError('test', 'test_code');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PocketStationError);
  });
});

describe('Message types', () => {
  it('Given valid message type When used Then type assertion passes', () => {
    const msg = { type: 'PUBLISH' as const, token: 'tok', sdp_offer: 'sdp' };
    expect(msg.type).toBe('PUBLISH');
    expect(msg.token).toBe('tok');
  });

  it('Given ServerMessage shape When parsed Then fields accessible', () => {
    const raw = {
      type: 'CODEC_HINT',
      codec_hint: { bitrate_kbps: 64, complexity: 5, fec: true, dtx: false },
    };
    expect(raw.codec_hint.bitrate_kbps).toBe(64);
    expect(raw.codec_hint.fec).toBe(true);
  });
});
