import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Wrench } from 'lucide-react';
import { apiFetchV2 } from '../hooks/apiFetchV2';

interface WoRow {
  id: number;
  number: string | null;
  status: string;
  priority: string | null;
  summary: string | null;
  opened_at: string;
  closed_at: string | null;
  est_cost: number | null;
  actual_cost: number | null;
  failure_category: string | null;
}

const STATUS_TONES: Record<string, string> = {
  open: 'bg-amber-500/15 text-amber-300',
  in_progress: 'bg-blue-500/15 text-blue-300',
  waiting_parts: 'bg-purple-500/15 text-purple-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  cancelled: 'bg-rmpg-700/40 text-rmpg-400',
};

export function WorkOrdersTab({ vehicleId }: { vehicleId: number }) {
  const [rows, setRows] = useState<WoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetchV2<{ data: WoRow[] }>(`/work-orders?vehicle_id=${vehicleId}&limit=100`)
      .then((r) => { if (!cancelled) { setRows(r?.data ?? []); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setErr(e?.message ?? 'Failed'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (err) return <div className="p-4 text-xs text-red-400">{err}</div>;
  if (loading) return <div className="p-4 text-xs text-rmpg-400">Loading work orders…</div>;

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-rmpg-400">{rows.length} work order{rows.length === 1 ? '' : 's'}</div>
        <Link
          to="/fleet/v2/work-orders"
          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110"
        >
          <Plus className="w-3 h-3" /> New WO
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-rmpg-500 py-8 text-center">
          <Wrench className="w-8 h-8 mx-auto mb-2 text-rmpg-600" />
          No work orders for this vehicle.
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[9px] text-rmpg-500 uppercase tracking-wider font-bold">
              <th className="px-3 py-1.5 font-semibold">WO #</th>
              <th className="px-3 py-1.5 font-semibold">Status</th>
              <th className="px-3 py-1.5 font-semibold">Priority</th>
              <th className="px-3 py-1.5 font-semibold">Summary</th>
              <th className="px-3 py-1.5 font-semibold">Category</th>
              <th className="px-3 py-1.5 font-semibold">Opened</th>
              <th className="text-right px-3 py-1.5 font-semibold">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-rmpg-800/40 hover:bg-rmpg-800/40">
                <td className="px-3 py-1 font-mono text-rmpg-100">{r.number ?? `#${r.id}`}</td>
                <td className="px-3 py-1">
                  <span className={`px-1.5 py-0.5 rounded-sm text-[10px] uppercase tracking-wide ${STATUS_TONES[r.status] ?? 'bg-rmpg-700/40 text-rmpg-400'}`}>
                    {r.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-3 py-1">
                  {r.priority && r.priority !== 'normal' ? (
                    <span className={`text-[10px] uppercase font-bold ${r.priority === 'emergency' ? 'text-red-400' : r.priority === 'high' ? 'text-amber-400' : 'text-rmpg-400'}`}>
                      {r.priority}
                    </span>
                  ) : (
                    <span className="text-rmpg-600">—</span>
                  )}
                </td>
                <td className="px-3 py-1 text-rmpg-200 max-w-[240px] truncate">{r.summary ?? '—'}</td>
                <td className="px-3 py-1 text-rmpg-400 text-[10px]">{r.failure_category ?? '—'}</td>
                <td className="px-3 py-1 font-mono text-rmpg-300">{r.opened_at?.slice(0, 10) ?? '—'}</td>
                <td className="px-3 py-1 text-right text-rmpg-100 font-mono">{r.actual_cost != null ? `$${r.actual_cost.toLocaleString()}` : r.est_cost != null ? `$${r.est_cost.toLocaleString()} est` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
