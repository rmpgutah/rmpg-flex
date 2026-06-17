// Compact on-foot history for one unit — fed by
// GET /dispatch/gps/on-foot-segments. Opened by clicking an OnFootBadge.
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import type { Unit } from '../types';

interface Segment {
  id: number; started_at: string; ended_at: string | null;
  duration_s: number | null; distance_m: number | null; peak_activity: string | null;
}

export default function OnFootActivityModal({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const [rows, setRows] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiFetch<{ data: Segment[] }>(`/dispatch/gps/on-foot-segments?unit_id=${unit.id}&limit=25`)
      .then((d) => setRows(Array.isArray(d?.data) ? d.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [unit.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="w-[420px] max-h-[70vh] overflow-auto border border-border-default bg-surface-sunken p-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: '#d4a017' }}>
            ON-FOOT ACTIVITY — {unit.call_sign}
          </span>
          <button aria-label="Close" onClick={onClose}><X className="w-3.5 h-3.5 text-rmpg-400" /></button>
        </div>
        {loading ? <div className="text-[10px] text-rmpg-500">Loading…</div> : rows.length === 0 ? (
          <div className="text-[10px] text-rmpg-500">No on-foot segments recorded.</div>
        ) : (
          <table className="table-dark w-full">
            <thead><tr><th>Started</th><th>Duration</th><th>Distance</th><th>Peak</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="font-mono text-[10px]">{s.started_at}</td>
                  <td className="font-mono text-[10px]">{s.ended_at == null ? 'ACTIVE' : s.duration_s != null ? `${Math.round(s.duration_s / 60)}m` : '—'}</td>
                  <td className="font-mono text-[10px]">{s.distance_m != null ? `${Math.round(s.distance_m)} m` : '—'}</td>
                  <td className="font-mono text-[10px] uppercase">{s.peak_activity || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
