#!/usr/bin/env node
/**
 * check-button-health — guards the button failure modes found by the
 * 2026-07/08 button sweep (PRs #3187, #3194, #3195) from coming back.
 *
 * Each class below was found by reading real broken buttons in this codebase,
 * not from a generic lint list:
 *
 *   A  no-accessible-name   icon-only <button> with no aria-label/title. 95 of
 *                           these existed; IconButton's required aria-label
 *                           prop only helps code that actually uses it.
 *   B  popup-listener-race  a Mapbox popup button wired via setTimeout +
 *                           getElementById. Loses the race on a slow render
 *                           and attaches NOTHING — the button silently dies.
 *                           Delegate to popup.getElement() instead.
 *   C  stuck-flag           setBusy(true) → await that can throw → no reset.
 *                           Leaves the button disabled until a page reload.
 *   D  implicit-submit      <button> with no type= inside a <form>. Defaults
 *                           to submit and reloads the page in an SPA.
 *
 * Deliberately conservative: this is a ratchet, not a linter. It must stay
 * quiet on the safe patterns this codebase already uses (promise .finally(),
 * promise .catch(), a reset placed after a swallowing try/catch) — those
 * caused ~80 false positives in the first draft of the sweep.
 *
 * Usage:  node scripts/check-button-health.mjs [--verbose]
 * Exit 1 if any NEW violation appears above the recorded baseline.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_SRC = join(ROOT, 'client', 'src');
const BASELINE_PATH = join(ROOT, 'scripts', 'button-health-baseline.json');
const VERBOSE = process.argv.includes('--verbose');

if (!existsSync(CLIENT_SRC)) {
  console.error(`check-button-health: ${CLIENT_SRC} not found`);
  process.exit(1);
}

const files = execFileSync('find', [CLIENT_SRC, '-name', '*.tsx'], {
  encoding: 'utf8', maxBuffer: 1 << 28,
}).trim().split('\n').filter(Boolean)
  .filter((f) => !/__tests__|\.test\.tsx$/.test(f))
  .sort();

/**
 * Blank comments while preserving byte offsets (newlines kept) so line numbers
 * stay exact. Required: this codebase discusses `<button>` in prose constantly
 * — IconButton's own doc comment contains one — and matching inside comments
 * produced 660 phantom findings during the sweep.
 */
function blankComments(src) {
  const out = src.split('');
  const blank = (a, b) => { for (let i = a; i < b && i < out.length; i++) if (out[i] !== '\n') out[i] = ' '; };
  let i = 0, quote = null;
  while (i < src.length) {
    const ch = src[i], next = src[i + 1];
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i++; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; i++; continue; }
    if (ch === '/' && next === '/') { const e = src.indexOf('\n', i); blank(i, e < 0 ? src.length : e); i = e < 0 ? src.length : e; continue; }
    if (ch === '/' && next === '*') { const e = src.indexOf('*/', i + 2); blank(i, e < 0 ? src.length : e + 2); i = e < 0 ? src.length : e + 2; continue; }
    i++;
  }
  return out.join('');
}

const lineOf = (src, i) => src.slice(0, i).split('\n').length;
const rel = (f) => f.slice(ROOT.length + 1);

/** Brace-balanced block starting at the '{' at or after `from`. */
function block(src, from) {
  const start = src.indexOf('{', from);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return { start, end: i, text: src.slice(start, i + 1) }; }
  }
  return null;
}

/** Read a JSX opening tag, brace/quote aware so onClick={f({a:1})} survives. */
function readTag(src, start) {
  let depth = 0, quote = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === quote && src[i - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

/** True if `body` contains `.name(` whose argument list resets the flag. */
function chainHandlerResets(body, name, reset) {
  const re = new RegExp(`\\.${name}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(body))) {
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < body.length; i++) {
      if (body[i] === '(') depth++;
      else if (body[i] === ')') {
        depth--;
        if (depth === 0) return reset.test(body.slice(m.index, i + 1)) || chainHandlerResets(body.slice(i), name, reset);
      }
    }
  }
  return false;
}

const violations = [];
const add = (cls, file, line, detail) => violations.push({ cls, file: rel(file), line, detail });

const ACTION_FLAG = /^(Loading|IsLoading|Saving|Busy|Submitting|Deleting|Uploading|Running|Processing|Sending|Generating|Importing|Exporting|Working|Pending)/;

for (const file of files) {
  const src = blankComments(readFileSync(file, 'utf8'));

  // ── A: icon-only button with no accessible name ────────────────────
  const btnRe = /<button(?=[\s>])/g;
  let b;
  while ((b = btnRe.exec(src))) {
    const tag = readTag(src, b.index);
    if (!tag) continue;
    if (/\baria-label\s*=|\btitle\s*=|\{\s*\.\.\./.test(tag)) continue;
    const close = src.indexOf('</button>', b.index);
    if (close === -1) continue;
    const inner = src.slice(b.index + tag.length, close);
    // An expression child may render text — statically undecidable, so only
    // flag children that are exclusively element tags.
    if (!inner.trim() || inner.includes('{')) continue;
    if (inner.replace(/<[^>]*>/g, '').trim()) continue;
    add('no-accessible-name', file, lineOf(src, b.index), tag.replace(/\s+/g, ' ').slice(0, 80));
  }

  // ── B: Mapbox popup button wired through a setTimeout id lookup ────
  const toRe = /setTimeout\s*\(/g;
  let t;
  while ((t = toRe.exec(src))) {
    const blk = block(src, t.index);
    if (!blk) continue;
    if (!/getElementById|querySelector/.test(blk.text)) continue;
    if (!/addEventListener\s*\(\s*['"]click['"]/.test(blk.text)) continue;
    add('popup-listener-race', file, lineOf(src, t.index),
      'click listener attached by id inside setTimeout — delegate to popup.getElement()');
  }

  // ── C: action flag set true, await can throw, never reset ──────────
  const flagRe = /\bset([A-Z][A-Za-z0-9]*)\(\s*true\s*\)/g;
  let m;
  const seen = new Set();
  while ((m = flagRe.exec(src))) {
    const name = m[1];
    if (!ACTION_FLAG.test(name)) continue;
    // Enclosing function body.
    let depth = 0, fn = null;
    for (let i = m.index; i >= 0; i--) {
      if (src[i] === '}') depth++;
      else if (src[i] === '{') {
        if (depth === 0) { fn = block(src, i - 1); break; }
        depth--;
      }
    }
    if (!fn || seen.has(fn.start + name)) continue;
    seen.add(fn.start + name);
    const body = fn.text;
    const RESET = new RegExp(`set${name}\\(\\s*false\\s*\\)`);
    if (!/\bawait\b|\.then\(/.test(body)) continue;
    if (!RESET.test(body)) continue;
    if (/\bfinally\s*\{/.test(body)) continue;
    if (chainHandlerResets(body, 'finally', RESET)) continue;
    if (chainHandlerResets(body, 'catch', RESET)) continue;

    const tm = /\btry\s*\{/.exec(body);
    if (tm) {
      const tryBlk = block(body, tm.index + tm[0].length - 1);
      if (!tryBlk) continue;
      const after = body.slice(tryBlk.end);
      const cm = /^\s*catch\s*(\([^)]*\))?\s*\{/.exec(after);
      const catchBlk = cm ? block(after, cm.index + cm[0].length - 1) : null;
      const tail = catchBlk ? after.slice(catchBlk.end) : after;
      if (RESET.test(tail)) continue;                       // reset after try/catch
      if (catchBlk && RESET.test(catchBlk.text)) continue;  // catch resets
    }
    add('stuck-flag', file, lineOf(src, m.index),
      `set${name}(true) with no reset on the throwing path`);
  }

  // ── D: implicit submit inside a form ───────────────────────────────
  const formRe = /<form(\s[^>]*)?>/g;
  let f;
  while ((f = formRe.exec(src))) {
    const close = src.indexOf('</form>', f.index);
    if (close === -1) continue;
    const region = src.slice(f.index, close);
    const inner = /<button(?=[\s>])/g;
    let ib;
    while ((ib = inner.exec(region))) {
      const tag = readTag(region, ib.index);
      if (!tag || tag.length > 1500) continue;
      if (/\btype\s*=|\{\s*\.\.\./.test(tag)) continue;
      add('implicit-submit', file, lineOf(src, f.index + ib.index),
        '<button> with no type= inside <form> defaults to submit');
    }
  }
}

// ── Ratchet ──────────────────────────────────────────────────────────
const counts = violations.reduce((a, v) => ({ ...a, [v.cls]: (a[v.cls] || 0) + 1 }), {});
const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : {};

let failed = false;
// `_`-prefixed baseline keys are human notes, not defect classes.
const classes = [...new Set([...Object.keys(counts), ...Object.keys(baseline)])]
  .filter((k) => !k.startsWith('_'))
  .sort();

console.log('Button health:');
for (const cls of classes) {
  const now = counts[cls] || 0;
  const was = baseline[cls] ?? 0;
  const mark = now > was ? 'FAIL' : now < was ? 'improved' : 'ok';
  if (now > was) failed = true;
  console.log(`  ${mark.padEnd(9)} ${cls.padEnd(22)} ${now} (baseline ${was})`);
}

if (VERBOSE || failed) {
  for (const cls of classes) {
    const list = violations.filter((v) => v.cls === cls);
    if (!list.length) continue;
    if (!VERBOSE && (counts[cls] || 0) <= (baseline[cls] ?? 0)) continue;
    console.log(`\n--- ${cls} ---`);
    for (const v of list) console.log(`  ${v.file}:${v.line}  ${v.detail}`);
  }
}

if (failed) {
  console.error(`\ncheck-button-health: NEW button defects introduced.`);
  console.error(`Fix them, or if a hit is a false positive, refine the classifier —`);
  console.error(`do not raise the baseline to hide a real defect.`);
  process.exit(1);
}

console.log('\ncheck-button-health: no new button defects.');
