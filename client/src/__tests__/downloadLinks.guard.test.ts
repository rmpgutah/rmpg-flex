import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

// useApi.ts owns downloadUrl() and legitimately contains the literal path.
const ALLOWLIST = new Set(['hooks/useApi.ts']);

/**
 * Every non-test .ts/.tsx file under client/src, as paths relative to src.
 *
 * Test files are excluded because they assert on URL strings by design —
 * including this file. Without that exclusion the guard fails on correct code.
 */
function sourceFiles(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const relPath = rel ? `${rel}/${entry}` : entry;
    if (statSync(abs).isDirectory()) {
      if (entry === 'node_modules') continue;
      out.push(...sourceFiles(abs, relPath));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    if (ALLOWLIST.has(relPath)) continue;
    out.push(relPath);
  }
  return out;
}

/**
 * Source with comment-only lines removed.
 *
 * Required, not cosmetic: the fix for this very bug left an explanatory comment
 * in MenuBar.tsx quoting the old bad URL, and without this the guard flagged
 * that comment and failed on correct code. This repo has been bitten by the
 * same class of bug before — check-new-date.js matching `new Date()` inside
 * comments — so a guard that reads comments as code is a known trap.
 *
 * Deliberately simple: it drops lines whose first non-space character starts a
 * line or block comment. A trailing comment on a code line is still scanned,
 * which is the safe direction to err.
 */
function codeLines(src: string): string {
  return src
    .split('\n')
    .filter((line) => {
      const t = line.trimStart();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

const FILES = sourceFiles(SRC).map((file) => ({
  file,
  code: codeLines(readFileSync(join(SRC, file), 'utf8')),
}));

describe('download links never resolve against the Pages origin', () => {
  // A relative /downloads/<file> href resolves against rmpgutah.us (Pages),
  // where no route matches, so the `/*  /index.html  200` SPA catch-all returns
  // the app shell with HTTP 200. The browser then saves ~11 KB of HTML under
  // the artifact's filename and reports no error at all. Use the
  // server-provided installer.url, or downloadUrl() when only a filename is
  // known.
  it('has no href pointing at a relative /downloads/ path', () => {
    const offenders = FILES.filter(({ code }) => /href=\{?[`'"]\/downloads\//.test(code)).map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  // A hardcoded rmpgutah.us origin is the same defect spelled out in full:
  // that host is Pages, not the Worker that serves /downloads/.
  it('has no hardcoded rmpgutah.us/downloads/ URL', () => {
    const offenders = FILES.filter(({ code }) => /rmpgutah\.us\/downloads\//.test(code)).map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  // A path bug that silently scanned zero files would let this guard pass
  // forever while enforcing nothing.
  it('actually scanned the tree', () => {
    expect(FILES.length).toBeGreaterThan(100);
  });
});
