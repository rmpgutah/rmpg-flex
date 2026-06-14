// New raw intel report. Fixes the previously-dead "+ NEW REPORT" button and
// accepts ?from=<type>:<id>&label=<name> to pre-seed a report from a dossier.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';

const THREATS = ['low', 'medium', 'high', 'critical'];

export default function NewIntelReportPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const from = sp.get('from') || '';
  const label = sp.get('label') || '';

  const initialTitle = useMemo(() => (label ? `Subject of interest — ${label}` : ''), [label]);
  const initialNarrative = useMemo(
    () => (from && label ? `Report initiated from ${from.split(':')[0]} "${label}" (${from}).\n\n` : ''),
    [from, label],
  );

  const [title, setTitle] = useState(initialTitle);
  const [narrative, setNarrative] = useState(initialNarrative);
  const [threat, setThreat] = useState('low');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!title.trim()) { setErr('Title is required.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await apiFetch<{ id: number }>('/intel/reports', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          raw_narrative: narrative.trim(),
          threat_level: threat,
          classification: 'law_enforcement_sensitive',
          source_type: from ? 'field' : 'manual',
        }),
      });
      nav(`/intel/reports/${r.id}`);
    } catch {
      setErr('Failed to create report.'); setBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-3" style={{ background: '#000', minHeight: '100%', color: '#ddd' }}>
      <h1 className="text-sm font-semibold tracking-wide" style={{ color: '#d4a017' }}>NEW INTELLIGENCE REPORT</h1>
      {err && <div style={{ color: '#ef4444', fontSize: 11 }}>{err}</div>}

      <label className="block text-[10px] text-[#888] uppercase tracking-wider">Title
        <input aria-label="title" value={title} onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full bg-[#070707] border border-[#232323] rounded-[2px] px-2 py-[6px] text-[12px] text-[#e8e8e8]" />
      </label>

      <label className="block text-[10px] text-[#888] uppercase tracking-wider">Raw narrative
        <textarea aria-label="narrative" value={narrative} onChange={(e) => setNarrative(e.target.value)} rows={8}
          className="mt-1 w-full bg-[#070707] border border-[#232323] rounded-[2px] px-2 py-[6px] text-[12px] text-[#e8e8e8]" />
      </label>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#888] uppercase tracking-wider">Threat</span>
        {THREATS.map((t) => (
          <button key={t} onClick={() => setThreat(t)}
            className="px-2 py-1 text-[10px] uppercase rounded-[2px]"
            style={{ background: threat === t ? '#d4a017' : '#0b0b0b', color: threat === t ? '#000' : '#888' }}>{t}</button>
        ))}
      </div>

      <div className="flex gap-2 pt-1">
        <button disabled={busy} onClick={submit}
          className="px-3 py-1 text-xs font-semibold" style={{ background: '#d4a017', color: '#000', borderRadius: 2 }}>
          {busy ? 'Submitting…' : 'Submit report'}
        </button>
        <button onClick={() => nav('/intel/reports')} className="px-3 py-1 text-xs" style={{ color: '#888' }}>Cancel</button>
      </div>
    </div>
  );
}
