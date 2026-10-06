/** Versions and runtime requirements embedded in one JavaScript SDK build. */
export interface RuntimeCompatibilityOptions {
  /** Published JavaScript SDK version. */
  readonly sdkVersion: string;
  /** PocketStation Core version linked into the native addon. */
  readonly coreVersion: string;
  /** PocketStation Relay connector version linked into the native addon. */
  readonly relayConnectorVersion: string;
  /** Node.js version range supported by this package. */
  readonly nodeRequires: string;
  /** Oldest Node-API version accepted by the native addon. */
  readonly nodeApiVersion: number;
  /** Stable ABI used by the distributed native addon. */
  readonly nativeAbi: string;
}

/** Machine-readable compatibility facts for the installed JavaScript SDK. */
export class RuntimeCompatibility {
  public readonly sdkVersion: string;
  public readonly coreVersion: string;
  public readonly relayConnectorVersion: string;
  public readonly nodeRequires: string;
  public readonly nodeApiVersion: number;
  public readonly nativeAbi: string;

  public constructor(options: RuntimeCompatibilityOptions) {
    this.sdkVersion = requiredVersion('sdkVersion', options.sdkVersion);
    this.coreVersion = requiredVersion('coreVersion', options.coreVersion);
    this.relayConnectorVersion = requiredVersion(
      'relayConnectorVersion',
      options.relayConnectorVersion,
    );
    this.nodeRequires = requiredVersion('nodeRequires', options.nodeRequires);
    if (!Number.isSafeInteger(options.nodeApiVersion) || options.nodeApiVersion <= 0) {
      throw new RangeError('nodeApiVersion must be a positive safe integer');
    }
    this.nodeApiVersion = options.nodeApiVersion;
    this.nativeAbi = requiredVersion('nativeAbi', options.nativeAbi);
    Object.freeze(this);
  }
}

/** Compatibility facts for this exact package and native-addon build. */
export const runtimeCompatibility = new RuntimeCompatibility({
  sdkVersion: '0.1.5',
  coreVersion: '1.1.13',
  relayConnectorVersion: '0.1.5',
  nodeRequires: '>=20.17',
  nodeApiVersion: 8,
  nativeAbi: 'napi8',
});

function requiredVersion(name: string, value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}
