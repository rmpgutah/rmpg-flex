// ============================================================
// Print-form generation stamp
// ============================================================
// Every generator used to hand-roll its own toLocaleString. Six of them
// omitted `timeZone` entirely -- invoice, proposal, blank form, serve job
// sheet, the serve log, and the base record path -- so they stamped the
// DEVICE's zone. On an MT Toughbook that is invisibly correct; generated from
// a laptop in another zone, an invoice or proposal prints a time that never
// happened here. Mountain is the canonical record zone for this app.
//
// None of them carried a zone label either, so a signed and filed document
// showed a bare "14:35:21" that does not say which zone it means -- the same
// ambiguity that produced the 6-hour Notice-of-Attempt regression.
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stampGenerationTime, generationTimestamp } from '../pdfGenerator';

// Pin the wall clock. Several helpers here take an optional `now` and fall back
// to `new Date()` / `Date.now()`, and the PDF footers stamp the real generation
// time — so without this the assertions drift as real time advances past the
// fixtures below. `toFake: ['Date']` deliberately leaves setTimeout/setInterval
// real: jsPDF and jsdom rely on them, and faking them can deadlock generation.
const PINNED_NOW = '2026-07-27T20:35:00Z';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(PINNED_NOW)); // new-date-ok — Z-suffixed UTC literal, not a naive server string
});

afterEach(() => {
  vi.useRealTimers();
});

const SRC = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

describe('stampGenerationTime', () => {
  it('renders Mountain Time regardless of the host zone', () => {
    // 2026-07-27T20:35:00Z === 14:35 MDT. Pinned to an absolute instant so
    // this asserts the zone conversion, not the machine running the suite.
    const stamp = stampGenerationTime(new Date('2026-07-27T20:35:00Z'));
    expect(stamp).toContain('14:35');
    expect(stamp).not.toContain('20:35');
  });

  it('labels the zone so a filed document is unambiguous', () => {
    expect(stampGenerationTime(new Date('2026-07-27T20:35:00Z'))).toMatch(/\bMT$/);
  });

  it('publishes the stamp for the footer and GENERATED row to read', () => {
    stampGenerationTime(new Date('2026-01-15T20:35:00Z'));  // MST, not MDT
    expect(generationTimestamp).toContain('13:35');          // UTC-7 in winter
    expect(generationTimestamp).toMatch(/\bMT$/);
  });
});

describe('no generator hand-rolls its own generation stamp', () => {
  it('has no setGenerationTimestamp(new Date(...)) call sites left', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      if (f.includes('__tests__')) continue;
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*')) return;
        if (/setGenerationTimestamp\(\s*new Date\(/.test(line)) {
          offenders.push(`${f.replace(SRC, 'src')}:${i + 1}`);
        }
      });
    }
    // setGenerationTimestamp('') stays legal — blank forms are unstamped
    // templates by design, not documents of record.
    expect(offenders).toEqual([]);
  });
});
