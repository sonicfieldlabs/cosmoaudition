#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";

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
