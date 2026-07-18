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
  type?: string | null;
  performed_at?: string | null;
  cost?: number | null;
  vendor?: string | null;
  mileage_at_service?: string | number | null;
}

const extract = (resp: unknown): ServiceRow[] => {
  const d = (resp as { data?: ServiceRow[] })?.data;
  return Array.isArray(d) ? d : [];
};

export default function FleetServiceTab() {
  const pathFor = (id: number) => `/fleet/${id}/maintenance`;
  const { rows, loading, loadedVehicles, totalVehicles, error } = useFleetWideFanOut<ServiceRow>(pathFor, extract);
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
    const sorted = [...rows].sort((a, b) => (b.row.performed_at ?? '').localeCompare(a.row.performed_at ?? ''));
    if (!q) return sorted;
    return sorted.filter((entry) =>
      [vehicleLabel(entry.vehicle), entry.row.type, entry.row.vendor].filter(Boolean).join(' ').toLowerCase().includes(q)
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
      {error ? (
        <div className="p-4 text-xs text-red-400">Failed to load service entries: {error}</div>
      ) : loading ? (
        <div className="p-4 text-xs text-rmpg-400">Loading service entries · {loadedVehicles}/{totalVehicles} vehicles…</div>
      ) : filtered.length === 0 ? (
        <div className="p-4 text-xs text-rmpg-400">
          {rows.length === 0 ? 'No service entries in the fleet yet.' : 'No entries match the search.'}
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-surface-base">
            <tr>
              <th className="text-left px-3 py-[3px] text-[9px] font-semibold">Date</th>
              <th className="text-left px-3 py-[3px] text-[9px] font-semibold">Vehicle</th>
              <th className="text-left px-3 py-[3px] text-[9px] font-semibold">Service</th>
              <th className="text-left px-3 py-[3px] text-[9px] font-semibold">Vendor</th>
              <th className="text-right px-3 py-[3px] text-[9px] font-semibold">Mileage</th>
              <th className="text-right px-3 py-[3px] text-[9px] font-semibold">Cost</th>
              <th className="text-center px-3 py-[3px] text-[9px] font-semibold">Sync</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ vehicle, row }) => {
              const rowConflicts = conflicts.get(row.id);
              return (
                <tr key={`${vehicle.id}-${row.id}`} className="border-b border-rmpg-800/40 hover:bg-rmpg-800/40">
                  <td className="px-3 py-[2px] text-[11px] text-rmpg-300">{safeDateStr(row.performed_at)}</td>
                  <td className="px-3 py-[2px] text-[11px] text-rmpg-100">{vehicleLabel(vehicle)}</td>
                  <td className="px-3 py-[2px] text-[11px] text-rmpg-100">{row.type ?? '—'}</td>
                  <td className="px-3 py-[2px] text-[11px] text-rmpg-300">{row.vendor ?? '—'}</td>
                  <td className="px-3 py-[2px] text-[11px] text-right text-rmpg-300">{row.mileage_at_service ?? '—'}</td>
                  <td className="px-3 py-[2px] text-[11px] text-right text-rmpg-300">{row.cost != null ? `$${Number(row.cost).toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-[2px] text-[11px] text-center">
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
