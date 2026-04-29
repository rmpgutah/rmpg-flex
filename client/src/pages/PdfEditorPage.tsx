import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Upload, Save, Type as TypeIcon, Highlighter, Trash2, MousePointer2, Loader2 } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Integrated PDF editor.
// Stack: PDF.js (Apache 2.0) for rendering + pdf-lib (MIT) for byte-level edits.
// Both are pure JS — no native deps — so this works in browser, Electron desktop,
// and Capacitor mobile builds without changes.
//
// Annotation model: free-standing overlay rectangles keyed to (page, x, y, w, h)
// in *PDF coordinates* (origin bottom-left, not screen). On render we map to
// canvas pixels; on save we hand the PDF coordinates straight to pdf-lib.
//
// Annotation types:
//   text       — drawn text in dark gray
//   highlight  — translucent yellow rectangle (printable markup, not redaction —
//                see follow-up notes for true black-bar redaction)

type Tool = 'select' | 'text' | 'highlight';
type Annotation =
  | { id: string; page: number; type: 'text'; x: number; y: number; text: string; fontSize: number }
  | { id: string; page: number; type: 'highlight'; x: number; y: number; w: number; h: number };

interface RenderedPage {
  pageNumber: number;
  width: number;
  height: number;
  scale: number;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function PdfEditorPage() {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [highlightDraft, setHighlightDraft] = useState<{ page: number; startX: number; startY: number; endX: number; endY: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());

  // Render PDF whenever we get new bytes.
  useEffect(() => {
    if (!pdfBytes) { setPages([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const loadingTask = pdfjs.getDocument({ data: pdfBytes.slice() });
        const pdf = await loadingTask.promise;
        const next: RenderedPage[] = [];
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale: 1.5 });
          next.push({ pageNumber: p, width: viewport.width, height: viewport.height, scale: 1.5 });
          if (cancelled) return;
        }
        setPages(next);
        // Defer canvas paint until React mounts the canvases.
        requestAnimationFrame(async () => {
          for (let p = 1; p <= pdf.numPages; p++) {
            const canvas = canvasRefs.current.get(p);
            if (!canvas) continue;
            const page = await pdf.getPage(p);
            const viewport = page.getViewport({ scale: 1.5 });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;
            await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          }
        });
      } catch (err) {
        console.error('PDF render failed', err);
        alert(`Failed to open PDF: ${err instanceof Error ? err.message : 'unknown error'}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfBytes]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      alert('Please select a PDF file.');
      return;
    }
    const buf = await file.arrayBuffer();
    setFileName(file.name);
    setAnnotations([]);
    setActiveId(null);
    setPdfBytes(new Uint8Array(buf));
  };

  const handlePageMouseDown = (page: RenderedPage, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (tool === 'text') {
      const text = window.prompt('Annotation text:', '');
      if (!text) return;
      const ann: Annotation = { id: uid(), page: page.pageNumber, type: 'text', x, y, text, fontSize: 14 };
      setAnnotations(a => [...a, ann]);
      setActiveId(ann.id);
      setTool('select');
      return;
    }
    if (tool === 'highlight') {
      setHighlightDraft({ page: page.pageNumber, startX: x, startY: y, endX: x, endY: y });
      return;
    }
    setActiveId(null);
  };

  const handlePageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!highlightDraft) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHighlightDraft({ ...highlightDraft, endX: e.clientX - rect.left, endY: e.clientY - rect.top });
  };

  const handlePageMouseUp = () => {
    if (!highlightDraft) return;
    const x = Math.min(highlightDraft.startX, highlightDraft.endX);
    const y = Math.min(highlightDraft.startY, highlightDraft.endY);
    const w = Math.abs(highlightDraft.endX - highlightDraft.startX);
    const h = Math.abs(highlightDraft.endY - highlightDraft.startY);
    if (w > 4 && h > 4) {
      const ann: Annotation = { id: uid(), page: highlightDraft.page, type: 'highlight', x, y, w, h };
      setAnnotations(a => [...a, ann]);
      setActiveId(ann.id);
    }
    setHighlightDraft(null);
    setTool('select');
  };

  const removeActive = () => {
    if (!activeId) return;
    setAnnotations(a => a.filter(x => x.id !== activeId));
    setActiveId(null);
  };

  const handleSave = async () => {
    if (!pdfBytes) return;
    try {
      const doc = await PDFDocument.load(pdfBytes.slice());
      const helv = await doc.embedFont(StandardFonts.Helvetica);
      const docPages = doc.getPages();

      for (const ann of annotations) {
        const page = docPages[ann.page - 1];
        if (!page) continue;
        const { height: pageH } = page.getSize();
        const meta = pages.find(p => p.pageNumber === ann.page);
        const scale = meta ? meta.scale : 1.5;
        // Screen y-down → PDF y-up conversion.
        if (ann.type === 'text') {
          const pdfX = ann.x / scale;
          const pdfY = pageH - (ann.y / scale) - ann.fontSize;
          page.drawText(ann.text, { x: pdfX, y: pdfY, size: ann.fontSize, font: helv, color: rgb(0.1, 0.1, 0.1) });
        } else {
          const pdfX = ann.x / scale;
          const pdfW = ann.w / scale;
          const pdfH = ann.h / scale;
          const pdfY = pageH - (ann.y / scale) - pdfH;
          page.drawRectangle({ x: pdfX, y: pdfY, width: pdfW, height: pdfH, color: rgb(1, 0.95, 0.2), opacity: 0.4 });
        }
      }

      const out = await doc.save();
      const blob = new Blob([out as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.replace(/\.pdf$/i, '') + '-annotated.pdf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('PDF save failed', err);
      alert(`Save failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  const annotationsByPage = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of annotations) {
      const list = m.get(a.page) ?? [];
      list.push(a);
      m.set(a.page, list);
    }
    return m;
  }, [annotations]);

  const cursor = tool === 'text' ? 'cursor-text' : tool === 'highlight' ? 'cursor-crosshair' : 'cursor-default';

  return (
    <div className="p-4 space-y-3">
      <PanelTitleBar title="PDF EDITOR" icon={FileText} />

      <div className="flex items-center gap-2 bg-[#141414] border border-[#222222] rounded-[2px] px-2 py-1.5">
        <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleFileSelect} />
        <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-secondary inline-flex items-center gap-1">
          <Upload className="w-3.5 h-3.5" /> Open PDF
        </button>
        <span className="text-xs text-rmpg-400 truncate max-w-[300px]" title={fileName}>{fileName || 'No file open'}</span>

        <div className="w-px h-5 bg-[#222222] mx-1" />

        <IconButton onClick={() => setTool('select')} aria-label="Select" title="Select"
          className={`p-1.5 rounded-sm transition-colors ${tool === 'select' ? 'bg-[#d4a017]/20 text-[#d4a017]' : 'text-rmpg-400 hover:text-white hover:bg-rmpg-700/50'}`}>
          <MousePointer2 className="w-4 h-4" />
        </IconButton>
        <IconButton onClick={() => setTool('text')} aria-label="Add text annotation" title="Add text annotation"
          className={`p-1.5 rounded-sm transition-colors ${tool === 'text' ? 'bg-[#d4a017]/20 text-[#d4a017]' : 'text-rmpg-400 hover:text-white hover:bg-rmpg-700/50'}`}>
          <TypeIcon className="w-4 h-4" />
        </IconButton>
        <IconButton onClick={() => setTool('highlight')} aria-label="Highlight region" title="Highlight region"
          className={`p-1.5 rounded-sm transition-colors ${tool === 'highlight' ? 'bg-[#d4a017]/20 text-[#d4a017]' : 'text-rmpg-400 hover:text-white hover:bg-rmpg-700/50'}`}>
          <Highlighter className="w-4 h-4" />
        </IconButton>
        <IconButton onClick={removeActive} aria-label="Delete selected annotation" title="Delete selected annotation"
          disabled={!activeId}
          className="p-1.5 rounded-sm transition-colors text-rmpg-400 hover:text-white hover:bg-rmpg-700/50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-rmpg-400">
          <Trash2 className="w-4 h-4" />
        </IconButton>

        <div className="flex-1" />

        <span className="text-[10px] text-rmpg-500">{annotations.length} annotation{annotations.length === 1 ? '' : 's'}</span>
        <button type="button" onClick={handleSave} disabled={!pdfBytes || annotations.length === 0} className="btn-primary inline-flex items-center gap-1 disabled:opacity-50">
          <Save className="w-3.5 h-3.5" /> Save copy
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-rmpg-400"><Loader2 className="w-4 h-4 animate-spin" /> Rendering pages…</div>
      )}

      {!pdfBytes && !loading && (
        <div className="bg-[#0d0d0d] border border-[#222222] rounded-[2px] p-8 text-center">
          <FileText className="w-12 h-12 mx-auto mb-3 text-rmpg-600" />
          <div className="text-sm text-rmpg-300 mb-1">Open a PDF to begin editing</div>
          <div className="text-[10px] text-rmpg-500">View, annotate, highlight, and save a modified copy. All editing runs locally in your browser — files never leave the device.</div>
        </div>
      )}

      <div className="space-y-4">
        {pages.map((page) => {
          const pageAnns = annotationsByPage.get(page.pageNumber) ?? [];
          return (
            <div key={page.pageNumber} className="flex flex-col items-center">
              <div className="text-[10px] text-rmpg-500 mb-1">Page {page.pageNumber} of {pages.length}</div>
              <div
                className={`relative inline-block bg-white shadow-lg ${cursor}`}
                style={{ width: page.width, height: page.height }}
                onMouseDown={(e) => handlePageMouseDown(page, e)}
                onMouseMove={handlePageMouseMove}
                onMouseUp={handlePageMouseUp}
                onMouseLeave={() => highlightDraft && handlePageMouseUp()}
              >
                <canvas
                  ref={(el) => { if (el) canvasRefs.current.set(page.pageNumber, el); else canvasRefs.current.delete(page.pageNumber); }}
                  className="block pointer-events-none"
                />
                {pageAnns.map((ann) => {
                  const selected = ann.id === activeId;
                  if (ann.type === 'text') {
                    return (
                      <div
                        key={ann.id}
                        onMouseDown={(e) => { e.stopPropagation(); setActiveId(ann.id); }}
                        className={`absolute select-none px-1 ${selected ? 'outline outline-2 outline-[#d4a017]' : ''}`}
                        style={{ left: ann.x, top: ann.y, fontSize: ann.fontSize, color: '#1a1a1a', fontFamily: 'Helvetica, Arial, sans-serif' }}
                      >{ann.text}</div>
                    );
                  }
                  return (
                    <div
                      key={ann.id}
                      onMouseDown={(e) => { e.stopPropagation(); setActiveId(ann.id); }}
                      className={`absolute ${selected ? 'outline outline-2 outline-[#d4a017]' : ''}`}
                      style={{ left: ann.x, top: ann.y, width: ann.w, height: ann.h, background: 'rgba(255, 240, 80, 0.4)' }}
                    />
                  );
                })}
                {highlightDraft && highlightDraft.page === page.pageNumber && (
                  <div
                    className="absolute pointer-events-none border border-[#d4a017]"
                    style={{
                      left: Math.min(highlightDraft.startX, highlightDraft.endX),
                      top: Math.min(highlightDraft.startY, highlightDraft.endY),
                      width: Math.abs(highlightDraft.endX - highlightDraft.startX),
                      height: Math.abs(highlightDraft.endY - highlightDraft.startY),
                      background: 'rgba(255, 240, 80, 0.3)',
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
