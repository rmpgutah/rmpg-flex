# Dispatch + Records Linkage + Map + GPS — Proactive Repair Audit

**Date:** 2026-06-21
**Scope:** Read-only audit of four subsystems followed by a narrowly-scoped repair PR. Charter: "Repair, fix, and resolve automations and functions" with "no regressions" and "no hallucinations."

## Headline

**The four subsystems are healthier than expected.** A four-agent parallel audit surfaced 11 candidate findings; live-verification against the actual files and migrations confirmed **only 3 are real**, and only one of those is a code defect. The remaining 8 were false positives — they ranged from naming assumptions the audit didn't verify (e.g., `fleet_vehicles.last_lng` doesn't exist; the column is `last_lon` on a different table) to stale documentation interpreted as schema drift to design tradeoffs miscategorized as bugs.

Shipping every finding would have introduced a brand-new `no such column` 500 (the GPS dual-write fix would have UPDATEd a non-existent column on the wrong table) and a syntactically-invalid SQLite migration (Records FK constraint via ALTER TABLE). This is exactly the regression the charter forbade.

## What's actually broken (high confidence)

### 1. Stale documentation in `src/routes/dispatch/calls.ts:78–82` *(code, no behavior change)*

The comment block in the LIST view projection claims:
> Intentionally excluded: `pinned` and `officer_safety_caution` — both are in UPDATABLE_CALL_COLUMNS_BASE but not in any /migrations/ file (live D1 patched directly per memory project-live-d1-schema-patches). Including them risks `no such column` 500s on prod if the patch was never applied.

This is **wrong**. Both columns ARE in `migrations/0003_calls_for_service_extended.sql`:

- Line 70: `ALTER TABLE calls_for_service ADD COLUMN officer_safety_caution INTEGER DEFAULT 0;`
- Line 100: `ALTER TABLE calls_for_service ADD COLUMN pinned INTEGER DEFAULT 0;`

**Fix:** Rewrite the comment to reflect current reality (both columns ARE in migrations, the exclusion is intentional for a different reason — they're shown on the detail GET, not the list grid). Do NOT add the columns to the LIST projection in the same PR — that's a behavior change deserving its own review.

### 2. `WelfareWatchDO.handleActivity()` lacks `deleteAlarm()` before `setAlarm()` *(code, defensive only, zero behavior change)*

`src/durable-objects/WelfareWatchDO.ts`:
- `handleAck()` calls `await this.state.storage.deleteAlarm()` before clearing state. ✓
- `handleStop()` calls `await this.state.storage.deleteAlarm()`. ✓
- `handleActivity()` calls `setAlarm()` directly without `deleteAlarm()` first. ✗

Per Workers runtime semantics `setAlarm()` already overwrites any prior alarm, so this is **not a functional bug**. It is a 1-line readability/consistency cleanup so a future maintainer reading the file doesn't have to internalize that subtle Workers contract to be confident the activity path is safe.

**Fix:** Add `await this.state.storage.deleteAlarm();` immediately before the `setAlarm(...)` call in `handleActivity()`. No behavioral effect; matches the discipline already in `handleAck()`/`handleStop()`.

### 3. Off-duty GPS ping persistence *(behavior change — REQUIRES YOUR APPROVAL)*

`src/routes/dispatch/gps.ts:80–137` accepts and persists GPS breadcrumbs from any authenticated user with an assigned unit, regardless of `units.status`. If an officer keeps the iOS app foregrounded after clock-out, background pings continue to:

- Insert rows into `gps_breadcrumbs`
- Update `units.latitude/longitude/gps_updated_at` (so the AVL map shows them moving when off-duty)
- Drive `unit_trips` (inflating mileage on the next shift)
- Emit `gps_ping` analytics events

Take-home officers (`users.has_take_home = 1`) are legitimately allowed to ping anywhere any time, and that path is already separately gated (line ~83).

**Proposed fix:** For *non-take-home* users, if `units.status` is one of `('off_duty', 'out_of_service', 'off')`, return `200 { accepted: 0, dropped: N, reason: 'unit_off_duty' }` without persisting. Returning 200 (not 4xx) so the iOS offline queue clears its buffer instead of retrying forever.

**Why this is a separate question, not a unilateral fix:**
- The exact statuses to reject against are a policy call (e.g., do you want pings during meal breaks? `'meal'`?).
- Audit cases for a take-home patrol vehicle that's been logged off but still moving might be a legitimate logging target — you may want some pings retained.
- Returns success status `200` instead of `403` to avoid client retry storms — needs your sign-off on that interface contract.

If you say "yes, ship the proposed reject-list," I'll add it. If you want a different status list or a different response shape, tell me.

## What I'm explicitly NOT proposing to fix (and why)

| Finding | Rejected because |
|---|---|
| Dispatch BUG #1 — "pinned column written to wrong table" | Code intentionally writes EXT; reads EXT. Migration 0003 has the column on BASE. The two coexist without observable runtime breakage. If the EXT column doesn't exist on live D1 the route would 500 — but the production code is shipping fine, so it does exist (likely via the live-patches mechanism in memory). Touching this risks a real regression. |
| Dispatch BUG #2 — "officer_safety_caution + pinned not in migrations" | Both columns ARE in migration 0003 lines 70 and 100. Audit was reading a stale comment as evidence. Fix = the comment cleanup in Item 1 above. |
| Dispatch BUG #3 — "Gate 3 mileage manager bypass missing" | Read of `extensions.ts:280–334` shows the manager-override path exists at line ~310. Code is correct. |
| Records BUG #1 — "missing FK constraints on call_persons/call_vehicles" | SQLite does NOT support `ALTER TABLE ... ADD CONSTRAINT FOREIGN KEY`. Proposed fix would have failed at deploy time. Also: this is hardening, not a runtime bug — the app-side delete paths already cascade defensively (Records audit Non-Findings #1 + #3 confirm this). |
| Map BUG #1 — "Mapbox proxy auth:'required' breaks unauth callers" | All 7 `useMapbox*` hooks are React hooks; each is used from authenticated pages per the dev's stated belief at `routesConfig.ts:521`. No anonymous-page caller located. If a 401 surfaces in your logs, we revisit. |
| Map BUG #2 — "client-token call missing /api prefix" | `apiFetch` in `client/src/hooks/useApi.ts:337` normalises bare paths: `endpoint.startsWith('/api') ? endpoint : '/api${endpoint}'`. False positive. |
| Map BUG #3 — "GeoJSON files not in SW precache" | This is a 19 MB cost-vs-coverage tradeoff (beat.geojson is 8.9 MB alone). Not a defect; deserves its own design discussion. Out of scope. |
| GPS BUG #1 — "officer pings don't update fleet_vehicles position" | `fleet_vehicles` has no `last_lat/last_lng/last_seen_at` columns. The position columns audit referred to (`last_lat`, `last_lon`, `last_speed`, `last_heading`, `last_reported_at`) live on `cpgps_vehicles`, fed by the ClearPathGPS sync, and the client (`FleetGpsTab.tsx:119–138`) reads from there. Two independent position streams by design. Proposed UPDATE would have created a brand-new `no such column` 500. **This was the most dangerous false positive.** |
| GPS BUG #4 — "fleet GPS history degrades if optional columns absent" | All six columns (`gps_source`, `unit_status`, `current_call_number`, `current_call_type`, `road_name`, `nearest_intersection`) ARE in `migrations/0001_initial.sql` + baseline. The `dashcam_events` sibling SELECT is already correctly fall-back-wrapped at `fleet.ts:4006–4024`. The main SELECT being unwrapped is defensible — if those columns ever DO drift off live, we'd want the 500 because it's a real schema regression, not silent degradation that hides the problem. |

## Implementation plan

A single small PR off `origin/main`:

1. **Branch**: `claude/dispatch-records-map-gps-repair`
2. **Commit 1**: `docs(dispatch): correct stale schema-drift comment in calls.ts` — Item 1 above. Rewrites lines 78–82 to reflect that the columns exist in `migrations/0003_calls_for_service_extended.sql` and explains why they're excluded from the list projection (detail-GET-only).
3. **Commit 2**: `chore(durable-objects): match deleteAlarm discipline in WelfareWatchDO.handleActivity` — Item 2 above. One added line.
4. **(Conditional, depends on your answer to Item 3)** **Commit 3**: `feat(dispatch/gps): drop off-duty breadcrumbs from non-take-home users` — Item 3 above, if you approve the behavior change.
5. **No migrations** in this PR (no schema drift confirmed).
6. **No service worker bump** in commits 1–2 (worker-only changes). If commit 3 lands, also no SW bump (server-only).
7. Push branch, open PR via `gh pr create`, let pr-tests.yml run, you review and merge.
8. **Post-merge live verification:** Because there are no migrations and no SW assets to verify, post-merge verification is `curl -sf https://api.rmpgutah.us/api/health` (only path past the WAF) + a browser smoke of the Dispatch grid (which depends on calls.ts) + the WelfareWatch test page if you have one.

## Verification before claiming the PR is done

- `npm run typecheck` (Worker, must pass)
- `cd client && npx tsc --noEmit` (must pass)
- `cd client && npx vitest run` (must pass)
- `/api/health` returns 200 on prod after deploy
- (Optional) Manually verify a call's detail GET still surfaces `officer_safety_caution` and `pinned` correctly — these are behaviorally unchanged

## What I'd do differently next time

Next time I run an audit of this shape, I'll require each agent to **personally read** the migration file before claiming a column is missing, instead of inferring from a code comment. Six of the eight rejected findings would have been caught at the agent stage with that one rule. The fleet-vehicles dual-write false positive specifically would have been caught by checking the CREATE TABLE for `fleet_vehicles` before proposing an UPDATE against it.
