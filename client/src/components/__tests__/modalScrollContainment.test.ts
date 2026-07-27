// ============================================================
// Modal scroll containment — source-level ratchet
// ============================================================
// A modal whose content can outgrow the viewport MUST be able to scroll, or
// its action row renders below the fold with no way to reach it. Measured in
// a real browser at 1024x600 (Toughbook landscape), EditServeAttemptModal put
// Save 138px off-screen with a non-scrollable body — the officer could edit an
// attempt timestamp and then had no reachable way to save it.
//
// Two valid containment strategies:
//   (a) panel-scroll  — panel `max-h-[Nvh] flex flex-col` + body `overflow-y-auto`
//   (b) overlay-scroll — overlay `overflow-y-auto items-start` + panel `my-auto`
//
// (b) MUST pair overflow with items-start. A centered flex child that overflows
// gets its top clipped ABOVE the scroll origin and can never be scrolled back
// into view — verified in a real browser. So `overflow-y-auto` + `items-center`
// is not a fix, it trades a visible bug for a subtler one.
//
// jsdom has no layout engine, so this asserts the source invariant that
// produces the behavior rather than measured geometry.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/(Modal|Dialog)\.tsx$/.test(entry)) out.push(p);
  }
  return out;
}

/** Extract each `fixed inset-0` overlay's JSX by div depth. */
function overlays(src: string): string[] {
  const found: string[] = [];
  const re = /<div\b[^>]*className="[^"]*\bfixed\b[^"]*\binset-0\b[^"]*"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0, j = m.index;
    while (j < src.length) {
      if (src.startsWith('<div', j)) { depth++; j += 4; continue; }
      if (src.startsWith('</div>', j)) { depth--; j += 6; if (depth === 0) break; continue; }
      j++;
    }
    found.push(src.slice(m.index, j));
  }
  return found;
}

const files = walk(SRC);

describe('modal scroll containment', () => {
  it('finds modal components to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('never pairs overlay overflow-y-auto with items-center (clips the header)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const block of overlays(readFileSync(f, 'utf8'))) {
        const openTag = block.slice(0, block.indexOf('>') + 1);
        if (openTag.includes('overflow-y-auto') && openTag.includes('items-center')) {
          offenders.push(f.replace(SRC, 'src'));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every growable modal a way to scroll', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const block of overlays(src)) {
        // Growable = renders a list, a textarea, or several fields. A two-button
        // confirm dialog physically cannot overflow, so it needs no container.
        const maps = (block.match(/\.map\(/g) || []).length;
        const fields = (block.match(/<(?:input|select|textarea)\b/g) || []).length;
        const grow = maps + fields + (block.includes('<textarea') ? 2 : 0);
        if (grow < 3) continue;

        const scrolls = block.includes('overflow-y-auto') || block.includes('overflow-auto');
        const capped = /max-h-\[\d+(?:vh|dvh)\]|max-h-screen/.test(block);
        if (!scrolls && !capped) offenders.push(`${f.replace(SRC, 'src')} (grow=${grow})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
