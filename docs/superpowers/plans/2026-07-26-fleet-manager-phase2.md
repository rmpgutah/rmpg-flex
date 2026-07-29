# Fleet Manager Phase 2 — Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `client/src/pages/fleet/FleetPage.tsx` from 1,968 lines to under 400 by extracting four hooks and grouping `FleetDetailPanel`'s 50 props, with zero behavior change.

**Architecture:** `FleetPage` is a container holding 52 `useState`, 11 `useEffect`, and 10 `useCallback`; `FleetDetailPanel` takes 50 props. Extract cohesive state+fetch+handler clusters into named hooks under `client/src/pages/fleet/hooks/`, following the existing `useFleetWideFanOut.ts` convention (named export, exported result interface, JSDoc covering what/how/deps). `FleetPage` becomes layout and composition.

**Tech Stack:** React 18, TypeScript, Vite 6, Vitest + Testing Library.

## Global Constraints

- **This is a refactor. Behavior must not change.** The Phase 1 tests are the safety net: `FleetPage.phase1.test.tsx`, `FleetPage.viewTabs.test.tsx`, `FleetDetailPanel.test.tsx`, `FleetAnalyticsTab.scope.test.tsx`. **They must pass with ZERO assertion edits.** If an assertion needs changing, behavior moved and the change is wrong — stop and reconsider rather than editing the test.
- Hooks live in `client/src/pages/fleet/hooks/`, one file per hook, matching `useFleetWideFanOut.ts`'s shape.
- **Do not touch `src/utils/fleetAnalyticsScope.ts` or `src/routes/fleet.ts`.** This plan is client-only. (The follow-up session that was editing those merged as #3155 before this plan started, so the conflict is gone — but the Worker still stays out of scope here.)
- No new hex literals. The four CAD severity colors in `FleetPage.tsx` (`#22c55e`, `#ef4444`, `#f59e0b`, `#6b7280`) move verbatim — they are fixed semantics, not theme tokens.
- Run the **full** client suite before every commit, never a targeted run. A red test hid behind green targeted runs for four consecutive tasks in the 2026-07-24 sweep.
- Commit after each task. Small diffs are a safety property here: squash-merge has dropped a wiring line three times in this repo.

## ⚠️ The one hazard that must not be broken

`FleetPage.tsx:428–473` holds a **load-bearing hook-ordering dependency**:

```tsx
// Reset effect (declared FIRST)
useEffect(() => {
  if (selectedId != null && lastVehicleIdRef.current != null && selectedId !== lastVehicleIdRef.current) {
    setActiveTab('overview');
    skipNextLazyLoadRef.current = true;   // ← consumed by the NEXT effect
  }
  ...
}, [selectedId]);

// Lazy-load effect (declared SECOND — order is the guarantee)
useEffect(() => {
  if (!selectedId) return;
  if (skipNextLazyLoadRef.current) { skipNextLazyLoadRef.current = false; return; }
  ...
}, [selectedId, activeTab]);
```

`setActiveTab` is not reflected until the next render, so without the skip the lazy-load effect reads the **stale** tab and fires a fetch for the previous vehicle's tab against the newly-selected vehicle.

**Both effects must stay inside the same hook, in this declaration order.** Splitting them across two hooks makes correctness depend on the order those hooks are *called* in `FleetPage` — untypechecked, untested, and it fails as a race that passes on a fast machine. Task 3 keeps them together and adds a regression test that pins the behavior.

## File Structure

| File | Responsibility |
|---|---|
| `hooks/useFleetVehicles.ts` (create) | Vehicle list, total, status filter, search, archive toggle, live sync, derived stats |
| `hooks/useVehicleDetail.ts` (create) | Selected vehicle detail + maintenance + per-tab data (fuel/inspections/assignments/personnel/analytics), tab state, **both coupled effects** |
| `hooks/useFleetCosts.ts` (create) | Five cost categories, budgets, cost modal state, `recomputeCostSummary`, cost-per-mile |
| `hooks/useFleetForms.ts` (create) | Four `useFormDraft` instances, modal mode, editing ids, four save handlers |
| `FleetDetailPanel.tsx` (modify) | Props regrouped into `data` / `costs` / `actions` |
| `FleetPage.tsx` (modify) | Layout + composition only |

---

### Task 1: Delete dead pre-trip history state

**Files:**
- Modify: `client/src/pages/fleet/FleetPage.tsx:301`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Warm-up task that proves the gate loop before any real extraction.

`pretripHistory` / `setPretripHistory` have exactly one reference each — their own declaration. Never read, never written. It deletes rather than moves.

- [ ] **Step 1: Confirm it is genuinely dead**

```bash
cd client && grep -n "pretripHistory" src/pages/fleet/FleetPage.tsx
```

Expected: exactly two lines, both on the declaration (`const [pretripHistory, setPretripHistory] = useState<any[]>([]);`). If any other line appears, STOP — it is not dead, skip this task.

- [ ] **Step 2: Delete the declaration**

Remove this line from `FleetPage.tsx`:

```tsx
  const [pretripHistory, setPretripHistory] = useState<any[]>([]);
```

- [ ] **Step 3: Verify typecheck and full suite**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: no typecheck output; suite green with no assertion edits.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/fleet/FleetPage.tsx
git commit -m "refactor(fleet): drop dead pretripHistory state"
```

---

### Task 2: Extract useFleetVehicles

**Files:**
- Create: `client/src/pages/fleet/hooks/useFleetVehicles.ts`
- Create: `client/src/pages/fleet/hooks/__tests__/useFleetVehicles.test.tsx`
- Modify: `client/src/pages/fleet/FleetPage.tsx`

**Interfaces:**
- Consumes: `apiFetch` from `../../../hooks/useApi`; `useLiveSync` from `../../../hooks/useLiveSync`; `useToast` from `../../../components/ToastProvider`; `FLEET_PAGE_SIZE` (currently a module const in `FleetPage.tsx` — move it into this hook file and export it).
- Produces:
  ```ts
  export interface FleetVehiclesResult {
    vehicles: FleetVehicle[];
    vehicleTotal: number | null;
    filtered: FleetVehicle[];
    filterStatus: string;
    setFilterStatus: (s: string) => void;
    searchQuery: string;
    setSearchQuery: (s: string) => void;
    showArchived: boolean;
    setShowArchived: (b: boolean) => void;
    statusCounts: Record<string, number>;
    avgMileage: number;
    refetch: (options?: { silent?: boolean }) => Promise<void>;
  }
  export function useFleetVehicles(): FleetVehiclesResult;
  export const FLEET_PAGE_SIZE: number;
  ```

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/fleet/hooks/__tests__/useFleetVehicles.test.tsx`:

```tsx
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFleetVehicles } from '../useFleetVehicles';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../hooks/useLiveSync', () => ({ useLiveSync: vi.fn() }));
vi.mock('../../../../components/ToastProvider', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import { apiFetch } from '../../../../hooks/useApi';

const VEHICLES = [
  { id: 1, vehicle_number: 'PS-D19', status: 'in_service', make: 'Ford', model: 'Explorer', current_mileage: 1000 },
  { id: 2, vehicle_number: 'PS-D20', status: 'maintenance', make: 'Chevy', model: 'Tahoe', current_mileage: 3000 },
];

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue({ data: VEHICLES, pagination: { total: 7 } } as never);
});

describe('useFleetVehicles', () => {
  it('loads vehicles and reports the server total separately from the loaded count', async () => {
    const { result } = renderHook(() => useFleetVehicles());
    await waitFor(() => expect(result.current.vehicles).toHaveLength(2));
    expect(result.current.vehicleTotal).toBe(7);
  });

  it('filters by status', async () => {
    const { result } = renderHook(() => useFleetVehicles());
    await waitFor(() => expect(result.current.vehicles).toHaveLength(2));
    act(() => result.current.setFilterStatus('in_service'));
    await waitFor(() => expect(result.current.filtered).toHaveLength(1));
    expect(result.current.filtered[0].vehicle_number).toBe('PS-D19');
  });

  it('searches across number, make, and model', async () => {
    const { result } = renderHook(() => useFleetVehicles());
    await waitFor(() => expect(result.current.vehicles).toHaveLength(2));
    act(() => result.current.setSearchQuery('tahoe'));
    await waitFor(() => expect(result.current.filtered).toHaveLength(1));
    expect(result.current.filtered[0].vehicle_number).toBe('PS-D20');
  });

  it('derives status counts and average mileage from the full list, not the filtered one', async () => {
    const { result } = renderHook(() => useFleetVehicles());
    await waitFor(() => expect(result.current.vehicles).toHaveLength(2));
    act(() => result.current.setFilterStatus('in_service'));
    await waitFor(() => expect(result.current.filtered).toHaveLength(1));
    expect(result.current.statusCounts.in_service).toBe(1);
    expect(result.current.statusCounts.maintenance).toBe(1);
    expect(result.current.avgMileage).toBe(2000);
  });

  it('refetches when the archive toggle flips', async () => {
    const { result } = renderHook(() => useFleetVehicles());
    await waitFor(() => expect(result.current.vehicles).toHaveLength(2));
    vi.mocked(apiFetch).mockClear();
    act(() => result.current.setShowArchived(true));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toContain('archived=true');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd client && npx vitest run src/pages/fleet/hooks/__tests__/useFleetVehicles.test.tsx
```

Expected: FAIL — cannot resolve `../useFleetVehicles`.

- [ ] **Step 3: Create the hook**

Create `client/src/pages/fleet/hooks/useFleetVehicles.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useLiveSync } from '../../../hooks/useLiveSync';
import { useToast } from '../../../components/ToastProvider';
import type { FleetVehicle } from '../../../types';

/** Page size requested from `/api/fleet`. The server defaults to 200 and the
 *  list silently truncated past it before Phase 1; we now ask explicitly and
 *  surface `vehicleTotal` so the UI can say "showing N of M" rather than
 *  quietly dropping rows. */
export const FLEET_PAGE_SIZE = 500;

export interface FleetVehiclesResult {
  vehicles: FleetVehicle[];
  vehicleTotal: number | null;
  filtered: FleetVehicle[];
  filterStatus: string;
  setFilterStatus: (s: string) => void;
  searchQuery: string;
  setSearchQuery: (s: string) => void;
  showArchived: boolean;
  setShowArchived: (b: boolean) => void;
  statusCounts: Record<string, number>;
  avgMileage: number;
  refetch: (options?: { silent?: boolean }) => Promise<void>;
}

/** Fleet vehicle list, its filters, and the stats derived from it.
 *
 *  `filtered` applies the status + search filters; `statusCounts` and
 *  `avgMileage` are deliberately derived from the FULL list, so the gauge row
 *  keeps reporting the fleet while the list below it is filtered.
 *
 *  Re-fetches whenever `showArchived` flips, and subscribes to the 'fleet'
 *  live-sync channel with a silent refresh (a toast on every remote edit would
 *  be noise, and a non-silent refresh unmounts UI mid-interaction). */
export function useFleetVehicles(): FleetVehiclesResult {
  const { addToast } = useToast();
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [vehicleTotal, setVehicleTotal] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const refetch = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const resp = await apiFetch<{ data: FleetVehicle[]; pagination?: { total?: number } }>(
        `/fleet?archived=${showArchived}&per_page=${FLEET_PAGE_SIZE}`,
      );
      const rows = Array.isArray(resp) ? resp : resp.data || [];
      setVehicles(rows);
      const total = Array.isArray(resp) ? rows.length : resp.pagination?.total;
      setVehicleTotal(typeof total === 'number' ? total : rows.length);
    } catch {
      if (!options?.silent) addToast('Failed to load fleet vehicles', 'error');
    }
  }, [addToast, showArchived]);

  useEffect(() => { refetch(); }, [refetch]);

  const silentRefresh = useCallback(() => refetch({ silent: true }), [refetch]);
  useLiveSync('fleet', silentRefresh);

  const filtered = useMemo(() => vehicles.filter((v) => {
    if (filterStatus !== 'all' && v.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const haystack = `${v.vehicle_number} ${v.make} ${v.model} ${v.plate_number} ${v.vin}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  }), [vehicles, filterStatus, searchQuery]);

  const statusCounts = useMemo(() => vehicles.reduce((acc, v) => {
    acc[v.status] = (acc[v.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>), [vehicles]);

  const avgMileage = useMemo(() => {
    if (vehicles.length === 0) return 0;
    const total = vehicles.reduce((sum, v) => sum + (v.current_mileage || 0), 0);
    return Math.round(total / vehicles.length);
  }, [vehicles]);

  return {
    vehicles, vehicleTotal, filtered,
    filterStatus, setFilterStatus, searchQuery, setSearchQuery,
    showArchived, setShowArchived,
    statusCounts, avgMileage, refetch,
  };
}
```

- [ ] **Step 4: Run the hook test to verify it passes**

```bash
cd client && npx vitest run src/pages/fleet/hooks/__tests__/useFleetVehicles.test.tsx
```

Expected: 5 passed.

- [ ] **Step 5: Wire FleetPage to the hook**

In `FleetPage.tsx`: delete the `vehicles`, `vehicleTotal`, `filterStatus`, `searchQuery`, `showArchived` state declarations, the `fetchVehicles` callback, its `useEffect`, the `silentRefreshVehicles`/`useLiveSync` pair, the `filtered` const, and the `statusCounts`/`totalMileage`/`avgMileage` consts. Also delete the module-level `FLEET_PAGE_SIZE` const (it now lives in the hook). Replace with:

```tsx
  const {
    vehicles, vehicleTotal, filtered,
    filterStatus, setFilterStatus, searchQuery, setSearchQuery,
    showArchived, setShowArchived,
    statusCounts, avgMileage, refetch: fetchVehicles,
  } = useFleetVehicles();
```

Add the import: `import { useFleetVehicles } from './hooks/useFleetVehicles';`

All existing `fetchVehicles({ silent: true })` call sites keep working unchanged because of the `refetch: fetchVehicles` rename.

- [ ] **Step 6: Verify the full suite with zero assertion edits**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: green. If `FleetPage.phase1.test.tsx` fails, behavior moved — revert and reconsider rather than editing the assertion.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/fleet/hooks/useFleetVehicles.ts client/src/pages/fleet/hooks/__tests__/useFleetVehicles.test.tsx client/src/pages/fleet/FleetPage.tsx
git commit -m "refactor(fleet): extract useFleetVehicles"
```

---

### Task 3: Extract useVehicleDetail — including the coupled effects

**Files:**
- Create: `client/src/pages/fleet/hooks/useVehicleDetail.ts`
- Create: `client/src/pages/fleet/hooks/__tests__/useVehicleDetail.test.tsx`
- Modify: `client/src/pages/fleet/FleetPage.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `useToast`, `usePersistedTab` from `../../../hooks/usePersistedState`, `DetailTab` from `../FleetDetailPanel`.
- Produces:
  ```ts
  export interface VehicleDetailResult {
    detail: FleetVehicle | null;
    maintenance: FleetMaintenance[];
    fuelLogs: FleetFuelLog[];
    fuelSummary: FleetFuelSummary | null;
    inspections: FleetInspection[];
    assignments: FleetAssignment[];
    analytics: FleetAnalytics | null;
    analyticsLoading: boolean;
    personnelData: FleetPersonnelData | null;
    personnelLoading: boolean;
    activeTab: DetailTab;
    setActiveTab: (t: DetailTab) => void;
    fetchDetail: (id: string | number) => Promise<void>;
    fetchFuelLogs: (id: string | number) => Promise<void>;
    fetchInspections: (id: string | number) => Promise<void>;
    fetchAssignments: (id: string | number) => Promise<void>;
    fetchPersonnel: (id: string | number) => Promise<void>;
    fetchVehicleAnalytics: (id: string | number, period?: string) => Promise<void>;
    clearDetail: () => void;
  }
  export function useVehicleDetail(
    selectedId: string | number | null,
    onCostsReset: () => void,
  ): VehicleDetailResult;
  ```
  `onCostsReset` is called from the reset effect so `useFleetCosts` (Task 4) can clear its own state on vehicle change without this hook importing it.

**⚠️ Read the hazard section at the top of this plan before writing this task.** Both effects go in this hook, reset first, lazy-load second.

- [ ] **Step 1: Write the failing regression test for the ordering hazard**

Create `client/src/pages/fleet/hooks/__tests__/useVehicleDetail.test.tsx`:

```tsx
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useVehicleDetail } from '../useVehicleDetail';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../components/ToastProvider', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import { apiFetch } from '../../../../hooks/useApi';

beforeEach(() => {
  localStorage.clear();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue({ data: [], summary: null } as never);
});

const urls = () => vi.mocked(apiFetch).mock.calls.map((c) => String(c[0]));

describe('useVehicleDetail', () => {
  it('loads detail for the selected vehicle', async () => {
    const { result } = renderHook(({ id }) => useVehicleDetail(id, () => {}), {
      initialProps: { id: 1 as string | number | null },
    });
    await waitFor(() => expect(urls().some((u) => u === '/fleet/1')).toBe(true));
    expect(result.current.activeTab).toBe('overview');
  });

  it('does NOT fetch the previous tab against a newly selected vehicle', async () => {
    // The hazard: switching vehicles calls setActiveTab('overview'), but that is
    // not reflected until the next render. Without the skip flag the lazy-load
    // effect reads the STALE tab and fetches it for the NEW vehicle.
    const { result, rerender } = renderHook(({ id }) => useVehicleDetail(id, () => {}), {
      initialProps: { id: 1 as string | number | null },
    });
    await waitFor(() => expect(urls().some((u) => u === '/fleet/1')).toBe(true));

    act(() => result.current.setActiveTab('fuel'));
    await waitFor(() => expect(urls().some((u) => u.startsWith('/fleet/1/fuel'))).toBe(true));

    vi.mocked(apiFetch).mockClear();
    rerender({ id: 2 });

    await waitFor(() => expect(urls().some((u) => u === '/fleet/2')).toBe(true));
    // Vehicle 2's fuel must NOT have been requested — the tab reset to overview.
    expect(urls().some((u) => u.startsWith('/fleet/2/fuel'))).toBe(false);
    await waitFor(() => expect(result.current.activeTab).toBe('overview'));
  });

  it('clears per-tab data when the vehicle changes', async () => {
    const { result, rerender } = renderHook(({ id }) => useVehicleDetail(id, () => {}), {
      initialProps: { id: 1 as string | number | null },
    });
    await waitFor(() => expect(urls().some((u) => u === '/fleet/1')).toBe(true));
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.fuelLogs).toEqual([]));
    expect(result.current.inspections).toEqual([]);
    expect(result.current.analytics).toBeNull();
  });

  it('notifies the caller to reset cost state on vehicle change', async () => {
    const onCostsReset = vi.fn();
    const { rerender } = renderHook(({ id }) => useVehicleDetail(id, onCostsReset), {
      initialProps: { id: 1 as string | number | null },
    });
    await waitFor(() => expect(urls().some((u) => u === '/fleet/1')).toBe(true));
    onCostsReset.mockClear();
    rerender({ id: 2 });
    await waitFor(() => expect(onCostsReset).toHaveBeenCalled());
  });

  it('requests analytics scoped to the vehicle', async () => {
    const { result } = renderHook(({ id }) => useVehicleDetail(id, () => {}), {
      initialProps: { id: 5 as string | number | null },
    });
    await waitFor(() => expect(urls().some((u) => u === '/fleet/5')).toBe(true));
    act(() => result.current.setActiveTab('analytics'));
    await waitFor(() => expect(urls().some((u) => u.includes('vehicle_id=5'))).toBe(true));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd client && npx vitest run src/pages/fleet/hooks/__tests__/useVehicleDetail.test.tsx
```

Expected: FAIL — cannot resolve `../useVehicleDetail`.

- [ ] **Step 3: Create the hook**

Create `client/src/pages/fleet/hooks/useVehicleDetail.ts`. Move the bodies of `fetchDetail`, `fetchFuelLogs`, `fetchInspections`, `fetchAssignments`, `fetchVehicleAnalytics`, `fetchPersonnel` **verbatim** from `FleetPage.tsx:412–528`, then add the two effects in this exact order:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { usePersistedTab } from '../../../hooks/usePersistedState';
import type { DetailTab } from '../FleetDetailPanel';
import type {
  FleetVehicle, FleetMaintenance, FleetFuelLog, FleetFuelSummary,
  FleetInspection, FleetAssignment, FleetAnalytics, FleetPersonnelData,
} from '../../../types';

const DETAIL_TABS = ['overview', 'fuel', 'costs', 'inspections', 'assignments', 'personnel',
  'tires', 'damage', 'recalls', 'analytics', 'dashcam', 'fuel_cards'] as const;

export interface VehicleDetailResult { /* …as declared in Interfaces above… */ }

/** Selected-vehicle detail plus the lazily-loaded per-tab datasets.
 *
 *  ⚠️ The reset effect and the lazy-load effect are COUPLED and must stay in
 *  this file, in this declaration order. The reset sets `skipNextLazyLoadRef`
 *  because `setActiveTab('overview')` is not visible until the next render;
 *  without the skip, the lazy-load effect runs in the SAME commit reading the
 *  stale tab and fetches the previous tab's data against the new vehicle.
 *  React runs effects in declaration order, which is the entire guarantee.
 *  Splitting them across two hooks makes this depend on call order in the
 *  component — untypechecked, and it fails as a race. */
export function useVehicleDetail(
  selectedId: string | number | null,
  onCostsReset: () => void,
): VehicleDetailResult {
  const { addToast } = useToast();
  const [detail, setDetail] = useState<FleetVehicle | null>(null);
  const [maintenance, setMaintenance] = useState<FleetMaintenance[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FleetFuelLog[]>([]);
  const [fuelSummary, setFuelSummary] = useState<FleetFuelSummary | null>(null);
  const [inspections, setInspections] = useState<FleetInspection[]>([]);
  const [assignments, setAssignments] = useState<FleetAssignment[]>([]);
  const [analytics, setAnalytics] = useState<FleetAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [personnelData, setPersonnelData] = useState<FleetPersonnelData | null>(null);
  const [personnelLoading, setPersonnelLoading] = useState(false);
  const [activeTab, setActiveTab] = usePersistedTab('rmpg_fleet_tab', 'overview' as DetailTab, DETAIL_TABS);

  const lastVehicleIdRef = useRef<string | number | null>(null);
  const skipNextLazyLoadRef = useRef(false);
  const onCostsResetRef = useRef(onCostsReset);
  onCostsResetRef.current = onCostsReset;

  // …fetchDetail / fetchFuelLogs / fetchInspections / fetchAssignments /
  // …fetchVehicleAnalytics / fetchPersonnel — moved VERBATIM from FleetPage,
  // …each wrapped in useCallback([addToast]).

  useEffect(() => { if (selectedId) fetchDetail(selectedId); }, [selectedId, fetchDetail]);

  // ── Effect A: reset on vehicle change. MUST be declared before Effect B. ──
  useEffect(() => {
    if (selectedId != null && lastVehicleIdRef.current != null && selectedId !== lastVehicleIdRef.current) {
      setActiveTab('overview');
      skipNextLazyLoadRef.current = true;
    }
    if (selectedId != null) lastVehicleIdRef.current = selectedId;
    setFuelLogs([]); setFuelSummary(null); setInspections([]); setAssignments([]);
    setAnalytics(null); setPersonnelData(null);
    onCostsResetRef.current();
  }, [selectedId, setActiveTab]);

  // ── Effect B: lazy-load the active tab. MUST be declared after Effect A. ──
  useEffect(() => {
    if (!selectedId) return;
    if (skipNextLazyLoadRef.current) { skipNextLazyLoadRef.current = false; return; }
    if (activeTab === 'fuel') fetchFuelLogs(selectedId);
    if (activeTab === 'inspections') fetchInspections(selectedId);
    if (activeTab === 'assignments') fetchAssignments(selectedId);
    if (activeTab === 'analytics') fetchVehicleAnalytics(selectedId);
    if (activeTab === 'personnel') { fetchPersonnel(selectedId); fetchAssignments(selectedId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, activeTab]);

  const clearDetail = useCallback(() => { setDetail(null); setMaintenance([]); }, []);

  return { /* …all fields from VehicleDetailResult… */ } as VehicleDetailResult;
}
```

**Note on the `costs` tab:** the original lazy-load branch is `if (activeTab === 'costs') { fetchCosts(selectedId); fetchFuelLogs(selectedId); }`. `fetchCosts` belongs to Task 4's hook, so that branch is deliberately omitted here and re-added in Task 4 via a `useFleetCosts`-owned effect keyed on `[selectedId, activeTab]`. Between Task 3 and Task 4 the Costs tab will not auto-load — **do not ship Task 3 alone**; Tasks 3 and 4 land together in one PR.

- [ ] **Step 4: Run the hook test to verify it passes**

```bash
cd client && npx vitest run src/pages/fleet/hooks/__tests__/useVehicleDetail.test.tsx
```

Expected: 5 passed. The second test is the hazard regression — if it fails, the effect order is wrong.

- [ ] **Step 5: Prove the hazard test actually detects the bug**

Temporarily comment out the `skipNextLazyLoadRef.current = true;` line, re-run:

```bash
cd client && npx vitest run src/pages/fleet/hooks/__tests__/useVehicleDetail.test.tsx
```

Expected: the "does NOT fetch the previous tab" test FAILS. Restore the line and confirm green again. A test that passes with and without the fix asserts nothing.

- [ ] **Step 6: Wire FleetPage, then verify full suite**

Delete the corresponding state, fetches, and both effects from `FleetPage.tsx`; replace with the `useVehicleDetail(selectedId, resetCosts)` call. Then:

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: green, no assertion edits.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/fleet/hooks/useVehicleDetail.ts client/src/pages/fleet/hooks/__tests__/useVehicleDetail.test.tsx client/src/pages/fleet/FleetPage.tsx
git commit -m "refactor(fleet): extract useVehicleDetail with coupled reset/lazy-load effects"
```

---

### Task 4: Extract useFleetCosts

**Files:**
- Create: `client/src/pages/fleet/hooks/useFleetCosts.ts`
- Create: `client/src/pages/fleet/hooks/__tests__/useFleetCosts.test.tsx`
- Modify: `client/src/pages/fleet/FleetPage.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `useToast`; `CostCategory`, `CostFormState`, `EMPTY_COST_FORM` from `../modals/FleetCostFormModal`; `CostSubTab` from `../FleetDetailPanel`.
- Produces:
  ```ts
  export interface FleetCostsResult {
    loans: FleetLoan[]; insurancePolicies: FleetInsurancePolicy[];
    accessories: FleetAccessory[]; utilities: FleetUtilityCost[];
    otherCosts: FleetOtherCost[]; costSummary: FleetCostSummary | null;
    costSubTab: CostSubTab; setCostSubTab: (t: CostSubTab) => void;
    costModalOpen: boolean; costCategory: CostCategory;
    costMode: 'create' | 'edit'; costInitial: CostFormState | null;
    editingCostId: string | number | null; savingCost: boolean;
    deletingCost: { category: CostCategory; record: any } | null;
    costPerMile: any; costPerMileLoading: boolean;
    handleAddCost: (c: CostCategory) => void;
    handleEditCost: (c: CostCategory, r: any) => void;
    handleDeleteCost: (c: CostCategory, r: any) => void;
    confirmDeleteCost: () => Promise<void>;
    cancelDeleteCost: () => void;
    handleSaveCost: (payload: Record<string, any>) => Promise<void>;
    handleSaveBudgets: (rows: { category: string; monthly_budget: number }[]) => Promise<void>;
    closeCostModal: () => void;
    loadCostPerMile: (id: string | number) => Promise<void>;
    clearCostPerMile: () => void;
    resetCosts: () => void;
  }
  export function useFleetCosts(
    selectedId: string | number | null,
    activeTab: string,
    fuelSummary: FleetFuelSummary | null,
    maintenance: FleetMaintenance[],
  ): FleetCostsResult;
  ```

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/fleet/hooks/__tests__/useFleetCosts.test.tsx`:

```tsx
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFleetCosts } from '../useFleetCosts';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../components/ToastProvider', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import { apiFetch } from '../../../../hooks/useApi';

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue([] as never);
});

describe('useFleetCosts', () => {
  it('loads all five cost categories when the costs tab opens', async () => {
    renderHook(() => useFleetCosts(1, 'costs', null, []));
    await waitFor(() => {
      const urls = vi.mocked(apiFetch).mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.endsWith('/loans'))).toBe(true);
      expect(urls.some((u) => u.endsWith('/insurance'))).toBe(true);
      expect(urls.some((u) => u.endsWith('/accessories'))).toBe(true);
      expect(urls.some((u) => u.endsWith('/utilities'))).toBe(true);
      expect(urls.some((u) => u.endsWith('/other-costs'))).toBe(true);
    });
  });

  it('does not fetch costs while a different tab is active', async () => {
    renderHook(() => useFleetCosts(1, 'overview', null, []));
    await new Promise((r) => setTimeout(r, 20));
    const urls = vi.mocked(apiFetch).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith('/loans'))).toBe(false);
  });

  it('normalizes a recurring annual premium to a monthly commitment', async () => {
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (String(path).endsWith('/insurance')) {
        return Promise.resolve([{ id: 1, premium: 1200, premium_frequency: 'annual' }]) as never;
      }
      return Promise.resolve([]) as never;
    });
    const { result } = renderHook(() => useFleetCosts(1, 'costs', null, []));
    await waitFor(() => expect(result.current.costSummary).not.toBeNull());
    expect(result.current.costSummary!.monthly_commitment.insurance).toBe(100);
  });

  it('excludes one-time costs from the monthly run-rate', async () => {
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (String(path).endsWith('/other-costs')) {
        return Promise.resolve([{ id: 1, amount: 500, frequency: 'one_time', status: 'active' }]) as never;
      }
      return Promise.resolve([]) as never;
    });
    const { result } = renderHook(() => useFleetCosts(1, 'costs', null, []));
    await waitFor(() => expect(result.current.costSummary).not.toBeNull());
    expect(result.current.costSummary!.monthly_commitment.other).toBe(0);
  });

  it('resetCosts clears every category', async () => {
    const { result } = renderHook(() => useFleetCosts(1, 'costs', null, []));
    await waitFor(() => expect(result.current.costSummary).not.toBeNull());
    act(() => result.current.resetCosts());
    expect(result.current.loans).toEqual([]);
    expect(result.current.costSummary).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd client && npx vitest run src/pages/fleet/hooks/__tests__/useFleetCosts.test.tsx
```

Expected: FAIL — cannot resolve `../useFleetCosts`.

- [ ] **Step 3: Create the hook**

Move `COST_PATH`, `recomputeCostSummary`, `fetchCosts`, `costRecordToForm`, `buildCostCarryOver`, `handleSaveBudgets`, `handleAddCost`, `handleEditCost`, `handleDeleteCost`, `confirmDeleteCost`, `handleSaveCost`, `loadCostPerMile` **verbatim** from `FleetPage.tsx`. Add the costs-tab lazy-load effect that Task 3 deliberately omitted:

```ts
  useEffect(() => {
    if (selectedId != null && activeTab === 'costs') fetchCosts(selectedId);
  }, [selectedId, activeTab, fetchCosts]);
```

`resetCosts` clears all five arrays plus `costSummary` and `gpsMileage`-adjacent cost state; `FleetPage` passes it to `useVehicleDetail` as `onCostsReset`.

- [ ] **Step 4: Run the hook test to verify it passes**

```bash
cd client && npx vitest run src/pages/fleet/hooks/__tests__/useFleetCosts.test.tsx
```

Expected: 5 passed.

- [ ] **Step 5: Wire FleetPage and verify the Costs tab still auto-loads**

Confirm manually in the dev server that selecting a vehicle → Costs populates, since Task 3 removed the old branch.

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: green, no assertion edits.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/fleet/hooks/useFleetCosts.ts client/src/pages/fleet/hooks/__tests__/useFleetCosts.test.tsx client/src/pages/fleet/FleetPage.tsx
git commit -m "refactor(fleet): extract useFleetCosts and restore costs-tab lazy load"
```

---

### Task 5: Extract useFleetForms

**Files:**
- Create: `client/src/pages/fleet/hooks/useFleetForms.ts`
- Create: `client/src/pages/fleet/hooks/__tests__/useFleetForms.test.tsx`
- Modify: `client/src/pages/fleet/FleetPage.tsx`

**Interfaces:**
- Consumes: `useFormDraft`, `apiFetch`, `useToast`, the four form-state types and `EMPTY_*` constants from `../modals/*`.
- Produces:
  ```ts
  export type ModalMode = 'none' | 'new_vehicle' | 'edit_vehicle' | 'log_maintenance'
    | 'edit_maintenance' | 'log_fuel' | 'edit_fuel' | 'new_inspection' | 'edit_inspection';

  // `useFormDraft` exports ONLY the function — there is no published result
  // type — so derive one rather than importing a name that does not exist.
  // Requires TS >= 4.7 (instantiation expressions); the client is on 6.0.3.
  type Draft<T> = ReturnType<typeof useFormDraft<T>>;

  export interface FleetFormsResult {
    modal: ModalMode; setModal: (m: ModalMode) => void;
    vehicleForm: VehicleFormState; setVehicleForm: (f: VehicleFormState) => void;
    maintForm: MaintenanceFormState; setMaintForm: (f: MaintenanceFormState) => void;
    fuelForm: FuelFormState; setFuelForm: (f: FuelFormState) => void;
    inspectionForm: InspectionFormState; setInspectionForm: (f: InspectionFormState) => void;
    editingFuelId: string | null; editingMaintenanceId: string | null; editingInspectionId: string | null;
    saving: boolean; isDirtyAny: boolean;
    drafts: { v: Draft<VehicleFormState>; m: Draft<MaintenanceFormState>;
              f: Draft<FuelFormState>; i: Draft<InspectionFormState> };
    handleSaveVehicle: () => Promise<void>;
    handleSaveMaintenance: () => Promise<void>;
    handleSaveFuel: () => Promise<void>;
    handleSaveInspection: () => Promise<void>;
    activeSaveHandler: () => void;
    activeCancelHandler: () => void;
    closeModal: () => void;
  }
  export function useFleetForms(args: {
    selectedId: string | number | null;
    onVehicleSaved: () => void;
    onMaintenanceSaved: () => void;
    onFuelSaved: (odometerChanged: boolean) => void;
    onInspectionSaved: (mileageChanged: boolean) => void;
  }): FleetFormsResult;
  ```
  The four `on*Saved` callbacks replace the direct `fetchDetail`/`fetchFuelLogs` calls inside the save handlers, keeping this hook independent of `useVehicleDetail`.

- [ ] **Step 1: Write the failing test**

```tsx
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFleetForms } from '../useFleetForms';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../components/ToastProvider', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import { apiFetch } from '../../../../hooks/useApi';

const noop = () => {};
const args = () => ({
  selectedId: 1 as string | number | null,
  onVehicleSaved: noop, onMaintenanceSaved: noop,
  onFuelSaved: noop, onInspectionSaved: noop,
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue({} as never);
});

describe('useFleetForms', () => {
  it('rejects a vehicle save with a blank vehicle number', async () => {
    const { result } = renderHook(() => useFleetForms(args()));
    act(() => result.current.setModal('new_vehicle'));
    await act(async () => { await result.current.handleSaveVehicle(); });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('POSTs a new vehicle and PUTs an edit', async () => {
    const { result } = renderHook(() => useFleetForms(args()));
    act(() => {
      result.current.setModal('new_vehicle');
      result.current.setVehicleForm({ ...result.current.vehicleForm, vehicle_number: 'PS-D19' });
    });
    await act(async () => { await result.current.handleSaveVehicle(); });
    expect(vi.mocked(apiFetch).mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });

  it('calls onFuelSaved with whether the odometer changed', async () => {
    const onFuelSaved = vi.fn();
    const { result } = renderHook(() => useFleetForms({ ...args(), onFuelSaved }));
    act(() => {
      result.current.setModal('log_fuel');
      result.current.setFuelForm({ ...result.current.fuelForm, fuel_date: '2026-07-26T10:00', gallons: '12', odometer_reading: '5000' });
    });
    await act(async () => { await result.current.handleSaveFuel(); });
    await waitFor(() => expect(onFuelSaved).toHaveBeenCalledWith(true));
  });

  it('activeSaveHandler dispatches by modal mode', async () => {
    const { result } = renderHook(() => useFleetForms(args()));
    act(() => {
      result.current.setModal('new_vehicle');
      result.current.setVehicleForm({ ...result.current.vehicleForm, vehicle_number: 'PS-D20' });
    });
    await act(async () => { result.current.activeSaveHandler(); });
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd client && npx vitest run src/pages/fleet/hooks/__tests__/useFleetForms.test.tsx
```

Expected: FAIL — cannot resolve `../useFleetForms`.

- [ ] **Step 3: Create the hook**

Move the four `useFormDraft` calls, `modal`, the three `editingXId` states, `saving`, `isDirtyAny`, the four `handleSave*` handlers, `activeSaveHandler`, and `activeCancelHandler` verbatim. Replace in-handler refresh calls with the `on*Saved` callbacks.

- [ ] **Step 4: Run the hook test to verify it passes**

```bash
cd client && npx vitest run src/pages/fleet/hooks/__tests__/useFleetForms.test.tsx
```

Expected: 4 passed.

- [ ] **Step 5: Wire FleetPage and verify**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: green, no assertion edits.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/fleet/hooks/useFleetForms.ts client/src/pages/fleet/hooks/__tests__/useFleetForms.test.tsx client/src/pages/fleet/FleetPage.tsx
git commit -m "refactor(fleet): extract useFleetForms"
```

---

### Task 6: Group FleetDetailPanel props

**Files:**
- Modify: `client/src/pages/fleet/FleetDetailPanel.tsx`
- Modify: `client/src/pages/fleet/FleetPage.tsx`
- Modify: `client/src/pages/fleet/__tests__/FleetDetailPanel.test.tsx` — **only** to reshape the props object it constructs, never its assertions.

**Interfaces:**
- Produces:
  ```ts
  export interface FleetDetailData {
    detail: FleetVehicle; maintenance: FleetMaintenance[];
    fuelLogs: FleetFuelLog[]; fuelSummary: FleetFuelSummary | null;
    inspections: FleetInspection[]; assignments: FleetAssignment[];
    analytics: FleetAnalytics | null; analyticsLoading: boolean;
    personnelData: FleetPersonnelData | null; personnelLoading: boolean;
    gpsMileage: any; gpsMileageLoading: boolean; isArchived: boolean;
  }
  export interface FleetDetailCosts {
    loans: FleetLoan[]; insurancePolicies: FleetInsurancePolicy[];
    accessories: FleetAccessory[]; utilities: FleetUtilityCost[];
    otherCosts: FleetOtherCost[]; summary: FleetCostSummary | null;
    subTab: CostSubTab; onSubTabChange: (t: CostSubTab) => void;
    onAdd: (c: CostCategory) => void; onEdit: (c: CostCategory, r: any) => void;
    onDelete: (c: CostCategory, r: any) => void;
    onSaveBudgets?: (rows: { category: string; monthly_budget: number }[]) => Promise<void>;
  }
  export interface FleetDetailActions {
    onEditVehicle: () => void; onLogMaintenance: () => void; onLogFuel: () => void;
    onNewInspection: () => void; onViewAllWorkOrders: () => void;
    onEditFuel?: (log: FleetFuelLog) => void; onDeleteFuel?: (log: FleetFuelLog) => void;
    onEditMaintenance?: (r: FleetMaintenance) => void; onDeleteMaintenance?: (r: FleetMaintenance) => void;
    onEditInspection?: (i: FleetInspection) => void; onDeleteInspection?: (i: FleetInspection) => void;
    onAssignVehicle: (unitId: string) => void; onUnassignVehicle: () => void;
    onAddPersonnelNote: (n: string) => void; onDeletePersonnelNote: (id: string) => void;
    onRefreshPersonnel: () => void; onArchiveVehicle: () => void;
    onUnarchiveVehicle: () => void; onDeleteVehicle: () => void;
    onFetchGpsMileage: (days?: number) => void; onSyncGpsMileage: () => void;
    onClose: () => void;
  }
  interface Props {
    data: FleetDetailData; costs: FleetDetailCosts; actions: FleetDetailActions;
    activeTab: DetailTab; onTabChange: (t: DetailTab) => void;
  }
  ```
  50 props → 5. `activeTab`/`onTabChange` stay top-level: they are the panel's own control state, not data or actions.

- [ ] **Step 1: Run the existing panel test to establish the baseline**

```bash
cd client && npx vitest run src/pages/fleet/__tests__/FleetDetailPanel.test.tsx
```

Expected: green. Record the pass count — it must be identical after this task.

- [ ] **Step 2: Replace the Props interface**

Replace the 49-field `interface Props` in `FleetDetailPanel.tsx` with the five-field version above, and destructure at the top of the component:

```tsx
export default function FleetDetailPanel({ data, costs, actions, activeTab, onTabChange }: Props) {
  const {
    detail, maintenance, fuelLogs, fuelSummary, inspections, assignments,
    analytics, analyticsLoading, personnelData, personnelLoading,
    gpsMileage, gpsMileageLoading, isArchived,
  } = data;
```

Destructuring restores every original identifier, so the ~500-line body below needs **no edits**. That is the point: the diff should be the interface plus the destructure, not the render tree.

- [ ] **Step 3: Update the two call sites**

`FleetPage.tsx` passes three grouped objects; `FleetDetailPanel.test.tsx` reshapes the props object it builds. **Do not touch the test's assertions.**

- [ ] **Step 4: Verify**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: green, identical pass count to Step 1.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/fleet/FleetDetailPanel.tsx client/src/pages/fleet/FleetPage.tsx client/src/pages/fleet/__tests__/FleetDetailPanel.test.tsx
git commit -m "refactor(fleet): group FleetDetailPanel's 50 props into data/costs/actions"
```

---

### Task 7: Verify, measure, and open the PR

**Files:** none modified.

- [ ] **Step 1: Confirm the size goal was met**

```bash
wc -l client/src/pages/fleet/FleetPage.tsx client/src/pages/fleet/hooks/*.ts
```

Expected: `FleetPage.tsx` under 400 lines. If it is materially over, say so in the PR body rather than forcing an extraction that does not fit — the goal is a file you can hold in context, not a number.

- [ ] **Step 2: Confirm no Phase 1 assertion was edited**

```bash
git diff origin/main -- client/src/pages/fleet/__tests__/FleetPage.phase1.test.tsx client/src/pages/fleet/__tests__/FleetPage.viewTabs.test.tsx client/src/pages/fleet/tabs/__tests__/FleetAnalyticsTab.scope.test.tsx
```

Expected: **empty**. Any diff here means behavior moved — investigate before proceeding.

- [ ] **Step 3: Full gates**

```bash
npm run typecheck && npx vitest run && npm run test:worker
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

Expected: all six green.

- [ ] **Step 4: Rebase onto current main and re-run**

```bash
git fetch origin && git rebase origin/main
```

Then re-run Step 3. `origin/main` moves often in this repo, and the remote auto-merges main into open PRs — CI will test a tree that never existed locally unless you rebase first.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin HEAD
```

```bash
gh pr create -R rmpgutah/rmpg-flex --base main \
  --title "refactor(fleet): Phase 2 — decompose FleetPage into four hooks" \
  --body "Phase 2 of the Fleet Manager hardening program. Behavior-preserving.

Spec: docs/superpowers/specs/2026-07-26-fleet-manager-hardening-design.md
Plan: docs/superpowers/plans/2026-07-26-fleet-manager-phase2.md

FleetPage.tsx 1,968 -> under 400 lines. Extracted useFleetVehicles, useVehicleDetail, useFleetCosts, useFleetForms. FleetDetailPanel 50 props -> 5 grouped.

The reset and lazy-load effects stayed coupled in useVehicleDetail deliberately — their correctness depends on React running effects in declaration order, and splitting them would make that depend on hook call order in the component. A regression test pins it and was confirmed to fail with the guard removed.

Phase 1 test assertions are unchanged (verified by empty diff), which is the evidence that behavior did not move.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 6: After merge, confirm the squash kept the wiring**

```bash
git fetch origin && git show origin/main:client/src/pages/fleet/FleetPage.tsx | grep -n "useFleetVehicles\|useVehicleDetail\|useFleetCosts\|useFleetForms"
```

Expected: four import lines. A squash-merge has dropped a wiring line three times in this repo; the hook files can survive while their imports do not.

---

## Not in scope

No behavior changes, no new features, no threshold configuration (PR 3), no URL state (PR 4), no bulk actions (PR 5), no readiness board (PR 6). The severity color literals stay. No focus trap is added.

## Verification summary

- `FleetPage.tsx` under 400 lines
- Phase 1 test files show an **empty** diff against `origin/main`
- All six gates green, post-rebase
- The hazard regression test confirmed to fail when the guard is removed

---

## ⛔ STATUS 2026-07-29 — Tasks 3+4 are implemented but NOT mergeable

Work paused after Task 4. Tasks 1 and 2 were reviewed clean and shipped separately
(`claude/fleet-p2-hooks-1-2`). Tasks 3 and 4 are implemented and their full suite is green
(501 files / 3764 tests, Phase 1 test files byte-identical), but a paired review found two
blocking behavior regressions. **A green suite does not clear them — nothing in the suite counts
HTTP requests, which is exactly why they slipped through.**

Task 3 itself is clean. Both blockers are in the single lazy-load effect at the end of
`useFleetCosts.ts`.

**B1 — opening the Costs tab issues the 7-endpoint cost fetch three times instead of once.**
The effect's deps are `[selectedId, activeTab, fetchCosts]`. `fetchCosts`'s identity chains
through `recomputeCostSummary` → `[fuelSummary, maintenance, costPerMile]`, and both
`costPerMile` (loaded by `fetchCosts` itself) and `fuelSummary` (loaded by `useVehicleDetail`'s
costs branch) settle *after* the first fetch — each re-mints `fetchCosts` and re-fires the effect.
Measured: **21 requests where the pre-refactor code sent 7.** Pre-refactor the equivalent effect
was keyed `[selectedId, activeTab]` with an `eslint-disable`, so it fired exactly once.

**B2 — switching vehicles while on the Costs tab fires seven net-new requests.**
Pre-refactor, the skip guard suppressed the costs branch *entirely* on a vehicle switch, so a
switch issued **zero** cost requests. Measured post-refactor: all seven `/fleet/:id/*` cost
endpoints fire. Ids are correct and they resolve after `resetCosts()`, so this is not a
wrong-vehicle bug on its own — but B1 widens the in-flight window enough that the previous
vehicle's third round can land after the switch and populate cost state from it.

**Suggested fix (a few lines).** Drop `fetchCosts` from that effect's dep array, restoring the
pre-refactor `[selectedId, activeTab]` shape (the `eslint-disable` is already present), and route
the costs branch through the existing skip guard. The cleanest way to get the guard without the
circular dependency this plan was avoiding: have `useVehicleDetail` accept an optional
`onLazyLoad(tab, id)` invoked from **inside** its guarded effect, and let `useFleetCosts` supply
it. Every tab-keyed fetch then sits behind the one `skipNextLazyLoadRef`, making the invariant the
JSDoc already asserts true of the whole page rather than of one file.

**B3 (Minor).** `useFleetCosts.test.tsx` mocks `useToast` inline, producing a fresh `addToast`
every render and an unbounded refetch loop — 638 `/loans` calls measured in a single test body,
while the test still passed (it only awaits `costSummary != null`). A harness artifact, since the
real `ToastProvider.addToast` is `useCallback([])`, but these are the tests that should have caught
B1 and B2. Hoist a stable `addToast` and a module-level `maintenance` array, and **add a
call-count assertion** — the missing assertion class here is "how many requests", not "what value".

**Also note:** these reports cite ratchet 10541; the actual pin in `accentTokens.test.ts` is
**10530** (the reports' grep included test files, which the ratchet's walker skips). Net accent
delta across Tasks 3+4 is +2/−2 = 0, so the pin is unaffected either way.

Tasks 5 (`useFleetForms`), 6 (group `FleetDetailPanel` props) and 7 (verify + PR) are **not
started**.
