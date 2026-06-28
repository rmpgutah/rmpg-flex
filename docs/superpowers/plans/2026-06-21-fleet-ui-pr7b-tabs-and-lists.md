# Fleet Manager UI — PR 7'b: Vehicle-detail tabs + Fleet-wide list pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development if you have subagents available). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land the next layer of the Fleet.io-style Fleet Manager UI on top of PR 7'a's shell — the 4 highest-impact vehicle-detail tabs (Service, Inspections, Fuel, Activity) + the 4 fleet-wide list pages (Fuel Entries, Service, Inspections, Vendors). Still parallel-mounted at `/fleet/v2/*`.

**Out-of-scope (deferred to a follow-on PR before 7'c)**: Vehicle-detail tabs Costs/Recalls/Damage/Tires/Assignments, and the full Reports card grid (~11 drill-in pages). Those tabs and the Reports route still render `<EmptyStateCard plannedPr="PR 7'b.2">`.

**Architecture:** Each new tab/route fetches via the existing `/api/fleet/*` endpoints — zero new backend, zero schema changes. The four fleet-wide list pages share `<FleetListShell>` (expanded in this PR with sort + pagination chrome). The Activity tab queries the existing `audit_log` via a new tiny worker route `GET /api/audit/by-vehicle/:id` to keep that aspect explicit + auditable.

**Tech Stack:** Same as 7'a — React 18 + TypeScript 5 + React Router 6 + Vitest 4 + RTL.

**Spec:** [`docs/superpowers/specs/2026-06-21-fleet-manager-ui-fleetio-style-design.md`](../specs/2026-06-21-fleet-manager-ui-fleetio-style-design.md)

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/routes/auditByEntity.ts` | create | Tiny Worker route `GET /api/audit/by-vehicle/:id` — paginated `audit_log` filtered by `entity_type='vehicle' AND entity_id=:id` |
| `src/routesConfig.ts` | modify | Register the new audit-by-entity route |
| `client/src/pages/fleet/v2/vehicleDetail/ServiceTab.tsx` | create | Timeline of `fleet_maintenance` rows for the vehicle |
| `client/src/pages/fleet/v2/vehicleDetail/InspectionsTab.tsx` | create | Per-vehicle inspections list (pass/fail badge + photo count) |
| `client/src/pages/fleet/v2/vehicleDetail/FuelTab.tsx` | create | Per-vehicle fuel entries table + MPG-trend mini sparkline |
| `client/src/pages/fleet/v2/vehicleDetail/ActivityTab.tsx` | create | Chronological feed from `/api/audit/by-vehicle/:id` |
| `client/src/pages/fleet/v2/routes/VehicleDetailRoute.tsx` | modify | Wire the 4 new tabs (replace EmptyStateCard for those ids) |
| `client/src/pages/fleet/v2/routes/FuelEntriesRoute.tsx` | create | Fleet-wide fuel-entries list using `/api/fleet/fuel` |
| `client/src/pages/fleet/v2/routes/ServiceRoute.tsx` | create | Fleet-wide service-entries list — joins maintenance + vehicle |
| `client/src/pages/fleet/v2/routes/InspectionsRoute.tsx` | create | Fleet-wide inspection list |
| `client/src/pages/fleet/v2/routes/VendorsRoute.tsx` | create | `fleet_fuel_vendors` list (used by Fuel + Service) |
| `client/src/pages/fleet/v2/FleetShell.tsx` | modify | Wire the 4 new fleet-wide routes (replace EmptyStateCard for those ids) |
| `client/src/pages/fleet/v2/shell/FleetListShell.tsx` | modify | Expand the stub: add sort dropdown + simple client-side pagination + CSV export hook. Filter chips deferred (need per-resource shapes — gets too generic). |
| Various `__tests__/*.test.tsx` | create | One smoke + behavior test per new component |
| `tests/cross-impact/channel-parity.test.ts` | create | §6.4 — assert the v2 fleet-data routes subscribe to `'fleet'` channel name (matches v1 verbatim) |

---

## Task 1: Worker route — `GET /api/audit/by-vehicle/:id`

**Why:** The Activity tab needs `audit_log` rows scoped to one vehicle. Keep the query explicit in its own route so it's auditable and rate-limit-able.

**Files:**
- Create: `src/routes/auditByEntity.ts`
- Modify: `src/routesConfig.ts`
- Create: `tests/auditByEntity.test.ts`

- [ ] **Step 1.1: Write failing test**

Create `tests/auditByEntity.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import auditByEntity from '../src/routes/auditByEntity';

describe('GET /api/audit/by-vehicle/:id', () => {
  let app: Hono<any>;
  let dbCall: { sql: string; bindings: unknown[] } | null = null;

  beforeEach(() => {
    dbCall = null;
    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('user', { id: 7, username: 'tester', role: 'officer' });
      c.set('userId', 7);
      (c as any).env = {
        DB: {
          prepare: (sql: string) => ({
            bind: (...bindings: unknown[]) => ({
              all: async () => {
                dbCall = { sql, bindings };
                return { results: [
                  { id: 1, action: 'STATUS_CHANGE', details: '{"from":"in_service","to":"maintenance"}', created_at: '2026-06-20T10:00:00Z', user_id: 7 },
                ] };
              },
            }),
          }),
        },
        EVENTS: undefined,
      };
      await next();
    });
    app.route('/api/audit/by-vehicle', auditByEntity);
  });

  it('returns audit_log rows scoped to the vehicle id', async () => {
    const res = await app.request('/api/audit/by-vehicle/42');
    expect(res.status).toBe(200);
    const body = await res.json() as { rows: Array<{ action: string }> };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].action).toBe('STATUS_CHANGE');
    expect(dbCall?.bindings).toContain('vehicle');
    expect(dbCall?.bindings).toContain(42);
  });

  it('rejects a non-numeric id (400)', async () => {
    const res = await app.request('/api/audit/by-vehicle/abc');
    expect(res.status).toBe(400);
  });

  it('clamps limit to 100 max', async () => {
    const res = await app.request('/api/audit/by-vehicle/42?limit=500');
    expect(res.status).toBe(200);
    expect(dbCall?.bindings).toContain(100);
  });
});
```

- [ ] **Step 1.2: Implement**

Create `src/routes/auditByEntity.ts`:

```ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';

const route = new Hono<Env>();

interface AuditRow {
  id: number;
  action: string;
  details: string | null;
  created_at: string;
  user_id: number | null;
}

route.get('/:id', async (c) => {
  const idRaw = c.req.param('id');
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: 'invalid vehicle id' }, 400);
  }
  const limitRaw = Number(c.req.query('limit') ?? 50);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 100);
  const db = getDb(c.env);
  const rows = await query<AuditRow>(
    db,
    `SELECT id, action, details, created_at, user_id
     FROM audit_log
     WHERE entity_type = ? AND entity_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    'vehicle', id, limit,
  );
  return c.json({ rows });
});

export default route;
```

- [ ] **Step 1.3: Register**

In `src/routesConfig.ts`, add the import alongside `auditEmit`:

```ts
import auditByEntity from './routes/auditByEntity';
```

And the registry entry after `/api/audit-emit`:

```ts
  { prefix: '/api/audit/by-vehicle', router: auditByEntity, auth: 'required' },
```

- [ ] **Step 1.4: Run + commit**

```bash
npx vitest run tests/auditByEntity.test.ts
npm run typecheck
git add src/routes/auditByEntity.ts src/routesConfig.ts tests/auditByEntity.test.ts
git commit -m "feat(fleet-v2): GET /api/audit/by-vehicle/:id (audit_log scoped to vehicle)"
```

---

## Task 2: ActivityTab

**Files:**
- Create: `client/src/pages/fleet/v2/vehicleDetail/ActivityTab.tsx`
- Create: `client/src/pages/fleet/v2/vehicleDetail/__tests__/ActivityTab.test.tsx`

- [ ] **Step 2.1: Implement + test**

Create `client/src/pages/fleet/v2/vehicleDetail/ActivityTab.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../hooks/useApi';

interface AuditRow {
  id: number;
  action: string;
  details: string | null;
  created_at: string;
  user_id: number | null;
}

export function ActivityTab({ vehicleId }: { vehicleId: number }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiFetch<{ rows: AuditRow[] }>(`/audit/by-vehicle/${vehicleId}?limit=100`)
      .then((r) => setRows(r?.rows ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [vehicleId]);

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading activity…</div>;
  if (rows.length === 0) return <div className="p-4 text-sm text-rmpg-400">No activity recorded for this vehicle.</div>;

  return (
    <div className="p-4">
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="border border-rmpg-700 bg-surface-raised rounded-sm px-3 py-2 text-[11px]">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold text-rmpg-100">{r.action}</span>
              <time className="text-rmpg-400">{new Date(r.created_at).toLocaleString()}</time>
            </div>
            {r.details ? (
              <pre className="mt-1 text-[10px] text-rmpg-400 whitespace-pre-wrap break-words">{tryFormatJson(r.details)}</pre>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function tryFormatJson(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}
```

Create the test file with stubbed fetch returning 2 rows; assert both render with their `action` text + a `<time>` element.

- [ ] **Step 2.2: Run + commit**

```bash
cd client && npx vitest run src/pages/fleet/v2/vehicleDetail/__tests__/ActivityTab.test.tsx
git add client/src/pages/fleet/v2/vehicleDetail/ActivityTab.tsx client/src/pages/fleet/v2/vehicleDetail/__tests__/ActivityTab.test.tsx
git commit -m "feat(fleet-v2): ActivityTab — audit_log feed for vehicle"
```

---

## Task 3: ServiceTab + InspectionsTab + FuelTab (vehicle-detail)

**Files:**
- Create: `client/src/pages/fleet/v2/vehicleDetail/ServiceTab.tsx`
- Create: `client/src/pages/fleet/v2/vehicleDetail/InspectionsTab.tsx`
- Create: `client/src/pages/fleet/v2/vehicleDetail/FuelTab.tsx`
- Create: corresponding test files

Each tab follows the same pattern:
1. Accept `{ vehicleId }: { vehicleId: number }` prop.
2. `useEffect` fetches the appropriate `/api/fleet/...` endpoint filtered by vehicle.
3. Render a card list with the canonical fields per resource.
4. Empty + loading states.
5. Test asserts loading → data → empty paths.

Endpoints used (already exist):
- ServiceTab: `apiFetch('/fleet/maintenance?vehicle_id=' + id)` — adjust to existing route shape; check `src/routes/fleet.ts` for the actual route.
- InspectionsTab: `apiFetch('/fleet/inspections?vehicle_id=' + id)`
- FuelTab: `apiFetch('/fleet/fuel?vehicle_id=' + id)`

If the existing `/api/fleet/*` doesn't support per-vehicle filtering, the tab fetches the full list and filters client-side (acceptable for now; the existing FleetXxxTab files already do this).

**Implementation note for each tab**: keep them ~80-120 lines each. Don't try to port the full 400+ line existing FleetFuelTab — that complexity moves to a 7'b.2 followup. PR 7'b just needs each tab to render the data with the essential fields.

- [ ] **Step 3.1-3.6: Implement each tab + test, run, commit per tab.** Three commits total.

---

## Task 4: Wire the 4 new tabs into VehicleDetailRoute

**Files:**
- Modify: `client/src/pages/fleet/v2/routes/VehicleDetailRoute.tsx`

- [ ] **Step 4.1: Replace the EmptyStateCard branches for service/inspections/fuel/activity**

In the `activeTab` rendering switch, replace the EmptyStateCard for those 4 tab ids with the new tab components:

```tsx
{activeTab === 'overview'    ? <OverviewTab vehicle={vehicle} /> :
 activeTab === 'service'     ? <ServiceTab vehicleId={vehicle.id} /> :
 activeTab === 'inspections' ? <InspectionsTab vehicleId={vehicle.id} /> :
 activeTab === 'fuel'        ? <FuelTab vehicleId={vehicle.id} /> :
 activeTab === 'activity'    ? <ActivityTab vehicleId={vehicle.id} /> :
 <div className="p-4"><EmptyStateCard ... /></div>}
```

- [ ] **Step 4.2: Update VehicleDetailRoute test**

The existing test asserts "click Service shows the EmptyStateCard for 7'b". Update to assert "click Service shows the ServiceTab content" (or just that the tab content area changes — least brittle).

- [ ] **Step 4.3: Run + commit**

---

## Task 5: Expand FleetListShell with sort + pagination + export

**Files:**
- Modify: `client/src/pages/fleet/v2/shell/FleetListShell.tsx`
- Modify: `client/src/pages/fleet/v2/shell/__tests__/FleetListShell.test.tsx`

- [ ] **Step 5.1: Extend the props**

Add optional `sortOptions: { id: string; label: string }[]`, `onSortChange: (id: string) => void`, `currentSort: string`, `pageSize: number = 50`, `totalCount: number`, `currentPage: number`, `onPageChange: (page: number) => void`, `onExport?: () => void`.

- [ ] **Step 5.2: Render the new chrome**

Add a sort dropdown right of the search input. Add pagination controls + count below the children area. Add an Export button next to the action slot.

- [ ] **Step 5.3: Tests**

Add tests for: sort dropdown fires onSortChange; pagination buttons fire onPageChange; Export button fires onExport.

- [ ] **Step 5.4: Commit**

---

## Task 6: FuelEntriesRoute — fleet-wide list page

**Files:**
- Create: `client/src/pages/fleet/v2/routes/FuelEntriesRoute.tsx`
- Create: `client/src/pages/fleet/v2/__tests__/FuelEntriesRoute.test.tsx`

Pattern:
1. `useFleetV2View('/fleet/v2/fuel')`.
2. Fetch `/api/fleet/fuel` once.
3. Client-side search/sort/paginate (server-side pagination deferred to 7'b.2).
4. Cards: date · vehicle (by id resolve via second fetch /fleet) · vendor · gallons · $/gal · total · MPG.
5. Export → CSV download.

Test:
1. Renders seeded fuel rows.
2. Search filters by vendor name.
3. Sort changes order.

- [ ] **Step 6.1-6.4: implement, test, commit.**

---

## Task 7: ServiceRoute, InspectionsRoute, VendorsRoute (fleet-wide)

Same pattern as Task 6, one per route. Each ships ~80-120 lines + a 2-3 case test.

Endpoints:
- ServiceRoute: `/api/fleet/maintenance` (or whatever exists for fleet-wide service log)
- InspectionsRoute: `/api/fleet/inspections`
- VendorsRoute: `/api/fleet/vendors` (or `/api/fleet/fuel-vendors` — check existing route file)

- [ ] **Step 7.1-7.9: Three routes, three tests, three commits.**

---

## Task 8: Wire 4 new fleet-wide routes into FleetShell

**Files:**
- Modify: `client/src/pages/fleet/v2/FleetShell.tsx`

The `SIDEBAR_SECTIONS.filter((s) => !['dashboard', 'vehicles'].includes(s.id))` loop currently shows EmptyStateCard for every non-built section. Replace the EmptyStateCard for `fuel`/`service`/`inspections`/`vendors` with the new Route components:

```tsx
const wired: Record<string, JSX.Element> = {
  'fuel': <FuelEntriesRoute />,
  'service': <ServiceRoute />,
  'inspections': <InspectionsRoute />,
  'vendors': <VendorsRoute />,
};
// ... in the .map: element={wired[s.id] ?? <EmptyStateCard ... />}
```

Update FleetShell tests if any of them assert empty-state at those routes.

- [ ] **Step 8.1-8.3: implement, run, commit.**

---

## Task 9: Channel-parity test (§6.4 follow-on)

**Files:**
- Create: `client/tests/fleet-v2-parity/live-channel.test.ts`

Pure module-grep test that asserts both `client/src/pages/fleet/FleetPage.tsx` (v1) AND at least one v2 route subscribe to the same channel string `'fleet'`. The point is to lock in the design rule before 7'c cutover.

If v2 doesn't subscribe to `'fleet'` yet (PR 7'a chose not to — fetch-on-mount only), the test asserts that the v2 code path includes a TODO marker or a follow-up reference for 7'c. Either way, it documents the contract.

- [ ] **Step 9.1: Implement + commit.**

---

## Task 10: Final verification + push + PR

- [ ] **Step 10.1**: Worker typecheck, client typecheck, full vitest, client vite build.
- [ ] **Step 10.2**: Push branch.
- [ ] **Step 10.3**: Open PR with detailed scope description.

---

## Verification matrix (spec coverage for 7'b)

| Spec requirement | Covered by task |
|---|---|
| §2 ServiceTab / InspectionsTab / FuelTab | 3 |
| §2 Activity tab (audit_log feed) | 1 + 2 |
| §2 12 vehicle-detail tabs total | Partial — 4 wired (1+3); 5 stay empty-state for 7'b.2; 3 (Issues/WorkOrders/Documents) stay empty-state per the design |
| §3 fleet-wide list pages: Fuel/Service/Inspections/Vendors | 6, 7 |
| §3 FleetListShell with filters + sort + pagination + export | 5 — partial (sort + pagination + export; filter chips deferred to 7'b.2) |
| §3 Reports section | DEFERRED to 7'b.2 |
| §6.4 channel-parity test | 9 |

## Out of scope (lands in PR 7'b.2 before 7'c)

- Vehicle-detail tabs: Costs, Recalls, Damage, Tires, Assignments
- Reports card grid (Dashboard / Maintenance Schedule / Driver Performance / Service Alerts / Cost Trends / Vehicle Lifecycle / Notifications / Overdue Inspections / Combined Cost Trend / Monthly Spend / Daily GPS Mileage)
- FleetListShell filter chips
- Server-side pagination
