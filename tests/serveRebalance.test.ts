import { describe, it, expect } from 'vitest';
import { runDailyRebalance } from '../src/utils/serveRebalance';

// Minimal mock of the D1 surface we touch — query/queryFirst/execute.
function mockDb(queueRows: Array<Record<string, unknown>>) {
  const executed: Array<{ sql: string; binds: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const binds: unknown[] = [];
      const stmt = {
        bind: (...args: unknown[]) => { binds.push(...args); return stmt; },
        all: async () => ({ results: queueRows }),
        first: async () => queueRows[0] ?? null,
        run: async () => { executed.push({ sql, binds }); return { success: true, meta: { last_row_id: 0 } }; },
      };
      return stmt;
    },
  } as unknown as Parameters<typeof runDailyRebalance>[0];
  return { db, executed };
}

const NOW = '2026-06-11T10:00:00.000Z'; // Thursday 04:00 Denver MDT — cron firing time

describe('runDailyRebalance', () => {
  it('returns zeroed counts on an empty queue', async () => {
    const { db } = mockDb([]);
    const result = await runDailyRebalance(db, NOW);
    expect(result).toEqual({
      tiers_recomputed: 0,
      tiers_promoted_critical: 0,
      priority_escalated: 0,
      slots_skipped_manual: 0,
    });
  });

  it('escalates priority when tier flips to critical and current priority is not "urgent"', async () => {
    const { db, executed } = mockDb([
      { id: 1, deadline: '2026-06-12', max_attempts: 3, attempt_count: 0,
        priority: 'normal', urgency_tier: 'standard' },
    ]);
    const result = await runDailyRebalance(db, NOW);
    expect(result.tiers_promoted_critical).toBe(1);
    expect(result.priority_escalated).toBe(1);
    // Must update serve_queue with new tier + rushed priority.
    expect(executed.some((e) => e.sql.includes('UPDATE serve_queue') && e.binds.includes('critical'))).toBe(true);
  });

  it('does NOT demote a manually-set "urgent" priority', async () => {
    const { db, executed } = mockDb([
      { id: 2, deadline: '2026-08-12', max_attempts: 3, attempt_count: 0,
        priority: 'urgent', urgency_tier: 'critical' },
    ]);
    const result = await runDailyRebalance(db, NOW);
    expect(result.priority_escalated).toBe(0);
    // Must not touch priority for already-urgent rows.
    expect(executed.every((e) => !e.binds.includes('rush'))).toBe(true);
  });
});
