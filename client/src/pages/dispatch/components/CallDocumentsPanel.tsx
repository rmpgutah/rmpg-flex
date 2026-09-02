import { useEffect, useState, useCallback } from 'react';
import { FileText, Plus, Link2, X, Loader2, Unlink } from 'lucide-react';
import DocumentEditor from '../../docs/DocumentEditor';
import { docsApi } from '../../docs/useDocuments';
import type { DocListItem } from '../../../types';
import { useToast } from '../../../components/ToastProvider';
import { toDisplayLabel } from '../../../utils/formatters';

interface Props {
  callId: number;
}

export default function CallDocumentsPanel({ callId }: Props) {
  const { addToast } = useToast();
  const [items, setItems] = useState<DocListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<DocListItem[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await docsApi.list({ targetType: 'call', targetId: callId }));
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to load documents', 'error');
    } finally { setLoading(false); }
  }, [callId, addToast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createLinked = async () => {
    try {
      const created = await docsApi.create({ title: 'Untitled document', links: [{ target_type: 'call', target_id: callId }] });
      setOpenId(created.id);
    } catch (e) { addToast(e instanceof Error ? e.message : 'Create failed', 'error'); }
  };

  const runSearch = async () => {
    try { setResults(await docsApi.list({ q: search || undefined, limit: 20 })); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Search failed', 'error'); }
  };

  const attach = async (docId: number) => {
    try { await docsApi.link(docId, 'call', callId); setAttaching(false); setSearch(''); setResults([]); await refresh(); addToast('Attached', 'success'); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Attach failed', 'error'); }
  };

  const detach = async (docId: number) => {
    try {
      const d = await docsApi.get(docId);
      const link = (d.links || []).find((l) => l.target_type === 'call' && l.target_id === callId);
      if (link) { await docsApi.unlink(docId, link.id); await refresh(); addToast('Detached', 'success'); }
      else { addToast('Link not found — already detached?', 'warning'); await refresh(); }
    } catch (e) { addToast(e instanceof Error ? e.message : 'Detach failed', 'error'); }
  };

  return (
    <div className="border-t border-rmpg-700 pt-3 flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <label className="field-label !flex items-center gap-1.5" style={{ color: 'var(--field-label-color)', fontSize: '9px', letterSpacing: '0.05em' }}>
          <FileText className="w-3 h-3" /> Documents
        </label>
        <div className="flex gap-1">
          <button type="button" className="toolbar-btn text-[9px] px-2 py-0.5 flex items-center gap-1" onClick={() => setAttaching(true)}><Link2 className="w-3 h-3" /> Attach</button>
          <button type="button" className="toolbar-btn toolbar-btn-primary text-[9px] px-2 py-0.5 flex items-center gap-1" onClick={createLinked}><Plus className="w-3 h-3" /> New</button>
        </div>
      </div>

      <div className="space-y-1 flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex items-center text-fg-muted text-[10px]"><Loader2 className="w-3 h-3 animate-spin mr-1" /> Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-fg-muted text-[10px] py-6 text-center">No documents linked to this call.</div>
        ) : items.map((d) => (
          <div key={d.id} className="group flex items-center gap-2 text-xs px-2 py-1.5 rounded-sm hover:bg-surface-raised" style={{ borderLeft: '2px solid var(--border-default)' }}>
            <FileText className="w-3 h-3 text-fg-muted shrink-0" />
            <button type="button" className="flex-1 min-w-0 truncate text-left text-rmpg-200 hover:text-rmpg-100" onClick={() => setOpenId(d.id)}>{d.title}</button>
            <span className={`text-[8px] uppercase ${d.status === 'finalized' ? 'text-[color:var(--field-label-color)]' : 'text-fg-muted'}`}>{toDisplayLabel(d.status)}</span>
            <button type="button" aria-label="Detach document" title="Detach" className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 p-1 text-fg-muted hover:text-[color:var(--sev-critical)]" onClick={() => detach(d.id)}><Unlink className="w-3 h-3" /></button>
          </div>
        ))}
      </div>

      {/* Attach existing */}
      {attaching && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setAttaching(false)}>
          <div className="w-full max-w-[480px] bg-surface-sunken border border-border-default rounded-[2px] p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-[color:var(--field-label-color)] font-semibold">Attach existing document</span>
              <button type="button" aria-label="Close" className="toolbar-btn p-1" onClick={() => setAttaching(false)}><X className="w-3 h-3" /></button>
            </div>
            <div className="flex gap-1 mb-2">
              <input className="input-dark flex-1 text-xs" placeholder="Search titles…" aria-label="Search documents to attach" value={search}
                onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }} />
              <button type="button" className="toolbar-btn text-xs px-2" onClick={runSearch}>Search</button>
            </div>
            <div className="max-h-[300px] overflow-y-auto space-y-1">
              {results.map((d) => (
                <button key={d.id} type="button" className="w-full flex items-center gap-2 text-xs px-2 py-1 rounded-sm hover:bg-surface-raised text-left" onClick={() => attach(d.id)}>
                  <FileText className="w-3 h-3 text-fg-muted" />
                  <span className="flex-1 min-w-0 truncate text-rmpg-200">{d.title}</span>
                  <span className="text-[8px] text-fg-muted">{toDisplayLabel(d.status)}</span>
                </button>
              ))}
              {results.length === 0 && <p className="text-[10px] text-fg-muted text-center py-4">Search to find a document.</p>}
            </div>
          </div>
        </div>
      )}

      {/* Editor overlay */}
      {openId != null && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="relative w-full max-w-[1000px] h-[88dvh] bg-[#000] border border-border-default rounded-[2px] overflow-hidden">
            <DocumentEditor documentId={openId} onClose={() => { setOpenId(null); void refresh(); }} onChanged={refresh} />
          </div>
        </div>
      )}
    </div>
  );
}
