import {
  ClockDomainId,
  ConnectorId,
  EndpointId,
  OperatorInstanceId,
  RouteId,
  RuntimeSessionId,
  SidecarId,
  SourceId,
  SourceInstanceId,
  StemId,
  StreamId,
} from '../node/identity.js';

describe('runtime identities', () => {
  it('preserves exact bigint values without wrapper allocation', () => {
    for (const create of [
      RuntimeSessionId,
      StreamId,
      SourceId,
      SourceInstanceId,
      StemId,
      RouteId,
      SidecarId,
      EndpointId,
      ConnectorId,
      OperatorInstanceId,
    ]) {
      expect(create(42n)).toBe(42n);
    }
    expect(ClockDomainId(42)).toBe(42);
});
  it('rejects values outside the native unsigned identity ranges', () => {
    expect(() => SourceId(-1n)).toThrow('SourceId must be an unsigned bigint');
    expect(() => ClockDomainId(-1)).toThrow('ClockDomainId must be a u32 integer');
    expect(() => ClockDomainId(0x1_0000_0000)).toThrow(
      'ClockDomainId must be a u32 integer',
    );
  });
});
