# Trip Replay Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small, passive Mapbox map to the Trip Replay section of `MovementReportDrawer.tsx` that draws the full breadcrumb polyline (traveled/remaining two-tone) and animates a marker along it as replay advances, without touching the existing controls or numeric readout.

**Architecture:** One new component, `TripReplayMap.tsx`, does its own minimal Mapbox init (borrowing `mapboxLoader`/`mapboxApiKey`/`mapboxBasemap` helpers already used by `NavMapView.tsx`) — no pan/zoom/rotate, fixed bounds-fit on load, three GeoJSON sources (`traveled`, `remaining`, `marker`) whose data gets replaced on every `replayIdx` change. `TripReplay` (inside `MovementReportDrawer.tsx`) renders it above the existing scrubber row and passes it the `replayIdx` it already computes.

**Tech Stack:** React 18 + TypeScript, Mapbox GL JS (`mapbox-gl` npm package), Vite, Vitest.

**Spec:** [`docs/superpowers/specs/2026-07-08-trip-replay-map-design.md`](../specs/2026-07-08-trip-replay-map-design.md)

---

### Task 1: Create `TripReplayMap` component

**Files:**
- Create: `client/src/pages/navigation/TripReplayMap.tsx`

- [ ] **Step 1: Write the component**

```tsx
// ============================================================
// Trip replay map — a small, passive Mapbox visual for the Movement
// Report drawer's "replay this trip" control. Draws the full breadcrumb
// polyline (traveled in gold, remaining dimmed) and a marker at the
// current replay position. No pan/zoom/rotate, no camera follow — the
// camera fits the whole trip once on load and never moves again; all
// scrubbing stays on the existing range slider in TripReplay.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import {
  initMapbox, mapboxgl, MAPBOX_STYLE_DARK,
} from '../../utils/mapboxLoader';
import { getMapboxAccessToken } from '../../utils/mapboxApiKey';
import { applyRmpgBasemap } from '../../utils/mapboxBasemap';
import type { ReplayPoint } from './tripReplay';

const TRAVELED_SOURCE_ID = 'trip-replay-traveled-src';
const TRAVELED_LAYER_ID = 'trip-replay-traveled-line';
const REMAINING_SOURCE_ID = 'trip-replay-remaining-src';
const REMAINING_LAYER_ID = 'trip-replay-remaining-line';
const MARKER_SOURCE_ID = 'trip-replay-marker-src';
const MARKER_HALO_LAYER_ID = 'trip-replay-marker-halo';
const MARKER_LAYER_ID = 'trip-replay-marker-dot';

function emptyLineFeature(): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } };
}

function emptyPointFeature(): GeoJSON.Feature<GeoJSON.Point> {
  return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } };
}

interface TripReplayMapProps {
  points: ReplayPoint[];
  replayIdx: number;
}

export default function TripReplayMap({ points, replayIdx }: TripReplayMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // ── Init (once) ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getMapboxAccessToken();
        if (cancelled) return;
        if (!token || !containerRef.current) {
          setFailed(true);
          return;
        }
        initMapbox(token);

        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: MAPBOX_STYLE_DARK,
          center: [points[0]?.lng ?? 0, points[0]?.lat ?? 0],
          zoom: 13,
          attributionControl: false,
          interactive: false,
          pitch: 0,
          bearing: 0,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });

        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));

        map.on('load', () => {
          if (cancelled) {
            map.remove();
            return;
          }
          map.addSource(REMAINING_SOURCE_ID, { type: 'geojson', data: emptyLineFeature() });
          map.addLayer({
            id: REMAINING_LAYER_ID,
            type: 'line',
            source: REMAINING_SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#4b5563', 'line-width': 2, 'line-opacity': 0.8 },
          });
          map.addSource(TRAVELED_SOURCE_ID, { type: 'geojson', data: emptyLineFeature() });
          map.addLayer({
            id: TRAVELED_LAYER_ID,
            type: 'line',
            source: TRAVELED_SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#d4a017', 'line-width': 3, 'line-opacity': 0.9 },
          });
          map.addSource(MARKER_SOURCE_ID, { type: 'geojson', data: emptyPointFeature() });
          map.addLayer({
            id: MARKER_HALO_LAYER_ID,
            type: 'circle',
            source: MARKER_SOURCE_ID,
            paint: {
              'circle-radius': 10,
              'circle-color': '#d4a017',
              'circle-opacity': 0.2,
              'circle-stroke-color': '#d4a017',
              'circle-stroke-width': 1,
              'circle-stroke-opacity': 0.4,
            },
          });
          map.addLayer({
            id: MARKER_LAYER_ID,
            type: 'circle',
            source: MARKER_SOURCE_ID,
            paint: {
              'circle-radius': 5,
              'circle-color': '#d4a017',
              'circle-stroke-color': '#000',
              'circle-stroke-width': 2,
            },
          });

          if (points.length >= 2) {
            const bounds = new mapboxgl.LngLatBounds();
            for (const p of points) bounds.extend([p.lng, p.lat]);
            try {
              map.fitBounds(bounds, { padding: 16, duration: 0 });
            } catch { /* ignore — degenerate bounds (all-identical points) */ }
          }

          mapRef.current = map;
          setMapReady(true);
        });

        map.on('error', (e) => {
          console.warn('[TripReplayMap] mapbox error:', e?.error?.message || e);
        });
      } catch (err) {
        if (cancelled) return;
        console.warn('[TripReplayMap] init failed:', err);
        setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update traveled/remaining/marker on replayIdx change ───
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const traveledSrc = map.getSource(TRAVELED_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    const remainingSrc = map.getSource(REMAINING_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    const markerSrc = map.getSource(MARKER_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!traveledSrc || !remainingSrc || !markerSrc) return;

    const idx = Math.max(0, Math.min(replayIdx, points.length - 1));
    const traveled = points.slice(0, idx + 1);
    const remaining = points.slice(idx);
    const current = points[idx];

    traveledSrc.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: traveled.map((p) => [p.lng, p.lat]) },
    });
    remainingSrc.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: remaining.map((p) => [p.lng, p.lat]) },
    });
    if (current) {
      markerSrc.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [current.lng, current.lat] },
      });
    }
  }, [mapReady, points, replayIdx]);

  if (failed) return null;

  return (
    <div
      className="relative border border-rmpg-800 overflow-hidden"
      style={{ height: 140, borderRadius: 2, background: 'var(--surface-sunken)' }}
    >
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors attributable to `TripReplayMap.tsx` (pre-existing unrelated errors, if any, are out of scope — see CLAUDE.md note on 12 pre-existing client typecheck errors).

- [ ] **Step 3: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-khayyam-a596c9"
git add client/src/pages/navigation/TripReplayMap.tsx
git commit -m "feat(nav): add TripReplayMap component for trip replay drawer"
```

---

### Task 2: Wire `TripReplayMap` into `TripReplay`

**Files:**
- Modify: `client/src/pages/navigation/MovementReportDrawer.tsx`

- [ ] **Step 1: Import the new component**

In `client/src/pages/navigation/MovementReportDrawer.tsx`, add to the existing import block (near the top, alongside the `tripReplay` import at line 16):

```tsx
import { replayIndexAt, replayDurationMs, type ReplayPoint } from './tripReplay';
import TripReplayMap from './TripReplayMap';
```

- [ ] **Step 2: Render the map above the scrubber row**

Locate the `TripReplay` function's JSX (currently starting at line 177: `return (` inside `function TripReplay({ points }: { points: ReplayPoint[] }) {`). Insert `<TripReplayMap>` between the section header `div` and the controls `div`:

```tsx
  return (
    <div>
      <div className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-rmpg-600 mb-1">
        <Navigation2 className="w-2.5 h-2.5 text-brand-500" /> Trip replay
        <span className="ml-auto font-mono text-rmpg-500">{current ? fmtReplayClock(current.time) : '—'}</span>
      </div>
      <TripReplayMap points={points} replayIdx={replayIdx} />
      <div className="bg-surface-sunken/60 border border-rmpg-800 px-2 py-1.5 space-y-1.5 mt-1.5" style={{ borderRadius: 2 }}>
        <div className="flex items-center gap-2">
```

(Note the `mt-1.5` added to the controls `div` so the map and controls block have consistent spacing — matches the `space-y-1.5` rhythm used elsewhere in this file.)

- [ ] **Step 3: Update the now-stale comment above `TripReplay`**

Replace the comment block immediately above `function TripReplay` (lines 133–136):

```tsx
// ── Trip replay — scrub/play through the already-fetched breadcrumb track.
// No map here (this drawer is purely tabular/chart), so playback drives a
// numeric readout (lat/lng/speed/heading @ the replay index) rather than a
// moving marker. ──
```

with:

```tsx
// ── Trip replay — scrub/play through the already-fetched breadcrumb track.
// TripReplayMap renders the polyline + moving marker (passive — camera is
// fixed to the trip's bounds on load, no follow/click-to-scrub); the numeric
// readout (lat/lng/speed/heading @ the replay index) stays below it. ──
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Run the client test suite**

Run: `cd client && npx vitest run`
Expected: all existing tests still pass (this change adds no new test files — see Task 3 rationale for why).

- [ ] **Step 6: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-khayyam-a596c9"
git add client/src/pages/navigation/MovementReportDrawer.tsx
git commit -m "feat(nav): render trip replay map in Movement Report drawer"
```

---

### Task 3: Manual verification

There is no new pure logic in this change (bounds-fitting and array-slicing are trivial, exercised implicitly by rendering — see spec's Testing section for the rationale on skipping unit tests here). Verification is manual, via the dev server.

**Files:** none (verification only)

- [ ] **Step 1: Start the client dev server and confirm the app loads**

Use the `preview_start` tool with the `client-dev` configuration (create `.claude/launch.json` first if it doesn't exist, per the tool's instructions — `runtimeExecutable: "npm"`, `runtimeArgs: ["run", "dev"]`, `cwd`/working directory `client/`, `port: 5173`).

- [ ] **Step 2: Navigate to the Navigate page and open Movement Report on a session with breadcrumb points**

Use `preview_eval` to check `window.location.href`, then click through to `/navigate` (or whatever route `NavigationPage.tsx` is mounted at — check `client/src/App.tsx` for the exact path). Open the Movement Report drawer (the button/icon that triggers `onClose`'s counterpart — check `NavigationPage.tsx` for how `MovementReportDrawer` is opened).

- [ ] **Step 3: Confirm the map renders**

Use `preview_screenshot` to confirm a small map appears above the play/pause/scrubber row, showing a gold polyline.

- [ ] **Step 4: Confirm playback animates the marker and two-tone trail**

Use `preview_click` on the play button (`aria-label="Play replay"`), wait briefly, then `preview_screenshot` again — confirm the marker has moved and the traveled portion of the line (gold) has grown relative to the remaining portion (gray).

- [ ] **Step 5: Confirm the scrubber still works**

Use `preview_fill` or drag the range input (`aria-label="Replay position"`) to a mid value, then `preview_screenshot` — confirm the marker jumps to match, and the numeric readout below still updates.

- [ ] **Step 6: Check console for errors**

Use `preview_console_logs` with `level: "error"` — confirm no new errors from `TripReplayMap` (an expected "Mapbox access token not configured" warning is acceptable only if `VITE_MAPBOX_ACCESS_TOKEN` isn't set in the dev environment; in that case confirm the component fails gracefully — i.e., no map renders, but the rest of the drawer, including the numeric readout, still works).

- [ ] **Step 7: Repeat via `TripsDrawer` (historical trip path)**

Confirm the same behavior when `points` comes from `TripsDrawer.tsx`'s historical-trip wiring rather than `NavigationPage.tsx`'s live-session wiring — both call sites pass `points` into the same `MovementReportDrawer`, so this mainly confirms no regressions in that second call site.

- [ ] **Step 8: Stop the dev server**

Use `preview_stop` on the server started in Step 1.

---

## Self-Review Notes

- **Spec coverage:** compact 140px map (spec §Sizing) → Task 1 Step 1 container height; fixed bounds-fit, no follow (spec §Init/Update) → Task 1 Step 1 `fitBounds` only in the init effect, never in the `replayIdx` effect; two-tone trail (spec §Init) → `traveled`/`remaining` sources+layers; passive/no click-to-scrub (spec §Out of scope) → `interactive: false`, no click handlers added; graceful degradation on missing token (spec §Error handling) → `failed` state renders `null`; wiring + stale comment update (spec §Wiring) → Task 2 Steps 1–3.
- **Placeholder scan:** no TBD/TODO; all steps contain complete code or exact commands.
- **Type consistency:** `TripReplayMapProps` matches the call site (`points`, `replayIdx`) added in Task 2 Step 2; `ReplayPoint` imported from the same `./tripReplay` module already used by `MovementReportDrawer.tsx`; source/layer ID constants are only referenced within `TripReplayMap.tsx`, no cross-file naming to keep in sync.
