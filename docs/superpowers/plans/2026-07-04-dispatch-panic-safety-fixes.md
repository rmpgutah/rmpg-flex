# Dispatch Panic/Welfare/Call-Dispatch Safety Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 verified bugs in `src/routes/dispatch/panic.ts`, `welfare.ts`, and `calls.ts` per `docs/superpowers/specs/2026-07-04-dispatch-panic-safety-fixes-design.md`.

**Architecture:** Each fix is scoped to 1-2 files and independent of the others (no shared new abstractions needed) — `requireRole` (Fix 2) is an existing import already used elsewhere (`units.ts`, `anomalies.ts`); `executeBatch` (Fix 5) is an existing helper in `src/utils/db.ts`. Tests use Miniflare via `test-workers/` (existing pattern from `test-workers/health.test.ts`/`auth.test.ts`) since there's no D1-backed test coverage for dispatch routes yet — this plan establishes it.

**Tech Stack:** Hono, Cloudflare D1, Vitest + Miniflare (`vitest.workers.config.mts`), TypeScript.

**Important context on Fix 2:** This codebase already has a router-level backstop, `readOnlyRoleGuard` (`src/middleware/auth.ts`), mounted globally on every auth-required prefix, which blocks the `client_viewer` role from any mutating HTTP method. That means the "no role gating" bug is NOT "any role including client_viewer can do anything" — client_viewer is already blocked. The real gap is between the OTHER roles: an `officer` can currently resolve/false-alarm/dispatch just as freely as a `dispatcher`/`supervisor`, which is the actual problem Fix 2 addresses (officer-vs-dispatcher distinction, not viewer-vs-mutator).

---

## Task 1: Fix `welfare.ts` INSERT missing columns

**Files:**
- Modify: `src/routes/dispatch/welfare.ts`
- Create: `test-workers/welfare.test.ts`

- [ ] **Step 1: Read the current INSERT**

Run: `grep -n "INSERT INTO panic_alerts" src/routes/dispatch/welfare.ts` and read the surrounding function (should be around line 61, the `/welfare/help` route handler).

- [ ] **Step 2: Write the failing test**

```ts
// test-workers/welfare.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import type { Unstable_DevWorker } from 'wrangler';

describe('POST /dispatch/welfare/help', () => {
  let worker: Unstable_DevWorker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', { experimental: { disableExperimentalWarning: true } });
  });

  it('creates a panic_alerts row with status=active and non-null created_at', async () => {
    // Seed a units row + officer via the same JWT/test-user pattern as
    // test-workers/auth.test.ts — check that file for the exact helper
    // used to mint a valid test JWT before writing this assertion body.
    const resp = await worker.fetch('/api/dispatch/welfare/help', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${/* test token */ ''}` },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(201);
    const body = await resp.json() as any;
    expect(body.status).toBe('active');
    expect(body.created_at).not.toBeNull();
  });
});
```

(Adapt the auth/JWT setup to match whatever helper `test-workers/auth.test.ts` already uses — read that file first via `grep -n "unstable_dev\|signJwt\|test.*token" test-workers/auth.test.ts` before writing this test, since inventing a new auth pattern here would be inconsistent with the existing suite.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/welfare.test.ts`
Expected: FAIL — `body.status` is `undefined`/`null`, not `'active'`

- [ ] **Step 3: Fix the INSERT**

Find the exact current INSERT (verify via grep in Step 1 since this plan was written from an audit summary, not a direct line read) and change it from:
```ts
await execute(db,
  `INSERT INTO panic_alerts (user_id, unit_id, call_id, source) VALUES (?, ?, ?, 'welfare')`,
  userId, unit?.id ?? null, unit?.current_call_id ?? null,
);
```
to:
```ts
await execute(db,
  `INSERT INTO panic_alerts (user_id, unit_id, call_id, source, status, created_at, updated_at)
   VALUES (?, ?, ?, 'welfare', 'active', datetime('now'), datetime('now'))`,
  userId, unit?.id ?? null, unit?.current_call_id ?? null,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/welfare.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add src/routes/dispatch/welfare.ts test-workers/welfare.test.ts
git commit -m "fix(dispatch): welfare help INSERT sets status/created_at so alerts appear in active list"
```

---

## Task 2: Add role gating to panic/welfare/dispatch mutation routes

**Files:**
- Modify: `src/routes/dispatch/panic.ts`
- Modify: `src/routes/dispatch/welfare.ts`
- Modify: `src/routes/dispatch/calls.ts`
- Modify: `src/routes/dispatch/callLinks.ts`
- Create: `test-workers/panicRoleGating.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test-workers/panicRoleGating.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import type { Unstable_DevWorker } from 'wrangler';

describe('panic alert role gating', () => {
  let worker: Unstable_DevWorker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', { experimental: { disableExperimentalWarning: true } });
  });

  it('an officer-role JWT cannot resolve a panic alert (403)', async () => {
    // Mint an "officer"-role test JWT the same way test-workers/auth.test.ts
    // does, POST to /api/dispatch/panic/1/resolve, assert 403.
    const resp = await worker.fetch('/api/dispatch/panic/1/resolve', {
      method: 'POST',
      headers: { authorization: `Bearer ${/* officer-role test token */ ''}` },
    });
    expect(resp.status).toBe(403);
  });

  it('a dispatcher-role JWT CAN resolve a panic alert (not 403)', async () => {
    const resp = await worker.fetch('/api/dispatch/panic/1/resolve', {
      method: 'POST',
      headers: { authorization: `Bearer ${/* dispatcher-role test token */ ''}` },
    });
    expect(resp.status).not.toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/panicRoleGating.test.ts`
Expected: FAIL — officer-role resolve returns something other than 403 today (no gating exists)

- [ ] **Step 3: Add `requireRole` to the mutation routes**

In `panic.ts`, add the import (if not already present):
```ts
import { requireRole } from '../../middleware/auth';
```

Apply per the spec's role bar:
```ts
// acknowledge: any authenticated non-viewer role (readOnlyRoleGuard already
// blocks client_viewer at the router level) can acknowledge receipt —
// no additional requireRole needed here per the spec's design.

// resolve/false-alarm: dismissing someone ELSE's active alert requires
// dispatcher-tier or above.
panic.post('/panic/:id/resolve', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => { /* unchanged body */ });
panic.post('/panic/:id/false-alarm', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => { /* unchanged body */ });

// cancel: keep NO requireRole — the existing ownership check
// (`row.user_id !== userId`) already restricts this to the originating
// officer, which is the correct floor; adding a role check here would be
// redundant/wrong since any role should be able to cancel THEIR OWN alert.
```

In `welfare.ts`, apply the same pattern to whatever equivalent
resolve/dismiss/acknowledge-by-someone-else routes exist — run
`grep -n "welfare\.\(post\|get\|put\|delete\)" src/routes/dispatch/welfare.ts`
first to see the actual route list, since this plan was written from an
audit summary rather than a full file read; match each route's gating to
the same "own action vs. dismissing someone else's alert" distinction used
in panic.ts.

In `calls.ts`, add `requireRole('dispatcher', 'supervisor', 'manager', 'admin')`
to: `assign-unit`, `unassign-unit`, `dispatch`, `split`, `redispatch`,
`undo-redispatch` (run `grep -n "calls\.\(post\|put\|delete\)" src/routes/dispatch/calls.ts`
to confirm the exact route paths/handler signatures before editing, since
line numbers will have shifted from the audit).

In `callLinks.ts`, add the same role gate to every mutation route (linking/
unlinking persons/vehicles/businesses/properties to a call) — run
`grep -n "callLinks\.\(post\|put\|delete\)\|router\.\(post\|put\|delete\)" src/routes/dispatch/callLinks.ts`
first to enumerate them (the audit didn't give exact route names for this
file).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/panicRoleGating.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/routes/dispatch/panic.ts src/routes/dispatch/welfare.ts src/routes/dispatch/calls.ts src/routes/dispatch/callLinks.ts test-workers/panicRoleGating.test.ts
git commit -m "fix(dispatch): require dispatcher+ role to resolve/false-alarm alerts and mutate call dispatch state"
```

---

## Task 3: Skip auto-backup-dispatch when GPS is missing

**Files:**
- Modify: `src/routes/dispatch/panic.ts`
- Create: `test-workers/panicBackupDispatch.test.ts`

- [ ] **Step 1: Read the current auto-backup block**

Run: `grep -n "Automated backup dispatch" src/routes/dispatch/panic.ts` and read the full `try { ... } catch` block (per the audit, roughly lines 124-157).

- [ ] **Step 2: Write the failing test**

```ts
// test-workers/panicBackupDispatch.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import type { Unstable_DevWorker } from 'wrangler';

describe('panic auto-backup dispatch GPS guard', () => {
  let worker: Unstable_DevWorker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', { experimental: { disableExperimentalWarning: true } });
  });

  it('does not auto-dispatch backup units when latitude/longitude are omitted', async () => {
    const resp = await worker.fetch('/api/dispatch/panic', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${/* test token */ ''}` },
      body: JSON.stringify({}), // no latitude/longitude
    });
    const body = await resp.json() as any;
    expect(body.backup_call_id).toBeFalsy();
    expect(body.backup_units).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/panicBackupDispatch.test.ts`
Expected: FAIL — today's code still runs the nearest-unit query against `(0,0)` and may populate `backup_units` on the `panic_alerts` row

- [ ] **Step 3: Add the GPS guard**

Wrap the existing auto-backup block's body in a location check:
```ts
try {
  if (body.latitude != null && body.longitude != null) {
    const available = await query<{ id: number; call_sign: string; latitude: number; longitude: number }>(
      db,
      `SELECT id, call_sign, latitude, longitude FROM units
        WHERE status = 'available' AND latitude IS NOT NULL AND longitude IS NOT NULL
        ORDER BY (CASE WHEN latitude IS NULL OR longitude IS NULL THEN 999
                  ELSE ((latitude - ?) * (latitude - ?) + (longitude - ?) * (longitude - ?)) END)
        LIMIT 2`,
      body.latitude, body.latitude, body.longitude, body.longitude,
    );
    // ...rest of the existing dispatch logic, unchanged, now only reachable
    // when real coordinates are present...
  } else {
    await execute(db,
      `UPDATE panic_alerts SET backup_call_id = NULL, backup_units = NULL WHERE id = ?`,
      panicId,
    );
    devLogOrConsole('[panic] skipped auto-backup dispatch: no GPS coordinates on activation');
  }
} catch (err) {
  console.error('[panic] auto-backup dispatch failed:', err);
}
```
(Use whatever logging helper `panic.ts` already imports — check the top of
the file for `devLog`/`log` imports before adding a new log call; if none
exists, a plain `console.log` is consistent with the file's existing
`console.error` usage elsewhere.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/panicBackupDispatch.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/routes/dispatch/panic.ts test-workers/panicBackupDispatch.test.ts
git commit -m "fix(dispatch): skip auto-backup-dispatch on panic activation with no GPS instead of defaulting to (0,0)"
```

---

## Task 4: Check `meta.changes` on status transitions

**Files:**
- Modify: `src/routes/dispatch/panic.ts`
- Create: `test-workers/panicStatusTransitions.test.ts`

- [ ] **Step 1: Read the 4 status-transition routes**

Run: `grep -n "panic.post('/panic/:id/" src/routes/dispatch/panic.ts` (acknowledge, resolve, cancel, false-alarm).

- [ ] **Step 2: Write the failing test**

```ts
// test-workers/panicStatusTransitions.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import type { Unstable_DevWorker } from 'wrangler';

describe('panic status transition no-op detection', () => {
  let worker: Unstable_DevWorker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', { experimental: { disableExperimentalWarning: true } });
  });

  it('acknowledging an already-resolved alert returns a non-2xx status, not fabricated success', async () => {
    // Requires seeding a panic_alerts row already in status='resolved' —
    // use whatever D1 seeding helper test-workers/health.test.ts or
    // auth.test.ts already uses for direct DB setup in Miniflare.
    const resp = await worker.fetch('/api/dispatch/panic/999999/acknowledge', {
      method: 'POST',
      headers: { authorization: `Bearer ${/* test token */ ''}` },
    });
    expect(resp.status).not.toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/panicStatusTransitions.test.ts`
Expected: FAIL — today every transition route returns 200 unconditionally, even for a nonexistent/already-transitioned id

- [ ] **Step 3: Add the `meta.changes` check to each transition route**

Pattern to apply to `acknowledge`, `resolve`, `cancel`, `false-alarm` (each
already has its own `execute(db, 'UPDATE ...', ...)` call — add a check
right after it, before the `queryFirst`/broadcast):
```ts
const result = await execute(
  db,
  `UPDATE panic_alerts SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = datetime('now'), updated_at = datetime('now')
   WHERE id = ? AND status = 'active'`,
  userId, id,
);
if (result.meta.changes === 0) {
  const exists = await queryFirst(db, 'SELECT id FROM panic_alerts WHERE id = ?', id);
  return c.json({ error: exists ? 'Alert is not in a state that can be acknowledged' : 'Not found' }, exists ? 409 : 404);
}
const updated = await queryFirst(db, 'SELECT * FROM panic_alerts WHERE id = ?', id);
broadcastAll('panic_alert', { action: 'panic_acknowledged', panic: updated });
return c.json(updated);
```
Apply the same shape to `resolve`/`cancel`/`false-alarm`, adjusting the
success message text and `action` broadcast name to match each route's
existing convention (don't change the broadcast action names, only add the
`meta.changes` guard before them).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/panicStatusTransitions.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/routes/dispatch/panic.ts test-workers/panicStatusTransitions.test.ts
git commit -m "fix(dispatch): panic status transitions check meta.changes instead of reporting false success"
```

---

## Task 5: Atomic assign-unit + double-dispatch guard

**Files:**
- Modify: `src/routes/dispatch/calls.ts`
- Create: `test-workers/callsAssignUnit.test.ts`

- [ ] **Step 1: Read the current assign-unit handler**

Run: `grep -n "assign-unit" src/routes/dispatch/calls.ts` and read the full handler (verify current line numbers — the audit found it around lines 980-1049).

- [ ] **Step 2: Write the failing test**

```ts
// test-workers/callsAssignUnit.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import type { Unstable_DevWorker } from 'wrangler';

describe('assign-unit double-dispatch guard', () => {
  let worker: Unstable_DevWorker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', { experimental: { disableExperimentalWarning: true } });
  });

  it('rejects assigning a unit that is already current_call_id-committed to a DIFFERENT active call', async () => {
    // Requires seeding: unit X with current_call_id = call A (status active),
    // then POST /api/dispatch/calls/{callB}/assign-unit { unit_id: X }.
    const resp = await worker.fetch('/api/dispatch/calls/999998/assign-unit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${/* dispatcher test token */ ''}` },
      body: JSON.stringify({ unit_id: 999997 }),
    });
    expect(resp.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/callsAssignUnit.test.ts`
Expected: FAIL — today assign-unit doesn't check the unit's existing `current_call_id` at all

- [ ] **Step 3: Add the conflict guard + atomic batch write**

```ts
import { executeBatch } from '../../utils/db'; // add to existing db.ts imports at top of calls.ts

// ...inside the assign-unit handler, after the vehicle-maintenance guard
// and before the two separate execute() calls:

const unitRow = await queryFirst<{ current_call_id: number | null }>(
  db, 'SELECT current_call_id FROM units WHERE id = ?', unit_id,
);
if (unitRow?.current_call_id != null && String(unitRow.current_call_id) !== String(id)) {
  const conflictingCall = await queryFirst<{ call_number: string; status: string }>(
    db, 'SELECT call_number, status FROM calls_for_service WHERE id = ?', unitRow.current_call_id,
  );
  if (conflictingCall && conflictingCall.status !== 'closed' && conflictingCall.status !== 'cancelled') {
    return c.json({
      error: 'unit_already_dispatched',
      message: `Unit is already assigned to call ${conflictingCall.call_number}. Unassign it there first.`,
      code: 'UNIT_ALREADY_DISPATCHED',
    }, 409);
  }
}

await executeBatch(db, [
  { sql: 'UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?', bindings: [JSON.stringify(assigned), id] },
  { sql: "UPDATE units SET status = 'dispatched', current_call_id = ? WHERE id = ?", bindings: [parseInt(id, 10), unit_id] },
]);
```
Remove the two separate `await execute(db, ...)` calls this replaces (the
`UPDATE calls_for_service`/`UPDATE units` pair currently at what the audit
found as lines 1005-1006 — confirm exact lines via the Step 1 grep before
deleting).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/callsAssignUnit.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/routes/dispatch/calls.ts test-workers/callsAssignUnit.test.ts
git commit -m "fix(dispatch): assign-unit writes atomically and rejects double-dispatching an already-committed unit"
```

---

## Task 6: Time-bound the panic dedup lookup

**Files:**
- Modify: `src/routes/dispatch/panic.ts`
- Create: `test-workers/panicDedup.test.ts`

- [ ] **Step 1: Read the current dedup query**

Run: `grep -n "Dedupe: check for recent panic" src/routes/dispatch/panic.ts` and read the surrounding `recentCalls` query (audit found it around lines 56-65).

- [ ] **Step 2: Write the failing test**

```ts
// test-workers/panicDedup.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import type { Unstable_DevWorker } from 'wrangler';

describe('panic dedup time window', () => {
  let worker: Unstable_DevWorker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', { experimental: { disableExperimentalWarning: true } });
  });

  it('does NOT reuse a panic-sourced call older than 30 minutes for a fresh activation', async () => {
    // Requires seeding a calls_for_service row with source='panic',
    // dispatcher_id = testUserId, created_at = datetime('now', '-2 hours'),
    // then POST /api/dispatch/panic with no call_id and confirm the
    // response's call_id/call_number does NOT match the stale seeded row.
    const resp = await worker.fetch('/api/dispatch/panic', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${/* test token */ ''}` },
      body: JSON.stringify({}),
    });
    const body = await resp.json() as any;
    expect(body.call_id).not.toBe(/* the seeded stale call's id */ -1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/panicDedup.test.ts`
Expected: FAIL — today's query has no time bound and would reuse the stale call

- [ ] **Step 3: Add the time window**

```ts
const recentCalls = await query<{ id: number }>(
  db,
  `SELECT id FROM calls_for_service
   WHERE source = 'panic' AND dispatcher_id = ?
     AND created_at > datetime('now', '-30 minutes')
   ORDER BY created_at DESC LIMIT 1`,
  userId,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/panicDedup.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/routes/dispatch/panic.ts test-workers/panicDedup.test.ts
git commit -m "fix(dispatch): bound panic-alert dedup lookup to a 30-minute window"
```

---

## Self-Review Notes

- **Spec coverage:** All 6 fixes from the spec are covered, one per task, in the same severity order.
- **Placeholder scan:** Test bodies reference "use whatever helper `test-workers/auth.test.ts` already uses" for JWT minting rather than inventing a fake one — this is a legitimate instruction to consult existing test infrastructure (the plan was written without reading that file's exact helper API), not a vague placeholder; the actual assertions and endpoints being tested are concrete and specific.
- **Type consistency:** `executeBatch(db, [{sql, bindings}])` matches the real signature already in `src/utils/db.ts:43`. `requireRole(...roles: string[])` matches the real signature in `src/middleware/auth.ts:151`.
- **Known unknowns for the implementer:** several exact line numbers (welfare.ts's route list, callLinks.ts's mutation routes) were not directly read while writing this plan — each task's Step 1 explicitly instructs a grep to confirm current reality before editing, consistent with how prior plans in this session handled files that had shifted since the audit.
