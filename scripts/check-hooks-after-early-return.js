#!/usr/bin/env node
/**
 * check-hooks-after-early-return.js
 *
 * Fails CI on the React error #310 crash class: a hook declared AFTER a
 * top-level conditional early return inside a component. There is no ESLint
 * in this repo (see the `project-no-eslint` note), so this is a targeted
 * grep-guard in the style of check-tofixed-guards.js / check-column-cap.js.
 *
 * The bug that shipped (NewCallModal, fixed in PR #1128):
 *
 *     if (!isOpen) return null;          // component renders 0 hooks closed…
 *     const [x, setX] = useState('');    // …and N+1 hooks open → React #310
 *
 * React identifies hooks by call order, so any hook that only sometimes runs
 * changes the per-render hook count and crashes the whole tree.
 *
 * Heuristic (deliberately narrow — low false positives over full coverage):
 *   - Only top-level statements of a component body (indent <= 2 spaces,
 *     matching this codebase's 2-space style) are considered.
 *   - An "early return" is `if (...) return null;` on one line at indent <= 2,
 *     or a `return null;` directly inside an indent <= 2 `if (...) {` block.
 *   - A "hook" is a call to use(State|Effect|Ref|Memo|Callback|Id|Context|
 *     Reducer|LayoutEffect)( at indent <= 2 after such a return, before the
 *     enclosing function closes (a `}` at column 0 resets the scan).
 *
 * Nested callbacks/components at deeper indents are intentionally ignored.
 *
 * Usage: node scripts/check-hooks-after-early-return.js
 *   exits 0 = clean, 1 = violation found
 *
 * Run by .github/workflows/pr-tests.yml (client-tests job group).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'client', 'src');

const HOOK_CALL = /\buse(State|Effect|Ref|Memo|Callback|Id|Context|Reducer|LayoutEffect)\s*\(/;
// `if (...) return null;` one-liner at component top level (indent 0–2)
const INLINE_EARLY_RETURN = /^ {0,2}if\s*\(.*\)\s*return\s+null\s*;?\s*$/;
// the block form: `if (...) {` at indent 0–2 …
const IF_BLOCK_OPEN = /^ {0,2}if\s*\(.*\)\s*\{\s*$/;
// … containing `return null;` at indent 3–4
const BLOCK_RETURN_NULL = /^ {3,4}return\s+null\s*;?\s*$/;
// top-level (indent <= 2) statement line — where component-body hooks live
const TOP_LEVEL = /^ {0,2}\S/;

/** Recursively collect .tsx files under dir. */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Blank out comments (same approach as check-tofixed-guards.js) so prose that
 * mentions the pattern isn't flagged. Block comments become same-length blanks
 * to preserve line numbers; line comments are truncated at `//`.
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
  // Line number of the early return currently "arming" the scan, or null.
  let earlyReturnAt = null;
  let pendingIfOpen = false; // saw `if (...) {` at indent <= 2 on the previous line(s)

  lines.forEach((line, i) => {
    // A closing brace at column 0 ends the enclosing function — disarm.
    if (/^\}/.test(line)) {
      earlyReturnAt = null;
      pendingIfOpen = false;
      return;
    }

    if (earlyReturnAt !== null && TOP_LEVEL.test(line) && HOOK_CALL.test(line)) {
      violations.push(
        `${path.relative(process.cwd(), file)}:${i + 1}: hook after early return at line ${earlyReturnAt}: ${line.trim()}`
      );
      return;
    }

    if (INLINE_EARLY_RETURN.test(line)) {
      earlyReturnAt = i + 1;
      pendingIfOpen = false;
      return;
    }
    if (IF_BLOCK_OPEN.test(line)) {
      pendingIfOpen = true;
      return;
    }
    if (pendingIfOpen) {
      if (BLOCK_RETURN_NULL.test(line)) earlyReturnAt = i + 1;
      // Whatever it was, the one-statement lookahead is over once we see a
      // non-blank line.
      if (line.trim() !== '') pendingIfOpen = false;
    }
  });
}

if (violations.length) {
  console.error('\n✖ React hook declared after a conditional early return (React error #310):\n');
  for (const v of violations) console.error('  ' + v);
  console.error(
    '\nHooks must run on every render — React matches them by call order.\n' +
    'Move the hook ABOVE the `return null` early-out (all hooks first, then\n' +
    'early returns). See NewCallModal.tsx / PR #1128 for the crash this causes.\n'
  );
  process.exit(1);
}

console.log('✓ No hooks after conditional early returns found.');
