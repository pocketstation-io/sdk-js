# Browser music-stereo SDK release handoff

**Version 0.1.7 is approved for release; its source is prepared on the release branch.**
Final tagging, archive qualification, npm publication and the GitHub release are
delegated to the release operator on the other machine and remain pending.
Normal verified registry reads on 2 November 2026 returned HTTP404 for all seven
target versions. Recheck availability before release; this is not a reservation.
Network/authentication/proxy errors mean UNKNOWN; never disable TLS to obtain a result.

## Approval and source

Approval for all seven 0.1.7 packages was given on 2 November 2026.
Before each push, tag,
registry publication or release creation, verify the recorded active approval covers the **exact
packages, stable version and actions**, or obtain it if missing. An existing
matching approval for the same active task need not be requested again.
“Continue”, “full mode” and “publish when
done” do not count; approval cannot be inferred or carried across tasks or versions.
Consumed 0.1.6 approvals cannot authorize this release.

The independently qualified runtime SDK head is `c6fa963d79e7d212d612239f5c9ef2e886201054`,
based on public main `77af919d7227298737db42db097631d817b74b06`:

- `18fe19f249531aff510c6ce2a5d526c71bffd583` — default-preserving receive profile.
- `338ec0eba5fea2750e7ae0d0161a6e630b947caf` — direct decoded-PCM proof.
- `4f8285265efa0c744b4b7a059a58da17e9a54fb9` — quiet renderer activation.
- `c6fa963d79e7d212d612239f5c9ef2e886201054` — retired signaling callback fence.

Continue from the candidate branch below. Verify that the remote branch is
available and retain its exact HEAD before normal PR integration:

```sh
git clone --branch candidate/browser-stereo-delivery-196 https://github.com/pocketstation-io/sdk-js.git
cd sdk-js
git rev-parse HEAD
git log --oneline origin/main..HEAD
```

The branch includes the runtime commits above, this handoff and coupled 0.1.7
metadata. Preserve newer remote changes. Do not force-push or bypass protected
main. A source branch does not establish archive qualification or publication.

The locally qualified root tarball is `pocketstation-0.1.6.tgz`, 726,601 bytes,
SHA256 `44fd97861f45f10b407678685247d038cb6f159e9a4d7114da907541b99a07a4`.
It contains the new browser code under an existing version for isolated testing.
**Never upload it over the published 0.1.6.**

## Coupled release packages

| Package | Release version |
| --- | --- |
| `pocketstation` | 0.1.7 |
| `@pocketstation/native-darwin-arm64` | 0.1.7 |
| `@pocketstation/native-darwin-x64` | 0.1.7 |
| `@pocketstation/native-win32-arm64-msvc` | 0.1.7 |
| `@pocketstation/native-win32-x64-msvc` | 0.1.7 |
| `@pocketstation/native-linux-arm64-gnu` | 0.1.7 |
| `@pocketstation/native-linux-x64-gnu` | 0.1.7 |

The loader requires the installed native manifest version to equal the root
version. Keep optional dependencies, native crate/lock metadata, exported version
and compatibility facts consistent; preserve Core1.1.15, Connector0.1.6 and N-API8.
Unchanged library bytes still need honest build provenance and new archive hashes.
The current qualification workflow builds all six targets; it has no import mode.

## Retained evidence and browser prerequisites

Chromium148, Firefox150 and WebKit26.4 each passed eight required music-stereo
windows across initial receive/reconnect. Default/legacy arms are descriptive.
A separate public Rust publisher proved four sequential source epochs/generations
1→4; another run matched 2,573 contiguous ingress/WHEP Opus payloads, with503
unobserved prefix packets excluded. That Rust executable is not the Node addon.
These are same-host software-PCM results for exact retained inputs: no physical,
WAN, encrypted-browser-byte or performance claim, and no stale-audio guarantee
inside the750ms settling interval. They do not qualify new archive bytes.

For any final-artifact browser check, reuse the existing SDK helper/evaluator and
reviewed Lab orchestration. Supply the exact installed packed package, supported
Playwright vendor browsers, one real Relay/native PCM source and a private access
manifest with independent bus-scoped credentials per browser/arm. Stereo mode also
needs its existing loopback phase controller, source and legacy baseline package.
Do not copy credentials, completed machine configs or full SDP into this guide.
The SDK runner's supported CLI is:

```sh
node tests/relay-browsers.mjs \
  --package-root /private/consumer/node_modules/pocketstation \
  --manifest /private/run/access.json --output /private/run/browsers.json \
  --timeout-ms 30000
```
Paths above are placeholders. Use private0700 directories/0600 manifests and a finite run/cleanup plan;
missing prerequisites or skipped browsers are not PASS. Do not add permission,
security, autoplay or fake-device flags. See [browser receive](../reference/browser-relay.md).

## Release operator steps

Use [the npm guide](npm-publishing.md) and the existing
[qualification](../../.github/workflows/qualify-distribution.yml) and
[publisher](../../.github/workflows/publish.yml) workflows; retain the0.1.6 history.
Use npm10.8.2 for bootstrap and Node24/npm11.9.0 for hosted publishing.
Run affected local type/API/docs/notices/export/packed gates before a CI-triggering
push. Build each variant once/job and reuse it. After normal PR/main checks pass:

```sh
git fetch origin
git switch main
git pull --ff-only
release_commit=$(git rev-parse HEAD)
gh run list --repo pocketstation-io/sdk-js --workflow qualify-distribution.yml --commit "$release_commit" --limit 5
# Only after confirming no matching qualification run is active:
gh workflow run qualify-distribution.yml --repo pocketstation-io/sdk-js --ref main
```
Inspect existing runs first: do not dispatch if the matching run is active.
Require all38 jobs: root,6 native,30 installed consumers and verifier. A different
final SHA/version needs matching qualification; do not relabel prior reports.
Download the actual successful run's qualified-distributions and use the npm
guide's prepare-npm-release.py command with its reviewed manifest SHA.
Set QUALIFICATION_RUN and MANIFEST_SHA256 to those actual values, then:

```sh
gh workflow run publish.yml --repo pocketstation-io/sdk-js --ref main -f qualification_run="$QUALIFICATION_RUN" -f manifest_sha256="$MANIFEST_SHA256" -F publish=false
```
Require that receipt, recheck all seven exact registry versions, and verify the
local/remote v0.1.7 tag. Only if absent, create/push it at release_commit; an existing
different tag must never move. After the exact tag action is approved:

```sh
git ls-remote --tags origin refs/tags/v0.1.7 'refs/tags/v0.1.7^{}'
# Only if both local and remote tags are absent:
git tag v0.1.7 "$release_commit"
git push origin refs/tags/v0.1.7
gh workflow run publish.yml --repo pocketstation-io/sdk-js --ref v0.1.7 -f qualification_run="$QUALIFICATION_RUN" -f manifest_sha256="$MANIFEST_SHA256" -F publish=true
```
The hosted job supports npm OIDC and an optional configured NODE_AUTH_TOKEN fallback.
Local npm login does not authenticate that job; never copy secrets or fake CI.
Configured secret presence is not validity. Require complete:true/seven matching
registry integrities; partial publication retries only the same approved archives.
Then install pocketstation@0.1.7 normally on a clean supported machine and retain
actual optional-native identity plus ESM/CJS/types/Session results. A GitHub release
is a separately approved step after proof. Core/Python holds and CI cost limits stay.
JamX adoption is still pending; public delivery does not itself update the app.
