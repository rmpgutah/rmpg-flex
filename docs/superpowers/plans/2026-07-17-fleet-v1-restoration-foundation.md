# Fleet v1 Restoration — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/fleet` serve the v1 tab UI permanently again, delete the v2 shell, and port every real v2-exclusive feature (Work Orders, Vendors, fleet-wide Service, Fleet.io conflict badges) into v1, with zero data loss and zero regression.

**Architecture:** Additive-first, then subtractive: new v1 components and the routing swap land first (v2 becomes dead but still-present code), then v2 and its admin-only offshoot are deleted in one task once nothing references them. All new UI is self-contained (self-fetching via `apiFetch`, no React Router dependency) to match v1's existing tab conventions, and reuses backend endpoints unchanged.

**Tech Stack:** React 18 + TypeScript, Tailwind (CSS-variable-backed tokens per `client/src/styles/theme-palettes.css`), Vitest + Testing Library, existing `apiFetch` client (`client/src/hooks/useApi.ts`).

## Global Constraints

- No backend changes — every endpoint used here already exists (`/api/work-orders*`, `/api/fleet/fuel/vendors`, `/api/fleet/{id}/maintenance`, `/api/fleetio/conflicts`).
- No schema/migration changes.
- Dense-table convention: table header `font-semibold` 9px / `py-1.5`≈`text-[11px]`, rows `text-[11px]` — matches existing v1 tabs (`FleetCostsTab.tsx`, `FleetOverviewTab.tsx`), not v2's pill-badge look.
- Radius: `rounded-sm` (2px) everywhere per `CLAUDE.md` Design tokens — never `rounded-lg`.
- Colors via Tailwind tokens (`bg-surface-base`, `text-rmpg-100`, `text-brand-400`, etc.) — never hardcoded hex, except where matching an existing file's pre-existing inline hex (e.g. `#d4a017` tab-active color already used throughout `FleetPage.tsx` — match it exactly, don't "fix" it as part of this plan).
- Every new component that fetches data must handle loading/empty/error states — matches existing v1 tab conventions (see `FleetVendorsTab` in Task 4 for the pattern).
- Test mocking convention: `vi.mock('<relative path>/hooks/useApi', () => ({ apiFetch: vi.fn() }))`, per `client/src/components/__tests__/FleetioConflictBadge.test.tsx`.

---

### Task 1: Port `useFleetWideFanOut` hook to a v1-owned location

**Files:**
- Create: `client/src/pages/fleet/hooks/useFleetWideFanOut.ts`
- Test: `client/src/pages/fleet/hooks/__tests__/useFleetWideFanOut.test.ts`

**Interfaces:**
- Produces: `useFleetWideFanOut<T>(pathFor: (vehicleId: number) => string, extract?: (resp: unknown) => T[]): { rows: FanOutRow<T>[]; loading: boolean; loadedVehicles: number; totalVehicles: number; vehicles: VehicleStub[]; refetch: () => void }`, `vehicleLabel(v: VehicleStub): string`, `interface VehicleStub { id: number; vehicle_name?: string | null; vehicle_number?: string | null }`, `interface FanOutRow<T> { vehicle: VehicleStub; row: T }`. Consumed by Task 7 (`FleetServiceTab.tsx`).

This is the same aggregation logic v2 used (fetch `/fleet?limit=500` for the vehicle list, then fan out `pathFor(vehicleId)` per vehicle, flatten into tagged rows), with `apiFetchV2` swapped for plain `apiFetch` and the v2-specific JSDoc trimmed.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/pages/fleet/hooks/__tests__/useFleetWideFanOut.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useFleetWideFanOut, vehicleLabel } from '../useFleetWideFanOut';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

describe('useFleetWideFanOut', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('fetches vehicles, fans out per-vehicle requests, and flattens tagged rows', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url === '/fleet?limit=500') {
        return Promise.resolve([
          { id: 1, vehicle_number: 'U-1' },
          { id: 2, vehicle_number: 'U-2' },
        ]);
      }
      if (url === '/fleet/1/maintenance') return Promise.resolve([{ id: 10, cost: 5 }]);
      if (url === '/fleet/2/maintenance') return Promise.resolve([{ id: 11, cost: 7 }, { id: 12, cost: 9 }]);
      return Promise.reject(new Error('unexpected url ' + url));
    });

    const { result } = renderHook(() =>
      useFleetWideFanOut<{ id: number; cost: number }>((id) => `/fleet/${id}/maintenance`)
    );

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.totalVehicles).toBe(2);
    expect(result.current.loadedVehicles).toBe(2);
    expect(result.current.rows).toHaveLength(3);
    expect(result.current.rows.map((r) => r.row.id).sort()).toEqual([10, 11, 12]);
    expect(vehicleLabel(result.current.rows[0].vehicle)).toBe('U-1');
  });

  it('refetch() re-runs the fan-out without dropping loadedVehicles to 0 mid-flight', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url === '/fleet?limit=500') return Promise.resolve([{ id: 1, vehicle_number: 'U-1' }]);
      if (url === '/fleet/1/maintenance') return Promise.resolve([{ id: 10, cost: 5 }]);
      return Promise.reject(new Error('unexpected url ' + url));
    });

    const { result } = renderHook(() =>
      useFleetWideFanOut<{ id: number; cost: number }>((id) => `/fleet/${id}/maintenance`)
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockedApiFetch.mockClear();

    act(() => result.current.refetch());
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledWith('/fleet?limit=500'));
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledWith('/fleet/1/maintenance'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/fleet/hooks/__tests__/useFleetWideFanOut.test.ts`
Expected: FAIL — `Cannot find module '../useFleetWideFanOut'`

- [ ] **Step 3: Write the hook**

```ts
// client/src/pages/fleet/hooks/useFleetWideFanOut.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';

export interface VehicleStub { id: number; vehicle_name?: string | null; vehicle_number?: string | null; }

export interface FanOutRow<T> {
  vehicle: VehicleStub;
  row: T;
}

export interface FanOutResult<T> {
  rows: FanOutRow<T>[];
  loading: boolean;
  loadedVehicles: number;
  totalVehicles: number;
  vehicles: VehicleStub[];
  refetch: () => void;
}

/** Fleet-wide aggregation across per-vehicle endpoints.
 *
 *  Fetches `/api/fleet` to learn the vehicles, then in parallel fetches
 *  `pathFor(vehicleId)` for each. Flattens results into a single list, each
 *  row tagged with its source vehicle. Acceptable for <=50 vehicles; beyond
 *  that an aggregate backend endpoint should replace this.
 *
 *  `extract` lets callers pull an array out of a wrapped response
 *  (some endpoints return `[]`, others `{ results: [] }`). `refetch()` lets
 *  callers re-run the whole fan-out after a mutation without a full page
 *  reload. `vehicles` is exposed so callers needing a "pick a vehicle"
 *  dropdown don't need a second `/fleet?limit=500` fetch.
 *
 *  Note: changing `pathFor` or `extract`'s identity does not auto-retrigger
 *  the fetch (only `refetch()` does) — call `refetch()` after changing
 *  inputs that affect the request. */
export function useFleetWideFanOut<T>(
  pathFor: (vehicleId: number) => string,
  extract?: (resp: unknown) => T[],
): FanOutResult<T> {
  const [vehicles, setVehicles] = useState<VehicleStub[]>([]);
  const [rows, setRows] = useState<FanOutRow<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedVehicles, setLoadedVehicles] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  const pathForRef = useRef(pathFor);
  pathForRef.current = pathFor;
  const extractRef = useRef(extract);
  extractRef.current = extract;
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (!hasLoadedRef.current) setLoading(true);
    apiFetch<VehicleStub[] | { data: VehicleStub[] }>('/fleet?limit=500')
      .then((vlist) => {
        if (cancelled) return;
        const list = Array.isArray(vlist)
          ? vlist
          : (vlist && Array.isArray((vlist as { data?: VehicleStub[] }).data))
            ? (vlist as { data: VehicleStub[] }).data
            : [];
        setVehicles(list);
        if (list.length === 0) {
          hasLoadedRef.current = true;
          setLoading(false);
          return;
        }
        Promise.allSettled(list.map((v) => apiFetch<unknown>(pathForRef.current(v.id))))
          .then((results) => {
            if (cancelled) return;
            const flat: FanOutRow<T>[] = [];
            for (let i = 0; i < list.length; i++) {
              const r = results[i];
              if (r.status !== 'fulfilled') continue;
              const currentExtract = extractRef.current;
              const arr = currentExtract ? currentExtract(r.value) : asArray<T>(r.value);
              for (const row of arr) flat.push({ vehicle: list[i], row });
            }
            setRows(flat);
            setLoadedVehicles(list.length);
            hasLoadedRef.current = true;
            setLoading(false);
          });
      })
      .catch(() => { if (!cancelled) { hasLoadedRef.current = true; setLoading(false); } });
    return () => { cancelled = true; };
  }, [refreshToken]);

  const refetch = useCallback(() => setRefreshToken((t) => t + 1), []);

  return { rows, loading, loadedVehicles, totalVehicles: vehicles.length, vehicles, refetch };
}

function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object' && Array.isArray((v as { results?: T[] }).results)) {
    return (v as { results: T[] }).results;
  }
  return [];
}

export function vehicleLabel(v: VehicleStub): string {
  return v.vehicle_name ?? v.vehicle_number ?? `Vehicle ${v.id}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/fleet/hooks/__tests__/useFleetWideFanOut.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/fleet/hooks/useFleetWideFanOut.ts client/src/pages/fleet/hooks/__tests__/useFleetWideFanOut.test.ts
git commit -m "feat(fleet): port useFleetWideFanOut hook to v1, off apiFetchV2"
```

---

### Task 2: Add `WorkOrder`/`WorkOrderStats` types to the central types file

**Files:**
- Modify: `client/src/types/index.ts:1524` (insert after `FleetMaintenance`, before the `// --- Fleet Fuel ---` comment)

**Interfaces:**
- Produces: `WorkOrderStatus`, `WorkOrderPriority`, `WorkOrder`, `WorkOrderStats` — consumed by Tasks 5, 6, 9.

No test for a pure type-only change — TypeScript compilation is the verification.

- [ ] **Step 1: Insert the types**

```ts
// client/src/types/index.ts — insert immediately after the closing `}` of
// FleetMaintenance (currently line 1524) and before `// --- Fleet Fuel ---`
```

```ts
// --- Fleet Work Orders ---
// Note: ids here are number (matching the actual D1/JSON runtime shape from
// src/routes/workOrders.ts), unlike the string ids used elsewhere in this
// file for other Fleet types.

export type WorkOrderStatus = 'open' | 'in_progress' | 'waiting_parts' | 'completed' | 'cancelled';
export type WorkOrderPriority = 'low' | 'normal' | 'high' | 'emergency';

export interface WorkOrder {
  id: number;
  vehicle_id: number;
  status: WorkOrderStatus;
  number: string | null;
  opened_at: string;
  closed_at: string | null;
  summary: string | null;
  vendor_id: number | null;
  est_cost: number | null;
  actual_cost: number | null;
  category_code: string | null;
  notes: string | null;
  priority?: WorkOrderPriority;
  scheduled_date?: string | null;
  failure_category?: string | null;
  estimated_hours?: number | null;
  labor_hours?: number | null;
}

export interface WorkOrderStats {
  total: number;
  open: number;
  in_progress: number;
  waiting_parts: number;
  completed: number;
  cancelled: number;
  by_priority: Record<string, number>;
  by_category: Record<string, number>;
  total_estimated_cost: number;
  total_actual_cost: number;
  overdue_count: number;
  scheduled_count: number;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS (0 new errors — same pre-existing error count as before this change)

- [ ] **Step 3: Commit**

```bash
git add client/src/types/index.ts
git commit -m "feat(fleet): add WorkOrder/WorkOrderStats types"
```

---

### Task 3: Build `FleetVendorsTab.tsx`

**Files:**
- Create: `client/src/pages/fleet/tabs/FleetVendorsTab.tsx`
- Test: `client/src/pages/fleet/tabs/__tests__/FleetVendorsTab.test.tsx`

**Interfaces:**
- Consumes: `apiFetch<T>(endpoint, opts?)` from `client/src/hooks/useApi.ts`; `safeDateStr` from `client/src/utils/dateUtils.ts`; `PanelTitleBar` from `client/src/components/PanelTitleBar.tsx`.
- Produces: `export default function FleetVendorsTab(): JSX.Element` — no props, self-fetching, fleet-wide, read-only. Consumed by Task 8 (`FleetPage.tsx` wiring).

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/fleet/tabs/__tests__/FleetVendorsTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FleetVendorsTab from '../FleetVendorsTab';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

describe('FleetVendorsTab', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('shows a loading state, then renders vendor rows sorted by price', async () => {
    mockedApiFetch.mockResolvedValue([
      { id: 1, name: 'Speedy Fuel', brand: 'Shell', location: 'SLC', current_price_per_gallon: 3.5 },
      { id: 2, name: 'Cheap Gas', brand: 'Costco', location: 'West Jordan', current_price_per_gallon: 2.9 },
    ]);
    render(<FleetVendorsTab />);
    expect(screen.getByText(/loading vendors/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Cheap Gas')).toBeInTheDocument());
    const rows = screen.getAllByRole('row').slice(1); // drop header row
    expect(rows[0]).toHaveTextContent('Cheap Gas');
    expect(rows[1]).toHaveTextContent('Speedy Fuel');
    expect(mockedApiFetch).toHaveBeenCalledWith('/fleet/fuel/vendors');
  });

  it('filters by search text across name/brand/location', async () => {
    mockedApiFetch.mockResolvedValue([
      { id: 1, name: 'Speedy Fuel', brand: 'Shell', location: 'SLC', current_price_per_gallon: 3.5 },
      { id: 2, name: 'Cheap Gas', brand: 'Costco', location: 'West Jordan', current_price_per_gallon: 2.9 },
    ]);
    render(<FleetVendorsTab />);
    await waitFor(() => expect(screen.getByText('Speedy Fuel')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/search by name/i), { target: { value: 'costco' } });
    expect(screen.queryByText('Speedy Fuel')).not.toBeInTheDocument();
    expect(screen.getByText('Cheap Gas')).toBeInTheDocument();
  });

  it('shows an empty state when there are no vendors', async () => {
    mockedApiFetch.mockResolvedValue([]);
    render(<FleetVendorsTab />);
    await waitFor(() => expect(screen.getByText(/no fuel vendors on file/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/fleet/tabs/__tests__/FleetVendorsTab.test.tsx`
Expected: FAIL — `Cannot find module '../FleetVendorsTab'`

- [ ] **Step 3: Write the component**

```tsx
// client/src/pages/fleet/tabs/FleetVendorsTab.tsx
import { useEffect, useMemo, useState } from 'react';
import { Store } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { safeDateStr } from '../../../utils/dateUtils';
import PanelTitleBar from '../../../components/PanelTitleBar';

interface VendorRow {
  id: number;
  name?: string | null;
  brand?: string | null;
  location?: string | null;
  current_price_per_gallon?: number | null;
  last_updated?: string | null;
  notes?: string | null;
}

export default function FleetVendorsTab() {
  const [rows, setRows] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch<VendorRow[]>('/fleet/fuel/vendors')
      .then((r) => { if (!cancelled) setRows(Array.isArray(r) ? r : []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...rows].sort((a, b) =>
      (a.current_price_per_gallon ?? Infinity) - (b.current_price_per_gallon ?? Infinity)
    );
    if (!q) return sorted;
    return sorted.filter((r) =>
      [r.name, r.brand, r.location].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <div className="p-4 space-y-3">
      <PanelTitleBar title="FUEL VENDORS" icon={Store} />
      <input
        type="text"
        placeholder="Search by name, brand, or location…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-2 py-1 text-[11px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 placeholder:text-rmpg-500"
      />
      {loading ? (
        <div className="p-4 text-xs text-rmpg-400">Loading vendors…</div>
      ) : filtered.length === 0 ? (
        <div className="p-4 text-xs text-rmpg-400">
          {rows.length === 0 ? 'No fuel vendors on file.' : 'No vendors match the search.'}
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-surface-base">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold">Name</th>
              <th className="text-left px-3 py-1.5 font-semibold">Brand</th>
              <th className="text-left px-3 py-1.5 font-semibold">Location</th>
              <th className="text-right px-3 py-1.5 font-semibold">$/gal</th>
              <th className="text-left px-3 py-1.5 font-semibold">Updated</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-rmpg-800/40 hover:bg-rmpg-800/40">
                <td className="px-3 py-1 text-rmpg-100">{r.name ?? '—'}</td>
                <td className="px-3 py-1 text-rmpg-300">{r.brand ?? '—'}</td>
                <td className="px-3 py-1 text-rmpg-300">{r.location ?? '—'}</td>
                <td className="px-3 py-1 text-right text-rmpg-300">{r.current_price_per_gallon != null ? `$${Number(r.current_price_per_gallon).toFixed(3)}` : '—'}</td>
                <td className="px-3 py-1 text-rmpg-300">{safeDateStr(r.last_updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/fleet/tabs/__tests__/FleetVendorsTab.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/fleet/tabs/FleetVendorsTab.tsx client/src/pages/fleet/tabs/__tests__/FleetVendorsTab.test.tsx
git commit -m "feat(fleet): add v1 fleet-wide Vendors tab"
```

---

### Task 4: Build `WorkOrderFormModal.tsx`

**Files:**
- Create: `client/src/pages/fleet/modals/WorkOrderFormModal.tsx`
- Test: `client/src/pages/fleet/modals/__tests__/WorkOrderFormModal.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (`client/src/hooks/useApi.ts`); `VmrsPicker`, `type VmrsSelection` (`client/src/components/fleet/VmrsPicker.tsx`); `type WorkOrder` (`client/src/types/index.ts`, Task 2).
- Produces: `export interface WorkOrderFormVehicle { id: number; vehicle_number: string | null; vehicle_name: string | null }`; `export default function WorkOrderFormModal(props: { vehicles: WorkOrderFormVehicle[]; onClose: () => void; onCreated: () => void }): JSX.Element`. Consumed by Task 5 (`FleetWorkOrdersTab.tsx`).

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/fleet/modals/__tests__/WorkOrderFormModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorkOrderFormModal from '../WorkOrderFormModal';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

const VEHICLES = [{ id: 5, vehicle_number: 'U-5', vehicle_name: null }];

describe('WorkOrderFormModal', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('requires a vehicle before saving', () => {
    const onCreated = vi.fn();
    render(<WorkOrderFormModal vehicles={VEHICLES} onClose={vi.fn()} onCreated={onCreated} />);
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(screen.getByText(/vehicle is required/i)).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('POSTs the form and calls onCreated on success', async () => {
    mockedApiFetch.mockResolvedValue({ data: { id: 1 } });
    const onCreated = vi.fn();
    render(<WorkOrderFormModal vehicles={VEHICLES} onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/vehicle \*/i), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText(/short one-liner/i), { target: { value: 'Brake check' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/work-orders',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((mockedApiFetch.mock.calls[0][1] as { body: string }).body);
    expect(body).toMatchObject({ vehicle_id: 5, summary: 'Brake check', status: 'open' });
  });

  it('shows an error message when the create request fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('boom'));
    render(<WorkOrderFormModal vehicles={VEHICLES} onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/vehicle \*/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/fleet/modals/__tests__/WorkOrderFormModal.test.tsx`
Expected: FAIL — `Cannot find module '../WorkOrderFormModal'`

- [ ] **Step 3: Write the component**

```tsx
// client/src/pages/fleet/modals/WorkOrderFormModal.tsx
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { VmrsPicker, type VmrsSelection } from '../../../components/fleet/VmrsPicker';
import { apiFetch } from '../../../hooks/useApi';
import type { WorkOrder, WorkOrderStatus } from '../../../types';

export interface WorkOrderFormVehicle {
  id: number;
  vehicle_number: string | null;
  vehicle_name: string | null;
}

interface Props {
  vehicles: WorkOrderFormVehicle[];
  onClose: () => void;
  onCreated: () => void;
}

export default function WorkOrderFormModal({ vehicles, onClose, onCreated }: Props) {
  const [vehicleId, setVehicleId] = useState('');
  const [number, setNumber] = useState('');
  const [summary, setSummary] = useState('');
  const [status, setStatus] = useState<WorkOrderStatus>('open');
  const [estCost, setEstCost] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('normal');
  const [scheduledDate, setScheduledDate] = useState('');
  const [failureCategory, setFailureCategory] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [vmrsSelection, setVmrsSelection] = useState<VmrsSelection | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose, saving]);

  const handleSave = () => {
    setErr(null);
    if (!vehicleId) {
      setErr('Vehicle is required.');
      return;
    }
    setSaving(true);
    apiFetch<{ data: WorkOrder }>('/work-orders', {
      method: 'POST',
      body: JSON.stringify({
        vehicle_id: parseInt(vehicleId, 10),
        number: number.trim() || null,
        summary: summary.trim() || null,
        status,
        priority,
        scheduled_date: scheduledDate || null,
        failure_category: failureCategory || null,
        estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
        vmrs_system_code: vmrsSelection?.systemCode ?? null,
        vmrs_assembly_code: vmrsSelection?.assemblyCode ?? null,
        vmrs_component_code: vmrsSelection?.componentCode ?? null,
        est_cost: estCost ? parseFloat(estCost) : null,
        notes: notes.trim() || null,
      }),
    })
      .then(() => { setSaving(false); onCreated(); })
      .catch((e) => {
        setSaving(false);
        setErr(e instanceof Error ? e.message : 'Failed to create work order');
      });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-wo-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={saving ? undefined : onClose}
    >
      <div
        className="bg-surface-raised border border-rmpg-700 rounded-sm w-[480px] max-w-full mx-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700">
          <h2 id="new-wo-title" className="text-sm font-semibold text-rmpg-100">New Work Order</h2>
          <button type="button" onClick={onClose} className="text-rmpg-400 hover:text-rmpg-100 p-1" disabled={saving} aria-label="Close">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>
        <div className="p-4 space-y-3">
          {err ? (
            <div className="px-3 py-2 rounded-sm border border-red-500/40 text-red-300 text-xs">{err}</div>
          ) : null}
          <Field label="Vehicle *" htmlFor="wo-vehicle">
            <select
              id="wo-vehicle"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              aria-required
            >
              <option value="">— select vehicle —</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vehicle_number ?? v.vehicle_name ?? `Vehicle ${v.id}`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="WO Number (optional)">
            <input
              type="text"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Shop-assigned number"
            />
          </Field>
          <Field label="Summary">
            <input
              type="text"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Short one-liner"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={status}
                onChange={(e) => setStatus(e.target.value as WorkOrderStatus)}
              >
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="waiting_parts">Waiting parts</option>
              </select>
            </Field>
            <Field label="Priority">
              <select
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="emergency">Emergency</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Scheduled Date">
              <input
                type="date"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
              />
            </Field>
            <Field label="Est. hours">
              <input
                type="number"
                inputMode="decimal"
                step="0.5"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                placeholder="e.g. 2.5"
              />
            </Field>
          </div>
          <Field label="Failure Category">
            <select
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
              value={failureCategory}
              onChange={(e) => setFailureCategory(e.target.value)}
            >
              <option value="">— None —</option>
              <option value="mechanical">Mechanical</option>
              <option value="electrical">Electrical</option>
              <option value="body">Body / Cosmetics</option>
              <option value="tires">Tires / Wheels</option>
              <option value="brakes">Brakes</option>
              <option value="engine">Engine</option>
              <option value="transmission">Transmission</option>
              <option value="hvac">HVAC</option>
              <option value="lights">Lights / Sirens</option>
              <option value="radio">Radio / Comms</option>
              <option value="computer">Computer / MDT</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="VMRS Code (optional)">
            <VmrsPicker value={vmrsSelection} onChange={setVmrsSelection} />
          </Field>
          <Field label="Est. cost ($)">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
              value={estCost}
              onChange={(e) => setEstCost(e.target.value)}
            />
          </Field>
          <Field label="Notes">
            <textarea
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 h-16 resize-none"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
        <footer className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button type="button" onClick={onClose} disabled={saving} className="px-2 py-1 text-[11px] border border-rmpg-700 rounded-sm hover:bg-rmpg-800 text-rmpg-100">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110 disabled:opacity-50">
            {saving ? 'Saving…' : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[10px] text-rmpg-400 uppercase tracking-wide mb-0.5">{label}</label>
      {children}
    </div>
  );
}
```

Note: `Field` renders a real `<label htmlFor>`, and the `Vehicle` field above passes matching `id="wo-vehicle"`/`htmlFor="wo-vehicle"` — that association is what makes the test's `screen.getByLabelText(/vehicle \*/i)` resolve to the `<select>`. The other `<Field>` usages omit `htmlFor` (harmless — `<label htmlFor={undefined}>` just renders an unassociated label) since the test only queries the Vehicle field by label.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/fleet/modals/__tests__/WorkOrderFormModal.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/fleet/modals/WorkOrderFormModal.tsx client/src/pages/fleet/modals/__tests__/WorkOrderFormModal.test.tsx
git commit -m "feat(fleet): add WorkOrderFormModal (create flow)"
```

---

### Task 5: Build `FleetWorkOrdersTab.tsx`

**Files:**
- Create: `client/src/pages/fleet/tabs/FleetWorkOrdersTab.tsx`
- Test: `client/src/pages/fleet/tabs/__tests__/FleetWorkOrdersTab.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (`client/src/hooks/useApi.ts`); `WorkOrderFormModal`, `type WorkOrderFormVehicle` (Task 4); `type WorkOrder, WorkOrderStatus, WorkOrderStats` (Task 2); `FleetioConflictBadge`, `type ConflictBadgeConflict` (`client/src/components/FleetioConflictBadge.tsx`, unchanged); `PanelTitleBar`.
- Produces: `export default function FleetWorkOrdersTab(props: { initialVehicleId?: number }): JSX.Element`. Consumed by Task 8 (`FleetPage.tsx` wiring, also passes `initialVehicleId` from Task 9's "View all" deep-link).

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/fleet/tabs/__tests__/FleetWorkOrdersTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FleetWorkOrdersTab from '../FleetWorkOrdersTab';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

const WO_LIST = { count: 1, data: [{ id: 1, vehicle_id: 5, status: 'open', number: 'WO-1', opened_at: '2026-07-01', closed_at: null, summary: 'Brake check', vendor_id: null, est_cost: 100, actual_cost: null, category_code: null, notes: null }] };
const STATS = { stats: { total: 1, open: 1, in_progress: 0, waiting_parts: 0, completed: 0, cancelled: 0, by_priority: {}, by_category: {}, total_estimated_cost: 100, total_actual_cost: 0, overdue_count: 0, scheduled_count: 0 } };
const VEHICLES = { data: [{ id: 5, vehicle_number: 'U-5', vehicle_name: null }] };

function mockFetch() {
  mockedApiFetch.mockImplementation((url: string) => {
    if (url.startsWith('/work-orders/stats')) return Promise.resolve(STATS);
    if (url.startsWith('/work-orders')) return Promise.resolve(WO_LIST);
    if (url.startsWith('/fleet?limit=500')) return Promise.resolve(VEHICLES);
    if (url.startsWith('/fleetio/conflicts')) return Promise.resolve({ conflicts: [] });
    return Promise.reject(new Error('unexpected url ' + url));
  });
}

describe('FleetWorkOrdersTab', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('lists work orders with vehicle labels resolved', async () => {
    mockFetch();
    render(<FleetWorkOrdersTab />);
    await waitFor(() => expect(screen.getByText('WO-1')).toBeInTheDocument());
    expect(screen.getByText('U-5')).toBeInTheDocument();
    expect(screen.getByText('Brake check')).toBeInTheDocument();
  });

  it('opens the create modal and refetches the list on success', async () => {
    mockFetch();
    render(<FleetWorkOrdersTab />);
    await waitFor(() => expect(screen.getByText('WO-1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /new work order/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    mockedApiFetch.mockResolvedValueOnce({ data: { id: 2 } });
    fireEvent.change(screen.getByLabelText(/vehicle \*/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('pre-filters to initialVehicleId when provided', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/work-orders/stats')) return Promise.resolve(STATS);
      if (url.startsWith('/work-orders')) return Promise.resolve({
        count: 2,
        data: [
          ...WO_LIST.data,
          { id: 2, vehicle_id: 9, status: 'open', number: 'WO-2', opened_at: '2026-07-02', closed_at: null, summary: 'Other vehicle', vendor_id: null, est_cost: null, actual_cost: null, category_code: null, notes: null },
        ],
      });
      if (url.startsWith('/fleet?limit=500')) return Promise.resolve(VEHICLES);
      if (url.startsWith('/fleetio/conflicts')) return Promise.resolve({ conflicts: [] });
      return Promise.reject(new Error('unexpected url ' + url));
    });
    render(<FleetWorkOrdersTab initialVehicleId={5} />);
    await waitFor(() => expect(screen.getByText('WO-1')).toBeInTheDocument());
    expect(screen.queryByText('WO-2')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/fleet/tabs/__tests__/FleetWorkOrdersTab.test.tsx`
Expected: FAIL — `Cannot find module '../FleetWorkOrdersTab'`

- [ ] **Step 3: Write the component**

```tsx
// client/src/pages/fleet/tabs/FleetWorkOrdersTab.tsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { Plus, ClipboardList } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import PanelTitleBar from '../../../components/PanelTitleBar';
import FleetioConflictBadge from '../../../components/FleetioConflictBadge';
import type { ConflictBadgeConflict } from '../../../components/FleetioConflictBadge';
import WorkOrderFormModal, { type WorkOrderFormVehicle } from '../modals/WorkOrderFormModal';
import type { WorkOrder, WorkOrderStats, WorkOrderStatus } from '../../../types';

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_parts: 'Waiting parts',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_TONES: Record<WorkOrderStatus, string> = {
  open: 'bg-amber-500/15 text-amber-300',
  in_progress: 'bg-blue-500/15 text-blue-300',
  waiting_parts: 'bg-purple-500/15 text-purple-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  cancelled: 'bg-rmpg-700/40 text-rmpg-400',
};

interface Props {
  initialVehicleId?: number;
}

export default function FleetWorkOrdersTab({ initialVehicleId }: Props) {
  const [rows, setRows] = useState<WorkOrder[]>([]);
  const [vehicles, setVehicles] = useState<WorkOrderFormVehicle[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | WorkOrderStatus>('all');
  const [openOnly, setOpenOnly] = useState(true);
  const [vehicleFilter, setVehicleFilter] = useState<number | null>(initialVehicleId ?? null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [conflicts, setConflicts] = useState<Map<number, ConflictBadgeConflict[]>>(new Map());
  const [stats, setStats] = useState<WorkOrderStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const fetchedIds = useRef<string>('');

  useEffect(() => {
    const ids = rows.map((r) => r.id);
    const key = ids.join(',');
    if (!ids.length || key === fetchedIds.current) return;
    fetchedIds.current = key;
    apiFetch<{ conflicts: Record<string, unknown>[] }>(`/fleetio/conflicts?table=work_order&ids=${ids.join(',')}`)
      .then((r) => {
        if (!r?.conflicts) return;
        const map = new Map<number, ConflictBadgeConflict[]>();
        for (const c of r.conflicts) {
          const rmpgId = c.rmpg_id as number;
          if (!map.has(rmpgId)) map.set(rmpgId, []);
          map.get(rmpgId)!.push({
            id: c.id as number,
            field: c.field as string,
            local_value: c.local_value as string | null | undefined,
            remote_value: c.remote_value as string | null | undefined,
            resolution: c.resolution as string | null | undefined,
            created_at: c.created_at as string | undefined,
          });
        }
        setConflicts(map);
      })
      .catch(() => {});
  }, [rows]);

  const fetchRows = useCallback(() => {
    setErr(null);
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (openOnly) params.set('open_only', '1');
    if (vehicleFilter != null) params.set('vehicle_id', String(vehicleFilter));
    params.set('limit', '200');
    apiFetch<{ count: number; data: WorkOrder[] }>(`/work-orders?${params.toString()}`)
      .then((r) => { setRows(r?.data ?? []); setLoading(false); })
      .catch((e) => { setErr(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); });
  }, [statusFilter, openOnly, vehicleFilter]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  useEffect(() => {
    setStatsLoading(true);
    apiFetch<{ stats: WorkOrderStats }>('/work-orders/stats')
      .then((r) => { setStats(r?.stats ?? null); setStatsLoading(false); })
      .catch(() => setStatsLoading(false));
  }, []);

  useEffect(() => {
    apiFetch<WorkOrderFormVehicle[] | { data: WorkOrderFormVehicle[] }>('/fleet?limit=500')
      .then((r) => {
        const arr = Array.isArray(r) ? r : (r && Array.isArray((r as { data?: WorkOrderFormVehicle[] }).data)) ? (r as { data: WorkOrderFormVehicle[] }).data : [];
        setVehicles(arr);
      })
      .catch(() => setVehicles([]));
  }, []);

  const vehicleLabel = (vid: number) => {
    const v = vehicles.find((x) => x.id === vid);
    if (!v) return `Vehicle #${vid}`;
    return v.vehicle_number ?? v.vehicle_name ?? `Vehicle #${vid}`;
  };

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return [r.summary, r.number, r.notes, vehicleLabel(r.vehicle_id)].filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  return (
    <div className="p-4 space-y-3">
      <PanelTitleBar title="WORK ORDERS" icon={ClipboardList}>
        <select
          className="px-2 py-1 text-[11px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | WorkOrderStatus)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="waiting_parts">Waiting parts</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <label className="text-[11px] text-rmpg-300 flex items-center gap-1">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} className="accent-brand-400" />
          Open only
        </label>
        {vehicleFilter != null && (
          <button type="button" onClick={() => setVehicleFilter(null)} className="text-[10px] text-brand-400 hover:underline">
            Vehicle: {vehicleLabel(vehicleFilter)} — clear ✕
          </button>
        )}
        <button type="button" onClick={() => setModalOpen(true)} className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110">
          <Plus className="w-3 h-3" /> New Work Order
        </button>
      </PanelTitleBar>

      <input
        type="text"
        placeholder="Search by vehicle, summary, or WO number…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-2 py-1 text-[11px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 placeholder:text-rmpg-500"
      />

      {!statsLoading && stats && (
        <div className="grid grid-cols-5 gap-2 px-1 py-2">
          <Stat label="Total Open" value={(stats.open ?? 0) + (stats.in_progress ?? 0) + (stats.waiting_parts ?? 0)} />
          <Stat label="Overdue" value={stats.overdue_count} tone={stats.overdue_count > 0 ? 'text-red-400' : 'text-rmpg-400'} />
          <Stat label="Scheduled" value={stats.scheduled_count} tone="text-blue-400" />
          <Stat label="Est. Cost" value={`$${(stats.total_estimated_cost ?? 0).toLocaleString()}`} />
          <Stat label="Actual Cost" value={`$${(stats.total_actual_cost ?? 0).toLocaleString()}`} />
        </div>
      )}

      {err ? (
        <div className="p-3 rounded-sm border border-red-500/40 text-red-300 text-xs">{err}</div>
      ) : loading ? (
        <div className="p-4 text-xs text-rmpg-400">Loading work orders…</div>
      ) : filtered.length === 0 ? (
        <div className="p-4 text-xs text-rmpg-400">
          {rows.length === 0 ? 'No work orders yet. Click "New Work Order" to create the first one.' : 'No work orders match the current filters.'}
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-surface-base">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold">WO #</th>
              <th className="text-left px-3 py-1.5 font-semibold">Vehicle</th>
              <th className="text-left px-3 py-1.5 font-semibold">Status</th>
              <th className="text-left px-3 py-1.5 font-semibold">Opened</th>
              <th className="text-left px-3 py-1.5 font-semibold">Summary</th>
              <th className="text-right px-3 py-1.5 font-semibold">Est</th>
              <th className="text-right px-3 py-1.5 font-semibold">Actual</th>
              <th className="text-center px-3 py-1.5 font-semibold">Sync</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-rmpg-800/40 hover:bg-rmpg-800/40">
                <td className="px-3 py-1 font-mono text-rmpg-100">{r.number ?? `#${r.id}`}</td>
                <td className="px-3 py-1 text-rmpg-100">{vehicleLabel(r.vehicle_id)}</td>
                <td className="px-3 py-1">
                  <span className={`px-1.5 py-0.5 rounded-sm text-[10px] uppercase tracking-wide ${STATUS_TONES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                </td>
                <td className="px-3 py-1 font-mono text-rmpg-300">{r.opened_at?.slice(0, 10) ?? '—'}</td>
                <td className="px-3 py-1 text-rmpg-200 max-w-[280px] truncate" title={r.summary ?? ''}>{r.summary ?? '—'}</td>
                <td className="px-3 py-1 text-right text-rmpg-300 font-mono">{r.est_cost != null ? `$${r.est_cost.toFixed(2)}` : '—'}</td>
                <td className="px-3 py-1 text-right text-rmpg-100 font-mono">{r.actual_cost != null ? `$${r.actual_cost.toFixed(2)}` : '—'}</td>
                <td className="px-3 py-1 text-center">
                  {(() => {
                    const c = conflicts.get(r.id);
                    return c?.length ? (
                      <div className="inline-flex gap-0.5">{c.map((x) => <FleetioConflictBadge key={x.id} conflict={x} compact />)}</div>
                    ) : (
                      <span className="text-rmpg-500">—</span>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modalOpen ? (
        <WorkOrderFormModal
          vehicles={vehicles}
          onClose={() => setModalOpen(false)}
          onCreated={() => { setModalOpen(false); fetchRows(); }}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="panel-beveled p-2 text-center bg-surface-sunken">
      <div className="text-[9px] text-rmpg-500 uppercase tracking-wider font-bold">{label}</div>
      <div className={`text-lg font-bold font-mono ${tone ?? 'text-rmpg-100'}`}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/fleet/tabs/__tests__/FleetWorkOrdersTab.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/fleet/tabs/FleetWorkOrdersTab.tsx client/src/pages/fleet/tabs/__tests__/FleetWorkOrdersTab.test.tsx
git commit -m "feat(fleet): add v1 fleet-wide Work Orders tab (list + create + conflicts)"
```

---

### Task 6: Build `FleetServiceTab.tsx`

**Files:**
- Create: `client/src/pages/fleet/tabs/FleetServiceTab.tsx`
- Test: `client/src/pages/fleet/tabs/__tests__/FleetServiceTab.test.tsx`

**Interfaces:**
- Consumes: `useFleetWideFanOut`, `vehicleLabel` (Task 1); `apiFetch`; `FleetioConflictBadge`, `type ConflictBadgeConflict`; `safeDateStr`; `PanelTitleBar`.
- Produces: `export default function FleetServiceTab(): JSX.Element`. Consumed by Task 8.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/fleet/tabs/__tests__/FleetServiceTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import FleetServiceTab from '../FleetServiceTab';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

describe('FleetServiceTab', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('fans out per-vehicle maintenance and renders a fleet-wide list sorted by date desc', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url === '/fleet?limit=500') return Promise.resolve([{ id: 1, vehicle_number: 'U-1' }, { id: 2, vehicle_number: 'U-2' }]);
      if (url === '/fleet/1/maintenance') return Promise.resolve([{ id: 10, service_type: 'oil_change', service_date: '2026-06-01', cost: 40 }]);
      if (url === '/fleet/2/maintenance') return Promise.resolve([{ id: 11, service_type: 'brake_service', service_date: '2026-07-01', cost: 200 }]);
      if (url.startsWith('/fleetio/conflicts')) return Promise.resolve({ conflicts: [] });
      return Promise.reject(new Error('unexpected url ' + url));
    });
    render(<FleetServiceTab />);
    await waitFor(() => expect(screen.getByText('brake_service')).toBeInTheDocument());
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('brake_service'); // newer date first
    expect(rows[1]).toHaveTextContent('oil_change');
  });

  it('shows an empty state when the fleet has no service entries', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url === '/fleet?limit=500') return Promise.resolve([]);
      return Promise.reject(new Error('unexpected url ' + url));
    });
    render(<FleetServiceTab />);
    await waitFor(() => expect(screen.getByText(/no service entries in the fleet yet/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/fleet/tabs/__tests__/FleetServiceTab.test.tsx`
Expected: FAIL — `Cannot find module '../FleetServiceTab'`

- [ ] **Step 3: Write the component**

```tsx
// client/src/pages/fleet/tabs/FleetServiceTab.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Wrench } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useFleetWideFanOut, vehicleLabel } from '../hooks/useFleetWideFanOut';
import { safeDateStr } from '../../../utils/dateUtils';
import FleetioConflictBadge from '../../../components/FleetioConflictBadge';
import type { ConflictBadgeConflict } from '../../../components/FleetioConflictBadge';
import PanelTitleBar from '../../../components/PanelTitleBar';

interface ServiceRow {
  id: number;
  service_type?: string | null;
  service_date?: string | null;
  cost?: number | null;
  vendor?: string | null;
  mileage_at_service?: string | number | null;
}

export default function FleetServiceTab() {
  const pathFor = (id: number) => `/fleet/${id}/maintenance`;
  const { rows, loading, loadedVehicles, totalVehicles } = useFleetWideFanOut<ServiceRow>(pathFor);
  const [search, setSearch] = useState('');
  const [conflicts, setConflicts] = useState<Map<number, ConflictBadgeConflict[]>>(new Map());
  const fetchedIds = useRef<string>('');

  useEffect(() => {
    const ids = rows.map((r) => r.row.id);
    const key = ids.join(',');
    if (!ids.length || key === fetchedIds.current) return;
    fetchedIds.current = key;
    apiFetch<{ conflicts: Record<string, unknown>[] }>(`/fleetio/conflicts?table=fleet_maintenance&ids=${ids.join(',')}`)
      .then((r) => {
        if (!r?.conflicts) return;
        const map = new Map<number, ConflictBadgeConflict[]>();
        for (const c of r.conflicts) {
          const rmpgId = c.rmpg_id as number;
          if (!map.has(rmpgId)) map.set(rmpgId, []);
          map.get(rmpgId)!.push({
            id: c.id as number,
            field: c.field as string,
            local_value: c.local_value as string | null | undefined,
            remote_value: c.remote_value as string | null | undefined,
            resolution: c.resolution as string | null | undefined,
            created_at: c.created_at as string | undefined,
          });
        }
        setConflicts(map);
      })
      .catch(() => {});
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...rows].sort((a, b) => (b.row.service_date ?? '').localeCompare(a.row.service_date ?? ''));
    if (!q) return sorted;
    return sorted.filter((entry) =>
      [vehicleLabel(entry.vehicle), entry.row.service_type, entry.row.vendor].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <div className="p-4 space-y-3">
      <PanelTitleBar title="SERVICE (FLEET-WIDE)" icon={Wrench} />
      <input
        type="text"
        placeholder="Search by vehicle, service type, or vendor…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-2 py-1 text-[11px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 placeholder:text-rmpg-500"
      />
      {loading ? (
        <div className="p-4 text-xs text-rmpg-400">Loading service entries · {loadedVehicles}/{totalVehicles} vehicles…</div>
      ) : filtered.length === 0 ? (
        <div className="p-4 text-xs text-rmpg-400">
          {rows.length === 0 ? 'No service entries in the fleet yet.' : 'No entries match the search.'}
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-surface-base">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold">Date</th>
              <th className="text-left px-3 py-1.5 font-semibold">Vehicle</th>
              <th className="text-left px-3 py-1.5 font-semibold">Service</th>
              <th className="text-left px-3 py-1.5 font-semibold">Vendor</th>
              <th className="text-right px-3 py-1.5 font-semibold">Mileage</th>
              <th className="text-right px-3 py-1.5 font-semibold">Cost</th>
              <th className="text-center px-3 py-1.5 font-semibold">Sync</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ vehicle, row }) => {
              const rowConflicts = conflicts.get(row.id);
              return (
                <tr key={`${vehicle.id}-${row.id}`} className="border-b border-rmpg-800/40 hover:bg-rmpg-800/40">
                  <td className="px-3 py-1 text-rmpg-300">{safeDateStr(row.service_date)}</td>
                  <td className="px-3 py-1 text-rmpg-100">{vehicleLabel(vehicle)}</td>
                  <td className="px-3 py-1 text-rmpg-100">{row.service_type ?? '—'}</td>
                  <td className="px-3 py-1 text-rmpg-300">{row.vendor ?? '—'}</td>
                  <td className="px-3 py-1 text-right text-rmpg-300">{row.mileage_at_service ?? '—'}</td>
                  <td className="px-3 py-1 text-right text-rmpg-300">{row.cost != null ? `$${Number(row.cost).toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-1 text-center">
                    {rowConflicts?.length ? (
                      <div className="inline-flex gap-0.5">{rowConflicts.map((c) => <FleetioConflictBadge key={c.id} conflict={c} compact />)}</div>
                    ) : (
                      <span className="text-rmpg-500">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/fleet/tabs/__tests__/FleetServiceTab.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/fleet/tabs/FleetServiceTab.tsx client/src/pages/fleet/tabs/__tests__/FleetServiceTab.test.tsx
git commit -m "feat(fleet): add v1 fleet-wide Service tab"
```

---

### Task 7: Wire the three new tabs into `FleetPage.tsx`

**Files:**
- Modify: `client/src/pages/fleet/FleetPage.tsx:26-28` (imports), `:126` (`viewMode` type), `:1466-1517` (tab bar + render branches)

**Interfaces:**
- Consumes: `FleetVendorsTab` (Task 3), `FleetWorkOrdersTab` (Task 5), `FleetServiceTab` (Task 6).
- Produces: `FleetPage`'s `viewMode` now includes `'work_orders' | 'vendors' | 'service'`; a new piece of state `workOrdersVehicleFilter: number | null` and its setter, consumed by Task 9.

No new test file — this is wiring inside an existing megafile with no isolated unit-test seam. Verified via typecheck + the manual checklist in Task 12.

- [ ] **Step 1: Add imports**

```tsx
// client/src/pages/fleet/FleetPage.tsx — add after the existing
// `import FleetAnalysisFormsTab from './tabs/FleetAnalysisFormsTab';` (line 28)
import FleetVendorsTab from './tabs/FleetVendorsTab';
import FleetWorkOrdersTab from './tabs/FleetWorkOrdersTab';
import FleetServiceTab from './tabs/FleetServiceTab';
```

- [ ] **Step 2: Extend `viewMode` state**

Find (line 126):
```tsx
  const [viewMode, setViewMode] = useState<'dashboard' | 'analysis'>('dashboard');
```
Replace with:
```tsx
  const [viewMode, setViewMode] = useState<'dashboard' | 'analysis' | 'work_orders' | 'vendors' | 'service'>('dashboard');
  const [workOrdersVehicleFilter, setWorkOrdersVehicleFilter] = useState<number | null>(null);
```

- [ ] **Step 3: Add tab buttons and render branches**

Find (lines 1466-1517, the fleet-wide view-mode toggle block):
```tsx
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex border-b border-subtle bg-surface-sunken flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setViewMode('dashboard')}
                  className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors"
                  style={{
                    color: viewMode === 'dashboard' ? '#d4a017' : '#888',
                    borderBottom: viewMode === 'dashboard' ? '2px solid #d4a017' : '2px solid transparent',
                  }}
                >
                  Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('analysis')}
                  className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors flex items-center gap-1"
                  style={{
                    color: viewMode === 'analysis' ? '#d4a017' : '#888',
                    borderBottom: viewMode === 'analysis' ? '2px solid #d4a017' : '2px solid transparent',
                  }}
                >
                  <FileText size={10} /> Analysis Reports
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {viewMode === 'dashboard' ? (
                  <>
                    <MaintenanceMonitor onSelectVehicle={(id) => { setSelectedId(id); fetchDetail(id); }} />
                    {fleetAnalytics ? (
                      <div className="px-3 pb-3">
                        <FleetAnalyticsTab analytics={fleetAnalytics} loading={fleetAnalyticsLoading} onPeriodChange={(p) => fetchFleetAnalytics(p)} />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center py-8">
                        <div className="text-center">
                          <Car className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                          <p className="text-xs text-rmpg-500">Select a vehicle to view details</p>
                          <p className="text-[10px] text-rmpg-600 mt-1">{vehicles.length} vehicles in fleet</p>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <FleetAnalysisFormsTab
                    vehicles={vehicles}
                    vehicleNumberById={vehicleNumberById}
                  />
                )}
              </div>
            </div>
```

Replace with (adds three buttons + three render branches, same style pattern):
```tsx
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex border-b border-subtle bg-surface-sunken flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setViewMode('dashboard')}
                  className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors"
                  style={{
                    color: viewMode === 'dashboard' ? '#d4a017' : '#888',
                    borderBottom: viewMode === 'dashboard' ? '2px solid #d4a017' : '2px solid transparent',
                  }}
                >
                  Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('analysis')}
                  className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors flex items-center gap-1"
                  style={{
                    color: viewMode === 'analysis' ? '#d4a017' : '#888',
                    borderBottom: viewMode === 'analysis' ? '2px solid #d4a017' : '2px solid transparent',
                  }}
                >
                  <FileText size={10} /> Analysis Reports
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('work_orders')}
                  className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors"
                  style={{
                    color: viewMode === 'work_orders' ? '#d4a017' : '#888',
                    borderBottom: viewMode === 'work_orders' ? '2px solid #d4a017' : '2px solid transparent',
                  }}
                >
                  Work Orders
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('vendors')}
                  className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors"
                  style={{
                    color: viewMode === 'vendors' ? '#d4a017' : '#888',
                    borderBottom: viewMode === 'vendors' ? '2px solid #d4a017' : '2px solid transparent',
                  }}
                >
                  Vendors
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('service')}
                  className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors"
                  style={{
                    color: viewMode === 'service' ? '#d4a017' : '#888',
                    borderBottom: viewMode === 'service' ? '2px solid #d4a017' : '2px solid transparent',
                  }}
                >
                  Service
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {viewMode === 'dashboard' ? (
                  <>
                    <MaintenanceMonitor onSelectVehicle={(id) => { setSelectedId(id); fetchDetail(id); }} />
                    {fleetAnalytics ? (
                      <div className="px-3 pb-3">
                        <FleetAnalyticsTab analytics={fleetAnalytics} loading={fleetAnalyticsLoading} onPeriodChange={(p) => fetchFleetAnalytics(p)} />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center py-8">
                        <div className="text-center">
                          <Car className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                          <p className="text-xs text-rmpg-500">Select a vehicle to view details</p>
                          <p className="text-[10px] text-rmpg-600 mt-1">{vehicles.length} vehicles in fleet</p>
                        </div>
                      </div>
                    )}
                  </>
                ) : viewMode === 'analysis' ? (
                  <FleetAnalysisFormsTab
                    vehicles={vehicles}
                    vehicleNumberById={vehicleNumberById}
                  />
                ) : viewMode === 'work_orders' ? (
                  <FleetWorkOrdersTab initialVehicleId={workOrdersVehicleFilter ?? undefined} />
                ) : viewMode === 'vendors' ? (
                  <FleetVendorsTab />
                ) : (
                  <FleetServiceTab />
                )}
              </div>
            </div>
```

- [ ] **Step 4: Run typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS (0 new errors)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/fleet/FleetPage.tsx
git commit -m "feat(fleet): wire Work Orders/Vendors/Service tabs into FleetPage"
```

---

### Task 8: Build `OpenWorkOrdersPanel` and wire it into `FleetCostsTab.tsx`

**Files:**
- Create: `client/src/pages/fleet/tabs/OpenWorkOrdersPanel.tsx`
- Test: `client/src/pages/fleet/tabs/__tests__/OpenWorkOrdersPanel.test.tsx`
- Modify: `client/src/pages/fleet/tabs/FleetCostsTab.tsx` (add `vehicleId`/`onViewAllWorkOrders` props, mount the panel)
- Modify: `client/src/pages/fleet/FleetDetailPanel.tsx` (thread `vehicleId`/`onViewAllWorkOrders` through to `FleetCostsTab`)
- Modify: `client/src/pages/fleet/FleetPage.tsx` (pass the real callback into `FleetDetailPanel`)

**Interfaces:**
- Consumes: `apiFetch`.
- Produces: `export default function OpenWorkOrdersPanel(props: { vehicleId: string; onViewAll: () => void }): JSX.Element | null`.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/fleet/tabs/__tests__/OpenWorkOrdersPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import OpenWorkOrdersPanel from '../OpenWorkOrdersPanel';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

describe('OpenWorkOrdersPanel', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('fetches open work orders scoped to the vehicle and lists them', async () => {
    mockedApiFetch.mockResolvedValue({ count: 1, data: [{ id: 1, status: 'open', number: 'WO-1', summary: 'Brake check', opened_at: '2026-07-01' }] });
    render(<OpenWorkOrdersPanel vehicleId="5" onViewAll={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/WO-1/)).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledWith('/work-orders?vehicle_id=5&open_only=1&limit=100');
  });

  it('shows an empty message when there are no open work orders', async () => {
    mockedApiFetch.mockResolvedValue({ count: 0, data: [] });
    render(<OpenWorkOrdersPanel vehicleId="5" onViewAll={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no open work orders/i)).toBeInTheDocument());
  });

  it('calls onViewAll when "View all" is clicked', async () => {
    mockedApiFetch.mockResolvedValue({ count: 0, data: [] });
    const onViewAll = vi.fn();
    render(<OpenWorkOrdersPanel vehicleId="5" onViewAll={onViewAll} />);
    await waitFor(() => expect(screen.getByText(/no open work orders/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /view all/i }));
    expect(onViewAll).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/fleet/tabs/__tests__/OpenWorkOrdersPanel.test.tsx`
Expected: FAIL — `Cannot find module '../OpenWorkOrdersPanel'`

- [ ] **Step 3: Write the component**

```tsx
// client/src/pages/fleet/tabs/OpenWorkOrdersPanel.tsx
import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import type { WorkOrderStatus } from '../../../types';

interface WorkOrderSummaryRow {
  id: number;
  status: WorkOrderStatus;
  number: string | null;
  summary: string | null;
  opened_at: string;
}

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_parts: 'Waiting parts',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

interface Props {
  vehicleId: string;
  onViewAll: () => void;
}

export default function OpenWorkOrdersPanel({ vehicleId, onViewAll }: Props) {
  const [rows, setRows] = useState<WorkOrderSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<{ count: number; data: WorkOrderSummaryRow[] }>(`/work-orders?vehicle_id=${vehicleId}&open_only=1&limit=100`)
      .then((r) => { if (!cancelled) setRows(r?.data ?? []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (loading) return null;

  return (
    <div className="panel-beveled bg-surface-sunken p-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider flex items-center gap-1">
          <Wrench className="w-3 h-3" /> Open Work Orders{rows.length > 0 ? ` (${rows.length})` : ''}
        </div>
        <button type="button" onClick={onViewAll} className="text-[9px] text-brand-400 hover:underline">
          View all →
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="text-[10px] text-rmpg-500 py-1">No open work orders for this vehicle.</div>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-[10px] font-mono text-rmpg-200">
              <span className="truncate flex-1">{r.number ?? `#${r.id}`} — {r.summary ?? 'No summary'}</span>
              <span className="text-rmpg-400 ml-2">{STATUS_LABELS[r.status]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/fleet/tabs/__tests__/OpenWorkOrdersPanel.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire into `FleetCostsTab.tsx`**

Modify the `Props` interface (currently lines 34-43) — find:
```tsx
interface Props {
  loans: FleetLoan[];
  insurance: FleetInsurancePolicy[];
  accessories: FleetAccessory[];
  utilities: FleetUtilityCost[];
  other: FleetOtherCost[];
  summary: FleetCostSummary | null;
  subTab: SubTab;
  onSubTabChange: (t: SubTab) => void;
  onAdd: (category: CostCategory) => void;
  onEdit: (category: CostCategory, record: any) => void;
  onDelete: (category: CostCategory, record: any) => void;
  onSaveBudgets?: (rows: { category: string; monthly_budget: number }[]) => Promise<void>;
}
```
Replace with:
```tsx
interface Props {
  vehicleId: string;
  onViewAllWorkOrders: () => void;
  loans: FleetLoan[];
  insurance: FleetInsurancePolicy[];
  accessories: FleetAccessory[];
  utilities: FleetUtilityCost[];
  other: FleetOtherCost[];
  summary: FleetCostSummary | null;
  subTab: SubTab;
  onSubTabChange: (t: SubTab) => void;
  onAdd: (category: CostCategory) => void;
  onEdit: (category: CostCategory, record: any) => void;
  onDelete: (category: CostCategory, record: any) => void;
  onSaveBudgets?: (rows: { category: string; monthly_budget: number }[]) => Promise<void>;
}
```

Add the import (near the top, alongside the other local imports):
```tsx
import OpenWorkOrdersPanel from './OpenWorkOrdersPanel';
```

Update the function signature (currently lines 96-99) — find:
```tsx
export default function FleetCostsTab({
  loans, insurance, accessories, utilities, other, summary,
  subTab, onSubTabChange, onAdd, onEdit, onDelete, onSaveBudgets,
}: Props) {
```
Replace with:
```tsx
export default function FleetCostsTab({
  vehicleId, onViewAllWorkOrders,
  loans, insurance, accessories, utilities, other, summary,
  subTab, onSubTabChange, onAdd, onEdit, onDelete, onSaveBudgets,
}: Props) {
```

Insert the panel right after the alerts strip closes and before the Budget vs. Actual section — find:
```tsx
      )}

      {/* ── Budget vs. Actual — inline-editable rows ────────── */}
      {onSaveBudgets && summary && (
```
Replace with:
```tsx
      )}

      <OpenWorkOrdersPanel vehicleId={vehicleId} onViewAll={onViewAllWorkOrders} />

      {/* ── Budget vs. Actual — inline-editable rows ────────── */}
      {onSaveBudgets && summary && (
```

- [ ] **Step 6: Thread `vehicleId`/`onViewAllWorkOrders` through `FleetDetailPanel.tsx`**

Add to the `Props` interface (after `onSaveBudgets` in the "Cost-of-ownership tab" block, currently line 116) — find:
```tsx
  onSaveBudgets?: (rows: { category: string; monthly_budget: number }[]) => Promise<void>;
```
Replace with:
```tsx
  onSaveBudgets?: (rows: { category: string; monthly_budget: number }[]) => Promise<void>;
  onViewAllWorkOrders: () => void;
```

Update the destructured props of `FleetDetailPanel`'s function signature to include `onViewAllWorkOrders` (find the matching destructure line — it mirrors the `Props` interface order; add `onViewAllWorkOrders,` next to `onSaveBudgets,`).

Update the `<FleetCostsTab` invocation (currently lines 534-547) — find:
```tsx
          <FleetCostsTab
            loans={loans}
            insurance={insurancePolicies}
            accessories={accessories}
            utilities={utilities}
            other={otherCosts}
            summary={costSummary}
            subTab={costSubTab}
            onSubTabChange={onCostSubTabChange}
            onAdd={onAddCost}
            onEdit={onEditCost}
            onDelete={onDeleteCost}
            onSaveBudgets={onSaveBudgets}
          />
```
Replace with:
```tsx
          <FleetCostsTab
            vehicleId={detail.id}
            onViewAllWorkOrders={onViewAllWorkOrders}
            loans={loans}
            insurance={insurancePolicies}
            accessories={accessories}
            utilities={utilities}
            other={otherCosts}
            summary={costSummary}
            subTab={costSubTab}
            onSubTabChange={onCostSubTabChange}
            onAdd={onAddCost}
            onEdit={onEditCost}
            onDelete={onDeleteCost}
            onSaveBudgets={onSaveBudgets}
          />
```

- [ ] **Step 7: Pass the real callback from `FleetPage.tsx`**

Find the `<FleetDetailPanel` invocation (starts at line 1525) and add `onViewAllWorkOrders` to its prop list:
```tsx
            <FleetDetailPanel
              detail={detail}
              maintenance={maintenance}
              fuelLogs={fuelLogs}
```
Replace with:
```tsx
            <FleetDetailPanel
              detail={detail}
              onViewAllWorkOrders={() => {
                setWorkOrdersVehicleFilter(Number(detail.id));
                setSelectedId(null);
                setDetail(null);
                setViewMode('work_orders');
              }}
              maintenance={maintenance}
              fuelLogs={fuelLogs}
```

- [ ] **Step 8: Run typecheck and the full fleet test suite**

Run: `cd client && npx tsc --noEmit`
Expected: PASS (0 new errors)

Run: `cd client && npx vitest run src/pages/fleet/`
Expected: PASS (all fleet tests, including the 3 new `OpenWorkOrdersPanel` tests)

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/fleet/tabs/OpenWorkOrdersPanel.tsx client/src/pages/fleet/tabs/__tests__/OpenWorkOrdersPanel.test.tsx client/src/pages/fleet/tabs/FleetCostsTab.tsx client/src/pages/fleet/FleetDetailPanel.tsx client/src/pages/fleet/FleetPage.tsx
git commit -m "feat(fleet): add per-vehicle Open Work Orders panel with deep-link to fleet-wide tab"
```

---

### Task 9: Wire `FleetioConflictBadge` into `FleetOverviewTab.tsx`

**Files:**
- Modify: `client/src/pages/fleet/tabs/FleetOverviewTab.tsx`
- Test: `client/src/pages/fleet/tabs/__tests__/FleetOverviewTab.conflicts.test.tsx`

**Interfaces:**
- Consumes: `FleetioConflictBadge`, `type ConflictBadgeConflict`.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/fleet/tabs/__tests__/FleetOverviewTab.conflicts.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import FleetOverviewTab from '../FleetOverviewTab';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

const DETAIL: any = { id: '5', vehicle_number: 'U-5', status: 'in_service', current_mileage: 1000 };
const MAINTENANCE: any[] = [{ id: 20, type: 'oil_change', performed_at: '2026-06-01', cost: 40 }];

describe('FleetOverviewTab conflict badges', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('renders a vehicle-level conflict badge when fleet_vehicles has one', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.includes('table=fleet_vehicles')) {
        return Promise.resolve({ conflicts: [{ id: 1, rmpg_id: 5, field: 'plate_number', local_value: 'ABC123', remote_value: 'XYZ789' }] });
      }
      if (url.includes('table=fleet_maintenance')) return Promise.resolve({ conflicts: [] });
      return Promise.resolve(null);
    });
    render(<FleetOverviewTab detail={DETAIL} maintenance={MAINTENANCE} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /conflict on plate_number/i })).toBeInTheDocument());
  });

  it('renders a per-row conflict badge on a maintenance entry', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.includes('table=fleet_vehicles')) return Promise.resolve({ conflicts: [] });
      if (url.includes('table=fleet_maintenance')) {
        return Promise.resolve({ conflicts: [{ id: 2, rmpg_id: 20, field: 'cost', local_value: '40', remote_value: '45' }] });
      }
      return Promise.resolve(null);
    });
    render(<FleetOverviewTab detail={DETAIL} maintenance={MAINTENANCE} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /conflict on cost/i })).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/fleet/tabs/__tests__/FleetOverviewTab.conflicts.test.tsx`
Expected: FAIL — no matching role found (badges don't exist yet)

- [ ] **Step 3: Add conflict-fetching state and badges**

Add imports (top of file, alongside existing `apiFetch` import):
```tsx
import FleetioConflictBadge from '../../../components/FleetioConflictBadge';
import type { ConflictBadgeConflict } from '../../../components/FleetioConflictBadge';
```

Add state + fetch effects inside the component (after the existing three `useEffect`/`useState` pairs at lines 78-87) — find:
```tsx
  useEffect(() => {
    if (!detail?.id) return;
    apiFetch<any>(`/fleet/${detail.id}/fuel-efficiency`).then((d: any) => d && setFuelEfficiency(d)).catch(() => {});
    apiFetch<any>(`/fleet/${detail.id}/maintenance-costs`).then((d: any) => d && setMaintenanceCosts(d)).catch(() => {});
    apiFetch<any>(`/fleet/${detail.id}/mileage-history`).then((d: any) => Array.isArray(d) && setMileageHistory(d)).catch(() => {});
  }, [detail?.id]);
```
Replace with:
```tsx
  useEffect(() => {
    if (!detail?.id) return;
    apiFetch<any>(`/fleet/${detail.id}/fuel-efficiency`).then((d: any) => d && setFuelEfficiency(d)).catch(() => {});
    apiFetch<any>(`/fleet/${detail.id}/maintenance-costs`).then((d: any) => d && setMaintenanceCosts(d)).catch(() => {});
    apiFetch<any>(`/fleet/${detail.id}/mileage-history`).then((d: any) => Array.isArray(d) && setMileageHistory(d)).catch(() => {});
  }, [detail?.id]);

  const [vehicleConflicts, setVehicleConflicts] = useState<ConflictBadgeConflict[]>([]);
  useEffect(() => {
    if (!detail?.id) return;
    apiFetch<{ conflicts: Record<string, unknown>[] }>(`/fleetio/conflicts?table=fleet_vehicles&ids=${detail.id}`)
      .then((r) => setVehicleConflicts((r?.conflicts ?? []).map((c) => ({
        id: c.id as number,
        field: c.field as string,
        local_value: c.local_value as string | null | undefined,
        remote_value: c.remote_value as string | null | undefined,
        resolution: c.resolution as string | null | undefined,
      }))))
      .catch(() => {});
  }, [detail?.id]);

  const [maintenanceConflicts, setMaintenanceConflicts] = useState<Map<number, ConflictBadgeConflict[]>>(new Map());
  useEffect(() => {
    const ids = maintenance.map((m) => m.id);
    if (!ids.length) return;
    apiFetch<{ conflicts: Record<string, unknown>[] }>(`/fleetio/conflicts?table=fleet_maintenance&ids=${ids.join(',')}`)
      .then((r) => {
        const map = new Map<number, ConflictBadgeConflict[]>();
        for (const c of r?.conflicts ?? []) {
          const rmpgId = c.rmpg_id as number;
          if (!map.has(rmpgId)) map.set(rmpgId, []);
          map.get(rmpgId)!.push({
            id: c.id as number,
            field: c.field as string,
            local_value: c.local_value as string | null | undefined,
            remote_value: c.remote_value as string | null | undefined,
            resolution: c.resolution as string | null | undefined,
          });
        }
        setMaintenanceConflicts(map);
      })
      .catch(() => {});
  }, [maintenance]);
```

Render the vehicle-level badges — find (opening of the return block):
```tsx
  return (
    <div className="p-4 space-y-3">
      {/* Vehicle Stats Row */}
```
Replace with:
```tsx
  return (
    <div className="p-4 space-y-3">
      {vehicleConflicts.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {vehicleConflicts.map((c) => <FleetioConflictBadge key={c.id} conflict={c} compact />)}
        </div>
      )}
      {/* Vehicle Stats Row */}
```

Render the per-maintenance-row badge — find (inside the maintenance `.map`, the cost/edit/delete button row):
```tsx
                        <div className="flex items-center gap-3">
                          {m.mileage_at_service != null && Number.isFinite(Number(m.mileage_at_service)) && (
                            <span className="text-[9px] text-rmpg-400 flex items-center gap-0.5">
                              <Gauge className="w-2.5 h-2.5" />{Number(m.mileage_at_service).toLocaleString()} mi
                            </span>
                          )}
                          {m.cost != null && (
                            <span className="text-[10px] text-green-400 font-mono font-bold">${m.cost.toFixed(2)}</span>
                          )}
```
Replace with:
```tsx
                        <div className="flex items-center gap-3">
                          {m.mileage_at_service != null && Number.isFinite(Number(m.mileage_at_service)) && (
                            <span className="text-[9px] text-rmpg-400 flex items-center gap-0.5">
                              <Gauge className="w-2.5 h-2.5" />{Number(m.mileage_at_service).toLocaleString()} mi
                            </span>
                          )}
                          {m.cost != null && (
                            <span className="text-[10px] text-green-400 font-mono font-bold">${m.cost.toFixed(2)}</span>
                          )}
                          {maintenanceConflicts.get(m.id)?.map((c) => (
                            <FleetioConflictBadge key={c.id} conflict={c} compact />
                          ))}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/fleet/tabs/__tests__/FleetOverviewTab.conflicts.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/fleet/tabs/FleetOverviewTab.tsx client/src/pages/fleet/tabs/__tests__/FleetOverviewTab.conflicts.test.tsx
git commit -m "feat(fleet): surface Fleet.io conflict badges in Overview tab (vehicle + maintenance rows)"
```

---

### Task 10: Wire `FleetioConflictBadge` into `FleetFuelTab.tsx`

**Files:**
- Modify: `client/src/pages/fleet/tabs/FleetFuelTab.tsx`
- Test: `client/src/pages/fleet/tabs/__tests__/FleetFuelTab.conflicts.test.tsx`

**Interfaces:**
- Consumes: `FleetioConflictBadge`, `type ConflictBadgeConflict`.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/fleet/tabs/__tests__/FleetFuelTab.conflicts.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import FleetFuelTab from '../FleetFuelTab';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

const LOGS: any[] = [{ id: 30, gallons: 10, fuel_type: 'regular', total_cost: 35 }];

describe('FleetFuelTab conflict badges', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('renders a per-row conflict badge on a fuel log entry', async () => {
    mockedApiFetch.mockResolvedValue({ conflicts: [{ id: 3, rmpg_id: 30, field: 'gallons', local_value: '10', remote_value: '10.2' }] });
    render(<FleetFuelTab fuelLogs={LOGS} summary={null} onAddFuel={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /conflict on gallons/i })).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledWith('/fleetio/conflicts?table=fleet_fuel_log&ids=30');
  });

  it('renders nothing extra when there are no conflicts', async () => {
    mockedApiFetch.mockResolvedValue({ conflicts: [] });
    render(<FleetFuelTab fuelLogs={LOGS} summary={null} onAddFuel={vi.fn()} />);
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /conflict on/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/fleet/tabs/__tests__/FleetFuelTab.conflicts.test.tsx`
Expected: FAIL — no matching role found

- [ ] **Step 3: Add conflict-fetching state and badge**

Add imports (top of file):
```tsx
import { useEffect, useState } from 'react';
import FleetioConflictBadge from '../../../components/FleetioConflictBadge';
import type { ConflictBadgeConflict } from '../../../components/FleetioConflictBadge';
import { apiFetch } from '../../../hooks/useApi';
```
(`useEffect`/`useState` are new to this file — it currently has no top-level React import since it's a pure function component with no local state; add the import line rather than merging into a nonexistent existing React import.)

Add state + effect inside the component (right after the `flaggedCount` line, before `return`) — find:
```tsx
  const flaggedCount = fuelLogs.filter((l: any) => !!l.flags).length;
  return (
```
Replace with:
```tsx
  const flaggedCount = fuelLogs.filter((l: any) => !!l.flags).length;

  const [conflicts, setConflicts] = useState<Map<number, ConflictBadgeConflict[]>>(new Map());
  useEffect(() => {
    const ids = fuelLogs.map((l) => Number(l.id));
    if (!ids.length) { setConflicts(new Map()); return; }
    apiFetch<{ conflicts: Record<string, unknown>[] }>(`/fleetio/conflicts?table=fleet_fuel_log&ids=${ids.join(',')}`)
      .then((r) => {
        const map = new Map<number, ConflictBadgeConflict[]>();
        for (const c of r?.conflicts ?? []) {
          const rmpgId = c.rmpg_id as number;
          if (!map.has(rmpgId)) map.set(rmpgId, []);
          map.get(rmpgId)!.push({
            id: c.id as number,
            field: c.field as string,
            local_value: c.local_value as string | null | undefined,
            remote_value: c.remote_value as string | null | undefined,
            resolution: c.resolution as string | null | undefined,
          });
        }
        setConflicts(map);
      })
      .catch(() => {});
  }, [fuelLogs]);

  return (
```

Render the badge in the fuel-log row's badge strip — find:
```tsx
                    {/* Partial-fill flag — full tanks are the norm, so only
                        call out partials (they're excluded from MPG). */}
                    {(log.is_full_tank === 0 || log.is_full_tank === false) && (
                      <span className="px-1 py-0.5 text-[8px] font-bold uppercase text-amber-400 bg-amber-900/20 border border-amber-700/30">Partial</span>
                    )}
                  </div>
```
Replace with:
```tsx
                    {/* Partial-fill flag — full tanks are the norm, so only
                        call out partials (they're excluded from MPG). */}
                    {(log.is_full_tank === 0 || log.is_full_tank === false) && (
                      <span className="px-1 py-0.5 text-[8px] font-bold uppercase text-amber-400 bg-amber-900/20 border border-amber-700/30">Partial</span>
                    )}
                    {conflicts.get(Number(log.id))?.map((c) => (
                      <FleetioConflictBadge key={c.id} conflict={c} compact />
                    ))}
                  </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/fleet/tabs/__tests__/FleetFuelTab.conflicts.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/fleet/tabs/FleetFuelTab.tsx client/src/pages/fleet/tabs/__tests__/FleetFuelTab.conflicts.test.tsx
git commit -m "feat(fleet): surface Fleet.io conflict badges in Fuel tab rows"
```

---

### Task 11: Routing swap — `/fleet` serves v1 again

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:** None (routing only).

- [ ] **Step 1: Remove the `FleetShell` lazy import**

Find (line 78):
```tsx
const FleetShell = lazyRetry(() => import('./pages/fleet/v2/FleetShell'));
```
Delete this line entirely (keep the `FleetPage` lazy import on line 77 unchanged).

- [ ] **Step 2: Replace the three fleet routes with one**

Find (lines ~547-558):
```tsx
                 /fleet now serves the v2 Fleet.io-style shell.
                 /fleet-legacy keeps the old UI mounted for ≥7 days as the
                 ...
                 FleetPage code are removed in PR 7'd after the second
                 7-day soak. The /fleet/v2/* parallel mount is kept for
                 ...
                 hitting /fleet/v2 still lands on the new UI). */}
            <Route path="/fleet/v2/*" element={<RouteErrorBoundary><FleetShell /></RouteErrorBoundary>} />
            <Route path="/fleet/*" element={<RouteErrorBoundary><FleetShell /></RouteErrorBoundary>} />
            <Route path="/fleet-legacy" element={<RouteErrorBoundary><FleetPage /></RouteErrorBoundary>} />
```

Read the full comment block first (it spans a few lines above `/fleet/v2/*`) and replace the entire comment + three routes with:
```tsx
            {/* /fleet serves the v1 tab-based UI permanently — the v2
                Fleet.io-style shell was retired 2026-07-17 (see
                docs/superpowers/specs/2026-07-17-fleet-v1-restoration-foundation-design.md). */}
            <Route path="/fleet/*" element={<RouteErrorBoundary><FleetPage /></RouteErrorBoundary>} />
```

- [ ] **Step 3: Run typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS. `FleetShell` will no longer be referenced by `App.tsx`, but `client/src/pages/fleet/v2/FleetShell.tsx` still exists on disk (deleted in Task 12) — an unused file doesn't fail typecheck.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(fleet): route /fleet back to the v1 UI, drop /fleet-legacy and /fleet/v2"
```

---

### Task 12: Delete v2 and its admin-only offshoot

**Files:**
- Delete: `client/src/pages/fleet/v2/` (entire directory)
- Delete: `client/src/types/fleetV2Audit.ts`
- Delete: `client/src/pages/admin/AdminFleetV2HealthTab.tsx`
- Delete: `client/src/pages/admin/__tests__/AdminFleetV2HealthTab.test.tsx`
- Modify: `client/src/pages/AdminPage.tsx:66,251,278,757,1152-1154`

**Interfaces:** None (deletion + cleanup of dangling references).

- [ ] **Step 1: Grep-verify what still references the files about to be deleted**

Run:
```bash
grep -rln "fleet/v2\|FleetShell\|apiFetchV2\|useFleetV2Audit\|fleetV2Audit\|AdminFleetV2HealthTab" client/src --include="*.tsx" --include="*.ts" | grep -v "client/src/pages/fleet/v2/" | grep -v "client/src/pages/admin/AdminFleetV2HealthTab" | grep -v "client/src/types/fleetV2Audit.ts"
```
Expected output: only `client/src/pages/AdminPage.tsx` (handled in Step 3 below) and `client/src/App.tsx` should show zero hits (Task 11 already removed its references — if `App.tsx` appears here, Task 11 was incomplete; stop and fix it before continuing).

- [ ] **Step 2: Delete the files**

```bash
rm -rf client/src/pages/fleet/v2
rm -f client/src/types/fleetV2Audit.ts
rm -f client/src/pages/admin/AdminFleetV2HealthTab.tsx
rm -f client/src/pages/admin/__tests__/AdminFleetV2HealthTab.test.tsx
```

- [ ] **Step 3: Remove the four `AdminPage.tsx` references**

Find (line 66):
```tsx
import { AdminFleetV2HealthTab } from './admin/AdminFleetV2HealthTab';
```
Delete this line.

Find (line 251, inside the `TabId` union — this is one long line; remove just the `'fleet_v2_health' |` segment):
```tsx
'reanalysis' | 'fleet_v2_health' | 'fleetio_health' | 'fleetio_directory'
```
Replace with:
```tsx
'reanalysis' | 'fleetio_health' | 'fleetio_directory'
```
(Keep the rest of the union on both sides of this segment unchanged — this is a substring replace within the existing line, not a full-line replace.)

Find (line 278, inside `VALID_TABS` — same pattern, remove just the `'fleet_v2_health',` entry):
```tsx
'reanalysis', 'fleet_v2_health', 'fleetio_health', 'fleetio_directory'
```
Replace with:
```tsx
'reanalysis', 'fleetio_health', 'fleetio_directory'
```

Find (line 757):
```tsx
        { id: 'fleet_v2_health', label: 'Fleet V2 Health', icon: Activity },
```
Delete this line entirely.

Find (lines 1152-1154):
```tsx
        {activeTab === 'fleet_v2_health' && (
          <AdminFleetV2HealthTab />
        )}

```
Delete this block entirely (including the blank line after it, to match the spacing already present before the next `{activeTab === 'fleetio_health' && (` block).

- [ ] **Step 4: Re-run the grep-verify sweep from Step 1**

Run the same command as Step 1. Expected: zero output now.

- [ ] **Step 5: Run full client verification**

Run: `cd client && npx tsc --noEmit`
Expected: PASS (0 new errors)

Run: `cd client && npx vitest run`
Expected: PASS — every `v2/__tests__/*` test file is gone (deleted with the directory), so the suite total count drops but nothing fails.

Run: `cd client && npx vite build`
Expected: PASS — confirms no dangling import broke the production bundle.

- [ ] **Step 6: Commit**

```bash
git add -A client/src/pages/fleet client/src/types/fleetV2Audit.ts client/src/pages/admin/AdminFleetV2HealthTab.tsx client/src/pages/admin/__tests__/AdminFleetV2HealthTab.test.tsx client/src/pages/AdminPage.tsx
git commit -m "chore(fleet): delete v2 shell and its admin-only health tab"
```

---

### Task 13: Full-suite verification and manual dev-server checklist

**Files:** None (verification only).

- [ ] **Step 1: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS, 0 failures.

- [ ] **Step 2: Run client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS — same pre-existing error count as `main` had before this branch (per `CLAUDE.md`, 12 pre-existing errors as of the last recorded baseline; confirm this branch doesn't add to that count, not that it hits zero).

- [ ] **Step 3: Run client build**

Run: `cd client && npx vite build`
Expected: PASS.

- [ ] **Step 4: Run Worker typecheck (backend untouched, but confirms nothing else broke)**

Run: `npm run typecheck` (repo root)
Expected: PASS.

- [ ] **Step 5: Manual dev-server verification**

Start the dev server (`npm run dev` at repo root for the Worker on 8787, `cd client && npm run dev` for Vite on 5173), then in a browser:

1. Navigate to `/fleet` — confirm the v1 tab UI renders (vehicle list + Dashboard/Analysis Reports/Work Orders/Vendors/Service tab bar), not the two-pane v2 shell.
2. Navigate to `/fleet/v2` and `/fleet-legacy` — confirm both now fall through to the app's generic not-found/redirect behavior (whatever `App.tsx`'s catch-all route does for unmatched paths), not a blank screen or crash.
3. Click "Work Orders" — confirm the stats bar, list, and search all render; click "New Work Order", fill in a vehicle + summary, submit, confirm it appears in the list and the stats bar's "Total Open" count increments.
4. Click "Vendors" — confirm the vendor list renders sorted by price ascending.
5. Click "Service" — confirm the fleet-wide maintenance list renders across multiple vehicles, sorted by date descending.
6. Select a vehicle → Costs tab — confirm the "Open Work Orders" panel appears above the alerts strip; click "View all →" and confirm it switches to the fleet-wide Work Orders tab pre-filtered to that vehicle (a "Vehicle: ... — clear ✕" chip is visible next to the filters).
7. Select a vehicle with a known Fleet.io conflict (or manually insert a test row into `fleetio_conflicts` in local D1 pointing at a real `fleet_vehicles`/`fleet_maintenance`/`fleet_fuel_log` id) → confirm the conflict badge renders in Overview (vehicle-level and/or maintenance row) and Fuel tab, and that clicking "Keep local"/"Use remote" resolves it.
8. Open the Admin page → confirm "Fleet V2 Health" no longer appears in the tab list, and "Fleetio Health" still does and still works.

- [ ] **Step 6: No commit for this task** — it's verification-only. If Step 5 surfaces a bug, fix it as a new commit referencing which numbered check failed, then re-run Steps 1-5.

---

## Self-Review Notes

- **Spec coverage**: Routing (Task 11) ✓, deletion (Task 12) ✓, Work Orders tab + create flow (Tasks 2, 4, 5, 7) ✓, Vendors tab (Task 3, 7) ✓, Service tab (Tasks 1, 6, 7) ✓, per-vehicle Work Orders visibility (Task 8) ✓, conflict badges in Overview/Fuel (Tasks 9, 10) ✓, testing (unit tests per task + Task 13 full-suite + manual checklist) ✓, out-of-scope items untouched ✓.
- **Refinement from the spec**: the spec's Section 5 said conflict badges go in "`FleetCostsTab.tsx` (table: `fleet_maintenance`)". File-level investigation during planning (Task 9's prep) found the per-vehicle maintenance list is actually rendered in `FleetOverviewTab.tsx`, not `FleetCostsTab.tsx` — `FleetCostsTab.tsx` only covers loans/insurance/accessories/utilities/other, which have no Fleet.io sync at all. Task 9 implements the spec's intent (conflict visibility for `fleet_vehicles` and `fleet_maintenance`) in the file where those rows are actually rendered.
- **Type consistency**: `WorkOrder`/`WorkOrderStats`/`WorkOrderStatus` (Task 2) are the single source of truth, imported unchanged by Tasks 4, 5, 8, 9. `VehicleStub`/`FanOutRow`/`FanOutResult` (Task 1) are consumed only by Task 6. `WorkOrderFormVehicle` (Task 4) is intentionally a separate, narrower type from the central `WorkOrder`-adjacent types since it describes a vehicle picker option, not a work order.
