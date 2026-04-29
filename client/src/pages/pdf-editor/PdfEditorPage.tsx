import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { FileText, AlertTriangle } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import PanelTitleBar from '../../components/PanelTitleBar';
import EditorToolbar from './components/EditorToolbar';
import ToolPalette from './components/ToolPalette';
import ThumbnailSidebar from './components/ThumbnailSidebar';
import PageCanvas from './components/PageCanvas';
import PropertiesPanel from './components/PropertiesPanel';
import SignaturePad from './components/SignaturePad';
import { Annotation, BatesConfig, DocumentMeta, EditorState, PageMeta, StampLabel, Tool, WatermarkConfig, DEFAULT_RENDER_SCALE } from './types';
import { downloadEditedPdf, mergePdfFiles } from './save';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Reducer-based state with simple undo/redo. We snapshot the *editable* parts
// (annotations + page order/rotation + bates + watermark + meta) but not the
// original PDF bytes — those don't change inside the editor.

interface MutableState {
  pageOrder: number[];
  pages: PageMeta[];
  annotations: Annotation[];
  bates: BatesConfig | null;
  watermark: WatermarkConfig | null;
  meta: DocumentMeta;
}

interface History {
  past: MutableState[];
  present: MutableState;
  future: MutableState[];
}

type Action =
  | { type: 'replace'; next: MutableState }
  | { type: 'mutate'; next: MutableState }   // pushes onto history
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; next: MutableState };

function reducer(h: History, a: Action): History {
  switch (a.type) {
    case 'replace': return { ...h, present: a.next };
    case 'mutate': return { past: [...h.past, h.present].slice(-50), present: a.next, future: [] };
    case 'undo': return h.past.length === 0 ? h : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
    case 'redo': return h.future.length === 0 ? h : { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
    case 'reset': return { past: [], present: a.next, future: [] };
  }
}

const EMPTY_STATE: MutableState = { pageOrder: [], pages: [], annotations: [], bates: null, watermark: null, meta: {} };

export default function PdfEditorPage() {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('');
  const [history, dispatch] = useReducer(reducer, { past: [], present: EMPTY_STATE, future: [] });
  const state = history.present;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState('#0a0a0a');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [zoom, setZoom] = useState(1);
  const [activePage, setActivePage] = useState(1);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingStamp, setPendingStamp] = useState<StampLabel | string | null>('CONFIDENTIAL');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const mutate = useCallback((patch: Partial<MutableState>) => {
    dispatch({ type: 'mutate', next: { ...state, ...patch } });
  }, [state]);

  // Open a PDF.
  const openFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Please choose a PDF file.'); return; }
    setError(null);
    file.arrayBuffer().then(async (buf) => {
      const arr = new Uint8Array(buf);
      try {
        const pdf = await pdfjs.getDocument({ data: arr.slice() }).promise;
        const pages: PageMeta[] = [];
        const pageOrder: number[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const p = await pdf.getPage(i);
          const v = p.getViewport({ scale: DEFAULT_RENDER_SCALE });
          pages.push({ originalIndex: i, width: v.width, height: v.height, rotation: 0 });
          pageOrder.push(i);
        }
        setBytes(arr);
        setFileName(file.name);
        dispatch({ type: 'reset', next: { pageOrder, pages, annotations: [], bates: null, watermark: null, meta: { title: file.name.replace(/\.pdf$/i, '') } } });
        setActivePage(1);
        setActiveId(null);
      } catch (e) {
        setError(`Could not open PDF: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    });
  };

  // File pickers.
  const onPickFile = () => fileInputRef.current?.click();
  const onPickMerge = () => mergeInputRef.current?.click();
  const onPickImage = () => imageInputRef.current?.click();

  const handleOpenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = '';
  };
  const handleMergeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    try {
      setSaving(true);
      const merged = await mergePdfFiles(files);
      const blob = new Blob([merged as BlobPart], { type: 'application/pdf' });
      // Open the merged result in the editor.
      openFile(new File([blob], `merged-${Date.now()}.pdf`, { type: 'application/pdf' }));
    } catch (err) {
      setError(`Merge failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { setPendingImage(reader.result as string); setTool('image'); };
    reader.readAsDataURL(f);
  };

  // Tool reactions.
  useEffect(() => {
    if (tool === 'signature') setSignatureOpen(true);
    if (tool === 'image' && !pendingImage) onPickImage();
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // Annotation operations.
  const addAnnotation = useCallback((a: Annotation) => {
    mutate({ annotations: [...state.annotations, a] });
    setActiveId(a.id);
    if (tool !== 'pen' && tool !== 'highlight' && tool !== 'redact') setTool('select');
  }, [state.annotations, mutate, tool]);

  const updateAnnotation = useCallback((id: string, patch: Partial<Annotation>) => {
    const idx = state.annotations.findIndex(a => a.id === id);
    if (idx === -1) return;
    const cur = state.annotations[idx];
    const next = [...state.annotations];
    next[idx] = { ...cur, ...patch } as Annotation;
    mutate({ annotations: next });
  }, [state.annotations, mutate]);

  const deleteActive = () => {
    if (!activeId) return;
    mutate({ annotations: state.annotations.filter(a => a.id !== activeId) });
    setActiveId(null);
  };

  // Page operations.
  const movePage = (idx: number, dir: -1 | 1) => {
    const ni = idx + dir; if (ni < 0 || ni >= state.pageOrder.length) return;
    const order = [...state.pageOrder]; const pages = [...state.pages];
    [order[idx], order[ni]] = [order[ni], order[idx]];
    [pages[idx], pages[ni]] = [pages[ni], pages[idx]];
    // Annotations on swapped pages need their page numbers updated.
    const annotations = state.annotations.map(a => {
      if (a.page === idx + 1) return { ...a, page: ni + 1 };
      if (a.page === ni + 1) return { ...a, page: idx + 1 };
      return a;
    });
    mutate({ pageOrder: order, pages, annotations });
  };
  const rotatePage = (idx: number) => {
    const pages = [...state.pages];
    const cur = pages[idx];
    pages[idx] = { ...cur, rotation: ((cur.rotation + 90) % 360) as PageMeta['rotation'] };
    mutate({ pages });
  };
  const deletePage = (idx: number) => {
    if (state.pageOrder.length <= 1) { setError('Cannot delete the only page.'); return; }
    const order = state.pageOrder.filter((_, i) => i !== idx);
    const pages = state.pages.filter((_, i) => i !== idx);
    // Drop annotations on this page; reindex annotations on later pages.
    const annotations = state.annotations
      .filter(a => a.page !== idx + 1)
      .map(a => a.page > idx + 1 ? { ...a, page: a.page - 1 } : a);
    mutate({ pageOrder: order, pages, annotations });
  };
  const insertBlank = (afterIdx: number) => {
    // Use the dimensions of the page we're inserting after.
    const sample = state.pages[afterIdx] ?? state.pages[0];
    if (!sample) return;
    const order = [...state.pageOrder]; order.splice(afterIdx + 1, 0, 0);
    const pages = [...state.pages]; pages.splice(afterIdx + 1, 0, { originalIndex: 0, width: sample.width, height: sample.height, rotation: 0 });
    const annotations = state.annotations.map(a => a.page > afterIdx + 1 ? { ...a, page: a.page + 1 } : a);
    mutate({ pageOrder: order, pages, annotations });
  };

  // Save.
  const onSave = async () => {
    if (!bytes) return;
    setSaving(true);
    try {
      const fullState: EditorState = {
        bytes, fileName,
        pageOrder: state.pageOrder, pages: state.pages,
        annotations: state.annotations, bates: state.bates,
        watermark: state.watermark, meta: state.meta,
      };
      // Page-zero (inserted blank) handling: pdf-lib needs us to fabricate them.
      // The save pipeline copies only original pages, so for blanks we'd need to
      // pre-process; for the MVP we simply skip blanks in the output if any
      // exist, and warn the user. This is an honest limitation users see in the UI.
      const hasBlank = state.pageOrder.some(p => p === 0);
      if (hasBlank) {
        setError('Note: inserted blank pages are ignored in this save. Use Insert Blank as a placeholder while reviewing only.');
      }
      // Strip blanks from the export.
      if (hasBlank) {
        const map: number[] = [];
        const order = state.pageOrder.filter((p, i) => { if (p !== 0) { map.push(i); return true; } return false; });
        const pages = map.map(i => state.pages[i]);
        const annotations = state.annotations
          .filter(a => state.pageOrder[a.page - 1] !== 0)
          .map(a => {
            const newPageIdx = map.indexOf(a.page - 1);
            return { ...a, page: newPageIdx + 1 };
          });
        await downloadEditedPdf({ ...fullState, pageOrder: order, pages, annotations });
      } else {
        await downloadEditedPdf(fullState);
      }
    } catch (err) {
      setError(`Save failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore shortcuts when typing in an input, textarea, or contenteditable.
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'undo' }); return; }
      if (meta && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); dispatch({ type: 'redo' }); return; }
      if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); onSave(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { if (activeId) { e.preventDefault(); deleteActive(); } return; }
      if (e.key === 'Escape') { setActiveId(null); setTool('select'); return; }
      if (e.key === '+' || e.key === '=') { setZoom(z => Math.min(3, z + 0.1)); return; }
      if (e.key === '-') { setZoom(z => Math.max(0.3, z - 0.1)); return; }
      // Tool keys
      const map: Record<string, Tool> = { v: 'select', h: 'hand', t: 'text', y: 'highlight', r: 'rect', e: 'ellipse', l: 'line', a: 'arrow', p: 'pen' };
      if (!meta && map[e.key.toLowerCase()]) { setTool(map[e.key.toLowerCase()]); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, state.annotations]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track which page is most-visible while scrolling to update activePage.
  const onScroll = () => {
    const root = scrollerRef.current; if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const midY = rootRect.top + rootRect.height / 2;
    const pages = root.querySelectorAll('[data-page-number]');
    let best = 1; let bestDist = Infinity;
    pages.forEach(p => {
      const r = (p as HTMLElement).getBoundingClientRect();
      const c = r.top + r.height / 2;
      const d = Math.abs(c - midY);
      if (d < bestDist) { bestDist = d; best = parseInt((p as HTMLElement).dataset.pageNumber || '1', 10); }
    });
    if (best !== activePage) setActivePage(best);
  };

  const jumpToPage = (idx: number) => {
    const root = scrollerRef.current; if (!root) return;
    const target = root.querySelector(`[data-page-number="${idx + 1}"]`) as HTMLElement | null;
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const annotation = activeId ? state.annotations.find(a => a.id === activeId) ?? null : null;
  const hasDocument = !!bytes;

  const annotationsByPage = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of state.annotations) {
      const list = m.get(a.page) ?? []; list.push(a); m.set(a.page, list);
    }
    return m;
  }, [state.annotations]);

  return (
    <div className="p-3 flex flex-col h-[calc(100vh-140px)] min-h-[600px]">
      <PanelTitleBar title="PDF EDITOR" icon={FileText} />

      <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleOpenChange} />
      <input ref={mergeInputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={handleMergeChange} />
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleImageChange} />

      <div className="mt-2 mb-2">
        <EditorToolbar
          fileName={fileName}
          hasDocument={hasDocument}
          canUndo={canUndo}
          canRedo={canRedo}
          zoom={zoom}
          onOpen={onPickFile}
          onMerge={onPickMerge}
          onSave={onSave}
          onUndo={() => dispatch({ type: 'undo' })}
          onRedo={() => dispatch({ type: 'redo' })}
          onZoomIn={() => setZoom(z => Math.min(3, z + 0.1))}
          onZoomOut={() => setZoom(z => Math.max(0.3, z - 0.1))}
          onZoomReset={() => setZoom(1)}
          onMetadata={() => {}}
          onBates={() => {}}
          onWatermark={() => {}}
          saving={saving}
        />
      </div>

      {error && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 text-yellow-200 text-[11px] px-3 py-1.5 rounded-sm mb-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> <div>{error}</div>
          <button type="button" onClick={() => setError(null)} className="ml-auto text-yellow-300 hover:text-white">×</button>
        </div>
      )}

      {!hasDocument && (
        <div className="flex-1 bg-[#0d0d0d] border border-[#222222] rounded-[2px] p-12 text-center flex flex-col items-center justify-center">
          <FileText className="w-16 h-16 mb-4 text-rmpg-600" />
          <div className="text-base text-rmpg-200 mb-2 font-semibold">PDF Editor</div>
          <div className="text-xs text-rmpg-500 mb-6 max-w-md">View, annotate, redact, sign, stamp, watermark, reorder, rotate, merge — all running locally in your browser. Files never leave the device.</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onPickFile} className="btn-primary">Open PDF</button>
            <button type="button" onClick={onPickMerge} className="btn-secondary">Merge multiple PDFs</button>
          </div>
          <div className="mt-6 text-[10px] text-rmpg-600 max-w-md">
            <strong className="text-rmpg-500">Note on redaction:</strong> the redaction tool paints an opaque black box over content. For maximum-sensitivity material (FOIA, court submissions), follow with a print-to-PDF round trip to flatten the entire content stream.
          </div>
        </div>
      )}

      {hasDocument && (
        <div className="flex-1 flex gap-2 min-h-0">
          <ToolPalette tool={tool} onTool={setTool} color={color} onColor={setColor} strokeWidth={strokeWidth} onStrokeWidth={setStrokeWidth} />

          <ThumbnailSidebar
            pdfBytes={bytes}
            pages={state.pages}
            pageOrder={state.pageOrder}
            activePage={activePage}
            onJumpTo={jumpToPage}
            onMove={movePage}
            onRotate={rotatePage}
            onDelete={deletePage}
            onInsertBlank={insertBlank}
          />

          <div ref={scrollerRef} onScroll={onScroll} className="flex-1 overflow-auto bg-[#050505] border border-[#222222] rounded-[2px] p-4 space-y-4">
            {state.pageOrder.map((original, idx) => (
              <PageCanvas
                key={`page-${idx}-${original}`}
                pdfBytes={bytes}
                originalPageNumber={original}
                visualPageNumber={idx + 1}
                pageMeta={state.pages[idx]}
                zoom={zoom}
                tool={tool}
                color={color}
                strokeWidth={strokeWidth}
                pendingImage={pendingImage}
                pendingStamp={pendingStamp}
                annotations={annotationsByPage.get(idx + 1) ?? []}
                activeId={activeId}
                onSelectAnnotation={setActiveId}
                onAddAnnotation={addAnnotation}
                onUpdateAnnotation={updateAnnotation}
              />
            ))}
          </div>

          <PropertiesPanel
            annotation={annotation}
            onChange={(a) => updateAnnotation(a.id, a)}
            onDelete={deleteActive}
            bates={state.bates}
            onBatesChange={(b) => mutate({ bates: b })}
            watermark={state.watermark}
            onWatermarkChange={(w) => mutate({ watermark: w })}
            meta={state.meta}
            onMetaChange={(m) => mutate({ meta: m })}
          />
        </div>
      )}

      <SignaturePad
        open={signatureOpen}
        onClose={() => { setSignatureOpen(false); if (!pendingImage) setTool('select'); }}
        onConfirm={(dataUrl) => { setPendingImage(dataUrl); setTool('signature'); }}
      />
    </div>
  );
}
