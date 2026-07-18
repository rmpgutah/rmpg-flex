import { useEffect, useMemo, useState } from 'react';
import { Store } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { safeDateStr } from '../../../utils/dateUtils';
import PanelTitleBar from '../../../components/PanelTitleBar';

interface VendorRow {
  id: number;
  name?: string | null;
  brand?: string | null;
  location?: string | null;
  current_price_per_gallon?: number | null;
  last_updated?: string | null;
  notes?: string | null;
}

export default function FleetVendorsTab() {
  const [rows, setRows] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch<VendorRow[]>('/fleet/fuel/vendors')
      .then((r) => { if (!cancelled) setRows(Array.isArray(r) ? r : []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...rows].sort((a, b) =>
      (a.current_price_per_gallon ?? Infinity) - (b.current_price_per_gallon ?? Infinity)
    );
    if (!q) return sorted;
    return sorted.filter((r) =>
      [r.name, r.brand, r.location].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <div className="p-4 space-y-3">
      <PanelTitleBar title="FUEL VENDORS" icon={Store} />
      <input
        type="text"
        placeholder="Search by name, brand, or location…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-2 py-1 text-[11px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 placeholder:text-rmpg-500"
      />
      {loading ? (
        <div className="p-4 text-xs text-rmpg-400">Loading vendors…</div>
      ) : filtered.length === 0 ? (
        <div className="p-4 text-xs text-rmpg-400">
          {rows.length === 0 ? 'No fuel vendors on file.' : 'No vendors match the search.'}
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-surface-base">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold">Name</th>
              <th className="text-left px-3 py-1.5 font-semibold">Brand</th>
              <th className="text-left px-3 py-1.5 font-semibold">Location</th>
              <th className="text-right px-3 py-1.5 font-semibold">$/gal</th>
              <th className="text-left px-3 py-1.5 font-semibold">Updated</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-rmpg-800/40 hover:bg-rmpg-800/40">
                <td className="px-3 py-1 text-rmpg-100">{r.name ?? '—'}</td>
                <td className="px-3 py-1 text-rmpg-300">{r.brand ?? '—'}</td>
                <td className="px-3 py-1 text-rmpg-300">{r.location ?? '—'}</td>
                <td className="px-3 py-1 text-right text-rmpg-300">{r.current_price_per_gallon != null ? `$${Number(r.current_price_per_gallon).toFixed(3)}` : '—'}</td>
                <td className="px-3 py-1 text-rmpg-300">{safeDateStr(r.last_updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
