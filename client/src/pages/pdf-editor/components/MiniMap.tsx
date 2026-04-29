import { useEffect, useRef, useState } from 'react';
import { Map as MapIcon, X } from 'lucide-react';
import { open as openPdf, BackendUnsupportedError } from '../../../lib/rmpg-pdf-engine';
import { PageMeta } from '../types';

// Compact page navigator card — vertical strip of mini thumbnails for the
// document's pages, highlighting the active page and supporting click-to-jump.
//
// Sits as a floating draggable-by-handle card in the bottom-right corner so
// it doesn't compete with the full ThumbnailSidebar (which already lives at
// the left and shows larger thumbnails with edit affordances). The mini-map
// is purely a navigator: small footprint, fast scan of where you are in
// long documents.

interface Props {
  pdfBytes: Uint8Array | null;
  pages: PageMeta[];
  pageOrder: number[];
  activePage: number;
  onJumpTo: (visualIdx: number) => void;
  onClose: () => void;
}

const THUMB_WIDTH = 60; // CSS px
const RENDER_SCALE = 0.12;

export default function MiniMap({ pdfBytes, pages, pageOrder, activePage, onJumpTo, onClose }: Props) {
  const refs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Render thumbnails — uses the engine's facade so behavior matches the
  // main page renderer (native first, PDF.js fallback as needed).
  useEffect(() => {
    if (!pdfBytes || pageOrder.length === 0) return;
    let cancelled = false;
    (async () => {
      let pdf;
      try { pdf = await openPdf(pdfBytes); }
      catch (err) {
        if (!(err instanceof BackendUnsupportedError)) { console.error('Mini-map open failed', err); return; }
        try { pdf = await openPdf(pdfBytes, { backend: 'pdfjs' }); } catch { return; }
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
            await page.render({ scale: RENDER_SCALE, canvas });
          } catch (renderErr) {
            if (usingFallback) continue;
            console.warn(`[mini-map] native render failed on page ${original}, switching to PDF.js`, renderErr);
            try { await pdf.destroy(); } catch { /* ignore */ }
            try { pdf = await openPdf(pdfBytes, { backend: 'pdfjs' }); usingFallback = true; } catch { return; }
            try {
              const page = await pdf.getPage(original);
              await page.render({ scale: RENDER_SCALE, canvas });
            } catch { /* give up */ }
          }
        }
      } finally {
        await pdf.destroy();
      }
    })();
    return () => { cancelled = true; };
  }, [pdfBytes, pageOrder]);

  // Auto-scroll to keep the active page visible inside the strip.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(`[data-mini-page="${activePage}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activePage]);

  return (
    <div className="fixed bottom-4 right-4 z-30 bg-[#0d0d0d] border border-[#222] rounded-[2px] shadow-lg">
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[#222] cursor-default">
        <MapIcon className="w-3 h-3 text-[#d4a017]" />
        <span className="text-[10px] uppercase tracking-wider text-rmpg-300 font-semibold">Page navigator</span>
        <span className="text-[10px] text-rmpg-500">{activePage} / {pageOrder.length}</span>
        <button type="button" onClick={() => setCollapsed(c => !c)}
          className="ml-auto text-[10px] text-rmpg-400 hover:text-white px-1"
          title={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? '▴' : '▾'}</button>
        <button type="button" onClick={onClose} className="text-rmpg-400 hover:text-white p-0.5"
          aria-label="Close mini-map"><X className="w-3 h-3" /></button>
      </div>
      {!collapsed && (
        <div ref={containerRef} className="p-1.5 max-h-[55vh] overflow-y-auto space-y-1">
          {pageOrder.map((original, idx) => {
            const visualPageNumber = idx + 1;
            const active = visualPageNumber === activePage;
            const meta = pages[idx];
            return (
              <button
                key={`mini-${idx}`}
                type="button"
                data-mini-page={visualPageNumber}
                onClick={() => onJumpTo(idx)}
                title={`Jump to page ${visualPageNumber}`}
                className={`block w-[${THUMB_WIDTH}px] mx-auto p-0.5 rounded-sm border ${active ? 'border-[#d4a017]' : 'border-[#222] hover:border-[#444]'}`}
                style={{ width: THUMB_WIDTH }}
              >
                <div className="bg-white aspect-[3/4] flex items-center justify-center overflow-hidden">
                  {original === 0 ? (
                    <span className="text-[8px] text-gray-400">Blank</span>
                  ) : (
                    <canvas
                      ref={(el) => { if (el) refs.current.set(idx, el); else refs.current.delete(idx); }}
                      style={{ transform: `rotate(${meta?.rotation ?? 0}deg)`, maxWidth: '100%', maxHeight: '100%' }}
                    />
                  )}
                </div>
                <div className={`text-[9px] text-center mt-0.5 ${active ? 'text-[#d4a017] font-semibold' : 'text-rmpg-500'}`}>
                  {visualPageNumber}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
