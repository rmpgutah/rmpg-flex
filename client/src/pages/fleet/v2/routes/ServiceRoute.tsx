import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FleetListShell } from '../shell/FleetListShell';
import { LegacyActionLink } from '../shell/LegacyActionLink';
import { useFleetV2View } from '../hooks/useFleetV2Audit';
import { useFleetWideFanOut, vehicleLabel } from '../shell/useFleetWideFanOut';
import { safeDateStr } from '../../../../utils/dateUtils';

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
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ vehicle, row }) => (
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </FleetListShell>
  );
}
