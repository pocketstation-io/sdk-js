import { execFileSync } from 'node:child_process';

// npm.cmd cannot be executed directly on Windows. npm scripts provide the
// actual CLI path, so launch it with Node without introducing a command shell.
export function runNpm(args, options) {
  const cli = process.env.npm_execpath;
  if (cli) return execFileSync(process.execPath, [cli, ...args], options);
  if (process.platform === 'win32') {
    throw new Error('Run this package gate through npm run so npm_execpath is available.');
  }
  return execFileSync('npm', args, options);
}
