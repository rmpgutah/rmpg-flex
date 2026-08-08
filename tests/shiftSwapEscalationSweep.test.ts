// Unit tests for the shift-swap escalation sweep
// (src/utils/shiftSwapEscalationSweep.ts). Mocks D1 the same way
// tests/errorLog.test.ts and tests/shiftPlanNotifySweep.test.ts do.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sweepShiftSwapEscalations } from '../src/utils/shiftSwapEscalationSweep';

function makeMockDb(staleRows: Array<{ id: number; requester_id: number; target_id: number | null; status: string }>) {
  const updates: unknown[][] = [];
  const notified: unknown[][] = [];
  const db: any = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        all: vi.fn(async () => {
          if (sql.includes('FROM shift_swap_requests')) return { results: staleRows };
          if (sql.includes('FROM notification_rules')) {
            return {
              results: sql.includes('shift_swap_escalated') || true
                ? [{ id: 1, name: 'Shift swap escalated', description: null, trigger_event: 'shift_swap_escalated', conditions: '{}', target_roles: '["admin","manager"]', target_user_ids: '[]', notification_type: 'in_app', is_active: 1 }]
                : [],
            };
          }
          if (sql.includes('FROM users')) return { results: [{ id: 99 }] };
          return { results: [] };
        }),
        run: vi.fn(async () => {
          if (sql.includes('UPDATE shift_swap_requests')) updates.push(args);
          if (sql.includes('INSERT INTO notifications')) notified.push(args);
          return { success: true, meta: {} };
        }),
      })),
    })),
  };
  return { db, updates, notified };
}

describe('sweepShiftSwapEscalations', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('escalates a swap stuck in pending/pending_supervisor for 24+ hours and stamps escalated_at', async () => {
    const { db, updates, notified } = makeMockDb([
      { id: 1, requester_id: 5, target_id: 6, status: 'pending' },
    ]);
    const result = await sweepShiftSwapEscalations(db);
    expect(result.escalated).toBe(1);
    expect(notified.length).toBeGreaterThan(0);
    // escalated_at stamp is an UPDATE on shift_swap_requests
    expect(updates.some((u) => u.includes(1))).toBe(true);
  });

  it('escalates zero swaps when none are stale', async () => {
    const { db } = makeMockDb([]);
    const result = await sweepShiftSwapEscalations(db);
    expect(result.escalated).toBe(0);
    expect(result.notified).toBe(0);
  });

  it('escalates multiple stale swaps independently', async () => {
    const { db } = makeMockDb([
      { id: 1, requester_id: 5, target_id: 6, status: 'pending' },
      { id: 2, requester_id: 7, target_id: null, status: 'pending_supervisor' },
    ]);
    const result = await sweepShiftSwapEscalations(db);
    expect(result.escalated).toBe(2);
  });
});
