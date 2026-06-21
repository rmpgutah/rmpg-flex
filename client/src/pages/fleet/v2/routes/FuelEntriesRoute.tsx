import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FleetListShell } from '../shell/FleetListShell';
import { LegacyActionLink } from '../shell/LegacyActionLink';
import { useFleetV2View } from '../hooks/useFleetV2Audit';
import { useFleetWideFanOut, vehicleLabel } from '../shell/useFleetWideFanOut';
import { safeDateStr } from '../../../../utils/dateUtils';

interface FuelRow {
  id: number;
  fuel_date?: string | null;
  gallons?: number | null;
  cost_per_gallon?: number | null;
  total_cost?: number | null;
  odometer?: number | null;
  mpg?: number | null;
  station?: string | null;
}

export function FuelEntriesRoute() {
  useFleetV2View('/fleet/v2/fuel');
  const pathFor = useCallback((id: number) => `/fleet/${id}/fuel`, []);
  const { rows, loading, loadedVehicles, totalVehicles } = useFleetWideFanOut<FuelRow>(pathFor);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...rows].sort((a, b) =>
      (b.row.fuel_date ?? '').localeCompare(a.row.fuel_date ?? '')
    );
    if (!q) return sorted;
    return sorted.filter((entry) =>
      [
        vehicleLabel(entry.vehicle),
        entry.row.station,
        entry.row.fuel_date,
      ].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <FleetListShell
      title="Fuel Entries"
      searchPlaceholder="Search by vehicle, station, or date…"
      onSearchChange={setSearch}
      actions={<LegacyActionLink label="New Fuel Entry" legacyPath="/fleet" />}
    >
      {loading ? (
        <div className="p-4 text-sm text-rmpg-400">
          Loading fuel entries · {loadedVehicles}/{totalVehicles} vehicles…
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-4 text-sm text-rmpg-400">
          {rows.length === 0 ? 'No fuel entries in the fleet yet.' : 'No entries match the search.'}
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-surface-base sticky top-0">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold">Date</th>
              <th className="text-left px-3 py-1.5 font-semibold">Vehicle</th>
              <th className="text-left px-3 py-1.5 font-semibold">Station</th>
              <th className="text-right px-3 py-1.5 font-semibold">Gallons</th>
              <th className="text-right px-3 py-1.5 font-semibold">$/gal</th>
              <th className="text-right px-3 py-1.5 font-semibold">Total</th>
              <th className="text-right px-3 py-1.5 font-semibold">MPG</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ vehicle, row }) => (
              <tr key={`${vehicle.id}-${row.id}`} className="border-b border-rmpg-700 hover:bg-rmpg-800">
                <td className="px-3 py-0.5 text-rmpg-300">{safeDateStr(row.fuel_date)}</td>
                <td className="px-3 py-0.5">
                  <Link to={`/fleet/v2/vehicles/${vehicle.id}`} className="text-rmpg-100 hover:text-brand-400">
                    {vehicleLabel(vehicle)}
                  </Link>
                </td>
                <td className="px-3 py-0.5 text-rmpg-300">{row.station ?? '—'}</td>
                <td className="px-3 py-0.5 text-right text-rmpg-300">{row.gallons != null ? row.gallons.toFixed(2) : '—'}</td>
                <td className="px-3 py-0.5 text-right text-rmpg-300">{row.cost_per_gallon != null ? `$${row.cost_per_gallon.toFixed(2)}` : '—'}</td>
                <td className="px-3 py-0.5 text-right text-rmpg-300">{row.total_cost != null ? `$${row.total_cost.toFixed(2)}` : '—'}</td>
                <td className="px-3 py-0.5 text-right text-rmpg-100">{row.mpg != null ? row.mpg.toFixed(1) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </FleetListShell>
  );
}
