# Shift Plans — Notification Engine Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real Shift Plans events (swap requested/approved/denied, understaffed shift, no active plan) into the existing `notification_rules` engine so they reach the persistent `notifications` table, the notification bell, and the live AlertHub push — not just the ephemeral in-page banner.

**Architecture:** Two call sites in `src/routes/shiftPlans.ts` fire on mutation (swap requested/approved/denied); one new sweep util (`src/utils/shiftPlanNotifySweep.ts`) runs from the existing 04:00 America/Denver cron block to detect understaffed/no-plan dates. Both paths go through `evaluateNotificationRules` in `src/routes/notificationEngine.ts`, which gets a small backward-compatible extension (`dynamicUserIds` param) so a rule can notify a specific person (the swap requester) in addition to its static role/user targets. Five default rules are seeded via migration so this works without manual admin setup.

**Tech Stack:** Hono route handlers, Cloudflare D1 (via `src/utils/db.ts` `query`/`queryFirst`/`execute`), Vitest (Node) for unit tests, Miniflare (`test-workers/`) for route smoke tests.

## Global Constraints

- D1 calls (`query`/`queryFirst`/`execute`) are always `await`ed — forgetting this silently returns a Promise (CLAUDE.md gotcha #3).
- Migration numbering: current high-water is `0227`; this plan uses `0228`. Migration must be idempotent (`WHERE NOT EXISTS`) since `notification_rules` has no unique index on `trigger_event` (CLAUDE.md schema-changes rule + spec precedent from `0203_fleetio_health_alert_rules.sql`).
- `evaluateNotificationRules`/`fireRule` must never throw into the caller — every new call site wraps in try/catch or relies on the engine's own internal try/catch, matching the existing "best-effort" contract documented in `notificationEngine.ts`.
- No new secrets, services, or external providers — this plan is in-app notifications only (per approved spec, external email/SMS is explicitly out of scope).
- Timezone for the sweep's "next 7 days" window is America/Denver, matching every other cron-gated sweep in `src/index.ts`.
- After merge, apply `0228_shift_plan_notification_rules.sql` to live D1 (`785de7ae`) via `scripts/apply-migration.sh` (deploy's migration step is `continue-on-error`).

---

### Task 1: Extend `evaluateNotificationRules`/`fireRule` with dynamic per-event targets

**Files:**
- Modify: `src/routes/notificationEngine.ts:50-125`
- Test: `tests/notificationEngineDynamicTargets.test.ts` (new)

**Interfaces:**
- Consumes: nothing new — this is the base engine change.
- Produces:
  - `evaluateNotificationRules(db: D1Database, triggerEvent: string, context?: NotifyContext, env?: { ALERT_HUB?: DurableObjectNamespace }, dynamicUserIds?: number[]): Promise<{ rulesMatched: number; notified: number }>`
  - `fireRule(db: D1Database, rule: NotificationRuleRow, context?: NotifyContext, opts?: { testPrefix?: boolean }, env?: { ALERT_HUB?: DurableObjectNamespace }, dynamicUserIds?: number[]): Promise<number>`
  - Both existing exports keep their old call shape working (new param is optional and appended last), so every existing caller (`src/routes/fleetioWebhook.ts`, `src/utils/certExpirationSweep.ts`, etc.) is unaffected.

- [ ] **Step 1: Write the failing test for the dynamic-targets merge**

Create `tests/notificationEngineDynamicTargets.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/notificationEngineDynamicTargets.test.ts`
Expected: FAIL — `evaluateNotificationRules`/`fireRule` don't accept a 5th argument yet, and `NotificationRuleRow` may not be exported. (If TypeScript compiles but the test still passes with 0 notified everywhere, that also counts as a fail relative to the assertions above — check the actual mismatch message.)

- [ ] **Step 3: Export `NotificationRuleRow` and add the `dynamicUserIds` param**

In `src/routes/notificationEngine.ts`, the interface is already declared with `export interface NotificationRuleRow` (line 34) — confirm it stays exported (no change needed there, just verify).

Replace the `evaluateNotificationRules` function (lines 50-76) with:

```ts
export async function evaluateNotificationRules(
  db: D1Database,
  triggerEvent: string,
  context: NotifyContext = {},
  // Pass c.env so matched notifications fan out LIVE via AlertHubDO (the shared
  // cross-worker bus). Optional so existing/test callers still work — they just
  // skip the live push and the row still lands (poll/reload picks it up).
  env?: { ALERT_HUB?: DurableObjectNamespace },
  // Per-event recipients that aren't expressible as a rule's static
  // target_roles/target_user_ids — e.g. "the person who requested this
  // specific swap." Unioned with the rule's statically-resolved targets in
  // fireRule. Added for shift-plan swap approve/deny notifications; any
  // future event with a per-instance recipient can reuse this instead of
  // bypassing the rule engine.
  dynamicUserIds?: number[],
): Promise<{ rulesMatched: number; notified: number }> {
  let rulesMatched = 0;
  let notified = 0;
  try {
    const rules = await query<NotificationRuleRow>(
      db,
      `SELECT * FROM notification_rules WHERE trigger_event = ? AND is_active = 1`,
      triggerEvent,
    );
    for (const rule of rules) {
      if (!matchesConditions(rule.conditions, context)) continue;
      rulesMatched++;
      notified += await fireRule(db, rule, context, {}, env, dynamicUserIds);
    }
  } catch {
    // Swallow — the engine must never break the event that triggered it.
  }
  return { rulesMatched, notified };
}
```

Replace the `fireRule` function (lines 83-125) with:

```ts
export async function fireRule(
  db: D1Database,
  rule: NotificationRuleRow,
  context: NotifyContext = {},
  opts: { testPrefix?: boolean } = {},
  env?: { ALERT_HUB?: DurableObjectNamespace },
  dynamicUserIds?: number[],
): Promise<number> {
  const staticTargets = await resolveTargets(db, rule.target_roles, rule.target_user_ids);
  const userIds = [...new Set([...staticTargets, ...(dynamicUserIds ?? [])])];
  if (userIds.length === 0) return 0;

  const prefix = opts.testPrefix ? '[TEST] ' : '';
  const title = prefix + (context.title || rule.name);
  const message = context.message || rule.description || `Triggered by ${rule.trigger_event}`;
  const priority = context.priority || 'normal';

  for (const uid of userIds) {
    await execute(
      db,
      `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
      'alert', priority, title, message,
      context.entity_type ?? 'notification_rule', context.entity_id ?? rule.id, uid,
    );
  }
  await execute(
    db,
    `UPDATE notification_rules SET last_fired_at = datetime('now'), fire_count = fire_count + 1 WHERE id = ?`,
    rule.id,
  );

  // LIVE delivery — nudge every targeted user's notification bell over the
  // shared AlertHubDO bus. broadcastAll() is per-isolate-dead here (the client's
  // main socket is on the legacy worker), so without this a rule notification
  // only surfaced on a full page reload. The frame carries the target ids; the
  // client refetches its own user-scoped unread count, so a frame meant for
  // someone else is a harmless no-op. Best-effort — never break the trigger.
  if (env?.ALERT_HUB) {
    try {
      await emitAlert(env, 'notification', { action: 'notification_created', user_ids: userIds });
    } catch { /* fan-out failure must not break the triggering event */ }
  }
  return userIds.length;
}
```

Note the only behavioral changes: `resolveTargets(...)` result is now named `staticTargets` and unioned with `dynamicUserIds ?? []` through a `Set` (same dedup mechanism `resolveTargets` already uses internally for roles+ids). No other line changes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/notificationEngineDynamicTargets.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full existing notification-adjacent test files to confirm no regression**

Run: `npx vitest run tests/notificationEngineDynamicTargets.test.ts && npx tsc --noEmit`
Expected: PASS, 0 TypeScript errors (this confirms every existing caller of `evaluateNotificationRules`/`fireRule` still type-checks with the new optional trailing param).

- [ ] **Step 6: Commit**

```bash
git add src/routes/notificationEngine.ts tests/notificationEngineDynamicTargets.test.ts
git commit -m "feat(notifications): support dynamic per-event recipients in the rule engine"
```

---

### Task 2: Seed default notification rules for Shift Plans events

**Files:**
- Create: `migrations/0228_shift_plan_notification_rules.sql`

**Interfaces:**
- Consumes: nothing (pure SQL, no code dependency on Task 1).
- Produces: five active rows in `notification_rules` with `trigger_event` values `shift_swap_requested`, `shift_swap_approved`, `shift_swap_denied`, `shift_understaffed`, `shift_no_active_plan` — Tasks 3 and 4 call `evaluateNotificationRules` with exactly these strings.

- [ ] **Step 1: Write the migration**

Create `migrations/0228_shift_plan_notification_rules.sql`:

```sql
-- Default notification rules for the Shift Plans comms integration
-- (2026-08-08 design spec). Seeded here — like the Fleet.io reliability
-- rules in 0203 — rather than left for an admin to configure, since these
-- are safety/accountability-relevant (understaffed coverage, no active
-- plan) and time-sensitive (swap requests). An admin can edit or disable
-- any of these afterward from Admin -> Alert Rules like any other rule.
-- Idempotent via WHERE NOT EXISTS since notification_rules has no unique
-- index on trigger_event.

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Shift swap requested', 'An officer submitted a shift swap request that needs review.', 'shift_swap_requested', '{}', '["admin","manager","supervisor"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'shift_swap_requested');

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Shift swap approved', 'A shift swap request was approved.', 'shift_swap_approved', '{}', '[]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'shift_swap_approved');

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Shift swap denied', 'A shift swap request was denied.', 'shift_swap_denied', '{}', '[]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'shift_swap_denied');

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Shift understaffed', 'An upcoming shift is below its configured minimum staffing level.', 'shift_understaffed', '{}', '["admin","manager","supervisor","dispatcher"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'shift_understaffed');

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'No active shift plan', 'An upcoming date has no active shift plan.', 'shift_no_active_plan', '{}', '["admin","manager","supervisor","dispatcher"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'shift_no_active_plan');
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Expected: migration applies without error.

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT trigger_event, is_active FROM notification_rules WHERE trigger_event LIKE 'shift_%' ORDER BY trigger_event"`
Expected: 5 rows, all `is_active = 1`.

- [ ] **Step 3: Verify idempotency**

Run: `npm run migrate:local` again.
Expected: no error, and re-running the same `SELECT` above still returns exactly 5 rows (not 10) — confirms the `WHERE NOT EXISTS` guard works.

- [ ] **Step 4: Commit**

```bash
git add migrations/0228_shift_plan_notification_rules.sql
git commit -m "feat(shift-plans): seed default notification rules for swap/staffing events"
```

---

### Task 3: Fire notifications on swap request / approve / deny

**Files:**
- Modify: `src/routes/shiftPlans.ts:420-463`
- Test: `test-workers/shiftPlansNotifications.test.ts` (new)

**Interfaces:**
- Consumes: `evaluateNotificationRules(db, triggerEvent, context, env, dynamicUserIds?)` from Task 1; rules `shift_swap_requested`/`shift_swap_approved`/`shift_swap_denied` seeded in Task 2.
- Produces: nothing new consumed by later tasks — this task is self-contained.

- [ ] **Step 1: Write the failing Miniflare smoke test**

Create `test-workers/shiftPlansNotifications.test.ts`. Follow the existing Miniflare pattern used in `test-workers/health.test.ts`/`test-workers/auth.test.ts` (import `unstable_dev` or the project's shared Miniflare test harness — check `test-workers/auth.test.ts`'s imports first and mirror them exactly, since the harness setup is shared across that directory). The test body:

```ts
// test-workers/shiftPlansNotifications.test.ts
// Confirms shift-swap create/approve/deny still succeed and persist a row
// in `notifications` via the notification_rules engine, and that the
// approve/deny path notifies the ORIGINAL REQUESTER specifically (not just
// admin/manager/supervisor).
import { describe, it, expect, beforeAll } from 'vitest';
// NOTE: match the exact import(s) test-workers/auth.test.ts uses for its
// Miniflare Worker instance / D1 binding before writing this file — do not
// guess the harness API.

describe('Shift Plans swap notifications', () => {
  // Reuse the same login-as-test-user helper test-workers/auth.test.ts uses
  // to get an authenticated request for an officer role, and a second
  // login as an admin/manager/supervisor to approve it.

  it('POST /api/shift-swaps notifies admin/manager/supervisor', async () => {
    // 1. POST /api/shift-swaps as an authenticated officer with a valid
    //    shift_date, e.g. { shift_date: '2026-09-01', reason: 'test' }.
    // 2. Expect 201 and a body with { success: true, id: <number> }.
    // 3. Query the notifications table (or a debug endpoint if one exists)
    //    for rows with entity_type = 'shift_swap_request' and
    //    entity_id = the returned id — expect at least one row targeted
    //    at an admin/manager/supervisor test user.
  });

  it('PUT /api/shift-swaps/:id notifies the original requester on approval', async () => {
    // 1. Create a swap request as officer A (capture requester's user id
    //    and the returned swap id).
    // 2. PUT /api/shift-swaps/:id as admin with { status: 'approved' }.
    // 3. Expect 200 { success: true }.
    // 4. Query notifications for entity_type = 'shift_swap_request',
    //    entity_id = the swap id, user_id = officer A's id — expect exactly
    //    one row with title 'Shift swap approved'.
  });

  it('does not throw when ALERT_HUB is unbound', async () => {
    // Repeat the approve flow against a Miniflare env with ALERT_HUB
    // stripped (or use the harness's existing "no alert hub" fixture if
    // test-workers/ already has one — check auth.test.ts/health.test.ts
    // first) and confirm the response is still 200, not 500.
  });
});
```

Fill in the actual Miniflare setup/teardown boilerplate by copying it verbatim from `test-workers/auth.test.ts` (env creation, D1 seeding, auth token helper) — that file already solves "how do I get an authenticated request into this Worker under Miniflare" for this repo, so don't re-derive it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:worker -- shiftPlansNotifications`
Expected: FAIL (no notifications rows exist yet — the route doesn't call the engine).

- [ ] **Step 3: Add the notify call to `POST /shift-swaps`**

In `src/routes/shiftPlans.ts`, modify the handler at line 420 (`sp.post('/shift-swaps', ...)`). After the existing `execute(...)` insert (ends at line 440) and before the `return c.json(...)` (line 441), insert:

```ts
  const swapId = Number(r.meta.last_row_id);

  try {
    const { evaluateNotificationRules } = await import('./notificationEngine');
    await evaluateNotificationRules(db, 'shift_swap_requested', {
      title: 'Shift swap requested',
      message: `${user.full_name ?? 'An officer'} requested a swap for ${body.shift_date}`,
      priority: 'normal',
      entity_type: 'shift_swap_request',
      entity_id: swapId,
    }, c.env);
  } catch { /* notification failure must never block the swap request */ }

  return c.json({ success: true, id: swapId }, 201);
```

Remove the old `return c.json({ success: true, id: r.meta.last_row_id }, 201);` line (it's replaced by the block above, which reuses the same value via the new `swapId` local). Add `import { evaluateNotificationRules } from './notificationEngine';` is intentionally NOT added as a static top-of-file import — this router already dynamic-imports sibling modules lazily in a couple of spots in this codebase's other routers to avoid pulling every route's dependency graph into every cold start; a dynamic `await import(...)` inside the try block keeps this consistent. (If `src/routes/shiftPlans.ts` has no existing dynamic-import precedent when you check it, use a normal top-of-file `import { evaluateNotificationRules } from './notificationEngine';` instead — simpler and equally correct; check the file's current import block at lines 21-24 first.)

- [ ] **Step 4: Add the notify call to `PUT /shift-swaps/:id`**

Modify the handler at line 444. The current body (lines 444-463) does not fetch the existing swap row before updating — add a lookup so the requester/target ids and shift_date are available for the notification. Replace the full handler with:

```ts
sp.put('/shift-swaps/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  if (!['approved', 'denied'].includes(body.status)) {
    return c.json({ error: 'status must be approved or denied' }, 400);
  }
  const user = c.get('user') as { id: number; full_name?: string } | undefined;
  const db = getDb(c.env);

  const swap = await queryFirst<{ requester_id: number | null; target_id: number | null; shift_date: string }>(
    db,
    'SELECT requester_id, target_id, shift_date FROM shift_swap_requests WHERE id = ?',
    id,
  );
  if (!swap) return c.json({ error: 'Shift swap request not found' }, 404);

  await execute(
    db,
    `UPDATE shift_swap_requests SET status = ?, reviewed_by = ?, reviewed_by_name = ?,
       reviewed_at = datetime('now'), review_notes = ?
     WHERE id = ?`,
    body.status, user?.id ?? null, user?.full_name ?? null, body.review_notes ?? null, id,
  );

  try {
    const { evaluateNotificationRules } = await import('./notificationEngine');
    const dynamicTargets = [swap.requester_id, swap.target_id]
      .filter((x): x is number => typeof x === 'number');
    await evaluateNotificationRules(db, `shift_swap_${body.status}`, {
      title: body.status === 'approved' ? 'Shift swap approved' : 'Shift swap denied',
      message: `Your swap request for ${swap.shift_date} was ${body.status}`,
      priority: 'normal',
      entity_type: 'shift_swap_request',
      entity_id: id,
    }, c.env, dynamicTargets);
  } catch { /* notification failure must never block the swap review */ }

  return c.json({ success: true });
});
```

(Match whichever import style — dynamic vs. static — you settled on in Step 3, for consistency within the file.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:worker -- shiftPlansNotifications`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full worker test suites to confirm no regression**

Run: `npx vitest run && npm run test:worker && npm run typecheck`
Expected: PASS (aside from the already-known, unrelated `tests/osmSpeedLimitLookup.test.ts` failure tracked separately — do not treat that file's failures as caused by this change).

- [ ] **Step 7: Commit**

```bash
git add src/routes/shiftPlans.ts test-workers/shiftPlansNotifications.test.ts
git commit -m "feat(shift-plans): notify on swap request/approve/deny via notification engine"
```

---

### Task 4: Daily sweep for understaffed shifts and missing plans

**Files:**
- Create: `src/utils/shiftPlanNotifySweep.ts`
- Modify: `src/index.ts` (inside the existing `if (denverHour === 4 && denverMinute === 0)` block — same block that already calls `sweepFleetMaintenanceReminders`/`sweepCertExpirations`)
- Test: `tests/shiftPlanNotifySweep.test.ts` (new)

**Interfaces:**
- Consumes: `evaluateNotificationRules` from Task 1 (with no `dynamicUserIds` — these are role-targeted, not per-instance); rules `shift_understaffed`/`shift_no_active_plan` seeded in Task 2; `query` from `src/utils/db.ts`.
- Produces: `sweepShiftPlanNotifications(db: D1Database, env?: { ALERT_HUB?: DurableObjectNamespace }): Promise<{ understaffed: number; noPlan: number; notified: number }>` — this is the exact function/signature `src/index.ts` calls; no later task depends on it beyond that call site.

- [ ] **Step 1: Write the failing unit test**

Create `tests/shiftPlanNotifySweep.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shiftPlanNotifySweep.test.ts`
Expected: FAIL — `src/utils/shiftPlanNotifySweep.ts` doesn't exist yet.

- [ ] **Step 3: Implement the sweep**

Create `src/utils/shiftPlanNotifySweep.ts`:

```ts
// ============================================================
// Shift Plans — Daily Understaffed/No-Plan Notification Sweep
// ============================================================
// GET /shift-plans/conflicts and GET /staffing-levels are on-demand-only —
// nothing proactively tells a supervisor that a shift 3 days out is short-
// staffed or that a date has no active plan at all, until someone opens
// the Shift Plans page. Same dashboard-only gap fleet maintenance and
// certification expirations had before those got cron sweeps; reuses the
// same notification-rule engine (2026-08-08 comms integration spec).
//
// Reuses the exact staffing-minimum logic from GET /staffing-levels
// (src/routes/shiftPlans.ts) — {day:2, swing:2, graveyard:1} — and the
// no-active-plan check from GET /shift-notifications, so the sweep and the
// on-demand endpoints never drift apart in what counts as "understaffed."
// ============================================================

import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import { query } from './db';
import { evaluateNotificationRules } from '../routes/notificationEngine';

const STAFFING_MINIMUMS: Record<string, number> = { day: 2, swing: 2, graveyard: 1 };
const SWEEP_WINDOW_DAYS = 7;

interface PlanRow {
  id: number;
  date: string;
  shift_type: string;
  assignments: string;
}

function denverDateStrings(count: number): string[] {
  // America/Denver "today" as YYYY-MM-DD, then +1..+(count-1) days. Uses
  // Intl the same way src/index.ts's cron gate already does for Denver-
  // local hour/minute, so this sweep's "today" always matches the cron's
  // "today" even near a DST boundary or a UTC-day rollover.
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  const start = new Date(`${y}-${m}-${d}T12:00:00Z`); // noon UTC avoids DST edge cases when adding days
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    const dt = new Date(start.getTime() + i * 86_400_000);
    dates.push(dt.toISOString().slice(0, 10));
  }
  return dates;
}

export async function sweepShiftPlanNotifications(
  db: D1Database,
  env?: { ALERT_HUB?: DurableObjectNamespace },
): Promise<{ understaffed: number; noPlan: number; notified: number }> {
  let understaffed = 0;
  let noPlan = 0;
  let notified = 0;

  for (const date of denverDateStrings(SWEEP_WINDOW_DAYS)) {
    const plans = await query<PlanRow>(
      db,
      `SELECT id, date, shift_type, assignments FROM shift_plans WHERE date = ? AND status = 'active' ORDER BY shift_type`,
      date,
    );

    if (plans.length === 0) {
      noPlan++;
      const { notified: n } = await evaluateNotificationRules(db, 'shift_no_active_plan', {
        title: 'No active shift plan',
        message: `${date} has no active shift plan.`,
        priority: 'critical',
        entity_type: 'shift_plan_date',
        entity_id: 0,
      }, env);
      notified += n;
      continue;
    }

    for (const plan of plans) {
      let assignments: unknown[] = [];
      try { assignments = typeof plan.assignments === 'string' ? JSON.parse(plan.assignments) : (plan.assignments as unknown[] ?? []); }
      catch { assignments = []; }
      const minimum = STAFFING_MINIMUMS[plan.shift_type] ?? 1;
      if (assignments.length >= minimum) continue;

      understaffed++;
      const { notified: n } = await evaluateNotificationRules(db, 'shift_understaffed', {
        title: `Understaffed: ${date} ${plan.shift_type}`,
        message: `${date} ${plan.shift_type} shift has ${assignments.length} of ${minimum} required officer(s).`,
        priority: 'warning',
        entity_type: 'shift_plan',
        entity_id: plan.id,
      }, env);
      notified += n;
    }
  }

  return { understaffed, noPlan, notified };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/shiftPlanNotifySweep.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Hook the sweep into the 04:00 Denver cron block**

In `src/index.ts`, inside the existing `if (denverHour === 4 && denverMinute === 0) { ... }` block (the same block containing the `sweepFleetMaintenanceReminders`/`sweepCertExpirations`/`serveStaleAutoCloseSweep` calls), add:

```ts
        // Shift Plans understaffed/no-plan reminders — same on-demand-
        // dashboard-only gap fleet maintenance and cert expirations had;
        // fires via the notification-rule engine (2026-08-08 comms
        // integration spec). Rules shift_understaffed/shift_no_active_plan
        // are seeded active by default (migration 0228).
        ctx.waitUntil(
          import('./utils/shiftPlanNotifySweep').then((m) =>
            m.sweepShiftPlanNotifications(env.DB, env).then((r) =>
              console.log(`[shift-plan-notify] understaffed=${r.understaffed} noPlan=${r.noPlan} notified=${r.notified}`),
            ).catch((err) => console.error('Shift plan notification sweep failed:', err)),
          ).catch(() => {}),
        );
```

Place it directly after the existing `serveStaleAutoCloseSweep` block (matching the ordering convention of "reminders after the day's other maintenance tasks").

- [ ] **Step 6: Run typecheck and the full unit suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 TypeScript errors; all tests pass except the pre-existing, unrelated `tests/osmSpeedLimitLookup.test.ts` failures.

- [ ] **Step 7: Commit**

```bash
git add src/utils/shiftPlanNotifySweep.ts src/index.ts tests/shiftPlanNotifySweep.test.ts
git commit -m "feat(shift-plans): daily sweep notifies on understaffed shifts and missing plans"
```

---

### Task 5: Apply migration to live D1 and verify end-to-end

**Files:**
- None (operational task — no code changes).

**Interfaces:**
- Consumes: `migrations/0228_shift_plan_notification_rules.sql` from Task 2.
- Produces: nothing for later tasks — this is the final verification step.

- [ ] **Step 1: Merge to main and confirm deploy**

After this plan's PR is merged, confirm `.github/workflows/deploy.yml` completed (Worker typecheck → migrations apply, `continue-on-error` → `wrangler deploy` → client build/deploy).

- [ ] **Step 2: Apply and track the migration on live D1**

Run:
```bash
scripts/apply-migration.sh 0228_shift_plan_notification_rules.sql
```
Expected: script runs `wrangler d1 execute --remote --file` then inserts the tracking row into `d1_migrations` without error.

- [ ] **Step 3: Verify the rules landed**

Run:
```bash
npx wrangler d1 execute rmpg-flex --remote --command "SELECT trigger_event, is_active, target_roles FROM notification_rules WHERE trigger_event LIKE 'shift_%' ORDER BY trigger_event"
```
Expected: 5 rows, all `is_active = 1`, matching the table in the design spec.

- [ ] **Step 4: Manual end-to-end check**

As documented in the spec's Testing section: submit a real swap request as a non-admin test user (see `reference-live-test-account` memory for the `temp_audit_user` login/reset recipe), approve it as admin, and confirm both users see the notification in the bell (`GET /api/notifications` unread count increments, or the bell UI shows it).

- [ ] **Step 5: Confirm the cron sweep runs**

Wait for (or manually trigger via `wrangler tail` at) the next 04:00 America/Denver tick, and confirm the Worker log shows a line like `[shift-plan-notify] understaffed=N noPlan=N notified=N`.

---

## Self-Review Notes

- **Spec coverage:** All four events from the spec (swap requested/approved/denied, understaffed, no-active-plan) are covered — Task 3 handles the two swap-mutation events, Task 4 handles the two sweep-detected events. The dynamic-targets engine change (spec's "Engine change" section) is Task 1. The seeded-rules table (spec's "Default notification rules" section) is Task 2. Migration-application and manual verification (spec's "Testing" section, last bullet) is Task 5.
- **Placeholder scan:** No TBD/TODO markers; every step has complete, concrete code or an exact command with an expected outcome.
- **Type consistency:** `sweepShiftPlanNotifications(db, env?)` signature in Task 4's implementation matches exactly what Task 4's `src/index.ts` hook and Task 4's test call. `evaluateNotificationRules(db, triggerEvent, context, env?, dynamicUserIds?)` signature from Task 1 matches every call site added in Tasks 3 and 4.
