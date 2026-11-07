# JavaScript 0.1.8: qualified, tagged; npm access repair required

Status on 7 November 2026: `PARTIAL`. Source is merged and tagged. Publication
failed on the first native package; this is not a completed npm release.

## Exact immutable inputs

- Repository: `pocketstation-io/sdk-js`.
- Release source: `a94b91d265defb76a86d756238ac06e1099e1668`.
- Existing lightweight tag: `v0.1.8`, pointing directly at that source. Never move it.
- [Merged PR23](https://github.com/pocketstation-io/sdk-js/pull/23).
- [Qualification 42418415860](https://github.com/pocketstation-io/sdk-js/actions/runs/42418415860): all 38 jobs passed, including six native builds and 30 installed Node consumers.
- `qualified-distributions` artifact ID: `13592648720`.
- `release-manifest.json` SHA-256: `2e4bfcd4302203b0918995cfbc0ffb09a80e89a01460cdf4aa40777c4bb67494`.
- Prepared `publish-plan.json` SHA-256: `7a2c8c0959f51b4d3b4ab86f5887b7d207d8be015ba3aa0afde682fa0669b0a8`.
- [Hosted verification 42420212466](https://github.com/pocketstation-io/sdk-js/actions/runs/42420212466): complete seven-package dry run passed.
- [Actual publisher 42421183595, attempt 1](https://github.com/pocketstation-io/sdk-js/actions/runs/42421183595): failed; `complete:false`, zero package receipts.

The failure is `npm E404` on `PUT` for
`@pocketstation/native-darwin-arm64@0.1.8`. npm reported that the resource could
not be found or the publisher lacked permission. It is not proof of a compiler
or audio defect, nor proof of the exact account/token/trust configuration cause.
Do not repeatedly rerun an unchanged authorization failure.

## Continue from an authorized machine

The release source and artifacts are already qualified. Do not rebuild or start
another full matrix. Review the existing [publishing guide](npm-publishing.md)
and [publisher workflow](../../.github/workflows/publish.yml).

An npm owner should verify publication authorization for **all seven packages**.
For trusted publishing, configure GitHub owner `pocketstation-io`, repository
`sdk-js`, workflow filename `publish.yml`, matching any configured environment,
and permission for direct `npm publish`. The workflow already uses hosted
runners, Node 24, npm 11.9.0 and `id-token: write`. Its optional
`NODE_AUTH_TOKEN` is another supported authorization route. Do not expose secrets,
change package visibility, or assume a local login authenticates a hosted job.
See [npm's official trusted-publishing contract](https://docs.npmjs.com/trusted-publishers/).

Before retrying, read all seven exact versions through the normal npm registry.
An existing version is acceptable only if its SHA-512 integrity equals its
qualified archive; the maintained publisher checks this and refuses mismatches.
Never overwrite or unpublish a version. After correcting access, rerun **only
the failed job of the same publisher run**:

```sh
gh run rerun 42421183595 --repo pocketstation-io/sdk-js --failed
```

Require successful actual publication, a complete seven-package receipt and
matching `dist.integrity` for each package. Independently download all public
tarballs and compare these SHA-256 digests:

| Package | SHA-256 |
| --- | --- |
| `@pocketstation/native-darwin-arm64` | `95ea37eb02f4066e8f9dccd01f885ddcca464848fd6b1f8d0f17910d29c51f48` |
| `@pocketstation/native-darwin-x64` | `df28a22e48a18269476e66ef56c5ce4ec788a6cd5144b949a4b2fd7bbcb7b6c9` |
| `@pocketstation/native-win32-arm64-msvc` | `10413604943c026a999f9bde3b542fa87ead9cc49e0f8ca751dc2eaa62d4beae` |
| `@pocketstation/native-win32-x64-msvc` | `f4b3b01ef1464bd4307ca916177a737b9384bf97e26189ade2e3092278033903` |
| `@pocketstation/native-linux-arm64-gnu` | `f164e837252729e97652c7eeee16459f3f93928e08ec2f58be16e90e99dd3284` |
| `@pocketstation/native-linux-x64-gnu` | `854212fdc43cdd4c695aba25c162d76876e206ba196c15136494bdbee4a111ff` |
| `pocketstation` | `e7c78757c86050a9c9cb3956c7cdf17c83d98dffd4fb602b49dbde9a155e505f` |

Then run a clean actual-registry install/consumer, check ESM/CommonJS/types,
SDK `0.1.8`, Core `1.1.17`, native artifact hash and ordinary AEC unavailability.
Use the maintained native-matrix consumer without changing its assertions;
fixture checks do not establish physical capture. Only after registry verification
create the GitHub release for the existing tag with the same seven archives.
Record the final workflow attempt, registry proof, consumer and release URL.
Never simulate CI locally with `GITHUB_ACTIONS=true`.

Core 1.1.17 and Python 0.1.8 are already published and released. Do not repeat them.
This SDK embeds Core's Windows active-endpoint discovery repair through existing
public APIs. Physical Wave Link and broader native audio/recovery qualification
remain open. This documentation commit is not a new release source.
