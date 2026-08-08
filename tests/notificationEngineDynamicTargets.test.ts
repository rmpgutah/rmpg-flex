// Unit tests for the dynamicUserIds extension to evaluateNotificationRules/
// fireRule (src/routes/notificationEngine.ts). Mocks D1 the same way
// tests/errorLog.test.ts does, to avoid needing Miniflare.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateNotificationRules, fireRule, type NotificationRuleRow } from '../src/routes/notificationEngine';

function makeMockDb(opts: { rules: NotificationRuleRow[]; users: { id: number }[] }) {
  const inserted: unknown[][] = [];
  const db: any = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        all: vi.fn(async () => {
          if (sql.includes('FROM notification_rules')) return { results: opts.rules };
          if (sql.includes('FROM users')) return { results: opts.users };
          return { results: [] };
        }),
        run: vi.fn(async () => {
          if (sql.includes('INSERT INTO notifications')) inserted.push(args);
          return { success: true, meta: {} };
        }),
      })),
    })),
  };
  return { db, inserted };
}

const baseRule: NotificationRuleRow = {
  id: 1,
  name: 'Test rule',
  description: null,
  trigger_event: 'shift_swap_approved',
  conditions: '{}',
  target_roles: '[]',
  target_user_ids: '[]',
  notification_type: 'in_app',
  is_active: 1,
};

describe('evaluateNotificationRules dynamicUserIds', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('notifies dynamic user ids even when the rule has no static targets', async () => {
    const { db, inserted } = makeMockDb({ rules: [baseRule], users: [] });
    const result = await evaluateNotificationRules(db, 'shift_swap_approved', {}, undefined, [42]);
    expect(result.rulesMatched).toBe(1);
    expect(result.notified).toBe(1);
    expect(inserted).toHaveLength(1);
    // user_id is the 7th positional bind in the INSERT INTO notifications statement
    expect(inserted[0][6]).toBe(42);
  });

  it('unions dynamic user ids with static role-resolved targets, deduped', async () => {
    const ruleWithRole: NotificationRuleRow = { ...baseRule, target_roles: '["admin"]' };
    const { db, inserted } = makeMockDb({ rules: [ruleWithRole], users: [{ id: 42 }] });
    // dynamicUserIds includes 42 again (already resolved via role) plus a new id 99
    const result = await evaluateNotificationRules(db, 'shift_swap_approved', {}, undefined, [42, 99]);
    expect(result.notified).toBe(2); // 42 once, 99 once — not 3
    const notifiedIds = inserted.map((row) => row[6]).sort();
    expect(notifiedIds).toEqual([42, 99]);
  });

  it('is a no-op change when dynamicUserIds is omitted (backward compat)', async () => {
    const { db, inserted } = makeMockDb({ rules: [baseRule], users: [] });
    const result = await evaluateNotificationRules(db, 'shift_swap_approved', {});
    expect(result.notified).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it('fireRule treats an empty dynamicUserIds array as no additional targets', async () => {
    const { db, inserted } = makeMockDb({ rules: [baseRule], users: [] });
    const notified = await fireRule(db, baseRule, {}, {}, undefined, []);
    expect(notified).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});
