// ============================================================
// Timestamp slicing ratchet
// ============================================================
// The server stores naive UTC ("2026-07-28 01:52:00"). Taking the first 10
// characters of that string yields the UTC calendar date, which is NOT the
// date the event happened in Mountain Time. A 19:52 MT attempt on Jul 27 is
// stored as Jul 28 UTC, so `attempt_at.slice(0, 10)` printed the WRONG DAY --
// on screen and, in three fleet generators, on printed reports.
//
// This is the same bug class as the 6-hour Notice-of-Attempt regression: a
// reader assuming the naive string is local. Route display through
// safeDateStr / formatDate (which parse via parseTimestamp, then render in the
// display zone). For a value that must stay YYYY-MM-DD -- an
// <input type="date">, an API query param -- use
// dateToLocalYMD(parseTimestamp(x)) instead, which keeps the shape but fixes
// the zone. A blind sweep to safeDateStr would have broken the Field
// Interviews edit form for exactly that reason.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseTimestamp, dateToLocalYMD, safeDateStr } from '../dateUtils';

const SRC = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

describe('timestamp slicing', () => {
  it('demonstrates why slicing is wrong for an evening attempt', () => {
    // 19:52 MT on Jul 27 === 01:52 UTC on Jul 28.
    const storedUtc = '2026-07-28 01:52:00';
    expect(storedUtc.slice(0, 10)).toBe('2026-07-28');          // the bug
    expect(dateToLocalYMD(parseTimestamp(storedUtc))).toBe('2026-07-27'); // correct
    expect(safeDateStr(storedUtc)).toContain('07/27');           // correct, display form
  });

  it('no source file renders a *_at timestamp through a raw .slice(0, 10)', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      if (f.includes('__tests__')) continue;   // fixtures and this file's own prose
      const src = readFileSync(f, 'utf8');
      src.split('\n').forEach((line, i) => {
        const code = line.trim();
        // Comments describing the bug are not the bug -- check-new-date.js has
        // the same trap, matching `new Date()` inside prose.
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        if (line.includes('new Date()')) return;               // local Date, not a server string
        if (/\b\w*_at\??\.slice\(0, ?10\)/.test(line)) {
          offenders.push(`${f.replace(SRC, 'src')}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
