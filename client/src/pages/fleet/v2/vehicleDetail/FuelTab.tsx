import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../hooks/useApi';

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
}

export function FuelTab({ vehicleId }: { vehicleId: number }) {
  const [rows, setRows] = useState<FuelRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch<FuelRow[] | { results: FuelRow[] }>(`/fleet/${vehicleId}/fuel`)
      .then((r) => {
        if (cancelled) return;
        const arr = Array.isArray(r) ? r : (r as { results?: FuelRow[] })?.results ?? [];
        setRows(arr);
      })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading fuel history…</div>;
  if (rows.length === 0) return <div className="p-4 text-sm text-rmpg-400">No fuel entries for this vehicle yet.</div>;

  const avgMpg = computeAvgMpg(rows);

  return (
    <div className="p-4">
      {avgMpg != null ? (
        <div className="mb-3 rounded-sm border border-rmpg-700 bg-surface-raised px-3 py-2 text-[11px]">
          <span className="text-rmpg-400">Avg MPG · </span>
          <span className="text-rmpg-100 font-semibold">{avgMpg.toFixed(1)}</span>
        </div>
      ) : null}
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
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-rmpg-700">
              <td className="px-2 py-0.5 text-rmpg-300">{r.fuel_date ?? '—'}</td>
              <td className="px-2 py-0.5 text-rmpg-300">{r.station ?? '—'}</td>
              <td className="px-2 py-0.5 text-right text-rmpg-300">{r.gallons != null ? r.gallons.toFixed(2) : '—'}</td>
              <td className="px-2 py-0.5 text-right text-rmpg-300">{r.cost_per_gallon != null ? `$${r.cost_per_gallon.toFixed(2)}` : '—'}</td>
              <td className="px-2 py-0.5 text-right text-rmpg-300">{r.total_cost != null ? `$${r.total_cost.toFixed(2)}` : '—'}</td>
              <td className="px-2 py-0.5 text-right text-rmpg-300">{r.odometer != null ? r.odometer.toLocaleString() : '—'}</td>
              <td className="px-2 py-0.5 text-right text-rmpg-100">{r.mpg != null ? r.mpg.toFixed(1) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function computeAvgMpg(rows: FuelRow[]): number | null {
  const valid = rows.map((r) => r.mpg).filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}
