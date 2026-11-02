import { PocketStationError } from '../errors.js';
import type { ReceiverAudioProfile } from './types.js';

interface SdpLine {
  readonly content: string;
  readonly ending:  string;
}

type SdpDirection = 'sendrecv' | 'recvonly' | 'sendonly' | 'inactive';

/** Apply only the receiver preference; sender hints and encoder settings stay untouched. */
export function opusReceiveOfferSdp(sdp: string, profile: ReceiverAudioProfile): string {
  if (profile === 'default') return sdp;
  const lines: SdpLine[] = [];
  for (const match of sdp.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)) {
    if (match[0] !== '') lines.push({ content: match[1], ending: match[2] });
  }
  const starts = lines.flatMap((line, index) => line.content.startsWith('m=') ? [index] : []);
  const sessionDirection = direction(lines.slice(0, starts[0] ?? lines.length), 'sendrecv');
  const sections = starts.map((startIndex, index) => ({
    startIndex,
    endIndex: starts[index + 1] ?? lines.length,
  })).filter(({ startIndex, endIndex }) => {
    const fields = lines[startIndex].content.trim().split(/\s+/);
    const port = Number(fields[1]?.split('/')[0]);
    if (fields[0] !== 'm=audio' || !Number.isInteger(port) || port <= 0) return false;
    const value = direction(lines.slice(startIndex, endIndex), sessionDirection);
    return value === 'recvonly' || value === 'sendrecv';
  });
  if (sections.length !== 1) throw unavailable();
  const { startIndex, endIndex } = sections[0];
  const offeredPayloads = new Set(lines[startIndex].content.trim().split(/\s+/).slice(3));
  const opus = new Map<string, number>();
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const match = /^a=rtpmap:(\d+)[ \t]+opus\/48000\/2[ \t]*$/i.exec(lines[index].content);
    if (match !== null && offeredPayloads.has(match[1])) opus.set(match[1], index);
  }
  if (opus.size === 0) throw unavailable();
  const replacements = new Map<number, string>();
  const insertions = new Map<number, string>();
  for (const [payload, mapIndex] of opus) {
    const fmtp = [];
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const match = /^(a=fmtp:(\d+)[ \t]*)(.*)$/i.exec(lines[index].content);
      if (match !== null && match[2] === payload) fmtp.push({ index, prefix: match[1], parameters: match[3] });
    }
    if (fmtp.length > 1) throw unavailable();
    if (fmtp.length === 1) {
      const value = fmtp[0];
      const separator = /[ \t]$/.test(value.prefix) ? '' : ' ';
      replacements.set(value.index, value.prefix + separator + stereoParameter(value.parameters));
    } else {
      insertions.set(mapIndex, `a=fmtp:${payload} stereo=1`);
    }
  }
  const ending = lines.find((line) => line.ending !== '')?.ending ?? '\r\n';
  return lines.map((line, index) => {
    const content = replacements.get(index) ?? line.content;
    const insertion = insertions.get(index);
    if (insertion === undefined) return content + line.ending;
    return content + (line.ending || ending) + insertion + line.ending;
  }).join('');
}

function direction(lines: readonly SdpLine[], fallback: SdpDirection): SdpDirection {
  let value = fallback;
  let declared: SdpDirection | null = null;
  for (const line of lines) {
    const match = /^a=(sendrecv|recvonly|sendonly|inactive)[ \t]*$/.exec(line.content);
    if (match === null) continue;
    const next = match[1] as SdpDirection;
    if (declared !== null && declared !== next) throw unavailable();
    declared = next;
    value = next;
  }
  return value;
}

function stereoParameter(parameters: string): string {
  const retained: string[] = [];
  let found = false;
  for (const parameter of parameters.split(';')) {
    if (parameter.split('=', 1)[0].trim().toLowerCase() !== 'stereo') {
      retained.push(parameter);
      continue;
    }
    if (found) continue;
    found = true;
    retained.push(/^\s*stereo\s*=\s*1\s*$/i.test(parameter)
      ? parameter
      : parameter.replace(/^(\s*stereo\s*)(?:=.*)?$/i, '$1=1'));
  }
  if (!found) {
    if (parameters.trim() === '') return 'stereo=1';
    retained.push('stereo=1');
  }
  return retained.join(';');
}

function unavailable(): PocketStationError {
  return new PocketStationError(
    'relay.stereo_receive_unsupported',
    'Stereo reception requires one unambiguous active receiving audio section offering Opus',
  );
}
