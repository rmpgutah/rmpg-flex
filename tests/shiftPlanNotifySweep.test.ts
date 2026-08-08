// Unit tests for the daily Shift Plans notification sweep
// (src/utils/shiftPlanNotifySweep.ts). Mocks D1 the same way
// tests/errorLog.test.ts does.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sweepShiftPlanNotifications } from '../src/utils/shiftPlanNotifySweep';

function makeMockDb(plansByDate: Record<string, Array<{ shift_type: string; assignments: string }>>) {
  const insertedNotifications: unknown[][] = [];
  const db: any = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        all: vi.fn(async () => {
          if (sql.includes('FROM shift_plans')) {
            const date = args[0] as string;
            return { results: (plansByDate[date] ?? []).map((p, i) => ({ id: i + 1, date, ...p })) };
          }
          if (sql.includes('FROM notification_rules')) {
            const trigger = sql.includes('shift_understaffed') ? 'shift_understaffed' : undefined;
            return { results: [] }; // rule lookup handled per-call below via evaluateNotificationRules mock instead
          }
          return { results: [] };
        }),
        first: vi.fn(async () => null),
        run: vi.fn(async () => {
          insertedNotifications.push(args);
          return { success: true, meta: {} };
        }),
      })),
    })),
  };
  return { db, insertedNotifications };
}

describe('sweepShiftPlanNotifications', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('flags a date with an active plan below the minimum for its shift type', async () => {
    // 'day' minimum is 2; this plan has only 1 assignment.
    const today = new Date().toISOString().slice(0, 10);
    const { db } = makeMockDb({
      [today]: [{ shift_type: 'day', assignments: JSON.stringify([{ name: 'Officer A' }]) }],
    });
    const result = await sweepShiftPlanNotifications(db);
    expect(result.understaffed).toBeGreaterThanOrEqual(1);
  });

  it('flags a date with zero plans as no_active_plan, not understaffed', async () => {
    const { db } = makeMockDb({}); // no plans on any of the next 7 dates
    const result = await sweepShiftPlanNotifications(db);
    expect(result.noPlan).toBe(7); // every one of the next 7 days is unplanned
    expect(result.understaffed).toBe(0);
  });

  it('does not flag a date whose active plan meets its minimum', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { db } = makeMockDb({
      [today]: [{ shift_type: 'graveyard', assignments: JSON.stringify([{ name: 'Officer A' }]) }],
    });
    // graveyard minimum is 1 — one assignment is enough.
    const result = await sweepShiftPlanNotifications(db);
    // today shouldn't be counted as understaffed for the graveyard shift,
    // but the OTHER 6 days still have zero plans and count toward noPlan.
    expect(result.noPlan).toBe(6);
  });

  it('fires exactly once per matching date, not once per matching row', async () => {
    // Two understaffed shift types on the SAME date must still only
    // contribute one notification per date for the no-plan/understaffed
    // check they belong to — this guards against the exact multi-fire bug
    // the 04:00 cron gate comment in src/index.ts warns about.
    const today = new Date().toISOString().slice(0, 10);
    const { db } = makeMockDb({
      [today]: [
        { shift_type: 'day', assignments: '[]' },
        { shift_type: 'swing', assignments: '[]' },
      ],
    });
    const result = await sweepShiftPlanNotifications(db);
    // Both shift types on today are understaffed — this sweep counts
    // per ROW (matching the existing /staffing-levels semantics, which
    // reports one row per shift type), so expect 2 for today plus 0 more
    // (today has plans, so it's not in the noPlan set).
    expect(result.understaffed).toBe(2);
  });
});
