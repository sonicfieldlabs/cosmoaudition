#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_HOST="127.0.0.1"

find_free_port() {
  local preferred="$1"
  local avoid="${2:-}"

  node -e '
const net = require("node:net");
const host = "127.0.0.1";
const preferred = Number(process.argv[1]);
const avoid = new Set(
  process.argv
    .slice(2)
    .filter((value) => value.trim() !== "")
    .map(Number)
    .filter(Number.isFinite)
);

function tryListen(port) {
  if (avoid.has(port)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(null));
    server.listen({ host, port }, () => {
      const address = server.address();
      const selected = typeof address === "object" && address ? address.port : null;
      server.close(() => resolve(selected));
    });
  });
}

(async () => {
  const preferredPort = await tryListen(preferred);
  if (preferredPort !== null) {
    console.log(preferredPort);
    return;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const fallbackPort = await tryListen(0);
    if (fallbackPort !== null && !avoid.has(fallbackPort)) {
      console.log(fallbackPort);
      return;
    }
  }

  process.exit(1);
})();
' "$preferred" "$avoid"
}

API_PORT="${API_PORT:-$(find_free_port 8797)}"
WEB_PORT="${WEB_PORT:-$(find_free_port 4173 "$API_PORT")}"
API_BASE_URL="http://${API_HOST}:${API_PORT}"
WEB_URL="http://127.0.0.1:${WEB_PORT}"
WEB_LOCALHOST_URL="http://localhost:${WEB_PORT}"

if [[ -n "${COSMOAUDITION_CORS_ORIGIN:-}" ]]; then
  API_CORS_ORIGIN="${COSMOAUDITION_CORS_ORIGIN},${WEB_URL},${WEB_LOCALHOST_URL}"
else
  API_CORS_ORIGIN="${WEB_URL},${WEB_LOCALHOST_URL}"
fi

api_pid=""
web_pid=""

# The recorded pids belong to the pnpm wrappers. Killing only those leaves the
# real server grandchildren bound to their ports, so the next preview run picks
# different ports and two APIs end up serving with different CORS allowlists.
# Walk the child tree first (portable across macOS and Linux; setsid is not),
# then signal the wrapper itself.
stop_tree() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  kill -0 "$pid" 2>/dev/null || return 0

  local child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    stop_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  stop_tree "$web_pid"
  stop_tree "$api_pid"
}

wait_for_url() {
  local url="$1"
  local label="$2"

  for _ in {1..40}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      printf '%s ready: %s\n' "$label" "$url"
      return 0
    fi
    sleep 0.25
  done

  printf '%s did not become ready: %s\n' "$label" "$url" >&2
  return 1
}

trap cleanup EXIT INT TERM

printf 'Building local-only release artifacts...\n'
pnpm build:api
VITE_API_BASE_URL="$API_BASE_URL" pnpm build:web

printf 'Starting local-only API on %s...\n' "$API_BASE_URL"
HOST="$API_HOST" PORT="$API_PORT" COSMOAUDITION_CORS_ORIGIN="$API_CORS_ORIGIN" pnpm --filter @cosmoaudition/api start &
api_pid="$!"
wait_for_url "${API_BASE_URL}/health" "API"

printf 'Starting local-only web preview on %s...\n' "$WEB_URL"
pnpm --filter @cosmoaudition/web exec vite preview --host 127.0.0.1 --port "$WEB_PORT" &
web_pid="$!"
wait_for_url "$WEB_URL" "Web"

cat <<EOF

Cosmoaudition System is running locally only.

Web: ${WEB_URL}
API: ${API_BASE_URL}

Press Ctrl-C to stop both processes.
EOF

while true; do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    wait "$api_pid"
    exit $?
  fi

  if ! kill -0 "$web_pid" 2>/dev/null; then
    wait "$web_pid"
    exit $?
  fi

  sleep 1
done
