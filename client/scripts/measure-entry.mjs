#!/usr/bin/env node
// Measures the production entry chunk and attributes its bytes to source
// modules via the sourcemap's sourcesContent. This is the numeric gate for
// the load-time work — "feels faster" is not a measurement.
//
// Requires a prior `vite build --sourcemap`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import path from 'node:path';

const ASSETS = path.join(process.cwd(), 'dist', 'assets');

function findEntry() {
  const files = readdirSync(ASSETS);
  const js = files.filter((f) => /^index-.*\.js$/.test(f));
  if (js.length !== 1) {
    throw new Error(`Expected exactly 1 index-*.js in ${ASSETS}, found ${js.length}. Run: npx vite build --sourcemap`);
  }
  return js[0];
}

function attribute(mapPath) {
  const map = JSON.parse(readFileSync(mapPath, 'utf-8'));
  const contents = map.sourcesContent || [];
  const totals = new Map();
  map.sources.forEach((src, i) => {
    const content = contents[i];
    if (content == null) return;
    const key = src.replace(/^(\.\.\/)+/, '');
    totals.set(key, (totals.get(key) || 0) + content.length);
  });
  return totals;
}

const args = process.argv.slice(2);
const maxRawIdx = args.indexOf('--max-raw');
let maxRaw = null;
if (maxRawIdx !== -1) {
  const rawArg = args[maxRawIdx + 1];
  const parsed = Number(rawArg);
  if (rawArg === undefined || !Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    console.error(`FAIL: --max-raw requires a positive integer byte count, got ${JSON.stringify(rawArg)}`);
    process.exit(1);
  }
  maxRaw = parsed;
}
const asJson = args.includes('--json');

const entry = findEntry();
const entryPath = path.join(ASSETS, entry);
const raw = statSync(entryPath).size;
const brotli = brotliCompressSync(readFileSync(entryPath)).length;

let totals = new Map();
try {
  totals = attribute(`${entryPath}.map`);
} catch {
  // Sourcemap absent (plain `vite build`). Size numbers are still valid;
  // attribution is simply unavailable.
}
const sourceBytes = [...totals.values()].reduce((a, b) => a + b, 0);

if (asJson) {
  console.log(JSON.stringify({ entry, raw, brotli, moduleCount: totals.size, sourceBytes }, null, 2));
} else {
  console.log(`entry:    ${entry}`);
  console.log(`raw:      ${(raw / 1024).toFixed(1)} KB`);
  console.log(`brotli:   ${(brotli / 1024).toFixed(1)} KB`);
  console.log(`modules:  ${totals.size} (${(sourceBytes / 1024).toFixed(0)} KB of source)`);
  if (totals.size) {
    console.log('\ntop 25 eager modules by source bytes:');
    [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .forEach(([k, v]) => console.log(`  ${(v / 1024).toFixed(1).padStart(8)} KB  ${k}`));
  }
}

if (maxRaw !== null && raw > maxRaw) {
  console.error(`\nFAIL: entry chunk ${raw} B exceeds ceiling ${maxRaw} B (over by ${((raw - maxRaw) / 1024).toFixed(1)} KB)`);
  process.exit(1);
}
