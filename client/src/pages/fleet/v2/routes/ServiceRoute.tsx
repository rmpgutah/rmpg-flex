import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FleetListShell } from '../shell/FleetListShell';
import { LegacyActionLink } from '../shell/LegacyActionLink';
import { useFleetV2View } from '../hooks/useFleetV2Audit';
import { useFleetWideFanOut, vehicleLabel } from '../shell/useFleetWideFanOut';
import { safeDateStr } from '../../../../utils/dateUtils';
import { apiFetch } from '../../../../hooks/useApi';
import FleetioConflictBadge from '../../../../components/FleetioConflictBadge';
import type { ConflictBadgeConflict } from '../../../../components/FleetioConflictBadge';

interface ServiceRow {
  id: number;
  service_type?: string | null;
  service_date?: string | null;
  cost?: number | null;
  vendor?: string | null;
  mileage_at_service?: string | number | null;
}

export function ServiceRoute() {
  useFleetV2View('/fleet/v2/service');
  const pathFor = useCallback((id: number) => `/fleet/${id}/maintenance`, []);
  const { rows, loading, loadedVehicles, totalVehicles } = useFleetWideFanOut<ServiceRow>(pathFor);
  const [search, setSearch] = useState('');
  const [conflicts, setConflicts] = useState<Map<number, ConflictBadgeConflict[]>>(new Map());
  const fetchedIds = useRef<string>('');

  useEffect(() => {
    const ids = rows.map((r) => r.row.id);
    const key = ids.join(',');
    if (!ids.length || key === fetchedIds.current) return;
    fetchedIds.current = key;
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
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...rows].sort((a, b) =>
      (b.row.service_date ?? '').localeCompare(a.row.service_date ?? '')
    );
    if (!q) return sorted;
    return sorted.filter((entry) =>
      [
        vehicleLabel(entry.vehicle),
        entry.row.service_type,
        entry.row.vendor,
      ].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <FleetListShell
      title="Service"
      searchPlaceholder="Search by vehicle, service type, or vendor…"
      onSearchChange={setSearch}
      actions={<LegacyActionLink label="New Service Entry" legacyPath="/fleet" />}
    >
      {loading ? (
        <div className="p-4 text-sm text-rmpg-400">
          Loading service entries · {loadedVehicles}/{totalVehicles} vehicles…
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-4 text-sm text-rmpg-400">
          {rows.length === 0 ? 'No service entries in the fleet yet.' : 'No entries match the search.'}
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-surface-base sticky top-0">
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
                <tr key={`${vehicle.id}-${row.id}`} className="border-b border-rmpg-700 hover:bg-rmpg-800">
                  <td className="px-3 py-0.5 text-rmpg-300">{safeDateStr(row.service_date)}</td>
                  <td className="px-3 py-0.5">
                    <Link to={`/fleet/v2/vehicles/${vehicle.id}`} className="text-rmpg-100 hover:text-brand-400">
                      {vehicleLabel(vehicle)}
                    </Link>
                  </td>
                  <td className="px-3 py-0.5 text-rmpg-100">{row.service_type ?? '—'}</td>
                  <td className="px-3 py-0.5 text-rmpg-300">{row.vendor ?? '—'}</td>
                  <td className="px-3 py-0.5 text-right text-rmpg-300">{row.mileage_at_service ?? '—'}</td>
                  <td className="px-3 py-0.5 text-right text-rmpg-300">{row.cost != null ? `$${Number(row.cost).toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-0.5 text-center">
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
      )}
    </FleetListShell>
  );
}
