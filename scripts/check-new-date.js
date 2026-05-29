#!/usr/bin/env node
// ============================================================
// check-new-date.js
// ============================================================
// CI guard against timezone-parsing regressions in the client.
//
// Background:
//   The server (Cloudflare Workers + D1) stores timestamps as naive
//   UTC strings like "2026-05-29 14:30:00". V8's `new Date(str)` parses
//   a naive (no-offset) string as device-LOCAL, yielding an instant that
//   is ~6-7h off for Mountain Time viewers. The correct parser is
//   `parseTimestamp` from client/src/utils/dateUtils.ts, which interprets
//   naive strings as UTC. (The global enforceMountainTime.ts shim fixes
//   DISPLAY zone only — it cannot fix a mis-parsed instant.)
//
//   This guard flags NEWLY-ADDED `new Date(<identifier-or-member>)` call
//   sites (the shape that parses a server string) so they get a conscious
//   review. The ~400 pre-existing sites are grandfathered: only lines
//   added relative to the PR base branch are checked.
//
// Modes (mirrors scripts/check-column-cap.js):
//   1. BASE_SHA env set (workflow mode):
//      Diff client/src against BASE_SHA..HEAD and check ONLY added lines.
//      Empty diff → exit 0.
//   2. BASE_SHA unset (local debug mode):
//      Diff the working tree against HEAD (uncommitted changes) so you can
//      spot-check before committing; if there is no diff, scan the whole
//      client/src tree informationally (never fails in local mode).
//
// Escape hatch for genuine non-server-string Dates (epoch numbers,
// cloning a Date, or a local wall-clock value the user just typed in a
// <input type="datetime-local">): put `new-date-ok` in a comment on the
// same line, or call parseTimestamp on that line instead.
// ============================================================

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIR = 'client/src';

// `new Date(` whose argument starts with an identifier/member access
// (letter, _ or $) — i.e. a variable/field, not a number literal, not the
// no-arg `new Date()`. Excludes the two always-fine forms.
const FLAG_RE = /new Date\(\s*[A-Za-z_$]/;
// Always-fine numeric/clone forms: `new Date(Date.now()...)`, `new Date(new Date(...))`,
// and `new Date(x.getTime() + ...)` (epoch-ms arithmetic, not a string parse).
const ALLOW_RE = /new Date\(\s*(?:Date\.now|new Date)\b|new Date\([^)]*\.getTime\(\)/;
const OK_MARKER = 'new-date-ok';

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// Returns [{ file, line, text }] for every '+' line that matches the flag.
function addedHitsFromDiff(diffArgs) {
  let out = '';
  try {
    out = sh(`git diff --unified=0 ${diffArgs} -- ${SCAN_DIR}`);
  } catch {
    return [];
  }
  const hits = [];
  let curFile = null;
  let newLineNo = 0;
  for (const raw of out.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const m = raw.match(/^\+\+\+ b\/(.+)$/);
      curFile = m ? m[1] : null;
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/\+(\d+)/);
      newLineNo = m ? parseInt(m[1], 10) : 0;
      continue;
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      const text = raw.slice(1);
      if (isViolation(text) && curFile) {
        hits.push({ file: curFile, line: newLineNo, text: text.trim() });
      }
      newLineNo++;
    } else if (!raw.startsWith('-')) {
      // context line (unified=0 emits none, but be safe)
      newLineNo++;
    }
  }
  return hits;
}

function isViolation(text) {
  if (!FLAG_RE.test(text)) return false;
  if (ALLOW_RE.test(text)) return false;
  if (text.includes(OK_MARKER)) return false;
  // A line that already routes through the correct parser is fine.
  if (text.includes('parseTimestamp(')) return false;
  return true;
}

function scanWholeTree() {
  // Local informational fallback: walk client/src and report all hits.
  const hits = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(ent.name)) {
        const lines = fs.readFileSync(full, 'utf8').split('\n');
        lines.forEach((text, i) => {
          if (isViolation(text)) {
            hits.push({ file: path.relative(ROOT, full), line: i + 1, text: text.trim() });
          }
        });
      }
    }
  };
  walk(path.join(ROOT, SCAN_DIR));
  return hits;
}

function report(hits) {
  for (const h of hits) {
    console.error(`  - ${h.file}:${h.line}\n      ${h.text}`);
  }
}

function main() {
  const workflow = 'BASE_SHA' in process.env && process.env.BASE_SHA;

  if (workflow) {
    console.log('[new-date-check] mode: workflow (base ' + process.env.BASE_SHA.slice(0, 8) + ')');
    const hits = addedHitsFromDiff(`${process.env.BASE_SHA} HEAD`);
    if (hits.length === 0) {
      console.log('[new-date-check] OK — no newly-added `new Date(<field>)` on a server string');
      process.exit(0);
    }
    console.error('');
    console.error('[new-date-check] FAIL — ' + hits.length + ' newly-added `new Date(<field>)` site(s):');
    report(hits);
    console.error('');
    console.error('Server timestamps are naive UTC ("YYYY-MM-DD HH:MM:SS"). `new Date(str)`');
    console.error('parses naive strings as device-LOCAL → the instant is ~6-7h off in Mountain');
    console.error('Time. Use parseTimestamp() from client/src/utils/dateUtils.ts (or a display');
    console.error('helper: formatDateTime/safeDateTimeStr/safeDateStr/safeTimeStr).');
    console.error('');
    console.error('If the argument is genuinely NOT a server string (epoch number, a Date being');
    console.error('cloned, or a local wall-clock value from a datetime-local input), add a');
    console.error('`' + OK_MARKER + '` comment on that line to acknowledge it.');
    process.exit(1);
  }

  // Local debug mode.
  console.log('[new-date-check] mode: local');
  let hits = addedHitsFromDiff('HEAD');
  let scope = 'uncommitted changes vs HEAD';
  if (hits.length === 0) {
    hits = scanWholeTree();
    scope = 'whole ' + SCAN_DIR + ' tree';
  }
  if (hits.length === 0) {
    console.log('[new-date-check] OK — no `new Date(<field>)` hits (' + scope + ')');
    process.exit(0);
  }
  console.log('[new-date-check] local mode — ' + hits.length + ' hit(s) (' + scope + '), informational:');
  report(hits.slice(0, 40));
  if (hits.length > 40) console.log('  ... and ' + (hits.length - 40) + ' more');
  console.log('[new-date-check] OK — local mode never fails (grandfathered sites expected)');
  process.exit(0);
}

main();
