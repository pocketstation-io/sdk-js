import { Source, type DiscoveredSource } from '../node/sources.js';
import { PocketStationError } from '../node/errors.js';

describe('Source error-code compatibility', () => {
  it('keeps the established code for a discovery-only output device', () => {
    const output = {
      stableId: {
        platform: 'macos',
        kind: 'output-device',
        stableKey: 'output:fixture',
      },
    } as DiscoveredSource;

    let captured: unknown;
    try {
      Source.fromDiscovered(output);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(PocketStationError);
    expect(captured).toMatchObject({ code: 'source.unsupported_session_kind' });
  });
});
