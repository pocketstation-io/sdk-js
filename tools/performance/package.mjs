import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve } from 'node:path';

export function loadPackage(packageRoot) {
  const root = realpathSync(packageRoot);
  const require = createRequire(resolve(root, 'package.json'));
  const entry = realpathSync(require.resolve('pocketstation/node'));
  const fromRoot = relative(root, entry);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error('Public Node entry resolved outside the selected package');
  }
  const api = require('pocketstation/node');
  const metadata = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  return {
    api,
    provenance() {
      const loaded = [];
      for (const name of Object.keys(metadata.optionalDependencies ?? {})) {
        if (!name.startsWith('@pocketstation/native-')) continue;
        let path;
        try { path = require.resolve(name); } catch (error) {
          if (error.code === 'MODULE_NOT_FOUND') continue;
          throw error;
        }
        if (require.cache[path] && path.endsWith('.node')) loaded.push(realpathSync(path));
      }
      if (loaded.length !== 1) throw new Error('Expected one loaded declared native package');
      return { packageRoot: root, publicEntryPath: entry,
        publicEntrySha256: digest(entry), nativeAddonPath: loaded[0],
        nativeAddonSha256: digest(loaded[0]),
        runtimeCompatibility: {
          sdkVersion: api.runtimeCompatibility.sdkVersion,
          coreVersion: api.runtimeCompatibility.coreVersion,
          relayConnectorVersion: api.runtimeCompatibility.relayConnectorVersion,
        } };
    },
  };
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
