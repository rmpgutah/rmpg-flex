import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TERMINAL_CALL_STATUSES, activeCallFilter, terminalCallFilter } from '../src/utils/callStatus';

describe('callStatus vocabulary', () => {
  it('treats archived as terminal — the 2026-07-24 dashboard bug', () => {
    // The Dashboard reported 96 ACTIVE CALLS while the header badge reported 0,
    // because the reports query omitted 'archived'. All 96 were archived.
    expect(TERMINAL_CALL_STATUSES).toContain('archived');
  });

  it('matches both spellings of cancelled', () => {
    expect(TERMINAL_CALL_STATUSES).toContain('cancelled');
    expect(TERMINAL_CALL_STATUSES).toContain('canceled');
  });

  it('activeCallFilter excludes every terminal status', () => {
    const sql = activeCallFilter();
    for (const s of TERMINAL_CALL_STATUSES) expect(sql).toContain(`'${s}'`);
    expect(sql).toMatch(/^COALESCE\(status,''\) NOT IN \(/);
  });

  it('accepts an alias-qualified column', () => {
    expect(activeCallFilter('c.status')).toContain("COALESCE(c.status,'')");
  });

  it('terminalCallFilter is the inverse', () => {
    expect(terminalCallFilter()).toContain(' IN (');
    expect(terminalCallFilter()).not.toContain(' NOT IN (');
  });

  it('treats a NULL status as active rather than dropping the row', () => {
    // SQL three-valued logic: `status NOT IN (...)` is NULL (not TRUE) for a
    // NULL status, so such a call would vanish from every count. COALESCE
    // makes it surface as active, which is the visible-problem behaviour.
    expect(activeCallFilter()).toContain('COALESCE');
  });
});

describe('no route re-inlines the call-status list', () => {
  // Guard against the drift that caused the original bug: six sites had gone
  // stale because each carried its own copy of the status list.
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const p = join(dir, e);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });

  // Scoped to calls_for_service only. `incidents` and `warrants` have their
  // own status vocabularies and legitimately keep their own lists — so we look
  // backwards from the match for the table being queried and skip anything
  // that isn't a CFS query.
  const tableFor = (lines: string[], idx: number): string | null => {
    for (let i = idx; i >= Math.max(0, idx - 8); i--) {
      const m = /\b(?:FROM|UPDATE|INTO)\s+([a-z_][a-z0-9_]*)/i.exec(lines[i]);
      if (m) return m[1].toLowerCase();
    }
    return null;
  };

  it('has no inline calls_for_service status list outside callStatus.ts', () => {
    const offenders: string[] = [];
    for (const file of walk('src')) {
      if (file.endsWith('callStatus.ts')) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // An inline list naming both 'cleared' and 'closed' as quoted SQL
        // literals is the shape we are outlawing.
        const shape = /NOT IN \([^)]*'cleared'[^)]*'closed'|NOT IN \([^)]*'closed'[^)]*'cleared'/.test(line);
        if (shape && tableFor(lines, i) === 'calls_for_service') {
          offenders.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(offenders, `use activeCallFilter() instead:\n${offenders.join('\n')}`).toEqual([]);
  });
});
