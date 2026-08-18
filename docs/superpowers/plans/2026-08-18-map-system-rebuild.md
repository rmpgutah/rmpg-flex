# Map System Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor MapboxMapPage.tsx from 2,331 lines into a canvas orchestrator (~400 lines), add a role-adaptive layout shell, then add assignment arcs, beat management panel, and Search Box v6 as a separate PR.

**Architecture:** Two PRs. PR A extracts subsystem hooks from MapboxMapPage, resolves duplicate files, and adds MapContext + role-adaptive layout components. PR B layers assignment arc visualization, a beat management side panel, and a Search Box v6 upgrade on top of the new architecture.

**Tech Stack:** React 18, TypeScript, Mapbox GL JS ^3.27, `@deck.gl/mapbox ^9.3.6` (arc layer already in project), `@mapbox/mapbox-gl-geocoder ^5.1.2` (current, will be upgraded in PR B Task 11), Vitest, Hono Worker API.

## Global Constraints

- **Never move or alter the Mapbox GL container `<div>`** — `absolute inset-0` collapses to ~12px when position is wrong; mapbox-gl.css wins on source order. Keep the canvas div exactly where it is in MapboxMapPage.
- **No hardcoded hex** — all colors via CSS variables / Tailwind tokens from `client/src/styles/theme-palettes.css`.
- **Radius 2px everywhere** — never `rounded-lg`.
- **`useLiveSync` stays in MapboxMapPage** — WebSocket auth is at upgrade time; must remain at the top level.
- **All D1 queries are async** — `await db.prepare(...).first()`.
- **Use `log.error` from `src/utils/logger`** for all Worker-side error logging.
- **Full client vitest suite must pass** before each PR — `cd client && npx vitest run`.
- **Worker typecheck must pass** — `npm run typecheck`.
- Role strings from JWT: `admin`, `manager`, `supervisor`, `dispatcher`, `officer`, `client_viewer`. Guard: `isSupervisorPlus = ['admin', 'manager', 'supervisor'].includes(role)`.

---

## PR A — Structural Refactor + Role-Adaptive UI

---

### Task 1: Resolve Duplicate `mapMarkers.ts`

**Files:**
- Keep: `client/src/pages/map/utils/mapMarkers.ts` (imported by MapboxMapPage at line 134 — 10 referencing files in pages/map tree)
- Delete: `client/src/utils/mapMarkers.ts` (10 files import this version — update all imports)
- Delete: `client/src/utils/__tests__/mapMarkers.test.ts` (move test to `client/src/pages/map/utils/__tests__/mapMarkers.test.ts` if not already present)
- Update: all files that import from `../../utils/mapMarkers` or `../utils/mapMarkers` outside the map page tree

**Interfaces:**
- Produces: single canonical `client/src/pages/map/utils/mapMarkers.ts`

- [ ] **Step 1: Find all import sites for the utils/mapMarkers version**

```bash
grep -rn "from.*utils/mapMarkers" client/src --include="*.ts" --include="*.tsx" | grep -v "pages/map"
```

Expected output: a list of files (gpsStaleness.ts, hexClassifier.ts, statusColors.ts, withAlpha.ts, ForensicTrackMap.tsx, etc.)

- [ ] **Step 2: Compare the two files to identify any unique exports**

```bash
diff client/src/utils/mapMarkers.ts client/src/pages/map/utils/mapMarkers.ts
```

If `pages/map` version is a superset, proceed. If `utils/` has unique exports the other lacks, copy them into `pages/map/utils/mapMarkers.ts` first.

- [ ] **Step 3: Update all non-map-page imports to point to the canonical path**

For each file found in Step 1, change the import path. Example for `client/src/components/ForensicTrackMap.tsx`:

```ts
// Before:
import { buildUnitMarkerEl } from '../utils/mapMarkers';
// After:
import { buildUnitMarkerEl } from '../pages/map/utils/mapMarkers';
```

Adjust relative path depth per file location.

- [ ] **Step 4: Delete the duplicate and its test**

```bash
rm client/src/utils/mapMarkers.ts
rm client/src/utils/__tests__/mapMarkers.test.ts
```

- [ ] **Step 5: Verify no remaining imports from the deleted path**

```bash
grep -rn "utils/mapMarkers" client/src --include="*.ts" --include="*.tsx" | grep -v "pages/map"
```

Expected: no output.

- [ ] **Step 6: Run client typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: 0 new errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(map): resolve duplicate mapMarkers.ts — canonical is pages/map/utils/"
```

---

### Task 2: Resolve Duplicate `useMapBreadcrumbs.ts`

**Files:**
- Compare: `client/src/hooks/useMapBreadcrumbs.ts` (312 lines) vs `client/src/pages/map/hooks/useMapBreadcrumbs.ts` (478 lines)
- MapboxMapPage currently imports from `../../hooks/useMapBreadcrumbs` (line 81)
- Keep whichever is the superset; update MapboxMapPage import if switching

**Interfaces:**
- Produces: single canonical `useMapBreadcrumbs`

- [ ] **Step 1: Diff the two files**

```bash
diff client/src/hooks/useMapBreadcrumbs.ts client/src/pages/map/hooks/useMapBreadcrumbs.ts
```

The pages/map version (478 lines) is likely the superset. Confirm it exports the same function signature as the shorter version.

- [ ] **Step 2: Update MapboxMapPage import to point to the pages/map version**

In `client/src/pages/map/MapboxMapPage.tsx` line 81:

```ts
// Before:
import { useMapBreadcrumbs } from '../../hooks/useMapBreadcrumbs';
// After:
import { useMapBreadcrumbs } from './hooks/useMapBreadcrumbs';
```

- [ ] **Step 3: Check for any other imports of the shorter version**

```bash
grep -rn "from.*hooks/useMapBreadcrumbs" client/src --include="*.ts" --include="*.tsx"
```

Update any found imports to point to the canonical path.

- [ ] **Step 4: Delete the shorter duplicate**

```bash
rm client/src/hooks/useMapBreadcrumbs.ts
```

- [ ] **Step 5: Run client typecheck and tests**

```bash
cd client && npx tsc --noEmit && npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: 0 new errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(map): resolve duplicate useMapBreadcrumbs.ts — canonical is pages/map/hooks/"
```

---

### Task 3: Create MapContext

**Files:**
- Create: `client/src/pages/map/MapContext.ts`

**Interfaces:**
- Produces: `MapContext`, `useMapContext()`, `MapContextValue` — consumed by Tasks 4–8

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/map/__tests__/MapContext.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { MapContext, useMapContext } from '../MapContext';

describe('useMapContext', () => {
  it('returns null map when no provider', () => {
    const { result } = renderHook(() => useMapContext());
    expect(result.current.map).toBeNull();
    expect(result.current.units).toEqual([]);
    expect(result.current.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/pages/map/__tests__/MapContext.test.ts
```

Expected: FAIL — "Cannot find module '../MapContext'"

- [ ] **Step 3: Create MapContext**

Create `client/src/pages/map/MapContext.ts`:

```ts
import { createContext, useContext } from 'react';
import type mapboxgl from 'mapbox-gl';

export interface MapContextValue {
  map: mapboxgl.Map | null;
  units: Array<{
    id: number;
    call_sign: string;
    status: string;
    latitude: number | null;
    longitude: number | null;
    current_call_type?: string | null;
    call_number?: string | null;
  }>;
  calls: Array<{
    call_number: string;
    latitude: number | null;
    longitude: number | null;
    priority?: number | null;
    incident_type?: string | null;
  }>;
  beats: Array<{
    id: number;
    name: string;
    geojson?: unknown;
  }>;
}

const defaultValue: MapContextValue = {
  map: null,
  units: [],
  calls: [],
  beats: [],
};

export const MapContext = createContext<MapContextValue>(defaultValue);

export function useMapContext(): MapContextValue {
  return useContext(MapContext);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd client && npx vitest run src/pages/map/__tests__/MapContext.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/MapContext.ts client/src/pages/map/__tests__/MapContext.test.ts
git commit -m "feat(map): add MapContext for map ref + live-sync state distribution"
```

---

### Task 4: Extract `useMapIsochrone`

**Files:**
- Create: `client/src/pages/map/hooks/useMapIsochrone.ts`
- Create: `client/src/pages/map/hooks/__tests__/useMapIsochrone.test.ts`
- Modify: `client/src/pages/map/MapboxMapPage.tsx` (remove inline isochrone logic, import hook)

**Interfaces:**
- Consumes: `MapContext` (for `map`), `mapLoaded: boolean`, `gpsLatitude: number | null`, `gpsLongitude: number | null`, `addToast: (msg: string, type: string) => void`
- Produces: `{ isochroneEnabled: boolean; toggleIsochrone: () => Promise<void> }`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/map/hooks/__tests__/useMapIsochrone.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMapIsochrone } from '../useMapIsochrone';

describe('useMapIsochrone', () => {
  it('returns false and a function when map is null', () => {
    const { result } = renderHook(() =>
      useMapIsochrone({ map: null, mapLoaded: false, gpsLatitude: null, gpsLongitude: null, addToast: vi.fn() })
    );
    expect(result.current.isochroneEnabled).toBe(false);
    expect(typeof result.current.toggleIsochrone).toBe('function');
  });

  it('toggleIsochrone is a no-op when map is null', async () => {
    const { result } = renderHook(() =>
      useMapIsochrone({ map: null, mapLoaded: false, gpsLatitude: null, gpsLongitude: null, addToast: vi.fn() })
    );
    // Should not throw
    await result.current.toggleIsochrone();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/pages/map/hooks/__tests__/useMapIsochrone.test.ts
```

Expected: FAIL — "Cannot find module '../useMapIsochrone'"

- [ ] **Step 3: Extract the isochrone logic into the hook**

Create `client/src/pages/map/hooks/useMapIsochrone.ts` by lifting the `toggleIsochrone` callback and `isochroneEnabled` state from `MapboxMapPage.tsx` (lines ~1363–1418):

```ts
import { useState, useCallback } from 'react';
import type mapboxgl from 'mapbox-gl';
import { mapboxIsochrone } from '../../../services/mapboxApiService';
import { safeRemoveLayer, safeRemoveSource, upsertGeoJsonSource, hasLayer } from '../utils/mapHelpers';

const ISOCHRONE_COLORS = ['#00b050', '#ffc000', '#ff0000'];
const MINUTE_CONTOURS = [5, 10, 15];

interface UseMapIsochroneOptions {
  map: mapboxgl.Map | null;
  mapLoaded: boolean;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  addToast: (msg: string, type: string) => void;
}

interface UseMapIsochroneResult {
  isochroneEnabled: boolean;
  toggleIsochrone: () => Promise<void>;
}

export function useMapIsochrone({
  map,
  mapLoaded,
  gpsLatitude,
  gpsLongitude,
  addToast,
}: UseMapIsochroneOptions): UseMapIsochroneResult {
  const [isochroneEnabled, setIsochroneEnabled] = useState(false);

  const toggleIsochrone = useCallback(async () => {
    if (!map || !mapLoaded) return;

    if (isochroneEnabled) {
      ['isochrone-fill-0', 'isochrone-fill-1', 'isochrone-fill-2',
       'isochrone-border-0', 'isochrone-border-1', 'isochrone-border-2'].forEach(id => {
        safeRemoveLayer(map, id);
      });
      safeRemoveSource(map, 'isochrone');
      setIsochroneEnabled(false);
      return;
    }

    const lng = gpsLongitude ?? map.getCenter().lng;
    const lat = gpsLatitude ?? map.getCenter().lat;

    try {
      const data = await mapboxIsochrone(lng, lat, { profile: 'driving', minutes: MINUTE_CONTOURS });
      if (!data?.features) return;

      upsertGeoJsonSource(map, 'isochrone', data as unknown as GeoJSON.FeatureCollection);

      data.features.forEach((_, idx) => {
        const fillId = `isochrone-fill-${idx}`;
        const borderId = `isochrone-border-${idx}`;
        const contourMin = MINUTE_CONTOURS[idx];
        if (!hasLayer(map, fillId)) {
          map.addLayer({ id: fillId, type: 'fill', source: 'isochrone',
            paint: { 'fill-color': ISOCHRONE_COLORS[idx], 'fill-opacity': 0.1 },
            filter: ['==', ['get', 'contour'], contourMin] });
        }
        if (!hasLayer(map, borderId)) {
          map.addLayer({ id: borderId, type: 'line', source: 'isochrone',
            paint: { 'line-color': ISOCHRONE_COLORS[idx], 'line-width': 1.5, 'line-opacity': 0.6 },
            filter: ['==', ['get', 'contour'], contourMin] });
        }
      });
      setIsochroneEnabled(true);
      addToast('Response time zones: 5/10/15 min driving', 'info');
    } catch {
      addToast('Failed to load isochrone data', 'error');
    }
  }, [map, mapLoaded, isochroneEnabled, gpsLatitude, gpsLongitude, addToast]);

  return { isochroneEnabled, toggleIsochrone };
}
```

> **Note:** `safeRemoveLayer`, `safeRemoveSource`, `upsertGeoJsonSource`, `hasLayer` are helper functions already used in MapboxMapPage. Check their actual import path (likely `../utils/mapHelpers` or inline in the page) and adjust the import accordingly.

- [ ] **Step 4: In MapboxMapPage.tsx, replace inline isochrone logic with the hook**

Remove the `isochroneEnabled` state and `toggleIsochrone` callback from MapboxMapPage (~lines 199, 1363–1418). Add:

```ts
import { useMapIsochrone } from './hooks/useMapIsochrone';
// ...inside the component:
const { isochroneEnabled, toggleIsochrone } = useMapIsochrone({
  map: mapRef.current,
  mapLoaded,
  gpsLatitude: gps.latitude,
  gpsLongitude: gps.longitude,
  addToast,
});
```

- [ ] **Step 5: Run test and typecheck**

```bash
cd client && npx vitest run src/pages/map/hooks/__tests__/useMapIsochrone.test.ts && npx tsc --noEmit
```

Expected: tests PASS, 0 new type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(map): extract useMapIsochrone from MapboxMapPage"
```

---

### Task 5: Extract `useMapGps`

**Files:**
- Create: `client/src/pages/map/hooks/useMapGps.ts`
- Create: `client/src/pages/map/hooks/__tests__/useMapGps.test.ts`
- Modify: `client/src/pages/map/MapboxMapPage.tsx` (remove GPS-trail self-marker rendering logic, import hook)

**Interfaces:**
- Consumes: `map: mapboxgl.Map | null`, `mapLoaded: boolean`, `gps: { latitude: number | null; longitude: number | null; heading: number | null; accuracy: number | null; speed: number | null }`
- Produces: `{ selfMarkerReady: boolean }` (side effects: places + updates the self marker on the map)

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/map/hooks/__tests__/useMapGps.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMapGps } from '../useMapGps';

describe('useMapGps', () => {
  it('returns selfMarkerReady=false when map is null', () => {
    const { result } = renderHook(() =>
      useMapGps({ map: null, mapLoaded: false, gps: { latitude: null, longitude: null, heading: null, accuracy: null, speed: null } })
    );
    expect(result.current.selfMarkerReady).toBe(false);
  });

  it('does not throw when gps position is null', () => {
    const { result } = renderHook(() =>
      useMapGps({ map: null, mapLoaded: true, gps: { latitude: null, longitude: null, heading: null, accuracy: null, speed: null } })
    );
    expect(result.current).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/pages/map/hooks/__tests__/useMapGps.test.ts
```

Expected: FAIL — "Cannot find module '../useMapGps'"

- [ ] **Step 3: Identify the GPS self-marker block in MapboxMapPage**

Search for the self-marker `useEffect` in MapboxMapPage — it contains `data-role="self-arrow"`, `data-role="self-dot"`, `data-role="self-speed"`, `data-role="self-accuracy"` (lines ~1150–1230). Also find the `selfMarkerRef` declaration. These are the lines to lift.

- [ ] **Step 4: Create the hook**

Create `client/src/pages/map/hooks/useMapGps.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { buildUnitMarkerEl, applyUnitMarkerState } from '../utils/mapMarkers';

interface GpsState {
  latitude: number | null;
  longitude: number | null;
  heading: number | null;
  accuracy: number | null;
  speed: number | null;
}

interface UseMapGpsOptions {
  map: mapboxgl.Map | null;
  mapLoaded: boolean;
  gps: GpsState;
}

interface UseMapGpsResult {
  selfMarkerReady: boolean;
}

export function useMapGps({ map, mapLoaded, gps }: UseMapGpsOptions): UseMapGpsResult {
  const selfMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [selfMarkerReady, setSelfMarkerReady] = useState(false);

  useEffect(() => {
    if (!map || !mapLoaded || gps.latitude == null || gps.longitude == null) return;

    if (!selfMarkerRef.current) {
      const el = buildUnitMarkerEl('self');
      selfMarkerRef.current = new (window as any).mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([gps.longitude, gps.latitude])
        .addTo(map);
      setSelfMarkerReady(true);
    } else {
      selfMarkerRef.current.setLngLat([gps.longitude, gps.latitude]);
    }

    applyUnitMarkerState(selfMarkerRef.current.getElement(), {
      heading: gps.heading,
      accuracy: gps.accuracy,
      speed: gps.speed,
    });
  }, [map, mapLoaded, gps.latitude, gps.longitude, gps.heading, gps.accuracy, gps.speed]);

  useEffect(() => {
    return () => {
      selfMarkerRef.current?.remove();
      selfMarkerRef.current = null;
    };
  }, []);

  return { selfMarkerReady };
}
```

> **Note:** The actual self-marker creation code in MapboxMapPage is more detailed (SVG arrow, accuracy ring, speed label). Lift the *exact* existing implementation from MapboxMapPage into this hook rather than simplifying it. The code above is a structural template — copy the real logic from the page.

- [ ] **Step 5: Replace in MapboxMapPage**

Remove `selfMarkerRef` declaration and the self-marker `useEffect` block from MapboxMapPage. Add:

```ts
import { useMapGps } from './hooks/useMapGps';
// inside component:
const { selfMarkerReady } = useMapGps({ map: mapRef.current, mapLoaded, gps });
```

If `selfMarkerReady` was used downstream in MapboxMapPage, wire it through the hook result.

- [ ] **Step 6: Run tests and typecheck**

```bash
cd client && npx vitest run src/pages/map/hooks/__tests__/useMapGps.test.ts && npx tsc --noEmit
```

Expected: PASS, 0 new errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(map): extract useMapGps self-marker logic from MapboxMapPage"
```

---

### Task 6: Extract `useMapWelfare` and `useMapBeatOverlay`

**Files:**
- Create: `client/src/pages/map/hooks/useMapWelfare.ts`
- Create: `client/src/pages/map/hooks/useMapBeatOverlay.ts`
- Create: `client/src/pages/map/hooks/__tests__/useMapWelfare.test.ts`
- Create: `client/src/pages/map/hooks/__tests__/useMapBeatOverlay.test.ts`
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

**Interfaces:**
- `useMapWelfare` consumes: `map | null`, `mapLoaded`, `units[]` → side effects only (places welfare warning overlays on units past their welfare-check time); produces `{}`
- `useMapBeatOverlay` consumes: `map | null`, `mapLoaded`, `beats[]`, `beatLayerVisible: boolean` → side effects (renders beat boundary GeoJSON layer); produces `{}`

- [ ] **Step 1: Write failing tests**

Create `client/src/pages/map/hooks/__tests__/useMapWelfare.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMapWelfare } from '../useMapWelfare';

describe('useMapWelfare', () => {
  it('does not throw with null map and empty units', () => {
    expect(() =>
      renderHook(() => useMapWelfare({ map: null, mapLoaded: false, units: [] }))
    ).not.toThrow();
  });
});
```

Create `client/src/pages/map/hooks/__tests__/useMapBeatOverlay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMapBeatOverlay } from '../useMapBeatOverlay';

describe('useMapBeatOverlay', () => {
  it('does not throw with null map and empty beats', () => {
    expect(() =>
      renderHook(() => useMapBeatOverlay({ map: null, mapLoaded: false, beats: [], beatLayerVisible: false }))
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd client && npx vitest run src/pages/map/hooks/__tests__/useMapWelfare.test.ts src/pages/map/hooks/__tests__/useMapBeatOverlay.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Find welfare and beat overlay logic in MapboxMapPage**

Search for welfare-related effects:

```bash
grep -n "welfare\|WELFARE\|wellbeing" client/src/pages/map/MapboxMapPage.tsx
```

Search for beat overlay logic:

```bash
grep -n "beat.*layer\|layerStates.*beat\|patrol_beat\|beatLayer" client/src/pages/map/MapboxMapPage.tsx
```

Identify the `useEffect` blocks that own this logic. Note their dependencies.

- [ ] **Step 4: Create `useMapWelfare`**

Create `client/src/pages/map/hooks/useMapWelfare.ts`:

```ts
import { useEffect } from 'react';
import type mapboxgl from 'mapbox-gl';

interface Unit {
  id: number;
  latitude: number | null;
  longitude: number | null;
  status: string;
  last_welfare_check?: string | null;
}

interface UseMapWelfareOptions {
  map: mapboxgl.Map | null;
  mapLoaded: boolean;
  units: Unit[];
}

export function useMapWelfare({ map, mapLoaded, units }: UseMapWelfareOptions): void {
  useEffect(() => {
    if (!map || !mapLoaded) return;
    // Lift the exact welfare overlay effect from MapboxMapPage here.
    // The effect places warning badges on unit markers that are past their welfare-check interval.
    // Cleanup removes those badges.
  }, [map, mapLoaded, units]);
}
```

> **IMPORTANT:** Replace the comment body with the exact lifted code from MapboxMapPage. This template shows structure only.

- [ ] **Step 5: Create `useMapBeatOverlay`**

Create `client/src/pages/map/hooks/useMapBeatOverlay.ts`:

```ts
import { useEffect } from 'react';
import type mapboxgl from 'mapbox-gl';

interface Beat {
  id: number;
  name: string;
  geojson?: unknown;
}

interface UseMapBeatOverlayOptions {
  map: mapboxgl.Map | null;
  mapLoaded: boolean;
  beats: Beat[];
  beatLayerVisible: boolean;
}

export function useMapBeatOverlay({ map, mapLoaded, beats, beatLayerVisible }: UseMapBeatOverlayOptions): void {
  useEffect(() => {
    if (!map || !mapLoaded) return;
    // Lift the exact beat boundary layer effect from MapboxMapPage here.
    // Adds/removes a GeoJSON fill + line layer for patrol beat boundaries.
    return () => {
      // cleanup: remove beat layers from map
    };
  }, [map, mapLoaded, beats, beatLayerVisible]);
}
```

> **IMPORTANT:** Replace with exact lifted code from MapboxMapPage.

- [ ] **Step 6: Wire hooks into MapboxMapPage and remove lifted code**

```ts
import { useMapWelfare } from './hooks/useMapWelfare';
import { useMapBeatOverlay } from './hooks/useMapBeatOverlay';
// inside component:
useMapWelfare({ map: mapRef.current, mapLoaded, units });
useMapBeatOverlay({ map: mapRef.current, mapLoaded, beats, beatLayerVisible: geoJsonLayers.layerStates['beat']?.visible ?? false });
```

- [ ] **Step 7: Run tests and typecheck**

```bash
cd client && npx vitest run src/pages/map/hooks/__tests__/useMapWelfare.test.ts src/pages/map/hooks/__tests__/useMapBeatOverlay.test.ts && npx tsc --noEmit
```

Expected: PASS, 0 new errors.

- [ ] **Step 8: Run full client suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(map): extract useMapWelfare and useMapBeatOverlay from MapboxMapPage"
```

---

### Task 7: Create MapLayout + Role-Adaptive Layouts

**Files:**
- Create: `client/src/pages/map/MapLayout.tsx`
- Create: `client/src/pages/map/layouts/DispatcherMapLayout.tsx`
- Create: `client/src/pages/map/layouts/FieldMapLayout.tsx`
- Create: `client/src/pages/map/layouts/__tests__/MapLayout.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `AuthContext`, `MapContext` (units, calls, beats)
- Produces: role-routed layout shell — `DispatcherMapLayout` or `FieldMapLayout`

- [ ] **Step 1: Write failing layout routing test**

Create `client/src/pages/map/layouts/__tests__/MapLayout.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import MapLayout from '../../../MapLayout';
import { MapContext } from '../../../MapContext';

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));
import { useAuth } from '../../../../context/AuthContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MapContext.Provider value={{ map: null, units: [], calls: [], beats: [] }}>
    {children}
  </MapContext.Provider>
);

describe('MapLayout', () => {
  it('renders DispatcherMapLayout for dispatcher role', () => {
    (useAuth as any).mockReturnValue({ user: { role: 'dispatcher' } });
    render(<MapLayout />, { wrapper });
    expect(screen.getByTestId('dispatcher-map-layout')).toBeTruthy();
  });

  it('renders DispatcherMapLayout for admin role', () => {
    (useAuth as any).mockReturnValue({ user: { role: 'admin' } });
    render(<MapLayout />, { wrapper });
    expect(screen.getByTestId('dispatcher-map-layout')).toBeTruthy();
  });

  it('renders FieldMapLayout for officer role', () => {
    (useAuth as any).mockReturnValue({ user: { role: 'officer' } });
    render(<MapLayout />, { wrapper });
    expect(screen.getByTestId('field-map-layout')).toBeTruthy();
  });

  it('renders FieldMapLayout read-only for client_viewer role', () => {
    (useAuth as any).mockReturnValue({ user: { role: 'client_viewer' } });
    render(<MapLayout />, { wrapper });
    expect(screen.getByTestId('field-map-layout')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/pages/map/layouts/__tests__/MapLayout.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create DispatcherMapLayout**

Create `client/src/pages/map/layouts/DispatcherMapLayout.tsx`:

```tsx
import React from 'react';
import { useAuth } from '../../../context/AuthContext';
import MapLeftDock from '../components/MapLeftDock';
import MapRightDock from '../components/MapRightDock';
import PatrolBeatPlannerModal from '../../../components/PatrolBeatPlannerModal';
import type { V2Route } from '../../../utils/mapboxOptimizationV2';
import { useState } from 'react';

export default function DispatcherMapLayout() {
  const { user } = useAuth();
  const isSupervisorPlus = ['admin', 'manager', 'supervisor'].includes(user?.role ?? '');

  const [showBeatPlanner, setShowBeatPlanner] = useState(false);
  const [beatRoutes, setBeatRoutes] = useState<V2Route[]>([]);

  return (
    <div data-testid="dispatcher-map-layout" className="absolute inset-0 pointer-events-none z-10">
      {/* Left dock — layers panel */}
      <div className="pointer-events-auto">
        <MapLeftDock />
      </div>
      {/* Right dock — calls + units */}
      <div className="pointer-events-auto">
        <MapRightDock />
      </div>
      {/* Supervisor-only controls */}
      {isSupervisorPlus && (
        <button
          onClick={() => setShowBeatPlanner(true)}
          className="pointer-events-auto absolute top-4 right-4 px-3 py-1.5 bg-surface-raised text-brand-200 text-xs border border-brand-600/40 rounded"
          aria-label="Open Beat Planner"
        >
          Beat Planner
        </button>
      )}
      {showBeatPlanner && (
        <PatrolBeatPlannerModal
          onClose={() => setShowBeatPlanner(false)}
          onSolutionReady={(routes) => { setBeatRoutes(routes); setShowBeatPlanner(false); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create FieldMapLayout**

Create `client/src/pages/map/layouts/FieldMapLayout.tsx`:

```tsx
import React from 'react';
import { useAuth } from '../../../context/AuthContext';
import GpsHud from '../components/GpsHud';

export default function FieldMapLayout() {
  const { user } = useAuth();
  const isReadOnly = user?.role === 'client_viewer';

  return (
    <div data-testid="field-map-layout" className="absolute inset-0 pointer-events-none z-10">
      {/* GPS HUD — personal position */}
      <div className="pointer-events-auto absolute bottom-4 left-4">
        <GpsHud />
      </div>
      {/* Field controls hidden for client_viewer */}
      {!isReadOnly && (
        <div className="pointer-events-auto absolute top-4 right-4">
          {/* Beat panel button and nav controls go here */}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create MapLayout router**

Create `client/src/pages/map/MapLayout.tsx`:

```tsx
import React from 'react';
import { useAuth } from '../../context/AuthContext';
import DispatcherMapLayout from './layouts/DispatcherMapLayout';
import FieldMapLayout from './layouts/FieldMapLayout';

const DISPATCHER_ROLES = new Set(['admin', 'manager', 'supervisor', 'dispatcher']);

export default function MapLayout() {
  const { user } = useAuth();
  const role = user?.role ?? '';

  if (DISPATCHER_ROLES.has(role)) return <DispatcherMapLayout />;
  return <FieldMapLayout />;
}
```

- [ ] **Step 6: Run the layout test**

```bash
cd client && npx vitest run src/pages/map/layouts/__tests__/MapLayout.test.tsx
```

Expected: 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(map): add MapLayout, DispatcherMapLayout, FieldMapLayout role-adaptive shells"
```

---

### Task 8: Wire MapContext + MapLayout into MapboxMapPage

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

**Goal:** Provide `MapContext` at the page level; render `<MapLayout />` inside the existing canvas div structure; remove any panel/dock rendering that is now owned by the layout components.

- [ ] **Step 1: Add MapContext.Provider in MapboxMapPage**

In `MapboxMapPage.tsx`, wrap the return JSX with `MapContext.Provider`:

```tsx
import { MapContext } from './MapContext';
import MapLayout from './MapLayout';

// In the return:
return (
  <MapContext.Provider value={{ map: mapRef.current, units, calls, beats }}>
    <div className="relative w-full h-full">
      {/* Mapbox canvas container — DO NOT CHANGE position/classes */}
      <div ref={mapContainerRef} className="absolute inset-0" style={{ zIndex: 0 }} />
      {/* Role-adaptive overlay */}
      <MapLayout />
      {/* Keep tactical overlays (SafetyAlertTicker, MapDiagnosticsOverlay, etc.) here */}
      ...
    </div>
  </MapContext.Provider>
);
```

`units`, `calls`, and `beats` should already be available in the component's state from `useLiveSync`. Wire them through.

- [ ] **Step 2: Remove duplicate panel renders from MapboxMapPage**

Any dock/panel rendering that is now owned by `DispatcherMapLayout` or `FieldMapLayout` should be removed from MapboxMapPage's JSX. Do NOT remove:
- The Mapbox canvas `div`
- `SafetyAlertTicker`, `MapDiagnosticsOverlay`, `StreetViewLightbox`, `AnnotationTool`, `DrawGeofenceTool`, `GpsReplayTool`, `NavOverlayTool`, `BufferRingTool` — these are canvas-level overlays, not dock panels.

- [ ] **Step 3: Run full client typecheck and suite**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: 0 type errors, all tests pass.

- [ ] **Step 4: Start dev server and verify in browser**

```bash
cd client && npm run dev
```

Open http://localhost:5173/map. For each role (use browser devtools to change JWT `role` claim by re-logging in as a different user, or temporarily hardcode `user.role` for visual verification):
- `dispatcher` → DispatcherMapLayout renders, left/right docks visible
- `officer` → FieldMapLayout renders, GPS HUD visible, docks not visible
- `client_viewer` → FieldMapLayout renders, no controls

- [ ] **Step 5: Check MapboxMapPage line count**

```bash
wc -l client/src/pages/map/MapboxMapPage.tsx
```

Expected: ≤ 1800 (PR A partial reduction; full 400-line target requires ongoing extraction across future PRs — this PR makes the structure correct, not necessarily minimal).

- [ ] **Step 6: Run full client suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(map): wire MapContext and MapLayout into MapboxMapPage orchestrator"
```

---

### Task 9: Open PR A

- [ ] **Step 1: Push branch**

```bash
git push origin claude/mapbox-api-integration-0dc062
```

- [ ] **Step 2: Open PR**

```bash
gh pr create \
  --repo rmpgutah/rmpg-flex \
  --base main \
  --title "refactor(map): structural refactor + role-adaptive layout (PR A)" \
  --body "$(cat <<'EOF'
## Summary

- Resolves duplicate `mapMarkers.ts` (canonical: `pages/map/utils/`)
- Resolves duplicate `useMapBreadcrumbs.ts` (canonical: `pages/map/hooks/`)
- Adds `MapContext` distributing map ref + live-sync state
- Extracts `useMapIsochrone`, `useMapGps`, `useMapWelfare`, `useMapBeatOverlay` from MapboxMapPage
- Adds `MapLayout` → `DispatcherMapLayout` / `FieldMapLayout` role-adaptive shell
- Wires MapContext + MapLayout into MapboxMapPage

## Test plan

- [ ] Worker typecheck passes
- [ ] `cd client && npx vitest run` passes
- [ ] Map page loads in browser; role routing verified for dispatcher vs officer
- [ ] Isochrone toggle still works
- [ ] GPS self-marker still updates

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR B — Feature Expansion

> Open a new branch off `main` after PR A is merged.

---

### Task 10: Assignment Arc Layer (Native Mapbox GL)

**Context:** Arc connections already exist in the Deck.gl overlay (MapboxMapPage ~lines 806–821) but are gated behind `deckEnabled`. This task adds a dedicated, always-on native Mapbox GL line layer for assignment arcs — lighter weight and independent of the GPU overlay toggle.

**Files:**
- Create: `client/src/pages/map/layers/AssignmentArcLayer.tsx`
- Create: `client/src/pages/map/layers/__tests__/AssignmentArcLayer.test.tsx`
- Modify: `client/src/pages/map/layouts/DispatcherMapLayout.tsx` (mount the layer)

**Interfaces:**
- Consumes: `MapContext` (map, units, calls)
- Produces: side effect — adds/updates `assignment-arcs` GeoJSON source and `assignment-arcs-line` layer on the Mapbox GL map

- [ ] **Step 1: Write failing test**

Create `client/src/pages/map/layers/__tests__/AssignmentArcLayer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { MapContext } from '../../MapContext';
import AssignmentArcLayer from '../AssignmentArcLayer';

describe('AssignmentArcLayer', () => {
  it('renders without error when map is null', () => {
    expect(() =>
      render(
        <MapContext.Provider value={{ map: null, units: [], calls: [], beats: [] }}>
          <AssignmentArcLayer />
        </MapContext.Provider>
      )
    ).not.toThrow();
  });

  it('renders without error with units lacking assignments', () => {
    const units = [{ id: 1, call_sign: 'U1', status: 'available', latitude: 40.7, longitude: -111.9, current_call_type: null, call_number: null }];
    expect(() =>
      render(
        <MapContext.Provider value={{ map: null, units, calls: [], beats: [] }}>
          <AssignmentArcLayer />
        </MapContext.Provider>
      )
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/pages/map/layers/__tests__/AssignmentArcLayer.test.tsx
```

Expected: FAIL — "Cannot find module '../AssignmentArcLayer'"

- [ ] **Step 3: Create AssignmentArcLayer**

Create `client/src/pages/map/layers/AssignmentArcLayer.tsx`:

```tsx
import { useEffect } from 'react';
import { useMapContext } from '../MapContext';

// CAD severity colors — these match --sev-* palette values exactly (not hex, use rgb via withAlpha)
const PRIORITY_COLORS: Record<number, string> = {
  1: '#ef4444', // sev-critical
  2: '#f97316', // sev-high
  3: '#f59e0b', // sev-warn
  4: '#22c55e', // sev-low
};
const DEFAULT_ARC_COLOR = '#94a3b8'; // silver/muted

const SOURCE_ID = 'assignment-arcs';
const LAYER_ID = 'assignment-arcs-line';

export default function AssignmentArcLayer() {
  const { map, units, calls } = useMapContext();

  useEffect(() => {
    if (!map) return;

    // Build GeoJSON line features: one line per assigned unit
    const features = units
      .filter(u => u.latitude != null && u.longitude != null && u.call_number != null)
      .flatMap(u => {
        const call = calls.find(c => c.call_number === u.call_number);
        if (!call || call.latitude == null || call.longitude == null) return [];
        return [{
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [u.longitude!, u.latitude!],
              [call.longitude!, call.latitude!],
            ],
          },
          properties: { priority: call.priority ?? 4 },
        }];
      });

    const geojson: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };

    if (map.getSource(SOURCE_ID)) {
      (map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource).setData(geojson);
    } else {
      map.addSource(SOURCE_ID, { type: 'geojson', data: geojson });
    }

    if (!map.getLayer(LAYER_ID)) {
      map.addLayer({
        id: LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': [
            'match', ['get', 'priority'],
            1, PRIORITY_COLORS[1],
            2, PRIORITY_COLORS[2],
            3, PRIORITY_COLORS[3],
            DEFAULT_ARC_COLOR,
          ],
          'line-width': 1.5,
          'line-opacity': 0.7,
          'line-dasharray': [2, 3],
        },
      });
    }

    return () => {
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch { /* map may already be destroyed */ }
    };
  }, [map, units, calls]);

  return null; // purely a side-effect component
}
```

> **Note:** Import `mapboxgl` type for the cast: `import type mapboxgl from 'mapbox-gl'`.

- [ ] **Step 4: Mount in DispatcherMapLayout**

In `client/src/pages/map/layouts/DispatcherMapLayout.tsx`, add:

```tsx
import AssignmentArcLayer from '../layers/AssignmentArcLayer';
// inside return:
<AssignmentArcLayer />
```

`AssignmentArcLayer` returns null — its effects fire on map context.

- [ ] **Step 5: Run tests and typecheck**

```bash
cd client && npx vitest run src/pages/map/layers/__tests__/AssignmentArcLayer.test.tsx && npx tsc --noEmit
```

Expected: PASS, 0 new errors.

- [ ] **Step 6: Visual verification in browser**

Start dev server. Assign a unit to a call (or mock state). Confirm a dashed line appears between the unit marker and the call pin, colored by priority. Confirm it disappears when unit is unassigned.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(map): add AssignmentArcLayer — native GL lines between units and assigned calls"
```

---

### Task 11: Beat Management Panel

**Context:** `PatrolBeatPlannerModal` (added in the Mapbox V2 PR) is a modal. This task replaces it with a side panel using the existing slide-in pattern.

**Files:**
- Create: `client/src/pages/map/panels/BeatManagementPanel.tsx`
- Create: `client/src/pages/map/panels/__tests__/BeatManagementPanel.test.tsx`
- Modify: `client/src/pages/map/layouts/DispatcherMapLayout.tsx` (mount panel, remove modal)
- Delete: `client/src/components/PatrolBeatPlannerModal.tsx` (after panel covers all functionality)
- Modify: `client/src/pages/map/MapboxMapPage.tsx` (remove PatrolBeatPlannerModal import + usage)

**Interfaces:**
- Consumes: `MapContext` (beats), `useAuth()` (role guard)
- Produces: `onClose: () => void` callback prop

- [ ] **Step 1: Write failing test**

Create `client/src/pages/map/panels/__tests__/BeatManagementPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MapContext } from '../../MapContext';
import BeatManagementPanel from '../BeatManagementPanel';

vi.mock('../../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
}));

describe('BeatManagementPanel', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MapContext.Provider value={{ map: null, units: [], calls: [], beats: [] }}>
      {children}
    </MapContext.Provider>
  );

  it('renders panel title', () => {
    render(<BeatManagementPanel onClose={vi.fn()} />, { wrapper });
    expect(screen.getByText(/Beat Management/i)).toBeTruthy();
  });

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn();
    render(<BeatManagementPanel onClose={onClose} />, { wrapper });
    screen.getByRole('button', { name: /close/i }).click();
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/pages/map/panels/__tests__/BeatManagementPanel.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create BeatManagementPanel**

Create `client/src/pages/map/panels/BeatManagementPanel.tsx`:

```tsx
import React, { useEffect, useState, useCallback } from 'react';
import { X, Map } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import PanelTitleBar from '../../../components/PanelTitleBar';
import { useOptimizationV2 } from '../../../hooks/useOptimizationV2';
import type { V2Route } from '../../../utils/mapboxOptimizationV2';

interface Beat {
  id: number;
  name: string;
  officer_count?: number;
}

interface Unit {
  id: number;
  call_sign: string;
  status: string;
}

interface BeatManagementPanelProps {
  onClose: () => void;
  onSolutionReady?: (routes: V2Route[]) => void;
}

export default function BeatManagementPanel({ onClose, onSolutionReady }: BeatManagementPanelProps) {
  const [beats, setBeats] = useState<Beat[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedBeats, setSelectedBeats] = useState<Set<number>>(new Set());
  const [selectedUnits, setSelectedUnits] = useState<Set<number>>(new Set());
  const [shiftStart, setShiftStart] = useState('13:00');
  const [shiftEnd, setShiftEnd] = useState('21:00');
  const optimization = useOptimizationV2();

  useEffect(() => {
    apiFetch<Beat[]>('/dispatch/beats').then(setBeats).catch(console.error);
    apiFetch<Unit[]>('/dispatch/units').then(u =>
      setUnits(u.filter(x => x.status === 'available' || x.status === 'onscene'))
    ).catch(console.error);
  }, []);

  useEffect(() => {
    if (optimization.status === 'complete' && optimization.result) {
      onSolutionReady?.(optimization.result.routes ?? []);
    }
  }, [optimization.status, optimization.result, onSolutionReady]);

  const handleSubmit = useCallback(async () => {
    if (selectedBeats.size === 0 || selectedUnits.size === 0) return;
    await optimization.submit({
      mode: 'patrol_beat',
      beat_ids: Array.from(selectedBeats),
      unit_ids: Array.from(selectedUnits),
      shift_start: shiftStart,
      shift_end: shiftEnd,
    });
  }, [selectedBeats, selectedUnits, shiftStart, shiftEnd, optimization]);

  const toggleBeat = (id: number) =>
    setSelectedBeats(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleUnit = (id: number) =>
    setSelectedUnits(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="absolute right-0 top-0 h-full w-80 bg-surface-base border-l border-brand-700/40 flex flex-col z-20 shadow-xl">
      <PanelTitleBar title="BEAT MANAGEMENT" icon={Map}>
        <button onClick={onClose} aria-label="Close" className="ml-auto">
          <X size={14} className="text-brand-400" />
        </button>
      </PanelTitleBar>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
        {/* Beat selection */}
        <section>
          <p className="text-[color:var(--field-label-color)] font-semibold mb-1">Beats</p>
          {beats.map(b => (
            <label key={b.id} className="flex items-center gap-2 py-[2px] cursor-pointer">
              <input type="checkbox" checked={selectedBeats.has(b.id)} onChange={() => toggleBeat(b.id)} />
              <span className="text-brand-100">{b.name}</span>
            </label>
          ))}
        </section>

        {/* Unit selection */}
        <section>
          <p className="text-[color:var(--field-label-color)] font-semibold mb-1">Available Units</p>
          {units.map(u => (
            <label key={u.id} className="flex items-center gap-2 py-[2px] cursor-pointer">
              <input type="checkbox" checked={selectedUnits.has(u.id)} onChange={() => toggleUnit(u.id)} />
              <span className="text-brand-100">{u.call_sign}</span>
            </label>
          ))}
        </section>

        {/* Shift window */}
        <section>
          <p className="text-[color:var(--field-label-color)] font-semibold mb-1">Shift Window (UTC)</p>
          <div className="flex gap-2">
            <input type="time" value={shiftStart} onChange={e => setShiftStart(e.target.value)}
              className="bg-surface-raised border border-brand-700/40 text-brand-100 rounded px-2 py-1 text-xs" />
            <span className="text-brand-400 self-center">–</span>
            <input type="time" value={shiftEnd} onChange={e => setShiftEnd(e.target.value)}
              className="bg-surface-raised border border-brand-700/40 text-brand-100 rounded px-2 py-1 text-xs" />
          </div>
        </section>
      </div>

      {/* Status + submit */}
      <div className="p-3 border-t border-brand-700/40">
        {optimization.status === 'running' && (
          <p className="text-brand-400 text-xs mb-2">Optimizing… {optimization.elapsedSeconds}s</p>
        )}
        {optimization.status === 'error' && (
          <p className="text-red-400 text-xs mb-2">{optimization.error}</p>
        )}
        <button
          onClick={handleSubmit}
          disabled={selectedBeats.size === 0 || selectedUnits.size === 0 || optimization.status === 'running'}
          className="w-full py-1.5 bg-brand-700 text-brand-100 text-xs rounded disabled:opacity-40"
        >
          {optimization.status === 'running' ? 'Running…' : 'Optimize Patrol Routes'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update DispatcherMapLayout to use the panel**

In `client/src/pages/map/layouts/DispatcherMapLayout.tsx`:

```tsx
import BeatManagementPanel from '../panels/BeatManagementPanel';
// Replace PatrolBeatPlannerModal with:
{showBeatPlanner && (
  <BeatManagementPanel
    onClose={() => setShowBeatPlanner(false)}
    onSolutionReady={(routes) => { setBeatRoutes(routes); setShowBeatPlanner(false); }}
  />
)}
```

Remove `PatrolBeatPlannerModal` import from DispatcherMapLayout.

- [ ] **Step 5: Remove PatrolBeatPlannerModal from MapboxMapPage**

In `MapboxMapPage.tsx`, remove:
- `import PatrolBeatPlannerModal from '../../components/PatrolBeatPlannerModal';`
- Any remaining `<PatrolBeatPlannerModal ...>` JSX

- [ ] **Step 6: Delete PatrolBeatPlannerModal source file**

```bash
rm client/src/components/PatrolBeatPlannerModal.tsx
```

- [ ] **Step 7: Run tests and typecheck**

```bash
cd client && npx vitest run src/pages/map/panels/__tests__/BeatManagementPanel.test.tsx && npx tsc --noEmit
```

Expected: PASS, 0 new type errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(map): replace PatrolBeatPlannerModal with BeatManagementPanel side panel"
```

---

### Task 12: Search Box v6 Upgrade

**Context:** MapboxMapPage currently uses `@mapbox/mapbox-gl-geocoder ^5.1.2` (an imperative plugin added as a map control). Search Box v6 is `@mapbox/search-js-react` — a React component API with typed responses and category search.

**Files:**
- Create: `client/src/pages/map/components/MapSearchBox.tsx`
- Modify: `client/src/pages/map/MapboxMapPage.tsx` (remove geocoder plugin, mount MapSearchBox)
- Modify: `client/package.json` (add `@mapbox/search-js-react`)

- [ ] **Step 1: Install Search Box v6**

```bash
cd client && npm install @mapbox/search-js-react --legacy-peer-deps
```

- [ ] **Step 2: Check current Mapbox token retrieval**

```bash
grep -n "getCachedMapboxStyleUrl\|VITE_MAPBOX\|mapboxApiKey" client/src/pages/map/MapboxMapPage.tsx | head -10
```

The token is read from `getCachedMapboxStyleUrl` / `VITE_MAPBOX_ACCESS_TOKEN`. Search Box v6 also needs the access token — pass the same token.

- [ ] **Step 3: Find and remove the geocoder plugin code in MapboxMapPage**

Search for the geocoder initialization block (around line 1298–1327):

```bash
grep -n "geocoderRef\|MapboxGeocoder\|mapbox-gl-geocoder" client/src/pages/map/MapboxMapPage.tsx
```

Remove:
- `import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder'`
- `import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css'`
- `geocoderRef` declaration and its `useEffect`
- The geocoder CSS override comment block (line ~1779)

- [ ] **Step 4: Create MapSearchBox component**

Create `client/src/pages/map/components/MapSearchBox.tsx`:

```tsx
import React, { useCallback } from 'react';
import { SearchBox } from '@mapbox/search-js-react';
import { useMapContext } from '../MapContext';

interface MapSearchBoxProps {
  accessToken: string;
}

export default function MapSearchBox({ accessToken }: MapSearchBoxProps) {
  const { map } = useMapContext();

  const handleRetrieve = useCallback((result: any) => {
    if (!map) return;
    const coords = result?.features?.[0]?.geometry?.coordinates;
    if (!coords) return;
    const bbox = result?.features?.[0]?.properties?.bbox;
    if (bbox) {
      map.fitBounds(bbox as [number, number, number, number], { padding: 60, maxZoom: 16, duration: 800 });
    } else {
      map.flyTo({ center: coords, zoom: 15, duration: 800 });
    }
  }, [map]);

  return (
    <div className="absolute top-3 left-12 z-10 w-72">
      <SearchBox
        accessToken={accessToken}
        onRetrieve={handleRetrieve}
        proximity={map ? {
          lng: map.getCenter().lng,
          lat: map.getCenter().lat,
        } : undefined}
        options={{ language: 'en', country: 'US' }}
        theme={{
          variables: {
            colorBackground: 'var(--surface-raised)',
            colorBackgroundHover: 'var(--surface-sunken)',
            colorText: 'var(--text-primary)',
            colorSecondary: 'var(--text-secondary)',
            borderRadius: '2px',
          },
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Mount MapSearchBox in MapboxMapPage**

In `MapboxMapPage.tsx`, where the geocoder control previously lived (top of JSX return), add:

```tsx
import MapSearchBox from './components/MapSearchBox';
// Get the token from wherever it's available in the page (same source as the map style URL token)
// Inside return JSX:
{mapToken && <MapSearchBox accessToken={mapToken} />}
```

`mapToken` is whatever state variable holds the Mapbox access token in the page (search for `getCachedMapboxStyleUrl` usage to see how the token is stored).

- [ ] **Step 6: Run typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: 0 new errors. If `@mapbox/search-js-react` types are missing, install `@types/mapbox__search-js-react` or use `// @ts-ignore` on the import as a last resort.

- [ ] **Step 7: Visual verification**

Start dev server, navigate to `/map`. The Search Box should appear top-left. Type an address — suggestions appear. Select one — map flies to location. Proximity bias should prefer current map center.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(map): replace geocoder plugin with Search Box v6 (search-js-react)"
```

---

### Task 13: Open PR B

- [ ] **Step 1: Run full client suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 2: Run worker typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Open PR**

```bash
gh pr create \
  --repo rmpgutah/rmpg-flex \
  --base main \
  --title "feat(map): assignment arcs, beat management panel, Search Box v6 (PR B)" \
  --body "$(cat <<'EOF'
## Summary

- **Assignment arcs**: native Mapbox GL line layer connecting assigned units to their calls, colored by call priority. Independent of Deck.gl toggle.
- **Beat Management Panel**: replaces `PatrolBeatPlannerModal` with a proper side panel; includes beat/unit selection, shift window, and V2 optimization integration.
- **Search Box v6**: replaces `@mapbox/mapbox-gl-geocoder` plugin with `@mapbox/search-js-react` component; proximity-biased, theme-variable-styled.

## Test plan

- [ ] `cd client && npx vitest run` passes
- [ ] Worker typecheck passes
- [ ] Assignment arcs visible in dispatcher layout for units with active call assignments
- [ ] Beat Management Panel opens from toolbar, runs patrol optimization
- [ ] Search Box returns suggestions, map flies to selection
- [ ] `PatrolBeatPlannerModal.tsx` deleted

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Duplicate resolution (Tasks 1–2)
- ✅ MapContext (Task 3)
- ✅ useMapIsochrone extraction (Task 4)
- ✅ useMapGps extraction (Task 5)
- ✅ useMapWelfare + useMapBeatOverlay extraction (Task 6)
- ✅ MapLayout + role routing (Task 7)
- ✅ MapboxMapPage wiring (Task 8)
- ✅ Assignment arc layer (Task 10)
- ✅ Beat management panel (Task 11)
- ✅ Search Box v6 (Task 12)

**Open implementation note:** Tasks 6 (useMapWelfare, useMapBeatOverlay) use template bodies — the actual lifted code must come from MapboxMapPage. The implementer must search for the exact effect blocks and lift them verbatim before replacing. This is intentional: those effects are complex and context-dependent; fabricating them here would create bugs.

**Type consistency:**
- `MapContextValue.units[]` shape defined in Task 3 and consumed identically in Tasks 10–11
- `V2Route` imported from `../../utils/mapboxOptimizationV2` consistently in Tasks 7, 11
- `useOptimizationV2` hook API (`.submit()`, `.status`, `.result`, `.elapsedSeconds`, `.error`) matches implementation from previous session
