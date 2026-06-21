import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../hooks/useApi';

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch<ServiceRow[] | { results: ServiceRow[] }>(`/fleet/${vehicleId}/maintenance`)
      .then((r) => {
        if (cancelled) return;
        const arr = Array.isArray(r) ? r : (r as { results?: ServiceRow[] })?.results ?? [];
        setRows(arr);
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
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-rmpg-700">
              <td className="px-2 py-0.5 text-rmpg-300">{r.service_date ?? '—'}</td>
              <td className="px-2 py-0.5 text-rmpg-100">{r.service_type ?? '—'}</td>
              <td className="px-2 py-0.5 text-rmpg-300">{r.vendor ?? '—'}</td>
              <td className="px-2 py-0.5 text-right text-rmpg-300">{r.mileage_at_service ?? '—'}</td>
              <td className="px-2 py-0.5 text-right text-rmpg-300">{r.cost != null ? `$${Number(r.cost).toFixed(2)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
