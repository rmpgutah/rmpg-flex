import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';

interface Source {
  id: number; source_code: string; source_type: string; display_label: string;
  reliability_grade: string; status: string; restricted: number; _restricted?: boolean;
}
const TYPES = ['officer_observation', 'confidential_informant', 'anonymous_tip', 'public', 'other_agency', 'osint', 'technical', 'victim', 'witness', 'suspect'];
const field: React.CSSProperties = { background: 'var(--surface-overlay)', color: 'var(--rmpg-200)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: '4px 6px', fontSize: 11 };

export default function IntelSourcesPage() {
  const [rows, setRows] = useState<Source[]>([]);
  const [form, setForm] = useState<any>({ source_type: 'confidential_informant', display_label: '', reliability_grade: 'C' });
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    apiFetch<Source[]>('/intel/sources').then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => { setRows([]); setMsg('Failed to load sources.'); });
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    setMsg('');
    try {
      const res = await apiFetch<any>('/intel/sources', { method: 'POST', body: JSON.stringify(form) });
      if (res?.error) setMsg(res.error); else { setForm({ source_type: 'confidential_informant', display_label: '', reliability_grade: 'C' }); load(); }
    } catch (e: any) { setMsg(e?.message || 'Failed.'); }
  };

  return (
    <div className="p-4 space-y-3" style={{ background: 'var(--surface-base)', minHeight: '100%', color: 'var(--rmpg-200)' }}>
      <h1 className="text-sm font-semibold" style={{ color: '#d4a017' }}>SOURCE / CI REGISTRY</h1>
      {msg && <div style={{ color: '#ef4444', fontSize: 11 }}>{msg}</div>}

      <div className="flex gap-2 flex-wrap items-center">
        <select style={field} value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value })}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input placeholder="Display label (non-identifying)" style={{ ...field, width: 220 }}
          value={form.display_label} onChange={(e) => setForm({ ...form, display_label: e.target.value })} />
        <select style={field} value={form.reliability_grade} onChange={(e) => setForm({ ...form, reliability_grade: e.target.value })}>
          {['A', 'B', 'C', 'D', 'E', 'F'].map((g) => <option key={g}>{g}</option>)}
        </select>
        <button onClick={create} style={{ background: '#d4a017', color: '#000', borderRadius: 2, padding: '4px 10px', fontSize: 11, fontWeight: 600 }}>+ ADD SOURCE</button>
      </div>

      <div className="overflow-x-auto"><table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
        <thead><tr style={{ color: '#888', textAlign: 'left' }}>
          <th className="py-[3px] text-[9px] font-semibold">CODE</th>
          <th className="py-[3px] text-[9px] font-semibold">TYPE</th>
          <th className="py-[3px] text-[9px] font-semibold">LABEL</th>
          <th className="py-[3px] text-[9px] font-semibold">RELIABILITY</th>
          <th className="py-[3px] text-[9px] font-semibold">STATUS</th>
        </tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <td className="py-[2px]" style={{ color: '#d4a017' }}>{s.source_code}</td>
              <td className="py-[2px]">{s.source_type}{s._restricted && <span style={{ color: '#888' }}> 🔒</span>}</td>
              <td className="py-[2px]">{s.display_label || '—'}</td>
              <td className="py-[2px]">{s.reliability_grade || '—'}</td>
              <td className="py-[2px] uppercase">{s.status}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="py-3 text-center" style={{ color: 'var(--rmpg-500)' }}>No sources.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
