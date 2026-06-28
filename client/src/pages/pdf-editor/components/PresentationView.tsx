import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { openAndRenderPage } from '../../../lib/rmpg-pdf-engine';

// Full-screen, distraction-free presentation viewer. Renders one page at a
// time large-and-centered on a black field, with keyboard / on-screen page
// navigation. Read-only: no annotation tools, no chrome — purely for reviewing
// a document on a projector or a dispatch wall display.
//
// `pageOrder` maps the 1-indexed visual position to the ORIGINAL source page
// number (0 = inserted blank, which we render as a blank field).

interface Props {
  open: boolean;
  bytes: Uint8Array | null;
  pageOrder: number[];
  startPage: number;            // 1-indexed visual page to open on
  fileName: string;
  forcePdfjs?: boolean;
  onClose: () => void;
  /** Report the page we landed on so the editor's active page stays in sync. */
  onPageChange?: (visualPage: number) => void;
}

export default function PresentationView({ open, bytes, pageOrder, startPage, fileName, forcePdfjs, onClose, onPageChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(startPage);
  const [rendering, setRendering] = useState(false);
  const [blank, setBlank] = useState(false);
  const total = pageOrder.length;

  useEffect(() => { if (open) setPage(startPage); }, [open, startPage]);

  const go = useCallback((delta: number) => {
    setPage(p => Math.max(1, Math.min(total, p + delta)));
  }, [total]);

  // Render the active visual page whenever it changes.
  useEffect(() => {
    if (!open || !bytes) return;
    const original = pageOrder[page - 1];
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!original || original <= 0) { setBlank(true); return; }
    setBlank(false);
    let cancelled = false;
    setRendering(true);
    (async () => {
      try {
        // Render at a generous scale so the projected page stays crisp.
        const pdf = await openAndRenderPage(bytes, { pageNumber: original, scale: 2, canvas, forcePdfjs });
        await pdf.destroy().catch(() => { /* gone */ });
      } catch { /* leave previous frame */ }
      finally { if (!cancelled) setRendering(false); }
    })();
    onPageChange?.(page);
    return () => { cancelled = true; };
  }, [open, bytes, page, pageOrder, forcePdfjs, onPageChange]);

  // Keyboard navigation — arrows / space / Home / End / Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
      else if (e.key === 'Home') { e.preventDefault(); setPage(1); }
      else if (e.key === 'End') { e.preventDefault(); setPage(total); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, go, onClose, total]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col" role="dialog" aria-modal="true" aria-label="Presentation view">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-rmpg-400 bg-surface-overlay border-b border-border-default">
        <span className="text-[#d4a017] font-semibold uppercase tracking-wider">Presenting</span>
        <span className="truncate">{fileName}</span>
        <span className="ml-auto">Page {page} / {total}</span>
        <button type="button" onClick={onClose} aria-label="Exit presentation (Esc)" title="Exit (Esc)"
          className="p-1 text-rmpg-400 hover:text-rmpg-100"><X className="w-4 h-4" /></button>
      </div>

      <div className="flex-1 relative flex items-center justify-center overflow-auto p-4 select-none">
        <button type="button" onClick={() => go(-1)} disabled={page <= 1} aria-label="Previous page"
          className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-sm bg-surface-base/70 text-rmpg-300 hover:text-rmpg-100 disabled:opacity-20 z-10">
          <ChevronLeft className="w-6 h-6" />
        </button>

        {blank
          ? <div className="bg-white" style={{ width: 612, height: 792 }} aria-label="Blank page" />
          : <canvas ref={canvasRef} className={`bg-white shadow-2xl max-h-full ${rendering ? 'opacity-70' : ''}`} style={{ maxWidth: '100%', height: 'auto' }} />}

        <button type="button" onClick={() => go(1)} disabled={page >= total} aria-label="Next page"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-sm bg-surface-base/70 text-rmpg-300 hover:text-rmpg-100 disabled:opacity-20 z-10">
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>

      <div className="px-3 py-1 text-[9px] text-rmpg-600 text-center bg-surface-overlay border-t border-border-default">
        ← / → navigate · Space next · Home / End jump · Esc exits
      </div>
    </div>
  );
}
