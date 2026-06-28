# Fleet Manager UI — Fleet.io-style Layout — Design Spec

**Date**: 2026-06-21
**Status**: Approved (brainstormed in-session with operator)
**Owner**: Christopher Zamora (operator-owner)
**Implementation**: 3-PR program (PR 7'a / 7'b / 7'c) within the 9-PR Fleet.io program
**Parent spec**: [`docs/superpowers/specs/2026-06-21-fleetio-integration-design.md`](2026-06-21-fleetio-integration-design.md)

---

## Goal

Replace the existing `/fleet` page (~9,118 lines across 18 files, currently a 14-tab single-page UI) with a Fleet.io-style two-pane shell — left sidebar of sections + right work area — so an operator who uses both RMPG and Fleet.io has matching muscle memory across the two systems. Preserve **every** field, endpoint, and feature already in RMPG; zero data loss; zero regression.

## Non-goals

- **No schema changes.** No migrations, no new tables, no column additions in this work.
- **No new backend endpoints.** Every `/api/fleet/*` endpoint the current UI calls is reused as-is.
- **No filling of empty Fleet.io sections** (Work Orders, Issues, Documents, Parts) — those land in PR 5/6 or Phase 2; here they show styled empty states + deep-links to Fleet.io.
- **No mobile field-UI changes.** Mobile has its own routes (`/mobile/*`, `/field/*`) — desktop-only here.
- **No theme changes.** Uses existing Spillman steel-blue tokens + `brand-400` gold per `client/src/styles/theme-palettes.css`. No hardcoded hex.
- **No production-data rewrites.** Zero scripts that touch live D1 rows.

## Decisions locked in brainstorming

1. **Mirror depth**: IA-mirror Fleet.io (sidebar + vehicle tabs). RMPG-unique sections (Personnel, Dash Cameras, GPS Tracking, Analysis Forms) live below a gold divider, marked with a small gold dot.
2. **Rollout**: cutover replacement of `/fleet`, **with** a `/fleet-legacy` escape hatch surviving for ≥7 days post-cutover.
3. **Empty sections**: Work Orders, Issues, Documents, Parts each get a styled empty-state card with a "View in Fleet.io →" deep-link.

## Section 1 — Information architecture & sidebar

Single `/fleet` route renders a two-pane layout: left sidebar (sections + per-section item count) and right work area (current section's content).

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Top bar — RMPG chrome (steel-blue) — Account: RMPG  •  Search  •  Notifications│
├──────────────────┬─────────────────────────────────────────────────────────────┤
│ 📊 Dashboard     │                                                             │
│ 🚗 Vehicles  18  │    Right work area (route-driven sub-page)                  │
│ ⛽ Fuel Entries  │                                                             │
│ 🔧 Service       │                                                             │
│ 📋 Work Orders ◯ │                                                             │
│ ✅ Inspections   │                                                             │
│ ⚠️ Issues      ◯ │                                                             │
│ 📄 Documents   ◯ │                                                             │
│ 🏷  Parts      ◯ │                                                             │
│ 🏪 Vendors       │                                                             │
│ 📊 Reports       │                                                             │
│ ────────────●─── │                                                             │
│ RMPG ONLY        │                                                             │
│ ────────────●─── │                                                             │
│ 👥 Personnel  ●  │                                                             │
│ 📹 Dash Cameras● │                                                             │
│ 📍 GPS Tracking● │                                                             │
│ 📝 Analysis Forms●│                                                            │
└──────────────────┴─────────────────────────────────────────────────────────────┘
```

### Sidebar item details

| Section | Source data | Status today |
|---|---|---|
| 📊 **Dashboard** | KPI ribbon: in-service / in-shop / overdue PMs / monthly fuel spend / monthly cost-per-mile. Pulls `/api/fleet/analytics`, `/api/fleet/notifications`, `/api/fleet/overdue-inspections`. | ✅ |
| 🚗 **Vehicles** | `/api/fleet` list → click → vehicle detail (Section 2). | ✅ |
| ⛽ **Fuel Entries** | Fleet-wide list from `/api/fleet/fuel`. | ✅ |
| 🔧 **Service** | Fleet-wide list from `fleet_maintenance`. | ✅ |
| 📋 **Work Orders** | Empty state → "Coming in PR 5" + Fleet.io deep-link. | ◯ |
| ✅ **Inspections** | Fleet-wide list from `/api/fleet/inspections`. | ✅ |
| ⚠️ **Issues** | Empty state → "Coming in PR 6" + Fleet.io deep-link. | ◯ |
| 📄 **Documents** | Empty state → Phase 2 + Fleet.io deep-link. | ◯ |
| 🏷 **Parts** | Empty state → Phase 2 + Fleet.io deep-link. | ◯ |
| 🏪 **Vendors** | `fleet_fuel_vendors` (unified to `ref_vendors` in PR 2). | ✅ |
| 📊 **Reports** | `FleetAnalyticsTab` content refactored into report cards. | ✅ |
| 👥 **Personnel** *(RMPG-only)* | `FleetPersonnelTab` — assignments + driver records. | ✅ |
| 📹 **Dash Cameras** *(RMPG-only)* | `FleetDashCamTab` — dashcam units + footage browser. | ✅ |
| 📍 **GPS Tracking** *(RMPG-only)* | `FleetGpsTab` + `FleetGpsHistoryTab` (live + history). | ✅ |
| 📝 **Analysis Forms** *(RMPG-only)* | `FleetAnalysisFormsTab` — custom inspection/analysis forms. | ✅ |

### Visual treatment of the RMPG-only divider

Thin gold rule + small dot + "RMPG ONLY" small-caps gold label. Each RMPG-only sidebar item carries a small gold dot suffix. Uses `brand-400` token, no hardcoded hex.

## Section 2 — Vehicle detail page

**URL:** `/fleet/vehicles/:id`

Sticky header with vehicle identity + status badge + quick actions, then horizontal tab bar mirroring Fleet.io's vehicle-page tabs, then tab content.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ◀ Back to Vehicles                                                         │
│  ┌──────┐  Unit 12 • ABC-1234 (UT)         [IN SERVICE ▼]   ⋮  ✏️ Edit     │
│  │ 📷  │  2022 Ford Explorer Police                                          │
│  │photo │  VIN 1HGBH41JXMN109186 • 47,283 mi • Last seen 2 min ago          │
│  └──────┘  Assigned: Officer Jones                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ Overview │ Service │ Inspections │ Fuel │ Issues ◯ │ Work Orders ◯ │ Docs ◯ │
│ Costs │ Recalls │ Damage │ Tires │ Assignments │ Activity                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Vehicle-detail tab list (order = Fleet.io first, RMPG-extras after)

| Tab | Source | Notes |
|---|---|---|
| **Overview** | `fleet_vehicles` + key gauges | KPI cards: current mileage, next-service-in-X-miles, fuel anomaly count, last inspection date, open issues count. Photo + spec list. From `FleetOverviewTab`. |
| **Service** | `fleet_maintenance` | Timeline of service entries: date, vendor, line items, cost. From existing modals + maintenance data. |
| **Inspections** | `vehicle_inspections` | List with pass/fail badge per inspection. From `FleetInspectionsTab`. |
| **Fuel** | `fleet_fuel_log` | Per-vehicle MPG chart + entries table + fuel-card panel. Combines `FleetFuelTab` + `FleetFuelCardsTab`. |
| **Issues** ◯ | empty state | Per-vehicle subset of Issues (PR 6); deep-link to Fleet.io. |
| **Work Orders** ◯ | empty state | Per-vehicle WO list (PR 5); deep-link to Fleet.io. |
| **Documents** ◯ | empty state | Per-vehicle uploads (Phase 2); deep-link to Fleet.io. |
| **Costs** | `FleetCostsTab` | Stacked breakdown: fuel + maintenance + parts + insurance over time. |
| **Recalls** | `FleetRecallsTab` | Open + closed recalls. |
| **Damage** | `FleetDamageTab` | Photos + reports. |
| **Tires** | `FleetTiresTab` | Tire history + tread depth. |
| **Assignments** | `FleetAssignmentsTab` | Officer-to-vehicle assignment history. |
| **Activity** *(NEW)* | `audit_log` scoped to `vehicle_id` | Chronological feed of who-changed-what. Uses existing `audit_log` table — no schema change. |

**Tab overflow rule**: if the tab bar exceeds available width, the excess collapses into "More ▼". The 7 Fleet.io tabs always stay visible; RMPG-specific tabs (Costs/Recalls/Damage/Tires/Assignments/Activity) collapse first.

**Status changer**: the `IN SERVICE ▼` badge opens a dropdown (In Service / Maintenance / Out of Service / Retired). Writes to `fleet_vehicles.status`; emits a Fleet.io outbound event via the existing seam (PR 4 wires real outbound — until then, the write itself succeeds, the FI sync is a no-op).

**Edit button**: opens the existing `VehicleFormModal` (640 lines) unchanged.

## Section 3 — Fleet-wide list pages

Each non-vehicle sidebar section (Fuel Entries, Service, Inspections, Vendors, Reports) is a flat list across all vehicles, with shared chrome.

### Shared layout (`<FleetListShell>`)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ⛽ Fuel Entries                                       + New Fuel Entry  ⤓  │
│                                                                              │
│  [Search]   [Vehicle ▼] [Date Range ▼] [Vendor ▼] [Fuel Type ▼]  reset      │
│  ──────────────────────────────────────────────────────────────────────────  │
│  Showing 1,247 of 3,891 entries  •  Sort: Date ▼                            │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ 2026-06-21 14:32  Unit 12  •  Maverik #5 SLC  •  12.4 gal @ $3.49   │   │
│  │                  $43.28  •  47,283 mi  •  full tank  •  MPG 18.2    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│  ◀ 1 2 3 ... 25 ▶                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

Common controls (every list page): search · filter chips (multi-select AND-combined) · sort · server-side pagination (50/page) · CSV export · "+ New" opens the section's existing modal.

### Per-section specifics

| Section | Data source | Columns | Section actions |
|---|---|---|---|
| **Fuel Entries** | `fleet_fuel_log` ⨝ `fleet_vehicles` | date, vehicle, vendor, gallons, $/gal, total, odometer, MPG | + New Fuel Entry; mark anomaly |
| **Service** | `fleet_maintenance` ⨝ vehicles | date, vehicle, service type, vendor, line-item count, total | + New Service Entry |
| **Inspections** | `vehicle_inspections` ⨝ vehicles | date, vehicle, template, pass/fail, photos, performed-by | + New Inspection; open photos |
| **Vendors** | `fleet_fuel_vendors` (→ `ref_vendors` after PR 2) | name, kind, city, contact, last used, YTD spend | + New Vendor |
| **Reports** | aggregations across all fleet tables | (card grid below) | per-card viz |

### Reports section (card grid)

Existing `FleetAnalyticsTab` (1,559 lines) refactored into report cards on a Reports landing page:

```
┌─────────────┬─────────────┬─────────────┐
│ Health      │ Maintenance │ Driver      │
│ Scores      │ Schedule    │ Performance │
├─────────────┼─────────────┼─────────────┤
│ Cost Trends │ Service     │ Combined    │
│             │ Alerts      │ Cost Trend  │
└─────────────┴─────────────┴─────────────┘
```

Each card → drill-in page with full chart + table. All existing endpoints preserved: `/fleet/health-scores`, `/fleet/maintenance-schedule`, `/fleet/driver-performance`, `/fleet/service-alerts`, `/fleet/cost-trends`, `/fleet/vehicle-lifecycle`, `/fleet/notifications`, `/fleet/overdue-inspections`, `/fleet/combined-cost-trend`, `/fleet/monthly-spend`, `/fleet/daily-gps-mileage`.

### Dashboard (default landing on `/fleet`)

KPI ribbon (live-updated via WS): vehicles in service, in maintenance, overdue PMs, monthly fuel spend, monthly cost-per-mile, open issues count (◯).

Below: 3 cards — **Upcoming Service** (next 7 days), **Recent Fuel Entries** (last 10), **Recent Inspections** (last 10). Each card has "View all →" to its full section.

## Section 4 — RMPG-only sections

| Section | Source | New surface | Existing data preserved |
|---|---|---|---|
| 👥 **Personnel** | `FleetPersonnelTab` (537 lines) | Table: Officer · Currently driving · License class · Cert expiry · Take-home · Recent activity. Click → officer's vehicle history page (cross-link to Officer Wallet). | All personnel data + endpoints. |
| 📹 **Dash Cameras** | `FleetDashCamTab` (172 lines) | Two-pane: dashcam units list → footage timeline. Integrates with ClearPathGPS / FlexCam. | `dashcam_videos`, `dash_cameras` data + [[project-flexcam-footage-program]] integration. |
| 📍 **GPS Tracking** | `FleetGpsTab` + `FleetGpsHistoryTab` (547 lines combined) | Inner tabs: **Live** (Mapbox positions, status-colored) and **History** (per-vehicle date-range playback). Reuses `useMapFleetVehicles`. | ClearPathGPS feed + [[project-clearpathgps-integration-auth]] work. |
| 📝 **Analysis Forms** | `FleetAnalysisFormsTab` (550 lines) | List of saved forms (left) → form viewer/editor (right). Once PR 6 ships inspection templates, this section's form library becomes the template source for Inspections. | All form data. |

### Cross-links between RMPG-only and Fleet.io-IA sections

| From → To | What it does |
|---|---|
| Personnel row → Vehicle detail · Assignments tab | "What was Officer Jones driving on 2026-06-15?" |
| Vehicle detail · Assignments tab → Personnel | Click officer name → their Personnel page |
| GPS Live map marker → Vehicle detail · Overview | Click pin → vehicle dossier |
| Vehicle detail · Overview → Dash Cameras | "Last seen 2 min ago" link → footage timeline |
| Analysis Forms → Inspections (PR 6+) | "Use as template" → saves as `inspection_templates` row |

## Section 5 — File structure, phasing

### New directory `client/src/pages/fleet/v2/`

```
client/src/pages/fleet/v2/
├── FleetShell.tsx              # two-pane layout: <Sidebar/> + <Outlet/>
├── Sidebar.tsx                 # IA sidebar with gold-divider + counts
├── shell/
│   ├── FleetListShell.tsx      # shared list-page chrome
│   ├── KpiRibbon.tsx           # live-updated KPI strip
│   ├── EmptyStateCard.tsx      # "Coming PR N" + Fleet.io deep-link
│   └── SectionHeader.tsx       # consistent page headers
├── routes/
│   ├── DashboardRoute.tsx
│   ├── VehiclesListRoute.tsx
│   ├── VehicleDetailRoute.tsx
│   ├── FuelEntriesRoute.tsx
│   ├── ServiceRoute.tsx
│   ├── WorkOrdersRoute.tsx     # empty state
│   ├── InspectionsRoute.tsx
│   ├── IssuesRoute.tsx         # empty state
│   ├── DocumentsRoute.tsx      # empty state
│   ├── PartsRoute.tsx          # empty state
│   ├── VendorsRoute.tsx
│   ├── ReportsRoute.tsx
│   ├── PersonnelRoute.tsx      # RMPG-only
│   ├── DashCamerasRoute.tsx    # RMPG-only
│   ├── GpsTrackingRoute.tsx    # RMPG-only
│   └── AnalysisFormsRoute.tsx  # RMPG-only
├── vehicleDetail/              # tab content
│   ├── OverviewTab.tsx
│   ├── ServiceTab.tsx
│   ├── InspectionsTab.tsx
│   ├── FuelTab.tsx
│   ├── IssuesTab.tsx           # empty state
│   ├── WorkOrdersTab.tsx       # empty state
│   ├── DocumentsTab.tsx        # empty state
│   ├── CostsTab.tsx
│   ├── RecallsTab.tsx
│   ├── DamageTab.tsx
│   ├── TiresTab.tsx
│   ├── AssignmentsTab.tsx
│   └── ActivityTab.tsx         # NEW
└── reports/                    # report card detail pages
    └── ... (one per /api/fleet/* analytics endpoint)
```

### Reused without modification

`components/VehicleFormModal.tsx`, `pages/fleet/modals/*.tsx`, `pages/fleet/components/GaugeRing.tsx`, `pages/fleet/components/MaintenanceMonitor.tsx`, `pages/fleet/utils/fleetFormatters.ts`, `hooks/useLiveSync.ts`, `hooks/useApi.ts`, `hooks/useIsMobile.ts`, `hooks/usePersistedState.ts`, `pages/map/hooks/useMapFleetVehicles.ts`, `components/ExportButton.tsx`, `components/PanelTitleBar.tsx`, `components/PrintButton.tsx`, `components/ConfirmDialog.tsx`.

### Routing change (`client/src/App.tsx`)

```tsx
// Replace:
<Route path="/fleet" element={<RouteErrorBoundary><FleetPage /></RouteErrorBoundary>} />

// With:
<Route path="/fleet/*" element={<RouteErrorBoundary><FleetShell /></RouteErrorBoundary>} />
```

`<FleetShell>` mounts a React Router child router internally.

### Deleted at cutover (after all verification passes)

- `client/src/pages/fleet/FleetPage.tsx` (1,753 lines)
- `client/src/pages/fleet/FleetDetailPanel.tsx` (504 lines)
- `client/src/pages/fleet/tabs/*.tsx` (14 files, ~5,200 lines)
- `client/src/components/VehicleDossier.tsx` (152 lines)

Net: **+~3,500 new lines, -~7,600 old lines.**

### Phasing — 3 PRs

| PR | Title | Scope |
|---|---|---|
| **PR 7'a** | `feat(fleet-v2): shell + sidebar + dashboard + vehicles list` | `client/src/pages/fleet/v2/` directory created; `<FleetShell>` + `<Sidebar>` + `<KpiRibbon>` + `<EmptyStateCard>` + `DashboardRoute` + `VehiclesListRoute` + `VehicleDetailRoute` with **Overview tab only**. New routes mounted at `/fleet/v2/*` (NOT replacing `/fleet`). `noindex` meta on all v2 pages. |
| **PR 7'b** | `feat(fleet-v2): vehicle detail tabs + fleet-wide list pages + reports` | All 13 vehicle-detail tabs (12 existing + Activity) + Fuel/Service/Inspections/Vendors fleet-wide pages + Reports cards. Still mounted at `/fleet/v2`. |
| **PR 7'c** | `feat(fleet-v2): RMPG-only sections + cutover` | Personnel/DashCameras/GpsTracking/AnalysisForms routes + cross-links + endpoint-coverage CI check + DELETE old FleetPage tree + flip `/fleet` to `<FleetShell>` + keep old at `/fleet-legacy` for ≥7 days. SW `CACHE_NAME` bump. Pre-drafted revert PR linked in body. |

### What's intentionally NOT in this work

- New data model — uses existing `fleet_vehicles`, `fleet_maintenance`, `fleet_fuel_log`, `vehicle_inspections` schemas as-is.
- New backend endpoints — uses existing `/api/fleet/*` exactly as they are.
- Filling Work Orders / Issues / Documents / Parts — those are PR 5/6 + Phase 2.
- Theme changes — uses existing Spillman steel-blue + brand-400 gold per CLAUDE.md.
- Mobile field UI changes — desktop-only.

## Section 6 — Defense-in-depth guardrails

Each guardrail is a concrete action with a success criterion. Anything in this section that fails blocks the PR.

### 6.1 Data loss in the database — eliminated by design

No migrations, no schema changes, no write-path modifications. UI-only.

| Guardrail | Mechanism |
|---|---|
| **No DDL in any PR 7' commit** | CI rule (new): `.github/workflows/fleet-ui-coverage.yml` fails if any `migrations/*.sql` is added in a PR labeled `area:fleet-ui` |
| **No write-path modifications** | Reviewer checklist: zero changes to `src/routes/fleet.ts`, `src/utils/fleet*.ts`, or any `INSERT`/`UPDATE`/`DELETE` SQL string |
| **D1 snapshot proof** | Operator confirms in PR 7'c comment thread that a D1 export exists ≤ 24h before merge (`npx wrangler d1 export rmpg-flex --remote --output backup.sql`) |

### 6.2 UI data loss — endpoint + field coverage

| Guardrail | Mechanism |
|---|---|
| **Endpoint-coverage CI check** | NEW `.github/workflows/fleet-ui-coverage.yml` diffs `grep -ohE "/api/fleet[a-z0-9/_-]*"` over old fleet code vs new v2 code. Non-empty set difference fails the PR. Active in 7'a/7'b/7'c. |
| **Field-coverage snapshot tests** | For each rebuilt tab, vitest seeds the same synthetic vehicle/fuel/inspection/maintenance fixture and mounts BOTH old and new tabs. Assert every accessible text/role node from the old tab appears in the new tab. Lives in `tests/fleet-v2-parity/`. |
| **Manual click-through checklist** | `docs/qa/2026-06-21-fleet-v2-manual.md` — all 18 vehicles × all tabs × all filters. Operator signs off in PR 7'c body with checked-off copy. Merge-blocker. |
| **`/fleet-legacy` escape hatch** | PR 7'c keeps old FleetPage mounted at `/fleet-legacy` for ≥7 days. If new UI is missing something, operator can grab it from there. Removed in a follow-up PR after soak. |

### 6.3 Regression in shared components & reuse paths

| Guardrail | Mechanism |
|---|---|
| **Reused-component contract test** | For each of 8 reused modals/components (VehicleFormModal, MaintenanceFormModal, FuelLogModal, InspectionFormModal, FleetCostFormModal, GaugeRing, MaintenanceMonitor, ExportButton), RTL test mounts it inside `<FleetShell>` with seeded data + asserts same open/save/close behavior. Lives in `tests/fleet-v2-reuse/`. |
| **Import-graph check** | Before deleting old FleetPage tree, `grep -r "from.*pages/fleet/\(FleetPage\|FleetDetailPanel\|tabs/Fleet\)" client/src/ src/` must return zero matches outside `client/src/pages/fleet/v2/`. CI-enforced. |
| **Modal-mount smoke test** | RTL opens every reused modal from a v2 route, fills + submits, asserts successful API call. |

### 6.4 Regression in WebSocket / live-sync channels

| Guardrail | Mechanism |
|---|---|
| **Channel inventory** | Before PR 7'a, audit every `useLiveSync(...)` call in old fleet tree, list channel names + payload shapes. Document in `docs/fleet-v2/live-sync-inventory.md`. |
| **Channel-parity test** | Each new Route component using live sync asserts same channel name is subscribed AND that a broadcast of the recorded payload triggers expected re-render. |
| **Server-side broadcast audit** | `src/routes/ws.ts` + any code broadcasting fleet channels: confirm targets don't include hard-coded component-instance IDs. Refactor to stable resource IDs if found. |

### 6.5 Regression in other pages that touch fleet data

| Guardrail | Mechanism |
|---|---|
| **Cross-import freeze** | Any file outside `client/src/pages/fleet/v2/` touched during PR 7' work must have a justification in PR body + a smoke test for the consuming page. |
| **MapPage smoke test** | RTL test mounts MapPage with seeded fleet vehicles, asserts vehicle markers render. `tests/cross-impact/map-fleet-markers.test.tsx`. Added in 7'a. |
| **Mobile field UI smoke test** | Mobile FieldOps page mounts + shows current vehicle assignment. `tests/cross-impact/mobile-vehicle.test.tsx`. |

### 6.6 Mobile / narrow-viewport regression

| Guardrail | Mechanism |
|---|---|
| **Viewport tests** | Each Route component has vitest with viewport `375x667` (iPhone SE) AND `1440x900`. Both must render without horizontal scroll; sidebar collapses to drawer below 768px. |
| **`useIsMobile` reuse** | Reuse existing hook; do NOT introduce new breakpoint convention. |

### 6.7 Print / PDF / Export regression

| Guardrail | Mechanism |
|---|---|
| **Export-button contract test** | RTL test in each list route clicks Export, asserts CSV download triggered with visible row count. |
| **PDF blank-form generation untouched** | `utils/pdf/v2/blankForms/__tests__/vehicleBlank.test.ts` snapshot must NOT change. If it does, treat as red flag. |
| **PrintButton mount test** | RTL test opens print preview from vehicle detail, confirms expected sections render. |

### 6.8 Cutover safety (PR 7'c specific)

| Guardrail | Mechanism |
|---|---|
| **Atomic flip** | Same commit deletes old FleetPage AND flips route in App.tsx. No interim broken state. |
| **`/fleet-legacy` escape hatch (≥7 days)** | See 6.2. |
| **Pre-drafted revert PR** | Before merging 7'c, open "Revert PR 7'c" PR in draft with exact revert diff. Comment URL on cutover PR. One click to revert if production issues surface. |
| **Cloudflare rollback path documented** | PR 7'c body: "Production rollback: Cloudflare dashboard → Workers → rmpg-flex → previous deployment → Rollback. ~30s." |
| **Service worker cache bump** | `client/public/sw.js` `CACHE_NAME` bumped in 7'c. Verified in cutover PR by grep diff. |
| **Soak period (≥7 days)** | PRs 7'a + 7'b live at `/fleet/v2` in production for ≥7 days before 7'c flips default. Operator + admin users test for that week. PR 7'c body documents who tested + what they found. |
| **`noindex` on /fleet/v2 during soak** | `<meta name="robots" content="noindex">` on every v2 page. Removed at cutover. |

### 6.9 Post-deploy monitoring

| Guardrail | Mechanism |
|---|---|
| **Page-view audit emit** | Each Route component emits `recordAudit({ action: 'FLEET_V2_VIEW', entityType: 'fleet_ui_page', details: { route, viewport } })` on mount. Mirrors to `flex_events`. Lets operator query: who's hitting v2, which routes, on what devices. Removed in PR 7'd (~1 month post-cutover). |
| **Console.error fail-fast in tests** | Vitest config adds `beforeEach` that fails the test if `console.error` was logged. Catches silent React warnings. |
| **API-error sentinel** | Wrap `apiFetch` calls in routes with try/catch that emits `recordAudit({ action: 'FLEET_V2_API_ERROR', details: { endpoint, status, message } })` on failure. |
| **`/admin/fleet-v2-health` temp page** | Admin-only, added in 7'a, removed in 7'd (~1 month post-cutover). Shows: unique v2 page-viewers / 24h, count of `FLEET_V2_API_ERROR` events, top 5 routes by view. |

### 6.10 Type / static safety

| Guardrail | Mechanism |
|---|---|
| **Zero `as any` in new code** | CI rule: `grep -rn "as any" client/src/pages/fleet/v2/` must return empty. Use `as unknown as T` only with comment justification. |
| **Strict event payload types** | Every `recordAudit` call's `details` typed against a `FleetV2AuditDetails` discriminated union — no untyped JSON. |
| **No magic strings for sidebar items** | Sidebar config is a `const SIDEBAR_SECTIONS: readonly SidebarItem[]` exported from `Sidebar.tsx`; routes derived from it, not duplicated. One source of truth. |

### 6.11 Updated risk register

| Risk | Severity | Likelihood (after mitigation) | Cross-ref |
|---|---|---|---|
| Tab silently drops a data field | High | Low | 6.2 |
| Reused modal breaks in new parent | Medium | Low | 6.3 |
| WS live-sync channel stale | Medium | Very low | 6.4 |
| Map / mobile cross-impact regression | High | Very low | 6.5 |
| PDF/Print/Export regression | Medium | Very low | 6.7 |
| Cutover lands a bug, can't roll back fast | High | Very low | 6.8 |
| Service worker serves stale chunks | High | Very low | 6.8 |
| Bug surfaces only under real usage | Medium | Low | 6.8 + 6.9 |
| Type system loosened to ship faster | Low | Very low | 6.10 |
| Migration accidentally introduced | High | Zero | 6.1 |

## Cross-references

- `[[project-fleetio-integration]]` — parent 9-PR program; this is PR 7' (substitutes for original PR 7).
- `[[project-d1-schema-drift-audit]]` — even though this work makes no schema changes, the post-merge live-D1 discipline still applies if any incidental migration is ever added (it shouldn't be).
- `[[feedback-use-pr-flow-not-direct-push]]` — every PR branches off `origin/main` → `gh pr create` → operator merges.
- `[[feedback-verify-main-compiles-after-stack-merge]]` — after each PR in the 7'a/b/c stack merges, verify main compiles before starting the next.
- `[[project-clearpathgps-integration-auth]]` — GPS Tracking RMPG-only section reuses the existing live integration.
- `[[project-flexcam-footage-program]]` — Dash Cameras RMPG-only section reuses the existing footage program.
