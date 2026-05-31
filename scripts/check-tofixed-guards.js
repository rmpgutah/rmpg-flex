#!/usr/bin/env node
/**
 * check-tofixed-guards.js
 *
 * Fails CI on the recurring "Cannot read properties of undefined (reading
 * 'toFixed')" crash class in the client. There is no ESLint in this repo
 * (see the `project-no-eslint` note), so this is a targeted grep-guard.
 *
 * It flags the **false-guard** pattern only — high signal, near-zero false
 * positives:
 *
 *     summary ? summary.total_gallons.toFixed(3) : '-'
 *     ^^^^^^^   ^^^^^^^ tests the PARENT, then calls .toFixed on a child
 *
 * The ternary proves the *parent object* exists, but `.total_gallons` can
 * still be null/undefined, so `.toFixed` throws. This is exactly the bug that
 * shipped in the fleet bundle (FleetFuelTab) and the shape the repeated
 * total_cost band-aids kept chasing.
 *
 * Safe alternatives the team should use instead:
 *   - toNum(x).toFixed(n)            // coerces, never throws  (fleetFormatters)
 *   - fmtFixed(x, n)                 // display + dash fallback (fleetFormatters)
 *   - x?.toFixed(n)                  // optional chain on the NUMBER itself
 *   - x != null ? x.toFixed(n) : …   // guard the number, not its parent
 *
 * Usage: node scripts/check-tofixed-guards.js
 *   exits 0 = clean, 1 = violation found
 *
 * Run by .github/workflows/tofixed-guard-check.yml on PRs touching client/src.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'client', 'src');

// IDENT ? IDENT.PROP[.PROP…].toFixed(   — same identifier on both sides of `?`.
// The \1 backreference is what makes this precise: it only matches when the
// ternary test and the .toFixed receiver share the same root object.
const FALSE_GUARD = /\b([A-Za-z_$][\w$]*)\s*\?\s*\1(?:\.[\w$]+)+\.toFixed\s*\(/;

/** Recursively collect .ts/.tsx files under dir. */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Blank out comments so doc-comments / explanatory text that *mention* the
 * forbidden pattern (like this file and fleetFormatters' JSDoc) aren't flagged.
 * Block comments are replaced with same-length blanks to preserve line numbers;
 * line comments are truncated at `//`. Not a full JS parser — good enough to
 * avoid the only realistic false positive (prose), with no risk of hiding real
 * code, which never lives inside a comment.
 */
function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlock
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const violations = [];
for (const file of walk(ROOT)) {
  const lines = stripComments(fs.readFileSync(file, 'utf-8')).split('\n');
  lines.forEach((line, i) => {
    if (FALSE_GUARD.test(line)) {
      violations.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length) {
  console.error('\n✖ False-guard .toFixed() pattern found (parent checked, child unguarded):\n');
  for (const v of violations) console.error('  ' + v);
  console.error(
    '\nThese crash when the inner property is null/undefined.\n' +
    'Fix by guarding the NUMBER, not its parent — e.g. `toNum(x).toFixed(n)`,\n' +
    '`fmtFixed(x, n)` (both in client/src/pages/fleet/utils/fleetFormatters.ts),\n' +
    'or `x?.toFixed(n)` / `x != null ? x.toFixed(n) : …`.\n'
  );
  process.exit(1);
}

console.log('✓ No false-guard .toFixed() patterns found.');
