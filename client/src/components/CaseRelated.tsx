// Related-cases section for the case detail Overview tab (v2 Phase 4).
// Links cases to each other (series / parent-child / related) via
// /api/cases/:id/related; displays from caseFull.related.
import { useState } from 'react';
import { Link as LinkIcon, Unlink, Loader2, Search, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from './PanelTitleBar';
import IconButton from './IconButton';
import { useToast } from './ToastProvider';
import { toDisplayLabel } from '../utils/formatters';

export interface RelatedCase {
  id: number;
  case_number?: string;
  title?: string;
  status?: string;
  link_type?: string;
}

const LINK_TYPES = ['related', 'series', 'parent', 'child'] as const;

export function CaseRelatedSection({ caseId, related, onChanged }: {
  caseId: number;
  related: RelatedCase[];
  onChanged: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<RelatedCase[]>([]);
  const [searching, setSearching] = useState(false);
  const [linkType, setLinkType] = useState<string>('related');
  const { addToast } = useToast();

  const search = async () => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const r = await apiFetch<any>(`/cases?search=${encodeURIComponent(q)}&limit=20`);
      const rows: RelatedCase[] = Array.isArray(r) ? r : (r?.data || []);
      setResults(rows.filter((x) => x.id !== caseId));
    } catch { setResults([]); }
    finally { setSearching(false); }
  };

  const link = async (relatedCaseId: number) => {
    try {
      await apiFetch(`/cases/${caseId}/related`, { method: 'POST', body: JSON.stringify({ related_case_id: relatedCaseId, link_type: linkType }) });
      addToast('Case linked', 'success');
      setModalOpen(false); setQ(''); setResults([]);
      onChanged();
    } catch (e) { addToast(e instanceof Error ? e.message : 'Link failed', 'error'); }
  };

  const unlink = async (relatedCaseId: number) => {
    try {
      await apiFetch(`/cases/${caseId}/related/${relatedCaseId}`, { method: 'DELETE' });
      addToast('Case unlinked', 'success');
      onChanged();
    } catch (e) { addToast(e instanceof Error ? e.message : 'Unlink failed', 'error'); }
  };

  return (
    <div className="panel-beveled p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-mono text-fg-secondary uppercase">Related Cases ({related.length})</div>
        <button type="button" onClick={() => setModalOpen(true)} className="toolbar-btn text-[10px]">
          <LinkIcon style={{ width: 10, height: 10 }} /> Link case
        </button>
      </div>

      {related.length === 0 ? (
        <div className="text-[10px] text-fg-muted py-2">No related cases linked</div>
      ) : (
        <div className="space-y-1">
          {related.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-[10px]">
              <span className="text-[8px] font-bold uppercase px-1 py-0.5 border border-brand-600/40 text-brand-300">{r.link_type || 'related'}</span>
              <span className="font-mono font-bold text-rmpg-100">{r.case_number || `#${r.id}`}</span>
              <span className="text-rmpg-300 min-w-0 truncate flex-1">{r.title || ''}</span>
              <IconButton onClick={() => unlink(r.id)} className="text-red-400 hover:text-red-300 flex-shrink-0" aria-label="Unlink case"><Unlink style={{ width: 11, height: 11 }} /></IconButton>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="panel-surface w-full max-w-md mx-4">
            <PanelTitleBar title="Link Related Case" icon={LinkIcon}>
              <IconButton onClick={() => { setModalOpen(false); setResults([]); setQ(''); }} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <select value={linkType} onChange={(e) => setLinkType(e.target.value)} aria-label="Link type"
                  className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-1.5 outline-none">
                  {LINK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()}
                  placeholder="Search cases (number / title)..." aria-label="Search cases"
                  className="flex-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none" />
                <button type="button" onClick={search} disabled={searching} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {searching ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Searching" /> : <Search style={{ width: 11, height: 11 }} />}
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent space-y-1">
                {results.map((r) => (
                  <button type="button" key={r.id} onClick={() => link(r.id)}
                    className="w-full text-left px-3 py-2 border border-rmpg-700 hover:bg-rmpg-800/40 transition-colors">
                    <div className="text-[11px] font-bold text-rmpg-100">{r.case_number} — {r.title}</div>
                    <div className="text-[9px] text-fg-muted">{toDisplayLabel(r.status)}</div>
                  </button>
                ))}
                {results.length === 0 && q && !searching && <div className="text-[10px] text-fg-muted text-center py-4">No results</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
