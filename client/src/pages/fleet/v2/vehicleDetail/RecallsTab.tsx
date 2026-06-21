import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../hooks/useApi';
import { safeDateStr } from '../../../../utils/dateUtils';

interface RecallRow {
  id: number;
  recall_number?: string | null;
  recall_title?: string | null;
  description?: string | null;
  issue_date?: string | null;
  status?: string | null;
  resolved_date?: string | null;
}

export function RecallsTab({ vehicleId }: { vehicleId: number }) {
  const [rows, setRows] = useState<RecallRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch<RecallRow[]>(`/fleet/recalls?vehicle_id=${vehicleId}`)
      .then((r) => { if (!cancelled) setRows(Array.isArray(r) ? r : []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading recalls…</div>;
  if (rows.length === 0) return <div className="p-4 text-sm text-rmpg-400">No recalls on file for this vehicle.</div>;

  return (
    <div className="p-4 space-y-2">
      {rows.map((r) => {
        const resolved = !!r.resolved_date;
        return (
          <div key={r.id} className="border border-rmpg-700 bg-surface-raised rounded-sm px-3 py-2 text-[11px]">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold text-rmpg-100">
                {r.recall_number ?? `Recall #${r.id}`}
                <span className={`ml-2 px-1.5 py-0.5 text-[9px] rounded-sm ${resolved ? 'bg-green-700 text-green-50' : 'bg-amber-700 text-amber-50'}`}>
                  {resolved ? 'RESOLVED' : (r.status ?? 'OPEN').toUpperCase()}
                </span>
              </span>
              <time className="text-rmpg-400">{safeDateStr(r.issue_date)}</time>
            </div>
            {r.recall_title ? <div className="text-rmpg-200 mt-0.5">{r.recall_title}</div> : null}
            {r.description ? <div className="text-rmpg-400 mt-1">{r.description}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
