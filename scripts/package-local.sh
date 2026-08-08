#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

pnpm build

STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
OUT_DIR="${1:-release}"
ARCHIVE="$OUT_DIR/cosmoaudition-system-local-$STAMP.tgz"

mkdir -p "$OUT_DIR"

RELEASE_INPUTS=(
  .gitignore
  AGENTS.md
  LICENSE
  README.md
  package.json
  playwright.config.ts
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  tsconfig.json
  vitest.config.ts
  apps
  packages
  scripts
  tests
  vendor
  data/cache/.gitkeep
  data/mock
  data/snapshots/.gitkeep
  data/sources.yaml
  docs/accessibility.md
  docs/audio-browser-troubleshooting.md
  docs/audio-safety.md
  docs/cosmoaudition-system.md
  docs/deployment.md
  docs/local-operator-runbook.md
  docs/local-quickstart.md
  docs/mappings/mapping-contract.md
  docs/modulation-framework.md
  docs/privacy.md
  docs/source-register.md
  docs/workspaces-and-locality.md
)

tar \
  --exclude="node_modules" \
  --exclude="*/node_modules" \
  --exclude="*/node_modules/*" \
  --exclude="*.tsbuildinfo" \
  -czf "$ARCHIVE" \
  "${RELEASE_INPUTS[@]}"

printf '%s\n' "$ARCHIVE"
