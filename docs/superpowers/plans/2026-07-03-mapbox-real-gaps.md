# Mapbox Real Gaps (Part 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up 5 genuinely-missing map overlays (Incidents, Coverage Gaps, Safety Zones, Call History, Tilequery "Identify") plus a Heatmap historical-mode switch, and build the one missing backend route (`repeat-addresses`) needed for a 6th overlay.

**Architecture:** Every overlay hook here is already fully built (`client/src/hooks/useMapbox{Incidents,CoverageGaps,SafetyZones,HistoryCalls,Tilequery}.ts`) — this plan only wires each into `client/src/pages/map/MapboxMapPage.tsx`'s existing `layerGroups` toggle registry (`MapOverlaysPanel`) and, for Repeat Addresses, adds the missing server route first.

**Tech Stack:** TypeScript, Hono (server route), Mapbox GL JS (client hooks, unchanged), D1 (new read-only aggregate query).

**Reference spec:** [docs/superpowers/specs/2026-07-03-mapbox-second-integration-cleanup-design.md](../specs/2026-07-03-mapbox-second-integration-cleanup-design.md), Part 2.

**Prerequisite:** none of this plan's tasks depend on the other two Mapbox plans (contract fixes / dead hook cleanup) — it can run independently, in any order relative to them.

---

## File Structure

- Modify: `src/routes/dispatch/aggregates.ts` — add `GET /repeat-addresses`.
- Modify: `client/src/pages/map/MapboxMapPage.tsx` — import + instantiate 5 hooks, add 6 `layerGroups` toggle entries (5 new + heatmap mode switch), wire a map click handler for the Identify tool.
- Modify: `client/src/hooks/useMapboxIncidents.ts` — fix the response-envelope bug (`data.data` not bare array).
- No new files. `useMapboxRepeatAddresses.ts` already exists client-side and needs no changes — only the missing server route blocks it today.

---

### Task 1: Add `GET /dispatch/repeat-addresses` backend route

**Files:**
- Modify: `src/routes/dispatch/aggregates.ts`
- Test: manual `wrangler d1 execute --local` sanity check (no Worker test harness exists for this file per CLAUDE.md)

- [ ] **Step 1: Add the route**

In `src/routes/dispatch/aggregates.ts`, add this new route near the other `/heatmap`/`/history-map` routes (after the `/history-map` handler, before `// ── Dashboard chart data supplements ──`):

```ts
// GET /dispatch/repeat-addresses?days=30&min_count=3&limit=200
// Locations with 3+ calls in the window — repeat-call hotspots for patrol
// planning. Groups by rounded lat/lng (matches the /heatmap convention just
// above) rather than raw location_address text, since address strings vary
// in formatting for the same physical location.
aggregates.get('/repeat-addresses', async (c) => {
  try {
    const daysRaw = Number(c.req.query('days') ?? 30);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.floor(daysRaw), 1), 365) : 30;
    const minCountRaw = Number(c.req.query('min_count') ?? 3);
    const minCount = Number.isFinite(minCountRaw) ? Math.max(1, Math.floor(minCountRaw)) : 3;
    const limitRaw = Number(c.req.query('limit') ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(1000, Math.max(1, Math.floor(limitRaw))) : 200;

    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        MAX(location_address) AS address,
        ROUND(latitude, 3)    AS latitude,
        ROUND(longitude, 3)   AS longitude,
        COUNT(*)              AS count,
        MAX(created_at)       AS last_call_at
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', ?)
      GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
      HAVING COUNT(*) >= ?
      ORDER BY count DESC
      LIMIT ?
    `, `-${days} days`, minCount, limit);

    return c.json({ addresses: rows, total: rows.length });
  } catch (err) {
    log.error('GET /dispatch/repeat-addresses failed', {}, err);
    return c.json({ addresses: [], total: 0 });
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual sanity check against local D1**

Run: `npm run migrate:local` (if not already up to date), then:

```bash
npx wrangler d1 execute rmpg-flex --local --command "SELECT ROUND(latitude,3) AS lat, ROUND(longitude,3) AS lng, COUNT(*) AS c FROM calls_for_service WHERE latitude IS NOT NULL AND longitude IS NOT NULL GROUP BY ROUND(latitude,3), ROUND(longitude,3) HAVING COUNT(*) >= 3 ORDER BY c DESC LIMIT 10"
```

Expected: returns rows without a SQL error (may return zero rows on a sparse local dataset — that's fine, this just confirms the query is syntactically valid against the real schema).

- [ ] **Step 4: Start the dev server and hit the route directly**

Run: `npm run dev` (in a separate terminal), then:

```bash
curl -s "http://localhost:8787/api/dispatch/repeat-addresses?days=365&min_count=1&limit=5" -H "Authorization: Bearer <a valid dev token>"
```

Expected: `{"addresses": [...], "total": N}` — a 200 with the envelope shape, not a 500. (Use `min_count=1` and a wide `days` window for this smoke test so a sparse local dataset still returns something.)

- [ ] **Step 5: Commit**

```bash
git add src/routes/dispatch/aggregates.ts
git commit -m "feat(dispatch): add GET /repeat-addresses for the map's Repeat Addresses layer"
```

---

### Task 2: Fix the Incidents envelope bug

**Files:**
- Modify: `client/src/hooks/useMapboxIncidents.ts:136-149`

`GET /api/incidents` returns `{ data: [...], pagination: {...} }` (confirmed in `src/routes/incidents.ts`), but the hook currently assumes a bare array.

- [ ] **Step 1: Fix `fetchIncidents`**

In `client/src/hooks/useMapboxIncidents.ts`, replace the `fetchIncidents` function body:

```ts
const fetchIncidents = useCallback(async (limit = 2000) => {
  if (!map) return;
  setLoading(true);
  try {
    const data = await apiFetch<{ data: Incident[]; pagination: unknown }>(`/incidents?limit=${limit}`);
    const incs = Array.isArray(data?.data) ? data.data : [];
    setIncidents(incs);
    whenStyleReady(map, () => { renderOnMap(incs, map); });
  } catch (err) {
    console.warn('[useMapboxIncidents] fetch failed:', err);
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);
```

(This replaces the old signature `fetchIncidents(days = 30, limit = 2000)` — the `days` param is dropped since `/api/incidents` has no date filter, only `status`/`officer_id`/`page`/`limit`; passing an unsupported param was a harmless no-op but misleading. If any caller passes a `days` arg, Task 5 below updates the one call site this plan adds.)

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useMapboxIncidents.ts
git commit -m "fix(mapbox): useMapboxIncidents assumed a bare array, server returns {data, pagination}"
```

---

### Task 3: Wire the Coverage Gaps, Safety Zones, Call History, and Incidents toggles

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

All four hooks are self-contained (fetch + render + clear); this task adds local `enabled` state per layer (mirroring the existing `deckEnabled` pattern already in this file), instantiates each hook, and registers a toggle in the `tactical` group of `layerGroups`.

- [ ] **Step 1: Add the imports**

Find this line in `client/src/pages/map/MapboxMapPage.tsx`:

```ts
import { useMapHeatmap } from '../../hooks/useMapHeatmap';
```

Add these four lines directly after it:

```ts
import { useMapboxIncidents } from '../../hooks/useMapboxIncidents';
import { useMapboxCoverageGaps } from '../../hooks/useMapboxCoverageGaps';
import { useMapboxSafetyZones } from '../../hooks/useMapboxSafetyZones';
import { useMapboxHistoryCalls } from '../../hooks/useMapboxHistoryCalls';
```

- [ ] **Step 2: Instantiate the hooks**

Find this line:

```ts
  const heatmap = useMapHeatmap(mapRef.current, mapLoaded);
```

Add directly after it:

```ts
  const incidentsLayer = useMapboxIncidents(mapLoaded ? mapRef.current : null);
  const coverageGaps = useMapboxCoverageGaps(mapLoaded ? mapRef.current : null);
  const safetyZones = useMapboxSafetyZones(mapLoaded ? mapRef.current : null);
  const historyCalls = useMapboxHistoryCalls(mapLoaded ? mapRef.current : null);
  const [incidentsEnabled, setIncidentsEnabled] = useState(false);
  const [coverageGapsEnabled, setCoverageGapsEnabled] = useState(false);
  const [safetyZonesEnabled, setSafetyZonesEnabled] = useState(false);
  const [historyCallsEnabled, setHistoryCallsEnabled] = useState(false);
```

(`useState` is already imported in this file — every other toggle here uses it, e.g. `deckEnabled`.)

- [ ] **Step 3: Add fetch-on-enable / clear-on-disable effects**

Add this block directly after the state declarations from Step 2:

```ts
  useEffect(() => {
    if (incidentsEnabled) incidentsLayer.fetchIncidents();
    else incidentsLayer.clear();
  }, [incidentsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!coverageGapsEnabled || !mapRef.current) { if (!coverageGapsEnabled) coverageGaps.clear(); return; }
    const bounds = mapRef.current.getBounds();
    coverageGaps.computeCoverage({
      north: bounds.getNorth(), south: bounds.getSouth(),
      east: bounds.getEast(), west: bounds.getWest(),
    });
  }, [coverageGapsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recompute Coverage Gaps on pan/zoom while the layer is active — debounced
  // since each recompute is an O(cells × units) scan over the new viewport.
  useEffect(() => {
    if (!coverageGapsEnabled || !mapRef.current) return;
    const map = mapRef.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onMoveEnd = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const bounds = map.getBounds();
        coverageGaps.computeCoverage({
          north: bounds.getNorth(), south: bounds.getSouth(),
          east: bounds.getEast(), west: bounds.getWest(),
        });
      }, 500);
    };
    map.on('moveend', onMoveEnd);
    return () => { map.off('moveend', onMoveEnd); if (timer) clearTimeout(timer); };
  }, [coverageGapsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (safetyZonesEnabled) safetyZones.fetchSafetyZones();
    else safetyZones.clear();
  }, [safetyZonesEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (historyCallsEnabled) historyCalls.fetchHistory();
    else historyCalls.clear();
  }, [historyCallsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps
```

(The `eslint-disable-line` comments match this file's existing convention for enable-toggle effects that intentionally only depend on the boolean, not the hook object identity — check a neighboring effect like the heatmap keyboard-shortcut block for the same pattern before assuming; if this file uses a different suppression convention, match that one instead.)

- [ ] **Step 4: Register the four new toggles in `layerGroups`**

Find the `'tactical'` — wait, check the actual group id first: this file's `layerGroups` currently has ids `operational`, `geojson`, `base`, `dispatch`, `camera`, `tools` (not `tactical`/`history` — those group *labels* exist in `MapOverlaysPanel.tsx`'s own `GROUPS` constant for the *flat-overlays* rendering path, but `MapboxMapPage.tsx` passes `groups` directly with its own ids). Add the four new entries to the existing **`operational`** group's `layers` array (where `heatmap`/`traffic`/`breadcrumbs`/etc. already live), right after the `mapmatch` entry:

```ts
        { id: 'mapmatch', label: 'Map Match Trace', active: mapMatchTrace.collecting, onToggle: () => mapMatchTrace.collecting ? mapMatchTrace.clear() : mapMatchTrace.startCollecting(), color: '#fb923c', description: 'Snap GPS to roads' },
        { id: 'incidents', label: 'Incidents', active: incidentsEnabled, onToggle: () => setIncidentsEnabled((v) => !v), color: '#ef4444', description: 'RMS incident clusters', loading: incidentsLayer.loading },
        { id: 'coverage-gaps', label: 'Coverage Gaps', active: coverageGapsEnabled, onToggle: () => setCoverageGapsEnabled((v) => !v), color: '#f08228', description: 'Response-time gap grid', loading: coverageGaps.loading },
        { id: 'safety-zones', label: 'Safety Zones', active: safetyZonesEnabled, onToggle: () => setSafetyZonesEnabled((v) => !v), color: '#c81e1e', description: 'Risk-weighted call clusters', loading: safetyZones.loading },
        { id: 'call-history', label: 'Call History', active: historyCallsEnabled, onToggle: () => setHistoryCallsEnabled((v) => !v), color: '#64d264', description: 'Past 30 days of calls', loading: historyCalls.loading },
```

Then add all eight new state variables/hook results to the `layerGroups` `useMemo`'s dependency array (find the array ending in `...optimization]);` a few lines below the layers list, and append `incidentsEnabled, incidentsLayer.loading, coverageGapsEnabled, coverageGaps.loading, safetyZonesEnabled, safetyZones.loading, historyCallsEnabled, historyCalls.loading` before the closing `]`).

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Manual verification**

Run `npm run dev` + `cd client && npm run dev`, open `/map`, open the Map Overlays panel, and toggle each of Incidents / Coverage Gaps / Safety Zones / Call History on and off. Expected: each renders something on the map when enabled (or an empty/sparse layer if the local dataset has few matching rows — not an error), and cleanly removes its layer/source when toggled off (check the browser console for Mapbox "layer already exists" warnings, which would indicate `clear()` isn't being called correctly).

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): wire Incidents, Coverage Gaps, Safety Zones, Call History overlay toggles"
```

---

### Task 4: Heatmap historical mode switch

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

Adds a Live/Historical mode next to the existing "Crime Heatmap" toggle. Live mode keeps today's behavior (populate from currently-loaded `calls`); Historical mode fetches `GET /dispatch/heatmap?mode=all&days=30` and feeds those aggregated points into the same `heatmap` hook instance instead.

- [ ] **Step 1: Add a mode state + a shared populate function**

Find the `heatmap` hook instantiation (`const heatmap = useMapHeatmap(mapRef.current, mapLoaded);`) and add directly after it:

```ts
  const [heatmapMode, setHeatmapMode] = useState<'live' | 'historical'>('live');

  const populateAndToggleHeatmap = useCallback(async () => {
    if (!heatmap.enabled) {
      if (heatmapMode === 'historical') {
        try {
          const rows = await apiFetch<Array<{ latitude: number; longitude: number; count: number }>>('/dispatch/heatmap?mode=all&days=30');
          const maxCount = Math.max(1, ...rows.map((r) => r.count));
          heatmap.updatePoints(rows.map((r) => ({
            longitude: r.longitude, latitude: r.latitude,
            weight: Math.min(1, r.count / maxCount),
          })));
        } catch (err) {
          console.warn('[Heatmap] historical fetch failed:', err);
        }
      } else {
        const heatPts = calls
          .filter((c) => c.latitude != null && c.longitude != null)
          .map((c) => ({ longitude: c.longitude!, latitude: c.latitude!, weight: c.priority === '1' ? 1 : c.priority === '2' ? 0.7 : 0.4 }));
        heatmap.updatePoints(heatPts);
      }
    }
    heatmap.toggle();
  }, [heatmap, heatmapMode, calls]);
```

(`apiFetch` is already imported in this file — confirm at the top; every other `apiFetch<...>()` call in this file uses the same import.)

- [ ] **Step 2: Replace the three existing heatmap-toggle call sites**

There are three places in this file that inline the "populate from `calls` then `heatmap.toggle()`" logic: the `useMapKeyboardShortcuts` `toggleHeatmap` callback, a toolbar button `onClick`, and (indirectly) the `layerGroups` entry's `onToggle: heatmap.toggle`. Replace each of the first two's bodies with a single call to the new function, and change the `layerGroups` entry's `onToggle` too:

In `useMapKeyboardShortcuts({ toggleHeatmap: () => { ... } })`, replace the whole arrow function body with:

```ts
    toggleHeatmap: () => { void populateAndToggleHeatmap(); },
```

In the toolbar button's `onClick`, replace its body the same way:

```ts
                          onClick={() => { void populateAndToggleHeatmap(); }}
```

In `layerGroups`, find:

```ts
        { id: 'heatmap', label: 'Crime Heatmap', active: heatmap.enabled, onToggle: heatmap.toggle, color: '#ef4444', description: 'Incident density (H)' },
```

Replace with:

```ts
        { id: 'heatmap', label: `Crime Heatmap (${heatmapMode === 'live' ? 'Live' : 'Historical'})`, active: heatmap.enabled, onToggle: () => { void populateAndToggleHeatmap(); }, color: '#ef4444', description: 'Incident density (H) — click label to switch Live/Historical' },
```

- [ ] **Step 3: Add a mode-switch control**

Add a small toggle button next to wherever the existing heatmap toolbar button lives (same JSX block edited in Step 2's toolbar-button change) so the operator can flip `heatmapMode` before enabling the layer:

```tsx
                        <button
                          type="button"
                          className="text-[9px] px-1 py-0.5 rounded-sm"
                          style={{ background: heatmapMode === 'historical' ? 'rgba(239,68,68,0.2)' : 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444' }}
                          onClick={() => setHeatmapMode((m) => (m === 'live' ? 'historical' : 'live'))}
                          title="Switch between live (currently active calls) and historical (30-day) heatmap data"
                        >
                          {heatmapMode === 'live' ? 'LIVE' : '30D'}
                        </button>
```

(Place this immediately adjacent to the existing heatmap toggle button in the JSX — match the surrounding button's styling conventions rather than copying these exact Tailwind/inline-style values verbatim if they don't fit the local layout.)

- [ ] **Step 4: Add `heatmapMode`/`populateAndToggleHeatmap`/`calls` to the `layerGroups` `useMemo` dependency array**

Same array touched in Task 3 Step 4 — append `heatmapMode, populateAndToggleHeatmap` (: `calls` is likely already a dependency elsewhere in this file; don't duplicate it if so).

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Manual verification**

With `npm run dev` running, open `/map`, confirm: Live heatmap shows only currently-active calls' density (same as before this task); clicking the LIVE/30D switch then re-enabling the heatmap shows a denser, 30-day historical pattern instead; toggling off and back to Live returns to the sparse live view.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): add Live/Historical mode switch to the Crime Heatmap layer"
```

---

### Task 5: Tilequery "Identify" click-tool

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

Adds a toggleable "Identify" tool: while active, clicking the map calls Tilequery at that point and shows a popup with place/district info. Deliberately does NOT mount `DispatchToolPanel.tsx` (see spec Part 2f) — this is a standalone click-handler + popup, reusing `useMapboxTilequery.ts` directly.

- [ ] **Step 1: Add the import + hook instantiation**

Add the import next to the other new hook imports from Task 3 Step 1:

```ts
import { useMapboxTilequery } from '../../hooks/useMapboxTilequery';
```

Add the instantiation next to the other new hooks from Task 3 Step 2:

```ts
  const tilequery = useMapboxTilequery(mapLoaded ? mapRef.current : null);
  const [identifyEnabled, setIdentifyEnabled] = useState(false);
  const identifyPopupRef = useRef<mapboxgl.Popup | null>(null);
```

(`mapboxgl` and `useRef` are already imported in this file.)

- [ ] **Step 2: Wire the click handler**

Add this effect near the other map-click-handler effects in this file (search for an existing `map.on('click', ...)` pattern to place it consistently, e.g. near the Feature Inspector or Street View click handlers):

```ts
  useEffect(() => {
    const map = mapRef.current;
    if (!identifyEnabled || !map) return;

    const handler = async (e: mapboxgl.MapMouseEvent) => {
      const info = await tilequery.queryFromMapClick(e);
      if (identifyPopupRef.current) { identifyPopupRef.current.remove(); identifyPopupRef.current = null; }
      if (!info) return;
      const lines = [
        info.city && `City: ${info.city}`,
        info.county && `County: ${info.county}`,
        info.state && `State: ${info.state}`,
        info.sectorName && `Area: ${info.sectorName}`,
      ].filter(Boolean);
      const html = `<div style="font:11px monospace;color:#ddd;background:#0a0a0a;padding:4px 6px;">${lines.length ? lines.join('<br/>') : 'No data at this point'}</div>`;
      identifyPopupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(map);
    };

    map.on('click', handler);
    return () => {
      map.off('click', handler);
      if (identifyPopupRef.current) { identifyPopupRef.current.remove(); identifyPopupRef.current = null; }
    };
  }, [identifyEnabled]); // eslint-disable-line react-hooks/exhaustive-deps
```

(If this file already has a shared popup-styling helper or constant used by other click-driven tools — e.g. Feature Inspector — use that instead of the inline `html` string above, to stay consistent with the existing popup look. Check for one before assuming none exists.)

- [ ] **Step 3: Register the toggle**

Add to the `tools` group in `layerGroups` (where `places`/`directions`/`bookmarks`/`optimize` already live):

```ts
        { id: 'identify', label: 'Identify', active: identifyEnabled, onToggle: () => setIdentifyEnabled((v) => !v), color: '#eab308', description: 'Click the map for place/district info', loading: tilequery.loading },
```

Add `identifyEnabled, tilequery.loading` to the `layerGroups` `useMemo` dependency array.

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual verification**

With the dev server running, toggle "Identify" on in the Map Overlays panel, click several points on the map (a city center, empty terrain), confirm a popup appears with place/district info or "No data at this point" (not a crash), and confirm toggling "Identify" off removes the click handler (clicking the map no longer opens popups, and any open popup closes).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): add standalone Tilequery Identify click-tool"
```

---

### Task 6: Wire the Repeat Addresses toggle (depends on Task 1)

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Add the import + hook instantiation**

```ts
import { useMapboxRepeatAddresses } from '../../hooks/useMapboxRepeatAddresses';
```

```ts
  const repeatAddresses = useMapboxRepeatAddresses(mapLoaded ? mapRef.current : null);
  const [repeatAddressesEnabled, setRepeatAddressesEnabled] = useState(false);
```

- [ ] **Step 2: Add the fetch-on-enable effect**

```ts
  useEffect(() => {
    if (repeatAddressesEnabled) repeatAddresses.fetchRepeats();
    else repeatAddresses.clear();
  }, [repeatAddressesEnabled]); // eslint-disable-line react-hooks/exhaustive-deps
```

(Check `useMapboxRepeatAddresses.ts`'s actual exported function name before writing this — confirm it's `fetchRepeats`/`clear` by reading the hook file; adjust the call names in this step if they differ.)

- [ ] **Step 3: Register the toggle**

Add to the `operational` group's layers array (alongside the other four data-fetching overlays from Task 3):

```ts
        { id: 'repeat-addresses', label: 'Repeat Addresses', active: repeatAddressesEnabled, onToggle: () => setRepeatAddressesEnabled((v) => !v), color: '#64d264', description: 'Locations with 3+ calls', loading: repeatAddresses.loading },
```

Add `repeatAddressesEnabled, repeatAddresses.loading` to the `layerGroups` dependency array.

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual verification**

With Task 1's route live (local dev server), toggle "Repeat Addresses" on — confirm it renders clusters for any address with 3+ calls in the last 30 days on the local dataset (or renders nothing if the local dataset is too sparse to have any — check the Network tab for a 200 response with a real `addresses` array either way, not a 404).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): wire Repeat Addresses overlay toggle"
```

---

### Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Client test suite**

Run: `cd client && npx vitest run`
Expected: PASS — same count as before this plan (no existing tests reference the touched hooks' internals in a way this plan changes, aside from Task 2's `fetchIncidents` signature change — grep `fetchIncidents` across `client/src/**/__tests__` first; if a test calls it with the old `(days, limit)` signature, update that call to the new `(limit)` signature as part of Task 2).

- [ ] **Step 4: Full manual sweep**

With both dev servers running, on `/map`: toggle all six new/modified overlays (Incidents, Coverage Gaps, Safety Zones, Call History, Repeat Addresses, Heatmap mode switch) on and off in sequence, confirming no Mapbox console warnings about duplicate/orphaned layers or sources accumulate after repeated toggling.
