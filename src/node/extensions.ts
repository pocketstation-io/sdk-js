import { nativeCallSync } from './errors.js';
import {
  nativeAddon,
  type NativeExtensionLibrary as NativeLibraryReceipt,
  type NativeExtensionPort,
} from './native.js';

/** Runtime values for Source, Operator, or Endpoint native extensions. */
export const ExtensionKind = Object.freeze({
  SOURCE: 'source',
  OPERATOR: 'operator',
  ENDPOINT: 'endpoint',
} as const);

/** Source, Operator, or Endpoint implementation exported by a native library. */
export type ExtensionKind = (typeof ExtensionKind)[keyof typeof ExtensionKind];

/** Runtime values for one named extension port direction. */
export const ExtensionPortDirection = Object.freeze({
  INPUT: 'input',
  OUTPUT: 'output',
} as const);

/** Direction of one named extension port. */
export type ExtensionPortDirection =
  (typeof ExtensionPortDirection)[keyof typeof ExtensionPortDirection];

/** Current Extension ABI version linked into this SDK. */
export class ExtensionAbiVersion {
  /** Size of the native ABI version record, in bytes. */
  public readonly structSizeBytes: number;
  /** ABI major version. Different major versions are incompatible. */
  public readonly abiMajor: number;
  /** ABI minor version. Newer minors require explicit compatibility. */
  public readonly abiMinor: number;

  public constructor(structSizeBytes: number, abiMajor: number, abiMinor: number) {
    this.structSizeBytes = structSizeBytes;
    this.abiMajor = abiMajor;
    this.abiMinor = abiMinor;
    Object.freeze(this);
  }

  /** @deprecated Use `abiMajor`. */
  public get major(): number {
    return this.abiMajor;
  }

  /** @deprecated Use `abiMinor`. */
  public get minor(): number {
    return this.abiMinor;
  }

  /** Read the Extension ABI version linked into the native SDK. */
  public static current(): ExtensionAbiVersion {
    const version = nativeCallSync(() => nativeAddon().extensionAbiVersion());
    return new ExtensionAbiVersion(
      version.structSizeBytes,
      version.abiMajor,
      version.abiMinor,
    );
  }

  /** Throw when this version cannot be used by the linked native SDK. */
  public requireCompatible(): void {
    nativeCallSync(() =>
      nativeAddon().extensionAbiIsCompatible(
        this.abiMajor,
        this.abiMinor,
        this.structSizeBytes,
      ),
    );
  }
}

/** One named typed-signal port exported by an extension. */
export interface ExtensionPortOptions {
  /** Port name used when connecting the Session. */
  readonly name: string;
  /** Whether values enter or leave the extension. */
  readonly direction: ExtensionPortDirection;
  /** Stable wire identity for values carried by this port. */
  readonly signalId: string;
  /** Whether Session compilation requires this port to be connected. */
  readonly required?: boolean;
  /** Optional application-facing meaning for the signal. */
  readonly semanticRole?: string;
  /** @deprecated Use `semanticRole`. */
  readonly role?: string;
  /** Optional schema identifier for the signal payload. */
  readonly schema?: string;
}

/** Validated description of one native extension port. */
export class ExtensionPort {
  public readonly name: string;
  public readonly direction: ExtensionPortDirection;
  public readonly signalId: string;
  public readonly required: boolean;
  public readonly semanticRole: string;
  public readonly schema: string;

  public constructor(options: ExtensionPortOptions) {
    this.name = options.name;
    this.direction = options.direction;
    this.signalId = options.signalId;
    this.required = options.required ?? true;
    if (
      options.semanticRole !== undefined &&
      options.role !== undefined &&
      options.semanticRole !== options.role
    ) {
      throw new TypeError('semanticRole and role must match when both are provided');
    }
    this.semanticRole = options.semanticRole ?? options.role ?? '';
    this.schema = options.schema ?? '';
    Object.freeze(this);
  }

  /** @deprecated Use `semanticRole`. */
  public get role(): string {
    return this.semanticRole;
  }

  /** @internal */
  public _native(): NativeExtensionPort {
    return {
      name: this.name,
      direction: this.direction,
      required: this.required,
      signalId: this.signalId,
      semanticRole: this.semanticRole,
      schema: this.schema,
    };
  }
}

/** Options used to validate a source, Operator, or Endpoint descriptor. */
export interface ExtensionDescriptorOptions {
  /** Stable reverse-domain extension identifier ending in `vN`. */
  readonly extensionId: string;
  /** @deprecated Use `extensionId`. */
  readonly id?: string;
  /** Kind of implementation exported under this identifier. */
  readonly kind: ExtensionKind;
  /** Named typed-signal ports. */
  readonly ports: readonly ExtensionPort[];
  /** Public descriptor revision. Defaults to one. */
  readonly revision?: number;
  /** Implementation generation. Defaults to one. */
  readonly generation?: number;
  /** ABI version to validate. Defaults to the linked SDK version. */
  readonly abi?: ExtensionAbiVersion;
  /** ABI major version. Defaults to the linked SDK version. */
  readonly abiMajor?: number;
  /** ABI minor version. Defaults to the linked SDK version. */
  readonly abiMinor?: number;
}

/** @deprecated Use `ExtensionDescriptorOptions` with `extensionId`. */
export type LegacyExtensionDescriptorOptions = Omit<
  ExtensionDescriptorOptions,
  'extensionId'
> & {
  readonly extensionId?: string;
  readonly id: string;
};

/** Descriptor validated by the same C ABI used to load native libraries. */
export class ExtensionDescriptor {
  public readonly extensionId: string;
  public readonly kind: ExtensionKind;
  public readonly ports: readonly ExtensionPort[];
  public readonly revision: number;
  public readonly generation: number;
  public readonly abiMajor: number;
  public readonly abiMinor: number;
  public readonly abi: ExtensionAbiVersion;

  public constructor(
    options: ExtensionDescriptorOptions | LegacyExtensionDescriptorOptions,
  ) {
    if (
      options.extensionId !== undefined &&
      options.id !== undefined &&
      options.extensionId !== options.id
    ) {
      throw new TypeError('extensionId and id must match when both are provided');
    }
    const extensionId = options.extensionId ?? options.id;
    if (extensionId === undefined) {
      throw new TypeError('extensionId is required');
    }
    this.extensionId = extensionId;
    this.kind = options.kind;
    this.ports = Object.freeze([...options.ports]);
    this.revision = options.revision ?? 1;
    this.generation = options.generation ?? 1;
    const linkedAbi = options.abi ?? ExtensionAbiVersion.current();
    this.abiMajor = options.abiMajor ?? linkedAbi.abiMajor;
    this.abiMinor = options.abiMinor ?? linkedAbi.abiMinor;
    this.abi = new ExtensionAbiVersion(
      linkedAbi.structSizeBytes,
      this.abiMajor,
      this.abiMinor,
    );
    nativeCallSync(() =>
      nativeAddon().validateExtensionDescriptor(
        this.extensionId,
        this.kind,
        this.revision,
        this.generation,
        this.abiMajor,
        this.abiMinor,
        this.ports.map((port) => port._native()),
      ),
    );
    Object.freeze(this);
  }

  /** @deprecated Use `extensionId`. */
  public get id(): string {
    return this.extensionId;
  }
}

/** One implementation imported from a trusted native library. */
export interface NativeExtensionRegistration {
  readonly id: string;
  readonly kind: ExtensionKind;
  readonly revision: number;
  readonly generation: number;
}

/** Receipt returned after all registrations in one library are imported. */
export interface NativeExtensionLibrary {
  /** Canonical absolute path retained by Core for the Session lifetime. */
  readonly canonicalPath: string;
  /** Complete registration set imported transactionally. */
  readonly registrations: readonly NativeExtensionRegistration[];
}

/** @internal */
export function extensionLibraryFromNative(
  receipt: NativeLibraryReceipt,
): NativeExtensionLibrary {
  return Object.freeze({
    canonicalPath: receipt.canonicalPath,
    registrations: Object.freeze(
      receipt.registrations.map((registration) =>
        Object.freeze({
          id: registration.id,
          kind: registration.kind as ExtensionKind,
          revision: registration.revision,
          generation: registration.generation,
        }),
      ),
    ),
  });
}
