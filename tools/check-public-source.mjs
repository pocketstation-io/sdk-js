import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function git(directory, args, input) {
  const result = spawnSync('git', args, { cwd: directory, input, encoding: 'utf8' });
  if (result.error || (result.status !== 0 && args[0] !== 'check-ignore')) {
    throw result.error ?? new Error(result.stderr);
  }
  if (args[0] === 'check-ignore' && ![0, 1].includes(result.status)) {
    throw new Error(result.stderr);
  }
  return result.stdout.split('\0').filter(Boolean);
}

export function privateDevelopmentPaths(directory) {
  const paths = git(directory, ['ls-tree', '-r', '--name-only', '-z', 'HEAD']);
  const privatePaths = new Set(git(directory,
    ['check-ignore', '--no-index', '--stdin', '-z'], `${paths.join('\0')}\0`));
  for (const path of paths) {
    if (['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'].includes(basename(path))
      || /^PHASE\d+_(PROGRESS|QUEUE)\.md$/.test(basename(path))
      || /^docs\/(execution|internal|development|reports|standards|adr)\//.test(path)
      || ['docs/REPO_CONTRACT.md', 'docs/JAVASCRIPT_CAPABILITY_MATRIX.md',
        'docs/JAVASCRIPT_SDK_DESIGN.md'].includes(path)) {
      privatePaths.add(path);
    }
  }
  return [...privatePaths].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const paths = privateDevelopmentPaths(process.cwd());
  if (paths.length) {
    console.error(`Public source contains private development records: ${paths.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('public source: PASS');
  }
}
