import { useEffect, useState } from 'react';
import { apiFetchV2 } from '../hooks/apiFetchV2';
import { safeDateStr } from '../../../../utils/dateUtils';

interface TireRow {
  id: number;
  position?: string | null;
  brand?: string | null;
  size?: string | null;
  install_date?: string | null;
  install_mileage?: number | null;
  tread_depth?: number | null;
  replaced_date?: string | null;
}

export function TiresTab({ vehicleId }: { vehicleId: number }) {
  const [rows, setRows] = useState<TireRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetchV2<TireRow[]>(`/fleet/${vehicleId}/tires`)
      .then((r) => { if (!cancelled) setRows(Array.isArray(r) ? r : []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading tires…</div>;
  if (rows.length === 0) return <div className="p-4 text-sm text-rmpg-400">No tire records for this vehicle.</div>;

  return (
    <div className="p-4">
      <table className="w-full text-[11px]">
        <thead className="bg-surface-base">
          <tr>
            <th className="text-left px-2 py-1.5 font-semibold">Position</th>
            <th className="text-left px-2 py-1.5 font-semibold">Brand</th>
            <th className="text-left px-2 py-1.5 font-semibold">Size</th>
            <th className="text-left px-2 py-1.5 font-semibold">Installed</th>
            <th className="text-right px-2 py-1.5 font-semibold">Tread</th>
            <th className="text-left px-2 py-1.5 font-semibold">Replaced</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-rmpg-700">
              <td className="px-2 py-0.5 text-rmpg-100">{r.position ?? '—'}</td>
              <td className="px-2 py-0.5 text-rmpg-300">{r.brand ?? '—'}</td>
              <td className="px-2 py-0.5 text-rmpg-300">{r.size ?? '—'}</td>
              <td className="px-2 py-0.5 text-rmpg-300">{safeDateStr(r.install_date)}</td>
              <td className="px-2 py-0.5 text-right text-rmpg-300">{r.tread_depth != null ? `${r.tread_depth}/32"` : '—'}</td>
              <td className="px-2 py-0.5 text-rmpg-300">{r.replaced_date ? safeDateStr(r.replaced_date) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
