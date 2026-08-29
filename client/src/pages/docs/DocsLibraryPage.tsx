import { useEffect, useState, useCallback, useRef } from 'react';
import { FileText, Plus, Search, Loader2 } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import DocumentEditor from './DocumentEditor';
import { docsApi } from './useDocuments';
import type { DocListItem } from '../../types';
import { useToast } from '../../components/ToastProvider';
import { toDisplayLabel } from '../../utils/formatters';
import { useSlashFocus } from '../../hooks/useSlashFocus';
import { docsLibraryToCsv, downloadTextFile } from '../../utils/rmsListExport';

export default function DocsLibraryPage() {
  const { addToast } = useToast();
  const [items, setItems] = useState<DocListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'' | 'draft' | 'finalized'>('');
  const [openId, setOpenId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setItems(await docsApi.list({ q: q || undefined, mine, status: statusFilter || undefined }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load documents';
      setLoadError(msg);
      addToast(msg, 'error');
    } finally { setLoading(false); }
  }, [q, mine, statusFilter, addToast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createNew = async () => {
    try {
      const created = await docsApi.create({ title: 'Untitled document' });
      setOpenId(created.id);
    } catch (e) { addToast(e instanceof Error ? e.message : 'Create failed', 'error'); }
  };

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="DOCUMENTS LIBRARY" icon={FileText}>
        <button
          type="button"
          className="toolbar-btn"
          disabled={items.length === 0}
          onClick={() => downloadTextFile('docs-library.csv', docsLibraryToCsv(items.map((d) => ({
            id: d.id,
            title: d.title,
            status: d.status,
            revision: d.revision,
            updated_at: d.updated_at,
          }))))}
        >CSV</button>
      </PanelTitleBar>

      {loadError && (
        <div className="p-3 text-xs text-red-400 flex items-center justify-between">
          <span>{loadError}</span>
          <button type="button" className="toolbar-btn" onClick={() => { void refresh(); }}>Retry</button>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" />
          <input ref={searchRef} className="input-dark w-full text-xs pl-7" placeholder="Search titles… (/)" value={q}
            onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-1 text-[10px] text-[#888]">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine
        </label>
        <select className="input-dark text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | 'draft' | 'finalized')}>
          <option value="">All</option>
          <option value="draft">Draft</option>
          <option value="finalized">Finalized</option>
        </select>
        <button type="button" className="toolbar-btn toolbar-btn-primary text-xs px-3 py-1 flex items-center gap-1" onClick={createNew}>
          <Plus className="w-3.5 h-3.5" /> New Document
        </button>
      </div>

      {loading ? (
        <div className="flex items-center text-[#888] text-xs"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-fg-muted text-xs py-8 text-center">
          {(q || mine || statusFilter) ? 'No documents match this filter' : 'No documents. Create one to get started.'}
        </div>
      ) : (
        <div className="overflow-x-auto"><table className="w-full text-left">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-[#888] border-b border-border-default">
              <th className="py-[3px] font-semibold">Title</th>
              <th className="py-[3px] font-semibold">Status</th>
              <th className="py-[3px] font-semibold">Owner</th>
              <th className="py-[3px] font-semibold">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id} className="text-[11px] border-b border-border-subtle hover:bg-surface-sunken cursor-pointer" onClick={() => setOpenId(d.id)}>
                <td className="py-[2px] text-rmpg-200">{d.title}</td>
                <td className="py-[2px]"><span className={d.status === 'finalized' ? '[color:var(--panel-header-color)]' : 'text-[#888]'}>{toDisplayLabel(d.status)}</span></td>
                <td className="py-[2px] text-[#888]">{d.owner_username || '—'}</td>
                <td className="py-[2px] text-rmpg-500 font-mono">{d.updated_at || d.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

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
