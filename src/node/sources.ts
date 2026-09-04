import { nativeCallSync } from './errors.js';
import { nativeAddon, type NativeSourceHandle } from './native.js';

const handles = new WeakMap<Source, NativeSourceHandle>();

/** Describes audio that a Session should open when it starts. */
export class Source {
  readonly #native: NativeSourceHandle;

  private constructor(native: NativeSourceHandle) {
    this.#native = native;
    handles.set(this, native);
  }

  /** Select a running application by exact display name or native application ID. */
  public static application(nameOrApplicationId: string): Source {
    return new Source(
      nativeCallSync(() =>
        nativeAddon().NativeSource.application(nameOrApplicationId),
      ),
    );
  }

  /** Capture the computer's complete desktop audio mix. */
  public static systemAudio(): Source {
    return new Source(nativeCallSync(() => nativeAddon().NativeSource.systemAudio()));
  }

  /** Capture the operating system's current default microphone. */
  public static defaultMicrophone(): Source {
    return new Source(
      nativeCallSync(() => nativeAddon().NativeSource.defaultMicrophone()),
    );
  }
}

/** @internal */
export function nativeSource(source: Source): NativeSourceHandle {
  const handle = handles.get(source);
  if (handle === undefined) {
    throw new TypeError('source must be a PocketStation Source');
  }
  return handle;
}
