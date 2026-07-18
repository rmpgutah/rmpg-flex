# Fleet v2 Cleanup Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six small, independent, low-risk issues found in an audit of the already-built Fleet Manager v2 sections (`client/src/pages/fleet/v2/`) — no new features, no schema changes.

**Architecture:** Each task is a self-contained, independently-committable fix. Tasks 1-5 are client-only (React/TSX); Task 6 is a Worker route deletion (`src/routes/fleet.ts`). No task depends on another completing first — they can be done in any order.

**Tech Stack:** React 18 + TypeScript (client), Hono on Cloudflare Workers (`/src`), Vitest for both.

**Spec:** `docs/superpowers/specs/2026-07-13-fleet-v2-cleanup-batch-design.md`

---

### Task 1: Swap raw `apiFetch` → `apiFetchV2` in the 6 unaudited call sites

**Why:** `apiFetchV2` (`client/src/pages/fleet/v2/hooks/apiFetchV2.ts`) emits a `FLEET_V2_API_ERROR` audit row on failure, feeding the admin health tab's "API errors (24h)" metric. These 6 call sites still use the raw `apiFetch`, so their failures are invisible to that metric.

**Files:**
- Modify: `client/src/pages/fleet/v2/vehicleDetail/OverviewTab.tsx`
- Modify: `client/src/pages/fleet/v2/vehicleDetail/FuelTab.tsx`
- Modify: `client/src/pages/fleet/v2/vehicleDetail/ServiceTab.tsx`
- Modify: `client/src/pages/fleet/v2/routes/FuelEntriesRoute.tsx`
- Modify: `client/src/pages/fleet/v2/routes/ServiceRoute.tsx`
- Modify: `client/src/pages/fleet/v2/routes/WorkOrdersRoute.tsx`

- [ ] **Step 1: `OverviewTab.tsx` — swap import and primary fetch call**

In `client/src/pages/fleet/v2/vehicleDetail/OverviewTab.tsx`, change line 3 from:

```ts
import { apiFetch } from '../../../../hooks/useApi';
```

to:

```ts
import { apiFetchV2 } from '../hooks/apiFetchV2';
```

Then change line 28 from:

```ts
    apiFetch<{ conflicts: Record<string, unknown>[] }>(
```

to:

```ts
    apiFetchV2<{ conflicts: Record<string, unknown>[] }>(
```

- [ ] **Step 2: `FuelTab.tsx` — remove the now-unused `apiFetch` import, use `apiFetchV2` for the conflicts fetch**

In `client/src/pages/fleet/v2/vehicleDetail/FuelTab.tsx`, delete line 3:

```ts
import { apiFetch } from '../../../../hooks/useApi';
```

(line 2 already imports `apiFetchV2` from `'../hooks/apiFetchV2'` — keep it.)

Then change line 26 from:

```ts
    apiFetch<{ conflicts: Record<string, unknown>[] }>(
```

to:

```ts
    apiFetchV2<{ conflicts: Record<string, unknown>[] }>(
```

- [ ] **Step 3: `ServiceTab.tsx` — same swap**

In `client/src/pages/fleet/v2/vehicleDetail/ServiceTab.tsx`, delete line 3:

```ts
import { apiFetch } from '../../../../hooks/useApi';
```

Then change line 24 from:

```ts
    apiFetch<{ conflicts: Record<string, unknown>[] }>(
```

to:

```ts
    apiFetchV2<{ conflicts: Record<string, unknown>[] }>(
```

- [ ] **Step 4: `FuelEntriesRoute.tsx` — add `apiFetchV2` import, swap the conflicts fetch**

In `client/src/pages/fleet/v2/routes/FuelEntriesRoute.tsx`, change line 8 from:

```ts
import { apiFetch } from '../../../../hooks/useApi';
```

to:

```ts
import { apiFetchV2 } from '../hooks/apiFetchV2';
```

Then change line 36 from:

```ts
    apiFetch<{ conflicts: Record<string, unknown>[] }>(
```

to:

```ts
    apiFetchV2<{ conflicts: Record<string, unknown>[] }>(
```

- [ ] **Step 5: `ServiceRoute.tsx` — same swap**

In `client/src/pages/fleet/v2/routes/ServiceRoute.tsx`, change line 8 from:

```ts
import { apiFetch } from '../../../../hooks/useApi';
```

to:

```ts
import { apiFetchV2 } from '../hooks/apiFetchV2';
```

Then change line 34 from:

```ts
    apiFetch<{ conflicts: Record<string, unknown>[] }>(
```

to:

```ts
    apiFetchV2<{ conflicts: Record<string, unknown>[] }>(
```

- [ ] **Step 6: `WorkOrdersRoute.tsx` — remove the now-unused `apiFetch` import, swap the conflicts fetch**

In `client/src/pages/fleet/v2/routes/WorkOrdersRoute.tsx`, delete line 15:

```ts
import { apiFetch } from '../../../../hooks/useApi';
```

(line 14 already imports `apiFetchV2` from `'../hooks/apiFetchV2'` — keep it.)

Then change line 104 from:

```ts
    apiFetch<{ conflicts: Record<string, unknown>[] }>(
```

to:

```ts
    apiFetchV2<{ conflicts: Record<string, unknown>[] }>(
```

- [ ] **Step 7: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors (0 errors from these 6 files — there are pre-existing unrelated errors in the repo per `CLAUDE.md`'s "12 pre-existing errors" note; confirm none of them are in the 6 files you just touched).

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/fleet/v2/vehicleDetail/OverviewTab.tsx \
        client/src/pages/fleet/v2/vehicleDetail/FuelTab.tsx \
        client/src/pages/fleet/v2/vehicleDetail/ServiceTab.tsx \
        client/src/pages/fleet/v2/routes/FuelEntriesRoute.tsx \
        client/src/pages/fleet/v2/routes/ServiceRoute.tsx \
        client/src/pages/fleet/v2/routes/WorkOrdersRoute.tsx
git commit -m "fix(fleet-v2): route 6 remaining fetches through apiFetchV2 for audit coverage"
```

---

### Task 2: Consolidate snake_case→Title Case formatting onto `toDisplayLabel()`

**Why:** Three different techniques exist for the same transform across Fleet v2: `toDisplayLabel()` (canonical, already used in `ActivityTab.tsx`), `.replace(/_/g, ' ').toUpperCase()` (in `VehicleDetailRoute.tsx` and `InsightsRoute.tsx`), and an unguarded `.replace('_', ' ')` missing the `/g` flag (in `WorkOrdersTab.tsx` — would under-format any future multi-underscore status). This task fixes the missing-`/g` bug and the inconsistency in one pass by standardizing all three on `toDisplayLabel()`.

**Files:**
- Modify: `client/src/pages/fleet/v2/vehicleDetail/WorkOrdersTab.tsx`
- Modify: `client/src/pages/fleet/v2/routes/VehicleDetailRoute.tsx`
- Modify: `client/src/pages/fleet/v2/routes/InsightsRoute.tsx`

- [ ] **Step 1: `WorkOrdersTab.tsx` — import `toDisplayLabel`, use it for the status label**

In `client/src/pages/fleet/v2/vehicleDetail/WorkOrdersTab.tsx`, add this import after line 4 (`import { apiFetchV2 } from '../hooks/apiFetchV2';`):

```ts
import { toDisplayLabel } from '../../../../utils/formatters';
```

Then change line 79 from:

```tsx
                    {r.status.replace('_', ' ')}
```

to:

```tsx
                    {toDisplayLabel(r.status)}
```

The badge already has the `uppercase` CSS class (`text-[10px] uppercase tracking-wide` at line 78), so `toDisplayLabel`'s Title Case output renders visually identical to before (all-caps via CSS) — no visual regression, and `waiting_parts` now correctly becomes "Waiting Parts" (was already correct with the single-underscore case, but this closes the latent bug for any future multi-underscore status added to `STATUS_TONES`).

- [ ] **Step 2: `VehicleDetailRoute.tsx` — use `toDisplayLabel` under the existing `.toUpperCase()`**

In `client/src/pages/fleet/v2/routes/VehicleDetailRoute.tsx`, find the import block near the top of the file and add:

```ts
import { toDisplayLabel } from '../../../../utils/formatters';
```

Then change line 136 from:

```tsx
            {(vehicle.status ?? 'unknown').replace(/_/g, ' ').toUpperCase()}
```

to:

```tsx
            {toDisplayLabel(vehicle.status ?? 'unknown').toUpperCase()}
```

This chip has no `uppercase` CSS class — the caps come from the explicit `.toUpperCase()` call — so keep that call to preserve the exact current visual (all-caps chip), only replacing the underscore-splitting logic with the canonical helper.

- [ ] **Step 3: `InsightsRoute.tsx` — use `toDisplayLabel` for the status badge**

In `client/src/pages/fleet/v2/routes/InsightsRoute.tsx`, add this import near the top of the file (alongside the existing imports around line 19-20):

```ts
import { toDisplayLabel } from '../../../../utils/formatters';
```

Then change line 178 from:

```tsx
  return <span className={`px-1.5 py-0.5 rounded-sm text-[10px] uppercase tracking-wide ${tone}`}>{status.replace(/_/g, ' ')}</span>;
```

to:

```tsx
  return <span className={`px-1.5 py-0.5 rounded-sm text-[10px] uppercase tracking-wide ${tone}`}>{toDisplayLabel(status)}</span>;
```

This badge already has the `uppercase` CSS class, so the Title Case output from `toDisplayLabel` renders identically to before.

- [ ] **Step 4: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors in the 3 touched files.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/fleet/v2/vehicleDetail/WorkOrdersTab.tsx \
        client/src/pages/fleet/v2/routes/VehicleDetailRoute.tsx \
        client/src/pages/fleet/v2/routes/InsightsRoute.tsx
git commit -m "fix(fleet-v2): consolidate status-label formatting on toDisplayLabel"
```

---

### Task 3: Surface a partial-failure banner in `CostsTab.tsx`

**Why:** `CostsTab.tsx` fetches 5 cost-category endpoints via `Promise.allSettled`. If one rejects, that category is silently omitted with no visual cue — unlike `WorkOrdersTab.tsx`, which shows an explicit error banner (`<div className="p-4 text-xs text-red-400">{err}</div>`) on fetch failure. This task adds the same visual pattern for partial failures, without blocking display of categories that did succeed.

**Files:**
- Modify: `client/src/pages/fleet/v2/vehicleDetail/CostsTab.tsx`

- [ ] **Step 1: Track which categories failed**

In `client/src/pages/fleet/v2/vehicleDetail/CostsTab.tsx`, add a new state variable after the existing `costPerMile` state (currently line 11):

```ts
  const [failedCategories, setFailedCategories] = useState<string[]>([]);
```

- [ ] **Step 2: Record failures in the `Promise.allSettled` handler**

Change the `.then()` callback (currently lines 22-34) from:

```ts
    ]).then(([i, l, a, o, cpm]) => {
      if (cancelled) return;
      const arrayOrEmpty = (r: PromiseSettledResult<CostRow[]>): CostRow[] =>
        r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : [];
      setInsurance(arrayOrEmpty(i));
      setLoans(arrayOrEmpty(l));
      setAccessories(arrayOrEmpty(a));
      setOther(arrayOrEmpty(o));
      if (cpm.status === 'fulfilled' && cpm.value && typeof cpm.value.cost_per_mile === 'number') {
        setCostPerMile(cpm.value.cost_per_mile);
      }
      setLoading(false);
    });
```

to:

```ts
    ]).then(([i, l, a, o, cpm]) => {
      if (cancelled) return;
      const arrayOrEmpty = (r: PromiseSettledResult<CostRow[]>): CostRow[] =>
        r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : [];
      setInsurance(arrayOrEmpty(i));
      setLoans(arrayOrEmpty(l));
      setAccessories(arrayOrEmpty(a));
      setOther(arrayOrEmpty(o));
      if (cpm.status === 'fulfilled' && cpm.value && typeof cpm.value.cost_per_mile === 'number') {
        setCostPerMile(cpm.value.cost_per_mile);
      }
      const failed: string[] = [];
      if (i.status === 'rejected') failed.push('Insurance');
      if (l.status === 'rejected') failed.push('Loans');
      if (a.status === 'rejected') failed.push('Accessories');
      if (o.status === 'rejected') failed.push('Other costs');
      if (cpm.status === 'rejected') failed.push('Cost per mile');
      setFailedCategories(failed);
      setLoading(false);
    });
```

- [ ] **Step 3: Render the banner when a category failed**

Change the `allEmpty` early-return block and the render, from:

```tsx
  const allEmpty = sections.every((s) => s.rows.length === 0) && costPerMile == null;
  if (allEmpty) return <div className="p-4 text-sm text-rmpg-400">No costs recorded for this vehicle.</div>;

  return (
    <div className="p-4 space-y-4">
      {costPerMile != null ? (
```

to:

```tsx
  const allEmpty = sections.every((s) => s.rows.length === 0) && costPerMile == null;
  if (allEmpty && failedCategories.length === 0) {
    return <div className="p-4 text-sm text-rmpg-400">No costs recorded for this vehicle.</div>;
  }

  return (
    <div className="p-4 space-y-4">
      {failedCategories.length > 0 ? (
        <div className="rounded-sm border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          Couldn't load: {failedCategories.join(', ')}. Other sections below may be incomplete.
        </div>
      ) : null}
      {costPerMile != null ? (
```

Note: when `allEmpty` is true but a category failed, the function now falls through to the full render (which shows the banner and no cost sections) instead of the terse "No costs recorded" message — this is the intended behavior change, since "no costs" and "couldn't load costs" are different states that shouldn't look the same.

- [ ] **Step 4: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors in `CostsTab.tsx`.

- [ ] **Step 5: Manual verification in the dev server**

Run: `cd client && npm run dev` (and `npm run dev` in the repo root for the Worker, if not already running)
Open `http://localhost:5173/fleet/v2/vehicles/<any-vehicle-id>` and click the Costs tab. Confirm no visual regression when all fetches succeed.
Then temporarily change one URL in the `Promise.allSettled` array (e.g. `/fleet/${vehicleId}/insurance` → `/fleet/${vehicleId}/insurance-nonexistent`) to force a 404, reload the tab, confirm the red banner appears listing "Insurance", and that Loans/Accessories/Other still render normally. Revert the temporary change afterward.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/fleet/v2/vehicleDetail/CostsTab.tsx
git commit -m "fix(fleet-v2): surface partial-failure banner in CostsTab"
```

---

### Task 4: Remove dead duplicate backend routes in `src/routes/fleet.ts`

**Why:** `GET/POST /:id/damage` and `GET/POST /:id/recalls` are unused duplicates of `GET/POST /:id/damage-reports` (used by `DamageTab.tsx`) and `GET /recalls?vehicle_id=` (used by `RecallsTab.tsx`) respectively — confirmed via repo-wide grep that nothing in `client/src` or `desktop` calls the bare `/damage` or `/:id/recalls` paths. Removing them avoids future drift between the two copies of near-identical SQL.

**Files:**
- Modify: `src/routes/fleet.ts`

- [ ] **Step 1: Delete the unused `/:id/damage` GET and POST handlers**

In `src/routes/fleet.ts`, delete lines 2567-2584 (the `fleet.get('/:id/damage', ...)` and `fleet.post('/:id/damage', ...)` handlers):

```ts
fleet.get('/:id/damage', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_damage WHERE vehicle_id = ? ORDER BY reported_date DESC', vehicleId);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/:id/damage failed:', err); return c.json([]); }
});

fleet.post('/:id/damage', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_damage (vehicle_id, damage_type, location, severity, description, reported_by, reported_date, repair_cost, repair_status, repair_date, photo_urls, notes) VALUES (?,?,?,?,?,?,datetime('now'),?,?,?,?,?)`, vehicleId, body.damage_type ?? null, body.location ?? null, body.severity ?? null, body.description ?? null, (c.get('user') as { full_name: string } | undefined)?.full_name ?? null, body.repair_cost ?? null, body.repair_status ?? 'pending', body.repair_date ?? null, body.photo_urls ?? null, body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_damage WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/damage failed:', err); return dbErrorResponse(c, err, 'Failed'); }
});

```

Leave `fleet.put('/damage/:id', ...)` and `fleet.delete('/damage/:id', ...)` in place — those are edit/delete-by-record-id routes, unrelated to the duplicate list/create pair being removed, and are not part of this audit finding.

- [ ] **Step 2: Delete the unused `/:id/recalls` GET and POST handlers**

In the same file, delete the block (originally lines 2677-2693):

```ts
fleet.get('/:id/recalls', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_recalls WHERE vehicle_id = ? ORDER BY issue_date DESC', vehicleId);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/:id/recalls failed:', err); return c.json([]); }
});

fleet.post('/:id/recalls', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_recalls (vehicle_id, nhtsa_number, description, severity, issue_date, remedy_date, status, notes) VALUES (?,?,?,?,?,?,?,?)`, vehicleId, body.nhtsa_number ?? null, body.description ?? null, body.severity ?? 'medium', body.issue_date ?? null, body.remedy_date ?? null, body.status ?? 'open', body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_recalls WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/recalls failed:', err); return dbErrorResponse(c, err, 'Failed'); }
});
```

Leave `fleet.put('/recalls/:id', ...)` and `fleet.delete('/recalls/:id', ...)` in place, and leave the comment block above `fleet.get('/recalls', ...)` (the "literal routes registered BEFORE parameterized /:id/recalls" note) — it's still accurate context for why `/recalls` and `/recalls/:id` are declared where they are, even after the parameterized duplicate is gone.

- [ ] **Step 3: Confirm no other repo-wide references to the deleted paths**

Run:
```bash
grep -rn "\${[a-zA-Z0-9_.]*}/damage[^-]\|\${[a-zA-Z0-9_.]*}/recalls" client/src desktop 2>/dev/null
```
Expected: no output (already confirmed during planning, but re-verify after the edit in case the diff shifted anything).

- [ ] **Step 4: Typecheck the Worker**

Run: `npm run typecheck`
Expected: no new errors (0 errors from `src/routes/fleet.ts`).

- [ ] **Step 5: Run the Worker test suite**

Run: `npx vitest run`
Expected: all tests pass (matches the pre-existing green baseline — 202 test files, 1726 passed, 1 skipped, confirmed before starting this plan).

- [ ] **Step 6: Commit**

```bash
git add src/routes/fleet.ts
git commit -m "fix(fleet): remove dead duplicate /:id/damage and /:id/recalls routes"
```

---

### Task 5: Tighten `apiFetchV2.ts`'s status-code regex fallback

**Why:** `statusFromError()` in `apiFetchV2.ts` first tries `/\b(?:HTTP|status)\s*(\d{3})\b/i` (explicit marker), then falls back to a bare `/\b(\d{3})\b/` match on the raw error message. That bare fallback can misread any embedded 3-digit number (an ID, a mileage, a street address) as an HTTP status. This task removes the unsafe bare fallback — if the message has no explicit "HTTP"/"status" marker, the status is left as `0` (unknown) rather than guessed.

**Files:**
- Modify: `client/src/pages/fleet/v2/hooks/apiFetchV2.ts`
- Test: `client/src/pages/fleet/v2/hooks/__tests__/apiFetchV2.test.ts` (new file)

- [ ] **Step 1: Export `statusFromError` so it's directly unit-testable**

In `client/src/pages/fleet/v2/hooks/apiFetchV2.ts`, change line 26 from:

```ts
function statusFromError(err: ApiError): number {
```

to:

```ts
export function statusFromError(err: ApiError): number {
```

- [ ] **Step 2: Remove the unsafe bare-number fallback**

Change line 29 from:

```ts
  const m = err.message?.match(/\b(?:HTTP|status)\s*(\d{3})\b/i) ?? err.message?.match(/\b(\d{3})\b/);
```

to:

```ts
  const m = err.message?.match(/\b(?:HTTP|status)\s*(\d{3})\b/i);
```

- [ ] **Step 3: Write the failing test for the new behavior**

Create `client/src/pages/fleet/v2/hooks/__tests__/apiFetchV2.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { statusFromError } from '../apiFetchV2';

describe('statusFromError', () => {
  it('returns err.status when present and finite', () => {
    expect(statusFromError({ name: 'Error', message: 'ignored', status: 404 } as never)).toBe(404);
  });

  it('parses "HTTP 404" style messages', () => {
    expect(statusFromError({ name: 'Error', message: 'HTTP 404' } as never)).toBe(404);
  });

  it('parses "Request failed with status 500" style messages', () => {
    expect(statusFromError({ name: 'Error', message: 'Request failed with status 500' } as never)).toBe(500);
  });

  it('does NOT misread an embedded 3-digit number as a status when there is no HTTP/status marker', () => {
    expect(statusFromError({ name: 'Error', message: 'Vehicle at 404 Main St not found' } as never)).toBe(0);
  });

  it('returns 0 when the message has no digits at all', () => {
    expect(statusFromError({ name: 'Error', message: 'Network error' } as never)).toBe(0);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails before the fix (sanity check the test itself)**

Temporarily re-add the old bare-fallback line from Step 2, run:
Run: `cd client && npx vitest run src/pages/fleet/v2/hooks/__tests__/apiFetchV2.test.ts`
Expected: the "does NOT misread" test FAILS (returns `404` instead of `0`), confirming the test actually exercises the bug. Then re-apply the Step 2 fix.

- [ ] **Step 5: Run the test to verify it passes with the fix applied**

Run: `cd client && npx vitest run src/pages/fleet/v2/hooks/__tests__/apiFetchV2.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 6: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/fleet/v2/hooks/apiFetchV2.ts \
        client/src/pages/fleet/v2/hooks/__tests__/apiFetchV2.test.ts
git commit -m "fix(fleet-v2): stop misreading embedded numbers as HTTP status in apiFetchV2"
```

---

### Final verification (run once all 5 tasks are committed)

- [ ] **Step 1: Full client test suite**

Run: `cd client && npx vitest run`
Expected: all tests pass, including the 5 new `apiFetchV2.test.ts` cases.

- [ ] **Step 2: Full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: same pre-existing error count as before this plan started (per `CLAUDE.md`: 12 pre-existing client errors, 0 introduced by this batch).

- [ ] **Step 3: Full Worker typecheck + test suite**

Run: `npm run typecheck && npx vitest run`
Expected: 0 errors, all tests pass (202 files / 1726 passed / 1 skipped baseline).

- [ ] **Step 4: Client build**

Run: `cd client && npx vite build`
Expected: build succeeds with no new warnings from the touched files.
