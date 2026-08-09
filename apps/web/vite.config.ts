import process from "node:process";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8797";
const BUILD_BOUNDARY_FILE = "cosmoaudition-build.json";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function resolveLocalApiBaseUrl(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_API_BASE_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("VITE_API_BASE_URL must be an absolute loopback HTTP URL.");
  }
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "VITE_API_BASE_URL must be a credential-free loopback HTTP origin."
    );
  }
  return url.origin;
}

function buildBoundaryPlugin(apiBaseUrl: string): Plugin {
  return {
    name: "cosmoaudition-build-boundary",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: BUILD_BOUNDARY_FILE,
        source: `${JSON.stringify({ apiBaseUrl }, null, 2)}\n`
      });
    }
  };
}

export default defineConfig(() => {
  const apiBaseUrl = resolveLocalApiBaseUrl(process.env.VITE_API_BASE_URL);
  return {
    // Browser builds never read ignored .env files. An operator may still set
    // one explicit process variable, which is validated above as loopback-only.
    envDir: false as const,
    define: {
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiBaseUrl)
    },
    plugins: [react(), buildBoundaryPlugin(apiBaseUrl)],
    server: {
      host: "127.0.0.1",
      port: 5173
    }
  };
});
