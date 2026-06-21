import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../../../hooks/useApi';
import { FleetListShell } from '../shell/FleetListShell';
import { LegacyActionLink } from '../shell/LegacyActionLink';
import { useFleetV2View } from '../hooks/useFleetV2Audit';
import { safeDateStr } from '../../../../utils/dateUtils';

interface AssignmentRow {
  id: number;
  vehicle_id?: number | null;
  officer_name?: string | null;
  vehicle_number?: string | null;
  vehicle_name?: string | null;
  assigned_date?: string | null;
  ended_date?: string | null;
  notes?: string | null;
}

export function PersonnelRoute() {
  useFleetV2View('/fleet/v2/personnel');
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch<AssignmentRow[]>('/fleet/assignments')
      .then((r) => { if (!cancelled) setRows(Array.isArray(r) ? r : []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Active assignments first (no ended_date), then by assigned_date desc
    const sorted = [...rows].sort((a, b) => {
      const aActive = !a.ended_date ? 0 : 1;
      const bActive = !b.ended_date ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return (b.assigned_date ?? '').localeCompare(a.assigned_date ?? '');
    });
    if (!q) return sorted;
    return sorted.filter((r) =>
      [r.officer_name, r.vehicle_number, r.vehicle_name, r.notes].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <FleetListShell
      title="Personnel"
      searchPlaceholder="Search by officer, vehicle, or notes…"
      onSearchChange={setSearch}
      actions={<LegacyActionLink label="New Assignment" legacyPath="/fleet" />}
    >
      {loading ? (
        <div className="p-4 text-sm text-rmpg-400">Loading personnel assignments…</div>
      ) : filtered.length === 0 ? (
        <div className="p-4 text-sm text-rmpg-400">
          {rows.length === 0 ? 'No personnel assignments on file.' : 'No assignments match the search.'}
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-surface-base sticky top-0">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold">Officer</th>
              <th className="text-left px-3 py-1.5 font-semibold">Vehicle</th>
              <th className="text-left px-3 py-1.5 font-semibold">From</th>
              <th className="text-left px-3 py-1.5 font-semibold">To</th>
              <th className="text-left px-3 py-1.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const active = !r.ended_date;
              return (
                <tr key={r.id} className="border-b border-rmpg-700 hover:bg-rmpg-800">
                  <td className="px-3 py-0.5 text-rmpg-100">{r.officer_name ?? '—'}</td>
                  <td className="px-3 py-0.5">
                    {r.vehicle_id != null ? (
                      <Link to={`/fleet/v2/vehicles/${r.vehicle_id}`} className="text-rmpg-300 hover:text-brand-400">
                        {r.vehicle_name ?? r.vehicle_number ?? `Vehicle ${r.vehicle_id}`}
                      </Link>
                    ) : <span className="text-rmpg-300">—</span>}
                  </td>
                  <td className="px-3 py-0.5 text-rmpg-300">{safeDateStr(r.assigned_date)}</td>
                  <td className="px-3 py-0.5 text-rmpg-300">{r.ended_date ? safeDateStr(r.ended_date) : 'present'}</td>
                  <td className="px-3 py-0.5">
                    {active ? (
                      <span className="px-1.5 py-0.5 text-[9px] rounded-sm bg-green-700 text-green-50">ACTIVE</span>
                    ) : (
                      <span className="text-rmpg-400">ended</span>
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
