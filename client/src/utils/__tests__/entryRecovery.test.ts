// ============================================================
// index.html entry-script recovery path
// ============================================================
// client/index.html is covered by NEITHER tsc NOR vitest -- the production
// build is its only gate, and a mistake in that inline script strands every
// user at the INITIALIZING splash with no console error and no way out. These
// tests read the file as text so the recovery contract cannot silently rot.
//
// Three DISTINCT causes produce that identical splash; keep them straight:
//   1. Rocket Loader rewrites type="module" -> type="<hash>-module", so the
//      bundle is fetched but never executed. Fixed by stamping
//      data-cfasync="false" (see rocketLoaderOptout.test.ts).
//   2. A Pages propagation window serves the SPA fallback (index.html, 200,
//      text/html) for a not-yet-published chunk. Immutable cache headers mean
//      that HTML lands in the browser's HTTP cache and is re-read forever.
//   3. The service worker's poison guard answers with an empty body and the
//      old recovery path just reloaded into the same SW.
//
// (2) is the one this file mostly guards: clearing SW caches and unregistering
// the SW does NOT touch the HTTP cache, so recovery MUST re-request the entry
// with {cache:'reload'} -- the only lever JS has over it.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const raw = readFileSync(join(__dirname, '..', '..', '..', 'index.html'), 'utf8');

/**
 * index.html with comments stripped.
 *
 * ⚠️ Assert against THIS, never `raw`. The comments in that file spell out the
 * very constructs these tests look for (`fetch(src, {cache:'reload'})` appears
 * verbatim in the explanatory block), so a `raw` match is satisfied by the
 * PROSE and stays green after the real code is deleted — verified: removing the
 * live call left every assertion passing. Same trap `check-new-date.js`
 * documents for `new Date()` in comments.
 */
/**
 * Inline <script> bodies with comment LINES removed, processed line by line.
 *
 * Two traps, both hit while writing this and both silent:
 *
 *  1. Do not regex-strip comments across the whole FILE. The CSP <meta> carries
 *     wildcards like `/*.arcgis.com`; a block-comment pattern reads that `/*` as
 *     an opener and swallows everything to the next `*​/` -- measured at 6,467
 *     characters, eating the entire recovery function.
 *  2. Do not multi-line block-strip at all. Replacing a spanning `/* … *​/` with
 *     a space JOINS the surrounding lines, after which an earlier `//` on the
 *     merged line swallows real code to its right.
 *
 * Line-based filtering cannot do either. Every comment in the inline scripts is
 * either a whole `//` line or a self-contained one-line `/* … *​/`.
 */
const html = (raw.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || [])
  .join('\n')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .map((line) => line.replace(/\/\*[^*]*\*\//g, ' ')) // single-line block comments only
  .join('\n');

describe('entry-script recovery path in index.html', () => {
  it('purges the service worker registration and its caches', () => {
    expect(html).toContain('getRegistrations');
    expect(html).toContain('unregister');
    expect(html).toContain('caches.delete');
  });

  it('re-requests the entry chunk bypassing the HTTP cache', () => {
    // Without this the tab stays broken through a reload, an SW unregister and
    // a caches.delete() of every key -- the poisoned response lives in the HTTP
    // cache, which none of those touch.
    expect(html).toMatch(/cache:\s*['"]reload['"]/);
  });

  it("uses 'reload' rather than 'no-store' so the good response is written back", () => {
    // no-store would fetch fresh but leave the poisoned entry cached, so the
    // reload that follows would read the bad copy again.
    expect(html).not.toMatch(/cache:\s*['"]no-store['"]/);
  });

  it('bounds the purge so a hung caches/SW API cannot block the reload', () => {
    expect(html).toMatch(/setTimeout\(\s*go\s*,\s*\d+\s*\)/);
  });

  it('keeps the once-per-30s guard and its shared storage key', () => {
    // Shared with chunkRetry.ts's CHUNK_RELOAD_KEY so the two recovery paths
    // cannot loop against each other.
    expect(html).toContain('rmpg_chunk_reload');
    expect(html).toContain('30000');
  });

  it('does NOT reload when sessionStorage is unavailable', () => {
    // The guard cannot be enforced without storage, and an unguarded reload
    // could loop. The catch block must stay empty of a reload call.
    const catchBlock = html.slice(html.indexOf('} catch (e) {', html.indexOf('rmpg_chunk_reload')));
    expect(catchBlock.slice(0, 400)).not.toContain('purgeThenReload()');
  });
});
