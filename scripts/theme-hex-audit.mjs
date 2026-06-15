#!/usr/bin/env node
// Scans client/src for raw 6-digit hex in likely color contexts (className
// strings, style props, CSS) to size the un-themed long tail (Phase 2/3).
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync('git ls-files client/src', { encoding: 'utf8' })
  .split('\n').filter((f) => /\.(tsx?|css)$/.test(f));

const HEX = /#[0-9a-fA-F]{6}\b/g;
let total = 0;
const perFile = [];
for (const f of files) {
  let txt;
  try { txt = readFileSync(f, 'utf8'); } catch { continue; }
  const matches = txt.match(HEX) || [];
  if (matches.length) { perFile.push([f, matches.length]); total += matches.length; }
}
perFile.sort((a, b) => b[1] - a[1]);
console.log(`Raw 6-digit hex occurrences: ${total} across ${perFile.length} files`);
for (const [f, n] of perFile.slice(0, 50)) console.log(`${String(n).padStart(5)}  ${f}`);
