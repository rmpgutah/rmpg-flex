# Fleet v2 Cleanup Batch — Design

**Date:** 2026-07-13
**Scope:** Six small, independent, low-risk fixes in the already-built sections of Fleet Manager v2 (`client/src/pages/fleet/v2/`), surfaced by an audit. No new features, no schema changes.

## Background

Fleet v2 mirrors Fleet.io and is built in phases (see `Sidebar.tsx`/`FleetShell.tsx`). Several sections are done (Dashboard, Vehicles, Fuel, Service, Work Orders, Inspections, Vendors, Reports, Personnel, Dash Cameras, Analysis Forms, Insights). An audit of those sections found six concrete, fixable issues. A seventh, larger finding — the Activity tab being fully non-functional because `src/routes/fleet.ts` never writes `audit_log` rows for vehicle entities — is explicitly **out of scope** here and will get its own design.

## Items

### 1. Raw `apiFetch` → `apiFetchV2` in 6 spots
`apiFetchV2` (in `client/src/pages/fleet/v2/hooks/apiFetchV2.ts`) wraps fetch failures into a `FLEET_V2_API_ERROR` audit row, which feeds the admin health tab's "API errors (24h)" metric. Six call sites in the audited sections still use the raw `apiFetch` from `client/src/hooks/useApi.ts`, so their failures are invisible to that metric:
- `vehicleDetail/OverviewTab.tsx` (primary data fetch)
- `vehicleDetail/FuelTab.tsx` (conflicts-badge fetch)
- `vehicleDetail/ServiceTab.tsx` (conflicts-badge fetch)
- `routes/FuelEntriesRoute.tsx` (conflicts-badge fetch)
- `routes/ServiceRoute.tsx` (conflicts-badge fetch)
- `routes/WorkOrdersRoute.tsx` (conflicts-badge fetch)

**Fix:** swap the import and call to `apiFetchV2`, matching every sibling tab/route in the same directory. No behavior change beyond the audit-emit side effect on failure.

### 2. `WorkOrdersTab.tsx:79` missing `/g` flag
`r.status.replace('_', ' ')` only replaces the first underscore. Every sibling place that formats a status string uses `.replace(/_/g, ' ')` or `toDisplayLabel()`. Today's only multi-underscore status (`waiting_parts`) happens to have just one underscore, so this is latent, not yet visibly broken.

**Fix:** consolidate onto `toDisplayLabel()` (see item 3) rather than patching the regex in isolation.

### 3. Consolidate label formatting onto `toDisplayLabel()`
Three techniques exist across the audited scope for snake_case → Title Case:
- `toDisplayLabel()` — the project's canonical helper (`client/src/utils/formatters.ts`), already used in `ActivityTab.tsx`
- `.replace(/_/g, ' ').toUpperCase()` — in `VehicleDetailRoute.tsx` and `InsightsRoute.tsx`
- unguarded `.replace('_', ' ')` — in `WorkOrdersTab.tsx` (item 2)

**Fix:** replace all three call sites with `toDisplayLabel()`. This is the same standardization already done project-wide per `CLAUDE.md`'s Phase 5 log entry — Fleet v2 just missed that sweep since these sections were built after/alongside it.

### 4. `CostsTab.tsx` silent partial failure
`CostsTab.tsx:16-34` fetches 5 cost-category endpoints via `Promise.allSettled`. If one rejects, that category is silently omitted with no visual cue — unlike `WorkOrdersTab.tsx`, which shows an explicit error banner on fetch failure.

**Fix:** track which categories failed and render a small inline banner (same visual pattern as `WorkOrdersTab.tsx`'s `err` banner) listing which cost category(ies) couldn't load, without blocking display of the categories that did succeed.

### 5. Remove dead duplicate backend routes in `src/routes/fleet.ts`
Two route pairs query the same table with near-identical SQL, but only one of each pair is actually called by the client:
- `GET/POST /:id/damage` (unused) vs `GET/POST /:id/damage-reports` (used by `DamageTab.tsx`)
- `GET /:id/recalls` (unused) vs `GET /recalls?vehicle_id=` (used by `RecallsTab.tsx`)

**Fix:** delete the two unused route handlers (`/:id/damage`, `/:id/recalls`). Confirm via grep across `client/src/` that nothing references them before deleting.

### 6. Tighten `apiFetchV2.ts:29` status-code regex fallback
When `err.status` isn't set, the fallback regex `/\b(\d{3})\b/` scans the raw error message for any 3-digit number, which could misread an embedded ID or mileage value as an HTTP status.

**Fix:** only apply the fallback regex when the error message contains an explicit status marker (e.g. immediately following the word "status" or a leading digit-space pattern like `"404 Not Found"`), rather than matching any bare 3-digit number anywhere in the string. If no such marker is found, leave status undefined rather than guessing.

## Testing

- No new test infra needed. `apiFetchV2.ts` and `formatters.ts` already have existing unit test coverage (`tests/roboflowAlpr.test.ts`-style Vitest suites for client utils) — extend those with cases for the tightened regex (item 6) and confirm `toDisplayLabel()` handles the status strings currently passed to it in the 3 consolidated call sites (item 3).
- Manual verification: load each touched route/tab in the dev server, confirm no visual regression, and confirm the CostsTab banner appears when a category endpoint is forced to fail (temporarily point one URL at a 404 during manual testing, revert after).

## Out of scope

- Activity tab / `audit_log` writer gap (separate design, larger effort — touches every vehicle CRUD path in `fleet.ts`).
- Any new features, schema changes, or migrations.
