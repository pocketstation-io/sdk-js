import { nativeCallSync } from './errors.js';
import {
  nativeAddon,
  type NativeExtensionLibrary as NativeLibraryReceipt,
  type NativeExtensionPort,
} from './native.js';

/** Source, Operator, or Endpoint implementation exported by a native library. */
export type ExtensionKind = 'source' | 'operator' | 'endpoint';

/** Direction of one named extension port. */
export type ExtensionPortDirection = 'input' | 'output';

/** Current Extension ABI version linked into this SDK. */
export class ExtensionAbiVersion {
  /** Size of the native ABI version record, in bytes. */
  public readonly structSizeBytes: number;
  /** ABI major version. Different major versions are incompatible. */
  public readonly major: number;
  /** ABI minor version. Newer minors require explicit compatibility. */
  public readonly minor: number;

  public constructor(structSizeBytes: number, major: number, minor: number) {
    this.structSizeBytes = structSizeBytes;
    this.major = major;
    this.minor = minor;
    Object.freeze(this);
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
        this.major,
        this.minor,
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
  public readonly role: string;
  public readonly schema: string;

  public constructor(options: ExtensionPortOptions) {
    this.name = options.name;
    this.direction = options.direction;
    this.signalId = options.signalId;
    this.required = options.required ?? true;
    this.role = options.role ?? '';
    this.schema = options.schema ?? '';
    Object.freeze(this);
  }

  /** @internal */
  public _native(): NativeExtensionPort {
    return {
      name: this.name,
      direction: this.direction,
      required: this.required,
      signalId: this.signalId,
      semanticRole: this.role,
      schema: this.schema,
    };
  }
}

/** Options used to validate a source, Operator, or Endpoint descriptor. */
export interface ExtensionDescriptorOptions {
  /** Stable reverse-domain extension identifier ending in `vN`. */
  readonly id: string;
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
}

/** Descriptor validated by the same C ABI used to load native libraries. */
export class ExtensionDescriptor {
  public readonly id: string;
  public readonly kind: ExtensionKind;
  public readonly ports: readonly ExtensionPort[];
  public readonly revision: number;
  public readonly generation: number;
  public readonly abi: ExtensionAbiVersion;

  public constructor(options: ExtensionDescriptorOptions) {
    this.id = options.id;
    this.kind = options.kind;
    this.ports = Object.freeze([...options.ports]);
    this.revision = options.revision ?? 1;
    this.generation = options.generation ?? 1;
    this.abi = options.abi ?? ExtensionAbiVersion.current();
    nativeCallSync(() =>
      nativeAddon().validateExtensionDescriptor(
        this.id,
        this.kind,
        this.revision,
        this.generation,
        this.abi.major,
        this.abi.minor,
        this.ports.map((port) => port._native()),
      ),
    );
    Object.freeze(this);
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
