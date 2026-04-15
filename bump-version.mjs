#!/usr/bin/env node

// Usage: node bump-version.js <version>
// Example: node bump-version.js 0.2.0
//
// Updates the version in both packages and creates a git tag.

import { readFileSync, writeFileSync } from "fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error("Usage: node bump-version.mjs <version>  (e.g. 0.2.0)");
  process.exit(1);
}

// Update deno.json
const denoPath = "packages/deno/deno.json";
const deno = JSON.parse(readFileSync(denoPath, "utf-8"));
const oldVersion = deno.version;
deno.version = version;
writeFileSync(denoPath, JSON.stringify(deno, null, 2) + "\n");
console.log(`${denoPath}: ${oldVersion} → ${version}`);

// Update pyproject.toml
const pyPath = "packages/python/pyproject.toml";
let py = readFileSync(pyPath, "utf-8");
py = py.replace(/^version\s*=\s*".*"/m, `version = "${version}"`);
writeFileSync(pyPath, py);
console.log(`${pyPath}: → ${version}`);

console.log(`\nDone. Now run:\n  git add -A && git commit -m "v${version}" && git tag -a v${version} -m "v${version}" && git push --follow-tags`);
