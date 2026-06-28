import { useEffect, useState } from 'react';
import { apiFetchV2 } from '../hooks/apiFetchV2';

interface InspectionRow {
  id: number;
  inspection_date: string | null;
  inspection_type: string | null;
  passed: number | boolean | null;
  inspector_name: string | null;
  notes: string | null;
}

export function InspectionsTab({ vehicleId }: { vehicleId: number }) {
  const [rows, setRows] = useState<InspectionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetchV2<InspectionRow[] | { results: InspectionRow[] }>(`/fleet/${vehicleId}/inspections`)
      .then((r) => {
        if (cancelled) return;
        const arr = Array.isArray(r) ? r : (r as { results?: InspectionRow[] })?.results ?? [];
        setRows(arr);
      })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading inspections…</div>;
  if (rows.length === 0) return <div className="p-4 text-sm text-rmpg-400">No inspections recorded for this vehicle.</div>;

  return (
    <div className="p-4">
      <ul className="space-y-2">
        {rows.map((r) => {
          const passed = r.passed === true || r.passed === 1;
          return (
            <li key={r.id} className="border border-rmpg-700 bg-surface-raised rounded-sm px-3 py-2 text-[11px]">
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="font-semibold text-rmpg-100">{r.inspection_type ?? 'Inspection'}</span>
                  <span className={`ml-2 px-1.5 py-0.5 text-[9px] rounded-sm ${passed ? 'bg-green-700 text-green-50' : 'bg-red-700 text-red-50'}`}>
                    {passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>
                <time className="text-rmpg-400">{r.inspection_date ?? '—'}</time>
              </div>
              {r.inspector_name ? <div className="text-rmpg-400 mt-0.5">by {r.inspector_name}</div> : null}
              {r.notes ? <div className="text-rmpg-300 mt-1">{r.notes}</div> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
