import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { apiFetch } from '../../hooks/useApi';
import { generateIntelProductPdf } from '../../utils/intelProductPdf';
import { toDisplayLabel } from '../../utils/formatters';

const REL = ['A', 'B', 'C', 'D', 'E', 'F'];
const CRED = [1, 2, 3, 4, 5, 6];
const HANDLING = ['H1', 'H2', 'H3', 'H4', 'H5'];

const btn = (bg: string, fg = 'black'): React.CSSProperties => ({
  background: bg, color: fg, borderRadius: 2, padding: '4px 10px', fontSize: 11, fontWeight: 600,
});
const field: React.CSSProperties = { background: 'var(--surface-overlay)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: '4px 6px', fontSize: 11, width: '100%' };

export default function IntelReportDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [r, setR] = useState<any>(null);
  const [grade, setGrade] = useState<any>({ source_reliability: 'B', info_credibility: 2, handling_code: 'H1' });
  const [analysis, setAnalysis] = useState<any>({ sanitized_narrative: '', assessment: '', criminal_predicate: '' });
  const [linkDraft, setLinkDraft] = useState<any>({ entity_type: 'person', entity_id: '', role: 'subject' });
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    let cancelled = false;
    apiFetch<any>(`/intel/reports/${id}`)
      .then((d) => { if (!cancelled) setR(d); })
      .catch(() => { if (!cancelled) setMsg('Failed to load.'); });
    return () => { cancelled = true; };
  }, [id]);
  useEffect(() => load(), [load]);

  const act = async (path: string, body: unknown) => {
    setMsg('');
    try {
      const res = await apiFetch<any>(`/intel/reports/${id}${path}`, { method: 'POST', body: JSON.stringify(body) });
      if (res?.error) { setMsg(res.error); return; }
      load();
    } catch (e: any) { setMsg(e?.message || 'Action failed.'); }
  };

  const addLink = async () => {
    if (!linkDraft.entity_id) { setMsg('Entity ID required.'); return; }
    await act('/links', { entity_type: linkDraft.entity_type, entity_id: Number(linkDraft.entity_id), role: linkDraft.role });
    setLinkDraft({ ...linkDraft, entity_id: '' });
  };

  const removeLink = async (linkId: number) => {
    setMsg('');
    try {
      const res = await apiFetch<any>(`/intel/reports/${id}/links/${linkId}`, { method: 'DELETE' });
      if (res?.error) { setMsg(res.error); return; }
      load();
    } catch (e: any) { setMsg(e?.message || 'Remove failed.'); }
  };

  const linkPath = (t: string, eid: number) =>
    t === 'person' ? `/intel/person/${eid}` : t === 'vehicle' ? `/records?tab=vehicles&id=${eid}`
      : t === 'warrant' ? `/warrants?id=${eid}` : `/connections?type=${t}&id=${eid}`;

  const wrap = (children: React.ReactNode) => (
    <div className="p-4 space-y-3" style={{ background: 'var(--surface-base)', minHeight: '100%', color: 'var(--text-primary)' }}>
      <button onClick={() => nav('/intel/reports')} style={{ color: 'var(--text-muted)', fontSize: 11 }}>← Products</button>
      {msg && <div style={{ color: 'var(--sev-critical)', fontSize: 11 }}>{msg}</div>}
      {children}
    </div>
  );

  if (!r) return wrap(<div style={{ color: 'var(--text-muted)' }}>Loading…</div>);

  return wrap(
    <div className="space-y-3 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold" style={{ color: 'var(--panel-header-color)' }}>
          {r.report_number} — {r.title}
        </h1>
        <span className="uppercase text-[11px]" style={{ color: 'var(--text-muted)' }}>{toDisplayLabel(r.status)}</span>
      </div>
      <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        Grade: {r.grade_label} · Confidence: {r.confidence} · Handling: {r.handling_code || '—'} · Threat: {r.threat_level}
        {r.review_date && <> · Review: {r.review_date}</>}
      </div>

      {r.raw_narrative != null && (
        <div>
          <div className="text-[9px] font-semibold" style={{ color: 'var(--text-muted)' }}>RAW NARRATIVE (RESTRICTED)</div>
          <div className="text-[11px] p-2" style={{ background:"var(--surface-sunken)", borderRadius: 2 }}>{r.raw_narrative || '—'}</div>
        </div>
      )}
      {r.sanitized_narrative && (
        <div>
          <div className="text-[9px] font-semibold" style={{ color: 'var(--text-muted)' }}>SANITIZED PRODUCT</div>
          <div className="text-[11px] p-2" style={{ background:"var(--surface-sunken)", borderRadius: 2 }}>{r.sanitized_narrative}</div>
        </div>
      )}

      {/* Stage actions */}
      {['submitted', 'under_evaluation'].includes(r.status) && (
        <div className="space-y-2 p-2" style={{ border: '1px solid var(--border-subtle)', borderRadius: 2 }}>
          <div className="text-[9px] font-semibold" style={{ color: 'var(--panel-header-color)' }}>EVALUATE — ASSIGN 5×5×5 GRADE</div>
          <div className="flex gap-2">
            <select style={field} value={grade.source_reliability} onChange={(e) => setGrade({ ...grade, source_reliability: e.target.value })}>{REL.map((x) => <option key={x}>{x}</option>)}</select>
            <select style={field} value={grade.info_credibility} onChange={(e) => setGrade({ ...grade, info_credibility: Number(e.target.value) })}>{CRED.map((x) => <option key={x}>{x}</option>)}</select>
            <select style={field} value={grade.handling_code} onChange={(e) => setGrade({ ...grade, handling_code: e.target.value })}>{HANDLING.map((x) => <option key={x}>{x}</option>)}</select>
          </div>
          <button onClick={() => act('/evaluate', grade)} style={btn('var(--rmpg-600)', 'var(--text-primary)')}>GRADE</button>
        </div>
      )}

      {r.status === 'graded' && (
        <div className="space-y-2 p-2" style={{ border: '1px solid var(--border-subtle)', borderRadius: 2 }}>
          <div className="text-[9px] font-semibold" style={{ color: 'var(--panel-header-color)' }}>ANALYZE — SANITIZE + ASSESS</div>
          <textarea placeholder="Sanitized narrative (source protected)" rows={4} style={field}
            value={analysis.sanitized_narrative} onChange={(e) => setAnalysis({ ...analysis, sanitized_narrative: e.target.value })} />
          <textarea placeholder="Assessment / significance" rows={2} style={field}
            value={analysis.assessment} onChange={(e) => setAnalysis({ ...analysis, assessment: e.target.value })} />
          <input placeholder="Criminal predicate (28 CFR retention justification)" style={field}
            value={analysis.criminal_predicate} onChange={(e) => setAnalysis({ ...analysis, criminal_predicate: e.target.value })} />
          <button onClick={() => act('/analyze', analysis)} style={btn('var(--rmpg-600)', 'var(--text-primary)')}>SAVE ANALYSIS</button>
        </div>
      )}

      {r.status === 'analyzed' && (
        <button onClick={() => act('/disseminate', {})} style={btn('var(--rmpg-600)', 'var(--text-primary)')}>DISSEMINATE</button>
      )}

      {r.status === 'disseminated' && (
        <div className="flex gap-2">
          <button onClick={() => generateIntelProductPdf({
            report_number: r.report_number, title: r.title, grade_label: r.grade_label,
            handling_code: r.handling_code, threat_level: r.threat_level,
            sanitized_narrative: r.sanitized_narrative, assessment: r.assessment,
            disseminated_at: r.disseminated_at, links: r.links || [],
          })} style={btn('var(--surface-overlay)', 'var(--brand-400)')}>EXPORT PDF</button>
          {['H2', 'H3', 'H4'].includes(r.handling_code) && (
            <button onClick={() => {
              const recipient_label = prompt('Share with (agency / recipient):');
              if (!recipient_label) return;
              const reason = prompt('Reason for external share:') || '';
              act('/share', { recipient_label, reason, recipient_type: 'agency' });
            }} style={btn('var(--surface-overlay)', 'rgb(34 211 238)')}>SHARE EXTERNALLY</button>
          )}
          <button onClick={() => { const reason = prompt('Recall reason:'); if (reason) act('/recall', { reason }); }}
            style={btn('var(--surface-overlay)', 'var(--sev-critical)')}>RECALL</button>
        </div>
      )}

      {['submitted', 'under_evaluation', 'graded'].includes(r.status) && (
        <button onClick={() => { const reason = prompt('Reject reason:'); if (reason) act('/reject', { reason }); }}
          style={btn('var(--surface-overlay)', 'var(--sev-critical)')}>REJECT</button>
      )}

      {/* Linked entities */}
      <div className="space-y-2 p-2" style={{ border: '1px solid var(--border-subtle)', borderRadius: 2 }}>
        <div className="text-[9px] font-semibold" style={{ color: 'var(--panel-header-color)' }}>LINKED ENTITIES</div>
        {(r.links || []).length === 0 && <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>No linked entities.</div>}
        {(r.links || []).map((l: any) => (
          <div key={l.id} className="flex items-center gap-2 text-[11px]">
            <button onClick={() => nav(linkPath(l.entity_type, l.entity_id))} style={{ color: 'rgb(34 211 238)' }}>
              {l.entity_type} #{l.entity_id}
            </button>
            <span style={{ color: 'var(--text-muted)' }}>· {l.role}</span>
            <button onClick={() => removeLink(l.id)} style={{ color: 'var(--sev-critical)', marginLeft: 'auto', fontSize: 10 }}>remove</button>
          </div>
        ))}
        <div className="flex gap-2">
          <select style={field} value={linkDraft.entity_type} onChange={(e) => setLinkDraft({ ...linkDraft, entity_type: e.target.value })}>
            {['person', 'vehicle', 'warrant', 'case', 'incident', 'property'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input placeholder="ID" style={field} value={linkDraft.entity_id}
            onChange={(e) => setLinkDraft({ ...linkDraft, entity_id: e.target.value })} />
          <input placeholder="role" style={field} value={linkDraft.role}
            onChange={(e) => setLinkDraft({ ...linkDraft, role: e.target.value })} />
          <button onClick={addLink} style={btn('var(--surface-overlay)', 'var(--brand-400)')}>LINK</button>
        </div>
      </div>

      {/* Dissemination log (supervisor-only; server returns [] otherwise) */}
      {(r.dissemination || []).length > 0 && (
        <div className="space-y-1 p-2" style={{ border: '1px solid var(--border-subtle)', borderRadius: 2 }}>
          <div className="text-[9px] font-semibold" style={{ color: 'var(--panel-header-color)' }}>DISSEMINATION LOG</div>
          {r.dissemination.map((d: any) => (
            <div key={d.id} className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              {d.channel} → {d.recipient_label || `user #${d.recipient_id}`}{d.reason ? ` · ${d.reason}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>,
  );
}
