# Publish PocketStation for JavaScript 0.1.6

This guide is the handoff for releasing the existing `pocketstation` npm package
and its six `@pocketstation/native-*` packages from
[`pocketstation-io/sdk-js`](https://github.com/pocketstation-io/sdk-js).
Version 0.1.6 uses published Core 1.1.15 and Relay connector 0.1.6. It adds explicit
application process sets; see the [release notes](../../RELEASE_NOTES.md).
This source preparation does not establish archive qualification or publication.

Use the existing repository, workflows and package names. The ordinary addon
omits AEC; explicit AEC builds retain their own qualification requirements.
Read [the README](../../README.md),
[`publish.yml`](../../.github/workflows/publish.yml),
[`qualify-distribution.yml`](../../.github/workflows/qualify-distribution.yml),
and [`native-matrix.json`](../../tools/native-matrix.json) before starting.

## Check versions and publication access

Check all seven exact versions through the normal public registry before
spending time on distribution builds:

```sh
for package in pocketstation @pocketstation/native-darwin-arm64 @pocketstation/native-darwin-x64 @pocketstation/native-win32-arm64-msvc @pocketstation/native-win32-x64-msvc @pocketstation/native-linux-arm64-gnu @pocketstation/native-linux-x64-gnu; do
  npm view "$package@0.1.6" --json --registry=https://registry.npmjs.org
done
```

Only an actual registry `E404` establishes that a version is absent. Network,
authentication, rate-limit, proxy and HTML responses leave its availability
unknown; stop rather than bypassing the failure. If a version exists, compare
its `dist.integrity` with the qualified bytes. The publisher accepts identical
bytes, refuses different bytes, and never overwrites a version. A different
release needs a distinct unused version and fresh qualification.

Use [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) configured
for GitHub owner `pocketstation-io`, repository `sdk-js`, workflow `publish.yml`
on each package. The existing job uses Node 24, npm 11.9.0 and `id-token: write`.
The optional repository secret `NODE_AUTH_TOKEN` supports authorized initial
publication where package trust is not yet configured. Do not read, print or
copy credentials into commands, logs or Git. No local npm login is needed;
local login would not authenticate the hosted job. Never imitate CI by setting
`GITHUB_ACTIONS=true` locally.

## Finish source review on protected main

Use a fresh checkout or preserve unrelated local work. Inspect the actual
release branch and existing Actions runs. The final source must contain version
0.1.6 consistently in the root, six native manifests, native crate,
compatibility values and consumer expectations, with the normal registry Core
pin `=1.1.15`. No local Core override may enter the release.

Use Node 20.17 or newer, the pinned npm 10.8.2 for dependency bootstrap, and
Python 3.11 or newer. Native builds use Rust 1.95 and the platform prerequisites
from the workflows. npm 11.9.0 is reserved for the publishing job; npm 10.8.2
supports bootstrapping before the new optional native versions exist.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run api:check
npm run build:examples
npm run docs:check
npm run notices:check
node tools/check-public-source.mjs
node --test tests/public-source.test.mjs tests/wss-consumer-diagnostics.test.mjs tests/publish-qualified.test.mjs
python3 -B -m unittest discover -s tests -p 'test_*matrix.py'
python3 -B -m unittest discover -s tests -p test_npm_release.py
```

Complete the required native, export, packed-consumer and source-CI checks
through normal protected-main review. Preserve WSS certificate, typed-refusal,
socket-closure and timeout assertions. Required failures need diagnosis and a
passing result; skipped or cancelled jobs do not count. Build each native
variant once per job and reuse its bytes for exports and installed consumers.

After the reviewed change merges, obtain the actual final main commit:

```sh
git fetch origin
git switch main
git pull --ff-only
release_commit=$(git rev-parse HEAD)
git status --short
```

Require a clean checkout and successful required checks for that exact commit.
Do not reuse an older source run or archive after a merge changes the SHA.

## Qualify the immutable archives once

Inspect existing runs first. If a matching run is already active, follow it;
do not dispatch a duplicate full matrix. Start one deliberate qualification on
the final main commit:

```sh
gh workflow run qualify-distribution.yml --repo pocketstation-io/sdk-js --ref main
gh run list --repo pocketstation-io/sdk-js --workflow qualify-distribution.yml --commit "$release_commit" --limit 5
```

Record the observed run ID as `QUALIFICATION_RUN`. Require all 38 jobs:
root packaging, six native builds, 30 installed consumers across Node 20.17.0,
20, 22, 24 and 26, and the final verifier. Inspect failures locally where
possible and rerun only failed jobs when source is unchanged. A changed source
needs a matching qualification. Do not rebuild already approved archives.

Download the successful `qualified-distributions` artifact into a new directory
and recompute its qualification:

```sh
package_dir=$(mktemp -d)
gh run download "$QUALIFICATION_RUN" --repo pocketstation-io/sdk-js --name qualified-distributions --dir "$package_dir"
gh api "repos/pocketstation-io/sdk-js/actions/runs/$QUALIFICATION_RUN" > "$package_dir/qualification-run.json"
MANIFEST_SHA256=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$package_dir/release-manifest.json")
python3 tools/prepare-npm-release.py --directory "$package_dir" --source-commit "$release_commit" --manifest-sha256 "$MANIFEST_SHA256" --run "$package_dir/qualification-run.json" --repository pocketstation-io/sdk-js
node tools/publish-qualified.mjs "$package_dir/publish-plan.json" "$package_dir/local-dry-run.json" --verify-only
```

Retain the actual source SHA, run URL, manifest digest and all seven archive
hashes. The tools verify archive members and consumer results; filenames and
successful build jobs alone do not qualify the package.

## Publish through the existing trusted workflow

First run the publisher without uploads on the same final main commit:

```sh
gh workflow run publish.yml --repo pocketstation-io/sdk-js --ref main -f qualification_run="$QUALIFICATION_RUN" -f manifest_sha256="$MANIFEST_SHA256" -F publish=false
```

Require success and inspect `npm-publication-receipt`. Then check local and
remote `v0.1.6` tags. Create the tag at `release_commit` only if absent; an
existing matching tag can be reused, and a different tag must never be moved.

```sh
git ls-remote --tags origin refs/tags/v0.1.6 'refs/tags/v0.1.6^{}'
# Only if both local and remote tags are absent:
git tag v0.1.6 "$release_commit"
git push origin refs/tags/v0.1.6
gh workflow run publish.yml --repo pocketstation-io/sdk-js --ref v0.1.6 -f qualification_run="$QUALIFICATION_RUN" -f manifest_sha256="$MANIFEST_SHA256" -F publish=true
```

The maintained publisher checks source, run and manifest again, publishes the
six native packages before the root, then verifies registry integrity. Require
`complete: true` and seven matching package entries in the actual receipt.
After partial publication, retain the failure and retry only the same approved
bytes. Never rebuild, unpublish or change a version to disguise a partial run.

## Check the normal installed package

On a clean supported machine, use normal optional dependencies:

```sh
consumer_dir=$(mktemp -d)
cd "$consumer_dir"
npm init -y
npm install --ignore-scripts pocketstation@0.1.6 --registry=https://registry.npmjs.org
node --input-type=module -e 'import { Session, runtimeCompatibility } from "pocketstation/node"; if (typeof Session !== "function" || runtimeCompatibility.sdkVersion !== "0.1.6" || runtimeCompatibility.coreVersion !== "1.1.15") throw new Error("SDK/native compatibility mismatch"); console.log("PocketStation native package loads")'
node -e 'const { Session, discoverProcessInstances } = require("pocketstation/node"); if (typeof Session !== "function" || typeof discoverProcessInstances !== "function" || typeof Session.prototype.captureProcessSet !== "function") throw new Error("Process-set API missing")'
```

Retain normal registry origins, loaded native identity and ESM/CommonJS/type
consumer results from qualification. Keep final source, qualification and
publisher URLs, manifest hash, seven integrity results and the clean-consumer
result in the release record. Only then mark publication complete and update
release status. Installed loads do not prove capture permissions, physical
signal quality, WAN/TURN, phone playback or useful model output; preserve the
README's platform and evidence limits.

For an operator continuing on another machine: use this same source and these
maintained workflows, inspect existing runs before dispatching, and report the
actual values and failures. No private build tree, copied native fallback,
local authentication workaround or separate publishing script is required.
