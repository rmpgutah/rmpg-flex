import { useEffect, useRef } from 'react';
import { Trash2, RotateCw, ArrowUp, ArrowDown, FilePlus2, FileOutput, Crop } from 'lucide-react';
import { open as openPdf } from '../../../lib/rmpg-pdf-engine';
import IconButton from '../../../components/IconButton';
import { PageMeta } from '../types';

interface Props {
  pdfBytes: Uint8Array | null;
  pages: PageMeta[];
  pageOrder: number[];
  activePage: number;
  onJumpTo: (visualIdx: number) => void;
  onMove: (visualIdx: number, direction: -1 | 1) => void;
  onRotate: (visualIdx: number) => void;
  onDelete: (visualIdx: number) => void;
  onInsertBlank: (afterVisualIdx: number) => void;
  onExtract?: (visualIdx: number) => void;
  onClearCrop?: (visualIdx: number) => void;
}

export default function ThumbnailSidebar({ pdfBytes, pages, pageOrder, activePage, onJumpTo, onMove, onRotate, onDelete, onInsertBlank, onExtract, onClearCrop }: Props) {
  const refs = useRef<Map<number, HTMLCanvasElement>>(new Map());

  useEffect(() => {
    if (!pdfBytes || pageOrder.length === 0) return;
    let cancelled = false;
    (async () => {
      const pdf = await openPdf(pdfBytes);
      try {
        for (let i = 0; i < pageOrder.length; i++) {
          if (cancelled) return;
          const original = pageOrder[i];
          if (original === 0) continue; // inserted blank page
          const canvas = refs.current.get(i);
          if (!canvas) continue;
          try {
            const page = await pdf.getPage(original);
            await page.render({ scale: 0.18, canvas });
          } catch {
            // ignore — page deleted/missing/unsupported
          }
        }
      } finally {
        await pdf.destroy();
      }
    })();
    return () => { cancelled = true; };
  }, [pdfBytes, pageOrder]);

  return (
    <div className="bg-[#0d0d0d] border border-[#222222] rounded-[2px] w-[140px] overflow-y-auto flex-shrink-0 p-1.5 space-y-2">
      <div className="text-[9px] text-rmpg-500 uppercase tracking-wider px-1 pt-1">Pages</div>
      {pageOrder.map((_original, idx) => {
        const pageNumber = idx + 1;
        const meta = pages[idx];
        const active = pageNumber === activePage;
        return (
          <div key={`thumb-${idx}`} className={`group rounded-sm border ${active ? 'border-[#d4a017]' : 'border-[#222]'} bg-black p-1`}>
            <button
              type="button"
              onClick={() => onJumpTo(idx)}
              className="block w-full text-left"
              aria-label={`Jump to page ${pageNumber}`}
              title={`Page ${pageNumber}`}
            >
              <div className="bg-white aspect-[3/4] flex items-center justify-center overflow-hidden">
                {pageOrder[idx] === 0 ? (
                  <div className="text-[10px] text-gray-400">Blank</div>
                ) : (
                  <canvas
                    ref={(el) => { if (el) refs.current.set(idx, el); else refs.current.delete(idx); }}
                    style={{ transform: `rotate(${meta?.rotation ?? 0}deg)`, maxWidth: '100%', maxHeight: '100%' }}
                  />
                )}
              </div>
              <div className="text-[9px] text-rmpg-400 text-center mt-0.5">{pageNumber}</div>
            </button>
            <div className="flex items-center justify-between gap-0.5 mt-1 opacity-60 group-hover:opacity-100">
              <IconButton onClick={() => onMove(idx, -1)} aria-label="Move up" title="Move up" disabled={idx === 0}
                className="p-0.5 text-rmpg-400 hover:text-white disabled:opacity-30"><ArrowUp className="w-3 h-3" /></IconButton>
              <IconButton onClick={() => onMove(idx, 1)} aria-label="Move down" title="Move down" disabled={idx === pageOrder.length - 1}
                className="p-0.5 text-rmpg-400 hover:text-white disabled:opacity-30"><ArrowDown className="w-3 h-3" /></IconButton>
              <IconButton onClick={() => onRotate(idx)} aria-label="Rotate 90°" title="Rotate 90°"
                className="p-0.5 text-rmpg-400 hover:text-white"><RotateCw className="w-3 h-3" /></IconButton>
              <IconButton onClick={() => onInsertBlank(idx)} aria-label="Insert blank after" title="Insert blank after"
                className="p-0.5 text-rmpg-400 hover:text-white"><FilePlus2 className="w-3 h-3" /></IconButton>
              {onExtract && (
                <IconButton onClick={() => onExtract(idx)} aria-label="Extract page" title="Extract page to new PDF"
                  className="p-0.5 text-rmpg-400 hover:text-white"><FileOutput className="w-3 h-3" /></IconButton>
              )}
              {meta?.crop && onClearCrop && (
                <IconButton onClick={() => onClearCrop(idx)} aria-label="Clear crop" title="Clear crop"
                  className="p-0.5 text-[#d4a017] hover:text-white"><Crop className="w-3 h-3" /></IconButton>
              )}
              <IconButton onClick={() => onDelete(idx)} aria-label="Delete page" title="Delete page"
                className="p-0.5 text-rmpg-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></IconButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}
