#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Building @pocketstation/client..."
npm --prefix "$REPO_ROOT" run build

if [ "$DRY_RUN" = true ]; then
  echo "Dry-run: validating package (npm pack --dry-run)..."
  npm --prefix "$REPO_ROOT" pack --dry-run
  echo "Dry-run complete. No package was published."
else
  echo "Publishing @pocketstation/client to npm..."
  npm --prefix "$REPO_ROOT" publish --access public
  echo "Published successfully."
fi
