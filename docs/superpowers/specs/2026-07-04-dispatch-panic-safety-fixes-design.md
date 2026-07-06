# Dispatch Panic/Welfare/Call-Dispatch Safety & Correctness Fixes

**Date:** 2026-07-04
**Status:** Approved for planning

## Context

An audit of `src/routes/dispatch/*` found 6 real, verified bugs of Critical/
Important severity in the panic-alert, welfare-check, and call-dispatch
mutation routes — the safety-critical surfaces of the RMPG Flex CAD. This
spec covers fixing all 6. (A handful of Minor findings — silent error
swallowing in a few GPS/aggregate read endpoints, inconsistent id-type
handling — are deferred as follow-up, not safety-relevant.)

## Goals

Fix, in order of severity:

1. **`welfare.ts` panic-alert INSERT missing columns** — the "Help/Code 4"
   emergency button's INSERT into `panic_alerts` omits `created_at`/`status`,
   which `panic.ts`'s equivalent INSERT sets explicitly. Add the missing
   columns so welfare-triggered alerts behave identically to panic-button
   alerts and reliably appear in the dispatcher's active-alerts view.
2. **No role gating on panic/welfare/call-dispatch mutation routes** — add
   `requireRole(...)` (the existing helper already used elsewhere in this
   codebase, e.g. `units.ts`, `anomalies.ts`) to every state-changing route
   in `panic.ts`, `welfare.ts`, and the dispatch-mutation routes in
   `calls.ts` (`assign-unit`, `unassign-unit`, `dispatch`, `split`,
   `redispatch`, `undo-redispatch`) and `callLinks.ts`. Preserve the existing
   self-cancel ownership check in `panic.ts`'s `/cancel` route (any
   authenticated officer must still be able to cancel their OWN alert) —
   role gating adds a floor, it doesn't replace the ownership check.
3. **Auto-backup dispatch on missing GPS** — when a panic activation has no
   `latitude`/`longitude`, skip the nearest-unit auto-backup-dispatch entirely
   (rather than defaulting to `(0,0)` and dispatching based on nonsense
   distances) and flag the alert so dispatchers know backup wasn't
   auto-assigned.
4. **No-op status transitions report false success** — `acknowledge`,
   `resolve`, `cancel`, `false-alarm` in `panic.ts` never check whether the
   UPDATE actually changed a row. Check `result.meta.changes` and return a
   409/404-style response when nothing changed, instead of broadcasting a
   fabricated "success."
5. **Non-atomic assign-unit writes** — wrap `calls.ts`'s assign-unit/
   unassign-unit sequence (read `assigned_unit_ids` → write call → write
   unit status) in a single `db.batch()` so concurrent assigns can't produce
   a lost update, and add a guard preventing a unit already `current_call_id`-
   committed to a different active call from being double-dispatched.
6. **Panic dedup reuses stale calls** — `panic.ts`'s recent-call lookup for
   dedup has no time bound. Add a window (e.g. `created_at > datetime('now',
   '-30 minutes')`) so a fresh panic activation doesn't attach to a call from
   days/weeks ago.

## Non-goals

- Minor findings (silent error swallowing in GPS/aggregate read endpoints,
  `parseInt`/string id inconsistency, missing `Number.isFinite` guard on a
  days-parameter) are explicitly deferred — not safety-critical, lower risk,
  can be picked up in a smaller follow-up pass.
- No schema changes beyond what's already in place — `panic_alerts` already
  has the columns `welfare.ts` needs to set (`created_at`, `status`); this is
  a query-completeness fix, not a migration.
- No changes to the WebSocket broadcast/`sendToUser` mechanism itself, only
  to what triggers it and under what conditions.
- No frontend/client changes in this spec — purely the API-side fixes. If a
  client depends on the old (buggy) no-op-returns-200 behavior, that's a
  follow-up to check separately, not blocking this fix.

## Design

### Fix 1: `welfare.ts` INSERT

Add the missing columns to match `panic.ts`'s pattern exactly:
```sql
INSERT INTO panic_alerts (user_id, unit_id, call_id, source, status, created_at, updated_at)
VALUES (?, ?, ?, 'welfare', 'active', datetime('now'), datetime('now'))
```

### Fix 2: Role gating

Import and apply the existing `requireRole` middleware (already used in
`units.ts`/`anomalies.ts` — reuse the same import path and role-list
convention, don't invent new role names). Minimum bar: any authenticated
`officer` role and above can acknowledge/view; `resolve`/`false-alarm`
(actions that dismiss someone else's active alert) require `dispatcher`,
`supervisor`, `manager`, or `admin` — an officer should not be able to mark
another officer's panic alert as a false alarm. `cancel` keeps its existing
self-ownership check (any role, but only the originating user).

### Fix 3: Backup dispatch GPS guard

```ts
if (body.latitude != null && body.longitude != null) {
  // existing nearest-unit query + auto-dispatch logic, unchanged
} else {
  // skip auto-backup-dispatch; flag on the alert row so the dispatcher UI
  // can show "backup not auto-assigned — no location" instead of silence
}
```

### Fix 4: `meta.changes` checks

After each status-transition UPDATE, check `result.meta.changes === 0` and
return an appropriate error response (404 if the row doesn't exist at all,
409 if it exists but is in the wrong state) instead of proceeding to
broadcast. Mirrors the existing `/cancel` route's `if (!row) return c.json(...)` pattern, extended to also check the UPDATE's actual effect.

### Fix 5: Atomic assign-unit

Wrap the read-modify-write sequence in `db.batch()` where the read can be
done first (outside the batch, since D1 reads aren't part of `batch()`), but
the two dependent writes (call's `assigned_unit_ids` update + unit's status
update) execute atomically together. Add a `current_call_id` conflict check
before writing: if the target unit is already committed to a different
active call, return an error rather than silently overwriting.

### Fix 6: Time-bounded dedup

Add `AND created_at > datetime('now', '-30 minutes')` to the recent-panic-call
lookup query in `panic.ts`.

## Testing

- No existing test suite covers `src/routes/dispatch/*` (per this codebase's
  documented state — only typecheck is enforced in CI for `/src/`). Add
  Miniflare-based tests for each fix, following the existing pattern in
  `test-workers/` (e.g. `test-workers/health.test.ts`, `test-workers/auth.test.ts`)
  — this is the first Miniflare coverage for the dispatch routes, so it's
  worth establishing the pattern cleanly here.
- `npm run typecheck` (Worker) must stay clean.
- Manual verification isn't practical for a live-D1-backed CAD Worker in this
  environment — rely on the new Miniflare tests as the primary verification
  mechanism, plus careful code review given the safety stakes.
