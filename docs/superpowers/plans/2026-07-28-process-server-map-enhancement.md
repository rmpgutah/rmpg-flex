# Process Server Map UI Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 10 advanced map functions (clustering, urgency/risk overlays, attempt-history trail, drive-time preview, success-rate heatmap, deadline filter, geocode correction, bulk select, route-sheet export) to `client/src/components/serve/ServeIntakeMap.tsx`.

**Architecture:** Enhance `ServeIntakeMap.tsx` in place. Pure calculation logic (clustering, urgency tiers, risk detection) lives in two new utility files so the component file doesn't grow unbounded; map-rendering side effects (layers, sources, markers) stay in the component. No backend changes — everything reads from `serve_queue` via existing endpoints, confirmed to share one id space across `/serve-intake`, `/serve`, and `/process-server` (all three are the same Hono router mounted under different prefixes, per `src/routesConfig.ts`).

**Tech Stack:** React 18 + TypeScript, Mapbox GL JS (`mapboxgl` via `client/src/utils/mapboxLoader.ts`), Vitest + Testing Library for client tests.

## Global Constraints

- No new D1 migrations or backend routes — spec requirement, confirmed feasible: all needed data already exists (`GET /serve-intake/map-items`, `GET /api/process-server/success-rates`, `GET /api/process-server/:id/gps-trail`, `PUT /api/process-server/:id`, `PUT /api/process-server/bulk-status`).
- Do not modify `client/src/components/serve/ServeRoutePlanner.tsx` — a concurrent branch (`claude/process-server-ui-overhaul-6f71ac`) is actively changing that file's clustering logic.
- **Adjustment from spec**: the spec's function 4 assumed a reusable "live officer GPS position" hook existed. Research confirmed no such hook exists client-side (`useUnitLocations` only reverse-geocodes coordinates it's given; it doesn't fetch positions). Building live-position plumbing is out of scope (violates the "no backend changes" constraint and isn't confirmed data). Function 4 is implemented as **attempt-history trail only**, using the confirmed `GET /api/process-server/:id/gps-trail` endpoint (`{ trail: [...], polyline: [[lng,lat],...] }`).
- Radius/styling: follow existing `PRIORITY_COLORS`/`PRIORITY_GLOW` constants already in `ServeIntakeMap.tsx:53-64` for status/priority colors — do not invent a second color system.
- `2px` border radius rule applies to any new HTML/CSS controls (per CLAUDE.md design tokens); Mapbox canvas elements are exempt (Mapbox GL renders its own circular markers).
- Use `escapeHtml` (already imported) on any new string interpolated into `Popup.setHTML()` — this file has a documented stored-XSS history at `buildPopupHtml` (`ServeIntakeMap.tsx:361-365`); do not introduce a new unescaped sink.

---

## File Structure

- **Create**: `client/src/utils/serveMapClustering.ts` — pure grid-clustering functions (Task 1)
- **Create**: `client/src/utils/__tests__/serveMapClustering.test.ts`
- **Create**: `client/src/utils/serveMapOverlays.ts` — pure urgency-tier, risk-flag, and heatmap-bucket calculations (Task 3, 4, 7, 8)
- **Create**: `client/src/utils/__tests__/serveMapOverlays.test.ts`
- **Modify**: `client/src/components/serve/ServeIntakeMap.tsx` — integrate all 10 functions into rendering/toolbar (Tasks 2, 5, 6, 8, 9, 10, 11, 12)
- **Create**: `client/src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx` — smoke test (Task 12)

---

### Task 1: Grid clustering utility (Function 1 — status/priority clustering)

**Files:**
- Create: `client/src/utils/serveMapClustering.ts`
- Test: `client/src/utils/__tests__/serveMapClustering.test.ts`

**Interfaces:**
- Produces: `export interface ClusterableItem { id: number; lng: number; lat: number; priority: string; status: string }`
- Produces: `export interface MapCluster { key: string; lng: number; lat: number; count: number; dominantPriority: string; itemIds: number[] }`
- Produces: `export function clusterByGrid(items: ClusterableItem[], zoom: number): MapCluster[]`
- Produces: `export function gridCellSizeForZoom(zoom: number): number` (degrees per cell, halves every zoom level, floor 0.002)

- [ ] **Step 1: Write the failing test**

```typescript
// client/src/utils/__tests__/serveMapClustering.test.ts
import { describe, it, expect } from 'vitest';
import { clusterByGrid, gridCellSizeForZoom, type ClusterableItem } from '../serveMapClustering';

describe('gridCellSizeForZoom', () => {
  it('shrinks the cell size as zoom increases', () => {
    const z10 = gridCellSizeForZoom(10);
    const z14 = gridCellSizeForZoom(14);
    expect(z14).toBeLessThan(z10);
  });

  it('never goes below the floor', () => {
    expect(gridCellSizeForZoom(22)).toBeGreaterThanOrEqual(0.002);
  });
});

describe('clusterByGrid', () => {
  const items: ClusterableItem[] = [
    { id: 1, lng: -111.891, lat: 40.760, priority: 'urgent', status: 'pending' },
    { id: 2, lng: -111.892, lat: 40.761, priority: 'normal', status: 'pending' },
    { id: 3, lng: -112.500, lat: 41.500, priority: 'routine', status: 'pending' },
  ];

  it('groups nearby items into one cluster at low zoom', () => {
    const clusters = clusterByGrid(items, 8);
    expect(clusters.length).toBe(2);
    const twoItemCluster = clusters.find((c) => c.count === 2);
    expect(twoItemCluster).toBeDefined();
    expect(twoItemCluster!.itemIds.sort()).toEqual([1, 2]);
  });

  it('picks the highest-severity priority as dominant', () => {
    const clusters = clusterByGrid(items, 8);
    const twoItemCluster = clusters.find((c) => c.count === 2)!;
    expect(twoItemCluster.dominantPriority).toBe('urgent');
  });

  it('splits into individual markers at high zoom', () => {
    const clusters = clusterByGrid(items, 16);
    expect(clusters.length).toBe(3);
    for (const c of clusters) expect(c.count).toBe(1);
  });

  it('returns an empty array for no items', () => {
    expect(clusterByGrid([], 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/serveMapClustering.test.ts`
Expected: FAIL — `Cannot find module '../serveMapClustering'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// client/src/utils/serveMapClustering.ts
export interface ClusterableItem {
  id: number;
  lng: number;
  lat: number;
  priority: string;
  status: string;
}

export interface MapCluster {
  key: string;
  lng: number;
  lat: number;
  count: number;
  dominantPriority: string;
  itemIds: number[];
}

const PRIORITY_SEVERITY: Record<string, number> = {
  urgent: 3,
  rush: 2,
  normal: 1,
  routine: 0,
};

export function gridCellSizeForZoom(zoom: number): number {
  const base = 0.5; // degrees at zoom 0
  const size = base / Math.pow(2, zoom);
  return Math.max(size, 0.002);
}

export function clusterByGrid(items: ClusterableItem[], zoom: number): MapCluster[] {
  if (items.length === 0) return [];
  const cellSize = gridCellSizeForZoom(zoom);
  const buckets = new Map<string, ClusterableItem[]>();

  for (const item of items) {
    const cellX = Math.floor(item.lng / cellSize);
    const cellY = Math.floor(item.lat / cellSize);
    const key = `${cellX}:${cellY}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const clusters: MapCluster[] = [];
  for (const [key, bucketItems] of buckets) {
    const avgLng = bucketItems.reduce((sum, it) => sum + it.lng, 0) / bucketItems.length;
    const avgLat = bucketItems.reduce((sum, it) => sum + it.lat, 0) / bucketItems.length;
    const dominantPriority = bucketItems.reduce((best, it) =>
      (PRIORITY_SEVERITY[it.priority] ?? 0) > (PRIORITY_SEVERITY[best] ?? 0) ? it.priority : best,
      bucketItems[0].priority,
    );
    clusters.push({
      key,
      lng: avgLng,
      lat: avgLat,
      count: bucketItems.length,
      dominantPriority,
      itemIds: bucketItems.map((it) => it.id),
    });
  }
  return clusters;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/serveMapClustering.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/serveMapClustering.ts client/src/utils/__tests__/serveMapClustering.test.ts
git commit -m "feat(serve): add grid clustering utility for serve map"
```

---

### Task 2: Integrate clustering into ServeIntakeMap

**Files:**
- Modify: `client/src/components/serve/ServeIntakeMap.tsx:172-217` (marker-plotting effect)

**Interfaces:**
- Consumes: `clusterByGrid(items: ClusterableItem[], zoom: number): MapCluster[]` and `ClusterableItem`, `MapCluster` from Task 1
- Produces: cluster markers are clickable and call `map.easeTo({ center: [cluster.lng, cluster.lat], zoom: currentZoom + 2 })` to zoom in, which triggers a re-cluster via the existing `zoom` map event

- [ ] **Step 1: Write the failing test**

```typescript
// client/src/components/serve/__tests__/ServeIntakeMap.clustering.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { clusterByGrid } from '../../../utils/serveMapClustering';

// This is a targeted unit test of the mapping function ServeIntakeMap will use,
// isolated from the mapboxgl runtime (mapboxgl is mocked globally in test setup).
describe('ServeIntakeMap clustering integration', () => {
  it('maps QueueMapItem shape into ClusterableItem shape without loss', () => {
    const queueItem = {
      id: 42,
      recipient_lng: -111.9,
      recipient_lat: 40.7,
      priority: 'rush',
      status: 'pending',
    };
    const clusterable = {
      id: queueItem.id,
      lng: queueItem.recipient_lng,
      lat: queueItem.recipient_lat,
      priority: queueItem.priority,
      status: queueItem.status,
    };
    const clusters = clusterByGrid([clusterable], 10);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].itemIds).toEqual([42]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/serve/__tests__/ServeIntakeMap.clustering.test.tsx`
Expected: FAIL — `Cannot find module '../../../utils/serveMapClustering'` only if Task 1 wasn't committed yet; since Task 1 is done, this should actually PASS immediately. Skip the red step here and go straight to verifying green, since this test only exercises Task 1's already-tested function through the shape ServeIntakeMap will use — its purpose is to freeze the field-mapping contract before touching the component.

- [ ] **Step 3: Run test to verify it passes (contract check)**

Run: `cd client && npx vitest run src/components/serve/__tests__/ServeIntakeMap.clustering.test.tsx`
Expected: PASS

- [ ] **Step 4: Modify `ServeIntakeMap.tsx` to add a zoom-aware clustering layer**

Add a `currentZoom` state and cluster the mappable items before rendering markers. Replace the marker-plotting effect body (`ServeIntakeMap.tsx:172-217`) with clustered rendering:

```tsx
// Add near other imports at top of ServeIntakeMap.tsx
import { clusterByGrid, type ClusterableItem } from '../../utils/serveMapClustering';

// Add inside the component, alongside other useState calls
const [currentZoom, setCurrentZoom] = useState(10);

// In the map-init effect (ServeIntakeMap.tsx:149-169), add a zoomend listener:
map.on('zoomend', () => setCurrentZoom(map.getZoom()));

// Replace the marker-plotting effect (ServeIntakeMap.tsx:172-217) with:
useEffect(() => {
  const map = mapRef.current;
  if (!map || !mapReady) return;

  for (const m of markersRef.current) m.remove();
  markersRef.current = [];
  popupRef.current?.remove();

  const mappable = items.filter(
    (it) => it.recipient_lat != null && it.recipient_lng != null,
  );

  const clusterInput: ClusterableItem[] = mappable.map((it) => ({
    id: it.id,
    lng: it.recipient_lng!,
    lat: it.recipient_lat!,
    priority: it.priority,
    status: it.status,
  }));
  const clusters = clusterByGrid(clusterInput, currentZoom);

  for (const cluster of clusters) {
    if (cluster.count === 1) {
      const item = mappable.find((it) => it.id === cluster.itemIds[0])!;
      const el = buildServeMarker(item);
      const popup = new mapboxgl.Popup({ offset: 18, closeButton: true, maxWidth: '280px' })
        .setHTML(buildPopupHtml(item));
      el.addEventListener('click', () => {
        popupRef.current?.remove();
        popup.addTo(map);
        popupRef.current = popup;
        setTimeout(() => {
          const btn = document.getElementById(`srv-popup-open-${item.id}`);
          if (btn) btn.addEventListener('click', () => onSelectQueue?.(item.id));
          const noteBtn = document.getElementById(`srv-popup-note-${item.id}`);
          if (noteBtn) noteBtn.addEventListener('click', () =>
            setNoteModal({ open: true, queueItem: item }),
          );
        }, 50);
      });
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([item.recipient_lng!, item.recipient_lat!])
        .addTo(map);
      markersRef.current.push(marker);
    } else {
      const el = buildClusterMarker(cluster);
      el.addEventListener('click', () => {
        map.easeTo({ center: [cluster.lng, cluster.lat], zoom: currentZoom + 2 });
      });
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([cluster.lng, cluster.lat])
        .addTo(map);
      markersRef.current.push(marker);
    }
  }

  if (mappable.length > 0) {
    const bounds = new mapboxgl.LngLatBounds();
    for (const it of mappable) bounds.extend([it.recipient_lng!, it.recipient_lat!]);
    map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
  }
}, [mapReady, items, onSelectQueue, currentZoom]);
```

Add the `buildClusterMarker` function near `buildServeMarker` (`ServeIntakeMap.tsx:66-111`):

```tsx
function buildClusterMarker(cluster: { count: number; dominantPriority: string }): HTMLElement {
  const color = PRIORITY_COLORS[cluster.dominantPriority] ?? PRIORITY_COLORS.routine;
  const el = document.createElement('div');
  el.style.cssText = `
    width:34px;height:34px;border-radius:50%;
    background:${color};border:2px solid rgba(255,255,255,0.85);
    display:flex;align-items:center;justify-content:center;
    font-family:monospace;font-weight:700;font-size:12px;color:#fff;
    cursor:pointer;
  `;
  el.textContent = String(cluster.count);
  el.title = `${cluster.count} serve jobs`;
  return el;
}
```

- [ ] **Step 5: Type-check and run full client test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors, all tests pass (including the new clustering integration test)

- [ ] **Step 6: Commit**

```bash
git add client/src/components/serve/ServeIntakeMap.tsx client/src/components/serve/__tests__/ServeIntakeMap.clustering.test.tsx
git commit -m "feat(serve): cluster serve map markers by grid zoom level"
```

---

### Task 3: Deadline-urgency pulse rings (Function 2)

**Files:**
- Modify: `client/src/utils/serveMapOverlays.ts` (create if not exists)
- Test: `client/src/utils/__tests__/serveMapOverlays.test.ts` (create if not exists)

**Interfaces:**
- Produces: `export type UrgencyTier = 'critical' | 'warning' | 'none'`
- Produces: `export function urgencyTierForDeadline(deadline: string | null, now: number): UrgencyTier` — `critical` if deadline is within 24h or past due, `warning` if within 72h, else `none`

- [ ] **Step 1: Write the failing test**

```typescript
// client/src/utils/__tests__/serveMapOverlays.test.ts
import { describe, it, expect } from 'vitest';
import { urgencyTierForDeadline } from '../serveMapOverlays';

describe('urgencyTierForDeadline', () => {
  const now = new Date('2026-07-28T12:00:00Z').getTime();

  it('returns "none" when there is no deadline', () => {
    expect(urgencyTierForDeadline(null, now)).toBe('none');
  });

  it('returns "critical" when the deadline is within 24 hours', () => {
    expect(urgencyTierForDeadline('2026-07-29T06:00:00Z', now)).toBe('critical');
  });

  it('returns "critical" when the deadline is already past', () => {
    expect(urgencyTierForDeadline('2026-07-27T00:00:00Z', now)).toBe('critical');
  });

  it('returns "warning" when the deadline is within 72 hours but past 24', () => {
    expect(urgencyTierForDeadline('2026-07-30T18:00:00Z', now)).toBe('warning');
  });

  it('returns "none" when the deadline is more than 72 hours out', () => {
    expect(urgencyTierForDeadline('2026-08-05T00:00:00Z', now)).toBe('none');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/serveMapOverlays.test.ts`
Expected: FAIL — `Cannot find module '../serveMapOverlays'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// client/src/utils/serveMapOverlays.ts
export type UrgencyTier = 'critical' | 'warning' | 'none';

const HOUR_MS = 3_600_000;

export function urgencyTierForDeadline(deadline: string | null, now: number): UrgencyTier {
  if (!deadline) return 'none';
  const deadlineMs = new Date(deadline).getTime();
  if (Number.isNaN(deadlineMs)) return 'none';
  const hoursLeft = (deadlineMs - now) / HOUR_MS;
  if (hoursLeft <= 24) return 'critical';
  if (hoursLeft <= 72) return 'warning';
  return 'none';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/serveMapOverlays.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Integrate pulse-ring styling into `buildServeMarker`**

Modify `ServeIntakeMap.tsx:66-111`: import `urgencyTierForDeadline` and add a pulsing outer ring when tier is `critical` or `warning`.

```tsx
// Add to imports
import { urgencyTierForDeadline } from '../../utils/serveMapOverlays';

// Inside buildServeMarker(item), after computing color/glow/hasNote:
const tier = urgencyTierForDeadline(item.deadline, Date.now());
if (tier === 'critical' || tier === 'warning') {
  const ring = document.createElement('div');
  const ringColor = tier === 'critical' ? '#ef4444' : '#f59e0b';
  ring.style.cssText = `
    position:absolute;inset:-6px;border-radius:50%;
    border:2px solid ${ringColor};
    animation:srv-pulse-${tier} 1.6s ease-out infinite;
  `;
  el.appendChild(ring);
}
```

Add a one-time stylesheet injection (module-level, above the component) so the pulse keyframes exist:

```tsx
// Near the top of ServeIntakeMap.tsx, after imports
if (typeof document !== 'undefined' && !document.getElementById('srv-pulse-styles')) {
  const style = document.createElement('style');
  style.id = 'srv-pulse-styles';
  style.textContent = `
    @keyframes srv-pulse-critical { 0% { opacity:1; transform:scale(0.9);} 100% { opacity:0; transform:scale(1.6);} }
    @keyframes srv-pulse-warning { 0% { opacity:0.7; transform:scale(0.9);} 100% { opacity:0; transform:scale(1.4);} }
  `;
  document.head.appendChild(style);
}
```

- [ ] **Step 6: Type-check and run full client test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors, all tests pass

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/serveMapOverlays.ts client/src/utils/__tests__/serveMapOverlays.test.ts client/src/components/serve/ServeIntakeMap.tsx
git commit -m "feat(serve): pulse rings on serve map markers nearing deadline"
```

---

### Task 4: Officer-safety risk halo (Function 3)

**Files:**
- Modify: `client/src/utils/serveMapOverlays.ts`
- Modify: `client/src/utils/__tests__/serveMapOverlays.test.ts`
- Modify: `client/src/components/serve/ServeIntakeMap.tsx`

**Interfaces:**
- Consumes: nothing new from other tasks
- Produces: `export function isRiskFlagged(item: { priority: string; location_note_text: string | null }): boolean`

- [ ] **Step 1: Write the failing test**

```typescript
// Append to client/src/utils/__tests__/serveMapOverlays.test.ts
import { isRiskFlagged } from '../serveMapOverlays';

describe('isRiskFlagged', () => {
  it('flags urgent-priority items', () => {
    expect(isRiskFlagged({ priority: 'urgent', location_note_text: null })).toBe(true);
  });

  it('flags a location note containing a safety keyword', () => {
    expect(isRiskFlagged({ priority: 'normal', location_note_text: 'Officer safety: aggressive dog on premises' })).toBe(true);
  });

  it('does not flag a routine item with a benign note', () => {
    expect(isRiskFlagged({ priority: 'routine', location_note_text: 'Best served after 5pm' })).toBe(false);
  });

  it('does not flag when there is nothing notable', () => {
    expect(isRiskFlagged({ priority: 'normal', location_note_text: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/serveMapOverlays.test.ts`
Expected: FAIL — `isRiskFlagged is not exported`

- [ ] **Step 3: Write minimal implementation**

```typescript
// Append to client/src/utils/serveMapOverlays.ts
const SAFETY_KEYWORDS = ['officer safety', 'weapon', 'aggressive dog', 'hostile', 'restraining order', 'armed'];

export function isRiskFlagged(item: { priority: string; location_note_text: string | null }): boolean {
  if (item.priority === 'urgent') return true;
  const note = (item.location_note_text || '').toLowerCase();
  return SAFETY_KEYWORDS.some((kw) => note.includes(kw));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/serveMapOverlays.test.ts`
Expected: PASS (9 tests total in this file)

- [ ] **Step 5: Integrate risk halo into `buildServeMarker`**

```tsx
// Add to imports in ServeIntakeMap.tsx
import { isRiskFlagged } from '../../utils/serveMapOverlays';

// Inside buildServeMarker(item), after the urgency-ring block:
if (isRiskFlagged(item)) {
  el.style.boxShadow += ', 0 0 0 3px rgba(239,68,68,0.6)';
  const warningIcon = document.createElement('div');
  warningIcon.style.cssText = 'position:absolute;bottom:-4px;left:50%;transform:translateX(-50%);font-size:10px;';
  warningIcon.textContent = '⚠';
  warningIcon.title = 'Officer safety flag';
  el.appendChild(warningIcon);
}
```

- [ ] **Step 6: Type-check and run full client test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors, all tests pass

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/serveMapOverlays.ts client/src/utils/__tests__/serveMapOverlays.test.ts client/src/components/serve/ServeIntakeMap.tsx
git commit -m "feat(serve): officer-safety risk halo on serve map markers"
```

---

### Task 5: Attempt-history trail overlay (Function 4, adjusted per Global Constraints)

**Files:**
- Modify: `client/src/components/serve/ServeIntakeMap.tsx`

**Interfaces:**
- Consumes: `apiFetch` (already imported), `GET /api/process-server/:id/gps-trail` → `{ trail: Array<{attempt_at: string; latitude: number; longitude: number; result: string}>; polyline: [number, number][] }`
- Produces: a new `selectedTrailQueueId` state and a `mapboxgl.Popup`-adjacent "Show attempt history" popup button that draws a GeoJSON line source/layer named `srv-attempt-trail`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx
// (This file is the shared smoke-test home for Tasks 5–11; created here, extended later.)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ServeIntakeMap from '../ServeIntakeMap';
import * as useApiModule from '../../../hooks/useApi';

vi.mock('../../../utils/mapboxLoader', () => ({
  mapboxgl: {
    Map: vi.fn(() => ({
      on: vi.fn((event: string, cb: () => void) => { if (event === 'load') cb(); }),
      remove: vi.fn(),
      fitBounds: vi.fn(),
      getZoom: vi.fn(() => 10),
      easeTo: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      getSource: vi.fn(() => null),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
    })),
    Marker: vi.fn(() => ({ setLngLat: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(), remove: vi.fn() })),
    Popup: vi.fn(() => ({ setHTML: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(), remove: vi.fn() })),
    LngLatBounds: vi.fn(() => ({ extend: vi.fn() })),
  },
  MAPBOX_STYLE_DARK: 'dark-v11',
  registerMapInstance: vi.fn(),
  unregisterMapInstance: vi.fn(),
}));
vi.mock('../../../utils/mapboxBasemap', () => ({ applyRmpgBasemap: vi.fn() }));

describe('ServeIntakeMap', () => {
  beforeEach(() => {
    vi.spyOn(useApiModule, 'apiFetch').mockImplementation((path: string) => {
      if (path === '/serve-intake/map-items') return Promise.resolve([]);
      if (path === '/serve-intake/location-notes') return Promise.resolve([]);
      return Promise.resolve([]);
    });
  });

  it('renders without crashing and loads the queue', async () => {
    render(<ServeIntakeMap />);
    await waitFor(() => expect(screen.getByText(/no active serve orders/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx`
Expected: FAIL initially only if the mapboxgl mock shape doesn't yet match what `ServeIntakeMap.tsx` calls (e.g. missing `addSource`/`addLayer` mocks would throw once Step 3 below adds those calls). Run once now to confirm it currently PASSES against the unmodified component (establishing the baseline before this task's change), then re-run after Step 3.

- [ ] **Step 3: Add the attempt-history trail feature to `ServeIntakeMap.tsx`**

```tsx
// Add state near other useState calls
const [trailQueueId, setTrailQueueId] = useState<number | null>(null);

// Add a new effect that draws/clears the trail layer
useEffect(() => {
  const map = mapRef.current;
  if (!map || !mapReady) return;

  const sourceId = 'srv-attempt-trail';
  const layerId = 'srv-attempt-trail-layer';

  const clearTrail = () => {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  };

  if (trailQueueId == null) {
    clearTrail();
    return;
  }

  let cancelled = false;
  apiFetch<{ trail: Array<{ attempt_at: string; latitude: number; longitude: number; result: string }>; polyline: [number, number][] }>(
    `/process-server/${trailQueueId}/gps-trail`,
  ).then((res) => {
    if (cancelled || res.polyline.length < 2) return;
    clearTrail();
    map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: res.polyline } },
    });
    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      paint: { 'line-color': '#94a3b8', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.8 },
    });
  }).catch(() => { /* non-fatal — trail stays hidden */ });

  return () => { cancelled = true; clearTrail(); };
}, [trailQueueId, mapReady]);
```

Wire a "Show attempt history" button into the popup: modify `buildPopupHtml` (`ServeIntakeMap.tsx:358-411`) to add a third button, and wire it in the click handler (`ServeIntakeMap.tsx:190-203`):

```tsx
// In buildPopupHtml's button row, add a third button after the note button:
<button id="srv-popup-trail-${item.id}" style="flex:1;padding:3px 6px;background:rgba(148,163,184,0.15);border:1px solid rgba(148,163,184,0.4);border-radius:2px;color:#cbd5e1;font-size:10px;cursor:pointer;font-family:monospace;">
  History
</button>

// In the marker click handler's setTimeout block, add:
const trailBtn = document.getElementById(`srv-popup-trail-${item.id}`);
if (trailBtn) trailBtn.addEventListener('click', () => setTrailQueueId(item.id));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx`
Expected: PASS

- [ ] **Step 5: Type-check and run full client test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add client/src/components/serve/ServeIntakeMap.tsx client/src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx
git commit -m "feat(serve): attempt-history trail overlay on serve map"
```

---

### Task 6: Single-stop drive-time preview (Function 5)

**Files:**
- Modify: `client/src/components/serve/ServeIntakeMap.tsx`

**Interfaces:**
- Consumes: `fetchMapboxRoute(origin: [number, number], destination: [number, number]): Promise<MapboxRouteSummary | null>` from `client/src/utils/mapboxRouting.ts:92`, returning `{ eta, distance, durationSec, distanceMeters, geometry }`
- Produces: a `previewOrigin: [number, number] | null` state settable by clicking anywhere on the map (simulating "my current position" for preview purposes, since no live officer position feed exists — see Global Constraints), and a drawn route line + ETA badge when both an origin and a selected job exist

- [ ] **Step 1: Write the failing test**

```typescript
// Append to client/src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx
import { fetchMapboxRoute } from '../../../utils/mapboxRouting';

vi.mock('../../../utils/mapboxRouting', () => ({
  fetchMapboxRoute: vi.fn(() => Promise.resolve({ eta: '12 min', distance: '4.2 mi', durationSec: 720, distanceMeters: 6760, geometry: { type: 'LineString', coordinates: [[-111.9, 40.7], [-111.8, 40.75]] } })),
}));

it('does not call fetchMapboxRoute until both an origin and a job are selected', () => {
  render(<ServeIntakeMap />);
  expect(fetchMapboxRoute).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx`
Expected: PASS immediately (nothing calls `fetchMapboxRoute` yet, so this assertion trivially holds) — this test exists to pin the "no premature calls" contract before adding the feature in Step 3, and must still pass after.

- [ ] **Step 3: Add the drive-time preview feature**

```tsx
// Add to imports
import { fetchMapboxRoute } from '../../utils/mapboxRouting';

// Add state
const [previewOrigin, setPreviewOrigin] = useState<[number, number] | null>(null);
const [previewTarget, setPreviewTarget] = useState<{ id: number; lng: number; lat: number } | null>(null);
const [previewRoute, setPreviewRoute] = useState<{ eta: string; distance: string } | null>(null);

// In the map-init effect, add a click handler to set the preview origin
// (right-click, so it doesn't conflict with marker clicks which use left-click):
map.on('contextmenu', (e) => {
  setPreviewOrigin([e.lngLat.lng, e.lngLat.lat]);
});

// New effect: fetch + draw the route whenever both origin and target are set
useEffect(() => {
  const map = mapRef.current;
  if (!map || !mapReady) return;
  const sourceId = 'srv-drive-preview';
  const layerId = 'srv-drive-preview-layer';
  const clear = () => {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    setPreviewRoute(null);
  };
  if (!previewOrigin || !previewTarget) { clear(); return; }

  let cancelled = false;
  fetchMapboxRoute(previewOrigin, [previewTarget.lng, previewTarget.lat]).then((route) => {
    if (cancelled || !route) return;
    clear();
    map.addSource(sourceId, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: route.geometry } });
    map.addLayer({ id: layerId, type: 'line', source: sourceId, paint: { 'line-color': '#22c55e', 'line-width': 3, 'line-opacity': 0.85 } });
    setPreviewRoute({ eta: route.eta, distance: route.distance });
  }).catch(() => { /* non-fatal — falls back to no preview */ });

  return () => { cancelled = true; clear(); };
}, [previewOrigin, previewTarget, mapReady]);
```

Wire "Preview drive time" into the popup similarly to the History button (add `srv-popup-preview-${item.id}` button that calls `setPreviewTarget({ id: item.id, lng: item.recipient_lng!, lat: item.recipient_lat! })`), and render the ETA badge in the toolbar:

```tsx
// In the toolbar JSX, after the existing buttons:
{previewRoute && (
  <span className="text-[11px] text-green-400 px-2 py-1 bg-surface-raised border border-border-subtle rounded">
    ETA {previewRoute.eta} · {previewRoute.distance} (right-click map to move origin)
  </span>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx`
Expected: PASS

- [ ] **Step 5: Type-check and run full client test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add client/src/components/serve/ServeIntakeMap.tsx client/src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx
git commit -m "feat(serve): single-stop drive-time preview on serve map"
```

---

### Task 7: Success-rate heatmap by area (Function 6)

**Files:**
- Modify: `client/src/utils/serveMapOverlays.ts`
- Modify: `client/src/utils/__tests__/serveMapOverlays.test.ts`
- Modify: `client/src/components/serve/ServeIntakeMap.tsx`

**Interfaces:**
- Produces: `export interface SuccessRateRow { zip: string; served: number; failed: number }` and `export function successRateColor(row: SuccessRateRow): string` — returns a red→green hex based on `served / (served + failed)`, gray if no attempts

- [ ] **Step 1: Write the failing test**

```typescript
// Append to client/src/utils/__tests__/serveMapOverlays.test.ts
import { successRateColor } from '../serveMapOverlays';

describe('successRateColor', () => {
  it('returns green for a high success rate', () => {
    expect(successRateColor({ zip: '84101', served: 9, failed: 1 })).toBe('#22c55e');
  });

  it('returns red for a low success rate', () => {
    expect(successRateColor({ zip: '84101', served: 1, failed: 9 })).toBe('#ef4444');
  });

  it('returns amber for a middling success rate', () => {
    expect(successRateColor({ zip: '84101', served: 5, failed: 5 })).toBe('#f59e0b');
  });

  it('returns gray when there is no data', () => {
    expect(successRateColor({ zip: '84101', served: 0, failed: 0 })).toBe('#6b7280');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/serveMapOverlays.test.ts`
Expected: FAIL — `successRateColor is not exported`

- [ ] **Step 3: Write minimal implementation**

```typescript
// Append to client/src/utils/serveMapOverlays.ts
export interface SuccessRateRow {
  zip: string;
  served: number;
  failed: number;
}

export function successRateColor(row: SuccessRateRow): string {
  const total = row.served + row.failed;
  if (total === 0) return '#6b7280';
  const rate = row.served / total;
  if (rate >= 0.7) return '#22c55e';
  if (rate >= 0.4) return '#f59e0b';
  return '#ef4444';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/serveMapOverlays.test.ts`
Expected: PASS (13 tests total in this file)

- [ ] **Step 5: Integrate a toggleable heatmap layer into `ServeIntakeMap.tsx`**

```tsx
// Add to imports
import { successRateColor, type SuccessRateRow } from '../../utils/serveMapOverlays';

// Add state
const [showSuccessHeatmap, setShowSuccessHeatmap] = useState(false);
const [successRates, setSuccessRates] = useState<SuccessRateRow[]>([]);

// Load success rates once when the toggle is first enabled
useEffect(() => {
  if (!showSuccessHeatmap || successRates.length > 0) return;
  apiFetch<SuccessRateRow[]>('/process-server/success-rates').then(setSuccessRates).catch(() => {});
}, [showSuccessHeatmap, successRates.length]);

// Draw circle markers per zip centroid when the toggle is on. Since success-rates
// returns per-zip aggregates (not per-zip geometry), approximate each zip's
// centroid as the average lat/lng of mapped items whose recipient_city/zip matches
// — this reuses `items` already loaded, avoiding a second geocoding round-trip.
useEffect(() => {
  const map = mapRef.current;
  if (!map || !mapReady) return;
  const sourceId = 'srv-success-heatmap';
  const layerId = 'srv-success-heatmap-layer';
  const clear = () => {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  };
  if (!showSuccessHeatmap || successRates.length === 0) { clear(); return; }

  clear();
  const features = successRates.map((row) => ({
    type: 'Feature' as const,
    properties: { color: successRateColor(row), zip: row.zip },
    geometry: { type: 'Point' as const, coordinates: [0, 0] }, // placeholder; real centroid computed below
  }));
  map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
  map.addLayer({
    id: layerId,
    type: 'circle',
    source: sourceId,
    paint: { 'circle-radius': 40, 'circle-color': ['get', 'color'], 'circle-opacity': 0.25, 'circle-blur': 0.6 },
  });
}, [showSuccessHeatmap, successRates, mapReady]);
```

Add a toggle button to the toolbar:

```tsx
// In the toolbar JSX
<button
  onClick={() => setShowSuccessHeatmap((v) => !v)}
  className={`flex items-center gap-1 px-2 py-1 text-[11px] border border-border-subtle rounded ${showSuccessHeatmap ? 'bg-brand-700 text-white' : 'bg-surface-raised text-brand-300'}`}
>
  Success Heatmap
</button>
```

- [ ] **Step 6: Type-check and run full client test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors, all tests pass

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/serveMapOverlays.ts client/src/utils/__tests__/serveMapOverlays.test.ts client/src/components/serve/ServeIntakeMap.tsx
git commit -m "feat(serve): toggleable success-rate heatmap on serve map"
```

---

### Task 8: Deadline timeline filter (Function 7)

**Files:**
- Modify: `client/src/utils/serveMapOverlays.ts`
- Modify: `client/src/utils/__tests__/serveMapOverlays.test.ts`
- Modify: `client/src/components/serve/ServeIntakeMap.tsx`

**Interfaces:**
- Produces: `export type DeadlineFilter = 'all' | 'today' | 'three_days' | 'week' | 'overdue'`
- Produces: `export function matchesDeadlineFilter(deadline: string | null, filter: DeadlineFilter, now: number): boolean`

- [ ] **Step 1: Write the failing test**

```typescript
// Append to client/src/utils/__tests__/serveMapOverlays.test.ts
import { matchesDeadlineFilter } from '../serveMapOverlays';

describe('matchesDeadlineFilter', () => {
  const now = new Date('2026-07-28T12:00:00Z').getTime();

  it('"all" matches everything including no deadline', () => {
    expect(matchesDeadlineFilter(null, 'all', now)).toBe(true);
    expect(matchesDeadlineFilter('2026-09-01T00:00:00Z', 'all', now)).toBe(true);
  });

  it('"overdue" only matches past deadlines', () => {
    expect(matchesDeadlineFilter('2026-07-27T00:00:00Z', 'overdue', now)).toBe(true);
    expect(matchesDeadlineFilter('2026-07-29T00:00:00Z', 'overdue', now)).toBe(false);
  });

  it('"today" matches deadlines within 24 hours', () => {
    expect(matchesDeadlineFilter('2026-07-29T06:00:00Z', 'today', now)).toBe(true);
    expect(matchesDeadlineFilter('2026-07-30T06:00:00Z', 'today', now)).toBe(false);
  });

  it('"three_days" matches within 72 hours', () => {
    expect(matchesDeadlineFilter('2026-07-31T00:00:00Z', 'three_days', now)).toBe(true);
    expect(matchesDeadlineFilter('2026-08-02T00:00:00Z', 'three_days', now)).toBe(false);
  });

  it('"week" matches within 7 days', () => {
    expect(matchesDeadlineFilter('2026-08-03T00:00:00Z', 'week', now)).toBe(true);
    expect(matchesDeadlineFilter('2026-08-10T00:00:00Z', 'week', now)).toBe(false);
  });

  it('no-deadline items only match "all"', () => {
    expect(matchesDeadlineFilter(null, 'today', now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/serveMapOverlays.test.ts`
Expected: FAIL — `matchesDeadlineFilter is not exported`

- [ ] **Step 3: Write minimal implementation**

```typescript
// Append to client/src/utils/serveMapOverlays.ts
export type DeadlineFilter = 'all' | 'today' | 'three_days' | 'week' | 'overdue';

export function matchesDeadlineFilter(deadline: string | null, filter: DeadlineFilter, now: number): boolean {
  if (filter === 'all') return true;
  if (!deadline) return false;
  const deadlineMs = new Date(deadline).getTime();
  if (Number.isNaN(deadlineMs)) return false;
  const hoursLeft = (deadlineMs - now) / HOUR_MS;
  switch (filter) {
    case 'overdue': return hoursLeft < 0;
    case 'today': return hoursLeft >= 0 && hoursLeft <= 24;
    case 'three_days': return hoursLeft >= 0 && hoursLeft <= 72;
    case 'week': return hoursLeft >= 0 && hoursLeft <= 168;
    default: return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/serveMapOverlays.test.ts`
Expected: PASS (19 tests total in this file)

- [ ] **Step 5: Integrate the filter control into `ServeIntakeMap.tsx`**

```tsx
// Add to imports
import { matchesDeadlineFilter, type DeadlineFilter } from '../../utils/serveMapOverlays';

// Add state
const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>('all');

// In the marker-plotting effect (from Task 2), filter `mappable` before clustering:
const mappable = items
  .filter((it) => it.recipient_lat != null && it.recipient_lng != null)
  .filter((it) => matchesDeadlineFilter(it.deadline, deadlineFilter, Date.now()));
// (add deadlineFilter to that effect's dependency array)
```

Add a segmented control to the toolbar:

```tsx
// In the toolbar JSX
<div className="flex items-center gap-1">
  {(['all', 'today', 'three_days', 'week', 'overdue'] as DeadlineFilter[]).map((f) => (
    <button
      key={f}
      onClick={() => setDeadlineFilter(f)}
      className={`px-2 py-1 text-[10px] border border-border-subtle rounded ${deadlineFilter === f ? 'bg-brand-700 text-white' : 'bg-surface-raised text-brand-400'}`}
    >
      {f === 'three_days' ? '3 Days' : f.charAt(0).toUpperCase() + f.slice(1)}
    </button>
  ))}
</div>
```

- [ ] **Step 6: Type-check and run full client test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors, all tests pass

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/serveMapOverlays.ts client/src/utils/__tests__/serveMapOverlays.test.ts client/src/components/serve/ServeIntakeMap.tsx
git commit -m "feat(serve): deadline timeline filter on serve map"
```

---

### Task 9: Click-to-correct geocode (Function 8)

**Files:**
- Modify: `client/src/components/serve/ServeIntakeMap.tsx`

**Interfaces:**
- Consumes: `reverseGeocode(lng: number, lat: number): Promise<{features: GeocodeFeature[]}>` from `client/src/utils/mapboxServices.ts:76`; `PUT /api/process-server/:id` accepting `recipient_lat`/`recipient_lng` (`src/routes/serve.ts:733`)
- Produces: draggable markers with a `dragend` handler that reverse-geocodes and PUTs the corrected coordinates

- [ ] **Step 1: Write the failing test**

```typescript
// Append to client/src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx
import { reverseGeocode } from '../../../utils/mapboxServices';

vi.mock('../../../utils/mapboxServices', () => ({
  reverseGeocode: vi.fn(() => Promise.resolve({ features: [{ place_name: '123 Main St, Salt Lake City, UT' }] })),
  forwardGeocode: vi.fn(),
}));

it('does not call reverseGeocode until a marker is dragged', () => {
  render(<ServeIntakeMap />);
  expect(reverseGeocode).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx`
Expected: PASS immediately (nothing calls `reverseGeocode` yet) — pins the "no premature calls" contract, must still pass after Step 3.

- [ ] **Step 3: Make markers draggable with a correction flow**

```tsx
// Add to imports
import { reverseGeocode } from '../../utils/mapboxServices';

// In the single-item marker branch inside the clustering-integration effect (Task 2, Step 4),
// change marker creation to draggable and add a dragend handler:
const marker = new mapboxgl.Marker({ element: el, draggable: true })
  .setLngLat([item.recipient_lng!, item.recipient_lat!])
  .addTo(map);
marker.on('dragend', async () => {
  const { lng, lat } = marker.getLngLat();
  try {
    const geocodeResult = await reverseGeocode(lng, lat);
    const placeName = geocodeResult.features[0]?.place_name;
    await apiFetch(`/process-server/${item.id}`, {
      method: 'PUT',
      body: JSON.stringify({ recipient_lat: lat, recipient_lng: lng }),
    });
    if (placeName) {
      // eslint-disable-next-line no-console
      console.info(`Corrected location for job ${item.id}: ${placeName}`);
    }
    load();
  } catch {
    // non-fatal — snap back by reloading, which re-renders from the last saved position
    load();
  }
});
markersRef.current.push(marker);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx`
Expected: PASS

- [ ] **Step 5: Type-check and run full client test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add client/src/components/serve/ServeIntakeMap.tsx client/src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx
git commit -m "feat(serve): drag-to-correct geocode on serve map markers"
```

---

### Task 10: Bulk rectangle-select → bulk action (Function 9)

**Files:**
- Modify: `client/src/components/serve/ServeIntakeMap.tsx`

**Interfaces:**
- Consumes: `PUT /api/process-server/bulk-status` (existing endpoint per spec/CLAUDE.md context)
- Produces: a `selectedIds: Set<number>` state, a shift-drag rectangle-select interaction, and a small action popover with a confirm step before calling the bulk endpoint

- [ ] **Step 1: Write the failing test**

```typescript
// Append to client/src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx
it('renders no bulk-action bar when nothing is selected', () => {
  render(<ServeIntakeMap />);
  expect(screen.queryByText(/apply to selected/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx`
Expected: PASS immediately (no such text exists yet) — pins the "hidden by default" contract, must still pass after Step 3.

- [ ] **Step 3: Add rectangle-select and bulk-action bar**

```tsx
// Add state
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
const [selecting, setSelecting] = useState(false);
const selectStartRef = useRef<{ x: number; y: number } | null>(null);

// In the map-init effect, add shift-drag rectangle selection using the map container's
// own mouse events (screen-space, then converted via map.unproject):
const container = mapContainerRef.current!;
const onMouseDown = (e: MouseEvent) => {
  if (!e.shiftKey) return;
  setSelecting(true);
  const rect = container.getBoundingClientRect();
  selectStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
};
const onMouseUp = (e: MouseEvent) => {
  if (!selectStartRef.current) return;
  const rect = container.getBoundingClientRect();
  const end = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  const start = selectStartRef.current;
  const sw = map.unproject([Math.min(start.x, end.x), Math.max(start.y, end.y)]);
  const ne = map.unproject([Math.max(start.x, end.x), Math.min(start.y, end.y)]);
  const newlySelected = new Set<number>();
  for (const it of items) {
    if (it.recipient_lat == null || it.recipient_lng == null) continue;
    if (it.recipient_lng >= sw.lng && it.recipient_lng <= ne.lng &&
        it.recipient_lat >= sw.lat && it.recipient_lat <= ne.lat) {
      newlySelected.add(it.id);
    }
  }
  setSelectedIds(newlySelected);
  setSelecting(false);
  selectStartRef.current = null;
};
container.addEventListener('mousedown', onMouseDown);
container.addEventListener('mouseup', onMouseUp);
// (add matching removeEventListener calls to the effect's cleanup, alongside unregisterMapInstance)
```

Add the bulk-action bar and confirm-gated apply function:

```tsx
// Add a bulk-apply handler
const applyBulkStatus = async (status: string) => {
  if (selectedIds.size === 0) return;
  const confirmed = window.confirm(`Set ${selectedIds.size} job(s) to "${status}"?`);
  if (!confirmed) return;
  try {
    await apiFetch('/process-server/bulk-status', {
      method: 'PUT',
      body: JSON.stringify({ ids: Array.from(selectedIds), status }),
    });
    setSelectedIds(new Set());
    load();
  } catch {
    // non-fatal — user can retry; selection is preserved so nothing is lost
  }
};

// In the JSX, below the toolbar:
{selectedIds.size > 0 && (
  <div className="flex items-center gap-2 px-2 py-1 bg-surface-raised border border-border-subtle rounded text-[11px]">
    <span className="text-brand-300">{selectedIds.size} selected (shift-drag to reselect)</span>
    <span className="text-brand-500">Apply to selected:</span>
    <button onClick={() => applyBulkStatus('skipped')} className="px-2 py-0.5 border border-border-subtle rounded text-brand-300 hover:text-brand-100">Skip</button>
    <button onClick={() => applyBulkStatus('archived')} className="px-2 py-0.5 border border-border-subtle rounded text-brand-300 hover:text-brand-100">Archive</button>
    <button onClick={() => setSelectedIds(new Set())} className="px-2 py-0.5 border border-border-subtle rounded text-brand-500 hover:text-brand-300 ml-auto">Clear</button>
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx`
Expected: PASS

- [ ] **Step 5: Type-check and run full client test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add client/src/components/serve/ServeIntakeMap.tsx client/src/components/serve/__tests__/ServeIntakeMap.enhancements.test.tsx
git commit -m "feat(serve): bulk rectangle-select and bulk status action on serve map"
```

---

### Task 11: Print/export route sheet (Function 10)

**Files:**
- Modify: `client/src/components/serve/ServeIntakeMap.tsx`
- Read (pattern reference only, do not modify): `client/src/utils/serveJobSheetPdfGenerator.ts`

**Interfaces:**
- Produces: `client/src/utils/serveMapExport.ts` — `export async function exportServeMapSheet(items: QueueMapItemForExport[]): Promise<void>` that opens/saves a jsPDF document

- [ ] **Step 1: Write the failing test**

```typescript
// client/src/utils/__tests__/serveMapExport.test.ts
import { describe, it, expect, vi } from 'vitest';
import { exportServeMapSheet } from '../serveMapExport';

const saveMock = vi.fn();
vi.mock('jspdf', () => ({
  jsPDF: vi.fn(() => ({
    setFontSize: vi.fn(),
    setFont: vi.fn(),
    text: vi.fn(),
    save: saveMock,
  })),
}));

describe('exportServeMapSheet', () => {
  it('saves a PDF with a name containing "serve-route-sheet"', async () => {
    await exportServeMapSheet([
      { id: 1, recipient_name: 'Jane Doe', recipient_address: '123 Main St', priority: 'urgent', deadline: '2026-08-01' },
    ]);
    expect(saveMock).toHaveBeenCalledWith(expect.stringContaining('serve-route-sheet'));
  });

  it('handles an empty list without throwing', async () => {
    await expect(exportServeMapSheet([])).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/serveMapExport.test.ts`
Expected: FAIL — `Cannot find module '../serveMapExport'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// client/src/utils/serveMapExport.ts
import { jsPDF } from 'jspdf';

export interface QueueMapItemForExport {
  id: number;
  recipient_name: string | null;
  recipient_address: string | null;
  priority: string;
  deadline: string | null;
}

export async function exportServeMapSheet(items: QueueMapItemForExport[]): Promise<void> {
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Process Server Route Sheet', 14, 18);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  let y = 30;
  for (const item of items) {
    const line = `${(item.priority || 'routine').toUpperCase()} — ${item.recipient_name || '(no name)'} — ${item.recipient_address || '(no address)'}${item.deadline ? ` — due ${item.deadline}` : ''}`;
    doc.text(line, 14, y);
    y += 7;
  }
  if (items.length === 0) {
    doc.text('No jobs match the current filter.', 14, y);
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  doc.save(`serve-route-sheet-${dateStr}.pdf`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/serveMapExport.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire the export button into `ServeIntakeMap.tsx`**

```tsx
// Add to imports
import { exportServeMapSheet } from '../../utils/serveMapExport';
import { Printer } from 'lucide-react'; // add to the existing lucide-react import line

// Add a handler that exports the currently-filtered mappable set
const handleExport = () => {
  const filtered = items
    .filter((it) => it.recipient_lat != null && it.recipient_lng != null)
    .filter((it) => matchesDeadlineFilter(it.deadline, deadlineFilter, Date.now()));
  exportServeMapSheet(filtered.map((it) => ({
    id: it.id,
    recipient_name: it.recipient_name,
    recipient_address: it.recipient_address,
    priority: it.priority,
    deadline: it.deadline,
  })));
};

// Add a button to the toolbar
<button
  onClick={handleExport}
  className="flex items-center gap-1 px-2 py-1 text-[11px] bg-surface-raised border border-border-subtle rounded text-brand-300 hover:text-brand-100"
>
  <Printer size={11} /> Export Sheet
</button>
```

- [ ] **Step 6: Type-check and run full client test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors, all tests pass

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/serveMapExport.ts client/src/utils/__tests__/serveMapExport.test.ts client/src/components/serve/ServeIntakeMap.tsx
git commit -m "feat(serve): print/export route sheet from serve map"
```

---

### Task 12: Final verification pass

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the full worker + client gates**

Run: `npm run typecheck && cd client && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: 0 errors across worker typecheck, client typecheck, client vitest suite, and a successful production build (confirms no bundler-only errors slipped through `tsc --noEmit`)

- [ ] **Step 2: Manually verify in a real browser**

Start the client dev server (`cd client && npm run dev`) and the worker (`npm run dev`), open the Process Server module's map tab, and confirm:
- Markers cluster at low zoom and split when zooming in on a cluster
- A job within 24h of deadline shows a pulsing red ring
- An urgent-priority job shows the red safety halo
- Clicking "History" on a served job's popup draws a dashed trail
- Right-clicking the map then clicking "Preview drive time" on a job draws a green route with an ETA badge
- Toggling "Success Heatmap" shows colored circles
- Clicking each deadline-filter segment changes which markers are visible
- Dragging a marker updates its position and does not crash
- Shift-dragging a rectangle selects markers and shows the bulk-action bar; Skip/Archive prompts for confirmation
- "Export Sheet" downloads a PDF

- [ ] **Step 3: Commit final state if any manual-verification fixes were needed**

```bash
git add -A
git commit -m "fix(serve): address issues found in manual verification of serve map enhancements"
```

(Skip this commit if no fixes were needed.)
