import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../hooks/useApi';
import { safeDateStr } from '../../../../utils/dateUtils';

interface DamageRow {
  id: number;
  report_date?: string | null;
  damage_type?: string | null;
  severity?: string | null;
  description?: string | null;
  estimated_cost?: number | null;
  status?: string | null;
}

export function DamageTab({ vehicleId }: { vehicleId: number }) {
  const [rows, setRows] = useState<DamageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch<DamageRow[]>(`/fleet/${vehicleId}/damage-reports`)
      .then((r) => { if (!cancelled) setRows(Array.isArray(r) ? r : []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading damage reports…</div>;
  if (rows.length === 0) return <div className="p-4 text-sm text-rmpg-400">No damage reports for this vehicle.</div>;

  return (
    <div className="p-4 space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="border border-rmpg-700 bg-surface-raised rounded-sm px-3 py-2 text-[11px]">
          <div className="flex items-baseline justify-between">
            <span className="font-semibold text-rmpg-100">
              {r.damage_type ?? 'Damage'}
              {r.severity ? <span className="ml-2 text-rmpg-400">· {r.severity}</span> : null}
            </span>
            <time className="text-rmpg-400">{safeDateStr(r.report_date)}</time>
          </div>
          {r.description ? <div className="text-rmpg-300 mt-1">{r.description}</div> : null}
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-rmpg-400">{r.status ?? '—'}</span>
            <span className="text-rmpg-300">{r.estimated_cost != null ? `Est. $${Number(r.estimated_cost).toFixed(2)}` : ''}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
