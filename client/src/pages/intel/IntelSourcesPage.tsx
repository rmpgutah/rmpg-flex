import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { formatEnumValue } from '../../utils/formatters';
import { downloadTextFile } from '../../utils/intelHitExport';
import {
  filterSources, sourceStats, sourcesToCsv, type IntelSourceRow,
} from '../../utils/intelSourcesFilter';
import ConfirmDialog from '../../components/ConfirmDialog';

const TYPES = ['officer_observation', 'confidential_informant', 'anonymous_tip', 'public', 'other_agency', 'osint', 'technical', 'victim', 'witness', 'suspect'];
const STATUSES = ['active', 'inactive', 'compromised', 'closed'];
const GRADES = ['A', 'B', 'C', 'D', 'E', 'F'];
const field: React.CSSProperties = { background: 'var(--surface-overlay)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: '4px 6px', fontSize: 11 };

export default function IntelSourcesPage() {
  const { user } = useAuth();
  const canWrite = ['admin', 'manager', 'supervisor'].includes(user?.role ?? '');
  const [rows, setRows] = useState<IntelSourceRow[]>([]);
  const [form, setForm] = useState({ source_type: 'confidential_informant', display_label: '', reliability_grade: 'C', restricted: true });
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [grade, setGrade] = useState('');
  const [editing, setEditing] = useState<IntelSourceRow | null>(null);
  const [relTarget, setRelTarget] = useState<IntelSourceRow | null>(null);
  const [relGrade, setRelGrade] = useState('B');
  const [relReason, setRelReason] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    apiFetch<IntelSourceRow[]>('/intel/sources')
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch(() => { setRows([]); setError('Failed to load sources.'); });
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.key === 'n' || e.key === 'N') && canWrite) {
        document.getElementById('source-label')?.focus();
      }
      if (e.key === 'Escape') { setEditing(null); setRelTarget(null); setQ(''); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canWrite]);

  const visible = useMemo(() => filterSources(rows, { q, type, status, grade }), [rows, q, type, status, grade]);
  const stats = useMemo(() => sourceStats(rows), [rows]);

  const create = async () => {
    if (!canWrite) return;
    setMsg('');
    try {
      const res = await apiFetch<{ error?: string; source_code?: string }>('/intel/sources', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      if (res?.error) setMsg(res.error);
      else {
        setForm({ source_type: 'confidential_informant', display_label: '', reliability_grade: 'C', restricted: true });
        load();
      }
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed.');
    }
  };

  const saveEdit = async () => {
    if (!editing || !canWrite) return;
    await apiFetch(`/intel/sources/${editing.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        display_label: editing.display_label,
        status: editing.status,
        restricted: editing.restricted,
        reliability_grade: editing.reliability_grade,
      }),
    });
    setEditing(null);
    load();
  };

  const saveReliability = async () => {
    if (!relTarget || !canWrite) return;
    await apiFetch(`/intel/sources/${relTarget.id}/reliability`, {
      method: 'POST',
      body: JSON.stringify({ new_grade: relGrade, reason: relReason }),
    });
    setRelTarget(null);
    setRelReason('');
    load();
  };

  async function copyCode(code: string) {
    try { await navigator.clipboard.writeText(code); } catch { /* */ }
  }

  return (
    <div className="p-4 space-y-3" style={{ background: 'var(--surface-base)', minHeight: '100%', color: 'var(--text-primary)' }}>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-sm font-semibold" style={{ color: 'var(--panel-header-color)' }}>SOURCE / CI REGISTRY</h1>
        <button type="button" onClick={() => downloadTextFile('intel-sources.csv', sourcesToCsv(visible))} className="text-[10px] px-2 py-1 border border-border-subtle rounded-[2px]">
          Export CSV
        </button>
      </div>
      {msg && <div style={{ color: 'var(--sev-critical)', fontSize: 11 }}>{msg}</div>}
      {error && <div style={{ color: 'var(--sev-critical)', fontSize: 11 }}>{error}</div>}

      <div className="grid grid-cols-4 gap-1">
        {[
          ['TOTAL', stats.total],
          ['ACTIVE', stats.active],
          ['RESTRICTED', stats.restricted],
          ['VISIBLE', visible.length],
        ].map(([label, n]) => (
          <div key={String(label)} className="bg-surface-overlay border border-border-subtle rounded-[2px] px-2 py-1">
            <div className="text-[14px] font-mono text-rmpg-100">{n}</div>
            <div className="text-[8px] tracking-wide text-[color:var(--field-label-color)]">{label}</div>
          </div>
        ))}
      </div>

      {canWrite && (
        <div className="flex gap-2 flex-wrap items-center">
          <select style={field} value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value })}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input id="source-label" placeholder="Display label (non-identifying)" style={{ ...field, width: 220 }}
            value={form.display_label} onChange={(e) => setForm({ ...form, display_label: e.target.value })} />
          <select style={field} value={form.reliability_grade} onChange={(e) => setForm({ ...form, reliability_grade: e.target.value })}>
            {GRADES.map((g) => <option key={g}>{g}</option>)}
          </select>
          <label className="text-[10px] text-fg-muted flex items-center gap-1">
            <input type="checkbox" checked={form.restricted} onChange={(e) => setForm({ ...form, restricted: e.target.checked })} />
            Restricted
          </label>
          <button onClick={create} style={{ background: 'var(--rmpg-600)', color: 'var(--text-primary)', borderRadius: 2, padding: '4px 10px', fontSize: 11, fontWeight: 600 }}>+ ADD SOURCE</button>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or label…" aria-label="Search sources" style={{ ...field, width: 200 }} />
        <select style={field} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select style={field} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={field} value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="">All grades</option>
          {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto"><table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
        <thead><tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
          <th className="py-[3px] text-[9px] font-semibold">CODE</th>
          <th className="py-[3px] text-[9px] font-semibold">TYPE</th>
          <th className="py-[3px] text-[9px] font-semibold">LABEL</th>
          <th className="py-[3px] text-[9px] font-semibold">RELIABILITY</th>
          <th className="py-[3px] text-[9px] font-semibold">STATUS</th>
          <th className="py-[3px] text-[9px] font-semibold">ACTIONS</th>
        </tr></thead>
        <tbody>
          {visible.map((s) => (
            <tr key={s.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <td className="py-[2px]">
                <button type="button" onClick={() => copyCode(s.source_code)} className="font-mono" style={{ color: 'var(--panel-header-color)' }} title="Copy code">{s.source_code}</button>
              </td>
              <td className="py-[2px]">{s.source_type}{s._restricted && <span style={{ color: 'var(--text-muted)' }}> 🔒</span>}</td>
              <td className="py-[2px]">{s.display_label || '—'}</td>
              <td className="py-[2px]">{s.reliability_grade || '—'}</td>
              <td className="py-[2px] uppercase">{formatEnumValue(s.status)}</td>
              <td className="py-[2px]">
                {canWrite && (
                  <span className="flex gap-2">
                    <button type="button" className="text-brand-400" onClick={() => setEditing({ ...s })}>Edit</button>
                    <button type="button" className="text-fg-muted" onClick={() => { setRelTarget(s); setRelGrade(s.reliability_grade || 'C'); }}>Grade</button>
                  </span>
                )}
              </td>
            </tr>
          ))}
          {!visible.length && <tr><td colSpan={6} className="py-3 text-center" style={{ color: 'var(--text-muted)' }}>{rows.length ? 'No sources match filters.' : 'No sources.'}</td></tr>}
        </tbody>
      </table></div>

      {editing && (
        <div className="border border-border-subtle bg-surface-overlay rounded-[2px] p-3 space-y-2">
          <div className="text-[10px] font-semibold text-[color:var(--panel-header-color)]">EDIT {editing.source_code}</div>
          <input style={field} value={editing.display_label ?? ''} onChange={(e) => setEditing({ ...editing, display_label: e.target.value })} />
          <select style={field} value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex gap-2">
            <button type="button" onClick={saveEdit} className="text-[11px] px-3 py-1 bg-surface-raised border border-border-subtle rounded-[2px]">Save</button>
            <button type="button" onClick={() => setEditing(null)} className="text-[11px] px-3 py-1">Cancel</button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={relTarget !== null}
        onClose={() => setRelTarget(null)}
        onConfirm={saveReliability}
        title="Update reliability grade"
        message="This writes an audit row. Do not put identifying CI details in the reason."
        details={(
          <div className="space-y-2">
            <select value={relGrade} onChange={(e) => setRelGrade(e.target.value)} style={field}>
              {GRADES.map((g) => <option key={g}>{g}</option>)}
            </select>
            <input value={relReason} onChange={(e) => setRelReason(e.target.value)} placeholder="Reason (non-identifying)" style={{ ...field, width: '100%' }} />
          </div>
        )}
        confirmLabel="Update grade"
      />
    </div>
  );
}
