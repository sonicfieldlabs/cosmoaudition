#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const inputRoots = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig*.json", "apps/api", "apps/web", "packages", "data/mock", "data/sources.yaml", "vendor/masa-0.2.2", "scripts"];
const integrityFile = ".build-integrity.json";
const startFile = ".build-inputs.json";
const hash = (value) => createHash("sha256").update(value).digest("hex");

function fileHashes(root, names) {
  return Object.fromEntries([...new Set(names)].sort().map((name) => {
    const file = join(root, name);
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) {
      throw new Error(`Build input/output is not a regular file: ${name}`);
    }
    return [name, hash(readFileSync(file))];
  }));
}

function outputs(root) {
  const names = [];
  function walk(directory) {
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
      throw new Error("Build output directory is not a regular directory");
    }
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (lstatSync(path).isSymbolicLink()) throw new Error("Build output contains a symlink");
      if (lstatSync(path).isDirectory()) walk(path);
      else names.push(relative(root, path).split("\\").join("/"));
    }
  }
  walk(join(root, "apps/api/dist"));
  walk(join(root, "apps/web/dist"));
  for (const name of ["apps/api/dist/server.mjs", "apps/web/dist/index.html"]) {
    if (!names.includes(name) || readFileSync(join(root, name)).length === 0) throw new Error(`Missing build output: ${name}`);
  }
  return fileHashes(root, names);
}

function inputs(root, environment) {
  const names = execFileSync("git", ["ls-files", "-z", "--", ...inputRoots], { cwd: root }).toString().split("\0").filter(Boolean);
  if (names.length === 0) throw new Error("No tracked build inputs");
  return {
    contract: "cosmoaudition/build-integrity/v1",
    node: process.version,
    environment_sha256: hash(JSON.stringify({
      NODE_ENV: environment.NODE_ENV ?? "production",
      VITE_API_BASE_URL: environment.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8797"
    })),
    files: fileHashes(root, names)
  };
}

function saveReceipt(root, name, value) {
  const temporary = join(root, `${name}.${process.pid}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, join(root, name));
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function beginBuild(root = process.cwd(), environment = process.env) {
  // Invalidate prior output proof before rebuilding, including failed builds.
  if (existsSync(join(root, integrityFile))) unlinkSync(join(root, integrityFile));
  saveReceipt(root, startFile, inputs(root, environment));
}

export function recordBuild(root = process.cwd(), environment = process.env) {
  const before = JSON.parse(readFileSync(join(root, startFile), "utf8"));
  const current = inputs(root, environment);
  if (JSON.stringify(before) !== JSON.stringify(current)) throw new Error("Build inputs changed during compilation; rebuild required");
  saveReceipt(root, integrityFile, { inputs: current, outputs: outputs(root) });
  unlinkSync(join(root, startFile));
}

export function verifyBuild(root = process.cwd(), environment = process.env) {
  if (existsSync(join(root, startFile))) throw new Error("A build is unfinished; rebuild required");
  if (!existsSync(join(root, integrityFile))) throw new Error("No build integrity receipt; run pnpm build before --skip-build");
  const receipt = JSON.parse(readFileSync(join(root, integrityFile), "utf8"));
  if (JSON.stringify(receipt.inputs) !== JSON.stringify(inputs(root, environment)) ||
      JSON.stringify(receipt.outputs) !== JSON.stringify(outputs(root))) {
    throw new Error("Build inputs or outputs changed; --skip-build requires pnpm build");
  }
}

import { gzipSync } from "node:zlib";

function profileBuild() {
  const assetDir = "apps/web/dist/assets";
  const budgets = {
    jsRawBytes: 420_000,
    jsGzipBytes: 125_000,
    cssRawBytes: 52_000,
    cssGzipBytes: 12_000,
    totalRawBytes: 490_000,
    totalGzipBytes: 142_000
  };

  function filesWithExtension(extension) {
    return readdirSync(assetDir)
      .filter((file) => file.endsWith(extension))
      .map((file) => join(assetDir, file));
  }

  function profileFiles(files) {
    return files.map((file) => {
      const buffer = readFileSync(file);

      return {
        file: basename(file),
        rawBytes: statSync(file).size,
        gzipBytes: gzipSync(buffer).byteLength
      };
    });
  }

  function sum(items, key) {
    return items.reduce((total, item) => total + item[key], 0);
  }

  function assertBudget(label, value, budget) {
    if (value > budget) {
      throw new Error(`${label} ${value} exceeds budget ${budget}`);
    }
  }

  const js = profileFiles(filesWithExtension(".js"));
  const css = profileFiles(filesWithExtension(".css"));

  if (js.length === 0) {
    throw new Error("No built JavaScript assets found.");
  }

  if (css.length === 0) {
    throw new Error("No built CSS assets found.");
  }

  const totals = {
    jsRawBytes: sum(js, "rawBytes"),
    jsGzipBytes: sum(js, "gzipBytes"),
    cssRawBytes: sum(css, "rawBytes"),
    cssGzipBytes: sum(css, "gzipBytes")
  };

  totals.totalRawBytes = totals.jsRawBytes + totals.cssRawBytes;
  totals.totalGzipBytes = totals.jsGzipBytes + totals.cssGzipBytes;

  for (const [key, budget] of Object.entries(budgets)) {
    assertBudget(key, totals[key], budget);
  }

  console.log(
    JSON.stringify(
      {
        status: "passed",
        budgets,
        totals,
        assets: { js, css }
      },
      null,
      2
    )
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === "--begin-build") beginBuild();
  else if (mode === "--record-build") recordBuild();
  else if (mode === "--verify-build") verifyBuild();
  else if (mode === undefined) profileBuild();
  else throw new Error("Unknown local build profile mode");
}
