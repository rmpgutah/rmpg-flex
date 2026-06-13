import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';
import { generateIntelProductPdf } from '../../utils/intelProductPdf';

const REL = ['A', 'B', 'C', 'D', 'E', 'F'];
const CRED = [1, 2, 3, 4, 5, 6];
const HANDLING = ['H1', 'H2', 'H3', 'H4', 'H5'];
const THREATS = ['low', 'medium', 'high', 'critical'];

const btn = (bg: string, fg = '#000'): React.CSSProperties => ({
  background: bg, color: fg, borderRadius: 2, padding: '4px 10px', fontSize: 11, fontWeight: 600,
});
const field: React.CSSProperties = { background: '#0b0b0b', color: '#ddd', border: '1px solid #232323', borderRadius: 2, padding: '4px 6px', fontSize: 11, width: '100%' };

export default function IntelReportDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = id === 'new';
  const [r, setR] = useState<any>(null);
  const [draft, setDraft] = useState<any>({ title: '', raw_narrative: '', threat_level: 'low', source_type: 'officer_observation' });
  const [grade, setGrade] = useState<any>({ source_reliability: 'B', info_credibility: 2, handling_code: 'H1' });
  const [analysis, setAnalysis] = useState<any>({ sanitized_narrative: '', assessment: '', criminal_predicate: '', threat_level: 'low' });
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    if (isNew) return;
    apiFetch<any>(`/intel/reports/${id}`).then(setR).catch(() => setMsg('Failed to load.'));
  }, [id, isNew]);
  useEffect(load, [load]);

  const act = async (path: string, body: unknown) => {
    setMsg('');
    try {
      const res = await apiFetch<any>(`/intel/reports/${id}${path}`, { method: 'POST', body: JSON.stringify(body) });
      if (res?.error) { setMsg(res.error); return; }
      load();
    } catch (e: any) { setMsg(e?.message || 'Action failed.'); }
  };

  const submit = async () => {
    setMsg('');
    if (!draft.title.trim()) { setMsg('Title required.'); return; }
    try {
      const res = await apiFetch<any>('/intel/reports', { method: 'POST', body: JSON.stringify(draft) });
      if (res?.id) nav(`/intel/reports/${res.id}`);
      else setMsg(res?.error || 'Submit failed.');
    } catch (e: any) { setMsg(e?.message || 'Submit failed.'); }
  };

  const wrap = (children: React.ReactNode) => (
    <div className="p-4 space-y-3" style={{ background: '#000', minHeight: '100%', color: '#ddd' }}>
      <button onClick={() => nav('/intel/reports')} style={{ color: '#888', fontSize: 11 }}>← Products</button>
      {msg && <div style={{ color: '#ef4444', fontSize: 11 }}>{msg}</div>}
      {children}
    </div>
  );

  if (isNew) {
    return wrap(
      <div className="space-y-2 max-w-2xl">
        <h1 className="text-sm font-semibold" style={{ color: '#d4a017' }}>NEW INTEL REPORT</h1>
        <input placeholder="Title" style={field} value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <select style={field} value={draft.source_type} onChange={(e) => setDraft({ ...draft, source_type: e.target.value })}>
          {['officer_observation', 'confidential_informant', 'anonymous_tip', 'public', 'other_agency', 'osint', 'technical', 'victim', 'witness', 'suspect'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <textarea placeholder="Raw narrative (restricted — source-identifying OK here)" rows={6} style={field}
          value={draft.raw_narrative} onChange={(e) => setDraft({ ...draft, raw_narrative: e.target.value })} />
        <select style={field} value={draft.threat_level} onChange={(e) => setDraft({ ...draft, threat_level: e.target.value })}>
          {THREATS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={submit} style={btn('#d4a017')}>SUBMIT REPORT</button>
      </div>,
    );
  }

  if (!r) return wrap(<div style={{ color: '#555' }}>Loading…</div>);

  return wrap(
    <div className="space-y-3 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold" style={{ color: '#d4a017' }}>
          {r.report_number} — {r.title}
        </h1>
        <span className="uppercase text-[11px]" style={{ color: '#888' }}>{r.status?.replace('_', ' ')}</span>
      </div>
      <div className="text-[11px]" style={{ color: '#aaa' }}>
        Grade: {r.grade_label} · Confidence: {r.confidence} · Handling: {r.handling_code || '—'} · Threat: {r.threat_level}
        {r.review_date && <> · Review: {r.review_date}</>}
      </div>

      {r.raw_narrative != null && (
        <div>
          <div className="text-[9px] font-semibold" style={{ color: '#888' }}>RAW NARRATIVE (RESTRICTED)</div>
          <div className="text-[11px] p-2" style={{ background: '#0b0b0b', borderRadius: 2 }}>{r.raw_narrative || '—'}</div>
        </div>
      )}
      {r.sanitized_narrative && (
        <div>
          <div className="text-[9px] font-semibold" style={{ color: '#888' }}>SANITIZED PRODUCT</div>
          <div className="text-[11px] p-2" style={{ background: '#0b0b0b', borderRadius: 2 }}>{r.sanitized_narrative}</div>
        </div>
      )}

      {/* Stage actions */}
      {['submitted', 'under_evaluation'].includes(r.status) && (
        <div className="space-y-2 p-2" style={{ border: '1px solid #232323', borderRadius: 2 }}>
          <div className="text-[9px] font-semibold" style={{ color: '#d4a017' }}>EVALUATE — ASSIGN 5×5×5 GRADE</div>
          <div className="flex gap-2">
            <select style={field} value={grade.source_reliability} onChange={(e) => setGrade({ ...grade, source_reliability: e.target.value })}>{REL.map((x) => <option key={x}>{x}</option>)}</select>
            <select style={field} value={grade.info_credibility} onChange={(e) => setGrade({ ...grade, info_credibility: Number(e.target.value) })}>{CRED.map((x) => <option key={x}>{x}</option>)}</select>
            <select style={field} value={grade.handling_code} onChange={(e) => setGrade({ ...grade, handling_code: e.target.value })}>{HANDLING.map((x) => <option key={x}>{x}</option>)}</select>
          </div>
          <button onClick={() => act('/evaluate', grade)} style={btn('#d4a017')}>GRADE</button>
        </div>
      )}

      {r.status === 'graded' && (
        <div className="space-y-2 p-2" style={{ border: '1px solid #232323', borderRadius: 2 }}>
          <div className="text-[9px] font-semibold" style={{ color: '#d4a017' }}>ANALYZE — SANITIZE + ASSESS</div>
          <textarea placeholder="Sanitized narrative (source protected)" rows={4} style={field}
            value={analysis.sanitized_narrative} onChange={(e) => setAnalysis({ ...analysis, sanitized_narrative: e.target.value })} />
          <textarea placeholder="Assessment / significance" rows={2} style={field}
            value={analysis.assessment} onChange={(e) => setAnalysis({ ...analysis, assessment: e.target.value })} />
          <input placeholder="Criminal predicate (28 CFR retention justification)" style={field}
            value={analysis.criminal_predicate} onChange={(e) => setAnalysis({ ...analysis, criminal_predicate: e.target.value })} />
          <button onClick={() => act('/analyze', analysis)} style={btn('#d4a017')}>SAVE ANALYSIS</button>
        </div>
      )}

      {r.status === 'analyzed' && (
        <button onClick={() => act('/disseminate', {})} style={btn('#22c55e')}>DISSEMINATE</button>
      )}

      {r.status === 'disseminated' && (
        <div className="flex gap-2">
          <button onClick={() => generateIntelProductPdf({
            report_number: r.report_number, title: r.title, grade_label: r.grade_label,
            handling_code: r.handling_code, threat_level: r.threat_level,
            sanitized_narrative: r.sanitized_narrative, assessment: r.assessment,
            disseminated_at: r.disseminated_at, links: r.links || [],
          })} style={btn('#0b0b0b', '#d4a017')}>EXPORT PDF</button>
          <button onClick={() => { const reason = prompt('Recall reason:'); if (reason) act('/recall', { reason }); }}
            style={btn('#0b0b0b', '#ef4444')}>RECALL</button>
        </div>
      )}

      {['submitted', 'under_evaluation', 'graded'].includes(r.status) && (
        <button onClick={() => { const reason = prompt('Reject reason:'); if (reason) act('/reject', { reason }); }}
          style={btn('#0b0b0b', '#ef4444')}>REJECT</button>
      )}
    </div>,
  );
}
