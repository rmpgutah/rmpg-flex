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
  error: string | null;
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
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const pathForRef = useRef(pathFor);
  pathForRef.current = pathFor;
  const extractRef = useRef(extract);
  extractRef.current = extract;
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
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
      .catch((e) => {
        if (!cancelled) {
          hasLoadedRef.current = true;
          setError(e instanceof Error ? e.message : 'Failed to load vehicles');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [refreshToken]);

  const refetch = useCallback(() => setRefreshToken((t) => t + 1), []);

  return { rows, loading, loadedVehicles, totalVehicles: vehicles.length, vehicles, error, refetch };
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
