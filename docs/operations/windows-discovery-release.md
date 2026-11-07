# Windows discovery 0.1.8 release handoff

Status: `PARTIAL`; source preparation, not a publication receipt.

Release the existing root `pocketstation` and six `@pocketstation/native-*`
packages together at 0.1.8, using exact registry Core `=1.1.17` and unchanged
Relay connector 0.1.6. Core 1.1.17 is published from
`a1d2a0a6c407e3159b1761990df47861084ff829`; its registry archive SHA-256 is
`3523990ff7fcc2c5e44fa085aa4786b62dc74b83405180064256179dae3f436e`.
No native source/API change is needed in this SDK; rebuilding embeds the fix.

Follow [npm publishing](npm-publishing.md) on an authorized machine. Obtain the
actual clean, reviewed main SHA with `git rev-parse HEAD` after merge; do not
substitute a branch predecessor. Inspect existing Actions runs before dispatch.
Run one `qualify-distribution.yml` for that exact SHA and require all 38 jobs.
Retain the release-manifest digest and seven exact archives, then run the
maintained publisher in verify-only mode. Only after success create the absent
`v0.1.8` tag at that same SHA and publish the same qualified archives through
`publish.yml`. Existing npm trusted publishing runs on GitHub; a local login
is not required. If hosted authorization fails, retain its exact error and
continue on the authorized machine with the same artifacts, never a rebuild.

Record the actual source, qualification and publisher URLs, manifest digest,
seven matching registry integrity values, clean registry-consumer result and
GitHub release URL here before marking the release complete. Never overwrite an
existing npm version or move an existing tag. Root and six native versions must
all agree, and ordinary builds continue to omit AEC.

The Windows implementation enumerates accessible active render endpoints,
preserves results when one endpoint fails, and gives playing observations
precedence for duplicate processes. Physical Wave Link validation remains open.
macOS and Linux retain their existing backend implementations; no arbitrary
server/custom-system or mobile support is established by this dependency update.
