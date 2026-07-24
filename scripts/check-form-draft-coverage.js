#!/usr/bin/env node
/**
 * check-form-draft-coverage.js
 *
 * Enforces the "filler" data-entry persistence pattern: any modal/form
 * component that actually saves a record (POST/PUT/PATCH via apiFetch) must
 * use the shared `useFormDraft` hook (client/src/hooks/useFormDraft.ts) so
 * typed-in data survives a lost connection, an accidental close, or a
 * cleared browser instead of being silently discarded. useFormDraft is now
 * D1-backed (see /api/form-drafts + migrations/0205_form_drafts.sql), so
 * wiring it in also gets the form cross-device draft recovery for free.
 *
 * This is a targeted grep-guard, same style/pragmatic trade-offs as the
 * other scripts in this file (check-array-guards.js, check-tofixed-guards.js)
 * — no ESLint in this repo (see project-no-eslint).
 *
 * Scope: files matching `*FormModal.tsx` anywhere under client/src, plus
 * any `*.tsx` directly under a `.../modals/` directory. A file is flagged
 * only if it both (a) calls apiFetch with a mutating method, i.e. it's an
 * actual save-capable form, and (b) does not import useFormDraft.
 *
 * Known exceptions (generic shells, read-only viewers, single-field
 * confirm-style modals) are listed in scripts/form-draft-coverage-baseline.json
 * with a one-line reason — same allowlist pattern as column-cap-baseline.json.
 *
 * Usage: node scripts/check-form-draft-coverage.js
 *   exits 0 = clean, 1 = violation found
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'client', 'src');
const BASELINE_PATH = path.join(__dirname, 'form-draft-coverage-baseline.json');

const MUTATING_APIFETCH = /apiFetch(?:Form)?[\s\S]{0,80}?method:\s*['"](POST|PUT|PATCH)['"]/;

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return new Set();
  const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
  return new Set((parsed.exceptions || []).map((e) => e.file));
}

function isTargetFile(relPath) {
  const base = path.basename(relPath);
  if (/FormModal\.tsx$/.test(base)) return true;
  if (/\.tsx$/.test(base) && path.basename(path.dirname(relPath)) === 'modals') return true;
  return false;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(full, out);
    } else if (/\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const baseline = loadBaseline();
  const violations = [];

  for (const file of walk(ROOT)) {
    const rel = path.relative(process.cwd(), file);
    const relFromClientSrc = path.relative(ROOT, file);
    if (!isTargetFile(rel)) continue;
    if (baseline.has(relFromClientSrc)) continue;

    const src = fs.readFileSync(file, 'utf-8');
    if (!MUTATING_APIFETCH.test(src)) continue; // not a save-capable form
    if (/from ['"][^'"]*hooks\/useFormDraft['"]/.test(src)) continue; // already wired

    violations.push(rel);
  }

  if (violations.length) {
    console.error('\n✖ Save-capable form modal(s) missing useFormDraft (D1-backed draft persistence):\n');
    for (const v of violations) console.error('  ' + v);
    console.error(
      '\nWire in client/src/hooks/useFormDraft.ts so in-progress edits survive a lost\n' +
      'connection or accidental close (see WorkOrderFormModal.tsx / FleetCostFormModal.tsx\n' +
      'for the pattern). If this file is genuinely exempt (read-only viewer, single-field\n' +
      'confirm dialog, generic shell), add it to scripts/form-draft-coverage-baseline.json\n' +
      'with a one-line reason.\n'
    );
    process.exit(1);
  }

  console.log('✓ All save-capable form modals use useFormDraft.');
}

main();
