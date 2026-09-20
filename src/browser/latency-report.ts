import type { RelayLatencyReport } from './types.js';

/** @internal Validated wire projection for one unit-bearing latency sample. */
export interface RelayLatencyReportPayload {
  readonly session_id: string;
  readonly capture_ms: number;
  readonly encode_ms: number;
  readonly relay_rtt_ms: number;
  readonly jitter_buffer_ms: number;
  readonly decode_ms: number;
  readonly packet_loss_pct: number;
  readonly clock_drift_ppm: number;
}

/** @internal Validate before any latency values cross the signaling boundary. */
export function latencyReportPayload(
  report: RelayLatencyReport,
  sessionId: string,
): RelayLatencyReportPayload {
  const packetLossPct = finiteNonnegative(report.packetLossPct, 'packetLossPct');
  if (packetLossPct > 100) {
    throw new RangeError('packetLossPct must not exceed 100');
  }
  if (!Number.isFinite(report.clockDriftPpm)) {
    throw new RangeError('clockDriftPpm must be finite');
  }
  return Object.freeze({
    session_id: sessionId,
    capture_ms: finiteNonnegative(report.captureMs, 'captureMs'),
    encode_ms: finiteNonnegative(report.encodeMs, 'encodeMs'),
    relay_rtt_ms: finiteNonnegative(report.relayRttMs, 'relayRttMs'),
    jitter_buffer_ms: finiteNonnegative(report.jitterBufferMs, 'jitterBufferMs'),
    decode_ms: finiteNonnegative(report.decodeMs, 'decodeMs'),
    packet_loss_pct: packetLossPct,
    clock_drift_ppm: report.clockDriftPpm,
  });
}

function finiteNonnegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite nonnegative number`);
  }
  return value;
}
