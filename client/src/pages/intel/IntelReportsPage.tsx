import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import { apiFetch } from '../../hooks/useApi';
import { formatEnumValue, toDisplayLabel } from '../../utils/formatters';
import { downloadTextFile, intelHitsToCsv } from '../../utils/intelHitExport';
import { filterIntelReports } from '../../utils/intelSourcesFilter';
import { useSlashFocus } from '../../hooks/useSlashFocus';

interface ReportRow {
  id: number; report_number: string; title: string; status: string;
  threat_level: string; grade_label: string; confidence: number;
  retention_status: string; submitted_at: string;
}

const STATUSES = ['submitted', 'under_evaluation', 'graded', 'analyzed', 'disseminated', 'recalled', 'archived', 'rejected'];
const THREAT_COLOR: Record<string, string> = {
  critical: 'var(--sev-critical)', high: 'var(--sev-warn)', medium: 'var(--sev-warn-soft)', low: 'var(--text-muted)',
};

export default function IntelReportsPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [threat, setThreat] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<ReportRow[]>(`/intel/reports${status ? `?status=${status}` : ''}`)
      .then((r) => { setRows(Array.isArray(r) ? r : []); setErr(''); })
      .catch(() => { setRows([]); setErr('Failed to load reports.'); })
      .finally(() => setLoading(false));
  }, [status]);
  useEffect(load, [load]);

  const visible = useMemo(() => {
    const byThreat = threat ? rows.filter((r) => r.threat_level === threat) : rows;
    return filterIntelReports(byThreat, q);
  }, [rows, q, threat]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT') return;
      if (e.key === 'n' || e.key === 'N') nav('/intel/reports/new');
      if (e.key === 'Escape') { setQ(''); setThreat(''); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  return (
    <div className="p-4 space-y-3" style={{ background: 'var(--surface-base)', minHeight: '100%', color: 'var(--text-primary)' }}>
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold tracking-wide" style={{ color: 'var(--panel-header-color)' }}>
          INTELLIGENCE PRODUCTS
        </h1>
        <div className="flex gap-2">
          <button type="button" onClick={load} className="toolbar-btn">Refresh</button>
          <button type="button" className="toolbar-btn" disabled={visible.length === 0} onClick={() => downloadTextFile('intel-reports.csv', intelHitsToCsv(visible.map((r) => ({ type: 'report', id: r.id, label: r.title, snippet: r.report_number, flags: [r.status, r.threat_level], score: r.confidence }))))}>CSV</button>
          <button onClick={() => nav('/intel/reports/new')}
            className="px-3 py-1 text-xs font-semibold"
            style={{ background: 'var(--rmpg-600)', color: 'var(--text-primary)', borderRadius: 2 }}>
            + NEW REPORT
          </button>
        </div>
      </div>
      {err && (
        <div className="flex items-center justify-between" style={{ color: 'var(--sev-critical)', fontSize: 11 }}>
          <span>{err}</span>
          <button type="button" className="toolbar-btn" onClick={load}>Retry</button>
        </div>
      )}
      <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or number… (/)" aria-label="Search reports" className="w-full max-w-sm text-[11px] px-2 py-1 bg-surface-overlay border border-border-subtle rounded-[2px] text-rmpg-100" />
      <div className="flex gap-1 text-[10px]">
        {['', 'critical', 'high', 'medium', 'low'].map((t) => (
          <button key={t || 'all-threat'} type="button" onClick={() => setThreat(t)} className="px-2 py-1 uppercase rounded-[2px]" style={{ background: threat === t ? 'var(--rmpg-700)' : 'var(--surface-overlay)', color: threat === t ? 'var(--rmpg-50)' : 'var(--text-muted)' }}>
            {t || 'all threat'}
          </button>
        ))}
      </div>

      <div className="flex gap-1 flex-wrap text-[10px]">
        <button onClick={() => setStatus('')}
          className="px-2 py-1" style={{ background: status === '' ? 'var(--rmpg-700)' : 'var(--surface-overlay)', color: status === '' ? 'var(--rmpg-50)' : 'var(--text-muted)', borderRadius: 2 }}>
          ALL
        </button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className="px-2 py-1 uppercase"
            style={{ background: status === s ? 'var(--rmpg-700)' : 'var(--surface-overlay)', color: status === s ? 'var(--rmpg-50)' : 'var(--text-muted)', borderRadius: 2 }}>
            {toDisplayLabel(s)}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto"><table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
            <th className="py-[3px] font-semibold text-[9px]">NUMBER</th>
            <th className="py-[3px] font-semibold text-[9px]">TITLE</th>
            <th className="py-[3px] font-semibold text-[9px]">STATUS</th>
            <th className="py-[3px] font-semibold text-[9px]">GRADE</th>
            <th className="py-[3px] font-semibold text-[9px]">CONF</th>
            <th className="py-[3px] font-semibold text-[9px]">THREAT</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.id} onClick={() => nav(`/intel/reports/${r.id}`)}
              style={{ cursor: 'pointer', borderTop: '1px solid var(--border-subtle)' }}>
              <td className="py-[2px]" style={{ color: 'var(--panel-header-color)' }}>{r.report_number}</td>
              <td className="py-[2px]">{r.title}</td>
              <td className="py-[2px] uppercase">{toDisplayLabel(r.status)}
                {r.retention_status === 'due_review' && <span style={{ color: 'var(--sev-warn)' }}> ⚑</span>}</td>
              <td className="py-[2px]">{r.grade_label === 'UNGRADED' ? '—' : r.grade_label.split(' — ')[0]}</td>
              <td className="py-[2px]">{r.confidence || '—'}</td>
              <td className="py-[2px] uppercase" style={{ color: THREAT_COLOR[r.threat_level] || 'var(--text-muted)' }}>{formatEnumValue(r.threat_level)}</td>
            </tr>
          ))}
          {!visible.length && !loading && (
            <tr><td colSpan={6} className="py-3 text-center" style={{ color: 'var(--text-muted)' }}>{rows.length ? 'No reports match filters.' : 'No reports.'}</td></tr>
          )}
        </tbody>
      </table></div>
    </div>
  );
}
