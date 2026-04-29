import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { FileText, AlertTriangle, CheckCircle2, Search, Settings, Keyboard, Layers, Printer, Download, Upload as UploadIcon, Map as MapIcon } from 'lucide-react';
import { open as openPdf, RmpgPdfDocument, subscribeDiagnostics, diagnosticsSummary, getDiagnostics } from '../../lib/rmpg-pdf-engine';
import PanelTitleBar from '../../components/PanelTitleBar';
import EditorToolbar from './components/EditorToolbar';
import ToolPalette from './components/ToolPalette';
import ThumbnailSidebar from './components/ThumbnailSidebar';
import PageCanvas from './components/PageCanvas';
import PropertiesPanel from './components/PropertiesPanel';
import SignaturePad from './components/SignaturePad';
import BarcodeDialog from './components/BarcodeDialog';
import EncryptionDialog, { EncryptionConfig } from './components/EncryptionDialog';
import AnnotationsPanel from './components/AnnotationsPanel';
import FindDialog from './components/FindDialog';
import KeyboardShortcutsDialog from './components/KeyboardShortcutsDialog';
import PreferencesDialog from './components/PreferencesDialog';
import CustomStampsGallery, { StampPick } from './components/CustomStampsGallery';
import MiniMap from './components/MiniMap';
import AnnotationContextMenu from './components/AnnotationContextMenu';
import { Annotation, BatesConfig, DocumentMeta, EditorState, EditorPreferences, DEFAULT_PREFERENCES, PageCrop, PageMeta, RecentFile, StampLabel, Tool, WatermarkConfig, DEFAULT_RENDER_SCALE } from './types';
import { buildPdfFromEditorState, extractPagesAsBytes, mergePdfFiles, saveToDocuments } from './save';
import { authedImageUrl } from '../../hooks/useApi';

// PDF rendering goes through our company-owned engine facade
// (client/src/lib/rmpg-pdf-engine). It tries our native backend first and
// falls back to PDF.js when the document uses features we don't render
// natively yet. Worker setup + library imports live entirely behind the
// facade — this file no longer touches pdfjs-dist directly.

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
  sourceFileId?: string | null;
  sourceFolderId?: number | null;
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

const EMPTY_STATE: MutableState = { pageOrder: [], pages: [], annotations: [], bates: null, watermark: null, meta: {}, sourceFileId: null, sourceFolderId: null };

export default function PdfEditorPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // View-only mode hides editing tools — used for previewing PDFs from
  // Documents without giving the operator the full editing surface by default.
  const viewOnly = searchParams.get('view') === '1';
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
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
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [encryptionOpen, setEncryptionOpen] = useState(false);
  const [encryption, setEncryption] = useState<EncryptionConfig | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [stampsOpen, setStampsOpen] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; annotationId: string } | null>(null);
  /** Diagnostic toggle: force every page render through PDF.js. The
   *  user-facing label is "Use compatibility engine" — exposed in the
   *  quick-action strip when the native renderer leaves a page blank. */
  const [forcePdfjs, setForcePdfjs] = useState(false);
  // Persisted preferences — loaded once from localStorage, saved on every change.
  const [prefs, setPrefs] = useState<EditorPreferences>(() => {
    try {
      const raw = localStorage.getItem('rmpg-pdf-editor-prefs');
      if (raw) return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return DEFAULT_PREFERENCES;
  });
  useEffect(() => {
    try { localStorage.setItem('rmpg-pdf-editor-prefs', JSON.stringify(prefs)); } catch { /* ignore */ }
  }, [prefs]);
  // Multi-select: most operations still target a single annotation, but
  // copy/paste/duplicate and the AnnotationsPanel respect the full set.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<Annotation[]>([]);
  const jsonInputRef = useRef<HTMLInputElement>(null);
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

  // Open a PDF (from File object or pre-fetched bytes).
  // Distinguishes parse failures from worker-load failures so the user gets
  // a useful message instead of the generic PDF.js "Failed to load PDF document".
  const openBytes = async (arr: Uint8Array, name: string, sourceFileId: string | null = null, sourceFolderId: number | null = null) => {
    setError(null);
    try {
      let pdf: RmpgPdfDocument;
      try {
        pdf = await openPdf(arr, { fileName: name });
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : 'unknown error';
        const errName = (parseErr as { name?: string })?.name ?? '';
        if (errName === 'PasswordException') {
          throw new Error('This PDF is password-protected. Decrypt it in Documents first (the editor doesn\'t prompt for passwords yet).');
        }
        if (errName === 'InvalidPDFException') {
          throw new Error('The file is not a valid PDF. It may be truncated or corrupted.');
        }
        if (msg.toLowerCase().includes('worker')) {
          throw new Error('PDF rendering worker failed to load. The engine uses our native renderer first, then Mozilla\'s PDF.js (open-source, runs locally) as a fallback.');
        }
        throw new Error(`Could not parse the PDF: ${msg}`);
      }
      const pages: PageMeta[] = [];
      const pageOrder: number[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const p = await pdf.getPage(i);
        const v = p.getViewport({ scale: DEFAULT_RENDER_SCALE });
        pages.push({ originalIndex: i, width: v.width, height: v.height, rotation: 0, crop: null });
        pageOrder.push(i);
      }
      setBytes(arr);
      setFileName(name);
      dispatch({ type: 'reset', next: { pageOrder, pages, annotations: [], bates: null, watermark: null, meta: { title: name.replace(/\.pdf$/i, '') }, sourceFileId, sourceFolderId } });
      setActivePage(1);
      setActiveId(null);
    } catch (e) {
      setError(`Could not open PDF: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };

  const openFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Please choose a PDF file.'); return; }
    file.arrayBuffer().then((buf) => openBytes(new Uint8Array(buf), file.name));
  };

  // Auto-load from Documents when ?fileId=... is present in the URL.
  // Errors are surfaced with a specific reason rather than the generic
  // "Failed to load PDF document" — viewers can hit any of: auth failure
  // (HTML/JSON response), wrong MIME type, corrupt PDF bytes, or the
  // PDF.js worker not loading. Each path produces a distinct message.
  useEffect(() => {
    const fileId = searchParams.get('fileId');
    const folderIdStr = searchParams.get('folderId');
    const fileNameParam = searchParams.get('name');
    if (!fileId || bytes) return;
    const folderId = folderIdStr ? parseInt(folderIdStr, 10) : null;
    (async () => {
      try {
        const url = authedImageUrl(`/api/uploads/${encodeURIComponent(fileId)}`);
        const res = await fetch(url);
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) throw new Error('Not authorized to read this file. Try signing in again.');
          if (res.status === 404) throw new Error('File not found in the document store.');
          throw new Error(`Server returned ${res.status}`);
        }
        // Defensive: confirm the server actually sent us a PDF, not a JSON
        // error wrapper or an HTML login page.
        const contentType = res.headers.get('Content-Type') ?? '';
        if (!contentType.toLowerCase().includes('pdf')) {
          // Try to read a tiny snippet for the error message so the user knows
          // whether they hit a login redirect or a malformed file.
          const snippet = (await res.clone().text().catch(() => '')).slice(0, 120);
          throw new Error(`Server returned non-PDF content (Content-Type: ${contentType}). ${snippet ? `Body: ${snippet}` : ''}`);
        }
        const buf = await res.arrayBuffer();
        if (buf.byteLength === 0) throw new Error('File is empty.');
        // Quick sanity check on the PDF magic header. PDFs always start with %PDF-
        const head = new Uint8Array(buf.slice(0, 5));
        const magic = String.fromCharCode(...head);
        if (magic !== '%PDF-') {
          throw new Error(`File doesn't look like a PDF (header: "${magic}"). It may be corrupted or stored with the wrong extension.`);
        }
        await openBytes(new Uint8Array(buf), fileNameParam || `document-${fileId}.pdf`, fileId, folderId);
      } catch (err) {
        setError(`Could not load file: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    })();
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (tool === 'barcode') setBarcodeOpen(true);
    if (tool === 'stamp') setStampsOpen(true);
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the user picks from the stamps gallery, prepare the editor for the
  // next page click: presets seed the stamp label; custom uploads seed the
  // pendingImage and switch to the image-style stamp annotation kind.
  const handleStampPick = (pick: StampPick) => {
    if (pick.kind === 'preset') {
      setPendingStamp(pick.label);
      setPendingImage(null);
      setTool('stamp');
    } else {
      setPendingImage(pick.stamp.imageData);
      setPendingStamp(pick.stamp.name);
      // Custom stamps render as image annotations so they keep their
      // bitmap fidelity; PageCanvas already maps the 'barcode' tool to
      // an 'image' annotation, and we use the same handoff here.
      setTool('barcode');
    }
  };

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
    if (selectedIds.size > 0) {
      const drop = selectedIds;
      mutate({ annotations: state.annotations.filter(a => !drop.has(a.id)) });
      setSelectedIds(new Set());
      setActiveId(null);
      return;
    }
    if (!activeId) return;
    mutate({ annotations: state.annotations.filter(a => a.id !== activeId) });
    setActiveId(null);
  };

  // ─── Multi-select / clipboard / z-order / lock ────────────────
  const selectAnnotation = (id: string, additive: boolean) => {
    setActiveId(id);
    setSelectedIds(prev => {
      const next = new Set(additive ? prev : []);
      if (additive && next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleLock = (id: string) => {
    const idx = state.annotations.findIndex(a => a.id === id);
    if (idx === -1) return;
    const next = [...state.annotations];
    next[idx] = { ...next[idx], locked: !next[idx].locked } as Annotation;
    mutate({ annotations: next });
  };

  const adjustZ = (id: string, delta: number) => {
    const idx = state.annotations.findIndex(a => a.id === id);
    if (idx === -1) return;
    const cur = state.annotations[idx];
    const targetIdx = Math.max(0, Math.min(state.annotations.length - 1, idx + delta));
    if (targetIdx === idx) return;
    const next = [...state.annotations];
    next.splice(idx, 1);
    next.splice(targetIdx, 0, cur);
    // Re-stamp zIndex based on order so renderers can sort cheaply.
    next.forEach((a, i) => { (a as any).zIndex = i; });
    mutate({ annotations: next });
  };
  const bringForward = (id: string) => adjustZ(id, +1);
  const sendBackward = (id: string) => adjustZ(id, -1);

  const copySelected = () => {
    const ids = selectedIds.size > 0 ? selectedIds : (activeId ? new Set([activeId]) : new Set<string>());
    if (ids.size === 0) return;
    const copies = state.annotations.filter(a => ids.has(a.id));
    setClipboard(copies);
  };

  const pasteFromClipboard = () => {
    if (clipboard.length === 0) return;
    const offset = 12; // visible nudge so the paste isn't directly behind the source
    const next = [...state.annotations];
    const newIds = new Set<string>();
    for (const c of clipboard) {
      const id = Math.random().toString(36).slice(2, 10);
      const copy = { ...c, id, x: c.x + offset, y: c.y + offset } as Annotation;
      next.push(copy);
      newIds.add(id);
    }
    mutate({ annotations: next });
    setSelectedIds(newIds);
    setActiveId(newIds.size === 1 ? [...newIds][0] : null);
  };

  const duplicateSelected = () => {
    copySelected();
    pasteFromClipboard();
  };

  const selectAllOnPage = () => {
    const ids = new Set<string>();
    for (const a of state.annotations) if (a.page === activePage) ids.add(a.id);
    setSelectedIds(ids);
  };

  // ─── Layer visibility ─────────────────────────────────────────
  const toggleLayer = (layer: string) => {
    const v = prefs.layerVisibility[layer] !== false;
    setPrefs({ ...prefs, layerVisibility: { ...prefs.layerVisibility, [layer]: !v } });
  };
  const visibleAnnotations = useMemo(() => {
    return state.annotations.filter(a => !a.layer || prefs.layerVisibility[a.layer] !== false);
  }, [state.annotations, prefs.layerVisibility]);

  // ─── JSON annotation export / import ──────────────────────────
  const exportJson = () => {
    const data = JSON.stringify({
      version: 1,
      fileName,
      meta: state.meta,
      pageCount: state.pageOrder.length,
      annotations: state.annotations,
      bates: state.bates,
      watermark: state.watermark,
      exportedAt: new Date().toISOString(),
    }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${(fileName || 'document').replace(/\.pdf$/i, '')}-annotations.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const importJson = (file: File) => {
    file.text().then(text => {
      try {
        const data = JSON.parse(text);
        if (!Array.isArray(data?.annotations)) throw new Error('Invalid annotation file');
        mutate({
          annotations: data.annotations as Annotation[],
          bates: data.bates ?? state.bates,
          watermark: data.watermark ?? state.watermark,
        });
        setSavedNotice(`Imported ${data.annotations.length} annotations.`);
      } catch (err) {
        setError(`Could not import annotations: ${err instanceof Error ? err.message : 'parse error'}`);
      }
    });
  };

  const handlePrint = () => {
    window.print();
  };

  // ─── Recent files (localStorage-backed quick-access) ─────────
  useEffect(() => {
    if (!state.sourceFileId || !fileName) return;
    try {
      const raw = localStorage.getItem('rmpg-pdf-editor-recent') ?? '[]';
      const list = JSON.parse(raw) as RecentFile[];
      const entry: RecentFile = { fileId: state.sourceFileId, fileName, folderId: state.sourceFolderId ?? null, openedAt: Date.now() };
      const filtered = list.filter(r => r.fileId !== entry.fileId);
      filtered.unshift(entry);
      localStorage.setItem('rmpg-pdf-editor-recent', JSON.stringify(filtered.slice(0, 10)));
    } catch { /* ignore */ }
  }, [state.sourceFileId, fileName, state.sourceFolderId]);

  // Page operations.
  /** Move a page from one visual index to another. Used by both the up/down
   *  arrow buttons (single-step) and the new drag-to-reorder gesture (any
   *  distance). Annotations on moved pages have their page numbers
   *  re-indexed so they stay attached to their pages. */
  const reorderPages = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const order = [...state.pageOrder];
    const pages = [...state.pages];
    const [movedOrder] = order.splice(fromIdx, 1);
    const [movedPage] = pages.splice(fromIdx, 1);
    order.splice(toIdx, 0, movedOrder);
    pages.splice(toIdx, 0, movedPage);
    // Build a "old page number → new page number" map so annotations
    // stay attached to the page they were authored on.
    const oldToNew = new Map<number, number>();
    state.pageOrder.forEach((_v, oldIdx) => {
      let newIdx = oldIdx;
      if (oldIdx === fromIdx) newIdx = toIdx;
      else if (fromIdx < toIdx && oldIdx > fromIdx && oldIdx <= toIdx) newIdx = oldIdx - 1;
      else if (fromIdx > toIdx && oldIdx >= toIdx && oldIdx < fromIdx) newIdx = oldIdx + 1;
      oldToNew.set(oldIdx + 1, newIdx + 1);
    });
    const annotations = state.annotations.map(a => {
      const newPage = oldToNew.get(a.page);
      return newPage && newPage !== a.page ? { ...a, page: newPage } : a;
    });
    mutate({ pageOrder: order, pages, annotations });
  };

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

  // Page-level operations specific to alterations.
  const setPageCrop = (visualIdx: number, crop: PageCrop | null) => {
    const pages = [...state.pages];
    if (!pages[visualIdx]) return;
    pages[visualIdx] = { ...pages[visualIdx], crop };
    mutate({ pages });
    setTool('select');
  };

  const extractPage = async (visualIdx: number) => {
    if (!bytes) return;
    try {
      setSaving(true);
      const fullState: EditorState = {
        bytes, fileName,
        pageOrder: state.pageOrder, pages: state.pages,
        annotations: state.annotations, bates: state.bates,
        watermark: state.watermark, meta: state.meta,
        sourceFileId: state.sourceFileId, sourceFolderId: state.sourceFolderId,
      };
      const out = await extractPagesAsBytes(fullState, [visualIdx + 1]);
      const blob = new Blob([out as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const base = fileName.replace(/\.pdf$/i, '') || 'document';
      a.href = url; a.download = `${base}-page-${visualIdx + 1}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      setError(`Extract failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // Server-side qpdf encryption pass over a finished PDF byte buffer.
  // Returns the original bytes if encryption isn't configured.
  const maybeEncrypt = async (bytesIn: Uint8Array): Promise<Uint8Array> => {
    if (!encryption) return bytesIn;
    const form = new FormData();
    form.append('pdf', new Blob([bytesIn as BlobPart], { type: 'application/pdf' }), 'edited.pdf');
    form.append('userPassword', encryption.userPassword);
    form.append('ownerPassword', encryption.ownerPassword);
    form.append('bitLength', String(encryption.bitLength));
    form.append('permissions.print', encryption.permissions.print);
    form.append('permissions.modify', encryption.permissions.modify);
    form.append('permissions.extract', String(encryption.permissions.extract));
    form.append('permissions.accessibility', String(encryption.permissions.accessibility));
    form.append('permissions.fillForms', String(encryption.permissions.fillForms));

    const token = localStorage.getItem('rmpg_token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch('/api/pdf-tools/encrypt', { method: 'POST', headers, body: form });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let detail = text;
      try { detail = JSON.parse(text)?.error ?? text; } catch { /* ignore */ }
      if (res.status === 503) throw new Error(`PDF encryption not available: ${detail}`);
      throw new Error(`Encryption failed: ${detail.slice(0, 200)}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  };

  // Build the editor state ready for save, with blank pages stripped + page
  // numbers reindexed. Returns the EditorState and a flag indicating blanks
  // were dropped (so we can warn the user once).
  const buildSavableState = (): { state: EditorState; hadBlanks: boolean } => {
    const fullState: EditorState = {
      bytes: bytes!, fileName,
      pageOrder: state.pageOrder, pages: state.pages,
      annotations: state.annotations, bates: state.bates,
      watermark: state.watermark, meta: state.meta,
      sourceFileId: state.sourceFileId, sourceFolderId: state.sourceFolderId,
    };
    const hadBlanks = state.pageOrder.some(p => p === 0);
    if (!hadBlanks) return { state: fullState, hadBlanks };
    const map: number[] = [];
    const order = state.pageOrder.filter((p, i) => { if (p !== 0) { map.push(i); return true; } return false; });
    const pages = map.map(i => state.pages[i]);
    const annotations = state.annotations
      .filter(a => state.pageOrder[a.page - 1] !== 0)
      .map(a => ({ ...a, page: map.indexOf(a.page - 1) + 1 }));
    return { state: { ...fullState, pageOrder: order, pages, annotations }, hadBlanks };
  };

  const onSave = async () => {
    if (!bytes) return;
    setSaving(true);
    try {
      const { state: savable, hadBlanks } = buildSavableState();
      if (hadBlanks) setError('Note: inserted blank pages are ignored in this save.');
      let outBytes = await buildPdfFromEditorState(savable);
      outBytes = await maybeEncrypt(outBytes);
      const blob = new Blob([outBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const base = fileName.replace(/\.pdf$/i, '') || 'document';
      a.href = url;
      a.download = `${base}${encryption ? '-encrypted' : '-edited'}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      if (encryption) setSavedNotice('Encrypted PDF downloaded. Owner password is required to remove restrictions later.');
    } catch (err) {
      setError(`Save failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  // Save edited copy back into the Documents store as a new file. If
  // encryption is configured we encrypt the bytes before uploading so the
  // ciphertext is what lands in the document store (chain-of-custody intact).
  const onSaveToDocuments = async () => {
    if (!bytes) return;
    setSaving(true);
    try {
      const { state: savable } = buildSavableState();
      if (encryption) {
        const built = await buildPdfFromEditorState(savable);
        const encrypted = await maybeEncrypt(built);
        // Upload pre-built bytes via FormData (saveToDocuments rebuilds, so we
        // bypass it here for the encrypted variant).
        const base = fileName.replace(/\.pdf$/i, '') || 'document';
        const file = new File([encrypted as BlobPart], `${base}-encrypted.pdf`, { type: 'application/pdf' });
        const form = new FormData();
        form.append('files', file);
        if (savable.sourceFolderId != null) form.append('folder_id', String(savable.sourceFolderId));
        const token = localStorage.getItem('rmpg_token');
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/uploads', { method: 'POST', headers, body: form });
        if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
        const data = await res.json();
        setSavedNotice(`Saved encrypted PDF as “${data.files?.[0]?.original_name}” in Documents.`);
      } else {
        const result = await saveToDocuments(savable, { folderId: savable.sourceFolderId });
        setSavedNotice(`Saved as “${result.original_name}” in Documents.`);
      }
      setTimeout(() => setSavedNotice(null), 8000);
    } catch (err) {
      setError(`Save to Documents failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  // ─── Zoom presets ───────────────────────────────────────────
  const fitPage = () => {
    const root = scrollerRef.current;
    if (!root || !state.pages[0]) return;
    const meta = state.pages[0];
    const availW = root.clientWidth - 32;
    const availH = root.clientHeight - 80;
    const z = Math.min(availW / meta.width, availH / meta.height, 3);
    setZoom(Math.max(0.3, z));
  };
  const fitWidth = () => {
    const root = scrollerRef.current;
    if (!root || !state.pages[0]) return;
    const meta = state.pages[0];
    const availW = root.clientWidth - 32;
    setZoom(Math.max(0.3, Math.min(availW / meta.width, 3)));
  };

  // Keyboard shortcuts (full set — see KeyboardShortcutsDialog for the listing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const meta = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (meta && k === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'undo' }); return; }
      if (meta && (k === 'y' || (e.shiftKey && k === 'z'))) { e.preventDefault(); dispatch({ type: 'redo' }); return; }
      if (meta && k === 's') { e.preventDefault(); onSave(); return; }
      if (meta && k === 'f') { e.preventDefault(); setFindOpen(true); return; }
      if (meta && k === 'c') { e.preventDefault(); copySelected(); return; }
      if (meta && k === 'v') { e.preventDefault(); pasteFromClipboard(); return; }
      if (meta && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (meta && k === 'a') { e.preventDefault(); selectAllOnPage(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (activeId || selectedIds.size > 0) { e.preventDefault(); deleteActive(); }
        return;
      }
      if (e.key === 'Escape') { setActiveId(null); setSelectedIds(new Set()); setTool('select'); setFindOpen(false); return; }
      if (e.key === '+' || e.key === '=') { setZoom(z => Math.min(3, z + 0.1)); return; }
      if (e.key === '-') { setZoom(z => Math.max(0.3, z - 0.1)); return; }
      if (e.key === '0') { setZoom(1); return; }
      if (e.key === '1') { fitPage(); return; }
      if (e.key === '2') { fitWidth(); return; }
      if (e.key === 'PageDown') { jumpToPage(Math.min(state.pageOrder.length - 1, activePage)); return; }
      if (e.key === 'PageUp') { jumpToPage(Math.max(0, activePage - 2)); return; }
      if (e.key === 'Home') { jumpToPage(0); return; }
      if (e.key === 'End') { jumpToPage(state.pageOrder.length - 1); return; }
      if (e.key === '?') { setShortcutsOpen(true); return; }
      // Arrow-key nudge for selected annotations — Acrobat parity. Shift = 10x.
      if (e.key.startsWith('Arrow') && (activeId || selectedIds.size > 0)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        else if (e.key === 'ArrowRight') dx = step;
        else if (e.key === 'ArrowUp') dy = -step;
        else if (e.key === 'ArrowDown') dy = step;
        const ids = selectedIds.size > 0 ? selectedIds : new Set([activeId!]);
        const next = state.annotations.map(a =>
          ids.has(a.id) && !a.locked ? { ...a, x: a.x + dx, y: a.y + dy } as Annotation : a);
        mutate({ annotations: next });
        return;
      }
      const map: Record<string, Tool> = { v: 'select', h: 'hand', t: 'text', y: 'highlight', r: 'rect', e: 'ellipse', l: 'line', a: 'arrow', p: 'pen', n: 'sticky' };
      if (!meta && map[k]) { setTool(map[k]); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, selectedIds, state.annotations, activePage]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Hand off to the editing experience: clears ?view=1 from the URL and
  // re-renders with all tools enabled. State (annotations, etc.) persists
  // because we just toggle a query param.
  const enableEditing = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('view');
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="p-3 flex flex-col h-[calc(100vh-140px)] min-h-[600px]">
      <PanelTitleBar title={viewOnly ? 'PDF VIEWER' : 'PDF EDITOR'} icon={FileText} />

      <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleOpenChange} />
      <input ref={mergeInputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={handleMergeChange} />
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleImageChange} />
      <input ref={jsonInputRef} type="file" accept="application/json" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ''; }} />

      {/* Find / Shortcuts / Preferences dialogs */}
      <FindDialog open={findOpen} onClose={() => setFindOpen(false)} currentPage={activePage}
        onJumpTo={(page) => jumpToPage(page - 1)} />
      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <PreferencesDialog open={prefsOpen} prefs={prefs} onChange={setPrefs} onClose={() => setPrefsOpen(false)} />
      <CustomStampsGallery open={stampsOpen}
        onClose={() => { setStampsOpen(false); if (tool === 'stamp' && !pendingStamp) setTool('select'); }}
        onPick={handleStampPick} />

      {/* Right-click context menu for annotations */}
      <AnnotationContextMenu
        open={!!contextMenu}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        annotation={contextMenu ? state.annotations.find(a => a.id === contextMenu.annotationId) ?? null : null}
        onClose={() => setContextMenu(null)}
        onDuplicate={() => { if (contextMenu) { setActiveId(contextMenu.annotationId); duplicateSelected(); } }}
        onDelete={() => { if (contextMenu) { mutate({ annotations: state.annotations.filter(a => a.id !== contextMenu.annotationId) }); setActiveId(null); } }}
        onToggleLock={() => contextMenu && toggleLock(contextMenu.annotationId)}
        onBringForward={() => contextMenu && bringForward(contextMenu.annotationId)}
        onSendBackward={() => contextMenu && sendBackward(contextMenu.annotationId)}
        onAssignLayer={(layer) => {
          if (!contextMenu) return;
          const idx = state.annotations.findIndex(a => a.id === contextMenu.annotationId);
          if (idx === -1) return;
          const next = [...state.annotations];
          next[idx] = { ...next[idx], layer: layer || undefined } as Annotation;
          mutate({ annotations: next });
        }}
      />

      {/* Mini-map page navigator — floating bottom-right when toggled. */}
      {hasDocument && showMiniMap && (
        <MiniMap
          pdfBytes={bytes}
          pages={state.pages}
          pageOrder={state.pageOrder}
          activePage={activePage}
          onJumpTo={jumpToPage}
          onClose={() => setShowMiniMap(false)}
        />
      )}

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
          onSaveToDocuments={onSaveToDocuments}
          onUndo={() => dispatch({ type: 'undo' })}
          onRedo={() => dispatch({ type: 'redo' })}
          onZoomIn={() => setZoom(z => Math.min(3, z + 0.1))}
          onZoomOut={() => setZoom(z => Math.max(0.3, z - 0.1))}
          onZoomReset={() => setZoom(1)}
          onMetadata={() => {}}
          onBates={() => {}}
          onWatermark={() => {}}
          onEncrypt={() => setEncryptionOpen(true)}
          encryptionActive={!!encryption}
          onClearEncryption={() => setEncryption(null)}
          saving={saving}
        />
      </div>

      {error && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 text-yellow-200 text-[11px] px-3 py-1.5 rounded-sm mb-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> <div>{error}</div>
          <button type="button" onClick={() => setError(null)} className="ml-auto text-yellow-300 hover:text-white">×</button>
        </div>
      )}
      {savedNotice && (
        <div className="bg-green-900/20 border border-green-700/40 text-green-200 text-[11px] px-3 py-1.5 rounded-sm mb-2 flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> <div>{savedNotice}</div>
          <button type="button" onClick={() => navigate('/documents')} className="ml-auto text-green-300 hover:text-white text-[10px]">Open Documents →</button>
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

      {/* Quick-action strip: find / annotations panel toggle / shortcuts /
          prefs / JSON I/O / print. These are kept out of the main EditorToolbar
          so that toolbar stays tight; quick actions live just below it. */}
      {hasDocument && !viewOnly && (
        <div className="flex items-center gap-1 bg-[#0d0d0d] border border-[#222] rounded-[2px] px-2 py-1 mb-2 text-[10px] text-rmpg-300">
          <button type="button" onClick={() => setFindOpen(true)} title="Find in document (Ctrl+F)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Search className="w-3 h-3" /> Find</button>
          <button type="button" onClick={() => setPrefs({ ...prefs, showAnnotationsPanel: !prefs.showAnnotationsPanel })}
            title="Toggle annotations panel"
            className={`px-2 py-0.5 rounded-sm inline-flex items-center gap-1 ${prefs.showAnnotationsPanel ? 'bg-[#d4a017]/20 text-[#d4a017]' : 'hover:bg-rmpg-700/40'}`}>
            <Layers className="w-3 h-3" /> Panel ({state.annotations.length})
          </button>
          <button type="button" onClick={() => setShowMiniMap(v => !v)}
            title="Toggle mini-map page navigator"
            className={`px-2 py-0.5 rounded-sm inline-flex items-center gap-1 ${showMiniMap ? 'bg-[#d4a017]/20 text-[#d4a017]' : 'hover:bg-rmpg-700/40'}`}>
            <MapIcon className="w-3 h-3" /> Mini-map
          </button>
          <button type="button" onClick={() => setForcePdfjs(v => !v)}
            title="Force the compatibility engine (PDF.js). Use if a page renders blank with the native engine."
            className={`px-2 py-0.5 rounded-sm inline-flex items-center gap-1 ${forcePdfjs ? 'bg-[#d4a017]/20 text-[#d4a017]' : 'hover:bg-rmpg-700/40'}`}>
            {forcePdfjs ? '✓ Compat engine' : 'Compat engine'}
          </button>
          <button type="button" onClick={exportJson} title="Export annotations as JSON"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Download className="w-3 h-3" /> Export</button>
          <button type="button" onClick={() => jsonInputRef.current?.click()} title="Import annotations from JSON"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><UploadIcon className="w-3 h-3" /> Import</button>
          <button type="button" onClick={handlePrint} title="Print"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Printer className="w-3 h-3" /> Print</button>
          <div className="flex-1" />
          <select value={prefs.viewMode} onChange={(e) => setPrefs({ ...prefs, viewMode: e.target.value as EditorPreferences['viewMode'] })}
            className="bg-[#0a0a0a] border border-[#222] text-[10px] text-rmpg-200 px-1.5 py-0.5 rounded-sm">
            <option value="continuous">Continuous</option>
            <option value="single">Single page</option>
            <option value="two-up">Two-up</option>
          </select>
          <button type="button" onClick={fitPage} title="Fit page (1)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm">Fit page</button>
          <button type="button" onClick={fitWidth} title="Fit width (2)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm">Fit width</button>
          <button type="button" onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts (?)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Keyboard className="w-3 h-3" /> ?</button>
          <button type="button" onClick={() => setPrefsOpen(true)} title="Editor preferences"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Settings className="w-3 h-3" /></button>
          {selectedIds.size > 0 && (
            <span className="text-[#d4a017]">{selectedIds.size} selected</span>
          )}
        </div>
      )}

      {hasDocument && viewOnly && (
        <div className="bg-[#0d0d0d] border border-[#222222] rounded-[2px] px-3 py-1.5 mb-2 flex items-center gap-2 text-[10px] text-rmpg-400">
          <span className="text-[#d4a017] font-semibold uppercase tracking-wider">View-only</span>
          <span>— editing tools are hidden. Click "Edit this PDF" to enable annotation, redaction, signatures, and more.</span>
          <button type="button" onClick={enableEditing} className="ml-auto btn-secondary text-[10px]">Edit this PDF</button>
        </div>
      )}

      {hasDocument && (
        <div className="flex-1 flex gap-2 min-h-0">
          {!viewOnly && (
            <ToolPalette tool={tool} onTool={setTool} color={color} onColor={setColor} strokeWidth={strokeWidth} onStrokeWidth={setStrokeWidth} />
          )}

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
            onExtract={extractPage}
            onClearCrop={(idx) => setPageCrop(idx, null)}
            onReorder={reorderPages}
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
                onSetCrop={setPageCrop}
                onAnnotationContextMenu={(id, x, y) => setContextMenu({ annotationId: id, x, y })}
                forcePdfjs={forcePdfjs}
              />
            ))}
          </div>

          {!viewOnly && prefs.showAnnotationsPanel && (
            <AnnotationsPanel
              annotations={state.annotations}
              activeIds={selectedIds.size > 0 ? selectedIds : new Set(activeId ? [activeId] : [])}
              layerVisibility={prefs.layerVisibility}
              onSelect={selectAnnotation}
              onToggleLock={toggleLock}
              onDelete={(id) => { mutate({ annotations: state.annotations.filter(a => a.id !== id) }); }}
              onBringForward={bringForward}
              onSendBackward={sendBackward}
              onJumpToPage={(p) => jumpToPage(p - 1)}
              onToggleLayer={toggleLayer}
            />
          )}
          {!viewOnly && (
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
          )}
        </div>
      )}

      {/* Engine attribution — surfaces which backend rendered each document
          so operators can see when our native renderer covers a doc vs.
          when we fall back to PDF.js. */}
      {hasDocument && <EnginePanel />}

      <SignaturePad
        open={signatureOpen}
        onClose={() => { setSignatureOpen(false); if (!pendingImage) setTool('select'); }}
        onConfirm={(dataUrl) => { setPendingImage(dataUrl); setTool('signature'); }}
      />

      <BarcodeDialog
        open={barcodeOpen}
        onClose={() => { setBarcodeOpen(false); if (!pendingImage) setTool('select'); }}
        onConfirm={(dataUrl) => { setPendingImage(dataUrl); setTool('barcode'); }}
      />

      <EncryptionDialog
        open={encryptionOpen}
        onClose={() => setEncryptionOpen(false)}
        onConfirm={(cfg) => setEncryption(cfg)}
      />
    </div>
  );
}

// Status panel that subscribes to the engine's diagnostics registry and
// surfaces which backend rendered each document. Helps operators see when
// the native engine handles a doc vs. when we fall back to PDF.js.
function EnginePanel(): React.ReactElement {
  const [, force] = useState(0);
  useEffect(() => subscribeDiagnostics(() => force(t => t + 1)), []);
  const summary = diagnosticsSummary();
  const last = getDiagnostics()[0];
  return (
    <div className="text-[9px] text-rmpg-600 mt-2 text-center select-none">
      <div>
        <span className="text-rmpg-500 font-semibold">RMPG PDF Engine</span> ·
        Native: <span className="text-[#d4a017]">{summary.native}</span> · PDF.js fallback: <span className="text-rmpg-500">{summary.pdfjs}</span>
        {last && <> · last: <span className="text-rmpg-400">{last.backend}</span> ({last.reason.slice(0, 80)}{last.reason.length > 80 ? '…' : ''})</>}
      </div>
      <div className="mt-0.5">
        RMPG PDF Engine v1.0 — proprietary facade + writer; PDF.js (Mozilla, Apache 2.0) handles rendering for the long tail of document features (images, embedded fonts, cross-ref streams). Native renderer covers RMPG-generated PDFs and grows over time.
      </div>
    </div>
  );
}
