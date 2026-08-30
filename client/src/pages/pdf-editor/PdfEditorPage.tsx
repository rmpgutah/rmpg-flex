import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { FileText, AlertTriangle, CheckCircle2, Search, Settings, Keyboard, Layers, Printer, Download, Upload as UploadIcon, Map as MapIcon, FileOutput, EyeOff, Heading, Bookmark as BookmarkIcon, FilePlus2, FileText as FileTextIcon, ChevronsLeft, ChevronsRight, Image as ImageDownIcon, Crop as CropIcon, RotateCw as RotateCwIcon, Scissors, Wrench, GitCompare, FileSignature, ClipboardList, Copy as CopyIcon, LayoutGrid, Grid2x2, Hash, Grid3x3, Layers2, MessageSquare, Square, Ruler, FileInput, Sun, Moon, Star, Type as TypeIcon, Maximize2, PenLine } from 'lucide-react';
import { open as openPdf, RmpgPdfDocument, subscribeDiagnostics, diagnosticsSummary, getDiagnostics } from '../../lib/rmpg-pdf-engine';
import { exportAnnotationsAsCsv, exportAnnotationsAsMarkdown, exportAnnotationsAsXfdf, downloadText } from './exporters';
import { useAuth } from '../../context/AuthContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import PanelTitleBar from '../../components/PanelTitleBar';
import EditorToolbar from './components/EditorToolbar';
import ToolPalette from './components/ToolPalette';
import ThumbnailSidebar from './components/ThumbnailSidebar';
import PageCanvas from './components/PageCanvas';
import PropertiesPanel from './components/PropertiesPanel';
import SignaturePad from './components/SignaturePad';
import TypedSignatureDialog from './components/TypedSignatureDialog';
import PresentationView from './components/PresentationView';
import BarcodeDialog from './components/BarcodeDialog';
import EncryptionDialog, { EncryptionConfig } from './components/EncryptionDialog';
import AnnotationsPanel from './components/AnnotationsPanel';
import FindDialog from './components/FindDialog';
import KeyboardShortcutsDialog from './components/KeyboardShortcutsDialog';
import PreferencesDialog from './components/PreferencesDialog';
import CustomStampsGallery, { StampPick } from './components/CustomStampsGallery';
import StampStudio from './components/StampStudio';
import MiniMap from './components/MiniMap';
import AnnotationContextMenu from './components/AnnotationContextMenu';
import ExportRangeDialog from './components/ExportRangeDialog';
import HeaderFooterDialog from './components/HeaderFooterDialog';
import RedactPatternDialog from './components/RedactPatternDialog';
import InsertPageDialog from './components/InsertPageDialog';
import BookmarksPanel from './components/BookmarksPanel';
import { Annotation, AnnotationPreset, BatesConfig, Bookmark, DocumentMeta, EditorState, EditorPreferences, HeaderFooterConfig, MeasureCalibration, DEFAULT_PREFERENCES, PageCrop, PageLabelRule, PageMeta, PageNumbersConfig, RecentFile, StampLabel, StickyCategory, STICKY_CATEGORIES, Tool, WatermarkConfig, DEFAULT_RENDER_SCALE } from './types';
import { appendPdfBytes, blankTemplatePageBytes, buildAnnotationReportPdf, buildInteractivePdf, buildNUpPdf, buildPdfFromEditorState, comparePageDiff, deskewPageBytes, extractAllText, extractPagesAsBytes, findRedactionBoxes, grayscalePageBytes, imageToPdfPageBytes, insertPdfBytesAt, mergePdfFiles, normalizeUploadResponse, optimizePdf, PAGE_SIZE_PRESETS, resizePages, saveToDocuments, splitEveryN, splitPdf, type OutlineNode } from './save';
import CalibrationDialog from './components/CalibrationDialog';
import InsertFromPdfDialog from './components/InsertFromPdfDialog';
import PdfToolsDialog from './components/PdfToolsDialog';
import CompareDialog from './components/CompareDialog';
import PageOrganizer from './components/PageOrganizer';
import NUpDialog from './components/NUpDialog';
import PageLabelsDialog from './components/PageLabelsDialog';
import { alignAnnotations, applyAnnotationToAllPages, distributeAnnotations, matchSize, type AlignMode, type DistributeMode, type MatchSizeMode } from './annotationOps';
import AlignmentBar from './components/AlignmentBar';
import { authedImageUrl, uploadsUrl } from '../../hooks/useApi';
import ConfirmDialog from '../../components/ConfirmDialog';
import PromptDialog from '../../components/PromptDialog';
import { parseTimestamp } from '../../utils/dateUtils';
import { importWithRetry } from '../../utils/importWithRetry';

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
  pageNumbers: PageNumbersConfig | null;
  headerFooter: HeaderFooterConfig | null;
  pageLabels: PageLabelRule[];
  bookmarks: Bookmark[];
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
  | { type: 'snapshot' }                     // push current present to history, present unchanged
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; next: MutableState };

function reducer(h: History, a: Action): History {
  switch (a.type) {
    case 'replace': return { ...h, present: a.next };
    case 'mutate': return { past: [...h.past, h.present].slice(-50), present: a.next, future: [] };
    // Snapshot the pre-gesture state into history ONCE, then let live drag/resize
    // moves use 'replace' (no history). Without this, every pointer-move frame of
    // a drag pushed an undo entry — one drag exhausted the 50-step history and
    // Undo only nudged the annotation back a frame at a time.
    case 'snapshot': return { ...h, past: [...h.past, h.present].slice(-50), future: [] };
    case 'undo': return h.past.length === 0 ? h : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
    case 'redo': return h.future.length === 0 ? h : { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
    case 'reset': return { past: [], present: a.next, future: [] };
  }
}

const EMPTY_STATE: MutableState = { pageOrder: [], pages: [], annotations: [], bates: null, watermark: null, pageNumbers: null, headerFooter: null, pageLabels: [], bookmarks: [], meta: {}, sourceFileId: null, sourceFolderId: null };

/** Convert the flat bookmark list (each carrying an optional parentId) into a
 *  nested OutlineNode tree for the saved /Outlines. Top-level bookmarks come
 *  first; each child is attached under its parent. Orphaned children (parent
 *  missing) fall back to top-level so nothing is silently dropped. */
function buildOutlineTree(bookmarks: Bookmark[]): OutlineNode[] {
  const byId = new Map(bookmarks.map(b => [b.id, b]));
  const roots: OutlineNode[] = [];
  const nodeFor = new Map<string, OutlineNode>();
  for (const b of bookmarks) nodeFor.set(b.id, { title: b.title, page: b.page, children: [] });
  for (const b of bookmarks) {
    const node = nodeFor.get(b.id)!;
    const parent = b.parentId && byId.has(b.parentId) ? nodeFor.get(b.parentId) : undefined;
    if (parent) parent.children!.push(node);
    else roots.push(node);
  }
  return roots;
}

export default function PdfEditorPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  // On mobile the canvas needs the full width, so the tool palette and page
  // thumbnail rail collapse to off-canvas drawers toggled from the action
  // strip. Desktop (>=768px) keeps them always-docked (these flags are ignored).
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [mobileThumbsOpen, setMobileThumbsOpen] = useState(false);
  // Lightweight toast queue for action feedback. Kept in state instead of a
  // separate provider — only used inside the editor and dies with the page.
  const [toasts, setToasts] = useState<Array<{ id: string; text: string; kind: 'info' | 'ok' | 'warn' }>>([]);
  const pushToast = useCallback((text: string, kind: 'info' | 'ok' | 'warn' = 'info') => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts(prev => [...prev, { id, text, kind }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);
  // View-only mode hides editing tools — used for previewing PDFs from
  // Documents without giving the operator the full editing surface by default.
  const viewOnly = searchParams.get('view') === '1';
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  // The PDF parsed ONCE and shared with every PageCanvas. Without this, each
  // page re-opens and re-parses the whole document (an N-page PDF parsed N
  // times), which is what produced the multi-second main-thread render stalls.
  // A ref mirrors the state so we can destroy the previous document
  // synchronously when a new file is opened or the editor unmounts.
  const [doc, setDoc] = useState<RmpgPdfDocument | null>(null);
  const docRef = useRef<RmpgPdfDocument | null>(null);
  const setSharedDoc = useCallback((next: RmpgPdfDocument | null) => {
    const prev = docRef.current;
    docRef.current = next;
    setDoc(next);
    if (prev && prev !== next) prev.destroy().catch(() => { /* already gone */ });
  }, []);
  useEffect(() => () => { docRef.current?.destroy().catch(() => {}); }, []);
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
  // Typed-signature generator (cursive name / initials / quick-sign block).
  const [typedSigMode, setTypedSigMode] = useState<'signature' | 'initials' | 'quicksign' | null>(null);
  // When a quick-sign is pending, the next signature placement also drops a
  // date stamp + initials beside it (sign-off block).
  const [pendingQuickSign, setPendingQuickSign] = useState<{ dateText: string; initials: string } | null>(null);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [encryptionOpen, setEncryptionOpen] = useState(false);
  const [encryption, setEncryption] = useState<EncryptionConfig | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [stampsOpen, setStampsOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [headerFooterOpen, setHeaderFooterOpen] = useState(false);
  const [redactOpen, setRedactOpen] = useState(false);
  const [redactScanning, setRedactScanning] = useState(false);
  const [insertPageOpen, setInsertPageOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);     // split / optimize / page-size / grayscale
  const [compareOpen, setCompareOpen] = useState(false); // two-PDF compare
  const [organizerOpen, setOrganizerOpen] = useState(false); // full-page organizer grid
  const [nUpOpen, setNUpOpen] = useState(false);         // N-up imposition export
  const [labelsOpen, setLabelsOpen] = useState(false);   // custom page-label rules
  const [calibrationOpen, setCalibrationOpen] = useState(false); // measurement scale
  const [insertPdfOpen, setInsertPdfOpen] = useState(false);     // insert another PDF at a position
  const [clearPageOpen, setClearPageOpen] = useState(false);
  const [clearPageCount, setClearPageCount] = useState(0);
  const [goToPageOpen, setGoToPageOpen] = useState(false);
  // Default category applied to new sticky notes (toolbar dropdown).
  const [stickyCategory, setStickyCategory] = useState<StickyCategory>('general');
  const [showBookmarks, setShowBookmarks] = useState(false);
  // Batch-page multi-select (thumbnail rail). When non-empty, batch-rotate and
  // crop-all act on this set instead of the single active page.
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [showMiniMap, setShowMiniMap] = useState(false);
  // Presentation / full-screen distraction-free page view.
  const [presentationOpen, setPresentationOpen] = useState(false);
  // Crop aspect-ratio lock for the Crop tool. 0 = free-form.
  const [cropAspect, setCropAspect] = useState(0);
  // PNG export DPI (72 / 150 / 300) — drives the render scale used by the PNG
  // and Region-PNG exporters (base render is 72 dpi at scale 1).
  const [pngDpi, setPngDpi] = useState(150);
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
  const appendInputRef = useRef<HTMLInputElement>(null);   // append another PDF
  const pageImageInputRef = useRef<HTMLInputElement>(null); // image → new page
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
      try {
        for (let i = 1; i <= pdf.numPages; i++) {
          const p = await pdf.getPage(i);
          const v = p.getViewport({ scale: DEFAULT_RENDER_SCALE });
          pages.push({ originalIndex: i, width: v.width, height: v.height, rotation: 0, crop: null });
          pageOrder.push(i);
        }
      } catch (pageErr) {
        // Don't leak the half-read document if viewport collection fails.
        try { await pdf.destroy(); } catch { /* ignore */ }
        throw pageErr;
      }
      setBytes(arr);
      // Keep the parsed document alive and share it with the page canvases
      // (and destroy any previously-open document this replaces).
      setSharedDoc(pdf);
      setFileName(name);
      dispatch({ type: 'reset', next: { pageOrder, pages, annotations: [], bates: null, watermark: null, pageNumbers: null, headerFooter: null, pageLabels: [], bookmarks: [], meta: { title: name.replace(/\.pdf$/i, '') }, sourceFileId, sourceFolderId } });
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

  // Auto-load pending PDF from sessionStorage when ?from=serve is in the URL.
  // The Process Server page stores the generated Notice of Attempt PDF bytes
  // in sessionStorage before navigating here so the user can annotate, sign,
  // and add stamps before printing.
  useEffect(() => {
    const from = searchParams.get('from');
    const nameParam = searchParams.get('name');
    if (from !== 'serve' || bytes) return;
    try {
      const raw = sessionStorage.getItem('rmpg-pdf-editor-pending');
      if (!raw) return;
      sessionStorage.removeItem('rmpg-pdf-editor-pending');
      const { bytes: base64, filename } = JSON.parse(raw);
      const binary = atob(base64);
      const arr = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
      openBytes(arr, nameParam || filename || 'Notice of Attempt.pdf');
    } catch {
      // sessionStorage may be empty or corrupted — just show the empty editor.
    }
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
    // Auto-stamp every new annotation with author + creation time + a default
    // 'open' status. These flow through to CSV / XFDF / Markdown exports
    // and the AnnotationsPanel so reviewers can audit who added what when.
    const stamped: Annotation = {
      ...a,
      authorName: a.authorName ?? user?.full_name ?? user?.username ?? 'unknown',
      authorId: a.authorId ?? (typeof user?.id === 'number' ? user.id : undefined),
      createdAt: a.createdAt ?? new Date().toISOString(),
      status: a.status ?? 'open',
    };
    const extra: Annotation[] = [];
    // Quick-sign: when a signature image lands and a sign-off is pending, drop
    // today's date and the operator's initials immediately below it, then clear
    // the pending state and the staged image so the tool resets.
    if (pendingQuickSign && stamped.type === 'signature') {
      const author = stamped.authorName;
      const baseY = stamped.y + stamped.h + 4;
      extra.push({ id: Math.random().toString(36).slice(2, 10), type: 'text', page: stamped.page, x: stamped.x, y: baseY, w: 0, h: 0, text: pendingQuickSign.dateText, fontSize: 11, color: '#0a0a0a', authorName: author, createdAt: new Date().toISOString(), status: 'open' } as Annotation);
      extra.push({ id: Math.random().toString(36).slice(2, 10), type: 'text', page: stamped.page, x: stamped.x + stamped.w - 50, y: baseY, w: 0, h: 0, text: pendingQuickSign.initials, fontSize: 11, bold: true, color: '#0a0a0a', authorName: author, createdAt: new Date().toISOString(), status: 'open' } as Annotation);
      setPendingQuickSign(null);
      setPendingImage(null);
    }
    mutate({ annotations: [...state.annotations, stamped, ...extra] });
    setActiveId(stamped.id);
    if (tool !== 'pen' && tool !== 'highlight' && tool !== 'redact') setTool('select');
  }, [state.annotations, mutate, tool, user, pendingQuickSign]);

  const updateAnnotation = useCallback((id: string, patch: Partial<Annotation>) => {
    const idx = state.annotations.findIndex(a => a.id === id);
    if (idx === -1) return;
    const cur = state.annotations[idx];
    const next = [...state.annotations];
    next[idx] = { ...cur, ...patch } as Annotation;
    mutate({ annotations: next });
  }, [state.annotations, mutate]);

  // Live (non-history) annotation update for in-progress drag/resize. PageCanvas
  // calls transformStart() once on the first move of a gesture (which snapshots
  // the pre-gesture state into history), then streams updateAnnotationLive for
  // every subsequent move. Net effect: one undo step per drag, not per frame.
  const updateAnnotationLive = useCallback((id: string, patch: Partial<Annotation>) => {
    const idx = state.annotations.findIndex(a => a.id === id);
    if (idx === -1) return;
    const next = [...state.annotations];
    next[idx] = { ...next[idx], ...patch } as Annotation;
    dispatch({ type: 'replace', next: { ...state, annotations: next } });
  }, [state]);
  const transformStart = useCallback(() => dispatch({ type: 'snapshot' }), []);

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

  // Rotate a single annotation by +90° (clockwise on screen). Normalised into
  // the (-180, 180] range used by the rotation slider.
  const rotateAnnotation90 = (id: string) => {
    const idx = state.annotations.findIndex(a => a.id === id);
    if (idx === -1) return;
    const cur = state.annotations[idx];
    let r = (Math.round((cur.rotation ?? 0) / 90) * 90 + 90) % 360;
    if (r > 180) r -= 360;
    const next = [...state.annotations];
    next[idx] = { ...cur, rotation: r } as Annotation;
    mutate({ annotations: next });
  };

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
    setActiveId(ids.size === 1 ? [...ids][0] : null);
  };

  // Remove every annotation on the currently-active page (confirmed).
  const clearAllOnPage = () => {
    const count = state.annotations.filter(a => a.page === activePage).length;
    if (count === 0) { pushToast('No annotations on this page', 'info'); return; }
    setClearPageCount(count);
    setClearPageOpen(true);
  };

  // Toggle the simple "Page N of M" footer (distinct from Bates numbering).
  const togglePageNumbers = () => {
    if (state.pageNumbers) { mutate({ pageNumbers: null }); pushToast('Removed page-number footer', 'info'); }
    else { mutate({ pageNumbers: { position: 'bc', fontSize: 9, format: 'Page {n} of {total}' } }); pushToast('Added "Page N of M" footer', 'ok'); }
  };

  // ─── Align / distribute / match-size (multi-select arrangement) ─
  const applyAlign = (mode: AlignMode) =>
    mutate({ annotations: alignAnnotations(state.annotations, selectedIds, mode) });
  const applyDistribute = (mode: DistributeMode) =>
    mutate({ annotations: distributeAnnotations(state.annotations, selectedIds, mode) });
  const applyMatchSize = (mode: MatchSizeMode) => {
    const anchor = activeId ?? [...selectedIds].pop();
    if (!anchor) return;
    mutate({ annotations: matchSize(state.annotations, selectedIds, anchor, mode) });
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
    pushToast(`Exported ${state.annotations.length} annotations as JSON`, 'ok');
  };

  // Three additional export formats — all offline, no network calls.
  const exportCsv = () => {
    const csv = exportAnnotationsAsCsv(state.annotations, fileName);
    const base = (fileName || 'document').replace(/\.pdf$/i, '');
    downloadText(csv, `${base}-annotations.csv`, 'text/csv');
    pushToast(`Exported ${state.annotations.length} annotations as CSV`, 'ok');
  };
  const exportMarkdown = () => {
    const md = exportAnnotationsAsMarkdown(state.annotations, fileName, state.meta);
    const base = (fileName || 'document').replace(/\.pdf$/i, '');
    downloadText(md, `${base}-annotations.md`, 'text/markdown');
    pushToast('Exported annotation summary as Markdown', 'ok');
  };
  const exportXfdf = () => {
    const pageHeights = state.pages.map(p => p.height / DEFAULT_RENDER_SCALE);
    const xfdf = exportAnnotationsAsXfdf(state.annotations, pageHeights, DEFAULT_RENDER_SCALE);
    const base = (fileName || 'document').replace(/\.pdf$/i, '');
    downloadText(xfdf, `${base}-annotations.xfdf`, 'application/vnd.adobe.xfdf');
    pushToast('Exported as XFDF — paste into Acrobat to re-create', 'ok');
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

  // ─── Crash recovery (autosave annotation set every 30s) ──────
  // Persists the current annotation set + bates/watermark/meta to localStorage
  // keyed by sourceFileId. On next open of the same fileId, the editor offers
  // to restore the unsaved draft. Capped at 5 most-recent drafts to avoid
  // bloating localStorage.
  useEffect(() => {
    if (!prefs.autoSaveDrafts || !state.sourceFileId) return;
    const interval = setInterval(() => {
      try {
        const key = `rmpg-pdf-editor-draft-${state.sourceFileId}`;
        const payload = {
          annotations: state.annotations,
          bates: state.bates,
          watermark: state.watermark,
          meta: state.meta,
          savedAt: new Date().toISOString(),
        };
        localStorage.setItem(key, JSON.stringify(payload));
      } catch (err) {
        // Quota — keep going; user just won't have crash recovery this session.
        console.warn('[pdf-editor] crash-recovery autosave failed', err);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [prefs.autoSaveDrafts, state.sourceFileId, state.annotations, state.bates, state.watermark, state.meta]);

  // On document open, look for an unsaved draft and offer to restore it.
  useEffect(() => {
    if (!state.sourceFileId || state.annotations.length > 0) return;
    try {
      const key = `rmpg-pdf-editor-draft-${state.sourceFileId}`;
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { annotations?: Annotation[]; savedAt?: string };
      if (Array.isArray(parsed.annotations) && parsed.annotations.length > 0) {
        const ageMin = parsed.savedAt
          ? Math.round((Date.now() - parseTimestamp(parsed.savedAt).getTime()) / 60000)
          : -1;
        const restore = window.confirm(
          `Restore unsaved draft for this PDF? It contains ${parsed.annotations.length} annotation(s)` +
            (ageMin >= 0 ? ` from ${ageMin} minute(s) ago.` : '.')
        );
        if (restore) {
          mutate({
            annotations: parsed.annotations,
            ...(parsed as any).bates ? { bates: (parsed as any).bates } : {},
            ...(parsed as any).watermark ? { watermark: (parsed as any).watermark } : {},
          });
          pushToast(`Restored ${parsed.annotations.length} annotations`, 'ok');
        } else {
          localStorage.removeItem(key);
        }
      }
    } catch (err) {
      console.warn('[pdf-editor] crash-recovery restore failed', err);
    }
    // Only run once per sourceFileId change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sourceFileId]);

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

  // Rotate EVERY page 90° clockwise in one action (toolbar).
  const rotateAllPages = () => {
    if (state.pages.length === 0) return;
    const pages = state.pages.map(p => ({ ...p, rotation: ((p.rotation + 90) % 360) as PageMeta['rotation'] }));
    mutate({ pages });
    pushToast('Rotated all pages 90°', 'ok');
  };

  // Reverse the visual page order. Annotations are re-pointed so they stay on
  // their page (page k → pageCount+1-k).
  const reversePages = () => {
    const n = state.pageOrder.length;
    if (n <= 1) return;
    const order = [...state.pageOrder].reverse();
    const pages = [...state.pages].reverse();
    const annotations = state.annotations.map(a => ({ ...a, page: n + 1 - a.page }));
    const bookmarks = state.bookmarks.map(b => ({ ...b, page: n + 1 - b.page }));
    mutate({ pageOrder: order, pages, annotations, bookmarks });
    pushToast('Reversed page order', 'ok');
  };

  // Duplicate a single page (thumbnail action). The duplicate references the
  // same original source page; later pages + their annotations shift down by
  // one. Annotations on the duplicated page are copied onto the new page.
  const duplicatePage = (idx: number) => {
    const order = [...state.pageOrder];
    const pages = [...state.pages];
    order.splice(idx + 1, 0, order[idx]);
    pages.splice(idx + 1, 0, { ...pages[idx], crop: pages[idx].crop ? { ...pages[idx].crop! } : null });
    // Shift annotations on pages after the insertion point down by one, then
    // clone the source page's annotations onto the new page.
    const shifted = state.annotations.map(a => a.page > idx + 1 ? { ...a, page: a.page + 1 } : a);
    const clones = state.annotations
      .filter(a => a.page === idx + 1)
      .map(a => ({ ...a, id: Math.random().toString(36).slice(2, 10), page: idx + 2 } as Annotation));
    mutate({ pageOrder: order, pages, annotations: [...shifted, ...clones] });
    pushToast(`Duplicated page ${idx + 1}`, 'ok');
  };
  const deletePage = (idx: number) => {
    if (state.pageOrder.length <= 1) { setError('Cannot delete the only page.'); return; }
    const order = state.pageOrder.filter((_, i) => i !== idx);
    const pages = state.pages.filter((_, i) => i !== idx);
    // Drop annotations on this page; reindex annotations on later pages.
    const annotations = state.annotations
      .filter(a => a.page !== idx + 1)
      .map(a => a.page > idx + 1 ? { ...a, page: a.page - 1 } : a);
    // Drop bookmarks pointing at the removed page; shift later ones down.
    const bookmarks = state.bookmarks
      .filter(b => b.page !== idx + 1)
      .map(b => b.page > idx + 1 ? { ...b, page: b.page - 1 } : b);
    mutate({ pageOrder: order, pages, annotations, bookmarks });
    setSelectedPages(new Set());
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
        watermark: state.watermark, pageNumbers: state.pageNumbers, headerFooter: state.headerFooter, pageLabels: state.pageLabels, meta: state.meta,
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
      watermark: state.watermark, pageNumbers: state.pageNumbers, headerFooter: state.headerFooter, pageLabels: state.pageLabels, meta: state.meta,
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

  // Download a flattened copy: the RMPG writer bakes annotations directly into
  // each page's content stream (they become part of the page, not separate
  // interactive markup), then we suffix the filename "-flattened" so the user
  // can tell it apart from the editable "-edited" export.
  const downloadFlattened = async () => {
    if (!bytes) return;
    setSaving(true);
    try {
      const { state: savable } = buildSavableState();
      const outBytes = await buildPdfFromEditorState(savable);
      const blob = new Blob([outBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const base = fileName.replace(/\.pdf$/i, '') || 'document';
      a.href = url; a.download = `${base}-flattened.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      pushToast('Downloaded flattened copy', 'ok');
    } catch (err) {
      setError(`Flatten failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // Export an arbitrary page range X–Y (1-indexed, current visual order) to a
  // fresh PDF. Reuses extractPagesAsBytes.
  const exportPageRange = async (from: number, to: number) => {
    if (!bytes) return;
    const lo = Math.max(1, Math.min(from, to));
    const hi = Math.min(state.pageOrder.length, Math.max(from, to));
    const nums: number[] = [];
    for (let n = lo; n <= hi; n++) nums.push(n);
    if (nums.length === 0) { pushToast('Empty page range', 'warn'); return; }
    setSaving(true);
    try {
      const { state: savable } = buildSavableState();
      const out = await extractPagesAsBytes(savable, nums);
      const blob = new Blob([out as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const base = fileName.replace(/\.pdf$/i, '') || 'document';
      a.href = url; a.download = `${base}-pages-${lo}-${hi}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      pushToast(`Exported pages ${lo}–${hi}`, 'ok');
    } catch (err) {
      setError(`Range export failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); setRangeOpen(false); }
  };

  // ─── Append / insert-page operations ─────────────────────────
  // All of these flatten the CURRENT editor state to bytes (baking in existing
  // annotations + page order), append the new page bytes, and re-open the
  // combined PDF. Re-opening rebuilds page/annotation state cleanly and keeps
  // the canvas/render math untouched.
  const appendBytesAndReopen = async (extraBytes: Uint8Array, label: string) => {
    if (!bytes) return;
    setSaving(true);
    try {
      const { state: savable } = buildSavableState();
      const baseBytes = await buildPdfFromEditorState(savable);
      const combined = await appendPdfBytes(baseBytes, extraBytes);
      const base = fileName.replace(/\.pdf$/i, '') || 'document';
      await openBytes(combined, `${base}.pdf`, state.sourceFileId ?? null, state.sourceFolderId ?? null);
      pushToast(label, 'ok');
    } catch (err) {
      setError(`${label} failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // Append another PDF's pages to the end of this document.
  const handleAppendPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.pdf')) { setError('Please choose a PDF to append.'); return; }
    const extra = new Uint8Array(await f.arrayBuffer());
    await appendBytesAndReopen(extra, `Appended ${f.name}`);
  };

  // Insert another PDF's pages at a chosen 1-indexed position (before that page).
  // Flattens the current editor state to bytes first, then splices and re-opens.
  const handleInsertFromPdf = async (file: File, position: number) => {
    if (!bytes) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Please choose a PDF to insert.'); return; }
    setSaving(true);
    try {
      const { state: savable } = buildSavableState();
      const baseBytes = await buildPdfFromEditorState(savable);
      const extra = new Uint8Array(await file.arrayBuffer());
      const combined = await insertPdfBytesAt(baseBytes, extra, position);
      const base = fileName.replace(/\.pdf$/i, '') || 'document';
      await openBytes(combined, `${base}.pdf`, state.sourceFileId ?? null, state.sourceFolderId ?? null);
      pushToast(`Inserted ${file.name} before page ${position}`, 'ok');
      setInsertPdfOpen(false);
    } catch (err) {
      setError(`Insert PDF failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // ─── Annotation presets ("favorites") ────────────────────────
  // Save the current toolbar color/stroke (+ a default opacity) as a named
  // preset; apply a preset by pushing its style onto the active toolbar so the
  // next-drawn annotation inherits it (and re-style the selected annotation).
  const saveCurrentAsPreset = () => {
    const name = window.prompt('Name this style preset:', `Preset ${prefs.annotationPresets.length + 1}`);
    if (!name) return;
    const preset: AnnotationPreset = {
      id: Math.random().toString(36).slice(2, 10),
      name: name.trim(),
      color, strokeWidth, opacity: 1, strokeStyle: 'solid',
    };
    setPrefs({ ...prefs, annotationPresets: [...prefs.annotationPresets, preset].slice(0, 12) });
    pushToast(`Saved style "${preset.name}"`, 'ok');
  };
  const applyPreset = (preset: AnnotationPreset) => {
    setColor(preset.color);
    setStrokeWidth(preset.strokeWidth);
    // Re-style the currently-selected annotation too, if any.
    if (activeId) {
      const idx = state.annotations.findIndex(a => a.id === activeId);
      if (idx !== -1) {
        const next = [...state.annotations];
        next[idx] = { ...next[idx], color: preset.color, strokeWidth: preset.strokeWidth, opacity: preset.opacity, strokeStyle: preset.strokeStyle } as Annotation;
        mutate({ annotations: next });
      }
    }
    pushToast(`Applied "${preset.name}"`, 'ok');
  };
  const deletePreset = (id: string) =>
    setPrefs({ ...prefs, annotationPresets: prefs.annotationPresets.filter(p => p.id !== id) });

  // Apply / clear the real-world measurement calibration (persisted in prefs).
  const applyCalibration = (cal: MeasureCalibration | null) => {
    setPrefs({ ...prefs, calibration: cal });
    pushToast(cal ? `Calibrated: ${cal.note ?? `${cal.unit}`}` : 'Cleared calibration', cal ? 'ok' : 'info');
  };

  // Insert an image as a brand-new full page (appended at the end).
  const handlePageImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const pageBytes = await imageToPdfPageBytes(reader.result as string);
        await appendBytesAndReopen(pageBytes, `Added image page from ${f.name}`);
      } catch (err) { setError(`Image page failed: ${err instanceof Error ? err.message : 'unknown'}`); }
    };
    reader.readAsDataURL(f);
  };

  // Insert a blank/lined/grid template page at the end.
  const handleInsertTemplate = async (template: 'blank' | 'lined' | 'grid') => {
    try {
      const pageBytes = await blankTemplatePageBytes(template);
      await appendBytesAndReopen(pageBytes, `Inserted ${template} page`);
    } catch (err) { setError(`Insert page failed: ${err instanceof Error ? err.message : 'unknown'}`); }
  };

  // ─── Search-and-redact by pattern ────────────────────────────
  const runRedactScan = async (regex: RegExp) => {
    if (!bytes) return;
    setRedactScanning(true);
    try {
      const boxes = await findRedactionBoxes(bytes, state.pageOrder, regex);
      if (boxes.length === 0) { pushToast('No matches found to redact', 'warn'); setRedactOpen(false); return; }
      const newAnns: Annotation[] = boxes.map(b => ({
        id: Math.random().toString(36).slice(2, 10),
        type: 'redact', page: b.page, x: b.x, y: b.y, w: b.w, h: b.h,
        note: `auto-redact: ${b.text}`, layer: 'Redaction',
        createdAt: new Date().toISOString(), status: 'open',
      }));
      mutate({ annotations: [...state.annotations, ...newAnns] });
      pushToast(`Added ${boxes.length} redaction box(es)`, 'ok');
      setRedactOpen(false);
    } catch (err) {
      setError(`Redaction scan failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setRedactScanning(false); }
  };

  // ─── Extract all text to a .txt download ─────────────────────
  const handleExtractText = async () => {
    if (!bytes) return;
    setSaving(true);
    try {
      const text = await extractAllText(bytes);
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const base = fileName.replace(/\.pdf$/i, '') || 'document';
      a.href = url; a.download = `${base}-text.txt`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      pushToast('Extracted document text', 'ok');
    } catch (err) {
      setError(`Text extraction failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // ─── Export current page as PNG ──────────────────────────────
  const handleExportPng = async () => {
    if (!bytes) return;
    const visualIdx = activePage - 1;
    const original = state.pageOrder[visualIdx];
    if (!original || original <= 0) { pushToast('Cannot export a blank page as PNG', 'warn'); return; }
    setSaving(true);
    try {
      const { openAndRenderPage } = await importWithRetry(() => import('../../lib/rmpg-pdf-engine'));
      const canvas = document.createElement('canvas');
      // Base page render is 72 dpi at scale 1; scale up to the chosen export DPI.
      const pdf = await openAndRenderPage(bytes, { pageNumber: original, scale: pngDpi / 72, canvas });
      await pdf.destroy().catch(() => { /* already gone */ });
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      const base = fileName.replace(/\.pdf$/i, '') || 'document';
      a.href = dataUrl; a.download = `${base}-page-${activePage}-${pngDpi}dpi.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      pushToast(`Exported page ${activePage} as PNG (${pngDpi} dpi)`, 'ok');
    } catch (err) {
      setError(`PNG export failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // ─── Batch rotate selected pages ─────────────────────────────
  const batchRotateSelected = () => {
    const targets = selectedPages.size > 0 ? selectedPages : new Set([activePage - 1]);
    const pages = state.pages.map((p, i) =>
      targets.has(i) ? { ...p, rotation: ((p.rotation + 90) % 360) as PageMeta['rotation'] } : p);
    mutate({ pages });
    pushToast(`Rotated ${targets.size} page(s) 90°`, 'ok');
  };

  // ─── Crop all pages to the active page's crop box ────────────
  const cropAllToActive = () => {
    const visualIdx = activePage - 1;
    const crop = state.pages[visualIdx]?.crop;
    if (!crop) { pushToast('Set a crop on the current page first (Crop tool)', 'warn'); return; }
    const pages = state.pages.map(p => ({ ...p, crop: { ...crop } }));
    mutate({ pages });
    pushToast(`Applied crop to all ${pages.length} pages`, 'ok');
  };

  // ─── Wave-4: page organizer bulk ops (rotate / delete many pages) ──
  // Rotate a set of visual indices 90° (dir = +1 CW / -1 CCW) in one history step.
  const bulkRotatePages = (indices: number[], dir: 1 | -1) => {
    const set = new Set(indices);
    const pages = state.pages.map((p, i) =>
      set.has(i) ? { ...p, rotation: (((p.rotation + dir * 90) % 360 + 360) % 360) as PageMeta['rotation'] } : p);
    mutate({ pages });
    pushToast(`Rotated ${indices.length} page(s)`, 'ok');
  };

  // Delete a set of visual indices in one history step. Annotations + bookmarks
  // are re-pointed by counting how many deleted pages precede each survivor.
  const bulkDeletePages = (indices: number[]) => {
    const drop = new Set(indices);
    if (drop.size >= state.pageOrder.length) { setError('Cannot delete every page.'); return; }
    const order = state.pageOrder.filter((_, i) => !drop.has(i));
    const pages = state.pages.filter((_, i) => !drop.has(i));
    // old visual page (1-indexed) → new visual page, or 0 if dropped.
    const remap = new Map<number, number>();
    let newIdx = 0;
    for (let i = 0; i < state.pageOrder.length; i++) {
      if (drop.has(i)) { remap.set(i + 1, 0); continue; }
      newIdx++; remap.set(i + 1, newIdx);
    }
    const annotations = state.annotations
      .filter(a => (remap.get(a.page) ?? 0) > 0)
      .map(a => ({ ...a, page: remap.get(a.page)! }));
    const bookmarks = state.bookmarks
      .filter(b => (remap.get(b.page) ?? 0) > 0)
      .map(b => ({ ...b, page: remap.get(b.page)! }));
    mutate({ pageOrder: order, pages, annotations, bookmarks });
    setSelectedPages(new Set());
    pushToast(`Deleted ${drop.size} page(s)`, 'ok');
  };

  // ─── Wave-4: N-up imposition export (2-up / 4-up) ──
  const handleNUp = async (up: 2 | 4, size: 'Letter' | 'A4') => {
    if (!bytes) return;
    setSaving(true);
    try {
      const { state: savable } = buildSavableState();
      const flat = await buildPdfFromEditorState(savable);
      const out = await buildNUpPdf(flat, up, PAGE_SIZE_PRESETS[size] as [number, number]);
      const base = fileName.replace(/\.pdf$/i, '') || 'document';
      downloadBytes(out, `${base}-${up}up.pdf`);
      pushToast(`Exported ${up}-up PDF`, 'ok');
      setNUpOpen(false);
    } catch (err) {
      setError(`N-up export failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // ─── Wave-4: deskew the current page by a manual angle ──
  const handleDeskew = async () => {
    if (!bytes) return;
    const original = state.pageOrder[activePage - 1];
    if (!original || original <= 0) { pushToast('Cannot deskew a blank page', 'warn'); return; }
    const raw = window.prompt('Deskew angle in degrees (positive = clockwise tilt to correct, e.g. 1.5 or -2):', '0');
    if (raw == null) return;
    const angle = parseFloat(raw);
    if (Number.isNaN(angle) || angle === 0) { pushToast('Enter a non-zero angle', 'warn'); return; }
    setSaving(true);
    try {
      const pageBytes = await deskewPageBytes(bytes, original, angle);
      await appendBytesAndReopen(pageBytes, `Added deskewed (${angle}°) copy of page ${activePage}`);
    } catch (err) {
      setError(`Deskew failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // ─── Wave-4: replicate the selected annotation onto every page ──
  const applyAnnotationEverywhere = () => {
    if (!activeId) { pushToast('Select an annotation first', 'warn'); return; }
    const next = applyAnnotationToAllPages(
      state.annotations, activeId, state.pageOrder.length,
      () => Math.random().toString(36).slice(2, 10),
    );
    const added = next.length - state.annotations.length;
    if (added <= 0) { pushToast('Nothing to apply (single-page document?)', 'info'); return; }
    mutate({ annotations: next });
    pushToast(`Applied annotation to ${added} more page(s)`, 'ok');
  };

  // ─── Wave-4: toggle the bounding-border on the selected highlight/text ──
  const toggleAnnotationBorder = () => {
    if (!activeId) { pushToast('Select a highlight or text box first', 'warn'); return; }
    const idx = state.annotations.findIndex(a => a.id === activeId);
    if (idx === -1) return;
    const cur = state.annotations[idx];
    if (cur.type !== 'highlight' && cur.type !== 'text') { pushToast('Border applies to highlights and text boxes', 'info'); return; }
    const next = [...state.annotations];
    next[idx] = { ...cur, showBorder: !cur.showBorder } as Annotation;
    mutate({ annotations: next });
    pushToast(next[idx].showBorder ? 'Border on' : 'Border off', 'ok');
  };

  // ─── Wave-4: add a reply to the selected sticky note / text annotation ──
  const addReplyToActive = () => {
    if (!activeId) { pushToast('Select a sticky note or text annotation', 'warn'); return; }
    const idx = state.annotations.findIndex(a => a.id === activeId);
    if (idx === -1) return;
    const cur = state.annotations[idx];
    if (cur.type !== 'sticky' && cur.type !== 'text') { pushToast('Replies attach to sticky notes / text', 'info'); return; }
    const text = window.prompt('Reply:', '');
    if (!text) return;
    const reply = {
      id: Math.random().toString(36).slice(2, 10),
      author: user?.full_name ?? user?.username ?? 'unknown',
      text,
      createdAt: new Date().toISOString(),
    };
    const next = [...state.annotations];
    next[idx] = { ...cur, replies: [...(cur.replies ?? []), reply] } as Annotation;
    mutate({ annotations: next });
    pushToast(`Reply added (${(next[idx].replies?.length ?? 0)} total)`, 'ok');
  };

  // ─── Wave-4: export the current page's crop region (or whole page) as PNG ──
  const handleExportCroppedRegion = async () => {
    if (!bytes) return;
    const visualIdx = activePage - 1;
    const original = state.pageOrder[visualIdx];
    if (!original || original <= 0) { pushToast('Cannot export a blank page', 'warn'); return; }
    const crop = state.pages[visualIdx]?.crop;
    setSaving(true);
    try {
      const { openAndRenderPage } = await importWithRetry(() => import('../../lib/rmpg-pdf-engine'));
      const full = document.createElement('canvas');
      const renderScale = pngDpi / 72;
      const pdf = await openAndRenderPage(bytes, { pageNumber: original, scale: renderScale, canvas: full });
      await pdf.destroy().catch(() => { /* gone */ });
      // Crop box is stored at DEFAULT_RENDER_SCALE; convert from render-scale px
      // to the export-render px so the crop window maps correctly at any DPI.
      const k = renderScale / DEFAULT_RENDER_SCALE;
      let outCanvas = full;
      if (crop) {
        const sx = Math.max(0, Math.round(crop.x * k));
        const sy = Math.max(0, Math.round(crop.y * k));
        const sw = Math.min(full.width - sx, Math.round(crop.w * k));
        const sh = Math.min(full.height - sy, Math.round(crop.h * k));
        if (sw > 0 && sh > 0) {
          const c = document.createElement('canvas');
          c.width = sw; c.height = sh;
          c.getContext('2d')!.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
          outCanvas = c;
        }
      }
      const dataUrl = outCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      const base = fileName.replace(/\.pdf$/i, '') || 'document';
      a.href = dataUrl; a.download = `${base}-page-${activePage}${crop ? '-region' : ''}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      pushToast(crop ? `Exported cropped region of page ${activePage}` : `Exported page ${activePage} (no crop set — full page)`, crop ? 'ok' : 'info');
    } catch (err) {
      setError(`Region export failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // ─── Wave-3: split / optimize / page-size / grayscale / report / interactive ──
  const downloadBytes = (b: Uint8Array, name: string) => {
    const blob = new Blob([b as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  // Save an INTERACTIVE PDF (real AcroForm fields, clickable /Link annots, and a
  // /Outlines bookmark tree). Routed through pdf-lib since the native writer
  // doesn't emit interactive objects yet.
  const saveInteractive = async (flattenForm = false) => {
    if (!bytes) return;
    setSaving(true);
    try {
      const { state: savable } = buildSavableState();
      const outline = buildOutlineTree(state.bookmarks);
      const out = await buildInteractivePdf(savable, { outline, flattenForm });
      const base = fileName.replace(/\.pdf$/i, '') || 'document';
      downloadBytes(out, `${base}-${flattenForm ? 'flattened-form' : 'interactive'}.pdf`);
      const fieldCount = state.annotations.filter(a => a.type === 'formText' || a.type === 'formCheck' || a.type === 'formDropdown' || a.type === 'formRadio' || a.type === 'formDate').length;
      const linkCount = state.annotations.filter(a => a.type === 'link' || (a.type === 'text' && (a as { url?: string }).url)).length;
      pushToast(flattenForm
        ? `Saved flattened-form PDF — ${fieldCount} field(s) baked in`
        : `Saved interactive PDF — ${fieldCount} field(s), ${linkCount} link(s), ${state.bookmarks.length} bookmark(s)`, 'ok');
    } catch (err) {
      setError(`Interactive save failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // Split: every N pages, or at the currently batch-selected page boundaries.
  const handleSplit = async (mode: { kind: 'everyN'; n: number } | { kind: 'atSelected' }) => {
    if (!bytes) return;
    setSaving(true);
    try {
      const { state: savable } = buildSavableState();
      let parts;
      if (mode.kind === 'everyN') {
        parts = await splitEveryN(savable, Math.max(1, mode.n));
      } else {
        const breaks = [...selectedPages].map(i => i + 1).filter(p => p >= 2);
        if (breaks.length === 0) { pushToast('Select page(s) in the rail to mark split points first', 'warn'); setSaving(false); return; }
        parts = await splitPdf(savable, breaks);
      }
      if (parts.length <= 1) { pushToast('Nothing to split — produced a single part', 'warn'); setSaving(false); return; }
      // Download each part sequentially with a small stagger so the browser
      // doesn't drop concurrent download prompts.
      for (let i = 0; i < parts.length; i++) {
        downloadBytes(parts[i].bytes, parts[i].name);
        await new Promise(r => setTimeout(r, 350));
      }
      pushToast(`Split into ${parts.length} file(s)`, 'ok');
      setToolsOpen(false);
    } catch (err) {
      setError(`Split failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // Optimize / compress the flattened document; report before/after sizes.
  const handleOptimize = async () => {
    if (!bytes) return;
    setSaving(true);
    try {
      const { state: savable } = buildSavableState();
      const flat = await buildPdfFromEditorState(savable);
      const { bytes: opt, before, after } = await optimizePdf(flat);
      const base = fileName.replace(/\.pdf$/i, '') || 'document';
      downloadBytes(opt, `${base}-optimized.pdf`);
      const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0;
      const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
      pushToast(after < before ? `Optimized: ${kb(before)} → ${kb(after)} (−${pct}%)` : `Already optimal (${kb(before)})`, after < before ? 'ok' : 'info');
      setToolsOpen(false);
    } catch (err) {
      setError(`Optimize failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // Resize pages to a standard size. targetAll=false → only batch-selected pages.
  const handleResizePages = async (sizeName: keyof typeof PAGE_SIZE_PRESETS, targetAll: boolean) => {
    if (!bytes) return;
    setSaving(true);
    try {
      const { state: savable } = buildSavableState();
      const flat = await buildPdfFromEditorState(savable);
      const targets = targetAll ? new Set<number>() : new Set([...selectedPages].map(i => i + 1));
      if (!targetAll && targets.size === 0) { pushToast('Select page(s) in the rail first, or choose "all"', 'warn'); setSaving(false); return; }
      const out = await resizePages(flat, PAGE_SIZE_PRESETS[sizeName], targets);
      const base = fileName.replace(/\.pdf$/i, '') || 'document';
      await openBytes(out, `${base}.pdf`, state.sourceFileId ?? null, state.sourceFolderId ?? null);
      pushToast(`Resized ${targetAll ? 'all pages' : `${targets.size} page(s)`} to ${sizeName}`, 'ok');
      setToolsOpen(false);
    } catch (err) {
      setError(`Resize failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // Grayscale (or invert) the current page → appended as a new image page.
  const handleGrayscale = async (invert: boolean) => {
    if (!bytes) return;
    const original = state.pageOrder[activePage - 1];
    if (!original || original <= 0) { pushToast('Cannot process a blank page', 'warn'); setSaving(false); return; }
    setSaving(true);
    try {
      const pageBytes = await grayscalePageBytes(bytes, original, invert);
      await appendBytesAndReopen(pageBytes, `Added ${invert ? 'inverted' : 'grayscale'} copy of page ${activePage}`);
      setToolsOpen(false);
    } catch (err) {
      setError(`${invert ? 'Invert' : 'Grayscale'} failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // Annotation summary → printable PDF report.
  const handleAnnotationReport = async () => {
    if (state.annotations.length === 0) { pushToast('No annotations to report', 'warn'); return; }
    setSaving(true);
    try {
      const out = await buildAnnotationReportPdf(state.annotations, fileName, state.meta.title);
      const base = fileName.replace(/\.pdf$/i, '') || 'document';
      downloadBytes(out, `${base}-annotation-report.pdf`);
      pushToast(`Generated report of ${state.annotations.length} annotation(s)`, 'ok');
    } catch (err) {
      setError(`Report failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // "Save a copy" — duplicate the whole document (flattened) to a new download.
  const handleSaveCopy = async () => {
    if (!bytes) return;
    setSaving(true);
    try {
      const { state: savable } = buildSavableState();
      const out = await buildPdfFromEditorState(savable);
      const base = fileName.replace(/\.pdf$/i, '') || 'document';
      downloadBytes(out, `${base}-copy.pdf`);
      pushToast('Saved a copy', 'ok');
    } catch (err) {
      setError(`Save a copy failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally { setSaving(false); }
  };

  // Compare against a second PDF — pixel diff per page.
  const runCompare = useCallback(async (otherBytes: Uint8Array, pageNumber: number) => {
    if (!bytes) throw new Error('No document loaded');
    return comparePageDiff(bytes, otherBytes, pageNumber);
  }, [bytes]);

  // Per-thumbnail rotate counter-clockwise (the rail's built-in button is CW).
  const rotatePageCcw = (idx: number) => {
    const pages = [...state.pages];
    const cur = pages[idx];
    if (!cur) return;
    pages[idx] = { ...cur, rotation: (((cur.rotation - 90) % 360 + 360) % 360) as PageMeta['rotation'] };
    mutate({ pages });
  };

  // ─── Bookmarks (one-level nesting via parentId) ──────────────
  const addBookmark = (title: string, page: number, parentId?: string) =>
    mutate({ bookmarks: [...state.bookmarks, { id: Math.random().toString(36).slice(2, 10), title, page, parentId }] });
  // Deleting a parent re-parents its children to top-level so they aren't lost.
  const deleteBookmark = (id: string) =>
    mutate({ bookmarks: state.bookmarks.filter(b => b.id !== id).map(b => b.parentId === id ? { ...b, parentId: undefined } : b) });

  // ─── Page navigation: first / last ───────────────────────────
  const goFirstPage = () => jumpToPage(0);
  const goLastPage = () => jumpToPage(state.pageOrder.length - 1);

  // Toggle a page in the batch-select set (thumbnail rail Shift/Ctrl-click).
  const togglePageSelect = (visualIdx: number) => {
    setSelectedPages(prev => {
      const next = new Set(prev);
      if (next.has(visualIdx)) next.delete(visualIdx); else next.add(visualIdx);
      return next;
    });
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
        if (savable.sourceFolderId != null) {
          form.append('folder_id', String(savable.sourceFolderId));
          form.append('entity_type', 'document_folder');
          form.append('entity_id', String(savable.sourceFolderId));
        }
        const token = localStorage.getItem('rmpg_token');
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(uploadsUrl(), { method: 'POST', headers, body: form });
        if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
        const uploaded = normalizeUploadResponse(await res.json().catch(() => null));
        if (uploaded.length === 0) throw new Error('Upload did not return file');
        setSavedNotice(`Saved encrypted PDF as “${uploaded[0].original_name}” in Documents.`);
      } else {
        const result = await saveToDocuments(savable, { folderId: savable.sourceFolderId });
        setSavedNotice(`Saved as “${result.original_name}” in Documents.`);
      }
      setTimeout(() => setSavedNotice(null), 8000);
    } catch (err) {
      // Never lose the user's edits: if the upload endpoint is down or returns
      // an unexpected shape, fall back to a local download of the same bytes so
      // the work survives and can be re-filed manually.
      const reason = err instanceof Error ? err.message : 'unknown';
      try {
        const { state: savable } = buildSavableState();
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
        setError(`Save to Documents failed (${reason}) — downloaded a local copy instead so your edits aren't lost.`);
      } catch {
        setError(`Save to Documents failed: ${reason}`);
      }
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

  // Fit-to-width on load (preference). Fires once after a document's pages are
  // measured and the scroller has laid out. rAF defers until the canvas has a
  // real clientWidth so the zoom math has valid bounds.
  const didFitOnLoadRef = useRef<string>('');
  useEffect(() => {
    if (!prefs.fitWidthOnLoad || !bytes || state.pages.length === 0) return;
    const key = `${fileName}:${state.pages.length}`;
    if (didFitOnLoadRef.current === key) return;
    didFitOnLoadRef.current = key;
    const id = requestAnimationFrame(() => fitWidth());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes, state.pages.length, fileName, prefs.fitWidthOnLoad]);

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
      if (meta && k === 'g') {
        e.preventDefault();
        setGoToPageOpen(true);
        return;
      }
      // Stroke width Cmd/Ctrl + ] / [ adjust by 1, clamped 1–20.
      if (meta && (e.key === ']' || e.key === '[')) {
        e.preventDefault();
        setStrokeWidth(w => Math.max(1, Math.min(20, w + (e.key === ']' ? 1 : -1))));
        return;
      }
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
      // Shift+R rotates the CURRENT page 90° (plain 'r' stays the rect tool so
      // we don't break the long-standing tool shortcut). Shift+Alt+R rotates all.
      if (!meta && e.shiftKey && k === 'r') {
        e.preventDefault();
        if (e.altKey) rotateAllPages();
        else if (activePage >= 1) rotatePage(activePage - 1);
        return;
      }
      const map: Record<string, Tool> = { v: 'select', h: 'hand', t: 'text', y: 'highlight', r: 'rect', e: 'ellipse', l: 'line', a: 'arrow', p: 'pen', n: 'sticky', c: 'cloud', x: 'cross' };
      if (!meta && !e.shiftKey && map[k]) { setTool(map[k]); return; }
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
    const clamped = Math.max(0, Math.min(state.pageOrder.length - 1, idx));
    // Single-page view renders only the active page, so scrollIntoView has no
    // target — drive activePage directly. Continuous / two-up scroll as before.
    if (prefs.viewMode === 'single') { setActivePage(clamped + 1); return; }
    const root = scrollerRef.current; if (!root) return;
    const target = root.querySelector(`[data-page-number="${clamped + 1}"]`) as HTMLElement | null;
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

  const lightChrome = prefs.chromeTheme === 'light';

  return (
    <div className={`p-3 flex flex-col h-[calc(100vh-140px)] min-h-[600px] ${lightChrome ? 'rmpg-pdf-light-chrome rounded-[2px]' : ''}`}>
      {/* Light chrome theme — recolors ONLY the editor's surrounding panels
          (toolbars, rails, panels). The rendered PDF pages (.bg-white) are
          explicitly excluded so document fidelity is never affected. Scoped to
          this subtree so it can't leak into the rest of the app. */}
      {lightChrome && (
        <style>{`
          .rmpg-pdf-light-chrome { background:#ececed; color:#1a1a1a; }
          .rmpg-pdf-light-chrome .bg-\\[\\#0d0d0d\\],
          .rmpg-pdf-light-chrome .bg-\\[\\#141414\\],
          .rmpg-pdf-light-chrome .bg-\\[\\#0a0a0a\\] { background:#f6f6f7 !important; }
          .rmpg-pdf-light-chrome .bg-\\[\\#050505\\] { background:#d9d9dc !important; }
          .rmpg-pdf-light-chrome .border-\\[\\#222\\],
          .rmpg-pdf-light-chrome .border-\\[\\#222222\\],
          .rmpg-pdf-light-chrome .border-\\[\\#1a1a1a\\] { border-color:#c2c2c6 !important; }
          .rmpg-pdf-light-chrome .text-rmpg-200,
          .rmpg-pdf-light-chrome .text-fg-muted,
          .rmpg-pdf-light-chrome .text-fg-muted { color:#2a2a2a !important; }
          .rmpg-pdf-light-chrome .text-fg-muted,
          .rmpg-pdf-light-chrome .text-fg-muted { color:#6a6a6a !important; }
          /* Keep the PDF page surface pure white regardless of chrome theme. */
          .rmpg-pdf-light-chrome .bg-white { background:#ffffff !important; }
        `}</style>
      )}
      <PanelTitleBar title={viewOnly ? 'PDF VIEWER' : 'PDF EDITOR'} icon={FileText} />

      <input id="ff-pdfeditorpage-0" ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleOpenChange} />
      <input id="ff-pdfeditorpage-1" ref={mergeInputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={handleMergeChange} />
      <input id="ff-pdfeditorpage-2" ref={imageInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleImageChange} />
      <input id="ff-pdfeditorpage-3" ref={jsonInputRef} type="file" accept="application/json" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ''; }} />
      <input id="ff-pdfeditorpage-append" ref={appendInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleAppendPdf} />
      <input id="ff-pdfeditorpage-pageimg" ref={pageImageInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handlePageImage} />

      {/* Find / Shortcuts / Preferences dialogs */}
      <FindDialog open={findOpen} onClose={() => setFindOpen(false)} currentPage={activePage}
        onJumpTo={(page) => jumpToPage(page - 1)} />
      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ExportRangeDialog open={rangeOpen} pageCount={state.pageOrder.length} onClose={() => setRangeOpen(false)} onExport={exportPageRange} />
      <HeaderFooterDialog open={headerFooterOpen} value={state.headerFooter} onClose={() => setHeaderFooterOpen(false)}
        onApply={(cfg) => { mutate({ headerFooter: cfg }); pushToast(cfg ? 'Header/footer applied to all pages' : 'Header/footer removed', cfg ? 'ok' : 'info'); }} />
      <RedactPatternDialog open={redactOpen} scanning={redactScanning} onClose={() => setRedactOpen(false)} onRun={runRedactScan} />
      <InsertPageDialog open={insertPageOpen} onClose={() => setInsertPageOpen(false)}
        onTemplate={handleInsertTemplate} onPickImage={() => pageImageInputRef.current?.click()} />
      <PdfToolsDialog
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        pageCount={state.pageOrder.length}
        selectedCount={selectedPages.size}
        activePage={activePage}
        busy={saving}
        onSplitEveryN={(n) => handleSplit({ kind: 'everyN', n })}
        onSplitAtSelected={() => handleSplit({ kind: 'atSelected' })}
        onOptimize={handleOptimize}
        onResize={handleResizePages}
        onGrayscale={() => handleGrayscale(false)}
        onInvert={() => handleGrayscale(true)}
      />
      <CompareDialog
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        pageCount={state.pageOrder.length}
        onCompare={runCompare}
      />
      <PageOrganizer
        open={organizerOpen}
        pdfBytes={bytes}
        pages={state.pages}
        pageOrder={state.pageOrder}
        onClose={() => setOrganizerOpen(false)}
        onReorder={reorderPages}
        onBulkRotate={bulkRotatePages}
        onBulkDelete={bulkDeletePages}
      />
      <NUpDialog
        open={nUpOpen}
        busy={saving}
        pageCount={state.pageOrder.length}
        onClose={() => setNUpOpen(false)}
        onExport={handleNUp}
      />
      <PageLabelsDialog
        open={labelsOpen}
        pageCount={state.pageOrder.length}
        rules={state.pageLabels}
        onClose={() => setLabelsOpen(false)}
        onApply={(rules) => { mutate({ pageLabels: rules }); pushToast(rules.length ? `Applied ${rules.length} page-label rule(s)` : 'Cleared page labels', rules.length ? 'ok' : 'info'); }}
      />
      <PreferencesDialog open={prefsOpen} prefs={prefs} onChange={setPrefs} onClose={() => setPrefsOpen(false)} />
      <CalibrationDialog open={calibrationOpen} value={prefs.calibration} onClose={() => setCalibrationOpen(false)} onApply={applyCalibration} />
      <InsertFromPdfDialog open={insertPdfOpen} pageCount={state.pageOrder.length} activePage={activePage} busy={saving}
        onClose={() => setInsertPdfOpen(false)} onInsert={handleInsertFromPdf} />
      {/* Toast queue — bottom-right floating stack */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-1.5">
          {toasts.map(t => (
            <div key={t.id}
              className={`px-3 py-2 rounded-sm border text-[11px] shadow-lg max-w-[320px] ${
                t.kind === 'ok' ? 'bg-green-900/30 border-green-700/50 text-green-200' :
                t.kind === 'warn' ? 'bg-yellow-900/30 border-yellow-700/50 text-yellow-200' :
                'bg-surface-base border-border-default text-rmpg-200'
              }`}>{t.text}</div>
          ))}
        </div>
      )}

      <CustomStampsGallery open={stampsOpen}
        onClose={() => { setStampsOpen(false); if (tool === 'stamp' && !pendingStamp) setTool('select'); }}
        onPick={handleStampPick}
        onCreateNew={() => { setStampsOpen(false); setStudioOpen(true); }} />

      <StampStudio
        open={studioOpen}
        onClose={() => { setStudioOpen(false); if (tool === 'stamp' && !pendingStamp) setTool('select'); }}
        officerName={user ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.username : ''}
        badgeNumber={typeof (user as { badge_number?: string } | null)?.badge_number === 'string' ? (user as { badge_number?: string }).badge_number : ''}
        onUse={(dataUrl, name) => { setPendingImage(dataUrl); setPendingStamp(name); setTool('barcode'); }}
      />

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
        onRotate90={() => contextMenu && rotateAnnotation90(contextMenu.annotationId)}
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
          onFitPage={fitPage}
          onFitWidth={fitWidth}
          onRotateAll={rotateAllPages}
          onReversePages={reversePages}
          onTogglePageNumbers={togglePageNumbers}
          pageNumbersActive={!!state.pageNumbers}
          onDownloadFlattened={downloadFlattened}
          onMetadata={() => { setActiveId(null); setSelectedIds(new Set()); if (isMobile) pushToast('Document properties are in the desktop side panel', 'info'); }}
          onBates={() => { setActiveId(null); setSelectedIds(new Set()); if (isMobile) pushToast('Bates numbering is in the desktop side panel', 'info'); }}
          onWatermark={() => { setActiveId(null); setSelectedIds(new Set()); if (isMobile) pushToast('Watermark settings are in the desktop side panel', 'info'); }}
          onStampStudio={() => setStudioOpen(true)}
          onEncrypt={() => setEncryptionOpen(true)}
          encryptionActive={!!encryption}
          onClearEncryption={() => setEncryption(null)}
          saving={saving}
        />
      </div>

      {error && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 text-yellow-200 text-[11px] px-3 py-1.5 rounded-sm mb-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> <div>{error}</div>
          <button type="button" onClick={() => setError(null)} className="ml-auto text-yellow-300 hover:text-rmpg-100">×</button>
        </div>
      )}
      {savedNotice && (
        <div className="bg-green-900/20 border border-green-700/40 text-green-200 text-[11px] px-3 py-1.5 rounded-sm mb-2 flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> <div>{savedNotice}</div>
          {searchParams.get('from') === 'serve' ? (
            <button type="button" onClick={() => navigate('/serve')} className="ml-auto text-amber-300 hover:text-rmpg-100 text-[10px]">← Back to Process Server</button>
          ) : (
            <button type="button" onClick={() => navigate('/documents')} className="ml-auto text-green-300 hover:text-rmpg-100 text-[10px]">Open Documents →</button>
          )}
        </div>
      )}

      {!hasDocument && (
        <div className="flex-1 bg-surface-base border border-border-default rounded-[2px] p-12 text-center flex flex-col items-center justify-center">
          <FileText className="w-16 h-16 mb-4 text-fg-muted" />
          <div className="text-base text-rmpg-200 mb-2 font-semibold">PDF Editor</div>
          <div className="text-xs text-fg-muted mb-6 max-w-md">View, annotate, redact, sign, stamp, watermark, reorder, rotate, merge — all running locally in your browser. Files never leave the device.</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onPickFile} className="btn-primary">Open PDF</button>
            <button type="button" onClick={onPickMerge} className="btn-secondary">Merge multiple PDFs</button>
          </div>
          <div className="mt-6 text-[10px] text-fg-muted max-w-md">
            <strong className="text-fg-muted">Note on redaction:</strong> the redaction tool paints an opaque black box over content. For maximum-sensitivity material (FOIA, court submissions), follow with a print-to-PDF round trip to flatten the entire content stream.
          </div>
        </div>
      )}

      {/* Quick-action strip: find / annotations panel toggle / shortcuts /
          prefs / JSON I/O / print. These are kept out of the main EditorToolbar
          so that toolbar stays tight; quick actions live just below it. */}
      {hasDocument && !viewOnly && (
        <div className={`flex items-center gap-1 bg-surface-base border border-border-default rounded-[2px] px-2 py-1 mb-2 text-[10px] text-fg-muted ${isMobile ? 'flex-wrap overflow-x-auto' : ''}`}>
          {isMobile && (
            <>
              <button type="button" onClick={() => setMobileToolsOpen(v => !v)} title="Toggle tools"
                className={`px-2 py-1 min-h-[36px] rounded-sm inline-flex items-center gap-1 ${mobileToolsOpen ? 'bg-[#d4a017]/20 [color:var(--panel-header-color)]' : 'hover:bg-rmpg-700/40'}`}>
                <Settings className="w-3 h-3" /> Tools
              </button>
              <button type="button" onClick={() => setMobileThumbsOpen(v => !v)} title="Toggle pages"
                className={`px-2 py-1 min-h-[36px] rounded-sm inline-flex items-center gap-1 ${mobileThumbsOpen ? 'bg-[#d4a017]/20 [color:var(--panel-header-color)]' : 'hover:bg-rmpg-700/40'}`}>
                <Layers className="w-3 h-3" /> Pages
              </button>
            </>
          )}
          <button type="button" onClick={() => setFindOpen(true)} title="Find in document (Ctrl+F)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Search className="w-3 h-3" /> Find</button>
          <button type="button" onClick={() => setPrefs({ ...prefs, showAnnotationsPanel: !prefs.showAnnotationsPanel })}
            title="Toggle annotations panel"
            className={`px-2 py-0.5 rounded-sm inline-flex items-center gap-1 ${prefs.showAnnotationsPanel ? 'bg-[#d4a017]/20 [color:var(--panel-header-color)]' : 'hover:bg-rmpg-700/40'}`}>
            <Layers className="w-3 h-3" /> Panel ({state.annotations.length})
          </button>
          <button type="button" onClick={() => setShowMiniMap(v => !v)}
            title="Toggle mini-map page navigator"
            className={`px-2 py-0.5 rounded-sm inline-flex items-center gap-1 ${showMiniMap ? 'bg-[#d4a017]/20 [color:var(--panel-header-color)]' : 'hover:bg-rmpg-700/40'}`}>
            <MapIcon className="w-3 h-3" /> Mini-map
          </button>
          <button type="button" onClick={() => setForcePdfjs(v => !v)}
            title="Force the compatibility engine (PDF.js). Use if a page renders blank with the native engine."
            className={`px-2 py-0.5 rounded-sm inline-flex items-center gap-1 ${forcePdfjs ? 'bg-[#d4a017]/20 [color:var(--panel-header-color)]' : 'hover:bg-rmpg-700/40'}`}>
            {forcePdfjs ? '✓ Compat engine' : 'Compat engine'}
          </button>
          <button type="button" onClick={exportJson} title="Export annotations as JSON (full state)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Download className="w-3 h-3" /> JSON</button>
          <button type="button" onClick={exportCsv} title="Export annotations as CSV (spreadsheet)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm">CSV</button>
          <button type="button" onClick={exportXfdf} title="Export as XFDF (Acrobat-compatible)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm">XFDF</button>
          <button type="button" onClick={exportMarkdown} title="Export annotation summary as Markdown"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm">MD</button>
          <button type="button" onClick={() => jsonInputRef.current?.click()} title="Import annotations from JSON"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><UploadIcon className="w-3 h-3" /> Import</button>
          <button type="button" onClick={() => setRangeOpen(true)} title="Export a page range (X–Y) as a new PDF"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><FileOutput className="w-3 h-3" /> Range</button>
          <button type="button" onClick={() => appendInputRef.current?.click()} title="Append another PDF's pages to the end of this document"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><UploadIcon className="w-3 h-3" /> Append PDF</button>
          <button type="button" onClick={() => setInsertPageOpen(true)} title="Insert a blank / lined / grid / image page"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><FilePlus2 className="w-3 h-3" /> Insert page</button>
          <button type="button" onClick={() => setInsertPdfOpen(true)} title="Insert the pages of another PDF at a chosen position"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><FileInput className="w-3 h-3" /> Insert PDF</button>
          <button type="button" onClick={() => setCalibrationOpen(true)}
            title="Set a real-world measurement scale for the measure / area tools"
            className={`px-2 py-0.5 rounded-sm inline-flex items-center gap-1 ${prefs.calibration ? 'bg-[#d4a017]/20 [color:var(--panel-header-color)]' : 'hover:bg-rmpg-700/40'}`}><Ruler className="w-3 h-3" /> Calibrate{prefs.calibration ? ` (${prefs.calibration.unit})` : ''}</button>
          <button type="button" onClick={() => setRedactOpen(true)} title="Search & redact SSN / phone / email by pattern"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><EyeOff className="w-3 h-3" /> Redact pattern</button>
          <button type="button" onClick={() => setHeaderFooterOpen(true)}
            title="Custom header & footer text"
            className={`px-2 py-0.5 rounded-sm inline-flex items-center gap-1 ${state.headerFooter ? 'bg-[#d4a017]/20 [color:var(--panel-header-color)]' : 'hover:bg-rmpg-700/40'}`}><Heading className="w-3 h-3" /> Header/Footer</button>
          <button type="button" onClick={handleExtractText} title="Extract all document text to a .txt download"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><FileTextIcon className="w-3 h-3" /> Text</button>
          <button type="button" onClick={handleExportPng} title="Export the current page as a PNG image"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><ImageDownIcon className="w-3 h-3" /> PNG</button>
          <label className="inline-flex items-center gap-1 px-1" title="PNG export resolution">
            <span className="text-[9px] uppercase tracking-wider text-fg-muted">DPI</span>
            <select id="ff-pdfeditorpage-pngdpi" value={pngDpi} onChange={e => setPngDpi(parseInt(e.target.value, 10))}
              className="bg-surface-sunken border border-border-default text-[10px] text-rmpg-200 px-1 py-0.5 rounded-sm">
              <option value={72}>72</option>
              <option value={150}>150</option>
              <option value={300}>300</option>
            </select>
          </label>
          <button type="button" onClick={batchRotateSelected}
            title={selectedPages.size > 0 ? `Rotate ${selectedPages.size} selected page(s) 90°` : 'Rotate the current page 90° (select pages in the rail to batch-rotate)'}
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><RotateCwIcon className="w-3 h-3" /> Rotate{selectedPages.size > 0 ? ` (${selectedPages.size})` : ''}</button>
          <button type="button" onClick={cropAllToActive} title="Apply the current page's crop box to every page"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><CropIcon className="w-3 h-3" /> Crop all</button>
          <label className="inline-flex items-center gap-1 px-1" title="Lock the Crop tool to a fixed aspect ratio">
            <span className="text-[9px] uppercase tracking-wider text-fg-muted">Crop AR</span>
            <select id="ff-pdfeditorpage-cropar" value={cropAspect} onChange={e => setCropAspect(parseFloat(e.target.value))}
              className={`bg-surface-sunken border text-[10px] px-1 py-0.5 rounded-sm ${cropAspect > 0 ? '[border-color:var(--field-label-color)] [color:var(--panel-header-color)]' : 'border-border-default text-rmpg-200'}`}>
              <option value={0}>Free</option>
              <option value={1}>1:1</option>
              <option value={4 / 3}>4:3</option>
              <option value={3 / 2}>3:2</option>
              <option value={16 / 9}>16:9</option>
              <option value={8.5 / 11}>Letter (8.5×11)</option>
            </select>
          </label>
          <button type="button" onClick={() => setToolsOpen(true)} title="Split / optimize / resize pages / grayscale"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Wrench className="w-3 h-3" /> Tools</button>
          <button type="button" onClick={() => setOrganizerOpen(true)} title="Page organizer — large grid: drag to reorder, multi-select, bulk rotate/delete"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><LayoutGrid className="w-3 h-3" /> Organize</button>
          <button type="button" onClick={() => setNUpOpen(true)} title="N-up export — combine 2 or 4 pages per sheet"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Grid2x2 className="w-3 h-3" /> N-up</button>
          <button type="button" onClick={() => setLabelsOpen(true)}
            title="Custom page labels (roman / alpha / prefixed ranges) — use {label} in the footer"
            className={`px-2 py-0.5 rounded-sm inline-flex items-center gap-1 ${state.pageLabels.length > 0 ? 'bg-[#d4a017]/20 [color:var(--panel-header-color)]' : 'hover:bg-rmpg-700/40'}`}><Hash className="w-3 h-3" /> Labels{state.pageLabels.length > 0 ? ` (${state.pageLabels.length})` : ''}</button>
          <button type="button" onClick={handleDeskew} title="Deskew (straighten) the current page by a manual angle"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><RotateCwIcon className="w-3 h-3" /> Deskew</button>
          <button type="button" onClick={handleExportCroppedRegion} title="Export the current page's crop region (or full page) as PNG"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><CropIcon className="w-3 h-3" /> Region PNG</button>
          <button type="button" onClick={applyAnnotationEverywhere} title="Apply the selected annotation to every page (stamp across the document)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Layers2 className="w-3 h-3" /> To all pages</button>
          <button type="button" onClick={toggleAnnotationBorder} title="Toggle a border around the selected highlight / text box"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Square className="w-3 h-3" /> Border</button>
          <button type="button" onClick={addReplyToActive} title="Add a reply to the selected sticky note / text annotation"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Reply</button>
          <button type="button" onClick={() => setTypedSigMode('signature')} title="Type a signature in a cursive font, then click the page to place it"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><TypeIcon className="w-3 h-3" /> Type sig</button>
          <button type="button" onClick={() => setTypedSigMode('initials')} title="Type your initials as a placeable cursive mark"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><PenLine className="w-3 h-3" /> Initials</button>
          <button type="button" onClick={() => setTypedSigMode('quicksign')} title="Quick-sign: place signature + today's date + initials together"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><FileSignature className="w-3 h-3" /> Quick-sign</button>
          <label className="inline-flex items-center gap-1 px-1" title="Category applied to new sticky notes">
            <span className="text-[9px] uppercase tracking-wider text-fg-muted">Note</span>
            <select id="ff-pdfeditorpage-stickycat" value={stickyCategory} onChange={e => setStickyCategory(e.target.value as StickyCategory)}
              className="bg-surface-sunken border border-border-default text-[10px] text-rmpg-200 px-1 py-0.5 rounded-sm">
              {(Object.keys(STICKY_CATEGORIES) as StickyCategory[]).map(k => (
                <option key={k} value={k}>{STICKY_CATEGORIES[k].label}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={saveCurrentAsPreset} title="Save the current color + stroke as a reusable style preset"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Star className="w-3 h-3" /> Save style</button>
          {prefs.annotationPresets.length > 0 && (
            <span className="inline-flex items-center gap-0.5">
              {prefs.annotationPresets.map(ps => (
                <span key={ps.id} className="inline-flex items-center group">
                  <button type="button" onClick={() => applyPreset(ps)} title={`Apply "${ps.name}" (${ps.color}, ${ps.strokeWidth}px)`}
                    className="px-1.5 py-0.5 rounded-sm border border-border-default hover:[border-color:var(--field-label-color)] inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm border border-border-subtle" style={{ background: ps.color }} />
                    <span className="text-[9px] max-w-[70px] truncate">{ps.name}</span>
                  </button>
                  <button type="button" onClick={() => deletePreset(ps.id)} aria-label={`Delete preset ${ps.name}`} title="Delete preset"
                    className="text-fg-muted hover:text-red-400 text-[10px] px-0.5">×</button>
                </span>
              ))}
            </span>
          )}
          <button type="button" onClick={() => setPrefs({ ...prefs, showGrid: !prefs.showGrid })}
            title="Toggle the grid overlay"
            className={`px-2 py-0.5 rounded-sm inline-flex items-center gap-1 ${prefs.showGrid ? 'bg-[#d4a017]/20 [color:var(--panel-header-color)]' : 'hover:bg-rmpg-700/40'}`}><Grid3x3 className="w-3 h-3" /> Grid</button>
          <button type="button" onClick={() => setPrefs({ ...prefs, snapToGrid: !prefs.snapToGrid })}
            title="Snap annotation placement to the grid"
            className={`px-2 py-0.5 rounded-sm inline-flex items-center gap-1 ${prefs.snapToGrid ? 'bg-[#d4a017]/20 [color:var(--panel-header-color)]' : 'hover:bg-rmpg-700/40'}`}>Snap</button>
          <button type="button" onClick={() => saveInteractive(false)} title="Save an interactive PDF: form fields, clickable links, bookmark outline"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><FileSignature className="w-3 h-3" /> Interactive</button>
          <button type="button" onClick={() => saveInteractive(true)} title="Save a flattened-form PDF: field values baked in, form locked (for filing)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><FileSignature className="w-3 h-3" /> Flatten form</button>
          <button type="button" onClick={() => handleSplit({ kind: 'atSelected' })} title="Split at the page(s) selected in the rail"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Scissors className="w-3 h-3" /> Split{selectedPages.size > 0 ? ` (${selectedPages.size})` : ''}</button>
          <button type="button" onClick={() => setCompareOpen(true)} title="Compare against another PDF (page pixel-diff)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><GitCompare className="w-3 h-3" /> Compare</button>
          <button type="button" onClick={handleAnnotationReport} title="Generate a printable annotation summary PDF"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><ClipboardList className="w-3 h-3" /> Report</button>
          <button type="button" onClick={handleSaveCopy} title="Save a flattened copy of the document"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><CopyIcon className="w-3 h-3" /> Save copy</button>
          <button type="button" onClick={() => setShowBookmarks(v => !v)}
            title="Toggle bookmarks panel"
            className={`px-2 py-0.5 rounded-sm inline-flex items-center gap-1 ${showBookmarks ? 'bg-[#d4a017]/20 [color:var(--panel-header-color)]' : 'hover:bg-rmpg-700/40'}`}><BookmarkIcon className="w-3 h-3" /> Bookmarks ({state.bookmarks.length})</button>
          <button type="button" onClick={goFirstPage} title="Go to first page (Home)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center"><ChevronsLeft className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={goLastPage} title="Go to last page (End)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center"><ChevronsRight className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={selectAllOnPage} title="Select all annotations on this page (Ctrl+A)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm">Select all</button>
          <button type="button" onClick={clearAllOnPage} title="Delete all annotations on this page"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm hover:text-red-300">Clear page</button>
          <button type="button" onClick={handlePrint} title="Print"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Printer className="w-3 h-3" /> Print</button>
          <div className="flex-1" />
          <select id="ff-pdfeditorpage-4" value={prefs.viewMode} onChange={(e) => setPrefs({ ...prefs, viewMode: e.target.value as EditorPreferences['viewMode'] })}
            className="bg-surface-sunken border border-border-default text-[10px] text-rmpg-200 px-1.5 py-0.5 rounded-sm">
            <option value="continuous">Continuous</option>
            <option value="single">Single page</option>
            <option value="two-up">Two-up</option>
          </select>
          <button type="button" onClick={fitPage} title="Fit page (1)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm">Fit page</button>
          <button type="button" onClick={fitWidth} title="Fit width (2)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm">Fit width</button>
          <button type="button" onClick={() => setPresentationOpen(true)} title="Presentation — full-screen, distraction-free page view"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Maximize2 className="w-3 h-3" /> Present</button>
          <button type="button" onClick={() => setPrefs({ ...prefs, chromeTheme: prefs.chromeTheme === 'light' ? 'dark' : 'light' })}
            title={prefs.chromeTheme === 'light' ? 'Switch editor chrome to dark' : 'Switch editor chrome to light (page stays white)'}
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1">
            {prefs.chromeTheme === 'light' ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
            {prefs.chromeTheme === 'light' ? 'Dark' : 'Light'}
          </button>
          <button type="button" onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts (?)"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Keyboard className="w-3 h-3" /> ?</button>
          <button type="button" onClick={() => setPrefsOpen(true)} title="Editor preferences"
            className="px-2 py-0.5 hover:bg-rmpg-700/40 rounded-sm inline-flex items-center gap-1"><Settings className="w-3 h-3" /></button>
          {selectedIds.size > 0 && (
            <span className="[color:var(--panel-header-color)]">{selectedIds.size} selected</span>
          )}
          {selectedIds.size >= 2 && (
            <AlignmentBar count={selectedIds.size} onAlign={applyAlign} onDistribute={applyDistribute} onMatchSize={applyMatchSize} />
          )}
        </div>
      )}

      {hasDocument && viewOnly && (
        <div className="bg-surface-base border border-border-default rounded-[2px] px-3 py-1.5 mb-2 flex items-center gap-2 text-[10px] text-fg-muted">
          <span className="[color:var(--panel-header-color)] font-semibold uppercase tracking-wider">View-only</span>
          <span>— editing tools are hidden. Click "Edit this PDF" to enable annotation, redaction, signatures, and more.</span>
          <button type="button" onClick={enableEditing} className="ml-auto btn-secondary text-[10px]">Edit this PDF</button>
        </div>
      )}

      {hasDocument && (
        <div className="flex-1 flex gap-2 min-h-0 relative">
          {/* Tool palette: docked on desktop; an off-canvas drawer on mobile so
              the canvas keeps the full width. */}
          {!viewOnly && (!isMobile || mobileToolsOpen) && (
            <div className={isMobile ? 'absolute left-0 top-0 bottom-0 z-30 bg-surface-sunken border-r border-border-default shadow-xl' : 'contents'}>
              <ToolPalette tool={tool} onTool={setTool} color={color} onColor={setColor} strokeWidth={strokeWidth} onStrokeWidth={setStrokeWidth} />
              {isMobile && (
                <button type="button" onClick={() => setMobileToolsOpen(false)} aria-label="Close tools"
                  className="absolute top-1 right-1 w-7 h-7 flex items-center justify-center text-fg-muted hover:text-rmpg-100">×</button>
              )}
            </div>
          )}

          {/* Page thumbnail rail: docked on desktop; drawer on mobile. */}
          {(!isMobile || mobileThumbsOpen) && (
            <div className={isMobile ? 'absolute left-0 top-0 bottom-0 z-30 bg-surface-sunken border-r border-border-default shadow-xl overflow-y-auto' : 'contents'}>
              <ThumbnailSidebar
                pdfBytes={bytes}
                pages={state.pages}
                pageOrder={state.pageOrder}
                activePage={activePage}
                onJumpTo={(idx) => { jumpToPage(idx); if (isMobile) setMobileThumbsOpen(false); }}
                onMove={movePage}
                onRotate={rotatePage}
                onRotateCcw={rotatePageCcw}
                onDelete={deletePage}
                onInsertBlank={insertBlank}
                onExtract={extractPage}
                onClearCrop={(idx) => setPageCrop(idx, null)}
                onDuplicate={duplicatePage}
                onReorder={reorderPages}
                size={prefs.thumbnailSize}
                onToggleSize={() => setPrefs({ ...prefs, thumbnailSize: prefs.thumbnailSize === 'large' ? 'small' : 'large' })}
                selectedPages={selectedPages}
                onTogglePageSelect={togglePageSelect}
              />
              {isMobile && (
                <button type="button" onClick={() => setMobileThumbsOpen(false)} aria-label="Close pages"
                  className="absolute top-1 right-1 w-7 h-7 flex items-center justify-center text-fg-muted hover:text-rmpg-100">×</button>
              )}
            </div>
          )}

          <div ref={scrollerRef} onScroll={onScroll}
            className={`flex-1 overflow-auto bg-surface-overlay border border-border-default rounded-[2px] p-4 relative ${
              prefs.viewMode === 'two-up' ? 'flex flex-row flex-wrap justify-center gap-4 content-start'
              : prefs.viewMode === 'single' ? 'flex flex-col items-center'
              : 'space-y-4'
            }`}>
            {/* Grid overlay — visual placement aid when prefs.showGrid is on. */}
            {prefs.showGrid && (
              <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true"
                style={{
                  backgroundImage: `linear-gradient(to right, rgba(212,160,23,0.10) 1px, transparent 1px), linear-gradient(to bottom, rgba(212,160,23,0.10) 1px, transparent 1px)`,
                  backgroundSize: `${Math.max(4, prefs.gridSize) * DEFAULT_RENDER_SCALE * zoom}px ${Math.max(4, prefs.gridSize) * DEFAULT_RENDER_SCALE * zoom}px`,
                }} />
            )}
            {state.pageOrder
              .map((original, idx) => ({ original, idx }))
              .filter(({ idx }) => prefs.viewMode !== 'single' || idx + 1 === activePage)
              .map(({ original, idx }) => (
              <PageCanvas
                key={`page-${idx}-${original}`}
                pdfBytes={bytes}
                doc={doc}
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
                onUpdateAnnotationLive={updateAnnotationLive}
                onTransformStart={transformStart}
                onSetCrop={setPageCrop}
                onAnnotationContextMenu={(id, x, y) => setContextMenu({ annotationId: id, x, y })}
                forcePdfjs={forcePdfjs}
                snapToGrid={prefs.snapToGrid}
                gridSize={prefs.gridSize}
                calibration={prefs.calibration}
                stickyCategory={stickyCategory}
                cropAspect={cropAspect}
              />
            ))}
          </div>

          {!viewOnly && !isMobile && showBookmarks && (
            <BookmarksPanel
              bookmarks={state.bookmarks}
              activePage={activePage}
              pageCount={state.pageOrder.length}
              onAdd={addBookmark}
              onDelete={deleteBookmark}
              onJump={(p) => jumpToPage(p - 1)}
              onClose={() => setShowBookmarks(false)}
            />
          )}
          {!viewOnly && !isMobile && prefs.showAnnotationsPanel && (
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
          {!viewOnly && !isMobile && (
            <PropertiesPanel
              annotation={annotation}
              onChange={(a) => updateAnnotation(a.id, a)}
              onDelete={deleteActive}
              bates={state.bates}
              onBatesChange={(b) => mutate({ bates: b })}
              watermark={state.watermark}
              onWatermarkChange={(w) => mutate({ watermark: w })}
              pageNumbers={state.pageNumbers}
              onPageNumbersChange={(pn) => mutate({ pageNumbers: pn })}
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

      <TypedSignatureDialog
        open={typedSigMode !== null}
        mode={typedSigMode ?? 'signature'}
        defaultName={user?.full_name ?? user?.username ?? ''}
        onClose={() => { const wasQuick = typedSigMode === 'quicksign'; setTypedSigMode(null); if (!pendingImage && !wasQuick) setTool('select'); }}
        onConfirm={(r) => {
          setPendingImage(r.dataUrl);
          if (r.quickSign) {
            setPendingQuickSign(r.quickSign);
            pushToast('Click the page to drop your signature, date & initials', 'info');
          } else {
            pushToast('Click the page to place your signature', 'info');
          }
          setTool('signature');
        }}
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

      <PresentationView
        open={presentationOpen}
        bytes={bytes}
        pageOrder={state.pageOrder}
        startPage={activePage}
        fileName={fileName}
        forcePdfjs={forcePdfjs}
        onClose={() => setPresentationOpen(false)}
        onPageChange={(p) => setActivePage(p)}
      />
      <ConfirmDialog
        isOpen={clearPageOpen}
        onClose={() => setClearPageOpen(false)}
        onConfirm={() => {
          mutate({ annotations: state.annotations.filter(a => a.page !== activePage) });
          setSelectedIds(new Set());
          setActiveId(null);
          pushToast(`Cleared ${clearPageCount} annotation(s) on page ${activePage}`, 'ok');
          setClearPageOpen(false);
        }}
        title="Clear page annotations"
        message={`Delete all ${clearPageCount} annotation(s) on page ${activePage}?`}
        confirmLabel="Clear"
        confirmVariant="danger"
      />
      <PromptDialog
        isOpen={goToPageOpen}
        onClose={() => setGoToPageOpen(false)}
        onSubmit={(raw) => {
          const n = parseInt(raw, 10);
          if (!Number.isNaN(n) && n >= 1 && n <= state.pageOrder.length) jumpToPage(n - 1);
          setGoToPageOpen(false);
        }}
        title="Go to page"
        message={`Jump to a page (1–${state.pageOrder.length || 1}).`}
        label="Page"
        defaultValue={String(activePage)}
        inputType="number"
        inputMode="numeric"
        confirmLabel="Go"
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
    <div className="text-[9px] text-fg-muted mt-2 text-center select-none">
      <div>
        <span className="text-fg-muted font-semibold">RMPG PDF Engine</span> ·
        Native: <span className="[color:var(--panel-header-color)]">{summary.native}</span> · PDF.js fallback: <span className="text-fg-muted">{summary.pdfjs}</span>
        {last && <> · last: <span className="text-fg-muted">{last.backend}</span> ({last.reason.slice(0, 80)}{last.reason.length > 80 ? '…' : ''})</>}
      </div>
      <div className="mt-0.5">
        RMPG PDF Engine v1.0 — proprietary facade + writer; PDF.js (Mozilla, Apache 2.0) handles rendering for the long tail of document features (images, embedded fonts, cross-ref streams). Native renderer covers RMPG-generated PDFs and grows over time.
      </div>
    </div>
  );
}
