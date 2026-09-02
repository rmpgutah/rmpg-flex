import { useEffect, useState, useCallback } from 'react';
import { X, Save, Lock, Unlock, History, Printer, Loader2, RotateCcw } from 'lucide-react';
import NoteComposer from '../dispatch/components/NoteComposer';
import { renderFormattedText } from '../../utils/renderFormatted';
import { docsApi, canEditDocument } from './useDocuments';
import type { DocRecord, DocRevisionMeta } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ToastProvider';
import ConfirmDialog from '../../components/ConfirmDialog';
import { parseTimestamp } from '../../utils/dateUtils';
import { toDisplayLabel } from '../../utils/formatters';
import { importWithRetry } from '../../utils/importWithRetry';

interface Props {
  documentId: number;
  onClose: () => void;
  onChanged?: () => void; // fired after save/finalize/reopen/delete so lists can refresh
}

export default function DocumentEditor({ documentId, onClose, onChanged }: Props) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const fmtWhen = (s: string) => { const d = parseTimestamp(s); return isNaN(d.getTime()) ? s : d.toLocaleString(); };
  const [doc, setDoc] = useState<DocRecord | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [revisions, setRevisions] = useState<DocRevisionMeta[]>([]);
  const [discardOpen, setDiscardOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await docsApi.get(documentId);
      setDoc(d);
      setTitle(d.title);
      setBody(d.body || '');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to load document', 'error');
    }
  }, [documentId, addToast]);

  useEffect(() => { void load(); }, [load]);

  const editable = doc ? canEditDocument(doc, user) : false;
  const dirty = !!doc && (title !== doc.title || body !== (doc.body || ''));

  const save = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const updated = await docsApi.save(doc.id, { title: title.trim(), body });
      setDoc(updated);
      setTitle(updated.title);
      setBody(updated.body || '');
      addToast('Saved', 'success');
      onChanged?.();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally { setBusy(false); }
  };

  const finalize = async () => {
    if (!doc) return;
    if (dirty) { addToast('Save before finalizing', 'error'); return; }
    setBusy(true);
    try { setDoc(await docsApi.finalize(doc.id)); addToast('Finalized', 'success'); onChanged?.(); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Finalize failed', 'error'); }
    finally { setBusy(false); }
  };

  const reopen = async () => {
    if (!doc) return;
    setBusy(true);
    try { setDoc(await docsApi.reopen(doc.id)); addToast('Reopened', 'success'); onChanged?.(); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Reopen failed', 'error'); }
    finally { setBusy(false); }
  };

  const openRevisions = async () => {
    if (!doc) return;
    try { setRevisions(await docsApi.revisions(doc.id)); setShowRevisions(true); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Failed to load revisions', 'error'); }
  };

  const restore = async (rev: number) => {
    if (!doc) return;
    setBusy(true);
    try {
      const updated = await docsApi.restore(doc.id, rev);
      setDoc(updated); setTitle(updated.title); setBody(updated.body || '');
      setShowRevisions(false); addToast(`Restored r${rev}`, 'success'); onChanged?.();
    } catch (e) { addToast(e instanceof Error ? e.message : 'Restore failed', 'error'); }
    finally { setBusy(false); }
  };

  const exportPdf = async () => {
    if (!doc || busy) return;
    setBusy(true);
    try {
      const { generateDocumentPdf } = await importWithRetry(() => import('../../utils/documentPdf'));
      generateDocumentPdf({ ...doc, title, body });
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'PDF export failed', 'error');
    } finally { setBusy(false); }
  };

  if (!doc) {
    return (
      <div className="flex items-center justify-center p-8 text-fg-muted">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-deep relative">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default flex-shrink-0">
        <input
          className="input-dark flex-1 text-sm font-semibold"
          value={title}
          disabled={!editable}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Document title"
        />
        <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-bold ${doc.status === 'finalized' ? 'text-white bg-brand-600' : '[color:var(--panel-header-color)] border [border-color:var(--field-label-color)]/40'}`}>
          {toDisplayLabel(doc.status)}
        </span>
        <span className="text-[9px] text-rmpg-500 font-mono">r{doc.revision}</span>
        <button type="button" aria-label="Revisions" title="Revisions" className="toolbar-btn p-1" onClick={openRevisions}><History className="w-3.5 h-3.5" /></button>
        <button type="button" aria-label="Export PDF" title="Export PDF" className="toolbar-btn p-1" onClick={exportPdf}><Printer className="w-3.5 h-3.5" /></button>
        <button type="button" aria-label="Close" title="Close" className="toolbar-btn p-1" onClick={() => { if (dirty) { setDiscardOpen(true); return; } onClose(); }}><X className="w-3.5 h-3.5" /></button>
      </div>

      {/* Toolbar row */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-default flex-shrink-0">
        <button type="button" aria-pressed={!preview} className={`text-[10px] px-2 py-0.5 rounded-sm ${!preview ? 'bg-surface-raised text-rmpg-100' : 'text-fg-muted'}`} onClick={() => setPreview(false)}>Edit</button>
        <button type="button" aria-pressed={preview} className={`text-[10px] px-2 py-0.5 rounded-sm ${preview ? 'bg-surface-raised text-rmpg-100' : 'text-fg-muted'}`} onClick={() => setPreview(true)}>Preview</button>
        <div className="flex-1" />
        {editable && (
          <button type="button" disabled={busy || !dirty} className="toolbar-btn toolbar-btn-primary text-[10px] px-2 py-0.5 flex items-center gap-1 disabled:opacity-40" onClick={save}>
            <Save className="w-3 h-3" /> Save
          </button>
        )}
        {editable && doc.status === 'draft' && (
          <button type="button" disabled={busy} className="toolbar-btn text-[10px] px-2 py-0.5 flex items-center gap-1" onClick={finalize}>
            <Lock className="w-3 h-3" /> Finalize
          </button>
        )}
        {doc.status === 'finalized' && (user?.role === 'admin' || user?.role === 'manager' || doc.owner_username === user?.username) && (
          <button type="button" disabled={busy} className="toolbar-btn text-[10px] px-2 py-0.5 flex items-center gap-1" onClick={reopen}>
            <Unlock className="w-3 h-3" /> Reopen
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {preview ? (
          <div className="text-rmpg-200 text-sm leading-relaxed whitespace-pre-wrap max-w-[850px] mx-auto">
            {body ? renderFormattedText(body) : <span className="text-rmpg-500">(empty)</span>}
          </div>
        ) : editable ? (
          <div className="max-w-[850px] mx-auto">
            <NoteComposer value={body} onChange={setBody} rows={24} maxLength={100000} placeholder="Write the document…" />
          </div>
        ) : (
          <div className="text-rmpg-200 text-sm leading-relaxed max-w-[850px] mx-auto">
            {body ? renderFormattedText(body) : <span className="text-rmpg-500">(empty)</span>}
            <p className="text-[10px] text-rmpg-500 mt-4">{doc.status === 'finalized' ? 'Finalized — reopen to edit.' : 'Read-only — you are not the owner.'}</p>
          </div>
        )}
      </div>

      {/* Revisions drawer */}
      {showRevisions && (
        <div className="absolute inset-0 bg-black/70 flex justify-end" onClick={() => setShowRevisions(false)}>
          <div className="w-[340px] h-full bg-surface-sunken border-l border-border-default p-3 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider [color:var(--panel-header-color)] font-semibold">Revision history</span>
              <button type="button" aria-label="Close revisions" className="toolbar-btn p-1" onClick={() => setShowRevisions(false)}><X className="w-3 h-3" /></button>
            </div>
            {revisions.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-1.5 border-b border-border-default text-[11px]">
                <span className="font-mono text-fg-muted w-8">r{r.revision_number}</span>
                <span className="flex-1 min-w-0 truncate text-rmpg-300" title={r.change_note || ''}>{r.saved_by_username || 'system'} · {fmtWhen(r.saved_at)}</span>
                {editable && (
                  <button type="button" aria-label={`Restore r${r.revision_number}`} title="Restore this revision" className="toolbar-btn p-1" onClick={() => restore(r.revision_number)}><RotateCcw className="w-3 h-3" /></button>
                )}
              </div>
            ))}
            {revisions.length === 0 && <p className="text-[10px] text-rmpg-500">No revisions.</p>}
          </div>
        </div>
      )}
      <ConfirmDialog
        isOpen={discardOpen}
        onClose={() => setDiscardOpen(false)}
        onConfirm={() => { setDiscardOpen(false); onClose(); }}
        title="Discard unsaved changes"
        message="Discard unsaved changes?"
        confirmLabel="Discard"
        confirmVariant="warning"
      />
    </div>
  );
}
