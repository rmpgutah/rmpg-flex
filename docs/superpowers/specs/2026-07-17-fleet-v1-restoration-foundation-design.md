# Fleet v1 Restoration — Foundation — Design Spec

**Date**: 2026-07-17
**Status**: Approved (brainstormed in-session with operator)
**Owner**: Christopher Zamora (operator-owner)
**Implementation**: First of a 4-part sequence reversing the v2 cutover and completing the Fleet.io program on v1
**Parent spec**: [`docs/superpowers/specs/2026-06-21-fleetio-integration-design.md`](2026-06-21-fleetio-integration-design.md)
**Supersedes (routing decision only)**: [`docs/superpowers/specs/2026-06-21-fleet-manager-ui-fleetio-style-design.md`](2026-06-21-fleet-manager-ui-fleetio-style-design.md)

---

## Goal

Reverse the `/fleet` route back to the original tab-based UI ("v1": `client/src/pages/fleet/FleetPage.tsx` + `client/src/pages/fleet/tabs/*`), delete the "v2" Fleet.io-style two-pane shell (`client/src/pages/fleet/v2/`) that currently serves `/fleet`, and port every piece of real (non-stub) functionality that only exists in v2 into v1 — so nothing is lost and v1 becomes the sole, permanent home for Fleet going forward. This is the foundation PR for a larger program: once v1 is back to full parity plus the v2-exclusive features, three more sub-projects build the remaining unfinished Fleet.io work (PR 6 Inspections + Issues, Documents + Parts, PR 7-9 dashboards/viz) directly against v1.

## Background

`/fleet` was cut over from v1 to v2 per the [Fleet Manager UI design](2026-06-21-fleet-manager-ui-fleetio-style-design.md), with v1 kept alive at `/fleet-legacy` as a 7-day escape hatch. The operator has since decided to keep building on v1 permanently instead of v2. An audit (see Appendix) found the backend is entirely shared and UI-agnostic — no `/api/fleet/*`, `/api/fleetio/*`, or `/api/work-orders/*` route needs to change. The only real work is on the frontend: what v2 built that v1 never had, and what needs to move.

## Non-goals

- **No backend changes.** Every endpoint this spec's new UI calls already exists and is reused as-is.
- **No schema changes.** No migrations.
- **No work on PR 6 (Inspections + Issues), Documents + Parts, or PR 7-9 (dashboards/viz).** Those are separate specs, sequenced after this one.
- **No fix for the PR 3 "Advanced" ref-table-backed vehicle/fuel form fields.** Audit confirmed this was never built in *either* UI (not a v1/v2 casualty) — it's a pre-existing gap, tracked separately, out of scope here.
- **No changes to mobile routes** (`/mobile/*`, `/field/*`) — unaffected by this swap.

## Decisions locked in (from brainstorming)

1. **v2 code is deleted outright**, not parked at a side route — matches this repo's convention (VPS-era `legacy/` was deleted, not quarantined) and avoids two UIs drifting out of sync. Git history preserves it if ever needed.
2. **Build order for the full program**: this foundation PR → PR 6 (Inspections + Issues) → Documents + Parts → PR 7-9 (dashboards/viz), matching the original design doc's dependency order (later pieces read data earlier pieces produce).
3. **Vendors tab**: add now, in this PR. v1 never had one — it's new functionality from the Fleet.io program's PR 2, not a v1 feature that atrophied.
4. **Conflict badges**: wire into v1 now, in this PR. `FleetioConflictBadge` is a generic, already-shared component (used in the Admin health tab), not v2-exclusive infrastructure.
5. **Fleet-wide Service (cross-vehicle maintenance) tab**: add now, in this PR, using the same list pattern as Work Orders/Vendors.
6. **Insights (fleet-viz dashboard)**: explicitly deferred to the PR 7-9 sub-project. Building a throwaway v1 version now would mean building it twice.

## Audit findings (informing scope)

Full parity audit against v2's 13 real sidebar sections vs. v1's 15 existing tabs:

| v2 section | v1 status | Action |
|---|---|---|
| Dashboard, Vehicles, Fuel, Inspections, Personnel, Dash Cameras, Analysis Forms | Already covered by existing v1 tabs | No change |
| Reports | **Not actually v2-exclusive** — calls the same endpoints as v1's `FleetAnalyticsTab.tsx`, just re-skinned | No change |
| Work Orders | **v1 has zero Work Orders UI.** v2's `WorkOrdersRoute.tsx` is the *only* place a work order can be created today | New v1 tab (critical — no-regression item) |
| Vendors | v1 never had a vendor list page | New v1 tab |
| Service (fleet-wide maintenance) | v1 only has per-vehicle maintenance (`FleetCostsTab`), never a cross-vehicle list; no fleet-wide backend endpoint exists either — v2 does a client-side fan-out over `GET /fleet/{id}/maintenance` | New v1 tab, port the fan-out logic |
| Insights | Backed by dedicated `/api/fleet-viz/*` routes; genuinely unbuilt for v1 | Deferred to PR 7-9 sub-project |

`FleetioConflictBadge` (`client/src/components/FleetioConflictBadge.tsx`) is already used outside v2 (Admin health tab `AdminFleetioHealthTab.tsx`), reading `GET /api/fleetio/conflicts?table=<table>&ids=...`. It has no v2-specific dependencies.

`apiFetchV2`/`useFleetV2Audit` (v2's fetch-failure audit-emit wrapper) and its consumer `AdminFleetV2HealthTab.tsx` are v2-exclusive and were always scoped to be deleted alongside v2 (the component's own doc comment says "Removed in PR 7'd post-soak"). Nothing in v1 depends on them; no replacement is being built.

## Design

### 1. Routing (`client/src/App.tsx`)

Current (lines ~547-558):
```tsx
const FleetPage = lazyRetry(() => import('./pages/fleet'));
const FleetShell = lazyRetry(() => import('./pages/fleet/v2/FleetShell'));
...
<Route path="/fleet/v2/*" element={<RouteErrorBoundary><FleetShell /></RouteErrorBoundary>} />
<Route path="/fleet/*" element={<RouteErrorBoundary><FleetShell /></RouteErrorBoundary>} />
<Route path="/fleet-legacy" element={<RouteErrorBoundary><FleetPage /></RouteErrorBoundary>} />
```

Change to:
```tsx
const FleetPage = lazyRetry(() => import('./pages/fleet'));
...
<Route path="/fleet/*" element={<RouteErrorBoundary><FleetPage /></RouteErrorBoundary>} />
```

Remove the `FleetShell` lazy import entirely.

### 2. Deletion

- `client/src/pages/fleet/v2/` — entire tree (shell, routes, hooks, vehicleDetail, all `__tests__` subdirectories).
- `client/src/types/fleetV2Audit.ts`.
- `client/src/pages/admin/AdminFleetV2HealthTab.tsx` + `client/src/pages/admin/__tests__/AdminFleetV2HealthTab.test.tsx` + its import/mount in `AdminPage.tsx` (~lines 66-67, 1153, 1157). `AdminFleetioHealthTab` (no "V2") stays — it's shared, generic Fleet.io health monitoring, not v2 UI-specific.

Grep sweep before deletion (verification step, not a design decision): confirm no remaining reference to `/fleet/v2`, `/fleet-legacy`, `FleetShell`, `apiFetchV2`, or `useFleetV2Audit` anywhere outside the files being deleted.

### 3. Three new fleet-wide tabs

Added as new `viewMode` values in `client/src/pages/fleet/FleetPage.tsx` (currently `'dashboard' | 'analysis'`, `FleetPage.tsx:126`), each a new top-level tab button next to the existing Dashboard/Analysis toggle, each following the same shape as the existing `FleetAnalyticsTab`/`FleetAnalysisFormsTab` mount pattern (imported directly into `FleetPage.tsx`, fleet-wide — no vehicle selection required).

- **`client/src/pages/fleet/tabs/FleetWorkOrdersTab.tsx`** — list + create. Calls `GET /api/work-orders`, `GET /api/work-orders/stats`, `POST /api/work-orders`, `GET /api/fleet?limit=500` (vehicle labels for the picker), `GET /api/fleetio/conflicts?table=work_order&ids=...` (conflict badges per row). Table follows the standard v1 dense-table convention (9px header, 11px rows — see `CLAUDE.md` Design tokens), not v2's pill badges. Create flow ships in this PR (it is the sole remaining path to create a work order once v2 is deleted): a new `WorkOrderFormModal.tsx` under `client/src/pages/fleet/modals/`, matching the existing `MaintenanceFormModal`/`FuelLogModal` pattern.
- **`client/src/pages/fleet/tabs/FleetVendorsTab.tsx`** — list from `GET /api/fleet/fuel/vendors`. Read-only for this PR (matches v2's Vendors section, which was also read-only).
- **`client/src/pages/fleet/tabs/FleetServiceTab.tsx`** — fleet-wide maintenance list. No fleet-wide backend endpoint exists, so this ports v2's client-side fan-out approach: a new shared hook `client/src/pages/fleet/hooks/useFleetWideFanOut.ts` (stripped of v2-only bits — no `useFleetV2View`, no `apiFetchV2`, plain `apiFetch` instead), fanning out `GET /fleet/{id}/maintenance` per active vehicle.

### 4. Per-vehicle Work Orders visibility

Rather than adding a 14th entry to `FleetDetailPanel.tsx`'s `DetailTab` union (currently 13 values), fold a small "Open Work Orders" section into the existing `FleetCostsTab.tsx`: a compact list (status, type, opened date) reading `GET /api/work-orders?vehicle_id=...&limit=100`, linking out to the new fleet-wide Work Orders tab pre-filtered (`?vehicle_id=`) to that vehicle. Keeps the per-vehicle tab bar from growing for what is fundamentally a summary view; full detail lives in the fleet-wide tab.

### 5. Conflict badges

Add `FleetioConflictBadge` to:
- `FleetOverviewTab.tsx` (table: `fleet_vehicles`)
- `FleetFuelTab.tsx` (table: `fleet_fuel_log`)
- `FleetCostsTab.tsx` (table: `fleet_maintenance`)

Same `GET /api/fleetio/conflicts?table=<table>&ids=...` pattern already used in `AdminFleetioHealthTab.tsx` and (pre-deletion) v2's route components. No new backend work.

### 6. Testing

- New Vitest unit tests for the three new tab components and the new `WorkOrderFormModal` (if built), following the existing pattern of component tests elsewhere in `client/src/` (e.g. `client/src/components/__tests__/FleetioConflictBadge.test.tsx`) — v1's `tabs/` directory has no existing `__tests__` convention to match, so this establishes one going forward, scoped to just these new files (not a retrofit of the other 15 tabs).
- Manual dev-server verification: load `/fleet`, confirm the v1 UI renders, exercise the three new tabs (Work Orders create + list, Vendors list, Service list), confirm conflict badges render where wired, confirm `/fleet/v2` and `/fleet-legacy` now 404 or fall through to the app's generic not-found route.
- No Worker-side test changes — backend is untouched.

## Out of scope (explicitly deferred, already sequenced)

- **PR 6 — Inspections + Issues**: inspection templates, per-item photos, auto-issue creation on failed inspection item, filling in the Issues tab.
- **Documents + Parts**: per-vehicle document uploads, parts inventory subsystem.
- **PR 7-9 — Dashboards/viz**: KPI ribbon, vehicle dossier, fleet map, MPG-by-officer, PM Gantt, work-order Sankey, saved views.
- **PR 3 Advanced fields**: ref-table-backed "Advanced" sections for vehicle/fuel forms — confirmed never built in v1 or v2; independent future work, not caused by this swap.

## Risk register

| Risk | Mitigation |
|---|---|
| v2 deletion misses a stray reference (broken import, dead link) | Grep sweep (Section 2) before deletion; `client-typecheck` + `client-build` CI gates catch broken imports |
| Work Orders create flow regresses (only creation path in the app) | Manual verification step explicitly exercises create before considering this PR done |
| Fleet-wide Service fan-out is slow for large fleets (same limitation v2 had) | Inherited, not introduced, by this PR — no fleet-wide maintenance endpoint exists yet; a real aggregate endpoint is future work if this proves too slow in practice |
| New tabs don't match v1's dense-table visual convention | Explicit design constraint (Section 3); code review checks against `CLAUDE.md` Design tokens |

## References

- [`docs/superpowers/specs/2026-06-21-fleetio-integration-design.md`](2026-06-21-fleetio-integration-design.md) — parent 9-PR program
- [`docs/superpowers/specs/2026-06-21-fleet-manager-ui-fleetio-style-design.md`](2026-06-21-fleet-manager-ui-fleetio-style-design.md) — original v1→v2 cutover spec (routing decision reversed by this spec)
- [`docs/superpowers/specs/2026-07-13-fleet-v2-cleanup-batch-design.md`](2026-07-13-fleet-v2-cleanup-batch-design.md) — most recent v2-era maintenance work, now moot
- `[[feedback-use-pr-flow-not-direct-push]]` — every PR branches off `origin/main`, `gh pr create`, user reviews & merges, CI deploys
