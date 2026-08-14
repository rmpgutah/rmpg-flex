# Process Server — Map System Fix & Config Panel Rebuild

**Date:** 2026-08-13
**Scope:** Both serve map surfaces (ServeIntakeMap + Dispatch overlay) and the AdminServeManagerTab configuration panel
**Approach:** Option B — shared map utility foundation + config rebuild

---

## 1. Shared Map Utility Layer

### Problem

`ServeIntakeMap.tsx` and `useMapboxServeJobs.ts` both implement the same visual language (priority-colored markers, cluster badges, urgency rings, serve-job popups) with two independent, diverging codebases. Bugs fixed in one surface do not carry to the other.

### Solution

Create `client/src/utils/serveMapUtils.ts` as the single source of truth for all serve-map visual logic. Both surfaces become thin consumers.

**Exports:**

```ts
buildServeJobMarkerEl(job: ServeJob): HTMLElement
// Priority-colored circle, business/individual icon, urgency pulse ring (red <24h, amber <72h),
// notation corner dot when job has active location notes.

buildServeClusterEl(count: number, dominantPriority: ServeJob['priority']): HTMLElement
// Cluster bubble with job count and dominant priority color.

serveJobPopupHTML(job: ServeJob, opts?: { showAddToRoute?: boolean }): string
// Shared popup inner HTML — recipient name, case number, client, document type,
// address, status badge, deadline (with overdue highlight), "Open Job" link,
// optional "Add to Route" button. Identical output on both surfaces.

addServeJobLayer(
  map: mapboxgl.Map,
  jobs: ServeJob[],
  sourceId: string,
): void
// Adds or updates a GeoJSON source + circle layer + label layer.
// Idempotent: calls safeRemoveLayer/safeRemoveSource before re-adding.

removeServeJobLayer(map: mapboxgl.Map, sourceId: string): void
// Safe teardown. No-ops if source/layer absent.
```

**Layer spec (GeoJSON):**

| Layer | Type | Paint |
|---|---|---|
| `${sourceId}-circle` | circle | radius 7, priority-color fill, dark stroke, 85% opacity |
| `${sourceId}-label` | symbol | case number text, visible at zoom ≥ 12 |

Priority color map (shared constant, no duplication):
- `urgent` → `#ef4444`
- `rush` → `#f97316`
- `normal` → `#3b82f6`
- `routine` → `#6b7280`

---

## 2. ServeIntakeMap Fixes

### 2a. Missing Jobs (endpoint path mismatch)

`ServeIntakeMap` calls `GET /serve-intake/map-items`. No `/serve-intake` mount exists in the Worker — the correct path is `/process-server` (serve.ts). The component will be updated to call `GET /process-server?include_coords=1&status=pending,in_progress,attempted` (adding a query flag so the list endpoint returns only geocoded jobs in a lightweight shape). If a dedicated `/map-items` route is warranted for performance, it is added to `serve.ts`; otherwise the existing list endpoint is reused with the flag.

Same audit for `GET /serve-intake/location-notes` → correct path TBD during implementation (likely `/process-server/location-notes` or a serve-queue endpoint).

### 2b. Marker Duplicates

The current render loop calls `new mapboxgl.Marker()` per job and pushes to `markersRef` but never clears the ref before the next effect run. Fix: call `markersRef.current.forEach(m => m.remove()); markersRef.current = [];` at the top of the marker effect, identical to the pattern in `ServeRoutePlanner`.

### 2c. Performance — GeoJSON Layer for Base Dots

Replace the per-job `new mapboxgl.Marker()` loop with `addServeJobLayer()` from `serveMapUtils` for all unselected/background jobs. Individual `mapboxgl.Marker` instances are reserved only for the selected/highlighted job (so it can render above the layer and show the urgency ring). Clustering uses Mapbox's native `cluster: true` source option instead of the manual grid bucketing — this scales to large queues without DOM thrash.

### 2d. Shift-Drag Rectangle Select

The rectangle select binds `mousedown` on the map container but does not call `map.dragPan.disable()` during the selection gesture. Mapbox's own drag-pan fires concurrently, panning the map while the box is being drawn. Fix:

```ts
map.on('mousedown', (e) => {
  if (!e.originalEvent.shiftKey) return;
  map.dragPan.disable();
  // ... draw box ...
});
map.on('mouseup', () => {
  map.dragPan.enable();
  // ... finalize selection ...
});
```

### 2e. GPS Trail Not Drawing

`GET /process-server/:id/gps-trail` returns a coordinate array. The LineString layer add fires synchronously after the fetch resolves, but the Mapbox style may not be loaded yet (especially on a fresh open). Fix: wrap in `whenStyleReady(map, () => { ... })` — the same guard used in `ServeRoutePlanner`'s return-leg rendering.

### 2f. Drive-Time Preview — Live GPS Feed

The current right-click workaround sets a simulated position. Replace with `useGpsTracking({ upload: false })` (the shared app-wide GPS tracker, same as `ServeRoutePlanner`). The officer's real position anchors the preview automatically; right-click remains as a manual override for supervisors planning from a desk.

---

## 3. useMapboxServeJobs Fixes (Dispatch Map Overlay)

### 3a. Missing Jobs (endpoint path)

The hook calls `GET /serve/active-routes`. The backend mounts this route at `/process-server/active-routes`. Fix: update the `apiFetch` path. Verify the response includes `recipient_lat` / `recipient_lng` on each job object (add to the SELECT if missing).

### 3b. Layer Conflict / Duplicate Source Error

Hardcoded source IDs (`rmpg-serve-jobs-circle`, `rmpg-serve-jobs-label`) collide on remount (tab switch, map reload). Fix: replace manual `map.addSource`/`map.addLayer` calls with `addServeJobLayer` from `serveMapUtils`, which calls `safeRemoveSource`/`safeRemoveLayer` before adding. The cleanup effect calls `removeServeJobLayer`.

### 3c. Popup

Replace the inline HTML string with `serveJobPopupHTML(job, { showAddToRoute: true })` from `serveMapUtils`.

### 3d. Stale Data — Polling

Add a 60-second polling interval to refresh the job list. Pattern mirrors the unit overlay polling in `ServeIntakeMap`:

```ts
useEffect(() => {
  const id = setInterval(fetchJobs, 60_000);
  return () => clearInterval(id);
}, []);
```

Cleanup cancels the interval and calls `removeServeJobLayer` on unmount.

---

## 4. Config Panel Rebuild

### 4a. Migration

Add `0217_serve_config_fields.sql`:

```sql
ALTER TABLE serve_nudge_settings ADD COLUMN mileage_rate REAL DEFAULT 0.67;
ALTER TABLE serve_nudge_settings ADD COLUMN business_hours_start TEXT DEFAULT '08:00';
ALTER TABLE serve_nudge_settings ADD COLUMN business_hours_end TEXT DEFAULT '20:00';
ALTER TABLE serve_nudge_settings ADD COLUMN business_hours_days TEXT DEFAULT '[1,2,3,4,5]';
ALTER TABLE serve_nudge_settings ADD COLUMN auto_geocode_on_intake INTEGER DEFAULT 1;
ALTER TABLE serve_nudge_settings ADD COLUMN geocode_confidence_min REAL DEFAULT 0.6;
```

`business_hours_days` is stored as a JSON integer array (SQLite has no array type); the route parses/serializes it with `JSON.parse`/`JSON.stringify`.

### 4b. Backend — `GET/PUT /process-server/assignments/settings`

Extend the GET response and PUT handler to include all six new fields alongside the existing five. The PUT uses `COALESCE(NULLIF(?, ''), existing)` for text fields and direct binding for numerics. Returns the full updated row so the client can round-trip without a second GET.

### 4c. `ServeRoutePlanner` — Mileage Rate

Remove the hardcoded `const IRS_MILEAGE_RATE = 0.67`. `ServePage` fetches the settings once on mount and passes `mileageRate` as a prop to `ServeRoutePlanner`. Falls back to `0.67` if the fetch fails or the prop is absent.

### 4d. `serveQueueEnhanced.ts` — Business Hours

`POST /serve-queue/schedule-attempt` already enforces business hours but uses hardcoded `08:00`–`20:00` Mon–Fri. Replace with a `getServeConfig(db)` helper that reads `serve_nudge_settings` and returns the parsed config. Cache per-request (read once at route start, pass down).

### 4e. Admin UI — AdminServeManagerTab.tsx

Reorganize into four collapsible sections. Each section has its own **Save** button backed by the same `PUT` endpoint (partial updates — only the section's fields are sent):

**Section 1 — Integration**
- ServeManager API key (password input, Save / Clear / Test)
- Auto-poller: enabled toggle, poll interval slider (60–1800 s), target client input, auto-create dispatch calls toggle
- Sync controls: Incremental Sync / Full Sync buttons, sync history table (last 10)

**Section 2 — Route & Mileage**
- Mileage rate (decimal input, USD/mi, IRS note)
- Business hours: start time picker, end time picker
- Active days: day-of-week checkbox row (Su M Tu W Th F Sa)

**Section 3 — Notifications**
- Deadline approaching threshold (hours, number input)
- Diligence gap (days)
- Unassigned window (hours)
- Re-notify interval (hours)
- Supervisor email digest toggle

**Section 4 — Intake Rules**
- Auto-geocode on intake toggle
- Geocode confidence minimum (0.0–1.0 slider with numeric display)

Each section shows a green "Saved" badge for 3 seconds after a successful PUT and an inline error message on failure. No full-page reload required.

---

## 5. File Changes Summary

| File | Change |
|---|---|
| `client/src/utils/serveMapUtils.ts` | **New** — shared marker/cluster/popup/layer utilities |
| `client/src/components/serve/ServeIntakeMap.tsx` | Fix endpoint paths, marker cleanup, layer approach, drag-pan guard, GPS trail guard, live GPS feed |
| `client/src/hooks/useMapboxServeJobs.ts` | Fix endpoint path, layer conflict, popup, polling |
| `client/src/components/serve/ServeRoutePlanner.tsx` | Load mileage rate from settings instead of hardcoded const |
| `client/src/pages/admin/AdminServeManagerTab.tsx` | Reorganize into 4 sections, add 6 new fields, per-section save |
| `src/routes/serve.ts` | Extend GET/PUT settings to include new fields; add `/map-items` route if needed |
| `src/routes/serveQueueEnhanced.ts` | Replace hardcoded business hours with `getServeConfig()` |
| `migrations/0217_serve_config_fields.sql` | **New** — 6 new columns on `serve_nudge_settings` |

---

## 6. Testing

- `client/src/utils/__tests__/serveMapUtils.test.ts` — unit tests for `buildServeJobMarkerEl`, `serveJobPopupHTML`, `addServeJobLayer`/`removeServeJobLayer` (jsdom + mock mapboxgl)
- `client/src/hooks/__tests__/useMapboxServeJobs.test.ts` — existing test updated: verify correct endpoint path, layer cleanup on unmount, polling setup
- `tests/serveConfig.test.ts` — Worker unit tests: GET/PUT round-trips for all 11 settings fields, `getServeConfig` defaults when row absent
- Manual: open ServeIntakeMap with jobs in queue → markers appear; switch to Dispatch map → overlay appears within 60 s; open AdminServeManagerTab → all 4 sections load, each saves independently
