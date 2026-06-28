#!/usr/bin/env node
/**
 * check-array-guards.js
 *
 * Fails CI on the recurring "Cannot read properties of undefined (reading
 * 'map')" / "X.map is not a function" white-screen crash class in the client.
 * There is no ESLint in this repo (see `project-no-eslint`), so this is a
 * targeted grep-guard, a sibling to scripts/check-tofixed-guards.js.
 *
 * The bug: `apiFetch<T[]>(...)` only throws on a non-2xx response. A 200 that
 * returns `{}`, `null`, a `{ data: [...] }` envelope, or a stub shape (common
 * during the strangler-fig cutover) passes straight through. Assigning that
 * raw value into list state and then calling `.map()/.filter()/.length` on it
 * white-screens the WHOLE admin console (there is no per-tab error boundary).
 *
 * The fix the codebase already standardized on is `asArray()`
 * (client/src/utils/asArray.ts) — or `Array.isArray(x) ? x : []`.
 *
 * This script flags the two unguarded shapes, both high-signal:
 *
 *   1. Direct:   setSources(await apiFetch<SourceInfo[]>('/x'))
 *   2. Two-step: const data = await apiFetch<Foo[]>('/x');
 *                ...
 *                setFoo(data)            // bare identifier, no asArray
 *
 * It does NOT flag `setFoo(asArray(data))`, `setFoo(data.map(...))`,
 * `setFoo(Array.isArray(data) ? data : [])`, or any window where the value is
 * coerced/guarded between the fetch and the setter.
 *
 * Generics containing nested `<>` (e.g. `apiFetch<Record<string, X>[]>`) are
 * intentionally NOT matched — keeping the matcher simple avoids false positives
 * at the cost of missing a rare shape, same pragmatic trade-off as the
 * tofixed guard.
 *
 * SCOPE: the admin console (client/src/pages/admin) only. That is where the
 * "no per-tab error boundary, so one bad shape white-screens the WHOLE page"
 * rationale is strongest, and where this class kept regressing (PRs #939 and
 * the AI-panel follow-up). The same pattern exists at ~88 other call sites
 * repo-wide (chiefly FirecrawlTab + CRM/HR tabs) — a known latent backlog left
 * out of this gate deliberately; widen ROOT once that backlog is cleared.
 *
 * Usage: node scripts/check-array-guards.js
 *   exits 0 = clean, 1 = violation found
 *
 * Run by .github/workflows/array-guard-check.yml on PRs touching the admin UI.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'client', 'src', 'pages', 'admin');

// How many lines after the fetch to look for the matching bare setter.
const WINDOW = 12;

// const|let|var NAME = await apiFetch<...[]>(   — array-typed fetch into a var.
const FETCH_ARRAY = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+apiFetch\s*<[^<>]*\[\]>/;
// setX(await apiFetch<...[]>(   — direct, inline, unguarded.
const FETCH_ARRAY_INLINE = /\bset[A-Z][\w$]*\(\s*await\s+apiFetch\s*<[^<>]*\[\]>/;

/** Recursively collect .ts/.tsx files under dir (skip node_modules + tests). */
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

/** Blank out comments so prose mentioning the pattern isn't flagged. */
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
  const rel = path.relative(process.cwd(), file);

  lines.forEach((line, i) => {
    // Shape 1 — direct inline setter on a raw array fetch.
    if (FETCH_ARRAY_INLINE.test(line) && !/asArray|Array\.isArray/.test(line)) {
      violations.push(`${rel}:${i + 1}: ${line.trim()}`);
      return;
    }

    // Shape 2 — fetch into a var, then a bare setter within WINDOW lines.
    const m = line.match(FETCH_ARRAY);
    if (!m) return;
    const varName = m[1];
    const bareSetter = new RegExp(`\\bset[A-Z][\\w$]*\\(\\s*${varName}\\s*\\)`);
    const guard = new RegExp(`(?:asArray|Array\\.isArray)\\s*(?:<[^>]*>)?\\(\\s*${varName}\\b`);
    // A later re-assignment of the same name (e.g. `data` reused for a second,
    // non-array fetch) means the setter no longer refers to our array value.
    const reassign = new RegExp(`(?:\\b(?:const|let|var)\\s+${varName}\\b|(?:^|;)\\s*${varName})\\s*=[^=]`);
    for (let j = i + 1; j <= i + WINDOW && j < lines.length; j++) {
      // If the value is coerced/guarded before the setter, it's safe — stop.
      if (guard.test(lines[j])) break;
      if (reassign.test(lines[j])) break;
      if (bareSetter.test(lines[j])) {
        violations.push(`${rel}:${j + 1}: ${lines[j].trim()}  (raw apiFetch<[]> from line ${i + 1})`);
        break;
      }
    }
  });
}

if (violations.length) {
  console.error('\n✖ Unguarded array-typed apiFetch result assigned to state:\n');
  for (const v of violations) console.error('  ' + v);
  console.error(
    '\nA non-2xx throws, but a 200 returning {} / null / {data:[]} does NOT —\n' +
    'the raw value then crashes the whole admin console on `.map()`/`.filter()`.\n' +
    'Wrap it: `setX(asArray(data))` (client/src/utils/asArray.ts) or\n' +
    '`setX(Array.isArray(data) ? data : [])`.\n'
  );
  process.exit(1);
}

console.log('✓ No unguarded array-typed apiFetch → state assignments found.');
