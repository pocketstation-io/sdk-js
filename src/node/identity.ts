declare const identityBrand: unique symbol;

type BigIntIdentity<Name extends string> = bigint & {
  readonly [identityBrand]: Name;
};

/** Numeric identity of one running Core Session. */
export type RuntimeSessionId = BigIntIdentity<'RuntimeSessionId'>;
/** Numeric identity of one stream within a Session. */
export type StreamId = BigIntIdentity<'StreamId'>;
/** Numeric identity of one logical Source declaration. */
export type SourceId = BigIntIdentity<'SourceId'>;
/** Numeric identity of one running Source lifetime. */
export type SourceInstanceId = BigIntIdentity<'SourceInstanceId'>;
/** Numeric identity of one source-aware Stem. */
export type StemId = BigIntIdentity<'StemId'>;
/** Numeric identity of one Session route. */
export type RouteId = BigIntIdentity<'RouteId'>;
/** Numeric identity of one child-process sidecar. */
export type SidecarId = BigIntIdentity<'SidecarId'>;
/** Numeric identity of one Endpoint instance. */
export type EndpointId = BigIntIdentity<'EndpointId'>;
/** Numeric identity of one Connector instance. */
export type ConnectorId = BigIntIdentity<'ConnectorId'>;
/** Numeric identity of one running Operator lifetime. */
export type OperatorInstanceId = BigIntIdentity<'OperatorInstanceId'>;

/** Numeric identity of a native clock domain. */
export type ClockDomainId = number & {
  readonly [identityBrand]: 'ClockDomainId';
};

/** Authority that defines timestamps in a clock domain. */
export type ClockDomainKind =
  | 'unspecified'
  | 'process-monotonic'
  | 'provider-defined';

/** Epoch against which a clock domain measures timestamps. */
export type ClockDomainOrigin =
  | 'unspecified'
  | 'process-start'
  | 'provider-defined';

/** Validate and brand a Core Session identity without changing its value. */
export function RuntimeSessionId(value: bigint): RuntimeSessionId {
  return unsignedIdentity('RuntimeSessionId', value);
}
/** Validate and brand a stream identity without changing its value. */
export function StreamId(value: bigint): StreamId {
  return unsignedIdentity('StreamId', value);
}

/** Validate and brand a Source identity without changing its value. */
export function SourceId(value: bigint): SourceId {
  return unsignedIdentity('SourceId', value);
}

/** Validate and brand a Source lifetime identity without changing its value. */
export function SourceInstanceId(value: bigint): SourceInstanceId {
  return unsignedIdentity('SourceInstanceId', value);
}

/** Validate and brand a Stem identity without changing its value. */
export function StemId(value: bigint): StemId {
  return unsignedIdentity('StemId', value);
}

/** Validate and brand a route identity without changing its value. */
export function RouteId(value: bigint): RouteId {
  return unsignedIdentity('RouteId', value);
}

/** Validate and brand a sidecar identity without changing its value. */
export function SidecarId(value: bigint): SidecarId {
  return unsignedIdentity('SidecarId', value);
}

/** Validate and brand an Endpoint identity without changing its value. */
export function EndpointId(value: bigint): EndpointId {
  return unsignedIdentity('EndpointId', value);
}

/** Validate and brand a Connector identity without changing its value. */
export function ConnectorId(value: bigint): ConnectorId {
  return unsignedIdentity('ConnectorId', value);
}

/** Validate and brand an Operator lifetime identity without changing its value. */
export function OperatorInstanceId(value: bigint): OperatorInstanceId {
  return unsignedIdentity('OperatorInstanceId', value);
}

/** Validate and brand a native u32 clock-domain identity. */
export function ClockDomainId(value: number): ClockDomainId {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError('ClockDomainId must be a u32 integer');
  }
  return value as ClockDomainId;
}

function unsignedIdentity<Name extends string>(
  name: Name,
  value: bigint,
): BigIntIdentity<Name> {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new RangeError(`${name} must be an unsigned bigint`);
  }
  return value as BigIntIdentity<Name>;
}
