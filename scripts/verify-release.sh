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

shopt -s nullglob
web_js=(apps/web/dist/assets/*.js)
web_css=(apps/web/dist/assets/*.css)
(( ${#web_js[@]} > 0 )) || fail "missing built web JavaScript asset"
(( ${#web_css[@]} > 0 )) || fail "missing built web CSS asset"
pass "web assets exist"

pnpm profile:local >"$TEMP_DIR/local-build-profile.json"
cat "$TEMP_DIR/local-build-profile.json"
pass "local build performance profile is within budget"

node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";

const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
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
NODE
pass "package scripts are present"

if grep -R -n -E 'navigator\.geolocation|getCurrentPosition|watchPosition|document\.cookie|gtag\(|posthog|plausible|mixpanel|amplitude' \
  apps/web/src apps/api/src packages tests >"$TEMP_DIR/release-policy-scan.txt"; then
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
  latest_archive="$(printf '%s\n' "${archives[@]}" | sort | tail -n 1)"
  require_file "$latest_archive"

  tar -tzf "$latest_archive" >"$TEMP_DIR/release-archive-list.txt"
  grep -q '^apps/api/dist/server\.mjs$' "$TEMP_DIR/release-archive-list.txt" ||
    fail "archive missing API build artifact"
  grep -q '^apps/web/dist/index\.html$' "$TEMP_DIR/release-archive-list.txt" ||
    fail "archive missing web build artifact"
  grep -q '^docs/deployment\.md$' "$TEMP_DIR/release-archive-list.txt" ||
    fail "archive missing deployment docs"

  if grep -E '(^|/)(\.git|node_modules|\.pnpm-store|test-results|playwright-report|\.playwright-cli)(/|$)|^release/|^private/|^data/cache/.+\.json$|^docs/(api-preflight\.md|audit-|decolonial-audit\.md|decisions/|demo/|design/|implementation-plan\.md|local-audit-|mappings/phase-|release-checklist\.md|release-notes\.md|roadmap\.md|source-expansion-)' \
    "$TEMP_DIR/release-archive-list.txt" >"$TEMP_DIR/release-archive-blocked.txt"; then
    cat "$TEMP_DIR/release-archive-blocked.txt" >&2
    fail "archive contains local-only or generated artifacts"
  fi
  pass "latest local archive contents are valid"
else
  pass "no local archive found; archive validation skipped"
fi

printf 'release verify passed\n'
