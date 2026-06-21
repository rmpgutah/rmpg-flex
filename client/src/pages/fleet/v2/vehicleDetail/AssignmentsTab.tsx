import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../hooks/useApi';
import { safeDateStr } from '../../../../utils/dateUtils';

interface AssignmentRow {
  id: number;
  officer_name?: string | null;
  user_id?: number | null;
  assigned_date?: string | null;
  ended_date?: string | null;
  notes?: string | null;
}

export function AssignmentsTab({ vehicleId }: { vehicleId: number }) {
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AssignmentRow[] | { results: AssignmentRow[] }>(`/fleet/${vehicleId}/assignments`)
      .then((r) => {
        if (cancelled) return;
        const arr = Array.isArray(r) ? r : (r as { results?: AssignmentRow[] })?.results ?? [];
        setRows(arr);
      })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading assignments…</div>;
  if (rows.length === 0) return <div className="p-4 text-sm text-rmpg-400">No assignment history for this vehicle.</div>;

  return (
    <div className="p-4 space-y-2">
      {rows.map((r) => {
        const active = !r.ended_date;
        return (
          <div key={r.id} className="border border-rmpg-700 bg-surface-raised rounded-sm px-3 py-2 text-[11px]">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold text-rmpg-100">
                {r.officer_name ?? `User #${r.user_id ?? '—'}`}
                {active ? <span className="ml-2 px-1.5 py-0.5 text-[9px] rounded-sm bg-green-700 text-green-50">ACTIVE</span> : null}
              </span>
              <span className="text-rmpg-400">
                {safeDateStr(r.assigned_date)} → {r.ended_date ? safeDateStr(r.ended_date) : 'present'}
              </span>
            </div>
            {r.notes ? <div className="text-rmpg-300 mt-1">{r.notes}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
