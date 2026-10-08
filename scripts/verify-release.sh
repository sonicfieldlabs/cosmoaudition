#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cosmoaudition-verify.XXXXXX")"
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

fail() {
  printf 'release verify failed: %s\n' "$1" >&2
  exit 1
}

pass() {
  printf 'ok: %s\n' "$1"
}

require_file() {
  local file="$1"
  [[ -s "$file" ]] || fail "missing or empty file: $file"
  pass "$file exists"
}

require_file "apps/api/dist/server.mjs"
require_file "apps/web/dist/index.html"
require_file "apps/web/dist/cosmoaudition-build.json"

shopt -s nullglob
web_js=(apps/web/dist/assets/*.js)
web_css=(apps/web/dist/assets/*.css)
(( ${#web_js[@]} > 0 )) || fail "missing built web JavaScript asset"
(( ${#web_css[@]} > 0 )) || fail "missing built web CSS asset"
pass "web assets exist"

(cd vendor/masa-0.2.2 && shasum -a 256 -c CHECKSUMS.sha256) \
  >"$TEMP_DIR/masa-checksums.txt" || {
    cat "$TEMP_DIR/masa-checksums.txt" >&2
    fail "vendored MASA checksum verification failed"
  }
cat "$TEMP_DIR/masa-checksums.txt"
pass "vendored MASA artifacts match their reviewed checksums"

pnpm profile:local >"$TEMP_DIR/local-build-profile.json"
cat "$TEMP_DIR/local-build-profile.json"
pass "local build performance profile is within budget"

node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";

const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
const workspacePackages = [
  "apps/api/package.json",
  "apps/web/package.json",
  "packages/audio-engine/package.json",
  "packages/core/package.json",
  "packages/masa/package.json",
  "packages/midi-engine/package.json",
  "packages/ui-system/package.json"
].map((path) => [path, JSON.parse(readFileSync(path, "utf8"))]);
for (const [path, manifest] of workspacePackages) {
  if (manifest.version !== rootPackage.version) {
    throw new Error(`${path} version ${manifest.version} differs from root ${rootPackage.version}`);
  }
}
const requiredScripts = [
  "build",
  "build:api",
  "build:web",
  "e2e",
  "local:preview",
  "package:local",
  "profile:local",
  "preview:api",
  "preview:web",
  "release:check",
  "verify:release"
];

for (const script of requiredScripts) {
  if (typeof rootPackage.scripts?.[script] !== "string") {
    throw new Error(`missing package script: ${script}`);
  }
}

const apiPackage = JSON.parse(readFileSync("apps/api/package.json", "utf8"));
if (apiPackage.scripts?.start !== "node dist/server.mjs") {
  throw new Error("API start script must run node dist/server.mjs");
}

const buildBoundary = JSON.parse(
  readFileSync("apps/web/dist/cosmoaudition-build.json", "utf8")
);
const apiBaseUrl = new URL(buildBoundary.apiBaseUrl);
if (
  apiBaseUrl.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(apiBaseUrl.hostname.toLowerCase()) ||
  apiBaseUrl.username !== "" ||
  apiBaseUrl.password !== "" ||
  apiBaseUrl.pathname !== "/" ||
  apiBaseUrl.search !== "" ||
  apiBaseUrl.hash !== ""
) {
  throw new Error(
    "web build metadata does not declare a credential-free loopback HTTP origin"
  );
}

const releaseCheck = rootPackage.scripts?.["release:check"] ?? "";
for (const command of [
  "pnpm typecheck",
  "pnpm test",
  "pnpm build",
  "pnpm e2e",
  "pnpm package:local -- --skip-build",
  "pnpm verify:release",
  "pnpm audit --audit-level=high"
]) {
  if (!releaseCheck.includes(command)) {
    throw new Error(`release:check is missing required command: ${command}`);
  }
}
NODE
pass "package scripts and complete release gate are present"

if grep -R -n 'import\.meta\.env\.' apps/web/src \
  | grep -v 'import\.meta\.env\.VITE_API_BASE_URL' \
  >"$TEMP_DIR/web-env-scan.txt"; then
  cat "$TEMP_DIR/web-env-scan.txt" >&2
  fail "web source reads an undeclared build environment value"
fi
pass "web build reads only the validated local API origin"

if git grep -n -E 'navigator\.geolocation|getCurrentPosition|watchPosition|document\.cookie|gtag\(|posthog|plausible|mixpanel|amplitude' \
  -- apps/web/src apps/api/src packages tests >"$TEMP_DIR/release-policy-scan.txt"; then
  cat "$TEMP_DIR/release-policy-scan.txt" >&2
  fail "blocked browser tracking/geolocation pattern found"
fi
pass "source policy scan has no blocked geolocation/cookie/analytics calls"

if grep -R -n -E 'COSMOAUDITION_CORS_ORIGIN \?\? ["'\'']\*["'\'']|origin: ["'\'']\*["'\'']|HOST \?\? ["'\'']0\.0\.0\.0["'\'']' \
  apps/api/src >"$TEMP_DIR/local-only-scan.txt"; then
  cat "$TEMP_DIR/local-only-scan.txt" >&2
  fail "local-only API policy violation found"
fi
pass "API defaults stay local-only"

if grep -n -E '"[^"]*(deploy|vercel|netlify|wrangler|cloudflare)[^"]*":|"[^"]*": "[^"]*(vercel|netlify|wrangler|cloudflare| deploy)[^"]*"' \
  package.json apps/*/package.json >"$TEMP_DIR/deploy-script-scan.txt"; then
  cat "$TEMP_DIR/deploy-script-scan.txt" >&2
  fail "public deployment script found"
fi
pass "no public deployment scripts are present"

# The browser must reach providers only through the loopback gateway. Scanning
# the built bundle cannot decide this: provider hostnames legitimately appear
# there as displayed source attribution, and the app's own calls are template
# literals that a string-literal pattern could never match. Check the call
# sites in source instead — every browser fetch must target the API base URL.
if grep -R -n -E '\bfetch\(' apps/web/src >"$TEMP_DIR/web-fetch-sites.txt"; then
  if grep -v -E '\bfetch\(`\$\{apiBaseUrl\}' "$TEMP_DIR/web-fetch-sites.txt" \
    >"$TEMP_DIR/web-direct-fetch-scan.txt"; then
    cat "$TEMP_DIR/web-direct-fetch-scan.txt" >&2
    fail "web source contains a fetch that does not target the local API base URL"
  fi
fi
pass "every web fetch call targets the local API base URL"

archives=(release/cosmoaudition-system-local-*.tgz)
if (( ${#archives[@]} > 0 )); then
  archive_pointer="release/.latest-cosmoaudition-archive"
  if [[ -s "$archive_pointer" ]]; then
    IFS= read -r latest_archive <"$archive_pointer"
    [[ "$latest_archive" == release/cosmoaudition-system-local-*.tgz ]] ||
      fail "latest archive pointer is outside the local release directory"
  else
    latest_archive="$(printf '%s\n' "${archives[@]}" | sort | tail -n 1)"
  fi
  require_file "$latest_archive"

  tar -tzf "$latest_archive" >"$TEMP_DIR/release-archive-list.txt"
  if grep -E '(^/|(^|/)\.\.(/|$))' "$TEMP_DIR/release-archive-list.txt" \
    >"$TEMP_DIR/release-archive-unsafe-path.txt"; then
    cat "$TEMP_DIR/release-archive-unsafe-path.txt" >&2
    fail "archive contains an unsafe extraction path"
  fi
  archive_required_files=(
    AGENTS.md
    CHANGELOG.md
    LICENSE
    README.md
    package.json
    pnpm-lock.yaml
    pnpm-workspace.yaml
    apps/api/package.json
    apps/api/dist/server.mjs
    apps/web/package.json
    apps/web/dist/index.html
    apps/web/dist/cosmoaudition-build.json
    packages/audio-engine/package.json
    packages/core/package.json
    packages/masa/package.json
    packages/midi-engine/package.json
    packages/ui-system/package.json
    docs/deployment.md
    vendor/masa-0.2.2/CHECKSUMS.sha256
    vendor/masa-0.2.2/README.md
    vendor/masa-0.2.2/PROVENANCE.json
    vendor/masa-0.2.2/sonicfield-masa-0.2.2.tgz
    vendor/masa-0.2.2/sonicfield-masa-validator-0.2.2.tgz
  )
  for required_entry in "${archive_required_files[@]}"; do
    grep -Fxq "$required_entry" "$TEMP_DIR/release-archive-list.txt" ||
      fail "archive missing required file: $required_entry"
  done
  if grep -E '^vendor/masa[^/]*/.*\.tgz$' "$TEMP_DIR/release-archive-list.txt" \
    | grep -v -E '^vendor/masa-0\.2\.2/sonicfield-masa(-validator)?-0\.2\.2\.tgz$' \
    >"$TEMP_DIR/release-archive-extra-masa.txt"; then
    cat "$TEMP_DIR/release-archive-extra-masa.txt" >&2
    fail "archive contains an unexpected MASA package"
  fi

  if grep -E '(^|/)(\.git|node_modules|\.pnpm-store|test-results|playwright-report|\.playwright-cli|\.DS_Store)(/|$)|(^|/)\.env($|[./])|(^|/)(id_(rsa|dsa|ecdsa|ed25519)|[^/]+\.(key|pem|p12|pfx|jks|keystore|log))$|^release/|(^|/)private(/|$)|^data/cache/.+\.json$|^docs/(api-preflight\.md|audit-|decolonial-audit\.md|decisions/|demo/|design/|implementation-plan\.md|local-audit-|mappings/phase-|release-checklist\.md|release-notes\.md|roadmap\.md|source-expansion-)' \
    "$TEMP_DIR/release-archive-list.txt" >"$TEMP_DIR/release-archive-blocked.txt"; then
    cat "$TEMP_DIR/release-archive-blocked.txt" >&2
    fail "archive contains local-only or generated artifacts"
  fi
  pass "latest local archive contents are valid"

  tar -tvzf "$latest_archive" >"$TEMP_DIR/release-archive-details.txt"
  if grep -E '^[lh]' "$TEMP_DIR/release-archive-details.txt" \
    >"$TEMP_DIR/release-archive-links.txt"; then
    cat "$TEMP_DIR/release-archive-links.txt" >&2
    fail "archive contains a symbolic or hard link"
  fi

  archive_root="$TEMP_DIR/archive"
  mkdir -p "$archive_root"
  tar -xzf "$latest_archive" -C "$archive_root"
  archive_symlink="$(find "$archive_root" -type l -print -quit)"
  [[ -z "$archive_symlink" ]] ||
    fail "archive contains a symlink: ${archive_symlink#"$archive_root"/}"
  for required_entry in "${archive_required_files[@]}"; do
    [[ -s "$archive_root/$required_entry" ]] ||
      fail "extracted required file is missing or empty: $required_entry"
  done
  (cd "$archive_root/vendor/masa-0.2.2" && shasum -a 256 -c CHECKSUMS.sha256) \
    >"$TEMP_DIR/archive-masa-checksums.txt" || {
      cat "$TEMP_DIR/archive-masa-checksums.txt" >&2
      fail "archived MASA artifacts do not match the archived checksums"
    }
  cat "$TEMP_DIR/archive-masa-checksums.txt"
  pass "archive carries exactly the two verified MASA 0.2.2 tooling packages (protocol 0.2.0)"

  unexpected_archive_entry=""
  while IFS= read -r entry; do
    case "$entry" in
      apps/api/dist/server.mjs|apps/web/dist/index.html|apps/web/dist/cosmoaudition-build.json|apps/web/dist/assets/*.js|apps/web/dist/assets/*.css)
        ;;
      apps/web/dist/*)
        relative_public_path="${entry#apps/web/dist/}"
        public_source="apps/web/public/$relative_public_path"
        if ! git ls-files --error-unmatch -- "$public_source" >/dev/null 2>&1 ||
          [[ ! -f "$public_source" ]] ||
          ! cmp -s "$public_source" "$archive_root/$entry"; then
          unexpected_archive_entry="$entry"
          break
        fi
        ;;
      apps/api/dist/*)
        unexpected_archive_entry="$entry"
        break
        ;;
      *)
        if ! git ls-files --error-unmatch -- "$entry" >/dev/null 2>&1; then
          unexpected_archive_entry="$entry"
          break
        fi
        ;;
    esac
  done <"$TEMP_DIR/release-archive-list.txt"
  [[ -z "$unexpected_archive_entry" ]] ||
    fail "archive contains an untracked or unexpected file: $unexpected_archive_entry"
  pass "archive contains only tracked allowlisted files and fresh build output"

  if grep -R -I -n -E -- '/Users/[A-Za-z0-9._-]+/|/home/[A-Za-z0-9._-]+/|-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----' \
    "$archive_root" >"$TEMP_DIR/release-archive-private-content.txt"; then
    cat "$TEMP_DIR/release-archive-private-content.txt" >&2
    fail "archive contains a local home path or private-key material"
  fi
  pass "archive content contains no local home paths or private-key material"
else
  pass "no local archive found; archive validation skipped"
fi

printf 'release verify passed\n'
