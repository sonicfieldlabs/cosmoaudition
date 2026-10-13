import { describe, expect, it } from "vitest";
import { resolveLocalApiBaseUrl } from "../../vite.config";

describe("web build API boundary", () => {
  it("uses and normalizes only credential-free loopback HTTP origins", () => {
    expect(resolveLocalApiBaseUrl(undefined)).toBe("http://127.0.0.1:8797");
    expect(resolveLocalApiBaseUrl(" http://localhost:9000 ")).toBe(
      "http://localhost:9000"
    );
    expect(resolveLocalApiBaseUrl("http://[::1]:8797")).toBe(
      "http://[::1]:8797"
    );
  });

  it.each([
    "https://127.0.0.1:8797",
    "http://example.test:8797",
    "http://user:secret@localhost:8797",
    "http://localhost:8797/api",
    "http://localhost:8797/?token=secret"
  ])("refuses a non-local or credential-bearing build URL: %s", (value) => {
    expect(() => resolveLocalApiBaseUrl(value)).toThrow(
      /credential-free loopback HTTP origin/
    );
  });
});

// Integrity checks use disposable Git inputs, never the working repository.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const integrityModule = pathToFileURL(resolve("scripts/profile-local-build.mjs")).href;
const { beginBuild, recordBuild, verifyBuild } = await import(integrityModule);

function withBuild(check: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "cosmo-build-integrity-"));
  try {
    for (const directory of ["apps/api/dist", "apps/web/dist", "scripts"]) mkdirSync(join(root, directory), { recursive: true });
    for (const name of ["package.json", "pnpm-lock.yaml", "apps/api/vite.config.ts", "apps/api/tsconfig.json", "tsconfig.json"]) writeFileSync(join(root, name), "fixture input\n");
    execFileSync("git", ["init", "--quiet", root]);
    execFileSync("git", ["-C", root, "add", "package.json", "pnpm-lock.yaml", "apps/api/vite.config.ts", "apps/api/tsconfig.json", "tsconfig.json"]);
    beginBuild(root, {});
    writeFileSync(join(root, "apps/api/dist/server.mjs"), "fixture API output\n");
    writeFileSync(join(root, "apps/web/dist/index.html"), "fixture web output\n");
    recordBuild(root, {});
    check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("local build integrity", () => {
  it("accepts unchanged inputs and outputs", () => withBuild((root) => expect(() => verifyBuild(root, {})).not.toThrow()));

  it.each(["apps/api/vite.config.ts", "apps/api/tsconfig.json", "tsconfig.json", "pnpm-lock.yaml"])("rejects changed %s even with preserved timestamps", (name) => withBuild((root) => {
    const path = join(root, name);
    const before = statSync(path);
    writeFileSync(path, "changed input\n");
    utimesSync(path, before.atime, before.mtime);
    expect(() => verifyBuild(root, {})).toThrow(/Build inputs or outputs changed/);
  }));

  it("rejects changed output and added tracked inputs", () => withBuild((root) => {
    writeFileSync(join(root, "apps/api/dist/server.mjs"), "changed output\n");
    expect(() => verifyBuild(root, {})).toThrow();
    writeFileSync(join(root, "apps/api/dist/server.mjs"), "fixture API output\n");
    writeFileSync(join(root, "apps/api/new.config.ts"), "new input\n");
    execFileSync("git", ["-C", root, "add", "apps/api/new.config.ts"]);
    expect(() => verifyBuild(root, {})).toThrow();
  }));

  it("rejects environment drift and interrupted builds", () => withBuild((root) => {
    expect(() => verifyBuild(root, { VITE_API_BASE_URL: "http://127.0.0.1:9999" })).toThrow();
    beginBuild(root, {});
    expect(() => verifyBuild(root, {})).toThrow(/unfinished/);
    writeFileSync(join(root, "tsconfig.json"), "changed during build\n");
    expect(() => recordBuild(root, {})).toThrow(/changed during compilation/);
  }));

  it("refuses symlinked output instead of hashing a target", () => withBuild((root) => {
    rmSync(join(root, "apps/api/dist/server.mjs"));
    symlinkSync(join(root, "tsconfig.json"), join(root, "apps/api/dist/server.mjs"));
    expect(() => verifyBuild(root, {})).toThrow(/symlink/);
  }));
});
