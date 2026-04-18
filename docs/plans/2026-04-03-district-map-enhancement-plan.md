# Section/Zone/Beat & Map Layout Enhancement — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix and enhance the Section/Zone/Beat admin UI, map beat overlay, dispatch dropdowns, beat auto-detection, and convert all km measurements to miles across the system.

**Architecture:** Replace the flat JSON-based zone/beat admin config with a hierarchical tree view backed by `dispatch_districts` table CRUD. Upgrade map beat polygons to section-colored with labels, unit overlay, heat map, boundary editor, and patrol trails. Fix dispatch dropdown sync and geofence nearest-beat fallback.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Express, better-sqlite3, Google Maps JS API

**Design Doc:** `docs/plans/2026-04-03-district-map-enhancement-design.md`

---

## Task 1: District CRUD API Endpoints

**Files:**
- Modify: `server/src/routes/dispatch/aggregates.ts` (insert after line 1147)

**Step 1: Add POST /api/dispatch/districts endpoint**

Insert before the heatmap routes. Creates a new `dispatch_districts` row.

```typescript
// POST /api/dispatch/districts — Create a new district entry
router.post('/districts', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { section_id, zone_id, beat_id, dispatch_code, section_name, zone_name, beat_name, beat_descriptor } = req.body;

    if (!section_id?.trim() || !zone_id?.trim() || !beat_id?.trim() || !section_name?.trim() || !zone_name?.trim() || !beat_name?.trim()) {
      res.status(400).json({ error: 'section_id, zone_id, beat_id, section_name, zone_name, beat_name are required', code: 'MISSING_FIELDS' });
      return;
    }

    const code = dispatch_code?.trim() || `${section_id.trim()}-${zone_id.trim()}/${beat_id.trim()}`;

    // Check for duplicate dispatch_code
    const existing = db.prepare('SELECT id FROM dispatch_districts WHERE dispatch_code = ?').get(code);
    if (existing) {
      res.status(409).json({ error: 'District with this dispatch code already exists', code: 'DUPLICATE_DISTRICT' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO dispatch_districts (section_id, zone_id, beat_id, dispatch_code, section_name, zone_name, beat_name, beat_descriptor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(section_id.trim(), zone_id.trim(), beat_id.trim(), code, section_name.trim(), zone_name.trim(), beat_name.trim(), beat_descriptor?.trim() || null);

    auditLog(req, 'CREATE' as any, 'dispatch_district' as any, result.lastInsertRowid as number, `Created district ${code}`);
    res.json({ success: true, id: result.lastInsertRowid, dispatch_code: code });
  } catch (error: any) {
    console.error('[Dispatch] district create error:', error?.message);
    res.status(500).json({ error: 'Failed to create district', code: 'DISTRICT_CREATE_ERROR' });
  }
});
```

**Step 2: Add PUT /api/dispatch/districts/:id endpoint**

```typescript
// PUT /api/dispatch/districts/:id — Update a district entry
router.put('/districts/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }

    const existing = db.prepare('SELECT * FROM dispatch_districts WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ error: 'District not found', code: 'NOT_FOUND' }); return; }

    const { section_id, zone_id, beat_id, dispatch_code, section_name, zone_name, beat_name, beat_descriptor } = req.body;

    db.prepare(`
      UPDATE dispatch_districts SET
        section_id = COALESCE(?, section_id),
        zone_id = COALESCE(?, zone_id),
        beat_id = COALESCE(?, beat_id),
        dispatch_code = COALESCE(?, dispatch_code),
        section_name = COALESCE(?, section_name),
        zone_name = COALESCE(?, zone_name),
        beat_name = COALESCE(?, beat_name),
        beat_descriptor = COALESCE(?, beat_descriptor)
      WHERE id = ?
    `).run(section_id || null, zone_id || null, beat_id || null, dispatch_code || null,
           section_name || null, zone_name || null, beat_name || null, beat_descriptor ?? null, id);

    auditLog(req, 'UPDATE' as any, 'dispatch_district' as any, id, `Updated district ${existing.dispatch_code}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Dispatch] district update error:', error?.message);
    res.status(500).json({ error: 'Failed to update district', code: 'DISTRICT_UPDATE_ERROR' });
  }
});
```

**Step 3: Add DELETE /api/dispatch/districts/:id endpoint**

```typescript
// DELETE /api/dispatch/districts/:id — Delete a district entry
router.delete('/districts/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }

    const existing = db.prepare('SELECT * FROM dispatch_districts WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ error: 'District not found', code: 'NOT_FOUND' }); return; }

    db.prepare('DELETE FROM dispatch_districts WHERE id = ?').run(id);
    auditLog(req, 'DELETE' as any, 'dispatch_district' as any, id, `Deleted district ${existing.dispatch_code}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Dispatch] district delete error:', error?.message);
    res.status(500).json({ error: 'Failed to delete district', code: 'DISTRICT_DELETE_ERROR' });
  }
});
```

**Step 4: Add call density endpoint**

```typescript
// GET /api/dispatch/districts/call-density — Call counts per beat
router.get('/districts/call-density', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const range = req.query.range as string || '24h';
    const hoursMap: Record<string, number> = { '24h': 24, '7d': 168, '30d': 720 };
    const hours = hoursMap[range] || 24;

    const rows = db.prepare(`
      SELECT zone_beat, COUNT(*) as call_count
      FROM calls_for_service
      WHERE zone_beat IS NOT NULL AND zone_beat != ''
        AND created_at >= datetime('now', '-${hours} hours')
      GROUP BY zone_beat
      ORDER BY call_count DESC
    `).all() as any[];

    setCacheHeaders(res, 120);
    res.json(rows);
  } catch (error: any) {
    console.error('[Dispatch] call density error:', error?.message);
    res.status(500).json({ error: 'Failed to get call density', code: 'CALL_DENSITY_ERROR' });
  }
});
```

**Step 5: Add geofence reload endpoint**

```typescript
// POST /api/dispatch/districts/reload-geofence — Hot-reload geofence data
router.post('/districts/reload-geofence', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    reloadGeofence();
    res.json({ success: true, message: 'Geofence data reloaded' });
  } catch (error: any) {
    console.error('[Dispatch] geofence reload error:', error?.message);
    res.status(500).json({ error: 'Failed to reload geofence', code: 'GEOFENCE_RELOAD_ERROR' });
  }
});
```

Add `reloadGeofence` to the import from `../../utils/geofence` at the top of the file. Also ensure `auditLog` is imported.

**Step 6: Commit**

```bash
git add server/src/routes/dispatch/aggregates.ts
git commit -m "feat: add district CRUD, call density, and geofence reload endpoints"
```

---

## Task 2: Geofence Fixes (Nearest-Beat Fallback + Hot-Reload)

**Files:**
- Modify: `server/src/utils/geofence.ts`
- Modify: `server/src/utils/districtResolver.ts`

**Step 1: Add reloadGeofence() and nearest-beat fallback to geofence.ts**

At the end of `geofence.ts`, before the closing, add:

```typescript
/**
 * Force-reload the geofence data from disk.
 * Call after beat boundary edits.
 */
export function reloadGeofence(): void {
  beatFeatures = null;
  loadBeats();
  console.log('[geofence] Geofence data reloaded');
}

/**
 * Calculate the centroid of a polygon feature.
 */
function featureCentroid(feature: BeatFeature): { lat: number; lng: number } {
  const ring = feature.subPolygons[0]?.[0] || [];
  if (ring.length === 0) return { lat: 0, lng: 0 };
  let sumLng = 0, sumLat = 0;
  for (const pt of ring) { sumLng += pt[0]; sumLat += pt[1]; }
  return { lat: sumLat / ring.length, lng: sumLng / ring.length };
}

/**
 * Haversine distance in miles between two points.
 */
function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const NEAREST_BEAT_THRESHOLD_MI = 1.25;

/**
 * Find the nearest beat to a point that's outside all polygons.
 * Returns null if no beat is within threshold.
 */
export function findNearestBeat(lat: number, lng: number): (BeatMatch & { exact: boolean; distance_mi: number }) | null {
  const features = loadBeats();
  let closest: BeatFeature | null = null;
  let closestDist = Infinity;

  for (const feature of features) {
    const c = featureCentroid(feature);
    const dist = haversineMiles(lat, lng, c.lat, c.lng);
    if (dist < closestDist) {
      closestDist = dist;
      closest = feature;
    }
  }

  if (!closest || closestDist > NEAREST_BEAT_THRESHOLD_MI) return null;

  const p = closest.properties;
  return {
    beat_id: p.beat_id,
    beat_code: p.beat_code,
    city: p.city,
    city_code: p.city_code,
    district_letter: p.district_letter,
    beat_number: p.beat_number,
    exact: false,
    distance_mi: Math.round(closestDist * 100) / 100,
  };
}
```

**Step 2: Update identifyBeat to use nearest-beat fallback**

In the existing `identifyBeat` function, change the return at the end from `return null;` to:

```typescript
  // No exact polygon match — try nearest centroid within threshold
  return null; // Keep returning null from identifyBeat itself
```

Actually, keep `identifyBeat` returning null for exact misses. The fallback will be called at the consumer level (districtResolver and the identify endpoint).

**Step 3: Fix districtResolver.ts**

Replace the `resolveDistrict` function to use `dispatch_code` matching and nearest-beat fallback:

```typescript
import { identifyBeat, findNearestBeat } from './geofence';
import { getDb } from '../models/database';

export interface DistrictResult {
  section_id: string;
  zone_id: string;
  beat_id: string;
  zone_beat: string;
  section_name?: string;
  zone_name?: string;
  beat_name?: string;
  beat_descriptor?: string;
  exact: boolean;
}

export function resolveDistrict(lat: number, lng: number): DistrictResult | null {
  try {
    let beat = identifyBeat(lat, lng);
    let exact = true;

    if (!beat) {
      const nearest = findNearestBeat(lat, lng);
      if (!nearest) return null;
      beat = nearest;
      exact = false;
    }

    const db = getDb();

    // Primary lookup: match beat_code to dispatch_code
    let district = db.prepare(
      'SELECT * FROM dispatch_districts WHERE dispatch_code = ?'
    ).get(beat.beat_code) as any;

    // Fallback: match by zone_id + beat_id
    if (!district) {
      district = db.prepare(
        'SELECT * FROM dispatch_districts WHERE zone_id = ? AND beat_id = ?'
      ).get(beat.city_code, beat.district_letter) as any;
    }

    if (district) {
      return {
        section_id: district.section_id,
        zone_id: district.zone_id,
        beat_id: district.beat_id,
        zone_beat: district.dispatch_code,
        section_name: district.section_name,
        zone_name: district.zone_name,
        beat_name: district.beat_name,
        beat_descriptor: district.beat_descriptor,
        exact,
      };
    }

    // No dispatch_districts entry — use raw geofence data
    if (!exact) {
      console.warn(`[districtResolver] Beat ${beat.beat_code} exists in GeoJSON but not in dispatch_districts`);
    }
    return {
      section_id: beat.district_letter,
      zone_id: beat.city_code,
      beat_id: beat.beat_id,
      zone_beat: beat.beat_code,
      exact,
    };
  } catch {
    return null;
  }
}
```

Also update `autoFillDistrict` to pass through the new fields (section_name, zone_name, beat_name, beat_descriptor) when available.

**Step 4: Update the /districts/identify endpoint** in `aggregates.ts` to use `findNearestBeat` as fallback when `identifyBeat` returns null.

**Step 5: Commit**

```bash
git add server/src/utils/geofence.ts server/src/utils/districtResolver.ts server/src/routes/dispatch/aggregates.ts
git commit -m "feat: add nearest-beat fallback, geofence hot-reload, and district lookup fix"
```

---

## Task 3: Admin Tree View UI

**Files:**
- Modify: `client/src/pages/admin/AdminSystemTab.tsx` (replace lines ~1783-1852)

**Step 1: Replace the flat zones table with a hierarchical tree view**

Replace the `{activeSection === 'zones' && (...)}` block. The new tree view should:

1. Fetch districts from `GET /api/dispatch/districts` (not from `system_config` JSON)
2. Group districts into a tree: `Map<sectionId, Map<zoneId, DistrictRow[]>>`
3. Render expandable sections (chevron toggle) → zones → beats
4. Each section shows: `section_id — section_name [Edit] [+ Zone]`
5. Each zone shows: `zone_id — zone_name [Edit] [+ Beat]`
6. Each beat shows: `beat_id — beat_name (beat_descriptor) [Edit] [Delete]`
7. Edit uses inline inputs (same pattern as current)
8. Add Section: prompts for section_id + section_name, creates a placeholder (no DB row until a beat is added)
9. Add Zone: prompts for zone_id + zone_name under the selected section
10. Add Beat: POSTs to `/api/dispatch/districts` with the full section/zone/beat hierarchy
11. Delete Beat: DELETEs `/api/dispatch/districts/:id`
12. Edit: PUTs to `/api/dispatch/districts/:id`
13. Stats footer: X sections, Y zones, Z beats

Design system:
- Tree indentation: `ml-4` per level
- Expand/collapse: `ChevronRight` (collapsed) / `ChevronDown` (expanded)
- Section row: `panel-beveled` with `text-brand-400` section icon
- Zone row: slightly indented, `text-blue-400` zone icon
- Beat row: most indented, `text-green-400` beat icon
- Action buttons: `toolbar-btn text-[9px]`

**Step 2: Commit**

```bash
git add client/src/pages/admin/AdminSystemTab.tsx
git commit -m "feat: replace flat zones config with hierarchical district tree view"
```

---

## Task 4: Map Section-Colored Beats + Labels

**Files:**
- Modify: `client/src/hooks/useGeoJsonLayers.ts`
- Modify: `client/src/pages/map/MapPage.tsx`

**Step 1: Update beat layer styling to use section colors**

In `useGeoJsonLayers.ts`, modify the beat layer's style application. The hook receives `beatDistrictMap` as a prop (already passed from MapPage). When rendering beat features, use the district map to look up the section_id and apply `getSectionColor(sectionId)` as the fill color per feature instead of the static green.

The Google Maps Data layer supports per-feature styling via `dataLayer.setStyle(feature => ...)`. Modify the style function for the beat layer to:
1. Get the feature's `beat_code` property
2. Parse out the zone/beat from beat_code to look up in `beatDistrictMap`
3. Get the section_id → `getSectionColor(sectionId)`
4. Return `{ fillColor: sectionColor, fillOpacity: 0.12, strokeColor: sectionColor, strokeOpacity: 0.6, strokeWeight: 1 }`
5. Unmapped beats: gray (#666) with 5% opacity

**Step 2: Add beat label overlays**

Create labels at beat polygon centroids using Google Maps `OverlayView` or simple `Marker` with `label` property:
- Calculate centroid for each beat feature when the layer loads
- At zoom >= 13: show full `dispatch_code` (e.g., "SL1-SLC/A")
- At zoom 11-12: show abbreviated `beat_id` (e.g., "A")
- Below zoom 11: hide labels
- Style: white text, small font (10px), text shadow for contrast
- Listen to map `zoom_changed` event to show/hide labels

Add a `beatLabelsRef` array to track label overlays so they can be cleaned up.

**Step 3: Commit**

```bash
git add client/src/hooks/useGeoJsonLayers.ts client/src/pages/map/MapPage.tsx
git commit -m "feat: section-colored beat polygons with zoom-adaptive labels"
```

---

## Task 5: Map Unit Overlay + Enhanced Info Windows

**Files:**
- Modify: `client/src/pages/map/MapPage.tsx`
- Modify: `client/src/hooks/useGeoJsonLayers.ts`

**Step 1: Add unit-in-beat cross-reference**

MapPage already has `units` state with GPS positions. Add a `useMemo` that:
1. For each unit with lat/lng, determines which beat it's in (client-side point-in-polygon or simpler: match against the beat features loaded in useGeoJsonLayers)
2. Builds a `Map<beatCode, UnitStatus[]>` of units per beat
3. Passes this to useGeoJsonLayers so the beat layer can dim uncovered beats

In the beat layer style function:
- If `unitsPerBeat.get(beatCode)?.length > 0`: normal opacity (0.12)
- If no units: reduced opacity (0.04) + dashed stroke

**Step 2: Add unit count badges on beats**

For beats with units, show a small badge overlay at the centroid:
- Circle with unit count number
- Color matches section color
- Only visible at zoom >= 12

**Step 3: Enhanced info windows**

Modify the beat layer click handler in useGeoJsonLayers to show richer content:
- Look up hierarchy from `beatDistrictMap`
- Look up active units from the `unitsPerBeat` map
- Look up active calls (from MapPage's `calls` state, matching by zone_beat)
- Render as HTML info window with section/zone/beat hierarchy, unit list, and call count

**Step 4: Commit**

```bash
git add client/src/pages/map/MapPage.tsx client/src/hooks/useGeoJsonLayers.ts
git commit -m "feat: add unit overlay, coverage dimming, and enhanced beat info windows"
```

---

## Task 6: Map Call Density Heat Map

**Files:**
- Modify: `client/src/pages/map/MapPage.tsx`
- Modify: `client/src/pages/map/components/MapLayersPanel.tsx` (if exists, otherwise in MapPage)

**Step 1: Add heat map state and toggle**

```typescript
const [beatHeatMap, setBeatHeatMap] = useState(false);
const [heatMapRange, setHeatMapRange] = useState<'24h' | '7d' | '30d'>('24h');
const [heatMapData, setHeatMapData] = useState<Map<string, number>>(new Map());
```

**Step 2: Fetch call density when toggled on**

```typescript
useEffect(() => {
  if (!beatHeatMap) { setHeatMapData(new Map()); return; }
  apiFetch<{ zone_beat: string; call_count: number }[]>(`/dispatch/districts/call-density?range=${heatMapRange}`)
    .then(rows => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(r.zone_beat, r.call_count);
      setHeatMapData(m);
    });
}, [beatHeatMap, heatMapRange]);
```

**Step 3: Apply density coloring to beat layer**

When `beatHeatMap` is active, override the beat layer style:
- Calculate min/max call counts
- Interpolate color: blue (low) → yellow (mid) → red (high)
- Beats with 0 calls: very dim gray
- Pass `heatMapData` to useGeoJsonLayers

**Step 4: Add toggle in layers panel**

Add a "Call Heat Map" toggle with time range selector (24h/7d/30d) in the layers panel section for beats.

**Step 5: Commit**

```bash
git add client/src/pages/map/MapPage.tsx client/src/hooks/useGeoJsonLayers.ts
git commit -m "feat: add call density heat map overlay for beat polygons"
```

---

## Task 7: Map Beat Boundary Editor

**Files:**
- Modify: `client/src/pages/map/MapPage.tsx`
- Modify: `server/src/routes/dispatch/aggregates.ts`

**Step 1: Add beat editing state**

```typescript
const [editingBeats, setEditingBeats] = useState(false);
const [selectedEditBeat, setSelectedEditBeat] = useState<string | null>(null);
```

**Step 2: Add beat geometry save endpoint**

In aggregates.ts:

```typescript
// PUT /api/dispatch/districts/beat-geometry/:beatCode — Update beat polygon in GeoJSON
router.put('/districts/beat-geometry/:beatCode', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const beatCode = req.params.beatCode;
    const { geometry } = req.body; // GeoJSON geometry object

    if (!geometry || !geometry.type || !geometry.coordinates) {
      res.status(400).json({ error: 'Valid GeoJSON geometry required', code: 'INVALID_GEOMETRY' });
      return;
    }

    // Read, modify, and write beat.geojson
    const geojsonPath = path.resolve(__dirname, '../../../client/public/geojson/beat.geojson');
    const raw = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));

    const feature = raw.features.find((f: any) => f.properties?.beat_code === beatCode);
    if (!feature) {
      res.status(404).json({ error: 'Beat not found in GeoJSON', code: 'BEAT_NOT_FOUND' });
      return;
    }

    feature.geometry = geometry;
    fs.writeFileSync(geojsonPath, JSON.stringify(raw, null, 2));

    // Reload geofence engine
    reloadGeofence();

    auditLog(req, 'UPDATE' as any, 'beat_geometry' as any, 0, `Updated geometry for beat ${beatCode}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Dispatch] beat geometry update error:', error?.message);
    res.status(500).json({ error: 'Failed to update beat geometry', code: 'BEAT_GEOMETRY_ERROR' });
  }
});
```

Add `import fs from 'fs'` and `import path from 'path'` if not already imported.

**Step 3: Add edit mode UI on MapPage**

When `editingBeats` is true:
- Beat layer becomes editable (Google Maps Data layer supports `setStyle({ editable: true })` for selected features)
- Click a beat to select it (highlight with thick border)
- Vertices become draggable
- Show a floating toolbar: "Save Changes" and "Cancel"
- On save: extract the modified geometry, POST to `/api/dispatch/districts/beat-geometry/:beatCode`
- On cancel: reload the layer from the original GeoJSON

**Step 4: Commit**

```bash
git add client/src/pages/map/MapPage.tsx server/src/routes/dispatch/aggregates.ts
git commit -m "feat: add beat boundary editor with geometry save and geofence reload"
```

---

## Task 8: Map Patrol Route Tracking

**Files:**
- Modify: `client/src/pages/map/MapPage.tsx`

**Step 1: Add patrol trail state and toggle**

```typescript
const [showPatrolTrails, setShowPatrolTrails] = useState(false);
const [patrolTrailData, setPatrolTrailData] = useState<Map<number, { lat: number; lng: number; time: string }[]>>(new Map());
const patrolTrailPolylinesRef = useRef<google.maps.Polyline[]>([]);
```

**Step 2: Fetch trail data**

The endpoint `GET /api/dispatch/gps/trails` already exists. When `showPatrolTrails` is toggled on:
- Fetch trails for all active units (last 8 hours)
- Store as polyline coordinates per unit

**Step 3: Render polylines**

For each unit's trail:
- Create a Google Maps Polyline with the unit's color
- Stroke opacity fades from 1.0 (recent) to 0.1 (oldest) using `symbols` or segmented polylines
- Add to `patrolTrailPolylinesRef` for cleanup

When toggled off, clear all polylines.

**Step 4: Add toggle in layers panel**

"Patrol Trails" toggle in the map layers panel.

**Step 5: Commit**

```bash
git add client/src/pages/map/MapPage.tsx
git commit -m "feat: add patrol route trail visualization on map"
```

---

## Task 9: Dispatch Dropdown Fixes

**Files:**
- Modify: `client/src/pages/dispatch/DispatchPage.tsx`
- Modify: `client/src/hooks/useDistrictLookup.ts`

**Step 1: Fix useDistrictLookup loading/error states**

Update `useDistrictOptions()` to return `{ loading, error }` state:

```typescript
const [error, setError] = useState<string | null>(null);
// In the fetch: .catch((err) => { setError('Failed to load districts'); })
// Return: { ..., loading, error }
```

**Step 2: Fix DispatchPage dropdown sync**

In DispatchPage, find where GPS auto-fills section/zone/beat (search for `useDistrictIdentify` or `identify` calls). Ensure that when auto-detection fills values, the dropdown state variables are explicitly set to match.

Add a "Re-detect" button next to the beat dropdowns:

```tsx
<button type="button"
  onClick={async () => {
    if (callLat && callLng) {
      const result = await identify(callLat, callLng);
      if (result) {
        setCallSection(result.section_id);
        setCallZone(result.zone_id);
        setCallBeat(result.beat_id);
      }
    }
  }}
  className="toolbar-btn text-[9px]"
  title="Re-detect beat from location"
>
  <Crosshair className="w-3 h-3" /> Re-detect
</button>
```

**Step 3: Add fallback notices**

- If `useDistrictOptions` returns empty districts: show inline amber notice
- If a call has stale beat data not in districts: show warning icon with tooltip

**Step 4: Commit**

```bash
git add client/src/pages/dispatch/DispatchPage.tsx client/src/hooks/useDistrictLookup.ts
git commit -m "feat: fix dispatch dropdowns with GPS sync, re-detect, and error states"
```

---

## Task 10: System-Wide km → mi Conversion

**Files affected** (from grep results):
- `client/src/pages/PatrolPage.tsx` — `total_distance_km`, `distance_from_previous_km`
- `client/src/hooks/useGpsTracking.ts` — speed comment (360 km/h)
- `client/src/utils/narrativeComposer.ts` — kilometers display
- `client/src/pages/map/components/SafetyAlertModal.tsx` — radius display
- `client/src/pages/map/components/WeatherPanel.tsx` — visibility in km
- `client/src/pages/map/hooks/useMapResponseRadius.ts` — speed comment
- `client/src/pages/map/hooks/useMapUnitSafety.ts` — `LONE_OFFICER_RADIUS_KM`, `BACKUP_RADIUS_KM`, `SPEED_ANOMALY_KMH`, `EARTH_RADIUS_KM`, `haversineKm`, `speed_kmh`
- `client/src/pages/map/hooks/useMapCorridor.ts` — `DISTANCE_KM`, earth radius
- `server/src/routes/dashcamVideos.ts` — `distance_km`
- `server/src/routes/patrol.ts` — `total_distance_km`, `distance_from_previous_km`, haversine
- `server/src/utils/threatContext.ts` — degree-to-km comment
- `server/src/utils/clearPathGpsMediaPoller.ts` — km/h conversion
- `server/src/utils/proximityAlerts.ts` — `AVERAGE_URBAN_SPEED_KMH`, distances, ETA

**Step 1: Convert server-side constants and calculations**

For each server file:
- Rename `_km` → `_mi` in variable names
- Change Earth radius from 6371 (km) to 3958.8 (mi)
- Convert speed thresholds: `km/h` → `mph` (multiply by 0.621371)
- Convert distance thresholds: `km` → `mi` (multiply by 0.621371)
- Update API response field names: `distance_km` → `distance_mi`, `total_distance_km` → `total_distance_mi`

**Step 2: Convert client-side display and calculations**

For each client file:
- Update display strings: `"km"` → `"mi"`, `"kilometers"` → `"miles"`
- Rename variables: `_km` → `_mi`, `_kmh` → `_mph`, `KM` → `MI`
- Update haversine functions to use miles
- Update speed displays to mph

**Step 3: Update corresponding client expectations for changed API field names**

PatrolPage expects `total_distance_km` and `distance_from_previous_km` from the patrol optimize endpoint — update these to match the new server field names.

DashCamDetailPage may display `distance_km` — update to `distance_mi`.

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: convert all distance measurements from km to miles system-wide"
```

---

## Task 11: Build and Verify

**Step 1: Build client**

```bash
cd client && npx vite build
```

**Step 2: Run typecheck**

```bash
cd client && npx tsc --noEmit
```

**Step 3: Run server tests**

```bash
cd server && npx vitest run
```

**Step 4: Fix any errors and commit**

```bash
git add -A
git commit -m "fix: resolve build errors from district/map enhancement"
```

---

## Execution Order Summary

| Task | Area | Dependencies |
|------|------|-------------|
| 1 | District CRUD + call-density + reload endpoints | None |
| 2 | Geofence fixes (nearest-beat, hot-reload, resolver) | Task 1 (reload endpoint) |
| 3 | Admin tree view UI | Task 1 (CRUD endpoints) |
| 4 | Map section-colored beats + labels | None (uses existing data) |
| 5 | Map unit overlay + info windows | Task 4 |
| 6 | Map call density heat map | Task 1 (call-density endpoint) |
| 7 | Map beat boundary editor | Task 2 (reload), Task 4 |
| 8 | Map patrol trail visualization | None (uses existing endpoints) |
| 9 | Dispatch dropdown fixes | Task 2 (resolver fixes) |
| 10 | km → mi conversion | None (independent) |
| 11 | Build and verify | All above |

Tasks 1, 4, 8, 10 can run in parallel. Tasks 2, 3, 5, 6, 7, 9 are sequential within their dependency chains. Task 11 is final.
