import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

describe('native process lifecycle', () => {
  it('does not keep Node alive for an unstarted JavaScript Endpoint registration', () => {
    const installedEntry = pathToFileURL(
      new URL('../../dist/node/index.js', import.meta.url).pathname,
    ).href;
    const script = `
      import {
        EndpointManifest,
        EndpointProvider,
        Session,
      } from ${JSON.stringify(installedEntry)};

      const provider = new EndpointProvider({
        manifest: EndpointManifest.audio('dev.pocketstation.test.process-exit.v1'),
        factory: () => { throw new Error('the Session was not started'); },
      });
      new Session().registerEndpoint(provider);
    `;

    expect(() => execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', script],
      { stdio: 'pipe', timeout: 3_000 },
    )).not.toThrow();
  });
});
