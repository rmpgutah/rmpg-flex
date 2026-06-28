import { useEffect, useMemo, useState } from 'react';
import { apiFetchV2 } from '../hooks/apiFetchV2';
import { FleetListShell } from '../shell/FleetListShell';
import { LegacyActionLink } from '../shell/LegacyActionLink';
import { useFleetV2View } from '../hooks/useFleetV2Audit';
import { safeDateStr } from '../../../../utils/dateUtils';

interface VendorRow {
  id: number;
  name?: string | null;
  brand?: string | null;
  location?: string | null;
  current_price_per_gallon?: number | null;
  last_updated?: string | null;
  notes?: string | null;
}

export function VendorsRoute() {
  useFleetV2View('/fleet/v2/vendors');
  const [rows, setRows] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetchV2<VendorRow[]>('/fleet/fuel/vendors')
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
    <FleetListShell
      title="Vendors"
      searchPlaceholder="Search by name, brand, or location…"
      onSearchChange={setSearch}
      actions={<LegacyActionLink label="New Vendor" legacyPath="/fleet" />}
    >
      {loading ? (
        <div className="p-4 text-sm text-rmpg-400">Loading vendors…</div>
      ) : filtered.length === 0 ? (
        <div className="p-4 text-sm text-rmpg-400">
          {rows.length === 0 ? 'No fuel vendors on file.' : 'No vendors match the search.'}
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-surface-base sticky top-0">
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
              <tr key={r.id} className="border-b border-rmpg-700 hover:bg-rmpg-800">
                <td className="px-3 py-0.5 text-rmpg-100">{r.name ?? '—'}</td>
                <td className="px-3 py-0.5 text-rmpg-300">{r.brand ?? '—'}</td>
                <td className="px-3 py-0.5 text-rmpg-300">{r.location ?? '—'}</td>
                <td className="px-3 py-0.5 text-right text-rmpg-300">{r.current_price_per_gallon != null ? `$${Number(r.current_price_per_gallon).toFixed(3)}` : '—'}</td>
                <td className="px-3 py-0.5 text-rmpg-300">{safeDateStr(r.last_updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </FleetListShell>
  );
}
