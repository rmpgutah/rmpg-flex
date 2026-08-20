// ============================================================
// SLA compliance must be counted PER CALL, not per day-average
// ============================================================
// ReportsPage derived "SLA Met %" from dailyTrend by crediting a whole day's
// calls whenever that DAY'S AVERAGE was <= target:
//
//   dailyTrend.reduce((a, d) => a + (d.avg_response_minutes <= 5 ? d.count : 0), 0)
//     / overall.totalCalls
//
// That is wrong in BOTH directions, and dailyTrend carries only averages, so
// the client could not compute the real figure at all. The count is now done
// per row in SQL and returned as overall.slaMetCount.
//
// It happened to read 0% correctly on live data (21 calls, fastest 5.9 min, so
// no call and no day met a 5-minute target). "Currently correct by accident"
// is exactly the state that hides a metric bug until the data shifts — these
// tests use data where the two methods DISAGREE.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Day = { avg_response_minutes: number; count: number };

/** The OLD (incorrect) derivation, kept only to demonstrate the divergence. */
function perDayAverageMethod(days: Day[], totalCalls: number, target = 5): number {
  const met = days.reduce((a, d) => a + (d.avg_response_minutes <= target ? d.count : 0), 0);
  return Math.round((met / totalCalls) * 100);
}

/** The NEW method: a straight per-call count, as the SQL now does. */
function perCallMethod(slaMetCount: number, totalCalls: number): number {
  return Math.round((slaMetCount / totalCalls) * 100);
}

describe('per-day averaging misreports SLA in both directions', () => {
  it('OVER-reports: a day averaging under target credits calls that blew it', () => {
    // 10 calls averaging 4.9 min — but only 6 were actually within 5.
    const days: Day[] = [{ avg_response_minutes: 4.9, count: 10 }];
    expect(perDayAverageMethod(days, 10)).toBe(100); // every call credited
    expect(perCallMethod(6, 10)).toBe(60);           // truth
  });

  it('UNDER-reports: a day averaging over target credits nothing', () => {
    // 10 calls averaging 5.1 min — 8 of them were actually within 5, dragged
    // up by two long outliers.
    const days: Day[] = [{ avg_response_minutes: 5.1, count: 10 }];
    expect(perDayAverageMethod(days, 10)).toBe(0);   // nothing credited
    expect(perCallMethod(8, 10)).toBe(80);           // truth
  });

  it('the two agree only when every day sits cleanly on one side', () => {
    const days: Day[] = [{ avg_response_minutes: 20, count: 21 }];
    expect(perDayAverageMethod(days, 21)).toBe(0);
    expect(perCallMethod(0, 21)).toBe(0); // live data today — correct by accident
  });
});

describe('the server owns the SLA target and the per-call count', () => {
  const reports = readFileSync(join(__dirname, '..', 'src', 'routes', 'reports.ts'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  it('counts SLA compliance per row in SQL', () => {
    expect(reports).toMatch(/SUM\(CASE WHEN \$\{RESP\} <= \$\{SLA_TARGET_MINUTES\} THEN 1 ELSE 0 END\) AS slaMetCount/);
  });

  it('exposes both the count and the target so the client cannot drift', () => {
    expect(reports).toContain('slaMetCount: overall?.slaMetCount ?? 0');
    expect(reports).toContain('slaTargetMinutes: SLA_TARGET_MINUTES');
  });

  it('the error fallback keeps the same shape', () => {
    // A fallback missing these fields would make the tile read NaN% instead of
    // degrading to 0%.
    const fallback = reports.slice(reports.indexOf('} catch {', reports.indexOf('slaMetCount')));
    expect(fallback.slice(0, 400)).toContain('slaMetCount: 0');
    expect(fallback.slice(0, 400)).toContain('slaTargetMinutes: SLA_TARGET_MINUTES');
  });
});

describe('the client consumes the server figure instead of re-deriving it', () => {
  const page = readFileSync(
    join(__dirname, '..', 'client', 'src', 'pages', 'ReportsPage.tsx'), 'utf8',
  ).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  it('no longer reduces dailyTrend to compute SLA', () => {
    expect(page).not.toContain('d.avg_response_minutes <= 5');
  });

  it('uses overall.slaMetCount', () => {
    expect(page).toContain('responseTimesData.overall.slaMetCount');
  });

  it('declares the new fields on the response type', () => {
    // apiFetch<T> is a CAST, not a runtime check: a stale interface typechecks
    // clean while the value silently reads undefined and the tile renders NaN%.
    expect(page).toContain('slaMetCount: number');
    expect(page).toContain('slaTargetMinutes: number');
  });

  it('drives the chart target line from the same server value', () => {
    expect(page).toContain('slaTargetMinutes ?? 5');
    expect(page).toContain('targetMinutes: slaTarget');
  });
});
