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
      {modal?.mode === 'create' ? (
        <FuelEntryModal
          vehicleId={vehicleId}
          mode="create"
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); fetchRows(); }}
        />
      ) : modal?.mode === 'edit' ? (
        <FuelEntryModal
          vehicleId={vehicleId}
          mode="edit"
          entry={modal.entry as FuelEntryRow}
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
