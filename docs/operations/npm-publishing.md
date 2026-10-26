# Finish the JavaScript SDK npm release

Use this guide on a machine with the owner's GitHub and npm access. It hands
over the current JavaScript SDK source and the remaining release checks. It
does not say that the package is already qualified or published.

## Starting state — 2026-10-26

- Repository: `https://github.com/pocketstation-io/sdk-js`.
- Handoff branch: `release/js-0.1.5-174`.
- SDK implementation commit: `4e4b0f7d1e56c04953e7b8e8d2a205cc94abb56d`.
  This guide is a later documentation change on that branch.
- Prepared npm version: `0.1.5`. The root npm package is **`pocketstation`**,
  not `pocketstation-js`.
- The native binding uses published Core `1.1.14` and Relay connector `0.1.6`.
- Remote `main` was `9072f2c84e36f6521db92d97d94082632ce42cbd` when checked.
  Its seven source-CI jobs passed in run
  [38171174428](https://github.com/pocketstation-io/sdk-js/actions/runs/38171174428).
  That is evidence for the older commit, not this handoff.
- Distribution run
  [38467173910](https://github.com/pocketstation-io/sdk-js/actions/runs/38467173910)
  ended cancelled on attempt 2. A Windows consumer failed; cancelled consumers
  and the skipped verifier do not qualify a release.
- The newer implementation commit corrects the WSS refusal test's observation
  and cleanup. It still needs native Windows and complete distribution checks.
  Do not infer that its local test proves the Windows result.

No npm upload, release tag, main merge, or new distribution run is performed by
the handoff push. Do not upload an archive from the older failed run or relabel
its source commit.

## 1. Fetch the handoff and inspect it

Start in a fresh directory, leaving any existing checkout intact:

```sh
git clone --branch release/js-0.1.5-174 https://github.com/pocketstation-io/sdk-js.git
cd sdk-js
git status --short
git log -3 --oneline
git merge-base --is-ancestor 4e4b0f7d1e56c04953e7b8e8d2a205cc94abb56d HEAD
git diff --stat origin/main...HEAD
```

Read this guide, [the package README](../../README.md),
[`publish.yml`](../../.github/workflows/publish.yml),
[`qualify-distribution.yml`](../../.github/workflows/qualify-distribution.yml),
and [`native-matrix.json`](../../tools/native-matrix.json). The repository's
publisher and archive verifier are the executable checks for the steps below.

For Codex on the other machine, use this task:

> Finish the release described in docs/operations/npm-publishing.md. First
> inspect current GitHub runs and npm availability. Preserve the existing
> failures. Finish the Windows WSS and source checks, integrate through normal
> protected-main review, and qualify archives from the final source commit.
> Publish only the verified seven-package plan using the owner's authorized
> npm access. Do not bump versions, replace an existing tag/version, weaken
> tests, fake CI environment variables, or change billing. Report the actual
> source, run, manifest digest, seven package results and installed consumer.

## 2. Check package availability and access before spending build time

The owner needs write access to the GitHub repository, ownership of the root
npm name, and permission to publish under `@pocketstation`. Authentication is
completed by the owner on this machine; credentials do not belong in Git.

Check the existing public registry state for **all seven** names:

```sh
npm view pocketstation@0.1.5 --json --registry=https://registry.npmjs.org
npm view @pocketstation/native-darwin-arm64@0.1.5 --json --registry=https://registry.npmjs.org
npm view @pocketstation/native-darwin-x64@0.1.5 --json --registry=https://registry.npmjs.org
npm view @pocketstation/native-win32-arm64-msvc@0.1.5 --json --registry=https://registry.npmjs.org
npm view @pocketstation/native-win32-x64-msvc@0.1.5 --json --registry=https://registry.npmjs.org
npm view @pocketstation/native-linux-arm64-gnu@0.1.5 --json --registry=https://registry.npmjs.org
npm view @pocketstation/native-linux-x64-gnu@0.1.5 --json --registry=https://registry.npmjs.org
```

An actual registry `E404` means that lookup found no version. Authentication,
network, proxy, rate-limit or HTML responses do not establish availability.
If any version already exists, compare its `dist.integrity` with the subsequently
qualified archive. The publisher accepts an existing version only when the
bytes match. Different bytes require an owner-approved new version and fresh
qualification; never overwrite, unpublish to reuse a version, or silently bump.
See [npm's publication rules](https://docs.npmjs.com/cli/commands/npm-publish/).

Preferred publishing authentication is
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for
GitHub owner `pocketstation-io`, repository `sdk-js`, workflow **`publish.yml`**.
Configure each package with the owner's access. A new package may need an
authorized bootstrap credential before its trusted publisher is available.
The existing workflow accepts the repository secret `NODE_AUTH_TOKEN` for that
case. Configure it through the owner's GitHub/npm account; do not copy a token
into this guide, a command argument, a log or a commit.

The publishing job already selects Node 24, npm 11.9.0 and `id-token: write`.
It runs on GitHub-hosted infrastructure. A local `npm login` alone does not
authenticate that job, and this repository deliberately restricts its upload
script to CI. Do not bypass that restriction by setting `GITHUB_ACTIONS=true`
locally. No local npm login is needed on the original machine.

## 3. Complete source checks and protected-main review

Use Node 20.17 or newer and Python 3.11 or newer for these checks. Native builds
also need Rust 1.95 and the platform dependencies declared in the workflows.
The qualification workflow uses npm 10.8.2 to bootstrap dependencies before the
optional native packages exist. Keep that separate from npm 11.9.0 in the
publishing job.

```sh
node tools/check-public-source.mjs
node --test tests/public-source.test.mjs tests/wss-consumer-diagnostics.test.mjs tests/publish-qualified.test.mjs
python3 -B -m unittest discover -s tests -p 'test_*matrix.py'
python3 -B -m unittest discover -s tests -p test_npm_release.py
```

Inspect existing runs before starting another. Open the normal pull request
from the handoff branch, finish the required source checks, and merge through
the configured branch protection. A branch push alone is not that review.
Keep the WSS certificate, typed-refusal, socket-closure and timeout assertions.
Diagnose a failing Windows job from its log; do not turn it into a skipped or
weaker test. Do not repeat an unchanged passing matrix to investigate a single
failed job.

After merging, fetch the final main commit. Qualification and publication must
use that commit, including any merge/rebase change in its SHA:

```sh
git fetch origin
git switch main
git pull --ff-only
release_commit=$(git rev-parse HEAD)
git status --short
```

Require a clean tree and all current required source checks. Do not reuse
`38171174428` as proof for a changed commit.

## 4. Qualify and inspect the final archives

Only when no matching qualification is already running, start one deliberate
distribution run on the final main commit:

```sh
gh workflow run qualify-distribution.yml --repo pocketstation-io/sdk-js --ref main
gh run list --repo pocketstation-io/sdk-js --workflow qualify-distribution.yml --commit "$release_commit" --limit 5
```

Record the run ID returned by the readback as `QUALIFICATION_RUN`; do not guess
it or redispatch because a response is slow. Watch that run. Require success
for root packaging, six native builds, 30 installed consumers across the five
declared Node versions, and final verification: **38 successful jobs**. A
cancelled, skipped or failed job is not a pass. If unchanged source has a
recoverable job failure, inspect it and rerun only the failed jobs. Source
changes require a newly matching qualification.

Download the successful run's `qualified-distributions` artifact into a new
directory and verify it locally:

```sh
package_dir=$(mktemp -d)
gh run download "$QUALIFICATION_RUN" --repo pocketstation-io/sdk-js --name qualified-distributions --dir "$package_dir"
gh api "repos/pocketstation-io/sdk-js/actions/runs/$QUALIFICATION_RUN" > "$package_dir/qualification-run.json"
MANIFEST_SHA256=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$package_dir/release-manifest.json")
python3 tools/prepare-npm-release.py --directory "$package_dir" --source-commit "$release_commit" --manifest-sha256 "$MANIFEST_SHA256" --run "$package_dir/qualification-run.json" --repository pocketstation-io/sdk-js
node tools/publish-qualified.mjs "$package_dir/publish-plan.json" "$package_dir/local-dry-run.json" --verify-only
```

Retain and independently review the manifest digest and seven archive hashes.
The verifier recomputes archive contents and consumer results, not just file
names. Do not rebuild after approving those bytes.

## 5. Verify the publisher, then publish the same archives

Ensure `main` still names `release_commit`. First run the publisher without
uploads, supplying the inspected run and digest:

```sh
gh workflow run publish.yml --repo pocketstation-io/sdk-js --ref main -f qualification_run="$QUALIFICATION_RUN" -f manifest_sha256="$MANIFEST_SHA256" -F publish=false
```

Require that run to finish successfully and inspect its
`npm-publication-receipt` artifact. Only then create `v0.1.5` at the same final
source commit and push that tag. Check existing local/remote tags first. An
existing matching tag may be reused; an existing different tag must not be
moved or force-pushed.

```sh
git ls-remote --tags origin refs/tags/v0.1.5 'refs/tags/v0.1.5^{}'
# Only when the tag does not already exist:
git tag v0.1.5 "$release_commit"
git push origin refs/tags/v0.1.5
```

With the owner's release authorization and npm authentication ready:

```sh
gh workflow run publish.yml --repo pocketstation-io/sdk-js --ref v0.1.5 -f qualification_run="$QUALIFICATION_RUN" -f manifest_sha256="$MANIFEST_SHA256" -F publish=true
```

The publisher verifies the source/run/digest again, uploads the six native
packages first and the root package last, then compares registry integrity.
Require a successful job and `complete: true` in its publication receipt with
seven matching package entries. If it fails after a partial upload, retain the
receipt and resume only with the same approved archives. Existing identical
versions are supported; mismatched versions are refused. Never rebuild or
change versions merely to retry a partially completed upload.

## 6. Verify what users can install

On a supported clean machine, install the public package with optional
dependencies enabled and inspect the loaded native export:

```sh
consumer_dir=$(mktemp -d)
cd "$consumer_dir"
npm init -y
npm install --ignore-scripts pocketstation@0.1.5 --registry=https://registry.npmjs.org
node --input-type=module -e 'import { Session } from "pocketstation/node"; if (typeof Session !== "function") throw new Error("Session export missing"); console.log("PocketStation native package loads")'
```

This load check does not prove microphone permission, physical capture, WAN,
phone playback or useful model output. Run any advertised capture journey
separately with the operator's explicit source selection and permissions.
Keep the final source commit, qualification and publisher URLs, manifest hash,
seven registry integrity results and clean-consumer result. Create release
notes and a GitHub release only after those publication checks pass. Keep the
existing accurate platform limits when updating the README's unpublished
notice. Remove the temporary consumer directory when it is no longer needed.
