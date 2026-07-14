import { useCallback, useEffect, useRef, useState } from 'react';
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
 *  form) don't need a second `/fleet?limit=500` fetch.
 *
 *  Note: changing `pathFor` or `extract`'s identity no longer auto-retriggers
 *  the fetch (only `refetch()` and internal `refreshToken` do) — call
 *  `refetch()` after changing inputs that affect the request. */
export function useFleetWideFanOut<T>(
  pathFor: (vehicleId: number) => string,
  extract?: (resp: unknown) => T[],
): FanOutResult<T> {
  const [vehicles, setVehicles] = useState<VehicleStub[]>([]);
  const [rows, setRows] = useState<FanOutRow<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedVehicles, setLoadedVehicles] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  // Keep the latest callbacks in refs rather than the effect's dependency
  // array. Callers frequently pass inline arrow functions (a fresh identity
  // every render); including them as deps would re-trigger the fan-out on
  // every render this hook itself causes (setVehicles/setRows) — an
  // infinite fetch loop. Refs let the effect only re-run on an intentional
  // refetch() while always calling the current closure.
  const pathForRef = useRef(pathFor);
  pathForRef.current = pathFor;
  const extractRef = useRef(extract);
  extractRef.current = extract;
  // Tracks whether the fan-out has completed its first fetch. `loading`
  // should only reflect the initial mount fetch — a later refetch() (e.g.
  // after a create/edit/delete mutation) must not blank the whole panel
  // back to a loading state, matching FuelTab.tsx's initialLoading behavior.
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (!hasLoadedRef.current) setLoading(true);
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
        if (list.length === 0) {
          hasLoadedRef.current = true;
          setLoading(false);
          return;
        }
        Promise.allSettled(list.map((v) => apiFetchV2<unknown>(pathForRef.current(v.id))))
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
