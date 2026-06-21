import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../hooks/useApi';
import { safeDateTimeStr } from '../../../../utils/dateUtils';

interface AuditRow {
  id: number;
  action: string;
  details: string | null;
  created_at: string;
  user_id: number | null;
}

export function ActivityTab({ vehicleId }: { vehicleId: number }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ rows: AuditRow[] }>(`/audit/by-vehicle/${vehicleId}?limit=100`)
      .then((r) => { if (!cancelled) setRows(r?.rows ?? []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading activity…</div>;
  if (rows.length === 0) return <div className="p-4 text-sm text-rmpg-400">No activity recorded for this vehicle.</div>;

  return (
    <div className="p-4">
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="border border-rmpg-700 bg-surface-raised rounded-sm px-3 py-2 text-[11px]">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold text-rmpg-100">{r.action}</span>
              <time className="text-rmpg-400">{safeDateTimeStr(r.created_at)}</time>
            </div>
            {r.details ? (
              <pre className="mt-1 text-[10px] text-rmpg-400 whitespace-pre-wrap break-words font-mono">{tryFormatJson(r.details)}</pre>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function tryFormatJson(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}
