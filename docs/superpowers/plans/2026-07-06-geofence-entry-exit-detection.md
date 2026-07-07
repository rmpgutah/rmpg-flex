# Geofence Entry/Exit Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when a unit's GPS position enters or exits a drawn geofence zone, log the transition, and alert connected dispatchers in real time.

**Architecture:** Point-in-polygon detection runs inline in the existing GPS-ingestion route (`src/routes/dispatch/gps.ts`) using the last accepted point of each batch. Zone membership is diffed against a small per-unit state table; a transition writes an audit-trail row and broadcasts a WebSocket alert. The map's existing geofence-alert hook is repointed from a dead-end table to the table the draw tool actually writes to, so drawn zones become visible for the first time.

**Tech Stack:** Cloudflare D1 (SQLite), Hono routes, existing `broadcastAll` WebSocket helper, existing `ToastProvider` on the client. Point-in-polygon math is a plain TypeScript port of the ray-casting algorithm already used (but not exported) in `src/utils/geofence.ts`.

**Full design context:** See `docs/superpowers/specs/2026-07-06-geofence-entry-exit-detection-design.md` for the problem statement and non-goals.

---

### Task 1: Migration — new tables for zone membership + event log

**Files:**
- Create: `migrations/0176_geofence_events.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migrations/0176_geofence_events.sql
CREATE TABLE IF NOT EXISTS unit_geofence_state (
  unit_id     INTEGER PRIMARY KEY,
  zone_id     INTEGER NOT NULL,
  entered_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS geofence_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id     INTEGER NOT NULL,
  zone_id     INTEGER NOT NULL,
  event_type  TEXT NOT NULL CHECK(event_type IN ('enter','exit')),
  latitude    REAL,
  longitude   REAL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_geofence_events_unit ON geofence_events(unit_id, created_at);
CREATE INDEX IF NOT EXISTS idx_geofence_events_zone ON geofence_events(zone_id, created_at);
```

Note: a unit can only be "currently inside" one zone at a time in
`unit_geofence_state` (`unit_id` is the PRIMARY KEY) — if a unit is
physically inside two overlapping zones simultaneously, only the first
zone matched wins the state row. This mirrors the existing "first city
beat wins" simplification in `src/utils/geofence.ts` and is acceptable
per the design's non-goals (no per-zone-overlap precedence rules).

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Expected: migration `0176_geofence_events.sql` applies with no errors.

Run: `wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE name IN ('unit_geofence_state','geofence_events')"`
Expected: both table names returned.

- [ ] **Step 3: Commit**

```bash
git add migrations/0176_geofence_events.sql
git commit -m "feat(geofence): add unit_geofence_state + geofence_events tables"
```

---

### Task 2: Pure geofence math module (TDD)

**Files:**
- Create: `src/utils/geofenceZones.ts`
- Test: `tests/geofenceZones.test.ts`

This isolates the parsing + point-in-polygon + membership-diff logic as
pure functions so they're testable without D1/Workers runtime.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/geofenceZones.test.ts
import { describe, it, expect } from 'vitest';
import { parseZoneFeatures, pointInAnyPolygon, diffZoneMembership, type ParsedZone } from '../src/utils/geofenceZones';

const squareZone: ParsedZone = {
  polygons: [[[
    [-112.0, 40.0], [-111.0, 40.0], [-111.0, 41.0], [-112.0, 41.0], [-112.0, 40.0],
  ]]],
};

describe('parseZoneFeatures', () => {
  it('parses a FeatureCollection of Polygon features (draw-tool shape)', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: squareZone.polygons[0] }, properties: {} },
      ],
    });
    const parsed = parseZoneFeatures(geojson);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].polygons[0][0]).toHaveLength(5);
  });

  it('returns an empty array for invalid JSON instead of throwing', () => {
    expect(parseZoneFeatures('not json')).toEqual([]);
  });

  it('returns an empty array for a FeatureCollection with no polygon features', () => {
    const geojson = JSON.stringify({ type: 'FeatureCollection', features: [] });
    expect(parseZoneFeatures(geojson)).toEqual([]);
  });
});

describe('pointInAnyPolygon', () => {
  it('detects a point inside the polygon', () => {
    expect(pointInAnyPolygon(-111.5, 40.5, squareZone.polygons)).toBe(true);
  });

  it('detects a point outside the polygon', () => {
    expect(pointInAnyPolygon(-105.0, 40.5, squareZone.polygons)).toBe(false);
  });
});

describe('diffZoneMembership', () => {
  it('emits an enter event when a unit newly enters a zone', () => {
    const result = diffZoneMembership(null, 5);
    expect(result).toEqual({ type: 'enter', zoneId: 5 });
  });

  it('emits an exit event when a unit leaves its previous zone with no new zone', () => {
    const result = diffZoneMembership(5, null);
    expect(result).toEqual({ type: 'exit', zoneId: 5 });
  });

  it('emits enter+exit when a unit moves directly from one zone to another', () => {
    const result = diffZoneMembership(5, 7);
    expect(result).toEqual({ type: 'transfer', exitedZoneId: 5, enteredZoneId: 7 });
  });

  it('emits nothing when zone membership is unchanged', () => {
    expect(diffZoneMembership(5, 5)).toBeNull();
    expect(diffZoneMembership(null, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/geofenceZones.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/geofenceZones'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/utils/geofenceZones.ts
// ============================================================
// RMPG Flex — Geofence zone math (pure functions, no D1/Workers deps)
//
// Point-in-polygon test for the geofence_zones table's stored
// geojson_data — a stringified FeatureCollection produced by
// DrawGeofenceTool.tsx (client/src/pages/map/components/DrawGeofenceTool.tsx)
// via @mapbox/mapbox-gl-draw's `draw.getAll()`. Ray-casting logic mirrors
// (but does not import, to keep this module dependency-free of the R2
// binding) pointInRing/pointInPolygon in src/utils/geofence.ts, which
// does the same test against beat boundaries.
// ============================================================

export interface ParsedZone {
  // [polygon][ring][point] = [lng, lat]. ring[0] = outer boundary,
  // ring[1..] = holes (GeoJSON Polygon convention).
  polygons: number[][][][];
}

/** Ray-casting (even-odd) test for a single ring. */
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring AND outside every hole, for one polygon's rings. */
function pointInPolygonRings(lng: number, lat: number, rings: number[][][]): boolean {
  if (rings.length === 0 || !pointInRing(lng, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lng, lat, rings[i])) return false; // in a hole
  }
  return true;
}

/** True if (lat, lng) falls inside ANY polygon in the zone (a zone may be
 *  drawn as multiple disjoint shapes in one FeatureCollection). */
export function pointInAnyPolygon(lng: number, lat: number, polygons: number[][][][]): boolean {
  for (const rings of polygons) {
    if (pointInPolygonRings(lng, lat, rings)) return true;
  }
  return false;
}

/**
 * Parse a geofence_zones.geojson_data string (a FeatureCollection of
 * Polygon/MultiPolygon features) into flattened polygon-ring arrays.
 * Never throws — malformed/empty input returns an empty array so a bad
 * row can't break the whole detection pass for every other zone.
 */
export function parseZoneFeatures(geojsonData: string): ParsedZone[] {
  let parsed: any;
  try {
    parsed = JSON.parse(geojsonData);
  } catch {
    return [];
  }
  const features = Array.isArray(parsed?.features) ? parsed.features : [];
  const zones: ParsedZone[] = [];
  for (const f of features) {
    const geom = f?.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
      zones.push({ polygons: [geom.coordinates] });
    } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
      zones.push({ polygons: geom.coordinates });
    }
  }
  return zones;
}

export type ZoneTransition =
  | { type: 'enter'; zoneId: number }
  | { type: 'exit'; zoneId: number }
  | { type: 'transfer'; exitedZoneId: number; enteredZoneId: number };

/**
 * Compare a unit's previous zone membership (or null if outside every
 * zone) against its current membership, and return the transition to
 * record, or null if nothing changed. A unit can only be "in" one zone
 * at a time in this model (see Task 1's migration note on
 * unit_geofence_state) — if it's simultaneously inside two overlapping
 * zones, the caller picks one currentZoneId (first match wins).
 */
export function diffZoneMembership(
  previousZoneId: number | null,
  currentZoneId: number | null,
): ZoneTransition | null {
  if (previousZoneId === currentZoneId) return null;
  if (previousZoneId === null && currentZoneId !== null) {
    return { type: 'enter', zoneId: currentZoneId };
  }
  if (previousZoneId !== null && currentZoneId === null) {
    return { type: 'exit', zoneId: previousZoneId };
  }
  // both non-null and different
  return { type: 'transfer', exitedZoneId: previousZoneId as number, enteredZoneId: currentZoneId as number };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/geofenceZones.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/geofenceZones.ts tests/geofenceZones.test.ts
git commit -m "feat(geofence): add pure zone-parsing + point-in-polygon + membership-diff module"
```

---

### Task 3: Wire detection into GPS ingestion

**Files:**
- Modify: `src/routes/dispatch/gps.ts`
- Test: `tests/geofenceDetection.test.ts` (integration-style, mocked D1)

`gps.post('/')` already resolves `unitId` and the last accepted point
(`lastPt`) — see the existing code around the unit-resolution block. Add
a best-effort detection step right after the unit is known, before the
handler's final response.

- [ ] **Step 1: Read the current handler to find the insertion point**

Run: `grep -n "const lastPt = points" src/routes/dispatch/gps.ts`
Confirm the line number — this plan assumes `lastPt` and `unitId` are
already in scope by the point this new block is inserted (both exist per
the code read during design; re-verify before editing since gps.ts may
have moved since this plan was written).

- [ ] **Step 2: Add the import**

At the top of `src/routes/dispatch/gps.ts`, alongside the existing imports:

```typescript
import { parseZoneFeatures, pointInAnyPolygon, diffZoneMembership } from '../../utils/geofenceZones';
import { broadcastAll } from '../ws';
```

- [ ] **Step 3: Add the detection block**

Insert this after `unitId` is resolved and `lastPt` is available (after
the off-duty drop-check, so we don't geofence-alert on stale/off-duty
pings):

```typescript
    // ── Geofence entry/exit detection ──────────────────────────────────
    // Best-effort: must never block GPS ingestion. A unit can only be
    // "inside" one zone at a time in unit_geofence_state (see migration
    // 0176's note) — first zone matched for this point wins if zones
    // overlap. Every active zone_type triggers detection (no filtering).
    if (unitId != null) {
      try {
        const zoneRows = await query<{ id: number; zone_name: string; zone_type: string; geojson_data: string }>(
          db, 'SELECT id, zone_name, zone_type, geojson_data FROM geofence_zones WHERE is_active = 1');

        let currentZoneId: number | null = null;
        let currentZoneName: string | null = null;
        let currentZoneType: string | null = null;
        for (const z of zoneRows) {
          const parsed = parseZoneFeatures(z.geojson_data);
          const inside = parsed.some((zone) => pointInAnyPolygon(lastPt.longitude, lastPt.latitude, zone.polygons));
          if (inside) {
            currentZoneId = z.id;
            currentZoneName = z.zone_name;
            currentZoneType = z.zone_type;
            break;
          }
        }

        const priorState = await queryFirst<{ zone_id: number }>(
          db, 'SELECT zone_id FROM unit_geofence_state WHERE unit_id = ?', unitId);
        const transition = diffZoneMembership(priorState?.zone_id ?? null, currentZoneId);

        if (transition) {
          const zoneNameById = new Map(zoneRows.map((z) => [z.id, z.zone_name]));
          const zoneTypeById = new Map(zoneRows.map((z) => [z.id, z.zone_type]));
          const events: Array<{ zoneId: number; eventType: 'enter' | 'exit' }> =
            transition.type === 'enter' ? [{ zoneId: transition.zoneId, eventType: 'enter' }]
            : transition.type === 'exit' ? [{ zoneId: transition.zoneId, eventType: 'exit' }]
            : [{ zoneId: transition.exitedZoneId, eventType: 'exit' }, { zoneId: transition.enteredZoneId, eventType: 'enter' }];

          for (const ev of events) {
            await execute(db,
              `INSERT INTO geofence_events (unit_id, zone_id, event_type, latitude, longitude) VALUES (?, ?, ?, ?, ?)`,
              unitId, ev.zoneId, ev.eventType, lastPt.latitude, lastPt.longitude);
            broadcastAll('geofence_alert', {
              unit_id: unitId,
              call_sign: callSign,
              zone_id: ev.zoneId,
              zone_name: zoneNameById.get(ev.zoneId) ?? currentZoneName,
              zone_type: zoneTypeById.get(ev.zoneId) ?? currentZoneType,
              event_type: ev.eventType,
              latitude: lastPt.latitude,
              longitude: lastPt.longitude,
            });
          }

          if (currentZoneId != null) {
            await execute(db,
              `INSERT INTO unit_geofence_state (unit_id, zone_id, entered_at) VALUES (?, ?, datetime('now'))
               ON CONFLICT(unit_id) DO UPDATE SET zone_id = excluded.zone_id, entered_at = excluded.entered_at`,
              unitId, currentZoneId);
          } else {
            await execute(db, 'DELETE FROM unit_geofence_state WHERE unit_id = ?', unitId);
          }
        }
      } catch (err) {
        log.error('[gps] geofence detection failed', { unitId }, err as Error);
      }
    }
```

- [ ] **Step 4: Write the integration test**

```typescript
// tests/geofenceDetection.test.ts
import { describe, it, expect } from 'vitest';
import { parseZoneFeatures, pointInAnyPolygon, diffZoneMembership } from '../src/utils/geofenceZones';

// This exercises the same three functions gps.ts composes, using the exact
// FeatureCollection shape DrawGeofenceTool.tsx produces (draw.getAll()),
// to catch a schema mismatch between the draw tool's saved shape and the
// detection code's parsing — the actual bug this feature was built to fix.
describe('geofence detection composition (draw-tool shape)', () => {
  const drawToolGeojson = JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      id: 'abc123',
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-111.95, 40.70], [-111.85, 40.70], [-111.85, 40.80], [-111.95, 40.80], [-111.95, 40.70],
        ]],
      },
    }],
  });

  it('detects a unit entering a zone drawn via the map tool', () => {
    const zones = parseZoneFeatures(drawToolGeojson);
    const inside = zones.some((z) => pointInAnyPolygon(-111.90, 40.75, z.polygons));
    expect(inside).toBe(true);

    const transition = diffZoneMembership(null, inside ? 42 : null);
    expect(transition).toEqual({ type: 'enter', zoneId: 42 });
  });

  it('detects a unit exiting after moving outside the zone', () => {
    const zones = parseZoneFeatures(drawToolGeojson);
    const inside = zones.some((z) => pointInAnyPolygon(-105.0, 40.75, z.polygons));
    expect(inside).toBe(false);

    const transition = diffZoneMembership(42, inside ? 42 : null);
    expect(transition).toEqual({ type: 'exit', zoneId: 42 });
  });
});
```

- [ ] **Step 5: Run all new/affected tests**

Run: `npx vitest run tests/geofenceZones.test.ts tests/geofenceDetection.test.ts`
Expected: PASS (11 tests total)

- [ ] **Step 6: Typecheck the worker**

Run: `npm run typecheck`
Expected: no new errors in `src/routes/dispatch/gps.ts` or `src/utils/geofenceZones.ts`

- [ ] **Step 7: Commit**

```bash
git add src/routes/dispatch/gps.ts tests/geofenceDetection.test.ts
git commit -m "feat(geofence): detect zone entry/exit on GPS ingest, log + broadcast"
```

---

### Task 4: Fix the map's geofence hook to read the correct table

**Files:**
- Modify: `client/src/hooks/useMapGeofenceAlerts.ts`
- Test: `client/src/hooks/__tests__/useMapGeofenceAlerts.test.ts` (new — check current dir for an existing test file with this name first; if absent, create it)

**Files:** re-check: run `find client/src -iname "*useMapGeofenceAlerts*"` before starting — confirm there is no existing test file to avoid duplicating one.

- [ ] **Step 1: Update the fetch URL and response mapping**

In `client/src/hooks/useMapGeofenceAlerts.ts`, replace the `refreshGeofences`
callback:

```typescript
  // Fetch geofence zones
  const refreshGeofences = useCallback(async () => {
    try {
      // geofence_zones is the table DrawGeofenceTool.tsx actually writes to
      // (POST /geofences). This hook previously read '/dispatch/calls/geofences'
      // — a DIFFERENT table nothing else populates — so a zone drawn on the
      // map never showed up here; it looked like drawing silently failed.
      const rows = await apiFetch<Array<{
        id: number; zone_name: string; zone_type: string;
        geojson_data: string; color: string; is_active: number;
      }>>('/geofences');
      const parsed: GeofenceZone[] = asArray(rows).flatMap((row) => {
        let fc: any;
        try { fc = JSON.parse(row.geojson_data); } catch { return []; }
        const features = Array.isArray(fc?.features) ? fc.features : [];
        return features
          .filter((f: any) => f?.geometry?.type === 'Polygon' && Array.isArray(f.geometry.coordinates?.[0]))
          .map((f: any) => ({
            id: String(row.id),
            name: row.zone_name,
            type: (row.zone_type as GeofenceZone['type']) || 'watch',
            coordinates: f.geometry.coordinates[0].slice(0, -1) as [number, number][], // drop closing point (GeoJSON ring repeats it; the renderer re-closes it itself)
            color: row.color,
            active: row.is_active === 1,
          }));
      });
      setGeofences(parsed);
    } catch (err) {
      devWarn('[GeofenceAlerts] Failed to fetch geofences', err);
    }
  }, []);
```

Note: `GeofenceZone['type']` in this file is currently typed as
`'perimeter' | 'exclusion' | 'watch'`, but `geofence_zones.zone_type` is
`'exclusion' | 'inclusion' | 'alert' | 'patrol_required'` (see the CHECK
constraint in migration `0047_spillman_modules.sql`). Update the
`GeofenceZone` interface's `type` field and `ZONE_TYPE_COLORS` map in the
same file to use the real four values:

```typescript
export interface GeofenceZone {
  id: string;
  name: string;
  type: 'exclusion' | 'inclusion' | 'alert' | 'patrol_required';
  coordinates: [number, number][];
  color: string;
  active: boolean;
}
```

```typescript
const ZONE_TYPE_COLORS: Record<string, string> = {
  exclusion: '#ef4444',
  alert: '#f59e0b',
  inclusion: '#22c55e',
  patrol_required: '#3b82f6',
};
```

- [ ] **Step 2: Write a test for the mapping**

```typescript
// client/src/hooks/__tests__/useMapGeofenceAlerts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMapGeofenceAlerts } from '../useMapGeofenceAlerts';
import * as useApiModule from '../useApi';

vi.mock('../useApi', () => ({ apiFetch: vi.fn() }));

describe('useMapGeofenceAlerts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches from /geofences (not the dead /dispatch/calls/geofences path) and parses geojson_data', async () => {
    const mockRow = {
      id: 7,
      zone_name: 'HQ Perimeter',
      zone_type: 'exclusion',
      color: '#ef4444',
      is_active: 1,
      geojson_data: JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[[-111.9, 40.7], [-111.8, 40.7], [-111.8, 40.8], [-111.9, 40.8], [-111.9, 40.7]]],
          },
        }],
      }),
    };
    vi.mocked(useApiModule.apiFetch).mockResolvedValue([mockRow]);

    const { result } = renderHook(() => useMapGeofenceAlerts(null, false));
    act(() => result.current.setEnabled(true));

    await waitFor(() => expect(result.current.geofences).toHaveLength(1));
    expect(useApiModule.apiFetch).toHaveBeenCalledWith('/geofences');
    expect(result.current.geofences[0]).toMatchObject({
      id: '7', name: 'HQ Perimeter', type: 'exclusion', active: true,
    });
    expect(result.current.geofences[0].coordinates).toHaveLength(4); // closing point dropped
  });
});
```

- [ ] **Step 3: Run the test**

Run: `cd client && npx vitest run src/hooks/__tests__/useMapGeofenceAlerts.test.ts`
Expected: PASS

- [ ] **Step 4: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useMapGeofenceAlerts.ts client/src/hooks/__tests__/useMapGeofenceAlerts.test.ts
git commit -m "fix(geofence): point useMapGeofenceAlerts at the table the draw tool writes to"
```

---

### Task 5: Dispatcher toast on geofence entry/exit

**Files:**
- Modify: `client/src/pages/dispatch/DispatchPage.tsx`
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Add the subscription in DispatchPage.tsx**

Find the existing `panic_alert` subscription (`grep -n "subscribe('panic_alert'" client/src/pages/dispatch/DispatchPage.tsx`) and add a sibling subscription in the same `useEffect` block, unsubscribing it alongside the others:

```typescript
    // Geofence entry/exit alert — mirrors the panic_alert handler above.
    const unsubGeofence = subscribe('geofence_alert', (msg: any) => {
      const data = msg.data || msg;
      const verb = data.event_type === 'enter' ? 'entered' : 'exited';
      addToast(`${data.call_sign ?? 'Unit'} ${verb} ${data.zone_name ?? 'geofence zone'}`, 'info');
    });
```

Add `unsubGeofence()` to the effect's cleanup return alongside the other `unsub*()` calls, and add `unsubGeofence` is local to the effect (no dependency-array change needed beyond what `addToast`/`subscribe` already require — confirm `addToast` is already in the surrounding effect's dependency array; if not, this indicates the effect wasn't re-running on toast-context changes already, which is pre-existing behavior — do not change the dependency array beyond what's needed to reference `addToast`).

- [ ] **Step 2: Add the same subscription in MapboxMapPage.tsx**

In the `useEffect` added by the earlier map-audit PR (`grep -n "subscribe('unit_position'" client/src/pages/map/MapboxMapPage.tsx`), add:

```typescript
    const unsub4 = subscribe('geofence_alert', (msg: any) => {
      const data = msg.data || msg;
      const verb = data.event_type === 'enter' ? 'entered' : 'exited';
      addToast(`${data.call_sign ?? 'Unit'} ${verb} ${data.zone_name ?? 'geofence zone'}`, 'info');
    });
```

Update the effect's cleanup to `return () => { unsub1(); unsub2(); unsub3(); unsub4(); };` and confirm `addToast` is destructured from `useToast()` already in this file (it is — `const { addToast } = useToast();` per line 312 as of this plan's writing; re-verify the line number before editing).

- [ ] **Step 3: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Manual smoke check (no automated test — this is a thin wiring change over already-tested primitives)**

Since `subscribe`/`addToast` are both already covered by existing tests
elsewhere in the codebase, and this task only wires two existing, tested
systems together, skip adding a new test file for this task. If a
reviewer wants coverage, the pattern to mirror is whatever test (if any)
exists for the `panic_alert` handler in `DispatchPage.tsx` — check for one
before deciding this needs new tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/dispatch/DispatchPage.tsx client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(geofence): toast dispatchers on zone entry/exit"
```

---

### Task 6: Full verification pass

- [ ] **Step 1: Run the full worker test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new `geofenceZones.test.ts` and `geofenceDetection.test.ts`

- [ ] **Step 2: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: all tests pass, including the new `useMapGeofenceAlerts.test.ts`

- [ ] **Step 3: Run both typechecks**

Run: `npm run typecheck && cd client && npx tsc --noEmit`
Expected: no errors introduced by this feature (pre-existing unrelated errors, e.g. missing optional packages, are expected and not this feature's responsibility)

- [ ] **Step 4: Apply the migration to live D1 per project convention**

This repo's CLAUDE.md requires migrations be applied directly after merge
because the deploy step is `continue-on-error`. After this PR merges to
main:

```bash
scripts/apply-migration.sh 0176_geofence_events.sql
```

Then verify:

```bash
wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM sqlite_master WHERE name IN ('unit_geofence_state','geofence_events')"
```

Expected: both table names returned.
