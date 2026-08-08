# Shift Plans — Swap Approval Workflow (Sub-project 2 of 4)

**Status:** Approved for implementation
**Date:** 2026-08-08
**Author:** Claude (session with Christopher Zamora)

## Context

This is sub-project 2 of a 4-part program on Shift Plans (order: comms
integration → **approval workflow** → auto-scheduling → calendar sync).
Sub-project 1 (merged, [PR #3318](https://github.com/rmpgutah/rmpg-flex/pull/3318))
wired shift-swap requests into the in-app notification engine.

Today a swap request (`shift_swap_requests`, migration `0031`) goes straight to
a single approval step: any `admin`/`manager`/`supervisor` can approve or deny
it via `PUT /shift-swaps/:id`, regardless of whether the requester named a
specific `target_id` ("swap with officer X") or left it open. This has two
gaps:

1. **No target-officer consent.** If Officer A asks to swap with Officer B by
   name, B is never asked — a supervisor can approve the swap without B ever
   agreeing to work A's shift.
2. **No visibility into stalled requests.** A pending swap can sit forever
   with no reminder to anyone, and there's no record of who acted on it or
   when beyond the single `reviewed_by`/`reviewed_at`/`review_notes` columns.

**Explicitly out of scope:** HR's existing time-off system (`leave_requests`
table, `src/routes/hr.ts`) is untouched. It already has its own independent
approval lifecycle (pending/approved/denied, manager approve/deny) and this
spec does not duplicate or integrate with it — that was a decision this
session made explicitly to avoid building a redundant second time-off system.

**Also found and included:** there is currently **no client UI at all** for
approving or denying a swap — `PUT /shift-swaps/:id` has zero callers anywhere
in `client/src`. Only creating a swap (`POST`) and seeing a pending count
badge exist today. Building the approval-step machinery without a UI to drive
it would be unusable except via raw API calls, so a swap-requests panel is
included in this spec.

## Goal

Add a target-officer acceptance step before supervisor approval (when a
target is named), a 24-hour escalation reminder for stalled requests, a full
audit trail of every status transition, and the client UI needed to actually
use all of it.

## Status machine

```
                    target_id set?
                   /              \
                 yes                no
                  |                  |
              'pending'          'pending'
           (awaiting target)  (awaiting supervisor)
                  |                  |
        target responds        supervisor
         /            \         approves/denies
    accept          reject           |
       |               |             v
'pending_supervisor' 'denied'   'approved'/'denied'
       |
  supervisor
  approves/denies
       |
       v
'approved'/'denied'

Any status except 'approved'/'denied' can transition to 'cancelled'
(requester cancels their own still-open request — existing behavior,
unchanged).
```

`status` CHECK constraint expands from
`('pending','approved','denied','cancelled')` to
`('pending','pending_supervisor','approved','denied','cancelled')`.

## Schema changes

SQLite cannot `ALTER TABLE ... ADD CHECK` or modify an existing CHECK
constraint — changing the allowed `status` values requires the standard
SQLite table-rebuild pattern (create new table with the updated constraint,
copy rows, drop old, rename new). Migration `0229_shift_swap_approval_workflow.sql`:

```sql
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

INSERT INTO shift_swap_requests_new
  SELECT id, requester_id, requester_name, target_id, target_name, plan_id,
         shift_date, original_shift, requested_shift, reason, status,
         reviewed_by, reviewed_by_name, reviewed_at, review_notes,
         NULL, NULL, created_at
  FROM shift_swap_requests;

DROP TABLE shift_swap_requests;
ALTER TABLE shift_swap_requests_new RENAME TO shift_swap_requests;

CREATE INDEX IF NOT EXISTS idx_shift_swaps_status ON shift_swap_requests(status);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_date ON shift_swap_requests(shift_date);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_requester ON shift_swap_requests(requester_id);
```

Guarded for idempotent re-run via a `SELECT 1 FROM pragma_table_info(...)
WHERE name = 'target_responded_at'`-style existence check wrapping the whole
block, following the same "D1 has dirty schema, migrations must survive a
second apply" rule CLAUDE.md documents — the implementer must check for an
existing idempotent-rebuild pattern elsewhere in `migrations/` (grep for
`_new` table renames) and follow it rather than inventing a new one.

New columns: `target_responded_at` (stamped when the target accepts/rejects,
`NULL` until then) and `escalated_at` (stamped the first time the 24h
escalation fires — the sweep's dedupe key, so a swap is escalated at most
once, not once per cron tick).

## Routes (`src/routes/shiftPlans.ts`)

### `POST /shift-swaps` (existing, minimal change)

No change to the insert. Both branches (target-named and open) still insert
with `status = 'pending'` — the difference is purely in what happens next,
which is entirely driven by the new routes below and the tightened `PUT`
role/status gate. Activity log write added: `action = 'swap_requested'`.

### New: `POST /shift-swaps/:id/respond`

Target officer only — `user.id === swap.target_id` (403 otherwise, including
for admins; this is a personal-response action, not an admin action). Body
`{ accept: boolean }`.

- **Accept:** `status = 'pending_supervisor'`, stamp `target_responded_at`.
  Fire `shift_swap_target_accepted` (new seeded rule, targets
  `admin/manager/supervisor` — same shape as `shift_swap_requested`) so a
  supervisor knows it's ready for final review. Activity log:
  `action = 'swap_target_accepted'`.
- **Reject:** `status = 'denied'`, stamp `target_responded_at`,
  `review_notes = '<target name> declined the swap'` (so the denial's cause
  is visible without a separate field). Fire `shift_swap_denied` with
  `dynamicUserIds = [requester_id]` (reuses the existing rule from
  sub-project 1 — a target rejection is a denial from the requester's point
  of view). Activity log: `action = 'swap_target_rejected'`.
- 404 if the swap doesn't exist; 400 if `status !== 'pending'` or
  `target_id` is `NULL` (nothing to respond to).

### `PUT /shift-swaps/:id` (existing, gate tightened)

Adds one condition to the existing role/status checks: the swap's CURRENT
`status` must be `'pending'` (only valid when `target_id IS NULL` — an open
swap with no target skips straight to supervisor, unchanged from today) or
`'pending_supervisor'` (target already accepted). Approving/denying a swap
still sitting in `'pending'` **with a target_id set** now 400s
(`"Swap is awaiting the target officer's response"`) — a supervisor cannot
short-circuit the target's consent step. Activity log added on both
approve and deny: `action = 'swap_approved'` / `'swap_denied'`.

## Escalation sweep

Extends the existing sub-project-1 daily sweep
(`src/utils/shiftPlanNotifySweep.ts`, called from the same 04:00
America/Denver cron block in `src/index.ts`) with one more check, OR a new
sibling function called from the same cron block — implementer's choice,
document which in the plan, but keep it a separate exported function
(`sweepShiftSwapEscalations`) rather than growing
`sweepShiftPlanNotifications`'s existing responsibility, since escalation
checks a different table with different logic (elapsed time, not
date-lookahead):

```sql
SELECT id, requester_id, target_id, status, created_at, target_responded_at
FROM shift_swap_requests
WHERE status IN ('pending', 'pending_supervisor')
  AND escalated_at IS NULL
  AND (
    (status = 'pending' AND created_at <= datetime('now', '-24 hours'))
    OR
    (status = 'pending_supervisor' AND target_responded_at <= datetime('now', '-24 hours'))
  )
```

For each match: fire `shift_swap_escalated` (new seeded rule, targets
`admin`/`manager`), stamp `escalated_at`, activity log
`action = 'swap_escalated'`.

## Audit trail

No new table — every transition writes one row to the existing generic
`activity_log` table (`migrations/0001_initial.sql`, columns `user_id,
action, entity_type, entity_id, details, ip_address, created_at`), following
the exact insert pattern already used elsewhere (e.g.
`src/routes/companyDocuments.ts`):

```ts
await execute(db,
  `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
   VALUES (?, ?, 'shift_swap_request', ?, ?, datetime('now'))`,
  actorUserId, action, swapId, JSON.stringify(details),
);
```

`entity_type = 'shift_swap_request'` lets a future "history for this swap"
view query `activity_log WHERE entity_type = 'shift_swap_request' AND
entity_id = ?` without any new schema.

## Default notification rules (migration)

Two new rows added to the same migration as the schema change (or a
follow-on one — implementer's call, document it), following the exact
pattern from sub-project 1's `0228`:

| trigger_event | target_roles | notification_type | is_active |
|---|---|---|---|
| `shift_swap_target_accepted` | `["admin","manager","supervisor"]` | `in_app` | 1 |
| `shift_swap_escalated` | `["admin","manager"]` | `in_app` | 1 |

(`shift_swap_denied` already exists from `0228` and is reused for target
rejections via `dynamicUserIds`, per the Routes section above.)

## Client changes (`client/src/pages/ShiftPlansPage.tsx`)

Add a swap-requests panel (button in the existing swap-count summary area
opens a modal, mirroring the existing `showTemplateModal` pattern already in
this file) listing swaps relevant to the current user:

- **As target** (`target_id === user.id`, `status === 'pending'`):
  Accept / Reject buttons → `POST /shift-swaps/:id/respond`.
- **As approver** (`canManage`, `status IN ('pending' [no target_id],
  'pending_supervisor')`): Approve / Deny buttons → existing
  `PUT /shift-swaps/:id`.
- **As requester** (`requester_id === user.id`): read-only status display
  (including `'pending_supervisor'` and `'denied'` with the rejection
  reason if the target declined), plus the existing Cancel action if still
  cancellable.

Each row shows `status` via a small badge (reuse `PlanStatusBadge`'s color
convention or a similar small component — implementer's call) and the
relevant timestamp. No new dependencies; no design-token or theme work
beyond what the file already uses (`bg-surface-*`, `text-rmpg-*` per
CLAUDE.md's Blue & Silver token rules).

## Testing

- `tests/`: unit tests for the status-machine transitions in isolation if
  the logic is extracted into a testable function, OR integration-level
  coverage via `test-workers/` if it stays inline in the route handlers
  (matches the existing sub-project-1 precedent of testing swap routes via
  Miniflare, not unit-mocking D1 for route logic).
- `test-workers/`: extend or add to
  `test-workers/shiftPlansNotifications.test.ts` (or a new
  `shiftSwapApproval.test.ts`) covering: target accepts → supervisor
  approves (full happy path), target rejects → requester notified, PUT
  blocked while still `'pending'` with a target set, escalation sweep fires
  once and sets `escalated_at` (confirm a second sweep run doesn't
  re-notify).
- Manual: after deploy, create a targeted swap as one test user, accept as
  the target, approve as admin, confirm the activity_log has all three rows
  and the bell notified the right people at each step.

## Migration numbering

Current high-water is `0228` (sub-project 1). This sub-project uses `0229`.
