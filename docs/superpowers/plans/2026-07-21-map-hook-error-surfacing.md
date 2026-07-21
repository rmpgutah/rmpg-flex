# Surface Silently-Failing Map-Tab Data Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Map-tab data-fetching hook (and the out-of-tab `useMapboxBoundaries`) surfaces a failed fetch instead of silently discarding it, and the dock UI shows a small red error indicator on any toggle whose data failed to load.

**Architecture:** Add an `error: string | null` state to each of the 9 Map-tab hooks (Incidents, Repeat Addresses, Coverage Gaps, Response Time, Safety Zones, History Calls, Pursuit Segments, Speed Violations, Speed Heatmap), set on catch and cleared at fetch start, returned alongside `loading`. Extend the shared `DockToggleItem`/`DockToggleRow` primitive to accept and render that `error`. Thread each hook's `error` into its `MapboxMapPage.tsx` dock entry. Separately, fix `useMapboxBoundaries.ts` to rethrow instead of swallowing, since its one caller (`JurisdictionLookup.tsx`) already has working catch logic waiting for it.

**Tech Stack:** React 18 + TypeScript, existing hook/dock patterns already in the codebase — no new dependencies.

## Global Constraints

- Every hook's existing `console.warn(...)` call in its catch block is preserved verbatim — the new `error` state is additive, not a replacement.
- `error` is cleared (`setError(null)`) at the start of every fetch attempt, alongside the existing `setLoading(true)`.
- Error messages use `err?.message || '<fetch-specific fallback>'` — never a generic shared fallback string across hooks.
- No toast/banner system, no retry/backoff logic — the only new UI surface is the red icon + tooltip text on the existing dock toggle.
- `DockToggleItem`'s new `error` field is optional (`error?: string | null`) so no other consumer of `DockToggleRow` needs changes.

---

### Task 1: `DockToggleItem`/`DockToggleRow` error support

**Files:**
- Modify: `client/src/pages/map/components/DockSection.tsx`

**Interfaces:**
- Produces: `DockToggleItem.error?: string | null` — consumed by Task 2-4's dock-array wiring in `MapboxMapPage.tsx`.

- [ ] **Step 1: Add `error` to the `DockToggleItem` interface and import `AlertCircle`**

In `client/src/pages/map/components/DockSection.tsx`, change the import line:

```tsx
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
```

to:

```tsx
import { AlertCircle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
```

And add `error` to the interface:

```tsx
export interface DockToggleItem {
  id: string;
  label: string;
  active: boolean;
  onToggle: () => void;
  color?: string;
  description?: string;
  loading?: boolean;
  /** Set when the layer's most recent data fetch failed — renders a red
   *  alert icon in place of the loading spinner and replaces the tooltip. */
  error?: string | null;
  /** Renders a colored left-border accent so this toggle's state stays
   *  glanceable even among other rows — for safety-critical items. */
  pinned?: boolean;
}
```

- [ ] **Step 2: Update `DockToggleRow` to render the error icon and tooltip**

Change the `title` prop and the loading-spinner render line in `DockToggleRow`:

```tsx
export function DockToggleRow({ item }: { item: DockToggleItem }) {
  const dotColor = item.color ?? 'var(--brand-gold)';
  const glowColor = dotColor.startsWith('#') ? `${dotColor}80` : dotColor;
  return (
    <button
      type="button"
      onClick={item.onToggle}
      title={item.error || item.description}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors"
      style={{
        background: item.active ? 'var(--surface-raised)' : 'transparent',
        color: item.active ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderLeft: item.pinned ? `3px solid ${dotColor}` : undefined,
      }}
    >
      <span
        className="w-1.5 h-1.5 shrink-0"
        style={{
          borderRadius: '50%',
          background: item.active ? dotColor : 'var(--text-secondary)',
          boxShadow: item.active ? `0 0 4px ${glowColor}` : 'none',
        }}
      />
      <span className="flex-1 min-w-0 truncate text-left">{item.label}</span>
      {item.error ? (
        <AlertCircle className="w-3 h-3 shrink-0" style={{ color: 'var(--sev-critical, #ef4444)' }} />
      ) : (
        item.loading && <Loader2 className="w-3 h-3 shrink-0 animate-spin" style={{ color: 'var(--brand-gold)' }} />
      )}
    </button>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors introduced by this file.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/map/components/DockSection.tsx
git commit -m "feat(map): add error indicator support to DockToggleItem/Row"
```

---

### Task 2: `useMapboxIncidents.ts` and `useMapboxRepeatAddresses.ts` error state

**Files:**
- Modify: `client/src/hooks/useMapboxIncidents.ts`
- Modify: `client/src/hooks/useMapboxRepeatAddresses.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: both hooks now return `error: string | null` alongside `loading` — consumed by Task 6's dock wiring.

- [ ] **Step 1: Add `error` state and wiring to `useMapboxIncidents.ts`**

Find the existing state declaration near the top of `useMapboxIncidents(map)` (alongside the existing `loading` state) and add:

```ts
const [error, setError] = useState<string | null>(null);
```

Change `fetchIncidents` from:

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

return { incidents, loading, fetchIncidents, clear: clearFromMap };
```

to:

```ts
const fetchIncidents = useCallback(async (limit = 2000) => {
  if (!map) return;
  setLoading(true);
  setError(null);
  try {
    const data = await apiFetch<{ data: Incident[]; pagination: unknown }>(`/incidents?limit=${limit}`);
    const incs = Array.isArray(data?.data) ? data.data : [];
    setIncidents(incs);
    whenStyleReady(map, () => { renderOnMap(incs, map); });
  } catch (err: any) {
    console.warn('[useMapboxIncidents] fetch failed:', err);
    setError(err?.message || 'Failed to load incidents');
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);

return { incidents, loading, error, fetchIncidents, clear: clearFromMap };
```

- [ ] **Step 2: Add `error` state and wiring to `useMapboxRepeatAddresses.ts`**

Add `const [error, setError] = useState<string | null>(null);` alongside the existing `loading` state declaration.

Change `fetchRepeats` from:

```ts
const fetchRepeats = useCallback(async (options: RepeatOptions = {}) => {
  if (!map) return;
  const { days = 30, minCount = 3, limit = 200 } = options;
  setLoading(true);
  try {
    const params = new URLSearchParams({
      days: String(days), min_count: String(minCount), limit: String(limit),
    });
    const data = await apiFetch<{ addresses: RepeatAddress[]; total: number }>(
      `/dispatch/repeat-addresses?${params}`
    );
    const addrs = data?.addresses || [];
    setAddresses(addrs);
    whenStyleReady(map, () => { renderOnMap(addrs, map); });
  } catch (err) {
    console.warn('[useMapboxRepeatAddresses] fetch failed:', err);
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);

return { addresses, loading, fetchRepeats, clear: clearFromMap };
```

to:

```ts
const fetchRepeats = useCallback(async (options: RepeatOptions = {}) => {
  if (!map) return;
  const { days = 30, minCount = 3, limit = 200 } = options;
  setLoading(true);
  setError(null);
  try {
    const params = new URLSearchParams({
      days: String(days), min_count: String(minCount), limit: String(limit),
    });
    const data = await apiFetch<{ addresses: RepeatAddress[]; total: number }>(
      `/dispatch/repeat-addresses?${params}`
    );
    const addrs = data?.addresses || [];
    setAddresses(addrs);
    whenStyleReady(map, () => { renderOnMap(addrs, map); });
  } catch (err: any) {
    console.warn('[useMapboxRepeatAddresses] fetch failed:', err);
    setError(err?.message || 'Failed to load repeat addresses');
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);

return { addresses, loading, error, fetchRepeats, clear: clearFromMap };
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useMapboxIncidents.ts client/src/hooks/useMapboxRepeatAddresses.ts
git commit -m "feat(map): surface fetch errors from Incidents and Repeat Addresses hooks"
```

---

### Task 3: `useMapboxCoverageGaps.ts` and `useMapboxSafetyZones.ts` error state

**Files:**
- Modify: `client/src/hooks/useMapboxCoverageGaps.ts`
- Modify: `client/src/hooks/useMapboxSafetyZones.ts`

**Interfaces:**
- Produces: both hooks now return `error: string | null` alongside `loading`.

- [ ] **Step 1: Add `error` state and wiring to `useMapboxCoverageGaps.ts`**

Add `const [error, setError] = useState<string | null>(null);` alongside the existing `gaps`/`loading`/`stats` state declarations.

In `computeCoverage`, change:

```ts
const computeCoverage = useCallback(async (
  bounds: { north: number; south: number; east: number; west: number },
  gridSize = 0.01,
) => {
  if (!map) return;
  setLoading(true);
  try {
    const units = await apiFetch<Unit[]>('/dispatch/units');
    // ... grid compute ...
  } catch (err) {
    console.warn('[useMapboxCoverageGaps] compute failed:', err);
  } finally {
    setLoading(false);
  }
}, [map, clearFromMap]);

return { gaps, stats, loading, computeCoverage, clear: clearFromMap };
```

to:

```ts
const computeCoverage = useCallback(async (
  bounds: { north: number; south: number; east: number; west: number },
  gridSize = 0.01,
) => {
  if (!map) return;
  setLoading(true);
  setError(null);
  try {
    const units = await apiFetch<Unit[]>('/dispatch/units');
    // ... grid compute (unchanged) ...
  } catch (err: any) {
    console.warn('[useMapboxCoverageGaps] compute failed:', err);
    setError(err?.message || 'Failed to compute coverage gaps');
  } finally {
    setLoading(false);
  }
}, [map, clearFromMap]);

return { gaps, stats, loading, error, computeCoverage, clear: clearFromMap };
```

(The grid-computation body between the `apiFetch` call and the `catch` is unchanged — only the `setLoading(true)`/`try`/`catch`/`return` lines shown above are touched.)

- [ ] **Step 2: Add `error` state and wiring to `useMapboxSafetyZones.ts`**

Add `const [error, setError] = useState<string | null>(null);` alongside the existing state declarations near line 101.

Change `fetchSafetyZones` from:

```ts
const fetchSafetyZones = useCallback(async (days = 30) => {
  if (!map) return;
  setLoading(true);
  try {
    const data = await apiFetch<RiskPoint[]>(`/dispatch/heatmap?days=${days}&mode=risk`);
    const points = Array.isArray(data) ? data : [];
    const clustered = clusterRiskPoints(points);
    setZones(clustered);
    whenStyleReady(map, () => { renderOnMap(clustered, map); });
  } catch (err) {
    console.warn('[useMapboxSafetyZones] fetch failed:', err);
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);

return { zones, loading, fetchSafetyZones, clear: clearFromMap };
```

to:

```ts
const fetchSafetyZones = useCallback(async (days = 30) => {
  if (!map) return;
  setLoading(true);
  setError(null);
  try {
    const data = await apiFetch<RiskPoint[]>(`/dispatch/heatmap?days=${days}&mode=risk`);
    const points = Array.isArray(data) ? data : [];
    const clustered = clusterRiskPoints(points);
    setZones(clustered);
    whenStyleReady(map, () => { renderOnMap(clustered, map); });
  } catch (err: any) {
    console.warn('[useMapboxSafetyZones] fetch failed:', err);
    setError(err?.message || 'Failed to load safety zones');
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);

return { zones, loading, error, fetchSafetyZones, clear: clearFromMap };
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useMapboxCoverageGaps.ts client/src/hooks/useMapboxSafetyZones.ts
git commit -m "feat(map): surface fetch errors from Coverage Gaps and Safety Zones hooks"
```

---

### Task 4: `useMapboxResponseTime.ts` error state (two catch points)

**Files:**
- Modify: `client/src/hooks/useMapboxResponseTime.ts`

**Interfaces:**
- Produces: hook returns `error: string | null` alongside `loading`, set from either of its two independent catch points.

- [ ] **Step 1: Add `error` state**

Add `const [error, setError] = useState<string | null>(null);` alongside the existing state declaration near line 38.

- [ ] **Step 2: Set `error` in the `renderOnMap` geojson-load catch**

Change:

```ts
const renderOnMap = useCallback(async (beatData: BeatActivity[], m: mapboxgl.Map) => {
  let beatGeojson: any;
  try {
    const resp = await fetch('/geojson/beat.geojson');
    beatGeojson = await resp.json();
  } catch {
    console.warn('[useMapboxResponseTime] failed to load beat.geojson');
    return;
  }
  clearFromMap();
  visibleRef.current = true;
  // ... (unrelated rendering logic)
```

to:

```ts
const renderOnMap = useCallback(async (beatData: BeatActivity[], m: mapboxgl.Map) => {
  let beatGeojson: any;
  try {
    const resp = await fetch('/geojson/beat.geojson');
    beatGeojson = await resp.json();
  } catch (err: any) {
    console.warn('[useMapboxResponseTime] failed to load beat.geojson');
    setError(err?.message || 'Failed to load beat boundaries');
    return;
  }
  clearFromMap();
  visibleRef.current = true;
  // ... (unrelated rendering logic, unchanged)
```

- [ ] **Step 3: Set `error` (and clear it) in `fetchResponseTimes`**

Change:

```ts
const fetchResponseTimes = useCallback(async (days = 30) => {
  if (!map) return;
  setLoading(true);
  try {
    const data = await apiFetch<{ days: number; beats: BeatActivity[] }>(
      `/reports/beat-activity?days=${days}`
    );
    const b = data?.beats || [];
    setBeats(b);
    void renderOnMap(b, map); // fire-and-forget, not awaited
  } catch (err) {
    console.warn('[useMapboxResponseTime] fetch failed:', err);
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);

return { beats, loading, fetchResponseTimes, clear: clearFromMap };
```

to:

```ts
const fetchResponseTimes = useCallback(async (days = 30) => {
  if (!map) return;
  setLoading(true);
  setError(null);
  try {
    const data = await apiFetch<{ days: number; beats: BeatActivity[] }>(
      `/reports/beat-activity?days=${days}`
    );
    const b = data?.beats || [];
    setBeats(b);
    void renderOnMap(b, map); // fire-and-forget, not awaited
  } catch (err: any) {
    console.warn('[useMapboxResponseTime] fetch failed:', err);
    setError(err?.message || 'Failed to load response times');
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);

return { beats, loading, error, fetchResponseTimes, clear: clearFromMap };
```

Note: `renderOnMap`'s catch sets `error` directly since it's called fire-and-forget (`void renderOnMap(...)`) — its own internal catch is the only place that can observe a geojson-load failure, and `fetchResponseTimes`'s `setError(null)` at the start of each attempt still clears any stale error from a previous run before the new attempt's `renderOnMap` call can (re)populate it.

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useMapboxResponseTime.ts
git commit -m "feat(map): surface fetch errors from Response Time hook (both catch points)"
```

---

### Task 5: `useMapboxHistoryCalls.ts` error state (including its `clear()` wrapper)

**Files:**
- Modify: `client/src/hooks/useMapboxHistoryCalls.ts`

**Interfaces:**
- Produces: hook returns `error: string | null` alongside `loading`; `clear()` also resets `error` to `null`.

- [ ] **Step 1: Add `error` state**

Add `const [error, setError] = useState<string | null>(null);` alongside the existing `calls`/`loading`/`total` state declaration near line 51.

- [ ] **Step 2: Update `fetchHistory` and `clear`**

Change:

```ts
const fetchHistory = useCallback(async (options: HistoryOptions = {}) => {
  if (!map) return;
  const { days = 30, status, types, priority, limit = 5000 } = options;
  setLoading(true);
  try {
    const params = new URLSearchParams({ days: String(days), limit: String(limit) });
    if (status?.length) params.set('status', status.join(','));
    if (types?.length) params.set('types', types.join(','));
    if (priority?.length) params.set('priority', priority.join(','));

    const data = await apiFetch<HistoryCall[]>(`/dispatch/history-map?${params}`);
    const calls = Array.isArray(data) ? data : [];
    setCalls(calls);
    setTotal(calls.length);

    whenStyleReady(map, () => {
      renderOnMap(calls, map);
    });
  } catch (err) {
    console.warn('[useMapboxHistoryCalls] fetch failed:', err);
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);

const clear = useCallback(() => {
  clearFromMap();
  setCalls([]);
  setTotal(0);
}, [clearFromMap]);

return { calls, total, loading, fetchHistory, clear };
```

to:

```ts
const fetchHistory = useCallback(async (options: HistoryOptions = {}) => {
  if (!map) return;
  const { days = 30, status, types, priority, limit = 5000 } = options;
  setLoading(true);
  setError(null);
  try {
    const params = new URLSearchParams({ days: String(days), limit: String(limit) });
    if (status?.length) params.set('status', status.join(','));
    if (types?.length) params.set('types', types.join(','));
    if (priority?.length) params.set('priority', priority.join(','));

    const data = await apiFetch<HistoryCall[]>(`/dispatch/history-map?${params}`);
    const calls = Array.isArray(data) ? data : [];
    setCalls(calls);
    setTotal(calls.length);

    whenStyleReady(map, () => {
      renderOnMap(calls, map);
    });
  } catch (err: any) {
    console.warn('[useMapboxHistoryCalls] fetch failed:', err);
    setError(err?.message || 'Failed to load call history');
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);

const clear = useCallback(() => {
  clearFromMap();
  setCalls([]);
  setTotal(0);
  setError(null);
}, [clearFromMap]);

return { calls, total, loading, error, fetchHistory, clear };
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useMapboxHistoryCalls.ts
git commit -m "feat(map): surface fetch errors from Call History hook"
```

---

### Task 6: `useMapboxSpeedViolations.ts` and `useMapboxSpeedHeatmap.ts` error state

**Files:**
- Modify: `client/src/hooks/useMapboxSpeedViolations.ts`
- Modify: `client/src/hooks/useMapboxSpeedHeatmap.ts`

**Interfaces:**
- Produces: both hooks now return `error: string | null` alongside `loading`.

- [ ] **Step 1: Add `error` state and wiring to `useMapboxSpeedViolations.ts`**

Add `const [error, setError] = useState<string | null>(null);` alongside the existing state declaration near line 35.

Change `fetchViolations` from:

```ts
const fetchViolations = useCallback(async (hours = 4) => {
  if (!map) return;
  setLoading(true);
  try {
    const data = await apiFetch<SpeedViolation[]>(`/dispatch/gps/speed-violations?hours=${hours}`);
    const list = Array.isArray(data) ? data : [];
    setViolations(list);
    renderOnMap(list, map);
  } catch (err) {
    console.warn('[useMapboxSpeedViolations] fetch failed:', err);
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);

const setOnSelectUnit = useCallback((fn: (unitId: number, callSign: string) => void) => {
  onSelectRef.current = fn;
}, []);

return { violations, loading, fetchViolations, clear, setOnSelectUnit, hasLayer: () => !!map && hasLayer(map, LAYER_ID) };
```

to:

```ts
const fetchViolations = useCallback(async (hours = 4) => {
  if (!map) return;
  setLoading(true);
  setError(null);
  try {
    const data = await apiFetch<SpeedViolation[]>(`/dispatch/gps/speed-violations?hours=${hours}`);
    const list = Array.isArray(data) ? data : [];
    setViolations(list);
    renderOnMap(list, map);
  } catch (err: any) {
    console.warn('[useMapboxSpeedViolations] fetch failed:', err);
    setError(err?.message || 'Failed to load speed violations');
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);

const setOnSelectUnit = useCallback((fn: (unitId: number, callSign: string) => void) => {
  onSelectRef.current = fn;
}, []);

return { violations, loading, error, fetchViolations, clear, setOnSelectUnit, hasLayer: () => !!map && hasLayer(map, LAYER_ID) };
```

- [ ] **Step 2: Add `error` state and wiring to `useMapboxSpeedHeatmap.ts`**

Add `const [error, setError] = useState<string | null>(null);` alongside the existing state declaration near line 34.

Change `fetchHeatmap` from:

```ts
const fetchHeatmap = useCallback(async (hours = 8) => {
  if (!map) return;
  setLoading(true);
  try {
    const data = await apiFetch<HeatmapCell[]>(`/dispatch/gps/speed-heatmap?hours=${hours}`);
    const list = Array.isArray(data) ? data : [];
    setCells(list);
    renderOnMap(list, map);
  } catch (err) {
    console.warn('[useMapboxSpeedHeatmap] fetch failed:', err);
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);

return { cells, loading, fetchHeatmap, clear };
```

to:

```ts
const fetchHeatmap = useCallback(async (hours = 8) => {
  if (!map) return;
  setLoading(true);
  setError(null);
  try {
    const data = await apiFetch<HeatmapCell[]>(`/dispatch/gps/speed-heatmap?hours=${hours}`);
    const list = Array.isArray(data) ? data : [];
    setCells(list);
    renderOnMap(list, map);
  } catch (err: any) {
    console.warn('[useMapboxSpeedHeatmap] fetch failed:', err);
    setError(err?.message || 'Failed to load speed heatmap');
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);

return { cells, loading, error, fetchHeatmap, clear };
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useMapboxSpeedViolations.ts client/src/hooks/useMapboxSpeedHeatmap.ts
git commit -m "feat(map): surface fetch errors from Speed Violations and Speed Heatmap hooks"
```

---

### Task 7: `useMapboxPursuitSegments.ts` — bare inner catch + outer error state

**Files:**
- Modify: `client/src/hooks/useMapboxPursuitSegments.ts`

**Interfaces:**
- Produces: hook returns `error: string | null` alongside `loading`; the per-segment inner catch now logs instead of being silent.

- [ ] **Step 1: Add `console.warn` to the bare per-segment catch**

Change:

```ts
} catch {
  // one segment's history failing shouldn't drop the rest
}
```

to:

```ts
} catch (err) {
  // one segment's history failing shouldn't drop the rest
  console.warn(`[useMapboxPursuitSegments] segment ${seg.call_id} history fetch failed:`, err);
}
```

- [ ] **Step 2: Add `error` state**

Add `const [error, setError] = useState<string | null>(null);` alongside the existing `segments`/`loading` state declaration.

- [ ] **Step 3: Set/clear `error` in `fetchSegments`**

Change:

```ts
const fetchSegments = useCallback(async (hours = 4) => {
  if (!map) return;
  setLoading(true);
  try {
    const data = await apiFetch<PursuitSegment[]>(`/dispatch/gps/pursuit-segments?hours=${hours}`);
    const list = Array.isArray(data) ? data : [];
    setSegments(list);
    await renderOnMap(list, map);
  } catch (err) {
    console.warn('[useMapboxPursuitSegments] fetch failed:', err);
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);

return { segments, loading, fetchSegments, clear };
```

to:

```ts
const fetchSegments = useCallback(async (hours = 4) => {
  if (!map) return;
  setLoading(true);
  setError(null);
  try {
    const data = await apiFetch<PursuitSegment[]>(`/dispatch/gps/pursuit-segments?hours=${hours}`);
    const list = Array.isArray(data) ? data : [];
    setSegments(list);
    await renderOnMap(list, map);
  } catch (err: any) {
    console.warn('[useMapboxPursuitSegments] fetch failed:', err);
    setError(err?.message || 'Failed to load pursuit tracks');
  } finally {
    setLoading(false);
  }
}, [map, renderOnMap]);

return { segments, loading, error, fetchSegments, clear };
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useMapboxPursuitSegments.ts
git commit -m "feat(map): surface fetch errors from Pursuit Segments hook, log per-segment failures"
```

---

### Task 8: Thread each hook's `error` into `MapboxMapPage.tsx` dock entries

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

**Interfaces:**
- Consumes: `error` returned by all 9 hooks from Tasks 2-7 (`incidentsLayer.error`, `repeatAddresses.error`, `coverageGaps.error`, `responseTime.error`, `safetyZones.error`, `historyCalls.error`, `pursuitSegmentsLayer.error`, `speedViolationsLayer.error`, `speedHeatmap.error`), and `DockToggleItem.error` from Task 1.

- [ ] **Step 1: Add `error` to each of the 9 dock entries**

In the `mapLeftDockSections` `useMemo` (the array containing "Units & Calls", "Historical Analysis", and "Risk & Coverage" sections), update these 7 lines — each gains an `error: <hook>.error` field appended after its existing `loading` field:

```tsx
        { id: 'incidents', label: 'Incidents', active: incidentsEnabled, onToggle: () => setIncidentsEnabled((v) => !v), color: '#ef4444', description: 'RMS incident clusters', loading: incidentsLayer.loading, error: incidentsLayer.error },
        { id: 'repeat-addresses', label: 'Repeat Addresses', active: repeatAddressesEnabled, onToggle: () => setRepeatAddressesEnabled((v) => !v), color: '#64d264', description: 'Locations with 3+ calls', loading: repeatAddresses.loading, error: repeatAddresses.error },
```

```tsx
        { id: 'call-history', label: 'Call History', active: historyCallsEnabled, onToggle: () => setHistoryCallsEnabled((v) => !v), color: '#64d264', description: 'Past 30 days of calls', loading: historyCalls.loading, error: historyCalls.error },
        { id: 'speed-heatmap', label: 'Speed Heatmap', active: speedHeatmapEnabled, onToggle: () => setSpeedHeatmapEnabled((v) => !v), color: '#f97316', description: 'GPS speed density', loading: speedHeatmap.loading, error: speedHeatmap.error },
        { id: 'speed-violations', label: 'Speed Violations', active: speedViolationsEnabled, onToggle: () => setSpeedViolationsEnabled((v) => !v), color: '#ef4444', description: 'Recent high-speed events — click a marker for the speed graph', loading: speedViolationsLayer.loading, error: speedViolationsLayer.error },
        { id: 'pursuit-segments', label: 'Pursuit Tracks', active: pursuitSegmentsEnabled, onToggle: () => setPursuitSegmentsEnabled((v) => !v), color: '#dc2626', description: 'Recent vehicle/foot pursuit paths', loading: pursuitSegmentsLayer.loading, error: pursuitSegmentsLayer.error },
        { id: 'response-time', label: 'Response Time by Beat', active: responseTimeEnabled, onToggle: () => setResponseTimeEnabled((v) => !v), color: '#4caf50', description: '30-day avg response time (historical)', loading: responseTime.loading, error: responseTime.error },
```

```tsx
        { id: 'coverage-gaps', label: 'Coverage Gaps', active: coverageGapsEnabled, onToggle: () => setCoverageGapsEnabled((v) => !v), color: '#f08228', description: 'Response-time gap grid', loading: coverageGaps.loading, error: coverageGaps.error },
        { id: 'safety-zones', label: 'Safety Zones', active: safetyZonesEnabled, onToggle: () => setSafetyZonesEnabled((v) => !v), color: '#c81e1e', description: 'Risk-weighted call clusters', loading: safetyZones.loading, error: safetyZones.error },
```

- [ ] **Step 2: Add each hook's `error` to the `useMemo` dependency array**

The `mapLeftDockSections` `useMemo`'s dependency array currently ends with (exact tail, from the live file):

```tsx
  ], [heatmap, traffic, breadcrumbs, clustering, daylight, geofenceAlerts, isochroneEnabled, toggleIsochrone, districtHierarchy, terrainEnabled, selfPosVisible, autoPanEnabled, p1AudioEnabled, setTerrainEnabled, setSelfPosVisible, setAutoPanEnabled, setP1AudioEnabled, weatherRadar, coordGrid, geoJsonLayers, buildings3dEnabled, setBuildings3dEnabled, projection, atmosphere, cameraAnimation, incidentsEnabled, incidentsLayer.loading, coverageGapsEnabled, coverageGaps.loading, responseTimeEnabled, responseTime.loading, safetyZonesEnabled, safetyZones.loading, historyCallsEnabled, historyCalls.loading, heatmapMode, populateAndToggleHeatmap, repeatAddressesEnabled, repeatAddresses.loading, speedHeatmapEnabled, speedHeatmap.loading, speedViolationsEnabled, speedViolationsLayer.loading, pursuitSegmentsEnabled, pursuitSegmentsLayer.loading]);
```

Replace it with (each `<hook>.loading` entry gains a matching `<hook>.error` entry immediately after it):

```tsx
  ], [heatmap, traffic, breadcrumbs, clustering, daylight, geofenceAlerts, isochroneEnabled, toggleIsochrone, districtHierarchy, terrainEnabled, selfPosVisible, autoPanEnabled, p1AudioEnabled, setTerrainEnabled, setSelfPosVisible, setAutoPanEnabled, setP1AudioEnabled, weatherRadar, coordGrid, geoJsonLayers, buildings3dEnabled, setBuildings3dEnabled, projection, atmosphere, cameraAnimation, incidentsEnabled, incidentsLayer.loading, incidentsLayer.error, coverageGapsEnabled, coverageGaps.loading, coverageGaps.error, responseTimeEnabled, responseTime.loading, responseTime.error, safetyZonesEnabled, safetyZones.loading, safetyZones.error, historyCallsEnabled, historyCalls.loading, historyCalls.error, heatmapMode, populateAndToggleHeatmap, repeatAddressesEnabled, repeatAddresses.loading, repeatAddresses.error, speedHeatmapEnabled, speedHeatmap.loading, speedHeatmap.error, speedViolationsEnabled, speedViolationsLayer.loading, speedViolationsLayer.error, pursuitSegmentsEnabled, pursuitSegmentsLayer.loading, pursuitSegmentsLayer.error]);
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors. (`DockToggleItem.error` is optional per Task 1, and every hook now provides `error` per Tasks 2-7, so the object-literal shapes match.)

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): thread hook error states into dock toggle entries"
```

---

### Task 9: `useMapboxBoundaries.ts` — rethrow instead of swallow

**Files:**
- Modify: `client/src/hooks/useMapboxBoundaries.ts`

**Interfaces:**
- Consumes: nothing from prior tasks (independent fix).
- Produces: `lookup()` now rejects on failure instead of resolving to `null` — `JurisdictionLookup.tsx`'s existing `try/catch` (unchanged) becomes reachable.

- [ ] **Step 1: Change the catch block to rethrow**

Change:

```ts
const lookup = useCallback(async (lng: number, lat: number) => {
  setLoading(true);
  try {
    const data: BoundariesResult = await lookupJurisdiction(lng, lat);
    if (data.skipped) {
      setAvailable(false);
      setResult(null);
      return null;
    }
    const info: JurisdictionInfo = {
      county: data.county,
      municipality: data.municipality,
      place: data.place,
    };
    setAvailable(true);
    setResult(info);
    return info;
  } catch (err) {
    console.warn('[useMapboxBoundaries] lookup failed:', err);
    setResult(null);
    return null;
  } finally {
    setLoading(false);
  }
}, []);
```

to:

```ts
const lookup = useCallback(async (lng: number, lat: number) => {
  setLoading(true);
  try {
    const data: BoundariesResult = await lookupJurisdiction(lng, lat);
    if (data.skipped) {
      setAvailable(false);
      setResult(null);
      return null;
    }
    const info: JurisdictionInfo = {
      county: data.county,
      municipality: data.municipality,
      place: data.place,
    };
    setAvailable(true);
    setResult(info);
    return info;
  } catch (err) {
    console.warn('[useMapboxBoundaries] lookup failed:', err);
    setResult(null);
    throw err;
  } finally {
    setLoading(false);
  }
}, []);
```

`JurisdictionLookup.tsx` needs no changes — its `run()` already wraps `await lookup(lng, lat)` in a `try/catch` that calls `setError(err?.message || 'Lookup failed')`; that catch is currently unreachable and becomes reachable with this one-line change.

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification of the now-reachable error path**

This hook has no existing automated test file (confirmed: no `useMapboxBoundaries.test.ts` in the repo). Since `lookup()`'s only caller already has correct catch logic, and the change is a single `return null` → `throw err` swap inside an already-isolated `catch`, no new test is warranted per this plan's Global Constraints (no retry/backoff logic, minimal surface) — verify via typecheck and the final vitest run in Task 10 that no existing test relies on `lookup()` resolving to `null` on failure.

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useMapboxBoundaries.ts
git commit -m "fix(jurisdiction): rethrow lookup failures instead of swallowing them"
```

---

### Task 10: Final verification sweep

**Files:**
- None (verification only).

- [ ] **Step 1: Full Worker typecheck**

Run: `npm run typecheck`
Expected: passes (no Worker files were touched, but this project's CI runs it on every PR — confirm no regression).

- [ ] **Step 2: Full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: passes with the same pre-existing error count as before this branch (no new errors from this plan's changes).

- [ ] **Step 3: Full client vitest suite**

Run: `cd client && npx vitest run`
Expected: passes with the same pre-existing failure count as before this branch (per `CLAUDE.md`'s Session Log, 9 pre-existing failures in 4 unrelated files were known as of 2026-06-24 — confirm this plan's changes don't add new failures).

- [ ] **Step 4: Grep-confirm no remaining console.warn-only catch among the 9 target hooks**

Run:
```bash
grep -n "catch" client/src/hooks/useMapboxIncidents.ts client/src/hooks/useMapboxRepeatAddresses.ts client/src/hooks/useMapboxCoverageGaps.ts client/src/hooks/useMapboxResponseTime.ts client/src/hooks/useMapboxSafetyZones.ts client/src/hooks/useMapboxHistoryCalls.ts client/src/hooks/useMapboxPursuitSegments.ts client/src/hooks/useMapboxSpeedViolations.ts client/src/hooks/useMapboxSpeedHeatmap.ts
```
Expected: every `catch` block shown either calls `setError(...)` on the following lines, or (for the pursuit-segments per-segment inner catch) has the added `console.warn` — confirm none are still bare/console-only for a hook-level fetch failure.

- [ ] **Step 5: Grep-confirm `useMapboxBoundaries.ts` no longer swallows**

Run: `grep -n "return null" client/src/hooks/useMapboxBoundaries.ts`
Expected: the `catch` block's `return null` is gone (replaced by `throw err`); the remaining `return null` (inside the `if (data.skipped)` branch) is untouched and correct — that's a real "no data available" case, not a failure.

- [ ] **Step 6: Commit (if any fixes were needed)**

Only commit if Steps 1-5 surfaced something to fix. If everything passes cleanly, no commit is needed for this task.
