import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLOSED_CALL_STATUSES,
  ACTIVE_CALL_WHERE,
  activeCallWhere,
} from '../src/utils/callStatus';

// Regression guard for the 2026-07-24 audit finding: /api/reports/dashboard
// reported activeCalls: 96 on live while its own callsByStatus proved all 96
// rows were status='archived'. Six queries across reports.ts, admin.ts and
// shiftBriefings.ts excluded only ('cleared','closed','cancelled') — omitting
// 'archived' — so archived calls were counted as active on the main CAD
// dashboard, in admin stats, and in shift briefings.
describe('CLOSED_CALL_STATUSES', () => {
  it("includes 'archived' — the status that caused the phantom active-call count", () => {
    expect(CLOSED_CALL_STATUSES).toContain('archived');
  });

  it('covers both cancel spellings', () => {
    expect(CLOSED_CALL_STATUSES).toContain('cancelled');
    expect(CLOSED_CALL_STATUSES).toContain('canceled');
  });

  it('covers the plainly-terminal statuses', () => {
    expect(CLOSED_CALL_STATUSES).toContain('closed');
    expect(CLOSED_CALL_STATUSES).toContain('cleared');
  });

  it('has no duplicates and is all lowercase', () => {
    expect(new Set(CLOSED_CALL_STATUSES).size).toBe(CLOSED_CALL_STATUSES.length);
    for (const s of CLOSED_CALL_STATUSES) expect(s).toBe(s.toLowerCase());
  });
});

describe('ACTIVE_CALL_WHERE', () => {
  it('excludes every terminal status', () => {
    for (const s of CLOSED_CALL_STATUSES) {
      expect(ACTIVE_CALL_WHERE).toContain(`'${s}'`);
    }
  });

  it('is a NOT IN predicate over the status column', () => {
    expect(ACTIVE_CALL_WHERE).toMatch(/^status NOT IN \(/);
  });

  // The fragment is interpolated straight into SQL, so it must never carry
  // anything but a fixed list of quoted literals — no binds, no user input.
  it('contains no bind placeholders', () => {
    expect(ACTIVE_CALL_WHERE).not.toContain('?');
  });
});

// A test on the constant alone can't catch the thing that caused this bug:
// someone hand-rolling a fresh status list inside a query. This scans the
// Worker source for any NOT IN list over call statuses that forgets 'archived'.
describe('no hand-rolled call-status lists in src/', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });

  it("has no calls_for_service status list that omits 'archived'", () => {
    const notIn = /NOT IN \(([^)]*)\)/g;
    const offenders: string[] = [];

    for (const file of walk(join(__dirname, '..', 'src'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(notIn)) {
        const list = m[1];
        // Only status lists, not id/number lists.
        if (!list.includes("'cleared'") && !list.includes("'closed'")) continue;
        if (list.includes("'archived'")) continue;
        // Scope to queries actually about calls. Match on the nearest preceding
        // table reference rather than a proximity window — a plain "is
        // calls_for_service nearby" check wrongly flags the `incidents` list in
        // admin.ts, which sits three lines below an unrelated calls query.
        // Other domains (warrants: 'served'/'recalled'/'quashed'; incidents)
        // legitimately have different terminal states.
        const idx = m.index ?? 0;
        const table = [...src.slice(0, idx).matchAll(/\b(?:FROM|UPDATE|JOIN)\s+([a-z_][a-z0-9_]*)/gi)].pop();
        if (table?.[1] !== 'calls_for_service') continue;
        const line = src.slice(0, idx).split('\n').length;
        offenders.push(`${file.replace(/.*\/src\//, 'src/')}:${line} — NOT IN (${list})`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('activeCallWhere', () => {
  it('defaults to the bare status column', () => {
    expect(activeCallWhere()).toBe(ACTIVE_CALL_WHERE);
  });

  it('qualifies the column when a table alias is given', () => {
    const w = activeCallWhere('c.status');
    expect(w).toMatch(/^c\.status NOT IN \(/);
    expect(w).toContain("'archived'");
  });

  it('rejects anything that is not a plain column reference', () => {
    // Guards against the fragment becoming an injection seam if a caller ever
    // passes something derived from a request.
    expect(() => activeCallWhere("status) OR 1=1 --")).toThrow();
    expect(() => activeCallWhere('')).toThrow();
  });
});
