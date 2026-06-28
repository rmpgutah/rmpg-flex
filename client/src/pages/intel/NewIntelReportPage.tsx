// New raw intel report. Fixes the previously-dead "+ NEW REPORT" button and
// accepts ?from=<type>:<id>&label=<name> to pre-seed a report from a dossier.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';

const THREATS = ['low', 'medium', 'high', 'critical'];
const SOURCE_TYPES = ['officer_observation', 'confidential_informant', 'anonymous_tip', 'public', 'other_agency', 'osint', 'technical', 'victim', 'witness', 'suspect'];

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
  const [sourceType, setSourceType] = useState('officer_observation');
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
          source_type: sourceType,
        }),
      });
      // If launched from a dossier (?from=type:id), auto-link the entity so the
      // report shows it under Linked Entities. Best-effort — never block nav.
      const [fromType, fromId] = from.split(':');
      if (r?.id && fromType && fromId) {
        await apiFetch(`/intel/reports/${r.id}/links`, {
          method: 'POST',
          body: JSON.stringify({ entity_type: fromType, entity_id: Number(fromId), role: 'subject' }),
        }).catch(() => { /* link is a nicety, not a gate */ });
      }
      nav(`/intel/reports/${r.id}`);
    } catch {
      setErr('Failed to create report.'); setBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-3" style={{ background: 'var(--surface-base)', minHeight: '100%', color: 'var(--rmpg-200)' }}>
      <h1 className="text-sm font-semibold tracking-wide" style={{ color: '#d4a017' }}>NEW INTELLIGENCE REPORT</h1>
      {err && <div style={{ color: '#ef4444', fontSize: 11 }}>{err}</div>}

      <label className="block text-[10px] text-[#888] uppercase tracking-wider">Title
        <input aria-label="title" value={title} onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full bg-surface-overlay border border-border-default rounded-[2px] px-2 py-[6px] text-[12px] text-rmpg-200" />
      </label>

      <label className="block text-[10px] text-[#888] uppercase tracking-wider">Raw narrative
        <textarea aria-label="narrative" value={narrative} onChange={(e) => setNarrative(e.target.value)} rows={8}
          className="mt-1 w-full bg-surface-overlay border border-border-default rounded-[2px] px-2 py-[6px] text-[12px] text-rmpg-200" />
      </label>

      <label className="block text-[10px] text-[#888] uppercase tracking-wider">Source type
        <select aria-label="source type" value={sourceType} onChange={(e) => setSourceType(e.target.value)}
          className="mt-1 w-full bg-surface-overlay border border-border-default rounded-[2px] px-2 py-[6px] text-[12px] text-rmpg-200">
          {SOURCE_TYPES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
      </label>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#888] uppercase tracking-wider">Threat</span>
        {THREATS.map((t) => (
          <button key={t} onClick={() => setThreat(t)}
            className="px-2 py-1 text-[10px] uppercase rounded-[2px]"
            style={{ background: threat === t ? '#d4a017' : 'var(--surface-overlay)', color: threat === t ? '#000' : '#888' }}>{t}</button>
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
