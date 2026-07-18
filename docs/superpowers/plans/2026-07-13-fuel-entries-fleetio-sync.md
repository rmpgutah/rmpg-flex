# Fuel Entries v2 CRUD + Fleet.io Two-Way Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Fleet Manager v2's Fuel Entries feature full create/edit/delete in its own UI, pull Fleet.io's existing fuel-entry history into RMPG, and let users resolve fuel sync conflicts directly from the compact conflict badge.

**Architecture:** A new `FuelEntryModal` component (client) wired into both fuel screens exercises the backend's already-existing `POST/PUT/DELETE /fleet/.../fuel` endpoints (which already push to Fleet.io). A new `listFuelEntries` Fleet.io API client function plus a fuel-entry phase appended to the existing `POST /fleetio/pull` admin endpoint pulls Fleet.io's fuel history in, reusing the existing generic `fleetio_links` table. `FleetioConflictBadge`'s compact mode switches from a read-only hover tooltip to a click-triggered interactive popover with the same resolve buttons the non-compact mode already has.

**Tech Stack:** React 18 + TypeScript (client), Hono on Cloudflare Workers (`/src`), Vitest for both.

**Spec:** `docs/superpowers/specs/2026-07-13-fuel-entries-fleetio-sync-design.md`

---

### Task 1: Expose `refetch` and `vehicles` from `useFleetWideFanOut`

**Why:** `FuelEntriesRoute.tsx` (Task 4) needs to refresh its fleet-wide fuel list after a create/edit/delete, and needs the vehicle list for a "pick a vehicle" dropdown when creating a fuel entry (since the fleet-wide view isn't scoped to one vehicle). The hook already fetches the vehicle list internally but doesn't expose it or a refetch trigger — both are small, generically useful additions.

**Files:**
- Modify: `client/src/pages/fleet/v2/shell/useFleetWideFanOut.ts`
- Test: `client/src/pages/fleet/v2/shell/__tests__/useFleetWideFanOut.test.ts` (new file — no existing test for this hook)

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/fleet/v2/shell/__tests__/useFleetWideFanOut.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useFleetWideFanOut } from '../useFleetWideFanOut';

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResp(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('useFleetWideFanOut', () => {
  it('exposes the fetched vehicle list', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/fleet?limit=500')) {
        return Promise.resolve(jsonResp({ data: [{ id: 1, vehicle_number: 'PS-1', vehicle_name: null }] }));
      }
      return Promise.resolve(jsonResp([]));
    });
    const { result } = renderHook(() => useFleetWideFanOut<{ id: number }>((id) => `/fleet/${id}/fuel`));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.vehicles).toEqual([{ id: 1, vehicle_number: 'PS-1', vehicle_name: null }]);
  });

  it('refetch() re-runs the fan-out fetch', async () => {
    let callCount = 0;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/fleet?limit=500')) {
        return Promise.resolve(jsonResp({ data: [{ id: 1, vehicle_number: 'PS-1', vehicle_name: null }] }));
      }
      callCount += 1;
      return Promise.resolve(jsonResp([{ id: callCount }]));
    });
    const { result } = renderHook(() => useFleetWideFanOut<{ id: number }>((id) => `/fleet/${id}/fuel`));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([{ vehicle: { id: 1, vehicle_number: 'PS-1', vehicle_name: null }, row: { id: 1 } }]);

    act(() => { result.current.refetch(); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.rows).toEqual([{ vehicle: { id: 1, vehicle_number: 'PS-1', vehicle_name: null }, row: { id: 2 } }]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/fleet/v2/shell/__tests__/useFleetWideFanOut.test.ts`
Expected: FAIL — `result.current.vehicles` and `result.current.refetch` are `undefined` (not yet implemented).

- [ ] **Step 3: Implement `refetch` and `vehicles` in the hook**

Replace the full contents of `client/src/pages/fleet/v2/shell/useFleetWideFanOut.ts` with:

```ts
import { useCallback, useEffect, useState } from 'react';
import { apiFetchV2 } from '../hooks/apiFetchV2';

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
 *  row tagged with its source vehicle. Acceptable for ≤50 vehicles; beyond
 *  that an aggregate backend endpoint should replace this.
 *
 *  `extract` lets callers pull an array out of a wrapped response
 *  (some endpoints return `[]`, others `{ results: [] }`). `refetch()` lets
 *  callers re-run the whole fan-out after a mutation (e.g. creating a row
 *  via a modal) without a full page reload. `vehicles` is exposed so
 *  callers needing a "pick a vehicle" dropdown (e.g. a fleet-wide create
 *  form) don't need a second `/fleet?limit=500` fetch. */
export function useFleetWideFanOut<T>(
  pathFor: (vehicleId: number) => string,
  extract?: (resp: unknown) => T[],
): FanOutResult<T> {
  const [vehicles, setVehicles] = useState<VehicleStub[]>([]);
  const [rows, setRows] = useState<FanOutRow<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedVehicles, setLoadedVehicles] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // /api/fleet returns { data, pagination } — unwrap.
    apiFetchV2<VehicleStub[] | { data: VehicleStub[] }>('/fleet?limit=500')
      .then((vlist) => {
        if (cancelled) return;
        const list = Array.isArray(vlist)
          ? vlist
          : (vlist && Array.isArray((vlist as { data?: VehicleStub[] }).data))
            ? (vlist as { data: VehicleStub[] }).data
            : [];
        setVehicles(list);
        if (list.length === 0) { setLoading(false); return; }
        Promise.allSettled(list.map((v) => apiFetchV2<unknown>(pathFor(v.id))))
          .then((results) => {
            if (cancelled) return;
            const flat: FanOutRow<T>[] = [];
            for (let i = 0; i < list.length; i++) {
              const r = results[i];
              if (r.status !== 'fulfilled') continue;
              const arr = extract ? extract(r.value) : asArray<T>(r.value);
              for (const row of arr) flat.push({ vehicle: list[i], row });
            }
            setRows(flat);
            setLoadedVehicles(list.length);
            setLoading(false);
          });
      })
      .catch(() => { if (!cancelled) { setLoading(false); } });
    return () => { cancelled = true; };
  }, [pathFor, extract, refreshToken]);

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

Run: `cd client && npx vitest run src/pages/fleet/v2/shell/__tests__/useFleetWideFanOut.test.ts`
Expected: PASS (2/2 tests).

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (the only other consumer of this hook, `FuelEntriesRoute.tsx`, destructures `{ rows, loading, loadedVehicles, totalVehicles }` — the two new fields are additive and don't break existing destructuring).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/fleet/v2/shell/useFleetWideFanOut.ts \
        client/src/pages/fleet/v2/shell/__tests__/useFleetWideFanOut.test.ts
git commit -m "feat(fleet-v2): expose refetch + vehicles from useFleetWideFanOut"
```

---

### Task 2: `FuelEntryModal` component

**Why:** No component currently lets a v2 user create or edit a fuel entry — the backend (`POST /fleet/:id/fuel`, `PUT /fleet/fuel/:id`) already exists and already pushes to Fleet.io on success. This modal is the missing UI piece, shared by both `FuelTab.tsx` (fixed vehicle) and `FuelEntriesRoute.tsx` (needs a vehicle picker since it's fleet-wide).

**Files:**
- Create: `client/src/pages/fleet/v2/vehicleDetail/FuelEntryModal.tsx`
- Test: `client/src/pages/fleet/v2/vehicleDetail/__tests__/FuelEntryModal.test.tsx` (new file)

- [ ] **Step 1: Write the failing tests**

Create `client/src/pages/fleet/v2/vehicleDetail/__tests__/FuelEntryModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FuelEntryModal } from '../FuelEntryModal';

vi.mock('../../hooks/apiFetchV2', () => ({
  apiFetchV2: vi.fn(),
}));
import { apiFetchV2 } from '../../hooks/apiFetchV2';

const mockedApiFetchV2 = vi.mocked(apiFetchV2);

beforeEach(() => {
  mockedApiFetchV2.mockReset();
  mockedApiFetchV2.mockResolvedValue({});
});

describe('FuelEntryModal', () => {
  it('create mode: posts to /fleet/:id/fuel with entered fields', async () => {
    const onSaved = vi.fn();
    render(<FuelEntryModal vehicleId={7} mode="create" onClose={() => {}} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText(/gallons/i), { target: { value: '12.5' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockedApiFetchV2).toHaveBeenCalledWith(
      '/fleet/7/fuel',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(mockedApiFetchV2.mock.calls[0][1]!.body as string);
    expect(body.fuel_date).toBe('2026-07-01');
    expect(body.gallons).toBe(12.5);
    cleanup();
  });

  it('edit mode: pre-fills fields and PUTs to /fleet/fuel/:id', async () => {
    const onSaved = vi.fn();
    render(
      <FuelEntryModal
        vehicleId={7}
        mode="edit"
        entry={{ id: 55, fuel_date: '2026-06-15', gallons: 10, station: 'Shell' }}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByLabelText(/date/i)).toHaveValue('2026-06-15');
    expect(screen.getByLabelText(/station/i)).toHaveValue('Shell');

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockedApiFetchV2).toHaveBeenCalledWith(
      '/fleet/fuel/55',
      expect.objectContaining({ method: 'PUT' }),
    );
    cleanup();
  });

  it('requires a date before saving', () => {
    const onSaved = vi.fn();
    render(<FuelEntryModal vehicleId={7} mode="create" onClose={() => {}} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(screen.getByText(/date is required/i)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    cleanup();
  });

  it('fleet-wide create (vehicleId null): requires a vehicle pick, posts to the chosen vehicle', async () => {
    const onSaved = vi.fn();
    render(
      <FuelEntryModal
        vehicleId={null}
        vehicles={[{ id: 3, vehicle_number: 'PS-3', vehicle_name: null }, { id: 4, vehicle_number: 'PS-4', vehicle_name: null }]}
        mode="create"
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: '2026-07-01' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(screen.getByText(/vehicle is required/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/vehicle/i), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockedApiFetchV2).toHaveBeenCalledWith('/fleet/4/fuel', expect.objectContaining({ method: 'POST' }));
    cleanup();
  });

  it('Esc closes the modal while not saving', () => {
    const onClose = vi.fn();
    render(<FuelEntryModal vehicleId={7} mode="create" onClose={onClose} onSaved={() => {}} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/pages/fleet/v2/vehicleDetail/__tests__/FuelEntryModal.test.tsx`
Expected: FAIL — `../FuelEntryModal` doesn't exist yet.

- [ ] **Step 3: Implement `FuelEntryModal.tsx`**

Create `client/src/pages/fleet/v2/vehicleDetail/FuelEntryModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetchV2 } from '../hooks/apiFetchV2';

/** Structurally compatible with both fuel-row shapes already used across
 *  the two fuel screens (FuelTab.tsx, FuelEntriesRoute.tsx) — every field
 *  here is optional so either existing row type satisfies it without
 *  changes to those files' own row interfaces. */
export interface FuelEntryRow {
  id: number;
  fuel_date?: string | null;
  gallons?: number | null;
  cost_per_gallon?: number | null;
  total_cost?: number | null;
  odometer?: number | null;
  fuel_type?: string | null;
  station?: string | null;
  notes?: string | null;
  is_full_tank?: number | null;
  payment_method?: string | null;
  driver_name?: string | null;
  location?: string | null;
}

// Optional fields (not `string | null` required) so this accepts
// useFleetWideFanOut's `VehicleStub` directly without a type error —
// a type with required fields is assignable to one with optional fields,
// but not the reverse.
interface VehicleOption { id: number; vehicle_number?: string | null; vehicle_name?: string | null; }

interface FuelEntryModalProps {
  /** Fixed vehicle (per-vehicle screens). Pass `null` for a fleet-wide
   *  create flow where the user must pick a vehicle — in that case also
   *  pass `vehicles`. */
  vehicleId: number | null;
  vehicles?: VehicleOption[];
  mode: 'create' | 'edit';
  /** Required when mode is 'edit'. */
  entry?: FuelEntryRow;
  onClose: () => void;
  onSaved: () => void;
}

export function FuelEntryModal({ vehicleId, vehicles, mode, entry, onClose, onSaved }: FuelEntryModalProps) {
  const [pickedVehicleId, setPickedVehicleId] = useState(vehicleId != null ? String(vehicleId) : '');
  const [fuelDate, setFuelDate] = useState(entry?.fuel_date ?? '');
  const [gallons, setGallons] = useState(entry?.gallons != null ? String(entry.gallons) : '');
  const [costPerGallon, setCostPerGallon] = useState(entry?.cost_per_gallon != null ? String(entry.cost_per_gallon) : '');
  const [totalCost, setTotalCost] = useState(entry?.total_cost != null ? String(entry.total_cost) : '');
  const [odometer, setOdometer] = useState(entry?.odometer != null ? String(entry.odometer) : '');
  const [fuelType, setFuelType] = useState(entry?.fuel_type ?? 'regular');
  const [station, setStation] = useState(entry?.station ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [isFullTank, setIsFullTank] = useState(entry?.is_full_tank == null ? true : !!entry.is_full_tank);
  const [paymentMethod, setPaymentMethod] = useState(entry?.payment_method ?? '');
  const [driverName, setDriverName] = useState(entry?.driver_name ?? '');
  const [location, setLocation] = useState(entry?.location ?? '');
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
    if (vehicleId == null && !pickedVehicleId) {
      setErr('Vehicle is required.');
      return;
    }
    if (!fuelDate) {
      setErr('Date is required.');
      return;
    }
    setSaving(true);
    const body = JSON.stringify({
      fuel_date: fuelDate,
      gallons: gallons ? parseFloat(gallons) : null,
      cost_per_gallon: costPerGallon ? parseFloat(costPerGallon) : null,
      total_cost: totalCost ? parseFloat(totalCost) : null,
      odometer_reading: odometer ? parseFloat(odometer) : null,
      fuel_type: fuelType,
      station: station.trim() || null,
      notes: notes.trim() || null,
      is_full_tank: isFullTank,
      payment_method: paymentMethod.trim() || null,
      driver_name: driverName.trim() || null,
      location: location.trim() || null,
    });
    const targetVehicleId = vehicleId ?? parseInt(pickedVehicleId, 10);
    const req = mode === 'create'
      ? apiFetchV2(`/fleet/${targetVehicleId}/fuel`, { method: 'POST', body })
      : apiFetchV2(`/fleet/fuel/${entry!.id}`, { method: 'PUT', body });
    req
      .then(() => { setSaving(false); onSaved(); })
      .catch((e) => {
        setSaving(false);
        setErr(e instanceof Error ? e.message : `Failed to ${mode === 'create' ? 'create' : 'update'} fuel entry`);
      });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fuel-entry-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={saving ? undefined : onClose}
    >
      <div
        className="bg-surface-raised border border-rmpg-700 rounded-sm w-[480px] max-w-full mx-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700">
          <h2 id="fuel-entry-modal-title" className="text-sm font-semibold text-rmpg-100">
            {mode === 'create' ? 'New Fuel Entry' : 'Edit Fuel Entry'}
          </h2>
          <button type="button" onClick={onClose} className="text-rmpg-400 hover:text-rmpg-100 p-1" disabled={saving} aria-label="Close">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>
        <div className="p-4 space-y-3">
          {err ? <div className="px-3 py-2 rounded-sm border border-red-500/40 text-red-300 text-xs">{err}</div> : null}
          {vehicleId == null ? (
            <Field label="Vehicle *">
              <select
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={pickedVehicleId}
                onChange={(e) => setPickedVehicleId(e.target.value)}
                aria-required
                aria-label="Vehicle"
              >
                <option value="">— select vehicle —</option>
                {(vehicles ?? []).map((v) => (
                  <option key={v.id} value={v.id}>{v.vehicle_number ?? v.vehicle_name ?? `Vehicle ${v.id}`}</option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Date *">
            <input
              type="date"
              aria-label="Date"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
              value={fuelDate}
              onChange={(e) => setFuelDate(e.target.value)}
              aria-required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Gallons">
              <input
                type="number" inputMode="decimal" step="0.001" aria-label="Gallons"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
                value={gallons} onChange={(e) => setGallons(e.target.value)}
              />
            </Field>
            <Field label="Cost/gal ($)">
              <input
                type="number" inputMode="decimal" step="0.001" aria-label="Cost per gallon"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
                value={costPerGallon} onChange={(e) => setCostPerGallon(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total cost ($)">
              <input
                type="number" inputMode="decimal" step="0.01" aria-label="Total cost"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
                value={totalCost} onChange={(e) => setTotalCost(e.target.value)}
              />
            </Field>
            <Field label="Odometer">
              <input
                type="number" inputMode="decimal" step="0.1" aria-label="Odometer"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
                value={odometer} onChange={(e) => setOdometer(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fuel type">
              <select
                aria-label="Fuel type"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={fuelType} onChange={(e) => setFuelType(e.target.value)}
              >
                <option value="regular">Regular</option>
                <option value="premium">Premium</option>
                <option value="diesel">Diesel</option>
              </select>
            </Field>
            <Field label="Station">
              <input
                type="text" aria-label="Station"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={station} onChange={(e) => setStation(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Fill type">
            <label className="flex items-center gap-2 px-2 py-1 text-[12px] text-rmpg-100">
              <input type="checkbox" className="accent-brand-400" checked={isFullTank} onChange={(e) => setIsFullTank(e.target.checked)} />
              {isFullTank ? 'Full tank (counts toward MPG)' : 'Partial fill (excluded from MPG)'}
            </label>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment method">
              <input
                type="text" aria-label="Payment method" placeholder="e.g. Fuel Card"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}
              />
            </Field>
            <Field label="Driver">
              <input
                type="text" aria-label="Driver"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={driverName} onChange={(e) => setDriverName(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Location">
            <input
              type="text" aria-label="Location"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
              value={location} onChange={(e) => setLocation(e.target.value)}
            />
          </Field>
          <Field label="Notes">
            <textarea
              aria-label="Notes"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 h-16 resize-none"
              value={notes} onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
        <footer className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button type="button" onClick={onClose} disabled={saving} className="px-2 py-1 text-[11px] border border-rmpg-700 rounded-sm hover:bg-rmpg-800 text-rmpg-100">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110 disabled:opacity-50">
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-rmpg-400 uppercase tracking-wide mb-0.5">{label}</div>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/pages/fleet/v2/vehicleDetail/__tests__/FuelEntryModal.test.tsx`
Expected: PASS (5/5 tests).

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/fleet/v2/vehicleDetail/FuelEntryModal.tsx \
        client/src/pages/fleet/v2/vehicleDetail/__tests__/FuelEntryModal.test.tsx
git commit -m "feat(fleet-v2): add FuelEntryModal for create/edit"
```

---

### Task 3: Wire `FuelEntryModal` into `FuelTab.tsx` (per-vehicle)

**Why:** This is the primary home for fuel entry mutation — the vehicle context is already fixed, so "New Fuel Entry" naturally posts to `/fleet/:vehicleId/fuel` with no picker needed.

**Files:**
- Modify: `client/src/pages/fleet/v2/vehicleDetail/FuelTab.tsx`
- Test: `client/src/pages/fleet/v2/vehicleDetail/__tests__/FuelTab.test.tsx` (find existing file first — if one exists, extend it; if not, create it)

- [ ] **Step 1: Check for an existing test file**

Run: `ls client/src/pages/fleet/v2/vehicleDetail/__tests__/ | grep -i FuelTab`

If a file exists, read it fully before writing new tests so you match its existing mocking conventions (likely `vi.mock('../../hooks/apiFetchV2', ...)`) rather than duplicating a different pattern. If none exists, create `client/src/pages/fleet/v2/vehicleDetail/__tests__/FuelTab.test.tsx` from scratch using the pattern below.

- [ ] **Step 2: Write the failing tests**

Add (or create the file with) these cases, mocking `apiFetchV2`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FuelTab } from '../FuelTab';

vi.mock('../../hooks/apiFetchV2', () => ({ apiFetchV2: vi.fn() }));
import { apiFetchV2 } from '../../hooks/apiFetchV2';
const mocked = vi.mocked(apiFetchV2);

const ROW = { id: 1, fuel_date: '2026-07-01', gallons: 10, cost_per_gallon: 3.5, total_cost: 35, odometer: 1000, mpg: null, station: 'Shell', fuel_type: 'regular' };

beforeEach(() => {
  mocked.mockReset();
  mocked.mockImplementation((path: string) => {
    if (path.includes('/fuel') && !path.includes('conflicts')) return Promise.resolve([ROW]);
    if (path.includes('conflicts')) return Promise.resolve({ conflicts: [] });
    return Promise.resolve({});
  });
});

describe('FuelTab CRUD', () => {
  it('shows a "New Fuel Entry" button that opens the create modal', async () => {
    render(<FuelTab vehicleId={7} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /new fuel entry/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /new fuel entry/i }));
    expect(screen.getByText(/new fuel entry/i, { selector: 'h2' })).toBeInTheDocument();
    cleanup();
  });

  it('edit icon opens the modal pre-filled with the row', async () => {
    render(<FuelTab vehicleId={7} />);
    await waitFor(() => expect(screen.getByLabelText(/edit fuel entry 1/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/edit fuel entry 1/i));
    expect(screen.getByLabelText(/^date$/i)).toHaveValue('2026-07-01');
    cleanup();
  });

  it('delete icon confirms then calls DELETE and refetches', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<FuelTab vehicleId={7} />);
    await waitFor(() => expect(screen.getByLabelText(/delete fuel entry 1/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/delete fuel entry 1/i));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('/fleet/fuel/1', expect.objectContaining({ method: 'DELETE' })));
    cleanup();
    vi.restoreAllMocks();
  });

  it('delete icon does nothing if the user cancels the confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<FuelTab vehicleId={7} />);
    await waitFor(() => expect(screen.getByLabelText(/delete fuel entry 1/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/delete fuel entry 1/i));
    expect(mocked).not.toHaveBeenCalledWith('/fleet/fuel/1', expect.objectContaining({ method: 'DELETE' }));
    cleanup();
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd client && npx vitest run src/pages/fleet/v2/vehicleDetail/__tests__/FuelTab.test.tsx`
Expected: FAIL — no "New Fuel Entry" button, no edit/delete icons exist yet.

- [ ] **Step 4: Implement the wiring**

Replace the full contents of `client/src/pages/fleet/v2/vehicleDetail/FuelTab.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { apiFetchV2 } from '../hooks/apiFetchV2';
import FleetioConflictBadge from '../../../../components/FleetioConflictBadge';
import type { ConflictBadgeConflict } from '../../../../components/FleetioConflictBadge';
import { FuelEntryModal, type FuelEntryRow } from './FuelEntryModal';

interface FuelRow {
  id: number;
  fuel_date: string | null;
  gallons: number | null;
  cost_per_gallon: number | null;
  total_cost: number | null;
  odometer: number | null;
  mpg: number | null;
  station: string | null;
  fuel_type: string | null;
  notes?: string | null;
  is_full_tank?: number | null;
  payment_method?: string | null;
  driver_name?: string | null;
  location?: string | null;
}

type ModalState = { mode: 'create' } | { mode: 'edit'; entry: FuelRow } | null;

export function FuelTab({ vehicleId }: { vehicleId: number }) {
  const [rows, setRows] = useState<FuelRow[]>([]);
  const [conflicts, setConflicts] = useState<Map<number, ConflictBadgeConflict[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);

  const fetchConflicts = (ids: number[]) => {
    if (ids.length === 0) return;
    apiFetchV2<{ conflicts: Record<string, unknown>[] }>(
      `/fleetio/conflicts?table=fleet_fuel_log&ids=${ids.join(',')}`,
    )
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
  };

  const fetchRows = useCallback(() => {
    setLoading(true);
    apiFetchV2<FuelRow[] | { results: FuelRow[] }>(`/fleet/${vehicleId}/fuel`)
      .then((r) => {
        const arr = Array.isArray(r) ? r : (r as { results?: FuelRow[] })?.results ?? [];
        setRows(arr);
        fetchConflicts(arr.map((x) => x.id));
      })
      .catch(() => { setRows([]); })
      .finally(() => { setLoading(false); });
  }, [vehicleId]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const handleDelete = (id: number) => {
    if (!window.confirm('Delete this fuel entry? This cannot be undone.')) return;
    apiFetchV2(`/fleet/fuel/${id}`, { method: 'DELETE' })
      .then(() => fetchRows())
      .catch(() => {});
  };

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading fuel history…</div>;

  const avgMpg = computeAvgMpg(rows);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        {avgMpg != null ? (
          <div className="rounded-sm border border-rmpg-700 bg-surface-raised px-3 py-2 text-[11px]">
            <span className="text-rmpg-400">Avg MPG · </span>
            <span className="text-rmpg-100 font-semibold">{avgMpg.toFixed(1)}</span>
          </div>
        ) : <div />}
        <button
          type="button"
          onClick={() => setModal({ mode: 'create' })}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110"
        >
          <Plus className="w-3 h-3" /> New Fuel Entry
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-rmpg-400">No fuel entries for this vehicle yet.</div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-surface-base">
            <tr>
              <th className="text-left px-2 py-1.5 font-semibold">Date</th>
              <th className="text-left px-2 py-1.5 font-semibold">Station</th>
              <th className="text-right px-2 py-1.5 font-semibold">Gallons</th>
              <th className="text-right px-2 py-1.5 font-semibold">$/gal</th>
              <th className="text-right px-2 py-1.5 font-semibold">Total</th>
              <th className="text-right px-2 py-1.5 font-semibold">Odo</th>
              <th className="text-right px-2 py-1.5 font-semibold">MPG</th>
              <th className="text-center px-2 py-1.5 font-semibold">Sync</th>
              <th className="text-center px-2 py-1.5 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rowConflicts = conflicts.get(r.id);
              return (
                <tr key={r.id} className="border-b border-rmpg-700">
                  <td className="px-2 py-0.5 text-rmpg-300">{r.fuel_date ?? '—'}</td>
                  <td className="px-2 py-0.5 text-rmpg-300">{r.station ?? '—'}</td>
                  <td className="px-2 py-0.5 text-right text-rmpg-300">{r.gallons != null ? r.gallons.toFixed(2) : '—'}</td>
                  <td className="px-2 py-0.5 text-right text-rmpg-300">{r.cost_per_gallon != null ? `$${r.cost_per_gallon.toFixed(2)}` : '—'}</td>
                  <td className="px-2 py-0.5 text-right text-rmpg-300">{r.total_cost != null ? `$${r.total_cost.toFixed(2)}` : '—'}</td>
                  <td className="px-2 py-0.5 text-right text-rmpg-300">{r.odometer != null ? r.odometer.toLocaleString() : '—'}</td>
                  <td className="px-2 py-0.5 text-right text-rmpg-100">{r.mpg != null ? r.mpg.toFixed(1) : '—'}</td>
                  <td className="px-2 py-0.5 text-center">
                    {rowConflicts?.length ? (
                      <div className="inline-flex gap-0.5">
                        {rowConflicts.map((c) => (
                          <FleetioConflictBadge key={c.id} conflict={c} compact onResolved={fetchRows} />
                        ))}
                      </div>
                    ) : (
                      <span className="text-rmpg-500">—</span>
                    )}
                  </td>
                  <td className="px-2 py-0.5 text-center">
                    <div className="inline-flex gap-1">
                      <button
                        type="button"
                        onClick={() => setModal({ mode: 'edit', entry: r })}
                        className="text-rmpg-400 hover:text-rmpg-100 p-0.5"
                        aria-label={`Edit fuel entry ${r.id}`}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(r.id)}
                        className="text-rmpg-400 hover:text-red-400 p-0.5"
                        aria-label={`Delete fuel entry ${r.id}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {modal ? (
        <FuelEntryModal
          vehicleId={vehicleId}
          mode={modal.mode}
          entry={modal.mode === 'edit' ? (modal.entry as FuelEntryRow) : undefined}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); fetchRows(); }}
        />
      ) : null}
    </div>
  );
}

function computeAvgMpg(rows: FuelRow[]): number | null {
  const valid = rows.map((r) => r.mpg).filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx vitest run src/pages/fleet/v2/vehicleDetail/__tests__/FuelTab.test.tsx`
Expected: PASS (all cases, both the ones you wrote and any pre-existing ones in the file).

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/fleet/v2/vehicleDetail/FuelTab.tsx \
        client/src/pages/fleet/v2/vehicleDetail/__tests__/FuelTab.test.tsx
git commit -m "feat(fleet-v2): wire FuelEntryModal create/edit/delete into FuelTab"
```

---

### Task 4: Wire `FuelEntryModal` into `FuelEntriesRoute.tsx` (fleet-wide)

**Why:** The fleet-wide list currently punts "New Fuel Entry" to the legacy app entirely. This closes that gap using the vehicle-picker mode of `FuelEntryModal` from Task 2, and `refetch()`/`vehicles` exposed from the hook in Task 1.

**Files:**
- Modify: `client/src/pages/fleet/v2/routes/FuelEntriesRoute.tsx`
- Test: find existing file first (`client/src/pages/fleet/v2/__tests__/FuelEntriesRoute.test.tsx` per the earlier audit — extend it) or create one

- [ ] **Step 1: Check for an existing test file and read it**

Run: `cat client/src/pages/fleet/v2/__tests__/FuelEntriesRoute.test.tsx`

Read it fully to match its existing mocking conventions before adding new test cases.

- [ ] **Step 2: Write the failing tests**

Add these cases to that file (adjust the mock setup to match whatever convention the existing file already uses for `apiFetchV2`/`useFleetV2Audit`):

```tsx
it('shows a "New Fuel Entry" button that opens a vehicle-picker create modal', async () => {
  // ... render FuelEntriesRoute with the file's existing mock setup providing
  // at least one vehicle + one fuel row ...
  await waitFor(() => expect(screen.getByRole('button', { name: /new fuel entry/i })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /new fuel entry/i }));
  expect(screen.getByLabelText(/^vehicle$/i)).toBeInTheDocument();
});

it('edit icon opens the modal pre-filled with that row, PUTs on save', async () => {
  // ... using the file's existing fixture data ...
  await waitFor(() => expect(screen.getAllByLabelText(/edit fuel entry/i)[0]).toBeInTheDocument());
  fireEvent.click(screen.getAllByLabelText(/edit fuel entry/i)[0]);
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  await waitFor(() => expect(mockedApiFetchV2).toHaveBeenCalledWith(expect.stringMatching(/^\/fleet\/fuel\/\d+$/), expect.objectContaining({ method: 'PUT' })));
});

it('delete icon confirms then calls DELETE', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  // ... using the file's existing fixture data ...
  await waitFor(() => expect(screen.getAllByLabelText(/delete fuel entry/i)[0]).toBeInTheDocument());
  fireEvent.click(screen.getAllByLabelText(/delete fuel entry/i)[0]);
  await waitFor(() => expect(mockedApiFetchV2).toHaveBeenCalledWith(expect.stringMatching(/^\/fleet\/fuel\/\d+$/), expect.objectContaining({ method: 'DELETE' })));
  vi.restoreAllMocks();
});
```

Adapt the exact mock-call assertions to whatever the existing file's `apiFetchV2` mock variable is actually named — read Step 1's output before writing these.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd client && npx vitest run client/src/pages/fleet/v2/__tests__/FuelEntriesRoute.test.tsx`
Expected: FAIL — no button/icons exist yet.

- [ ] **Step 4: Implement the wiring**

Replace the full contents of `client/src/pages/fleet/v2/routes/FuelEntriesRoute.tsx` with:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { FleetListShell } from '../shell/FleetListShell';
import { useFleetV2View } from '../hooks/useFleetV2Audit';
import { useFleetWideFanOut, vehicleLabel } from '../shell/useFleetWideFanOut';
import { safeDateStr } from '../../../../utils/dateUtils';
import { apiFetchV2 } from '../hooks/apiFetchV2';
import FleetioConflictBadge from '../../../../components/FleetioConflictBadge';
import type { ConflictBadgeConflict } from '../../../../components/FleetioConflictBadge';
import { FuelEntryModal, type FuelEntryRow } from '../vehicleDetail/FuelEntryModal';

interface FuelRow {
  id: number;
  fuel_date?: string | null;
  gallons?: number | null;
  cost_per_gallon?: number | null;
  total_cost?: number | null;
  odometer?: number | null;
  mpg?: number | null;
  station?: string | null;
}

type ModalState = { mode: 'create' } | { mode: 'edit'; entry: FuelRow; vehicleId: number } | null;

export function FuelEntriesRoute() {
  useFleetV2View('/fleet/v2/fuel');
  const pathFor = useMemo(() => (id: number) => `/fleet/${id}/fuel`, []);
  const { rows, loading, loadedVehicles, totalVehicles, vehicles, refetch } = useFleetWideFanOut<FuelRow>(pathFor);
  const [search, setSearch] = useState('');
  const [conflicts, setConflicts] = useState<Map<number, ConflictBadgeConflict[]>>(new Map());
  const [modal, setModal] = useState<ModalState>(null);
  const fetchedIds = useRef<string>('');

  useEffect(() => {
    const ids = rows.map((r) => r.row.id);
    const key = ids.join(',');
    if (!ids.length || key === fetchedIds.current) return;
    fetchedIds.current = key;
    apiFetchV2<{ conflicts: Record<string, unknown>[] }>(
      `/fleetio/conflicts?table=fleet_fuel_log&ids=${ids.join(',')}`,
    )
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

  const handleDelete = (id: number) => {
    if (!window.confirm('Delete this fuel entry? This cannot be undone.')) return;
    apiFetchV2(`/fleet/fuel/${id}`, { method: 'DELETE' })
      .then(() => refetch())
      .catch(() => {});
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...rows].sort((a, b) =>
      (b.row.fuel_date ?? '').localeCompare(a.row.fuel_date ?? '')
    );
    if (!q) return sorted;
    return sorted.filter((entry) =>
      [
        vehicleLabel(entry.vehicle),
        entry.row.station,
        entry.row.fuel_date,
      ].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <FleetListShell
      title="Fuel Entries"
      searchPlaceholder="Search by vehicle, station, or date…"
      onSearchChange={setSearch}
      actions={
        <button
          type="button"
          onClick={() => setModal({ mode: 'create' })}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110"
        >
          <Plus className="w-3 h-3" /> New Fuel Entry
        </button>
      }
    >
      {loading ? (
        <div className="p-4 text-sm text-rmpg-400">
          Loading fuel entries · {loadedVehicles}/{totalVehicles} vehicles…
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-4 text-sm text-rmpg-400">
          {rows.length === 0 ? 'No fuel entries in the fleet yet.' : 'No entries match the search.'}
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-surface-base sticky top-0">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold">Date</th>
              <th className="text-left px-3 py-1.5 font-semibold">Vehicle</th>
              <th className="text-left px-3 py-1.5 font-semibold">Station</th>
              <th className="text-right px-3 py-1.5 font-semibold">Gallons</th>
              <th className="text-right px-3 py-1.5 font-semibold">$/gal</th>
              <th className="text-right px-3 py-1.5 font-semibold">Total</th>
              <th className="text-right px-3 py-1.5 font-semibold">MPG</th>
              <th className="text-center px-3 py-1.5 font-semibold">Sync</th>
              <th className="text-center px-3 py-1.5 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ vehicle, row }) => {
              const rowConflicts = conflicts.get(row.id);
              return (
                <tr key={`${vehicle.id}-${row.id}`} className="border-b border-rmpg-700 hover:bg-rmpg-800">
                  <td className="px-3 py-0.5 text-rmpg-300">{safeDateStr(row.fuel_date)}</td>
                  <td className="px-3 py-0.5">
                    <Link to={`/fleet/v2/vehicles/${vehicle.id}`} className="text-rmpg-100 hover:text-brand-400">
                      {vehicleLabel(vehicle)}
                    </Link>
                  </td>
                  <td className="px-3 py-0.5 text-rmpg-300">{row.station ?? '—'}</td>
                  <td className="px-3 py-0.5 text-right text-rmpg-300">{row.gallons != null ? row.gallons.toFixed(2) : '—'}</td>
                  <td className="px-3 py-0.5 text-right text-rmpg-300">{row.cost_per_gallon != null ? `$${row.cost_per_gallon.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-0.5 text-right text-rmpg-300">{row.total_cost != null ? `$${row.total_cost.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-0.5 text-right text-rmpg-100">{row.mpg != null ? row.mpg.toFixed(1) : '—'}</td>
                  <td className="px-3 py-0.5 text-center">
                    {rowConflicts?.length ? (
                      <div className="inline-flex gap-0.5">
                        {rowConflicts.map((c) => (
                          <FleetioConflictBadge key={c.id} conflict={c} compact onResolved={refetch} />
                        ))}
                      </div>
                    ) : (
                      <span className="text-rmpg-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-0.5 text-center">
                    <div className="inline-flex gap-1">
                      <button
                        type="button"
                        onClick={() => setModal({ mode: 'edit', entry: row, vehicleId: vehicle.id })}
                        className="text-rmpg-400 hover:text-rmpg-100 p-0.5"
                        aria-label={`Edit fuel entry ${row.id}`}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(row.id)}
                        className="text-rmpg-400 hover:text-red-400 p-0.5"
                        aria-label={`Delete fuel entry ${row.id}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {modal ? (
        <FuelEntryModal
          vehicleId={modal.mode === 'edit' ? modal.vehicleId : null}
          vehicles={vehicles}
          mode={modal.mode}
          entry={modal.mode === 'edit' ? (modal.entry as FuelEntryRow) : undefined}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refetch(); }}
        />
      ) : null}
    </FleetListShell>
  );
}
```

Note: `pathFor` changed from `useCallback` to `useMemo` returning a stable function reference — functionally equivalent for this use (both produce a referentially-stable callback given empty deps), but `useMemo` reads slightly clearer here since we're not memoizing a callback that closes over changing values. This is a stylistic pick, not a behavior change — keep `useCallback` instead if you prefer consistency with the original; either compiles and passes the same tests.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx vitest run client/src/pages/fleet/v2/__tests__/FuelEntriesRoute.test.tsx`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/fleet/v2/routes/FuelEntriesRoute.tsx \
        client/src/pages/fleet/v2/__tests__/FuelEntriesRoute.test.tsx
git commit -m "feat(fleet-v2): wire FuelEntryModal create/edit/delete into fleet-wide FuelEntriesRoute"
```

---

### Task 5: `listFuelEntries()` in the Fleet.io API client

**Why:** No function exists to fetch Fleet.io's fuel_entries — `client.ts` only has `createFuelEntry`/`updateFuelEntry` (outbound). This is the read side needed for Task 6's inbound pull.

**Files:**
- Modify: `src/utils/fleetio/client.ts`
- Test: `tests/fleetioClient.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/fleetioClient.test.ts`, add this import to the existing import line at the top of the file (find the line starting `import { buildFleetioRequest, ...`) and add `listFuelEntries` to it:

```ts
import { buildFleetioRequest, fleetioFetch, ping, listVehicles, listFuelEntries, createVehicle, archiveVehicle, createWorkOrder, configFromEnv, type FleetioConfig } from '../src/utils/fleetio/client';
```

Then add this test inside the existing `describe('typed resource methods', ...)` block, right after the `listVehicles` test:

```ts
  it('listFuelEntries — passes vehicle_id/page/per_page; returns parsed records', async () => {
    const stub = vi.fn().mockResolvedValue(jsonRespTm({
      records: [{ id: 900, vehicle_id: 501, date: '2026-07-01', liters: null, us_gallons: 12.5, cost: 43.75 }],
      pagination: { current_page: 1, total_pages: 1, total_entries: 1, per_page: 100 },
    }));
    const r = await listFuelEntries({ config: cfg, vehicleId: 501, page: 1, perPage: 100, fetchImpl: stub });
    expect(r.records).toHaveLength(1);
    expect(r.records[0].us_gallons).toBe(12.5);
    expect(stub.mock.calls[0][0]).toBe('https://secure.fleetio.com/api/v1/fuel_entries?vehicle_id=501&page=1&per_page=100');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fleetioClient.test.ts`
Expected: FAIL — `listFuelEntries` is not exported from `client.ts` yet (TypeScript import error / undefined at runtime).

- [ ] **Step 3: Implement `listFuelEntries`**

In `src/utils/fleetio/client.ts`, find the `export interface FleetioFuelEntry { ... }` block (right before `export async function createFuelEntry`) and add this new interface + function immediately after the `FleetioFuelEntry` interface, before `createFuelEntry`:

```ts
export interface ListFuelEntriesInput {
  config: FleetioConfig;
  /** Fleet.io's own vehicle id (not RMPG's) — the caller resolves this via
   *  fleetio_links before calling. */
  vehicleId: number;
  page?: number;
  perPage?: number;
  fetchImpl?: typeof fetch;
}

export async function listFuelEntries(input: ListFuelEntriesInput): Promise<FleetioListResponse<FleetioFuelEntry>> {
  return fleetioFetch<FleetioListResponse<FleetioFuelEntry>>({
    method: 'GET',
    path: '/fuel_entries',
    config: input.config,
    query: { vehicle_id: input.vehicleId, page: input.page ?? 1, per_page: input.perPage ?? 100 },
    fetchImpl: input.fetchImpl,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fleetioClient.test.ts`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/fleetio/client.ts tests/fleetioClient.test.ts
git commit -m "feat(fleetio): add listFuelEntries client function"
```

---

### Task 6: Inbound fuel-entry pull in `POST /fleetio/pull`

**Why:** `/fleetio/pull` only reconciles vehicles today. This extends it with a second phase that pulls each already-linked vehicle's Fleet.io fuel history into `fleet_fuel_log`, using the same generic `fleetio_links` table (no migration needed — its unique indexes are keyed on `(rmpg_table, rmpg_id)` and `(fleetio_resource, fleetio_id)`, both resource-agnostic).

**Files:**
- Modify: `src/utils/fleetio/pull.ts` (add a pure mapping helper)
- Modify: `src/routes/fleetio.ts` (add the fuel-entry phase to the `/pull` handler)
- Test: `tests/fleetioPull.test.ts`

- [ ] **Step 1: Write the failing test for the pure mapping helper**

Add this to `tests/fleetioPull.test.ts` (append after the existing `describe('decideMatchAction', ...)` block, and add `buildFuelLogInsertFromFleetio` to the existing import line at the top: `import { matchLocalVehicle, buildLocalInsertFromFleetio, decideMatchAction, buildFuelLogInsertFromFleetio } from '../src/utils/fleetio/pull';`):

```ts
describe('buildFuelLogInsertFromFleetio', () => {
  it('maps date/gallons/cost and derives cost_per_gallon', () => {
    const row = buildFuelLogInsertFromFleetio({ id: 900, vehicle_id: 501, date: '2026-07-01', liters: null, us_gallons: 12.5, cost: 43.75 });
    expect(row).toEqual({ fuel_date: '2026-07-01', gallons: 12.5, total_cost: 43.75, cost_per_gallon: 3.5 });
  });

  it('nulls out cost_per_gallon when gallons is missing or zero', () => {
    expect(buildFuelLogInsertFromFleetio({ id: 1, vehicle_id: 1, date: '2026-07-01', liters: null, us_gallons: null, cost: 43.75 }).cost_per_gallon).toBeNull();
    expect(buildFuelLogInsertFromFleetio({ id: 1, vehicle_id: 1, date: '2026-07-01', liters: null, us_gallons: 0, cost: 43.75 }).cost_per_gallon).toBeNull();
  });

  it('nulls out cost_per_gallon when cost is missing', () => {
    const row = buildFuelLogInsertFromFleetio({ id: 1, vehicle_id: 1, date: '2026-07-01', liters: null, us_gallons: 12.5, cost: null });
    expect(row.cost_per_gallon).toBeNull();
    expect(row.gallons).toBe(12.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fleetioPull.test.ts`
Expected: FAIL — `buildFuelLogInsertFromFleetio` doesn't exist yet.

- [ ] **Step 3: Implement the pure helper in `pull.ts`**

Append this to the end of `src/utils/fleetio/pull.ts`:

```ts

export interface FleetioFuelEntryForPull {
  id: number;
  vehicle_id: number;
  date: string;
  liters: number | null;
  us_gallons: number | null;
  cost: number | null;
}

export interface LocalFuelLogInsert {
  fuel_date: string;
  gallons: number | null;
  total_cost: number | null;
  cost_per_gallon: number | null;
}

/** Maps a Fleet.io fuel_entries record into an insertable fleet_fuel_log
 *  row. Fleet.io doesn't carry RMPG-only fields (driver_name,
 *  payment_method, location, is_full_tank) — those stay null on a pulled
 *  row until a local edit fills them in. cost_per_gallon is derived (Fleet.io
 *  doesn't expose it directly) when both gallons and cost are present and
 *  gallons is nonzero. */
export function buildFuelLogInsertFromFleetio(entry: FleetioFuelEntryForPull): LocalFuelLogInsert {
  const gallons = entry.us_gallons ?? null;
  const totalCost = entry.cost ?? null;
  const costPerGallon = gallons != null && gallons > 0 && totalCost != null
    ? Math.round((totalCost / gallons) * 1000) / 1000
    : null;
  return {
    fuel_date: entry.date,
    gallons,
    total_cost: totalCost,
    cost_per_gallon: costPerGallon,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fleetioPull.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Wire the fuel-entry phase into the `/pull` route**

In `src/routes/fleetio.ts`:

First, update the import line near the top of the file (currently `import { matchLocalVehicle, buildLocalInsertFromFleetio, decideMatchAction, type LocalVehicleForMatch, type PullOutcome } from '../utils/fleetio/pull';`) to add the new helper:

```ts
import { matchLocalVehicle, buildLocalInsertFromFleetio, decideMatchAction, buildFuelLogInsertFromFleetio, type LocalVehicleForMatch, type PullOutcome } from '../utils/fleetio/pull';
```

Also update the `client` import line (currently `import { configFromEnv, createVehicle, listVehicles, createVendor, createPart, ping } from '../utils/fleetio/client';`) to add `listFuelEntries`:

```ts
import { configFromEnv, createVehicle, listVehicles, listFuelEntries, createVendor, createPart, ping } from '../utils/fleetio/client';
```

Then, in the `fleetio.post('/pull', ...)` handler, find this block (the end of the vehicle-linking `try`/`catch`, right before `const summary = {`):

```ts
  } catch (err) {
    const message = err instanceof FleetioError
      ? `${err.name}: ${err.message}`
      : err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message, outcomes }, 502);
  }

  const summary = {
```

Insert this new fuel-entry phase between the `catch` block's closing `}` and `const summary = {`:

```ts
  } catch (err) {
    const message = err instanceof FleetioError
      ? `${err.name}: ${err.message}`
      : err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message, outcomes }, 502);
  }

  // ── Fuel entries: pull each linked vehicle's Fleet.io fuel history ──
  // Per-vehicle failures don't abort the run — a bad response for one
  // vehicle's fuel_entries shouldn't block importing the rest.
  type FuelPullOutcome =
    | { fleetio_vehicle_id: number; fleetio_fuel_id: number; status: 'fuel_created'; rmpg_id: number }
    | { fleetio_vehicle_id: number; fleetio_fuel_id: number; status: 'fuel_linked_existing' }
    | { fleetio_vehicle_id: number; status: 'fuel_pull_failed'; error: string };
  const fuelOutcomes: FuelPullOutcome[] = [];
  const linkedVehicles = await query<{ rmpg_id: number; fleetio_id: number }>(
    db, `SELECT rmpg_id, fleetio_id FROM fleetio_links WHERE rmpg_table='fleet_vehicles' AND fleetio_resource='vehicles'`,
  );
  const existingFuelLinks = await query<{ fleetio_id: number }>(
    db, `SELECT fleetio_id FROM fleetio_links WHERE rmpg_table='fleet_fuel_log' AND fleetio_resource='fuel_entries'`,
  );
  const alreadyLinkedFuelIds = new Set(existingFuelLinks.map((r) => r.fleetio_id));

  for (const link of linkedVehicles) {
    try {
      let fuelPage = 1;
      let fuelTotalPages = 1;
      do {
        const fuelResp = await listFuelEntries({ config, vehicleId: link.fleetio_id, page: fuelPage, perPage: 100 });
        fuelTotalPages = fuelResp.pagination?.total_pages ?? 1;
        for (const fioFuel of fuelResp.records) {
          if (alreadyLinkedFuelIds.has(fioFuel.id)) {
            fuelOutcomes.push({ fleetio_vehicle_id: link.fleetio_id, fleetio_fuel_id: fioFuel.id, status: 'fuel_linked_existing' });
            continue;
          }
          const insertRow = buildFuelLogInsertFromFleetio(fioFuel);
          const result = await execute(
            db,
            `INSERT INTO fleet_fuel_log (vehicle_id, fuel_date, gallons, total_cost, cost_per_gallon) VALUES (?, ?, ?, ?, ?)`,
            link.rmpg_id, insertRow.fuel_date, insertRow.gallons, insertRow.total_cost, insertRow.cost_per_gallon,
          );
          const newFuelId = Number(result.meta.last_row_id);
          await execute(
            db,
            `INSERT OR IGNORE INTO fleetio_links (rmpg_table, rmpg_id, fleetio_resource, fleetio_id, last_pulled_at)
             VALUES ('fleet_fuel_log', ?, 'fuel_entries', ?, datetime('now'))`,
            newFuelId, fioFuel.id,
          );
          alreadyLinkedFuelIds.add(fioFuel.id);
          fuelOutcomes.push({ fleetio_vehicle_id: link.fleetio_id, fleetio_fuel_id: fioFuel.id, status: 'fuel_created', rmpg_id: newFuelId });
        }
        fuelPage++;
      } while (fuelPage <= fuelTotalPages);
    } catch (err) {
      const message = err instanceof FleetioError ? `${err.name}: ${err.message}` : err instanceof Error ? err.message : String(err);
      fuelOutcomes.push({ fleetio_vehicle_id: link.fleetio_id, status: 'fuel_pull_failed', error: message });
    }
  }

  const fuelSummary = {
    total: fuelOutcomes.length,
    created: fuelOutcomes.filter((o) => o.status === 'fuel_created').length,
    already_linked: fuelOutcomes.filter((o) => o.status === 'fuel_linked_existing').length,
    failed: fuelOutcomes.filter((o) => o.status === 'fuel_pull_failed').length,
  };

  const summary = {
```

Finally, find the route's final return statement (`return c.json({ ok: true, ...summary, outcomes });`) and change it to also include the fuel-entry results:

```ts
  return c.json({ ok: true, ...summary, outcomes, fuel: fuelSummary, fuel_outcomes: fuelOutcomes });
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Run the full Worker test suite**

Run: `npx vitest run`
Expected: all tests pass (no route-level test exists for `/pull` in this codebase — it's tested at the pure-function level only, matching the existing convention in `tests/fleetioPull.test.ts`; confirm no other test broke).

- [ ] **Step 8: Commit**

```bash
git add src/routes/fleetio.ts src/utils/fleetio/pull.ts tests/fleetioPull.test.ts
git commit -m "feat(fleetio): pull each linked vehicle's fuel entries in POST /pull"
```

---

### Task 7: Interactive resolve popover in `FleetioConflictBadge`'s compact mode

**Why:** Resolve buttons (`local_wins`/`remote_wins`) already work in the non-`compact` mode. Compact mode (used by all 6 current call sites, including both fuel screens) shows a read-only hover `Tooltip`, whose portal content has `pointer-events-none` — buttons placed inside it would be unclickable, and hovering into the tooltip content itself would trigger the trigger element's `onMouseLeave` and close it. This task replaces the hover tooltip with a click-triggered, portaled, interactive popover carrying the same resolve buttons — a click-outside handler closes it, matching how other popovers/modals in this codebase behave.

**Files:**
- Modify: `client/src/components/FleetioConflictBadge.tsx`
- Test: `client/src/components/__tests__/FleetioConflictBadge.test.tsx` (new file — none exists yet)

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/__tests__/FleetioConflictBadge.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import FleetioConflictBadge from '../FleetioConflictBadge';

vi.mock('../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

const CONFLICT = { id: 42, field: 'gallons', local_value: '10', remote_value: '12', resolution: null };

beforeEach(() => {
  mockedApiFetch.mockReset();
  mockedApiFetch.mockResolvedValue({ success: true });
});

describe('FleetioConflictBadge compact mode', () => {
  it('clicking the trigger opens a popover with resolve buttons', () => {
    render(<FleetioConflictBadge conflict={CONFLICT} compact />);
    expect(screen.queryByRole('button', { name: /keep local/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /conflict on gallons/i }));
    expect(screen.getByRole('button', { name: /keep local/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use remote/i })).toBeInTheDocument();
    cleanup();
  });

  it('"Keep local" calls resolve with local_wins and shows the resolved state', async () => {
    const onResolved = vi.fn();
    render(<FleetioConflictBadge conflict={CONFLICT} compact onResolved={onResolved} />);
    fireEvent.click(screen.getByRole('button', { name: /conflict on gallons/i }));
    fireEvent.click(screen.getByRole('button', { name: /keep local/i }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/fleetio/conflicts/42/resolve',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ resolution: 'local_wins' }) }),
    );
    expect(screen.getByText(/kept local/i)).toBeInTheDocument();
    cleanup();
  });

  it('shows the resolved state directly when conflict.resolution is already set', () => {
    render(<FleetioConflictBadge conflict={{ ...CONFLICT, resolution: 'remote_wins' }} compact />);
    expect(screen.getByText(/used remote/i)).toBeInTheDocument();
    cleanup();
  });

  it('non-compact mode is unaffected — buttons render inline without a click', () => {
    render(<FleetioConflictBadge conflict={CONFLICT} />);
    expect(screen.getByRole('button', { name: /keep local/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use remote/i })).toBeInTheDocument();
    cleanup();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/components/__tests__/FleetioConflictBadge.test.tsx`
Expected: FAIL — compact mode's trigger currently has no accessible name matching `/conflict on gallons/i` and no click handler that opens resolve buttons.

- [ ] **Step 3: Implement the interactive popover**

Replace the full contents of `client/src/components/FleetioConflictBadge.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

export interface ConflictBadgeConflict {
  id: number;
  field: string;
  local_value?: string | null;
  remote_value?: string | null;
  rmpg_table?: string;
  rmpg_id?: number;
  resolution?: string | null;
  created_at?: string;
}

interface FleetioConflictBadgeProps {
  conflict: ConflictBadgeConflict;
  compact?: boolean;
  onResolved?: () => void;
}

export default function FleetioConflictBadge({ conflict, compact, onResolved }: FleetioConflictBadgeProps) {
  const [resolving, setResolving] = useState(false);
  // Tracks a resolution just applied by this instance so the resolved view
  // shows immediately even if the parent doesn't re-fetch/re-pass an
  // updated `conflict.resolution` prop (onResolved is optional).
  const [localResolution, setLocalResolution] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const effectiveResolution = localResolution ?? conflict.resolution;

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  if (effectiveResolution && effectiveResolution !== 'unresolved') {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
        <CheckCircle2 className="w-2.5 h-2.5" />
        {effectiveResolution === 'local_wins' ? 'Kept local' : effectiveResolution === 'remote_wins' ? 'Used remote' : 'Resolved'}
      </span>
    );
  }

  const resolve = (resolution: 'local_wins' | 'remote_wins') => {
    setResolving(true);
    apiFetch<{ success: boolean }>(`/fleetio/conflicts/${conflict.id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution }),
    })
      .then(() => {
        setResolving(false);
        setLocalResolution(resolution);
        setOpen(false);
        onResolved?.();
      })
      .catch(() => setResolving(false));
  };

  if (compact) {
    const openPopover = () => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setCoords({ x: rect.left, y: rect.bottom + 4 });
      }
      setOpen(true);
    };

    return (
      <>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => (open ? setOpen(false) : openPopover())}
          className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-sm bg-amber-500/10 text-amber-400 border border-amber-500/30"
          aria-expanded={open}
          aria-label={`Conflict on ${conflict.field}`}
        >
          <AlertTriangle className="w-2.5 h-2.5" />
          {conflict.field}
        </button>
        {open && createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[9999] px-2 py-1.5 text-[10px] shadow-lg max-w-xs"
            style={{
              left: coords.x,
              top: coords.y,
              background: 'var(--surface-overlay)',
              color: '#d4a017',
              border: '1px solid var(--border-default)',
              borderLeft: '2px solid #d4a017',
            }}
          >
            <div className="space-y-1">
              <div className="font-semibold text-amber-300">{conflict.field}</div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px]">
                <span className="text-rmpg-400">Local:</span>
                <span className="text-rmpg-100 truncate max-w-[120px]">{conflict.local_value ?? '—'}</span>
                <span className="text-rmpg-400">Remote:</span>
                <span className="text-rmpg-100 truncate max-w-[120px]">{conflict.remote_value ?? '—'}</span>
              </div>
              <div className="flex items-center gap-1 pt-1">
                <button
                  type="button"
                  disabled={resolving}
                  onClick={() => resolve('local_wins')}
                  className="text-[9px] px-1 py-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-50"
                >
                  Keep local
                </button>
                <button
                  type="button"
                  disabled={resolving}
                  onClick={() => resolve('remote_wins')}
                  className="text-[9px] px-1 py-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-50"
                >
                  Use remote
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      </>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-sm bg-amber-500/10 text-amber-300 border border-amber-500/30">
      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
      <span className="font-mono">{conflict.field}</span>
      <span className="text-[9px] text-rmpg-400 mx-1">local: {conflict.local_value ?? '—'}</span>
      <span className="text-[9px] text-rmpg-400 mr-1">vs remote: {conflict.remote_value ?? '—'}</span>
      <button
        type="button"
        disabled={resolving}
        onClick={() => resolve('local_wins')}
        className="text-[9px] px-1 py-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-50"
      >
        Keep local
      </button>
      <button
        type="button"
        disabled={resolving}
        onClick={() => resolve('remote_wins')}
        className="text-[9px] px-1 py-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-50"
      >
        Use remote
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/components/__tests__/FleetioConflictBadge.test.tsx`
Expected: PASS (4/4 tests).

- [ ] **Step 5: Confirm no other consumer broke**

Run: `cd client && npx vitest run` (full client suite)
Expected: all pass — the 6 existing `compact` call sites (`OverviewTab.tsx`, `FuelEntriesRoute.tsx`, `FuelTab.tsx`, `ServiceRoute.tsx`, `ServiceTab.tsx`, `WorkOrdersRoute.tsx`) all pass the same `conflict`/`compact` props as before; the prop contract didn't change, only the internal rendering.

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/FleetioConflictBadge.tsx \
        client/src/components/__tests__/FleetioConflictBadge.test.tsx
git commit -m "feat(fleet-v2): make compact FleetioConflictBadge resolve-able via click popover"
```

---

### Final verification (run once all 7 tasks are committed)

- [ ] **Step 1: Full client test suite**

Run: `cd client && npx vitest run`
Expected: all tests pass, including every new test file added in this plan.

- [ ] **Step 2: Full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Full Worker typecheck + test suite**

Run: `npm run typecheck && npx vitest run`
Expected: no errors, all tests pass.

- [ ] **Step 4: Client build**

Run: `cd client && npx vite build`
Expected: build succeeds with no new warnings from the touched files.

- [ ] **Step 5: Manual verification in the dev server**

Run `npm run dev` (Worker) and `cd client && npm run dev` (client). With `FLEETIO_API_KEY`/`FLEETIO_ACCOUNT_TOKEN` unset (typical dev setup), confirm:
- `/fleet/v2/vehicles/<id>` → Fuel tab: "New Fuel Entry" button opens the modal, creating an entry adds a row (the outbound Fleet.io push will fail silently in the background since Fleet.io isn't configured — that's expected, it doesn't block the UI).
- `/fleet/v2/fuel` (fleet-wide): "New Fuel Entry" opens the modal with a vehicle picker; edit/delete icons work per row.
- If a `fleet_fuel_log` row has an associated `fleetio_conflicts` entry (create one manually via `wrangler d1 execute` if none exist), confirm clicking its compact badge opens the popover and "Keep local"/"Use remote" work.
