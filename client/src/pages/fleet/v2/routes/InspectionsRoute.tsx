import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FleetListShell } from '../shell/FleetListShell';
import { LegacyActionLink } from '../shell/LegacyActionLink';
import { useFleetV2View } from '../hooks/useFleetV2Audit';
import { useFleetWideFanOut, vehicleLabel } from '../shell/useFleetWideFanOut';
import { safeDateStr } from '../../../../utils/dateUtils';

interface InspectionRow {
  id: number;
  inspection_date?: string | null;
  inspection_type?: string | null;
  passed?: number | boolean | null;
  inspector_name?: string | null;
}

export function InspectionsRoute() {
  useFleetV2View('/fleet/v2/inspections');
  const pathFor = useCallback((id: number) => `/fleet/${id}/inspections`, []);
  const { rows, loading, loadedVehicles, totalVehicles } = useFleetWideFanOut<InspectionRow>(pathFor);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...rows].sort((a, b) =>
      (b.row.inspection_date ?? '').localeCompare(a.row.inspection_date ?? '')
    );
    if (!q) return sorted;
    return sorted.filter((entry) =>
      [
        vehicleLabel(entry.vehicle),
        entry.row.inspection_type,
        entry.row.inspector_name,
      ].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <FleetListShell
      title="Inspections"
      searchPlaceholder="Search by vehicle, type, or inspector…"
      onSearchChange={setSearch}
      actions={<LegacyActionLink label="New Inspection" legacyPath="/fleet" />}
    >
      {loading ? (
        <div className="p-4 text-sm text-rmpg-400">
          Loading inspections · {loadedVehicles}/{totalVehicles} vehicles…
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-4 text-sm text-rmpg-400">
          {rows.length === 0 ? 'No inspections in the fleet yet.' : 'No entries match the search.'}
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-surface-base sticky top-0">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold">Date</th>
              <th className="text-left px-3 py-1.5 font-semibold">Vehicle</th>
              <th className="text-left px-3 py-1.5 font-semibold">Type</th>
              <th className="text-left px-3 py-1.5 font-semibold">Inspector</th>
              <th className="text-left px-3 py-1.5 font-semibold">Result</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ vehicle, row }) => {
              const passed = row.passed === true || row.passed === 1;
              return (
                <tr key={`${vehicle.id}-${row.id}`} className="border-b border-rmpg-700 hover:bg-rmpg-800">
                  <td className="px-3 py-0.5 text-rmpg-300">{safeDateStr(row.inspection_date)}</td>
                  <td className="px-3 py-0.5">
                    <Link to={`/fleet/v2/vehicles/${vehicle.id}`} className="text-rmpg-100 hover:text-brand-400">
                      {vehicleLabel(vehicle)}
                    </Link>
                  </td>
                  <td className="px-3 py-0.5 text-rmpg-100">{row.inspection_type ?? '—'}</td>
                  <td className="px-3 py-0.5 text-rmpg-300">{row.inspector_name ?? '—'}</td>
                  <td className="px-3 py-0.5">
                    <span className={`px-1.5 py-0.5 text-[9px] rounded-sm ${passed ? 'bg-green-700 text-green-50' : 'bg-red-700 text-red-50'}`}>
                      {passed ? 'PASS' : 'FAIL'}
                    </span>
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
