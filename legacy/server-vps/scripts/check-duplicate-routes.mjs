#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Duplicate route handler detector — hard block on any METHOD+path duplicate.
//
// Context: in Express, `router.get('/foo', h1)` followed later by another
// `router.get('/foo', h2)` in the same file registers BOTH handlers but only
// the FIRST will ever execute on a request. The second is dead code that
// (a) inflates bundle/module size, (b) confuses static analysis tools, and
// (c) gets reintroduced every time a stale worktree is merged into main.
//
// This script scans all server route files, detects duplicate
// METHOD+path registrations, and exits non-zero with a readable report.
//
// Why zero dependencies: so this can run during CI install BEFORE npm install
// has finished. A broken node_modules must not be able to mask a duplicate
// handler regression.
//
// Usage:
//   node server/scripts/check-duplicate-routes.mjs
//   npm run check:routes    (via server/package.json)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROUTE_DIR = resolve(process.cwd(), 'src/routes');

// Matches `router.METHOD('path'` or `router.METHOD("path"` at the start of a line.
// The anchor `^router\.` is important — it skips `app.use`, `.then`, etc.
const ROUTE_PATTERN = /^router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)/;

function walkRouteFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (e) {
    console.error(`[check-routes] Could not read directory: ${dir}`);
    console.error(`[check-routes] ${e.message}`);
    console.error(`[check-routes] This script must be run from the server/ dir.`);
    process.exit(2);
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkRouteFiles(full));
    } else if (st.isFile() && name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function findDuplicatesInFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const seen = new Map(); // key = "METHOD /path" → first line number (1-indexed)
  const duplicates = []; // [{ key, firstLine, dupLine }]

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ROUTE_PATTERN);
    if (!m) continue;
    const key = `${m[1].toUpperCase()} ${m[2]}`;
    if (seen.has(key)) {
      duplicates.push({
        key,
        firstLine: seen.get(key),
        dupLine: i + 1,
      });
    } else {
      seen.set(key, i + 1);
    }
  }

  return duplicates;
}

// ── main ────────────────────────────────────────────────────────────────────

const files = walkRouteFiles(ROUTE_DIR);
let totalDupes = 0;
const report = [];

for (const file of files) {
  const dupes = findDuplicatesInFile(file);
  if (dupes.length > 0) {
    totalDupes += dupes.length;
    report.push({ file: relative(process.cwd(), file), dupes });
  }
}

if (totalDupes === 0) {
  console.log(`✓ check-duplicate-routes: ${files.length} route files scanned, 0 duplicate METHOD+path handlers.`);
  process.exit(0);
}

// Found duplicates — print actionable report and fail.
console.error('');
console.error('━'.repeat(78));
console.error(`✗ DUPLICATE ROUTE HANDLERS DETECTED (${totalDupes} across ${report.length} files)`);
console.error('━'.repeat(78));
console.error('');
console.error('In Express, only the FIRST matching route handler runs. Later duplicates');
console.error('are dead code — likely reintroduced by a stale-branch merge. Remove the');
console.error('duplicate lines (keep the first occurrence).');
console.error('');

for (const { file, dupes } of report) {
  console.error(`  ${file}`);
  for (const d of dupes) {
    console.error(`    ${d.key.padEnd(40)}  first: line ${d.firstLine}, duplicate: line ${d.dupLine}`);
  }
  console.error('');
}

console.error('━'.repeat(78));
console.error('To fix: edit the file(s) above and delete the duplicate handler blocks,');
console.error('or run the dedup script referenced in docs/dedup-routes.md if present.');
console.error('━'.repeat(78));
process.exit(1);
