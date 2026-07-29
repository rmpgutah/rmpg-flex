// ============================================================
// Serve subsystem: Mountain wall-clock, not UTC
// ============================================================
// attempt_at is stored as naive UTC. Reading its hour, weekday or calendar
// date raw asks a question about LONDON, not Salt Lake City.
//
// The 2026-07-22 UTC/DST audit built denverDateExpr / denverHourExpr /
// denverStrftimeExpr and converted eight files. The SERVE subsystem was
// missed, so two things stayed wrong:
//
//   BILLING  countAfterHoursAttempts computed the after-hours surcharge from
//            the UTC hour AND the UTC weekday. On live data that flipped the
//            flag on 38 of 54 attempts, in BOTH directions:
//              13:00 MT -> reads 19:00 UTC -> wrongly surcharged
//              07:00 MT -> reads 13:00 UTC -> loses an earned surcharge
//              Sun 19:00 MT -> Mon 01:00 UTC -> stops counting as weekend
//            Measured against live D1: 34 attempts flagged under the old
//            logic, 22 under the correct one -- 12 over-surcharged.
//
//   BUCKETS  daily/weekly aggregates grouped by DATE(attempt_at), so a 19:52
//            MT attempt (01:52 UTC next day) landed in tomorrow's bucket. 4
//            of 54 live attempts sit on the wrong day; near a week boundary
//            that moves them into the wrong week.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { denverHourExpr, denverDateExpr, denverStrftimeExpr, denverOffsetHours } from '../src/utils/denverTime';

const SRC = join(__dirname, '..', 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('denver offset is DST-aware', () => {
  it('is -6 in summer and -7 in winter', () => {
    expect(denverOffsetHours(new Date('2026-07-27T20:00:00Z'))).toBe(-6); // MDT
    expect(denverOffsetHours(new Date('2026-01-15T20:00:00Z'))).toBe(-7); // MST
  });

  it('bakes the offset into the SQL it generates', () => {
    const summer = new Date('2026-07-27T20:00:00Z');
    expect(denverHourExpr('attempt_at', summer)).toContain("'-6 hours'");
    expect(denverDateExpr('attempt_at', summer)).toContain("'-6 hours'");
    expect(denverStrftimeExpr('%w', 'attempt_at', summer)).toContain("'-6 hours'");
  });
});

describe('serve billing after-hours surcharge', () => {
  const src = read('utils/serveBillingEnhanced.ts');

  it('reads the hour in Mountain time, not UTC', () => {
    expect(src).toContain("denverHourExpr('attempt_at')");
    expect(src).not.toMatch(/CAST\(strftime\('%H', attempt_at\) AS INTEGER\)/);
  });

  it('reads the weekday in Mountain time, not UTC', () => {
    // A Sunday-evening attempt is Monday in UTC and silently stops being a
    // weekend, which is the half of this bug that loses revenue rather than
    // over-charging.
    expect(src).toContain("denverStrftimeExpr('%w', 'attempt_at')");
    expect(src).not.toMatch(/CAST\(strftime\('%w', attempt_at\) AS INTEGER\)/);
  });
});

describe('serve attempt aggregates', () => {
  const src = read('utils/serveAttemptEnhanced.ts');

  it('buckets by Mountain calendar day', () => {
    expect(src).toContain("denverDateExpr('attempt_at')");
  });

  it('has no raw DATE(attempt_at) left in SQL', () => {
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toContain('DATE(attempt_at)');
  });
});
