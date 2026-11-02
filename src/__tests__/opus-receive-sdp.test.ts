import { opusReceiveOfferSdp } from '../browser/opus-receive-sdp.js';

const offer = [
  'v=0',
  'a=ice-ufrag:unchanged',
  'a=fingerprint:sha-256 unchanged',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 0',
  'a=mid:music',
  'a=recvonly',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:0 PCMU/8000',
].join('\r\n') + '\r\n';

describe('Opus receive preference', () => {
  it('given default when applying the profile then preserves every byte', () => {
    expect(opusReceiveOfferSdp(offer, 'default')).toBe(offer);
    expect(opusReceiveOfferSdp('not SDP', 'default')).toBe('not SDP');
  });

  it('given Opus when requesting stereo then changes only the receive parameter', () => {
    expect(opusReceiveOfferSdp(offer, 'music-stereo')).toBe(offer.replace(
      'minptime=10;useinbandfec=1', 'minptime=10;useinbandfec=1;stereo=1',
    ));
  });

  it('given no fmtp when requesting stereo then inserts the offered payload parameters', () => {
    const input = offer.replace('a=fmtp:111 minptime=10;useinbandfec=1\r\n', '');
    expect(opusReceiveOfferSdp(input, 'music-stereo')).toBe(input.replace(
      'a=rtpmap:111 opus/48000/2\r\n',
      'a=rtpmap:111 opus/48000/2\r\na=fmtp:111 stereo=1\r\n',
    ));
  });

  it.each(['0', '1'])('given stereo=%s when requesting stereo then upserts idempotently', (value) => {
    const input = offer.replace('minptime=10', `stereo=${value};sprop-stereo=0;usedtx=1;minptime=10`);
    const actual = opusReceiveOfferSdp(input, 'music-stereo');
    expect(actual).toBe(input.replace(`stereo=${value}`, 'stereo=1'));
    expect(opusReceiveOfferSdp(actual, 'music-stereo')).toBe(actual);
  });

  it('given duplicate mixed-case keys when requesting stereo then keeps one preference', () => {
    const input = offer.replace('minptime=10', ' StErEo = 0 ;stereo=1;minptime=10');
    const actual = opusReceiveOfferSdp(input, 'music-stereo');
    expect(actual).toContain(' StErEo =1;minptime=10;useinbandfec=1');
    expect(actual.match(/stereo\s*=/gi)).toHaveLength(1);
    expect(opusReceiveOfferSdp(actual, 'music-stereo')).toBe(actual);
  });

  it('given multiple offered Opus payloads when applying preference then updates each', () => {
    const input = offer.replace('SAVPF 111 0', 'SAVPF 111 112 0')
      + 'a=rtpmap:112 OPUS/48000/2\r\na=fmtp:112 useinbandfec=0\r\n';
    const actual = opusReceiveOfferSdp(input, 'music-stereo');
    expect(actual).toContain('a=fmtp:111 minptime=10;useinbandfec=1;stereo=1\r\n');
    expect(actual).toContain('a=fmtp:112 useinbandfec=0;stereo=1\r\n');
    expect(actual).toContain('a=rtpmap:0 PCMU/8000\r\n');
  });

  it('given reused payload numbers when applying preference then preserves other media sections', () => {
    const video = 'm=video 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:video\r\na=rtpmap:111 VP8/90000\r\na=fmtp:111 stereo=0\r\n';
    const rejected = 'm=audio 0 UDP/TLS/RTP/SAVPF 111\r\na=mid:closed\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 stereo=0\r\n';
    const inactive = 'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:idle\r\na=inactive\r\na=rtpmap:111 opus/48000/2\r\n';
    const audioIndex = offer.indexOf('m=audio');
    const session = offer.slice(0, audioIndex);
    const audio = offer.slice(audioIndex);
    const input = session + video + audio + rejected + inactive;
    expect(opusReceiveOfferSdp(input, 'music-stereo')).toBe(
      session + video + opusReceiveOfferSdp(audio, 'music-stereo') + rejected + inactive,
    );
  });

  it('given inherited direction when applying preference then respects media override', () => {
    const input = offer.replace('v=0\r\n', 'v=0\r\na=sendonly\r\n');
    expect(opusReceiveOfferSdp(input, 'music-stereo')).toContain('useinbandfec=1;stereo=1');
    expect(() => opusReceiveOfferSdp(input.replace('a=recvonly\r\n', ''), 'music-stereo'))
      .toThrow(expect.objectContaining({ code: 'relay.stereo_receive_unsupported' }));
  });

  it.each(['\n', '\r\n'])('given declared line endings when applying preference then retains them', (ending) => {
    const input = offer.replace(/\r\n/g, ending);
    expect(opusReceiveOfferSdp(input, 'music-stereo')).toBe(input.replace(
      'useinbandfec=1', 'useinbandfec=1;stereo=1',
    ));
  });

  it('given no final newline when inserting fmtp then retains the terminal form', () => {
    const input = 'm=audio 9 UDP/TLS/RTP/SAVPF 111\na=recvonly\na=rtpmap:111 opus/48000/2';
    expect(opusReceiveOfferSdp(input, 'music-stereo')).toBe(input + '\na=fmtp:111 stereo=1');
  });

  it.each([
    'v=0\r\n',
    offer.replace('a=recvonly', 'a=sendonly'),
    offer.replace('a=recvonly', 'a=inactive'),
    offer.replace('m=audio 9', 'm=audio 0'),
    offer.replace('opus/48000/2', 'PCMU/8000'),
    offer.replace('SAVPF 111 0', 'SAVPF 0'),
    offer + offer,
    offer + 'a=fmtp:111 stereo=0\r\n',
    offer.replace('a=recvonly', 'a=recvonly\r\na=sendonly'),
  ])('given unsupported or ambiguous SDP when requesting stereo then refuses without exposing SDP', (input) => {
    expect(() => opusReceiveOfferSdp(input, 'music-stereo'))
      .toThrow(expect.objectContaining({ code: 'relay.stereo_receive_unsupported' }));
    try {
      opusReceiveOfferSdp(input, 'music-stereo');
    } catch (error) {
      expect(String(error)).not.toContain('ice-ufrag');
    }
  });
});
