#!/usr/bin/env node
// Scans client/src for raw 6-digit hex (the un-themed long tail) and provides a
// --check ratchet: fails if any file listed in docs/theme-cleaned-files.txt
// reintroduces a disallowed hex. Brand gold (#d4a017) is allowed everywhere.
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ALLOWED_HEX = new Set(['#d4a017']); // brand gold stays constant
const HEX = /#[0-9a-fA-F]{6}\b/g;

/** Pure: all disallowed raw hex in `text` (excludes ALLOWED_HEX, case-insensitive). */
export function findDisallowedHex(text) {
  const matches = text.match(HEX) || [];
  return matches.filter((h) => !ALLOWED_HEX.has(h.toLowerCase()));
}

export function listClientFiles() {
  return execSync('git ls-files client/src', { encoding: 'utf8' })
    .split('\n').filter((f) => /\.(tsx?|css)$/.test(f));
}

function readAllowlist(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n')
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

function main() {
  const check = process.argv.includes('--check');
  let total = 0;
  const perFile = [];
  for (const f of listClientFiles()) {
    let txt; try { txt = readFileSync(f, 'utf8'); } catch { continue; }
    const n = findDisallowedHex(txt).length;
    if (n) { perFile.push([f, n]); total += n; }
  }
  perFile.sort((a, b) => b[1] - a[1]);
  console.log(`Raw disallowed hex: ${total} across ${perFile.length} files`);
  for (const [f, n] of perFile.slice(0, 50)) console.log(`${String(n).padStart(5)}  ${f}`);

  if (check) {
    const cleaned = readAllowlist('docs/theme-cleaned-files.txt');
    const offenders = [];
    for (const f of cleaned) {
      let txt; try { txt = readFileSync(f, 'utf8'); } catch { continue; }
      const bad = findDisallowedHex(txt);
      if (bad.length) offenders.push([f, [...new Set(bad)]]);
    }
    if (offenders.length) {
      console.error('\n❌ Theme ratchet: cleaned files reintroduced disallowed hex:');
      for (const [f, bad] of offenders) console.error(`   ${f}: ${bad.join(', ')}`);
      process.exit(1);
    }
    console.log(`✅ Theme ratchet: ${cleaned.length} cleaned file(s) hex-free.`);
  }
}

// Run main only when invoked directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
