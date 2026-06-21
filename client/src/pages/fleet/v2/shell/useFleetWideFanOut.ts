import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../hooks/useApi';

interface VehicleStub { id: number; vehicle_name?: string | null; vehicle_number?: string | null; }

export interface FanOutRow<T> {
  vehicle: VehicleStub;
  row: T;
}

export interface FanOutResult<T> {
  rows: FanOutRow<T>[];
  loading: boolean;
  loadedVehicles: number;
  totalVehicles: number;
}

/** Fleet-wide aggregation across per-vehicle endpoints.
 *
 *  Fetches `/api/fleet` to learn the vehicles, then in parallel fetches
 *  `pathFor(vehicleId)` for each. Flattens results into a single list, each
 *  row tagged with its source vehicle. Acceptable for ≤50 vehicles; beyond
 *  that an aggregate backend endpoint should replace this.
 *
 *  `extract` lets callers pull an array out of a wrapped response
 *  (some endpoints return `[]`, others `{ results: [] }`). */
export function useFleetWideFanOut<T>(
  pathFor: (vehicleId: number) => string,
  extract?: (resp: unknown) => T[],
): FanOutResult<T> {
  const [vehicles, setVehicles] = useState<VehicleStub[]>([]);
  const [rows, setRows] = useState<FanOutRow<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedVehicles, setLoadedVehicles] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // /api/fleet returns { data, pagination } — unwrap.
    apiFetch<VehicleStub[] | { data: VehicleStub[] }>('/fleet?limit=500')
      .then((vlist) => {
        if (cancelled) return;
        const list = Array.isArray(vlist)
          ? vlist
          : (vlist && Array.isArray((vlist as { data?: VehicleStub[] }).data))
            ? (vlist as { data: VehicleStub[] }).data
            : [];
        setVehicles(list);
        if (list.length === 0) { setLoading(false); return; }
        Promise.allSettled(list.map((v) => apiFetch<unknown>(pathFor(v.id))))
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
  }, [pathFor, extract]);

  return { rows, loading, loadedVehicles, totalVehicles: vehicles.length };
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
