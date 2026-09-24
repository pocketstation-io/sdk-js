/** Versions and runtime requirements embedded in one JavaScript SDK build. */
export interface RuntimeCompatibility {
  readonly sdkVersion: string;
  readonly coreVersion: string;
  readonly relayConnectorVersion: string;
  readonly nodeRequires: string;
  readonly nodeApiVersion: number;
  readonly nativeAbi: string;
}

/** Machine-readable compatibility facts for this exact package build. */
export const runtimeCompatibility: RuntimeCompatibility = Object.freeze({
  sdkVersion: '0.1.0',
  coreVersion: '1.1.11',
  relayConnectorVersion: '0.1.5',
  nodeRequires: '>=20.17',
  nodeApiVersion: 8,
  nativeAbi: 'napi8',
});
