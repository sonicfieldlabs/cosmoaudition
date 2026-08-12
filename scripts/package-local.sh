#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SKIP_BUILD=false
OUT_DIR="release"
OUT_DIR_SET=false

for argument in "$@"; do
  case "$argument" in
    --)
      ;;
    --skip-build)
      SKIP_BUILD=true
      ;;
    --*)
      printf 'Unknown option: %s\n' "$argument" >&2
      exit 2
      ;;
    *)
      if [[ "$OUT_DIR_SET" == true ]]; then
        printf 'Only one output directory may be supplied.\n' >&2
        exit 2
      fi
      OUT_DIR="$argument"
      OUT_DIR_SET=true
      ;;
  esac
done

fail() {
  printf 'local package failed: %s\n' "$1" >&2
  exit 1
}

REQUIRED_TRACKED_INPUTS=(
  .gitignore
  AGENTS.md
  CHANGELOG.md
  LICENSE
  README.md
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  tsconfig.json
  apps/api/package.json
  apps/api/vite.config.ts
  apps/web/index.html
  apps/web/package.json
  apps/web/tsconfig.json
  apps/web/vite.config.ts
  vendor/masa/CHECKSUMS.sha256
  vendor/masa/README.md
  vendor/masa/sonicfield-masa-0.2.0.tgz
  vendor/masa/sonicfield-masa-validator-0.2.0.tgz
)
for required_input in "${REQUIRED_TRACKED_INPUTS[@]}"; do
  [[ -s "$required_input" ]] || fail "missing required release input: $required_input"
  git ls-files --error-unmatch -- "$required_input" >/dev/null 2>&1 ||
    fail "required release input is not tracked: $required_input"
done

unexpected_masa_archive="$(find vendor/masa -maxdepth 1 -type f -name '*.tgz' \
  ! -name 'sonicfield-masa-0.2.0.tgz' \
  ! -name 'sonicfield-masa-validator-0.2.0.tgz' -print -quit)"
[[ -z "$unexpected_masa_archive" ]] ||
  fail "unexpected vendored MASA archive: $unexpected_masa_archive"

# A build may import files that are not themselves selected for the release
# archive. Refuse any ignored or untracked source/config file before Vite or
# TypeScript can inline it into an accepted generated bundle.
build_symlink="$(find apps packages \
  \( -type d \( -name dist -o -name node_modules \) -prune \) -o \
  \( -type l -print -quit \))"
[[ -z "$build_symlink" ]] || fail "build input is a symlink: $build_symlink"
while IFS= read -r -d '' build_input; do
  git ls-files --error-unmatch -- "$build_input" >/dev/null 2>&1 ||
    fail "build input is not tracked: $build_input"
done < <(
  find apps packages \
    \( -type d \( -name dist -o -name node_modules \) -prune \) -o \
    \( -type f ! -name '*.tsbuildinfo' -print0 \)
)

# Vite copies public/ recursively. Validate that boundary before building so an
# ignored local note, credential, or symlink can never be materialized in dist
# and then mistaken for generated output.
if [[ -d apps/web/public ]]; then
  public_symlink="$(find apps/web/public -type l -print -quit)"
  [[ -z "$public_symlink" ]] || fail "public input is a symlink: $public_symlink"
  while IFS= read -r -d '' public_file; do
    git ls-files --error-unmatch -- "$public_file" >/dev/null 2>&1 ||
      fail "public input is not tracked: $public_file"
  done < <(find apps/web/public -type f -print0)
fi

if [[ "$SKIP_BUILD" == false ]]; then
  pnpm build
fi

API_BUILD="apps/api/dist/server.mjs"
WEB_BUILD="apps/web/dist/index.html"
[[ -s "$API_BUILD" ]] || fail "missing or empty API build: $API_BUILD"
[[ -s "$WEB_BUILD" ]] || fail "missing or empty web build: $WEB_BUILD"

if [[ "$SKIP_BUILD" == true ]]; then
  while IFS= read -r -d '' build_input; do
    if [[ "$build_input" -nt "$API_BUILD" || "$build_input" -nt "$WEB_BUILD" ]]; then
      fail "--skip-build cannot package stale output; rebuild after: $build_input"
    fi
  done < <(
    git ls-files -z -- \
      package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json \
      apps/api/package.json apps/api/src \
      apps/web/index.html apps/web/package.json apps/web/public apps/web/src \
      apps/web/tsconfig.json apps/web/vite.config.ts packages data/mock data/sources.yaml \
      vendor/masa
  )
fi

dist_symlink="$(find apps/api/dist apps/web/dist -type l -print -quit)"
[[ -z "$dist_symlink" ]] || fail "build output is a symlink: $dist_symlink"

STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
ARCHIVE="$OUT_DIR/cosmoaudition-system-local-$STAMP.tgz"
MANIFEST="$(mktemp "${TMPDIR:-/tmp}/cosmoaudition-package.XXXXXX")"

cleanup() {
  rm -f "$MANIFEST"
}
trap cleanup EXIT

mkdir -p "$OUT_DIR"

RELEASE_INPUTS=(
  .gitignore
  AGENTS.md
  CHANGELOG.md
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

# Only tracked files inside the explicit public-release allowlist may enter the
# archive. Passing whole directories to tar would also collect ignored local
# files placed below them (for example apps/api/.env), even though those files
# are correctly absent from Git.
while IFS= read -r -d '' tracked_file; do
  if [[ -L "$tracked_file" ]]; then
    fail "tracked release input is a symlink: $tracked_file"
  fi
  # A deliberate uncommitted deletion is still present in Git's index until
  # commit time. Package the worktree that was actually reviewed, not the old
  # indexed file that no longer exists.
  [[ -f "$tracked_file" ]] && printf '%s\0' "$tracked_file" >>"$MANIFEST"
done < <(git ls-files -z -- "${RELEASE_INPUTS[@]}")

# Build output is intentionally ignored by Git. Accept only the exact server
# entry, Vite's hashed code assets, and byte-identical copies of tracked public
# files. A newly generated or ignored file cannot expand this allowlist.
web_javascript_count=0
web_css_count=0
while IFS= read -r -d '' dist_file; do
  case "$dist_file" in
    apps/api/dist/server.mjs|apps/web/dist/index.html|apps/web/dist/cosmoaudition-build.json)
      ;;
    apps/web/dist/assets/*.js)
      web_javascript_count=$((web_javascript_count + 1))
      ;;
    apps/web/dist/assets/*.css)
      web_css_count=$((web_css_count + 1))
      ;;
    apps/web/dist/*)
      relative_public_path="${dist_file#apps/web/dist/}"
      public_source="apps/web/public/$relative_public_path"
      [[ -f "$public_source" ]] || fail "unexpected web build output: $dist_file"
      git ls-files --error-unmatch -- "$public_source" >/dev/null 2>&1 ||
        fail "web build copied an untracked public file: $dist_file"
      cmp -s "$public_source" "$dist_file" ||
        fail "web build output differs from tracked public input: $dist_file"
      ;;
    *)
      fail "unexpected build output: $dist_file"
      ;;
  esac
  printf '%s\0' "$dist_file" >>"$MANIFEST"
done < <(find apps/api/dist apps/web/dist -type f -print0)

(( web_javascript_count > 0 )) || fail "missing built web JavaScript asset"
(( web_css_count > 0 )) || fail "missing built web CSS asset"

if tar --version 2>&1 | grep -qi 'bsdtar'; then
  COPYFILE_DISABLE=1 tar \
    --no-xattrs --uid 0 --gid 0 --uname root --gname root \
    -czf "$ARCHIVE" --null -T "$MANIFEST"
else
  tar \
    --no-xattrs --no-acls --no-selinux --owner=0 --group=0 --numeric-owner \
    -czf "$ARCHIVE" --null -T "$MANIFEST"
fi

# Tell the verifier exactly which archive this invocation produced. Sorting a
# directory can accidentally select a manually named or future-dated stale
# archive instead of the artifact that just passed this script.
printf '%s\n' "$ARCHIVE" >"$OUT_DIR/.latest-cosmoaudition-archive"

printf '%s\n' "$ARCHIVE"
