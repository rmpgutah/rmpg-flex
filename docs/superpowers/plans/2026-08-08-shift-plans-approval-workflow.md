# Shift Plans — Swap Approval Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a target-officer acceptance step before supervisor approval on shift swaps, a 24-hour escalation reminder for stalled requests, a full audit trail via the existing `activity_log` table, and the swap-requests UI panel needed to actually use any of it (today `PUT /shift-swaps/:id` has zero client callers).

**Architecture:** A SQLite table-rebuild migration widens `shift_swap_requests.status`'s CHECK constraint and adds two columns. `POST /shift-swaps/:id/respond` (new) lets the named target officer accept (→ `pending_supervisor`, notifies approvers) or reject (→ `denied`, notifies requester) — both via the existing `evaluateNotificationRules` engine from the merged comms-integration work. The existing `PUT /shift-swaps/:id` gains one guard: it now 400s if a targeted swap hasn't been accepted yet. A new sweep function, hooked into the existing 04:00 America/Denver cron block, escalates any swap stuck for 24+ hours. Every transition writes one row to the generic `activity_log` table — no new audit table. A new modal in `ShiftPlansPage.tsx` lists swaps needing the current user's action.

**Tech Stack:** Hono route handlers, Cloudflare D1 (`src/utils/db.ts`), Vitest (Node) + Miniflare (`test-workers/`) for backend tests, React/TypeScript for the client panel.

## Global Constraints

- D1 calls (`query`/`queryFirst`/`execute`) are always `await`ed.
- `evaluateNotificationRules` never throws into its caller — every new call site wraps in try/catch, matching the existing convention in `src/routes/shiftPlans.ts`'s swap handlers.
- SQLite cannot `ALTER` a CHECK constraint — the status-widening migration MUST use the create-new-table → copy → drop → rename pattern. **Follow the exact precedent in `migrations/0040_calls_status_add_on_hold.sql`**: no extra idempotency guard around the rebuild itself (D1's migration tracking via `d1_migrations` + `scripts/apply-migration.sh` is what prevents re-application — the codebase's real precedent for this exact migration shape does not add a defensive re-run check, and inventing one here would be inconsistent with 0040).
- Migration numbering: current high-water is `0228` (comms-integration sub-project, already merged into this branch's history). This plan uses `0229`.
- All timestamps are UTC (`datetime('now')`), matching every existing column in this table — never manual offset math (CLAUDE.md).
- No new secrets, services, or external providers.
- Radius/spacing/color tokens in any new client markup follow the existing Blue & Silver theme rules already used elsewhere in `ShiftPlansPage.tsx` (`bg-surface-*`, `text-rmpg-*`, 2px radius, no hardcoded hex) — copy the existing `showTemplateModal` modal's structure rather than inventing new patterns.
- After merge, apply `0229_shift_swap_approval_workflow.sql` to live D1 (`785de7ae`) via `scripts/apply-migration.sh` (deploy's migration step is `continue-on-error`).

---

### Task 1: Migration — widen status CHECK, add columns, seed two rules

**Files:**
- Create: `migrations/0229_shift_swap_approval_workflow.sql`

**Interfaces:**
- Consumes: nothing (pure SQL).
- Produces: `shift_swap_requests.status` now allows `'pending_supervisor'` in addition to the existing four values; two new nullable TEXT columns `target_responded_at` and `escalated_at`. Two new active rows in `notification_rules` with `trigger_event` = `shift_swap_target_accepted` and `shift_swap_escalated` — Tasks 2 and 3 call `evaluateNotificationRules` with exactly these strings.

- [ ] **Step 1: Write the migration**

Create `migrations/0229_shift_swap_approval_workflow.sql`:

```sql
-- 0229_shift_swap_approval_workflow.sql
-- =====================================================================
-- Adds a target-officer acceptance step to the shift-swap lifecycle.
--
-- WHY A FULL TABLE REBUILD:
--   SQLite (and therefore D1) cannot ALTER an existing CHECK constraint.
--   The only way to change it is the standard create-new -> copy -> drop ->
--   rename procedure (same pattern as migrations/0040_calls_status_add_on_hold.sql).
--   No extra idempotency guard is added around the rebuild itself, matching
--   0040's precedent -- D1's migration tracking (scripts/apply-migration.sh
--   + the d1_migrations table) is what prevents re-application, not
--   defensive SQL inside the migration file.
--
-- New columns:
--   target_responded_at -- stamped when the named target officer
--                           accepts/rejects; NULL until then.
--   escalated_at         -- stamped the first time the 24h escalation
--                           sweep fires for this row; the sweep's dedupe
--                           key so a swap is escalated at most once.
--
-- This migration ONLY changes the status CHECK line and adds the two
-- columns above. Every other column, default, and FK is reproduced
-- verbatim from migrations/0031_shift_plans.sql so `INSERT ... SELECT`
-- lines up 1:1 (with two extra trailing NULLs for the new columns).
-- =====================================================================

CREATE TABLE shift_swap_requests_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  requester_name TEXT,
  target_id INTEGER REFERENCES users(id),
  target_name TEXT,
  plan_id TEXT REFERENCES shift_plans(id),
  shift_date TEXT NOT NULL,
  original_shift TEXT,
  requested_shift TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending','pending_supervisor','approved','denied','cancelled'
  )),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_by_name TEXT,
  reviewed_at TEXT,
  review_notes TEXT,
  target_responded_at TEXT,
  escalated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO shift_swap_requests_new (
  id, requester_id, requester_name, target_id, target_name, plan_id,
  shift_date, original_shift, requested_shift, reason, status,
  reviewed_by, reviewed_by_name, reviewed_at, review_notes,
  target_responded_at, escalated_at, created_at
)
SELECT
  id, requester_id, requester_name, target_id, target_name, plan_id,
  shift_date, original_shift, requested_shift, reason, status,
  reviewed_by, reviewed_by_name, reviewed_at, review_notes,
  NULL, NULL, created_at
FROM shift_swap_requests;

DROP TABLE shift_swap_requests;

ALTER TABLE shift_swap_requests_new RENAME TO shift_swap_requests;

CREATE INDEX IF NOT EXISTS idx_shift_swaps_status ON shift_swap_requests(status);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_date ON shift_swap_requests(shift_date);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_requester ON shift_swap_requests(requester_id);

-- Default notification rules for the two new events this sub-project
-- introduces. Follows the exact seeding precedent from migration 0228
-- (comms-integration sub-project) -- idempotent via WHERE NOT EXISTS
-- since notification_rules has no unique index on trigger_event.

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Shift swap target accepted', 'A named target officer accepted a shift swap -- ready for supervisor review.', 'shift_swap_target_accepted', '{}', '["admin","manager","supervisor"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'shift_swap_target_accepted');

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Shift swap escalated', 'A shift swap request has been awaiting action for over 24 hours.', 'shift_swap_escalated', '{}', '["admin","manager"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'shift_swap_escalated');
```

- [ ] **Step 2: Apply locally and verify the schema**

Run: `npm run migrate:local` (add `--config wrangler.toml` if this worktree hits the same config-resolution quirk documented in the comms-integration task-2 report — check `.superpowers/sdd/task-2-report.md` from that sub-project if present).

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT sql FROM sqlite_master WHERE name='shift_swap_requests'"`
Expected: the returned `CREATE TABLE` text includes `'pending_supervisor'` in the status CHECK and both new columns.

- [ ] **Step 3: Verify the two new rules landed**

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT trigger_event, is_active FROM notification_rules WHERE trigger_event IN ('shift_swap_target_accepted','shift_swap_escalated') ORDER BY trigger_event"`
Expected: 2 rows, both `is_active = 1`.

- [ ] **Step 4: Verify existing swap rows survived the rebuild**

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT COUNT(*) AS cnt FROM shift_swap_requests"`
Note the count, then re-run the same query after Step 2's migration and confirm it matches the pre-migration count (if any test data exists locally; 0 is a valid pre-migration count in a fresh local DB — the check is "unchanged," not "non-zero").

- [ ] **Step 5: Commit**

```bash
git add migrations/0229_shift_swap_approval_workflow.sql
git commit -m "feat(shift-plans): add target-acceptance status + escalation rules"
```

---

### Task 2: Target-response route, PUT gate tightening, and audit trail

**Files:**
- Modify: `src/routes/shiftPlans.ts:424-501` (the `POST /shift-swaps` and `PUT /shift-swaps/:id` handlers, plus a new route inserted between them)
- Test: `test-workers/shiftSwapApproval.test.ts` (new)

**Interfaces:**
- Consumes: `evaluateNotificationRules(db, triggerEvent, context, env, dynamicUserIds?)` (already imported at the top of this file); rules `shift_swap_target_accepted`/`shift_swap_escalated` from Task 1; the existing `shift_swap_denied` rule from migration 0228 (reused for target rejections).
- Produces: `POST /shift-swaps/:id/respond` — no other task depends on this beyond the client (Task 4), which calls it by path/method exactly as specified here.

- [ ] **Step 1: Write the failing Miniflare test**

Create `test-workers/shiftSwapApproval.test.ts`. Copy the exact harness setup (imports, `env` from `'cloudflare:test'`, `mintAccessToken`/`seedUser` helpers, direct `.request(path, init, testEnv())` pattern) from `test-workers/shiftPlansNotifications.test.ts` — that file already solves "how do I get an authenticated request into this router under Miniflare" for this exact router. The test body:

```ts
// test-workers/shiftSwapApproval.test.ts
// Covers the target-acceptance step added on top of the existing swap
// approve/deny flow: target accepts -> pending_supervisor -> supervisor
// approves; target rejects -> denied, requester notified; and the PUT
// gate that blocks a supervisor from approving a still-unaccepted swap.
import { describe, it, expect, beforeEach } from 'vitest';
// NOTE: copy the exact import list and seedUser/mintAccessToken helpers
// from test-workers/shiftPlansNotifications.test.ts verbatim -- do not
// re-derive the Miniflare harness.

describe('Shift swap target-acceptance workflow', () => {
  it('target accepts a swap, moving it to pending_supervisor and notifying approvers', async () => {
    // 1. Seed a requester (officer A) and a target (officer B), both role
    //    'officer'. Seed an admin (role 'admin') for the final approval step.
    // 2. POST /api/shift-swaps as officer A with
    //    { shift_date: '2026-09-01', target_id: <officer B id>, reason: 'test' }.
    //    Expect 201, capture the returned id.
    // 3. POST /api/shift-swaps/:id/respond as officer B with { accept: true }.
    //    Expect 200 { success: true }.
    // 4. Query shift_swap_requests for that id -- expect
    //    status = 'pending_supervisor' and target_responded_at IS NOT NULL.
    // 5. Query notifications for entity_type='shift_swap_request',
    //    entity_id=<id> -- expect a row targeted at the admin test user
    //    (via the shift_swap_target_accepted rule's admin/manager/supervisor
    //    static targets).
    // 6. PUT /api/shift-swaps/:id as admin with { status: 'approved' }.
    //    Expect 200 { success: true } -- this must succeed now that the
    //    swap is in pending_supervisor.
  });

  it('target rejects a swap, moving it directly to denied and notifying the requester', async () => {
    // 1. Same setup as above (officer A requests, targets officer B).
    // 2. POST /api/shift-swaps/:id/respond as officer B with { accept: false }.
    //    Expect 200 { success: true }.
    // 3. Query shift_swap_requests -- expect status = 'denied',
    //    target_responded_at IS NOT NULL, review_notes mentions the
    //    target's name and that they declined.
    // 4. Query notifications for entity_type='shift_swap_request',
    //    entity_id=<id>, user_id=<officer A's id> -- expect one row
    //    (the requester specifically, via dynamicUserIds on the reused
    //    shift_swap_denied rule).
  });

  it('rejects PUT /shift-swaps/:id while a targeted swap is still awaiting the target response', async () => {
    // 1. Officer A requests a swap targeting officer B (status stays 'pending').
    // 2. PUT /api/shift-swaps/:id as admin with { status: 'approved' }
    //    WITHOUT officer B having responded first.
    // 3. Expect 400, and the error message should mention the target's
    //    response is pending.
    // 4. Query shift_swap_requests -- confirm status is STILL 'pending'
    //    (the blocked PUT must not have mutated anything).
  });

  it('POST /shift-swaps/:id/respond is target-only -- 403 for anyone else, including admin', async () => {
    // 1. Officer A requests a swap targeting officer B.
    // 2. POST /api/shift-swaps/:id/respond as the ADMIN test user (not
    //    officer B) with { accept: true }.
    // 3. Expect 403.
  });

  it('POST /shift-swaps/:id/respond 400s when there is no target_id to respond to', async () => {
    // 1. Officer A requests an OPEN swap (no target_id).
    // 2. POST /api/shift-swaps/:id/respond as any officer with
    //    { accept: true }.
    // 3. Expect 400.
  });
});
```

Fill in the actual seed/auth boilerplate by copying it from `test-workers/shiftPlansNotifications.test.ts` verbatim, adapted for two distinct non-admin test users (requester and target) plus one admin.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:worker -- shiftSwapApproval`
Expected: FAIL — `/shift-swaps/:id/respond` doesn't exist (404), and the PUT gate doesn't yet check for `pending_supervisor`.

- [ ] **Step 3: Insert the new `POST /shift-swaps/:id/respond` route**

In `src/routes/shiftPlans.ts`, insert this new route immediately after the `POST /shift-swaps` handler (after line 459, before the existing `sp.put('/shift-swaps/:id', ...)` at line 461):

```ts
sp.post('/shift-swaps/:id/respond', async (c) => {
  const user = c.get('user') as { id: number; full_name?: string } | undefined;
  if (!user) return c.json({ error: 'Unauthenticated' }, 401);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<{ accept?: boolean }>().catch(() => ({} as { accept?: boolean }));
  if (typeof body.accept !== 'boolean') {
    return c.json({ error: 'accept (boolean) is required' }, 400);
  }
  const db = getDb(c.env);

  const swap = await queryFirst<{
    requester_id: number; target_id: number | null; target_name: string | null;
    shift_date: string; status: string;
  }>(
    db,
    'SELECT requester_id, target_id, target_name, shift_date, status FROM shift_swap_requests WHERE id = ?',
    id,
  );
  if (!swap) return c.json({ error: 'Shift swap request not found' }, 404);
  if (swap.target_id === null) {
    return c.json({ error: 'This swap has no target officer to respond' }, 400);
  }
  if (swap.target_id !== user.id) {
    return c.json({ error: 'Only the target officer can respond to this swap' }, 403);
  }
  if (swap.status !== 'pending') {
    return c.json({ error: 'This swap is not awaiting a response' }, 400);
  }

  if (body.accept) {
    await execute(
      db,
      `UPDATE shift_swap_requests SET status = 'pending_supervisor', target_responded_at = datetime('now') WHERE id = ?`,
      id,
    );
    await writeSwapActivityLog(db, user.id, 'swap_target_accepted', id, { shift_date: swap.shift_date });
    try {
      await evaluateNotificationRules(db, 'shift_swap_target_accepted', {
        title: 'Shift swap accepted — ready for review',
        message: `${swap.target_name ?? 'The target officer'} accepted a swap for ${swap.shift_date}`,
        priority: 'normal',
        entity_type: 'shift_swap_request',
        entity_id: id,
      }, c.env);
    } catch { /* notification failure must never block the response */ }
  } else {
    const declineNote = `${swap.target_name ?? 'The target officer'} declined the swap`;
    await execute(
      db,
      `UPDATE shift_swap_requests SET status = 'denied', target_responded_at = datetime('now'), review_notes = ? WHERE id = ?`,
      declineNote, id,
    );
    await writeSwapActivityLog(db, user.id, 'swap_target_rejected', id, { shift_date: swap.shift_date });
    try {
      await evaluateNotificationRules(db, 'shift_swap_denied', {
        title: 'Shift swap denied',
        message: `Your swap request for ${swap.shift_date} was declined by the target officer`,
        priority: 'normal',
        entity_type: 'shift_swap_request',
        entity_id: id,
      }, c.env, [swap.requester_id]);
    } catch { /* notification failure must never block the response */ }
  }

  return c.json({ success: true });
});
```

- [ ] **Step 4: Add the audit-log helper**

Add this helper function near the top of `src/routes/shiftPlans.ts`, alongside the existing `requireRole`/`parseAssignments`/`csvEscape` helpers (after `csvEscape`, around line 83):

```ts
// Every shift-swap status transition writes one row to the existing
// generic activity_log table (migrations/0001_initial.sql) rather than a
// new dedicated audit table -- entity_type='shift_swap_request' lets a
// future "history for this swap" view query
// activity_log WHERE entity_type = 'shift_swap_request' AND entity_id = ?
// with no new schema.
async function writeSwapActivityLog(
  db: ReturnType<typeof getDb>,
  actorUserId: number,
  action: string,
  swapId: number,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await execute(
      db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, 'shift_swap_request', ?, ?, datetime('now'))`,
      actorUserId, action, swapId, JSON.stringify(details),
    );
  } catch { /* audit-log failure must never block the swap action */ }
}
```

- [ ] **Step 5: Add activity-log calls to the existing `POST /shift-swaps` and `PUT /shift-swaps/:id` handlers**

In `POST /shift-swaps` (line 424), after the `swapId` is computed (line 446) and before the existing notification try/catch (line 448), add:

```ts
  await writeSwapActivityLog(db, user.id, 'swap_requested', swapId, { shift_date: body.shift_date, target_id: body.target_id ?? null });
```

In `PUT /shift-swaps/:id` (line 461), after the existing `UPDATE` (ends line 486) and before the notification try/catch (line 488), add:

```ts
  await writeSwapActivityLog(db, user?.id ?? 0, `swap_${body.status}`, id, { shift_date: swap.shift_date, review_notes: body.review_notes ?? null });
```

- [ ] **Step 6: Tighten the `PUT /shift-swaps/:id` gate**

Replace the existing handler's status-fetch section (lines 471-478) with:

```ts
  const swap = await queryFirst<{ requester_id: number | null; target_id: number | null; shift_date: string; status: string }>(
    db,
    'SELECT requester_id, target_id, shift_date, status FROM shift_swap_requests WHERE id = ?',
    id,
  );
  if (!swap) return c.json({ error: 'Shift swap request not found' }, 404);
  if (swap.target_id !== null && swap.status === 'pending') {
    return c.json({ error: "This swap is awaiting the target officer's response" }, 400);
  }
  if (swap.status !== 'pending' && swap.status !== 'pending_supervisor') {
    return c.json({ error: `Cannot review a swap in status '${swap.status}'` }, 400);
  }
```

(This replaces the original 2-line `if (!swap) ...` check with the same check plus the two new guards — the rest of the handler, including the `UPDATE` and the notification block, is unchanged except for the activity-log line added in Step 5.)

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm run test:worker -- shiftSwapApproval`
Expected: PASS (5 tests)

- [ ] **Step 8: Run the existing swap-notification tests to confirm no regression**

Run: `npm run test:worker -- shiftPlansNotifications`
Expected: PASS (3/3, unchanged from the comms-integration sub-project — confirms the PUT gate tightening didn't break the open-swap, no-target-id happy path those tests cover).

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (this repo's pbf/osm issue was fixed in #3316, already in this branch's history).

- [ ] **Step 10: Commit**

```bash
git add src/routes/shiftPlans.ts test-workers/shiftSwapApproval.test.ts
git commit -m "feat(shift-plans): add target-response route, PUT gate, and swap audit log"
```

---

### Task 3: 24-hour escalation sweep

**Files:**
- Create: `src/utils/shiftSwapEscalationSweep.ts`
- Modify: `src/index.ts` (inside the existing `if (denverHour === 4 && denverMinute === 0)` block, alongside the `shiftPlanNotifySweep` call already there)
- Test: `tests/shiftSwapEscalationSweep.test.ts` (new)

**Interfaces:**
- Consumes: `evaluateNotificationRules` from `src/routes/notificationEngine.ts`; rule `shift_swap_escalated` from Task 1; `query`/`execute` from `src/utils/db.ts`.
- Produces: `sweepShiftSwapEscalations(db: D1Database, env?: { ALERT_HUB?: DurableObjectNamespace }): Promise<{ escalated: number; notified: number }>` — the exact function/signature `src/index.ts` calls.

- [ ] **Step 1: Write the failing unit test**

Create `tests/shiftSwapEscalationSweep.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shiftSwapEscalationSweep.test.ts`
Expected: FAIL — `src/utils/shiftSwapEscalationSweep.ts` doesn't exist yet.

- [ ] **Step 3: Implement the sweep**

Create `src/utils/shiftSwapEscalationSweep.ts`:

```ts
// ============================================================
// Shift Swaps — 24-Hour Escalation Sweep
// ============================================================
// A shift-swap request can sit in 'pending' (awaiting the target
// officer's response) or 'pending_supervisor' (awaiting final approval)
// indefinitely with no reminder to anyone. This sweep, run from the
// existing daily 04:00 America/Denver cron block, escalates any swap
// that's been in either state for 24+ hours by notifying admin/manager
// via the notification-rule engine (2026-08-08 approval-workflow spec).
//
// escalated_at is the dedupe key: once stamped, a swap is never
// re-escalated, even though it stays matched by the status filter until
// someone actually acts on it. Without this, a swap stuck for a week
// would fire a fresh escalation notification every single day.
// ============================================================

import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import { query, execute } from './db';
import { evaluateNotificationRules } from '../routes/notificationEngine';

const ESCALATION_HOURS = 24;

interface StaleSwapRow {
  id: number;
  requester_id: number;
  target_id: number | null;
  status: string;
}

export async function sweepShiftSwapEscalations(
  db: D1Database,
  env?: { ALERT_HUB?: DurableObjectNamespace },
): Promise<{ escalated: number; notified: number }> {
  const staleSwaps = await query<StaleSwapRow>(
    db,
    `SELECT id, requester_id, target_id, status FROM shift_swap_requests
     WHERE escalated_at IS NULL
       AND (
         (status = 'pending' AND created_at <= datetime('now', '-${ESCALATION_HOURS} hours'))
         OR
         (status = 'pending_supervisor' AND target_responded_at <= datetime('now', '-${ESCALATION_HOURS} hours'))
       )`,
  );

  let escalated = 0;
  let notified = 0;

  for (const swap of staleSwaps) {
    await execute(
      db,
      `UPDATE shift_swap_requests SET escalated_at = datetime('now') WHERE id = ?`,
      swap.id,
    );
    escalated++;

    const { notified: n } = await evaluateNotificationRules(db, 'shift_swap_escalated', {
      title: 'Shift swap needs attention',
      message: `Swap request #${swap.id} has been awaiting action for over ${ESCALATION_HOURS} hours (status: ${swap.status})`,
      priority: 'warning',
      entity_type: 'shift_swap_request',
      entity_id: swap.id,
    }, env);
    notified += n;
  }

  return { escalated, notified };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/shiftSwapEscalationSweep.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Hook the sweep into the 04:00 Denver cron block**

In `src/index.ts`, inside the existing `if (denverHour === 4 && denverMinute === 0) { ... }` block, add this directly after the existing `shiftPlanNotifySweep` call:

```ts
        // Shift swap escalation reminders — a swap stuck awaiting target
        // response or supervisor approval for 24+ hours notifies
        // admin/manager (2026-08-08 approval-workflow spec). Rule
        // shift_swap_escalated is seeded active by default (migration 0229).
        ctx.waitUntil(
          import('./utils/shiftSwapEscalationSweep').then((m) =>
            m.sweepShiftSwapEscalations(env.DB, env).then((r) =>
              console.log(`[shift-swap-escalation] escalated=${r.escalated} notified=${r.notified}`),
            ).catch((err) => console.error('Shift swap escalation sweep failed:', err)),
          ).catch(() => {}),
        );
```

- [ ] **Step 6: Run typecheck and the unit suite**

Run: `npx tsc --noEmit && npx vitest run tests/shiftSwapEscalationSweep.test.ts`
Expected: 0 TypeScript errors; 3/3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/utils/shiftSwapEscalationSweep.ts src/index.ts tests/shiftSwapEscalationSweep.test.ts
git commit -m "feat(shift-plans): escalate stalled swap requests after 24 hours"
```

---

### Task 4: Swap-requests panel in ShiftPlansPage

**Files:**
- Modify: `client/src/pages/ShiftPlansPage.tsx`

**Interfaces:**
- Consumes: `GET /shift-swaps` (existing, but called WITHOUT a status filter so `pending_supervisor` rows are included too — see Step 3), `POST /shift-swaps/:id/respond` and `PUT /shift-swaps/:id` (both from Task 2), `apiFetch` from `../hooks/useApi`.
- Produces: nothing consumed by a later task — this is the final task in this plan.

- [ ] **Step 1: Add modal state**

Near the existing `const [showTemplateModal, setShowTemplateModal] = useState(false);` (line 172), add:

```ts
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [swapActionPending, setSwapActionPending] = useState<number | null>(null);
```

- [ ] **Step 2: Make the "Pending Swap Requests" tile clickable**

Replace the existing swap-count tile (lines 869-876):

```tsx
          {/* Pending Swap Requests */}
          {swapRequests.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSwapModal(true)}
              className="p-2 rounded border bg-surface-sunken/20 border-border-subtle/30 text-center hover:bg-surface-raised/30 transition-colors"
            >
              <ArrowRightLeft className="w-3 h-3 text-rmpg-400 mx-auto mb-0.5" />
              <div className="text-sm font-bold font-mono text-rmpg-400">{swapRequests.length}</div>
              <div className="text-[8px] text-rmpg-400">Swap Requests</div>
            </button>
          )}
```

- [ ] **Step 3: Broaden the swap-fetch effect to include `pending_supervisor`**

Replace the existing swap-fetch line (inside the `useEffect` around line 237, currently `apiFetch('/shift-swaps?status=pending')`) with a fetch that pulls both statuses relevant to "needs someone's action" and stores them separately from a full-list fetch used only when the modal opens. Add a new function and state, and change the effect:

```ts
  const [allSwaps, setAllSwaps] = useState<any[]>([]);
  const [swapModalLoading, setSwapModalLoading] = useState(false);

  const loadSwapModalData = () => {
    setSwapModalLoading(true);
    apiFetch('/shift-swaps')
      .then((r: any) => setAllSwaps(Array.isArray(r) ? r : []))
      .catch((err: any) => addToast(err?.message || 'Failed to load shift swaps', 'error'))
      .finally(() => setSwapModalLoading(false));
  };

  useEffect(() => {
    if (showSwapModal) loadSwapModalData();
  }, [showSwapModal]);
```

Leave the existing pending-count effect (`apiFetch('/shift-swaps?status=pending')` feeding `swapRequests`) as-is — that badge only needs the count of `'pending'` rows, which is unchanged in meaning (a `pending_supervisor` row is not "pending" from the requester's create-time point of view). Add these two new pieces of state/logic near the existing `swapRequests` state declaration, not replacing it.

- [ ] **Step 4: Add the swap actions**

Add these two handlers near the existing `handleSave`/`handleDuplicate` functions:

```ts
  const handleSwapRespond = async (swapId: number, accept: boolean) => {
    setSwapActionPending(swapId);
    try {
      await apiFetch(`/shift-swaps/${swapId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ accept }),
      });
      addToast(accept ? 'Swap accepted' : 'Swap declined', 'success');
      loadSwapModalData();
    } catch (err: any) {
      addToast(err?.message || 'Failed to respond to swap', 'error');
    } finally {
      setSwapActionPending(null);
    }
  };

  const handleSwapReview = async (swapId: number, status: 'approved' | 'denied') => {
    setSwapActionPending(swapId);
    try {
      await apiFetch(`/shift-swaps/${swapId}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      addToast(status === 'approved' ? 'Swap approved' : 'Swap denied', 'success');
      loadSwapModalData();
    } catch (err: any) {
      addToast(err?.message || 'Failed to review swap', 'error');
    } finally {
      setSwapActionPending(null);
    }
  };
```

- [ ] **Step 5: Add the modal JSX**

Add this new modal block immediately after the existing `{/* ── Template Modal ── */}` block closes (after the `) : null}` that closes the `showTemplateModal` block), following that block's exact structure (backdrop, `role="dialog"`, `aria-modal`, click-outside-to-close, `onClick={(e) => e.stopPropagation()}` on the inner panel):

```tsx
      {/* ── Swap Requests Modal ── */}
      {showSwapModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="swap-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowSwapModal(false)}
        >
          <div
            className="bg-surface-raised border border-rmpg-700 rounded-sm w-[560px] max-w-full mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700">
              <h2 id="swap-title" className="text-sm font-semibold text-rmpg-100 flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-brand-400" />
                Shift Swap Requests
              </h2>
              <button type="button" onClick={() => setShowSwapModal(false)} className="text-rmpg-400 hover:text-rmpg-100 p-1" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2">
              {swapModalLoading ? (
                <div className="text-xs text-rmpg-400 py-4 text-center">Loading…</div>
              ) : allSwaps.filter((s: any) => ['pending', 'pending_supervisor'].includes(s.status)).length === 0 ? (
                <div className="text-xs text-rmpg-500 py-4 text-center">No open swap requests.</div>
              ) : (
                allSwaps
                  .filter((s: any) => ['pending', 'pending_supervisor'].includes(s.status))
                  .map((s: any) => {
                    const isTarget = s.target_id === user?.id && s.status === 'pending';
                    const isApprover = canManage && (s.status === 'pending_supervisor' || (s.status === 'pending' && !s.target_id));
                    const busy = swapActionPending === s.id;
                    return (
                      <div key={s.id} className="p-2.5 bg-surface-base border border-rmpg-700 rounded-sm">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-[11px] font-semibold text-rmpg-100">
                              {s.requester_name ?? `Officer #${s.requester_id}`} — {s.shift_date}
                            </div>
                            <div className="text-[9px] text-rmpg-400 mt-0.5">
                              {s.target_name ? `to ${s.target_name}` : 'Open swap'} · {formatEnumValue(s.status)}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {isTarget && (
                              <>
                                <button type="button" disabled={busy} onClick={() => handleSwapRespond(s.id, true)}
                                  className="px-2 py-1 text-[9px] bg-green-900/50 text-green-400 border border-green-700/50 rounded-sm hover:bg-green-800/50 disabled:opacity-40">
                                  Accept
                                </button>
                                <button type="button" disabled={busy} onClick={() => handleSwapRespond(s.id, false)}
                                  className="px-2 py-1 text-[9px] text-rmpg-500 border border-rmpg-600 rounded-sm hover:text-red-400 hover:border-red-600 disabled:opacity-40">
                                  Decline
                                </button>
                              </>
                            )}
                            {isApprover && (
                              <>
                                <button type="button" disabled={busy} onClick={() => handleSwapReview(s.id, 'approved')}
                                  className="px-2 py-1 text-[9px] bg-green-900/50 text-green-400 border border-green-700/50 rounded-sm hover:bg-green-800/50 disabled:opacity-40">
                                  Approve
                                </button>
                                <button type="button" disabled={busy} onClick={() => handleSwapReview(s.id, 'denied')}
                                  className="px-2 py-1 text-[9px] text-rmpg-500 border border-rmpg-600 rounded-sm hover:text-red-400 hover:border-red-600 disabled:opacity-40">
                                  Deny
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      ) : null}
```

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Manual verification in the browser**

Start the dev server (`npm run dev` at repo root for the Worker, `cd client && npm run dev` for the SPA), log in as a test officer, create a targeted swap request, log in as the target officer, open Shift Plans, click the "Swap Requests" tile, Accept the swap, confirm it disappears from that view; log in as admin, open the same modal, confirm the swap now shows Approve/Deny, approve it, confirm the notification bell shows the approval to the original requester.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/ShiftPlansPage.tsx
git commit -m "feat(shift-plans): add swap-requests panel for accept/reject/approve/deny"
```

---

### Task 5: Apply migration to live D1 and verify end-to-end

**Files:** None (operational task).

**Interfaces:**
- Consumes: `migrations/0229_shift_swap_approval_workflow.sql` from Task 1.

- [ ] **Step 1: Apply and track the migration on live D1**

Run: `scripts/apply-migration.sh 0229_shift_swap_approval_workflow.sql`

- [ ] **Step 2: Verify the schema and seeded rules on live**

Run:
```bash
npx wrangler d1 execute rmpg-flex --remote --command "SELECT sql FROM sqlite_master WHERE name='shift_swap_requests'"
npx wrangler d1 execute rmpg-flex --remote --command "SELECT trigger_event, is_active FROM notification_rules WHERE trigger_event IN ('shift_swap_target_accepted','shift_swap_escalated')"
```
Expected: status CHECK includes `pending_supervisor`; both rules present and active.

- [ ] **Step 3: Manual end-to-end check**

As documented in the spec: create a targeted swap as one test user, accept as the target, approve as admin, confirm the activity_log has all three rows (`swap_requested`, `swap_target_accepted`, `swap_approved`) and the bell notified the right people at each step.

---

## Self-Review Notes

- **Spec coverage:** Status machine + schema (Task 1), target-response route + PUT gate + audit trail (Task 2), escalation sweep (Task 3), UI panel (Task 4), live verification (Task 5) — all spec sections have a task.
- **Deviation from spec, noted and justified:** the spec's Schema Changes section speculated about an idempotency guard for the table-rebuild migration ("guarded... following the same... rule CLAUDE.md documents"). Checking the actual precedent (`migrations/0040_calls_status_add_on_hold.sql`) during plan-writing found that real prior art for this exact migration shape does NOT add such a guard — it relies on D1's migration-tracking table instead. Task 1 follows the real precedent rather than the spec's speculation, and says so in the migration's own comment.
- **Placeholder scan:** no TBD/TODO; every step has complete code or an exact command with an expected outcome.
- **Type consistency:** `sweepShiftSwapEscalations(db, env?)` matches its `src/index.ts` call site and its test. `POST /shift-swaps/:id/respond`'s request/response shape matches what Task 4's client code sends/expects (`{ accept: boolean }` in, `{ success: true }` out, non-2xx surfaces via `apiFetch`'s existing error-throwing contract). `writeSwapActivityLog`'s signature is used identically in both its Task 2 call sites.
