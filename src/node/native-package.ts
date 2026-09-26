import { PocketStationError } from '../errors.js';
import { requirePackage } from '../require-package.cjs';
import { version } from '../index.js';

function nativePackageName(): string {
  const platform = process.platform;
  const architecture = process.arch;
  const supported = (architecture === 'arm64' || architecture === 'x64')
    && ['darwin', 'win32', 'linux'].includes(platform);
  const glibc = platform !== 'linux' || (
    process.report?.getReport() as { header?: { glibcVersionRuntime?: string } }
  )?.header?.glibcVersionRuntime;
  if (!supported || !glibc) {
    throw new PocketStationError(
      'package.unsupported_target',
      `PocketStation native capture does not support ${platform}/${architecture}`
        + (platform === 'linux' && !glibc ? ' without glibc (musl is unsupported).' : '.')
        + ' Use macOS, Windows, or glibc Linux on x64/arm64.',
    );
  }
  const suffix = platform === 'win32' ? '-msvc' : platform === 'linux' ? '-gnu' : '';
  return `@pocketstation/native-${platform}-${architecture}${suffix}`;
}

export function loadNativePackage(): unknown {
  const name = nativePackageName();
  try {
    const manifest = requirePackage(`${name}/package.json`) as { version: string };
    if (manifest.version !== version) {
      throw new PocketStationError(
        'package.version_mismatch',
        `PocketStation ${version} requires ${name}@${version}; found ${manifest.version}.`,
      );
    }
    return requirePackage(name);
  } catch (cause) {
    if (cause instanceof PocketStationError) throw cause;
    const missing = (cause as NodeJS.ErrnoException)?.code === 'MODULE_NOT_FOUND';
    throw new PocketStationError(
      missing ? 'package.native_missing' : 'package.native_load_failed',
      `Cannot load ${name}@${version}. Install optional dependencies with `
        + '`npm install --include=optional pocketstation` or install '
        + `${name}@${version} explicitly.`,
      { cause },
    );
  }
}
