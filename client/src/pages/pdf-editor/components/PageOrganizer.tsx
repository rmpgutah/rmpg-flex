import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, X, Trash2, RotateCw, RotateCcw, CheckSquare, Square } from 'lucide-react';
import { open as openPdf, BackendUnsupportedError } from '../../../lib/rmpg-pdf-engine';
import IconButton from '../../../components/IconButton';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { PageMeta } from '../types';

interface Props {
  open: boolean;
  pdfBytes: Uint8Array | null;
  pages: PageMeta[];
  pageOrder: number[];
  onClose: () => void;
  /** Move a page from visual index `from` to `to` (caller remaps annotations). */
  onReorder: (from: number, to: number) => void;
  /** Rotate the given visual indices 90° clockwise (dir +1) or CCW (-1). */
  onBulkRotate: (indices: number[], dir: 1 | -1) => void;
  /** Delete the given visual indices (caller handles annotation/bookmark remap). */
  onBulkDelete: (indices: number[]) => void;
}

/**
 * Full-screen page organizer — a large-thumbnail grid of every page with
 * drag-to-reorder, multi-select, and bulk rotate / delete. Complements the
 * narrow thumbnail rail for documents where you need to reshuffle many pages
 * at once. All mutations route back through the editor's history-aware
 * callbacks so undo/redo + annotation remapping stay correct.
 */
export default function PageOrganizer({ open, pdfBytes, pages, pageOrder, onClose, onReorder, onBulkRotate, onBulkDelete }: Props) {
  const refs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Reset selection whenever the dialog opens or the page set changes shape.
  useEffect(() => { if (open) setSelected(new Set()); }, [open, pageOrder.length]);

  // Render thumbnails when open. Mirrors ThumbnailSidebar's native→pdfjs
  // fallback so encrypted / exotic docs still preview here.
  useEffect(() => {
    if (!open || !pdfBytes || pageOrder.length === 0) return;
    let cancelled = false;
    (async () => {
      let pdf;
      try { pdf = await openPdf(pdfBytes); }
      catch (err) {
        if (!(err instanceof BackendUnsupportedError)) { console.error('Organizer open failed', err); return; }
        try { pdf = await openPdf(pdfBytes, { backend: 'pdfjs' }); }
        catch (err2) { console.error('Organizer PDF.js fallback failed', err2); return; }
      }
      let usingFallback = pdf.backend === 'pdfjs';
      try {
        for (let i = 0; i < pageOrder.length; i++) {
          if (cancelled) return;
          const original = pageOrder[i];
          if (original === 0) continue;
          const canvas = refs.current.get(i);
          if (!canvas) continue;
          try {
            const page = await pdf.getPage(original);
            await page.render({ scale: 0.4, canvas });
          } catch (renderErr) {
            if (usingFallback) continue;
            try { await pdf.destroy(); } catch { /* ignore */ }
            try { pdf = await openPdf(pdfBytes, { backend: 'pdfjs' }); usingFallback = true; }
            catch { return; }
            try { const page = await pdf.getPage(original); await page.render({ scale: 0.4, canvas }); }
            catch { /* give up on this thumb */ }
          }
        }
      } finally { await pdf.destroy(); }
    })();
    return () => { cancelled = true; };
  }, [open, pdfBytes, pageOrder]);

  if (!open) return null;

  const toggle = (idx: number) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });
  const allSelected = selected.size === pageOrder.length && pageOrder.length > 0;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(pageOrder.map((_, i) => i)));
  const targets = () => [...selected].sort((a, b) => a - b);

  return (
    <>
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80" onClick={onClose}>
      <div className="m-auto bg-surface-sunken border border-border-default rounded-[2px] w-[min(1100px,94vw)] h-[min(86vh,900px)] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default">
          <div className="text-[11px] uppercase tracking-wider [color:var(--panel-header-color)] font-semibold inline-flex items-center gap-1.5">
            <LayoutGrid className="w-3.5 h-3.5" /> Page organizer — {pageOrder.length} page{pageOrder.length === 1 ? '' : 's'}
          </div>
          <IconButton onClick={onClose} aria-label="Close organizer" title="Close" className="text-rmpg-400 hover:text-rmpg-100 p-1"><X className="w-4 h-4" /></IconButton>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-border-default text-[10px] text-rmpg-300">
          <button type="button" onClick={toggleAll} className="inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-border-default hover:text-rmpg-100">
            {allSelected ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />} {allSelected ? 'Deselect all' : 'Select all'}
          </button>
          <span className="[color:var(--panel-header-color)]">{selected.size} selected</span>
          <div className="flex-1" />
          <button type="button" disabled={selected.size === 0} onClick={() => onBulkRotate(targets(), -1)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-border-default hover:text-rmpg-100 disabled:opacity-30"><RotateCcw className="w-3 h-3" /> Rotate CCW</button>
          <button type="button" disabled={selected.size === 0} onClick={() => onBulkRotate(targets(), 1)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-border-default hover:text-rmpg-100 disabled:opacity-30"><RotateCw className="w-3 h-3" /> Rotate CW</button>
          <button type="button" disabled={selected.size === 0 || selected.size >= pageOrder.length}
            onClick={() => setDeleteOpen(true)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-red-900/40 text-red-300 hover:bg-red-900/20 disabled:opacity-30"><Trash2 className="w-3 h-3" /> Delete</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            {pageOrder.map((original, idx) => {
              const meta = pages[idx];
              const isSel = selected.has(idx);
              const isDrop = dropIdx === idx && dragIdx !== idx;
              return (
                <div key={`org-${idx}`}
                  draggable
                  onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); }}
                  onDragOver={(e) => { if (dragIdx === null || dragIdx === idx) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropIdx(idx); }}
                  onDragLeave={() => { if (dropIdx === idx) setDropIdx(null); }}
                  onDrop={(e) => { e.preventDefault(); if (dragIdx !== null && dragIdx !== idx) onReorder(dragIdx, idx); setDragIdx(null); setDropIdx(null); }}
                  onDragEnd={() => { setDragIdx(null); setDropIdx(null); }}
                  onClick={() => toggle(idx)}
                  className={`relative rounded-sm border p-1.5 cursor-pointer bg-black select-none ${
                    isDrop ? '[border-color:var(--field-label-color)] border-dashed bg-[#d4a017]/10' :
                    isSel ? '[border-color:var(--field-label-color)] ring-1 ring-[#d4a017]' : 'border-border-default hover:border-rmpg-600'
                  } ${dragIdx === idx ? 'opacity-40' : ''}`}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); toggle(idx); }}
                    aria-label={isSel ? `Deselect page ${idx + 1}` : `Select page ${idx + 1}`}
                    className={`absolute top-2 left-2 z-10 w-4 h-4 rounded-sm border flex items-center justify-center text-[9px] ${isSel ? 'bg-[#d4a017] [border-color:var(--field-label-color)] text-black' : 'bg-black/70 border-[#555] text-transparent'}`}>✓</button>
                  <div className="bg-white aspect-[3/4] flex items-center justify-center overflow-hidden rounded-sm">
                    {original === 0 ? (
                      <div className="text-[10px] text-rmpg-400">Blank</div>
                    ) : (
                      <canvas ref={(el) => { if (el) refs.current.set(idx, el); else refs.current.delete(idx); }}
                        style={{ transform: `rotate(${meta?.rotation ?? 0}deg)`, maxWidth: '100%', maxHeight: '100%' }} />
                    )}
                  </div>
                  <div className="text-[10px] text-rmpg-300 text-center mt-1">Page {idx + 1}{meta?.rotation ? ` · ${meta.rotation}°` : ''}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-4 py-2 border-t border-border-default text-[9px] text-rmpg-600">
          Drag a page onto another to reorder · click a page to select · bulk-rotate or delete the selection from the toolbar above.
        </div>
      </div>
    </div>
    <ConfirmDialog
      isOpen={deleteOpen}
      onClose={() => setDeleteOpen(false)}
      onConfirm={() => {
        onBulkDelete(targets());
        setSelected(new Set());
        setDeleteOpen(false);
      }}
      title="Delete pages"
      message={`Delete ${selected.size} page(s)? This cannot be undone from the organizer (use editor Undo after).`}
      confirmLabel="Delete"
      confirmVariant="danger"
    />
    </>
  );
}
