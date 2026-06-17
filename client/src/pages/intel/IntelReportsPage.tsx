import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';

interface ReportRow {
  id: number; report_number: string; title: string; status: string;
  threat_level: string; grade_label: string; confidence: number;
  retention_status: string; submitted_at: string;
}

const STATUSES = ['submitted', 'under_evaluation', 'graded', 'analyzed', 'disseminated', 'recalled', 'archived', 'rejected'];
const THREAT_COLOR: Record<string, string> = {
  critical: '#ef4444', high: '#f59e0b', medium: '#d4a017', low: '#888888',
};

export default function IntelReportsPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<ReportRow[]>(`/intel/reports${status ? `?status=${status}` : ''}`)
      .then((r) => { setRows(Array.isArray(r) ? r : []); setErr(''); })
      .catch(() => { setRows([]); setErr('Failed to load reports.'); })
      .finally(() => setLoading(false));
  }, [status]);
  useEffect(load, [load]);

  return (
    <div className="p-4 space-y-3" style={{ background: '#000000', minHeight: '100%', color: 'var(--rmpg-200)' }}>
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold tracking-wide" style={{ color: '#d4a017' }}>
          INTELLIGENCE PRODUCTS
        </h1>
        <button onClick={() => nav('/intel/reports/new')}
          className="px-3 py-1 text-xs font-semibold"
          style={{ background: '#d4a017', color: '#000', borderRadius: 2 }}>
          + NEW REPORT
        </button>
      </div>
      {err && <div style={{ color: '#ef4444', fontSize: 11 }}>{err}</div>}

      <div className="flex gap-1 flex-wrap text-[10px]">
        <button onClick={() => setStatus('')}
          className="px-2 py-1" style={{ background: status === '' ? '#d4a017' : '#0b0b0b', color: status === '' ? '#000' : '#888', borderRadius: 2 }}>
          ALL
        </button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className="px-2 py-1 uppercase"
            style={{ background: status === s ? '#d4a017' : '#0b0b0b', color: status === s ? '#000' : '#888', borderRadius: 2 }}>
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto"><table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#888', textAlign: 'left' }}>
            <th className="py-[3px] font-semibold text-[9px]">NUMBER</th>
            <th className="py-[3px] font-semibold text-[9px]">TITLE</th>
            <th className="py-[3px] font-semibold text-[9px]">STATUS</th>
            <th className="py-[3px] font-semibold text-[9px]">GRADE</th>
            <th className="py-[3px] font-semibold text-[9px]">CONF</th>
            <th className="py-[3px] font-semibold text-[9px]">THREAT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => nav(`/intel/reports/${r.id}`)}
              style={{ cursor: 'pointer', borderTop: '1px solid var(--border-subtle)' }}>
              <td className="py-[2px]" style={{ color: '#d4a017' }}>{r.report_number}</td>
              <td className="py-[2px]">{r.title}</td>
              <td className="py-[2px] uppercase">{r.status.replace('_', ' ')}
                {r.retention_status === 'due_review' && <span style={{ color: '#f59e0b' }}> ⚑</span>}</td>
              <td className="py-[2px]">{r.grade_label === 'UNGRADED' ? '—' : r.grade_label.split(' — ')[0]}</td>
              <td className="py-[2px]">{r.confidence || '—'}</td>
              <td className="py-[2px] uppercase" style={{ color: THREAT_COLOR[r.threat_level] || '#888' }}>{r.threat_level}</td>
            </tr>
          ))}
          {!rows.length && !loading && (
            <tr><td colSpan={6} className="py-3 text-center" style={{ color: 'var(--rmpg-500)' }}>No reports.</td></tr>
          )}
        </tbody>
      </table></div>
    </div>
  );
}
