import { useEffect, useState } from 'react';
import { apiFetchV2 } from '../hooks/apiFetchV2';
import { apiFetch } from '../../../hooks/useApi';
import FleetioConflictBadge from '../../../components/FleetioConflictBadge';
import type { ConflictBadgeConflict } from '../../../components/FleetioConflictBadge';

interface ServiceRow {
  id: number;
  service_type: string | null;
  service_date: string | null;
  cost: number | null;
  vendor: string | null;
  notes: string | null;
  mileage_at_service: string | number | null;
}

export function ServiceTab({ vehicleId }: { vehicleId: number }) {
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [conflicts, setConflicts] = useState<Map<number, ConflictBadgeConflict[]>>(new Map());
  const [loading, setLoading] = useState(true);

  const fetchConflicts = (ids: number[]) => {
    if (ids.length === 0) return;
    apiFetch<{ conflicts: Record<string, unknown>[] }>(
      `/fleetio/conflicts?table=fleet_maintenance&ids=${ids.join(',')}`,
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

  useEffect(() => {
    let cancelled = false;
    apiFetchV2<ServiceRow[] | { results: ServiceRow[] }>(`/fleet/${vehicleId}/maintenance`)
      .then((r) => {
        if (cancelled) return;
        const arr = Array.isArray(r) ? r : (r as { results?: ServiceRow[] })?.results ?? [];
        setRows(arr);
        fetchConflicts(arr.map((x) => x.id));
      })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading service history…</div>;
  if (rows.length === 0) return <div className="p-4 text-sm text-rmpg-400">No service entries for this vehicle yet.</div>;

  return (
    <div className="p-4">
      <table className="w-full text-[11px]">
        <thead className="bg-surface-base">
          <tr>
            <th className="text-left px-2 py-1.5 font-semibold">Date</th>
            <th className="text-left px-2 py-1.5 font-semibold">Type</th>
            <th className="text-left px-2 py-1.5 font-semibold">Vendor</th>
            <th className="text-right px-2 py-1.5 font-semibold">Mileage</th>
            <th className="text-right px-2 py-1.5 font-semibold">Cost</th>
            <th className="text-center px-2 py-1.5 font-semibold">Sync</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rowConflicts = conflicts.get(r.id);
            return (
              <tr key={r.id} className="border-b border-rmpg-700">
                <td className="px-2 py-0.5 text-rmpg-300">{r.service_date ?? '—'}</td>
                <td className="px-2 py-0.5 text-rmpg-100">{r.service_type ?? '—'}</td>
                <td className="px-2 py-0.5 text-rmpg-300">{r.vendor ?? '—'}</td>
                <td className="px-2 py-0.5 text-right text-rmpg-300">{r.mileage_at_service ?? '—'}</td>
                <td className="px-2 py-0.5 text-right text-rmpg-300">{r.cost != null ? `$${Number(r.cost).toFixed(2)}` : '—'}</td>
                <td className="px-2 py-0.5 text-center">
                  {rowConflicts?.length ? (
                    <div className="inline-flex gap-0.5">
                      {rowConflicts.map((c) => (
                        <FleetioConflictBadge key={c.id} conflict={c} compact />
                      ))}
                    </div>
                  ) : (
                    <span className="text-rmpg-500">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
