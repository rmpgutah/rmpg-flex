import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertTriangle, Loader2, MapPin, User, Building2, Phone, X, Camera, Edit3, Eye, Clock } from 'lucide-react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { apiFetch } from '../hooks/useApi';
import { useNavigate } from 'react-router-dom';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import ServeIntakeAttemptModal from '../components/serve-intake/ServeIntakeAttemptModal';

GlobalWorkerOptions.workerSrc = workerUrl;

interface UploadedFile {
  name: string;
  type: string;
  text: string;
  status: 'pending' | 'extracted' | 'error';
  ocrResult?: any;
  // Original File handle — held in state so processIntake() can POST
  // the actual bytes to /api/serve-intake/upload (server-side OCR via
  // PdfToolsContainer Tesseract + Workers AI Vision). The browser-side
  // pdfjs text extraction stays as a fast preview; the server re-runs
  // its own extraction on submit for accuracy.
  file?: File;
  // Set when this entry is a rasterized page synthesized from a scanned
  // (no text layer) PDF. The original PDF has no extractable text, so we
  // render its pages to images here and let the server's Vision OCR read
  // them. Carries the source PDF's filename for the UI to group under.
  // These entries are NOT shown in the document list (they're internal OCR
  // inputs) but DO ride along in the upload payload — see the render filter.
  derivedFrom?: string;
  // Set on an ORIGINAL scanned PDF whose pages we rasterized for Vision OCR.
  // Lets the list show a "Scan OCR" badge + a normal (non-error) status even
  // though the PDF itself yielded no extractable text — the OCR happens on the
  // derived images server-side on submit.
  scanned?: boolean;
  // Pre-upload metadata shown in the loaded-files list so the operator can
  // sanity-check a document (size/page-count/date) BEFORE committing the
  // batch. Captured in handleFiles when the file is read.
  size?: number;          // bytes (File.size)
  pages?: number;         // PDF page count (pdfjs numPages); undefined for images
  lastModified?: number;  // File.lastModified epoch ms
}

// A PDF whose pdfjs text layer yields fewer than this many characters is
// treated as a scan (image-only) and rasterized to images for Vision OCR.
// Matches the server's MIN_CLIENT_TEXT_CHARS so the two ends agree on what
// "born-digital" means.
const SCANNED_PDF_TEXT_THRESHOLD = 200;
// Mirror the server caps (src/routes/serveIntake.ts: MAX_UPLOAD_BYTES /
// MAX_FILES_PER_UPLOAD) so the operator is warned BEFORE a long upload that's
// doomed to 400. The server rejects the WHOLE batch if any single file exceeds
// 25 MB or the file count exceeds 30 — and a scanned PDF fans out into several
// rasterized page-images, each of which counts toward that 30.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_FILES = 30;
// Pages to rasterize from a scanned PDF. Recipient/service data on civil
// papers lives in the first few pages (cover sheet, summons face, field
// sheet); rendering every page of a 40-page docket would blow the 12-file
// upload cap and the Vision latency budget for no extraction gain. 6 gives a
// margin for packets where a cover/notice page pushes the info form to p3-5,
// while staying well under the upload cap.
const MAX_RASTER_PAGES = 6;
// Render scale — 2x device pixels keeps small print legible to the OCR
// model while JPEG q0.82 holds a letter page well under the 4 MB Vision cap.
const RASTER_SCALE = 2;
const RASTER_JPEG_QUALITY = 0.82;

interface IntakeResult {
  success: boolean;
  person_id: number;
  property_id: number | null;
  call_id: number;
  call_number: string;
  serve_queue_id: number | null;
  latitude: number | null;
  longitude: number | null;
  weather: string | null;
  lighting: string | null;
  extracted: {
    name: { first: string; middle: string; last: string };
    dob: string;
    address: string;
    plaintiff: string;
    court: string;
    docs: string;
    instructions: string;
    jobNumber: string;
    caseNumber: string;
    dueDate: string;
    attorney: { name: string; phone: string; email: string; bar: string };
    fee: string;
    processType: string;
    serviceWindows: string;
    deadlineStr: string;
    serverName: string;
  };
}

interface OcrScanResult {
  success: boolean;
  documentType: string;
  confidence: number;
  fields: Record<string, { value: string; confidence: number }>;
  rawText: string;
  allDates: string[];
}

const DOCUMENT_TYPES = [
  { value: 'court_filing', label: 'Court Filing/Docket', color: 'bg-red-900/40 text-red-400 border-red-700/40' },
  { value: 'field_sheet', label: 'Field Sheet', color: 'bg-amber-900/40 text-amber-400 border-amber-700/40' },
  { value: 'info_page', label: 'Information Page', color: 'bg-green-900/40 text-green-400 border-green-700/40' },
  { value: 'affidavit', label: 'Affidavit of Service', color: 'bg-purple-900/40 text-purple-400 border-purple-700/40' },
  { value: 'summons', label: 'Summons', color: 'bg-rmpg-900/40 text-rmpg-400 border-rmpg-700/40' },
  { value: 'complaint', label: 'Complaint', color: 'bg-orange-900/40 text-orange-400 border-orange-700/40' },
  { value: 'subpoena', label: 'Subpoena', color: 'bg-pink-900/40 text-pink-400 border-pink-700/40' },
  { value: 'eviction', label: 'Eviction/UD', color: 'bg-yellow-900/40 text-yellow-400 border-yellow-700/40' },
  { value: 'restraining_order', label: 'Restraining Order', color: 'bg-rose-900/40 text-rose-400 border-rose-700/40' },
  { value: 'identification', label: 'ID/Passport', color: 'bg-rmpg-900/40 text-rmpg-400 border-rmpg-700/40' },
  { value: 'correspondence', label: 'Correspondence', color: 'bg-slate-900/40 text-slate-400 border-slate-700/40' },
  { value: 'other', label: 'Other', color: 'bg-neutral-900/40 text-neutral-400 border-neutral-700/40' },
];

function confidenceColor(conf: number): string {
  if (conf >= 0.7) return 'text-green-400';
  if (conf >= 0.4) return 'text-amber-400';
  return 'text-red-400';
}

function confidenceBar(conf: number): string {
  if (conf >= 0.7) return 'bg-green-500';
  if (conf >= 0.4) return 'bg-amber-500';
  return 'bg-red-500';
}

// Live upload telemetry for the progress bar. `total` is the FULL multipart
// body size (files + form overhead) as reported by the browser, NOT the sum
// of file sizes — they differ by the multipart boundaries/headers.
interface UploadStat {
  loaded: number;       // bytes sent so far
  total: number;        // total bytes to send
  pct: number;          // 0-100
  etaMs: number | null; // estimated ms remaining, null until measurable
}

// Human-readable byte size. One decimal under 10 units, none above, so the
// readout stays compact in the tiny Spillman row ("2.4 MB", "640 KB", "18 MB").
function formatBytes(n: number): string {
  if (!n || n < 1024) return `${n || 0} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

// "~12s left" / "~1m 04s left". Returns '' when the estimate isn't usable yet
// (no samples, or non-finite from a divide-by-zero early in the upload).
function formatEta(ms: number | null): string {
  if (ms == null || !isFinite(ms) || ms <= 0) return '';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `~${s}s left`;
  const m = Math.floor(s / 60);
  return `~${m}m ${String(s % 60).padStart(2, '0')}s left`;
}

// Compact "2.4 MB · 12 pages · May 28" line shown under each loaded filename.
function fileMeta(f: UploadedFile): string {
  const parts: string[] = [];
  if (f.size != null) parts.push(formatBytes(f.size));
  if (f.pages && f.pages > 0) parts.push(`${f.pages} page${f.pages > 1 ? 's' : ''}`);
  if (f.lastModified) parts.push(new Date(f.lastModified).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })); // new-date-ok: File.lastModified is epoch ms (number), not a naive server timestamp string
  return parts.join(' · ');
}

// fetch() can't surface upload progress (the Fetch API has no request-body
// progress hook), so the multipart submit goes through XMLHttpRequest — its
// `upload` object emits byte-level progress events. onProgress(loaded, total)
// drives the % + ETA; onSent fires when the last byte leaves the browser so
// the caller can flip the bar from determinate % to an indeterminate
// "analyzing" state while the server runs OCR + extraction. Resolves with the
// raw status/text the caller needs (mirrors what it used from the Response).
function xhrUpload(
  url: string,
  body: FormData,
  token: string | null,
  onProgress: (loaded: number, total: number) => void,
  onSent: () => void,
  register: (xhr: XMLHttpRequest) => void,
): Promise<{ ok: boolean; status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    // Hand the XHR back to the caller so it can abort() on a Cancel click.
    register(xhr);
    xhr.open('POST', url);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
    xhr.upload.onload = () => onSent();
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new Error('Network error during upload'));
    // Distinguish a user cancel from a real failure (the `aborted` flag) so
    // the caller resets quietly instead of flashing a scary red error.
    xhr.onabort = () => reject(Object.assign(new Error('Upload canceled'), { aborted: true }));
    xhr.send(body);
  });
}

// Recursively collect every File from a dropped FileSystemEntry (a dropped
// FOLDER is a directory entry, not a flat file). Best-effort — unreadable
// entries resolve to [].
async function readEntryFiles(entry: any): Promise<File[]> {
  if (!entry) return [];
  if (entry.isFile) {
    return new Promise<File[]>((res) => entry.file((f: File) => res([f]), () => res([])));
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const readBatch = () => new Promise<any[]>((res) => reader.readEntries((e: any[]) => res(e), () => res([])));
    const all: File[] = [];
    // readEntries returns at most ~100 entries per call — loop until drained.
    for (let batch = await readBatch(); batch.length; batch = await readBatch()) {
      for (const child of batch) all.push(...await readEntryFiles(child));
    }
    return all;
  }
  return [];
}

// Resolve the files from a drop, expanding any dropped FOLDERS. dataTransfer.files
// is EMPTY for a folder drop — the contents only exist as webkitGetAsEntry()
// entries, which must be captured synchronously during the drop event (the item
// list is invalidated once we await). Falls back to .files when entries aren't
// available (older browsers / plain multi-file drops).
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = dt.items
    ? Array.from(dt.items).map((it) => (it as any).webkitGetAsEntry?.()).filter(Boolean)
    : [];
  if (entries.length) {
    const nested = await Promise.all(entries.map(readEntryFiles));
    const files = nested.flat();
    if (files.length) return files;
  }
  return Array.from(dt.files);
}

export default function ServeIntakePage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [processing, setProcessing] = useState(false);
  // Upload telemetry. `uploadPhase` distinguishes the byte-transfer phase
  // (determinate %) from the server-side OCR/extraction phase (indeterminate)
  // so the bar never parks at 100% looking hung. See xhrUpload.
  const [uploadStat, setUploadStat] = useState<UploadStat | null>(null);
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'uploading' | 'analyzing'>('idle');
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocrPreview, setOcrPreview] = useState<OcrScanResult | null>(null);
  const [editingFields, setEditingFields] = useState<Record<string, string>>({});
  const [showOcrPreview, setShowOcrPreview] = useState(false);
  const [showAttemptModal, setShowAttemptModal] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Live upload XHR, held so the Cancel button can abort() it mid-transfer.
  const uploadXhrRef = useRef<XMLHttpRequest | null>(null);

  // Window-level drag/drop guard. Without this, a file/folder dropped even a
  // few pixels OUTSIDE the drop zone makes the browser (and especially the
  // Electron desktop shell) try to navigate to the dropped file — the page
  // reloads or "nothing happens" and the drop is lost. We preventDefault at the
  // window so stray drops are swallowed harmlessly; the drop zone's own handler
  // stopPropagation()s, so in-zone drops still reach it normally.
  useEffect(() => {
    const stop = (e: DragEvent) => { e.preventDefault(); };
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);
  const navigate = useNavigate();

  const extractPdfText = useCallback(async (file: File): Promise<{ text: string; pages: number }> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      // verbosity: 0 = errors-only. Court packets often embed TrueType
      // fonts with non-standard hinting instructions (opcode 21, etc.)
      // that pdfjs's sanitizer doesn't recognize — it logs a benign
      // "TT: undefined function: N" warning per font and falls back to
      // sane rendering. Text extraction is unaffected. Suppressing here
      // keeps the console clean during intake; if a real PDF parse error
      // happens it still surfaces as a thrown promise rejection.
      const pdf = await getDocument({ data: arrayBuffer, verbosity: 0 }).promise;
      const numPages = pdf.numPages;
      const pageTexts: string[] = [];
      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pageTexts.push(content.items.map(item => (item as any).str).join(' '));
      }
      return { text: pageTexts.join('\n'), pages: numPages };
    } catch {
      return { text: '', pages: 0 };
    }
  }, []);

  // Render the first MAX_RASTER_PAGES pages of a scanned (no text layer)
  // PDF to JPEG image Files. These get uploaded alongside the originals so
  // the server's Workers AI Vision path can OCR them — the container
  // Tesseract path is NOT rolled out in prod, so without this a scanned
  // PDF extracts nothing at all. Best-effort: any failure returns [] and
  // the original PDF is still uploaded (server falls back to its own path).
  const rasterizePdf = useCallback(async (file: File): Promise<File[]> => {
    const out: File[] = [];
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await getDocument({ data: arrayBuffer, verbosity: 0 }).promise;
      const pageCount = Math.min(pdf.numPages, MAX_RASTER_PAGES);
      const base = file.name.replace(/\.pdf$/i, '');
      for (let i = 1; i <= pageCount; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: RASTER_SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        // White background before rasterizing: JPEG has no alpha, so a
        // transparent-background scanned PDF would render its transparent
        // regions as black and tank Vision-OCR contrast/recognition. Mirrors
        // the engine backend's pre-render fill (rmpg-pdf-engine/backends/pdfjs.ts).
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport } as any).promise;
        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, 'image/jpeg', RASTER_JPEG_QUALITY));
        // Free the canvas backing store before the next (potentially large) page.
        canvas.width = 0; canvas.height = 0;
        if (blob) out.push(new File([blob], `${base}-scan-p${i}.jpg`, { type: 'image/jpeg' }));
      }
    } catch {
      /* best-effort — empty list means "no rasterized pages added" */
    }
    return out;
  }, []);

  const ocrScanImage = useCallback(async (file: File): Promise<OcrScanResult | null> => {
    try {
      const formData = new FormData();
      formData.append('image', file);
      const token = localStorage.getItem('rmpg_token');
      const resp = await fetch('/api/ocr/scan-document', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (resp.ok) {
        return await resp.json();
      }
    } catch (err) { console.warn("[ServeIntakePage] operation failed:", err); }
    return null;
  }, []);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const newFiles: UploadedFile[] = [];
    for (const file of Array.from(fileList)) {
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf';
      if (!isImage && !isPdf) continue;

      let text = '';
      let ocrResult: any = null;
      let type = 'info_page';
      let scanned = false;
      let pageCount = 0;

      if (isPdf) {
        const extracted = await extractPdfText(file);
        text = extracted.text;
        pageCount = extracted.pages;
        const name = file.name.toLowerCase();
        type = name.includes('court') || name.includes('docket') ? 'court_filing'
          : name.includes('field') ? 'field_sheet'
          : name.includes('affidavit') ? 'affidavit'
          : name.includes('summons') ? 'summons'
          : name.includes('complaint') ? 'complaint'
          : name.includes('subpoena') ? 'subpoena'
          : name.includes('eviction') || name.includes('unlawful') ? 'eviction'
          : name.includes('restraining') || name.includes('protective') ? 'restraining_order'
          : name.includes('id') || name.includes('passport') || name.includes('license') ? 'identification'
          : 'info_page';

        // Scanned PDF (no usable text layer): rasterize its pages to images
        // so the server's Vision OCR can read them. The original PDF is still
        // uploaded too (audit trail + server fallback), but these images are
        // what actually carry the recipient/service data through extraction.
        if (text.trim().length < SCANNED_PDF_TEXT_THRESHOLD) {
          const pages = await rasterizePdf(file);
          for (let p = 0; p < pages.length; p++) {
            newFiles.push({
              name: pages[p].name,
              type,
              text: '',
              status: 'extracted',     // server Vision will do the real extraction
              file: pages[p],
              derivedFrom: file.name,
            });
          }
          // A scanned PDF that rasterized OK isn't an error — its OCR rides on
          // the derived images. Mark it so the row shows "Scan OCR" + a green
          // check instead of a misleading ⚠️ "no text" warning.
          scanned = pages.length > 0;
        }
      } else if (isImage) {
        const scan = await ocrScanImage(file);
        if (scan?.success) {
          ocrResult = scan;
          type = scan.documentType === 'court_docket' ? 'court_filing'
            : scan.documentType === 'field_sheet' ? 'field_sheet'
            : 'info_page';
          text = scan.rawText || '';
        }
      }

      newFiles.push({
        name: file.name, type, text,
        status: text.length > 50 || ocrResult?.success || scanned ? 'extracted' : 'error',
        scanned,
        ocrResult,
        file,
        size: file.size,
        pages: pageCount || undefined,
        lastModified: file.lastModified,
      });
    }
    setFiles(prev => [...prev, ...newFiles]);
    setError(null);
    setResult(null);
    setOcrPreview(null);
  }, [extractPdfText, ocrScanImage]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    // Expand any dropped folders. filesFromDrop must read the entry list
    // before the first await (the DataTransfer is invalidated after), so we
    // hand it the event's dataTransfer synchronously and resolve async.
    filesFromDrop(e.dataTransfer).then((files) => {
      if (files.length > 0) handleFiles(files);
      else setError('No PDF or image files found in what you dropped. If you dropped a folder, its files should load automatically — otherwise drop the documents directly.');
    }).catch(() => {
      if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
    });
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragActive) setDragActive(true);
  }, [dragActive]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear when the pointer actually leaves the drop zone (dragleave also
    // fires when crossing onto child elements — relatedTarget stays inside).
    if (!dropRef.current?.contains(e.relatedTarget as Node)) setDragActive(false);
  }, []);

  // Remove the row AND, if it's a scanned PDF, its hidden rasterized OCR pages
  // (derivedFrom === the removed file's name) so they don't upload orphaned.
  const removeFile = (idx: number) => setFiles(prev => {
    const target = prev[idx];
    return prev.filter((f, i) => i !== idx && f.derivedFrom !== target?.name);
  });
  const changeFileType = (idx: number, type: string) => setFiles(prev => prev.map((f, i) => i === idx ? { ...f, type } : f));

  const openOcrPreview = (file: UploadedFile) => {
    if (file.ocrResult?.fields) {
      setOcrPreview(file.ocrResult);
      setEditingFields({});
      setShowOcrPreview(true);
    }
  };

  // Server-side advanced OCR pipeline. POST raw files (multipart) to
  // /api/serve-intake/upload so the Worker runs the full pipeline:
  //   PDFs  → PdfToolsContainer (pdftotext + Tesseract OCR fallback)
  //         → Workers AI Llama 3.3 70B for structured field extraction
  //   Images → Workers AI Llama 3.2 11B Vision (single-pass OCR + extract)
  // Files are persisted to R2 under serve-intake/<userId>/<ts>-<rand>-<name>,
  // and each yields a serve_intake_documents sidecar row with raw OCR
  // text, per-field confidence, and model name for audit.
  //
  // This replaces the legacy /intake path that POSTed in-browser pdfjs
  // text — that path could not handle scanned/image-only PDFs or phone
  // photos of paperwork. Falls back to the legacy path on multipart
  // failure (e.g. all files exceed the per-file 25 MB cap).
  const processIntake = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setError(null);
    setResult(null);
    setUploadStat(null);
    setUploadPhase('uploading');
    const token = localStorage.getItem('rmpg_token');
    try {
      const filesWithBlobs = files.filter(f => !!f.file);
      const useServerSide = filesWithBlobs.length > 0;

      if (useServerSide) {
        const formData = new FormData();
        for (const f of filesWithBlobs) {
          if (f.file) formData.append('files[]', f.file, f.name);
        }
        // Send the browser pdfjs text alongside the files. The server
        // uses it for born-digital PDFs so it doesn't have to round-trip
        // through the OCR container (which isn't rolled out in prod).
        // Only empty/scanned PDFs fall through to the container path.
        formData.append('client_text', JSON.stringify(
          filesWithBlobs.map(f => ({ name: f.name, type: f.type, text: f.text || '' })),
        ));
        // performance.now() (monotonic, immune to wall-clock jumps) anchors
        // the ETA. Speed is averaged over the whole transfer so far — see the
        // smoothing note where setUploadStat is called.
        const startedAt = performance.now();
        const resp = await xhrUpload(
          '/api/serve-intake/upload',
          formData,
          token,
          (loaded, total) => {
            const elapsedSec = (performance.now() - startedAt) / 1000;
            const pct = total > 0 ? (loaded / total) * 100 : 0;
            // Average speed since start (bytes/sec). Averaging over the whole
            // transfer keeps the ETA stable on a flaky cellular link, where an
            // instantaneous sample would jitter wildly between readings. The
            // trade-off: it's slow to react if bandwidth genuinely changes
            // mid-upload. Good enough for the 1-12 file civil-paper batches here.
            const speed = elapsedSec > 0 ? loaded / elapsedSec : 0;
            const etaMs = speed > 0 ? ((total - loaded) / speed) * 1000 : null;
            setUploadStat({ loaded, total, pct, etaMs });
          },
          () => setUploadPhase('analyzing'),
          (xhr) => { uploadXhrRef.current = xhr; },
        );
        if (!resp.ok) {
          // The server rejects with { error } / { warning } + a 4xx/5xx. Surface
          // that message (e.g. "field-sheet.pdf exceeds … bytes", "Too many
          // files (max 30)") instead of dumping the raw status + JSON blob.
          let msg = `Upload failed (${resp.status})`;
          try {
            const j = JSON.parse(resp.text);
            msg = j?.error || j?.warning || msg;
          } catch { /* non-JSON body — keep the generic status message */ }
          throw new Error(msg);
        }
        const body = JSON.parse(resp.text) as IntakeResult & { warning?: string };
        if (body.success) {
          setResult(body);
        } else {
          // Surface the server's specific reason (e.g. "Documents stored
          // but no recipient could be extracted (…)") rather than a
          // generic message, so the operator knows whether to retry,
          // fix the docs, or create the entry manually.
          setError(body.warning || 'Intake processed but no records were created (check that the documents contain a recipient name or address)');
        }
      } else {
        // Fallback: only the pdfjs-extracted text is available (no File
        // blobs). Goes to /intake which runs LLM extraction over the
        // already-extracted browser text. There's no measurable upload (a
        // small JSON body), so jump straight to the analyzing phase.
        setUploadPhase('analyzing');
        const documents = files.map(f => ({ type: f.type, text: f.text }));
        const resp = await apiFetch<IntakeResult>('/serve-intake/intake', {
          method: 'POST',
          body: JSON.stringify({ documents }),
        });
        if (resp && resp.success) {
          setResult(resp);
        } else {
          setError('Intake processing failed');
        }
      }
    } catch (err: any) {
      // A user-initiated cancel isn't an error — reset quietly without the
      // red banner. Everything else surfaces its message.
      if (!err?.aborted) setError(err?.message || 'Failed to process documents');
    }
    uploadXhrRef.current = null;
    setProcessing(false);
    setUploadPhase('idle');
    setUploadStat(null);
  }, [files]);

  // Abort an in-flight upload. Only offered during the byte-transfer phase —
  // once the server is analyzing it may already be committing records, so
  // canceling then would leave the operator unsure what was created.
  const cancelUpload = useCallback(() => {
    uploadXhrRef.current?.abort();
  }, []);

  const previewFields = ocrPreview?.fields
    ? Object.entries(ocrPreview.fields).filter(([, f]) => f.value && f.confidence > 0).sort((a, b) => b[1].confidence - a[1].confidence)
    : [];

  // Operator-facing batch summary: count + combined size of the documents the
  // user actually dropped (rasterized scan pages are excluded — they're hidden
  // internal OCR inputs, see the render filter below).
  const visibleFiles = files.filter(f => !f.derivedFrom);
  const totalBytes = visibleFiles.reduce((sum, f) => sum + (f.size || 0), 0);

  // Pre-upload guards mirroring the server caps. Oversize is checked on the
  // visible docs (what the operator can act on); the file-count cap is checked
  // on the ACTUAL upload payload — files.length includes the hidden rasterized
  // scan pages, which is exactly what the server counts.
  const oversizeFiles = visibleFiles.filter(f => (f.size || 0) > MAX_UPLOAD_BYTES);
  const uploadItemCount = files.filter(f => !!f.file).length;
  const tooManyFiles = uploadItemCount > MAX_UPLOAD_FILES;
  const blockProcessing = oversizeFiles.length > 0 || tooManyFiles;

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <PanelTitleBar title="Process Service Intake" icon={Upload} />

      <div
        ref={dropRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
        role="button"
        tabIndex={0}
        aria-label="Upload documents: drag and drop or press Enter to browse"
        className={`border-2 border-dashed rounded-sm p-8 text-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#d4a017]/40 transition-all ${
          dragActive
            ? 'border-[#d4a017] bg-[#d4a017]/10 ring-2 ring-[#d4a017]/40'
            : 'border-rmpg-600 hover:border-rmpg-400 hover:bg-surface-raised/50 focus:border-rmpg-400'
        }`}
        style={dragActive ? undefined : { background: 'var(--surface-sunken)' }}
      >
        <Upload className={`w-10 h-10 mx-auto mb-3 ${dragActive ? 'text-[#d4a017]' : 'text-rmpg-500'}`} />
        <p className="text-sm font-bold text-rmpg-300">{dragActive ? 'RELEASE TO ADD DOCUMENTS' : 'DRAG & DROP DOCUMENTS'}</p>
        <p className="text-[10px] text-rmpg-500 mt-1">PDF or Images — a whole job folder works too</p>
        <p className="text-[9px] text-rmpg-600 mt-2">or click to browse files</p>
        <input id="ff-serveintakepage-0"
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/*"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {files.some(f => !f.derivedFrom) && (
        <div className="space-y-1">
          <p className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">
            {visibleFiles.length} Document{visibleFiles.length > 1 ? 's' : ''} Loaded
            <span className="text-rmpg-600 font-normal ml-2">
              {totalBytes > 0
                ? `(${formatBytes(totalBytes)} total · OCR confidence per document)`
                : '(OCR confidence shown per document)'}
            </span>
          </p>
          {/* Show only the files the user actually dropped. Rasterized scan
              pages (derivedFrom) are internal Vision-OCR inputs — they still
              ride along in the upload payload, but listing them made one
              scanned PDF look like 5 separate documents. Keep the real index
              for the row handlers. */}
          {files.map((f, i) => ({ f, i })).filter(({ f }) => !f.derivedFrom).map(({ f, i }) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 panel-beveled bg-surface-raised text-xs">
              <FileText className="w-4 h-4 text-rmpg-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-white font-medium truncate block">{f.name}</span>
                {fileMeta(f) && (
                  <span className={`text-[9px] font-mono truncate block ${(f.size || 0) > MAX_UPLOAD_BYTES ? 'text-red-400' : 'text-rmpg-600'}`}>{fileMeta(f)}</span>
                )}
              </div>
              {(f.size || 0) > MAX_UPLOAD_BYTES && (
                <span
                  className="text-[8px] font-bold uppercase px-1 py-0.5 rounded-sm border bg-red-900/40 text-red-400 border-red-700/40 whitespace-nowrap"
                  title={`Exceeds the ${formatBytes(MAX_UPLOAD_BYTES)} per-file limit — remove or split this file before processing`}
                >
                  Too large
                </span>
              )}
              {f.scanned && (
                <span
                  className="text-[8px] font-bold uppercase px-1 py-0.5 rounded-sm border bg-rmpg-900/40 text-rmpg-300 border-rmpg-700/40 whitespace-nowrap"
                  title="Scanned PDF — its pages are read by Vision OCR on submit"
                >
                  Scan OCR
                </span>
              )}
              <select id="ff-serveintakepage-1"
                value={f.type}
                onChange={e => changeFileType(i, e.target.value)}
                onClick={e => e.stopPropagation()}
                className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm border cursor-pointer appearance-none text-center min-w-[90px] ${
                  DOCUMENT_TYPES.find(dt => dt.value === f.type)?.color || 'bg-neutral-900/40 text-neutral-400 border-neutral-700/40'
                }`}
                aria-label={`Document type for ${f.name}`}
              >
                {DOCUMENT_TYPES.map(dt => (
                  <option key={dt.value} value={dt.value} className="bg-surface-raised text-white text-[9px]">{dt.label}</option>
                ))}
              </select>
              {f.ocrResult && (
                <span className={`text-[9px] font-bold ${confidenceColor(f.ocrResult.confidence)}`}>
                  {(f.ocrResult.confidence * 100).toFixed(0)}%
                </span>
              )}
              {f.status === 'extracted' ? (
                <CheckCircle className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              )}
              {f.ocrResult?.fields && Object.keys(f.ocrResult.fields).length > 0 && (
                <button
                  onClick={() => openOcrPreview(f)}
                  className="text-[9px] text-brand-400 hover:text-brand-300 flex items-center gap-0.5"
                  title="View OCR extraction details"
                >
                  <Eye className="w-3 h-3" /> Review
                </button>
              )}
              <IconButton onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`} className="p-0.5 text-rmpg-500 hover:text-red-400"><X className="w-3 h-3" /></IconButton>
            </div>
          ))}
        </div>
      )}

      {/* OCR Preview Modal */}
      {showOcrPreview && ocrPreview && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowOcrPreview(false)}>
          <div className="bg-surface-base border border-[#222] rounded-sm max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#222]">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-brand-400" />
                <span className="text-xs font-bold text-white uppercase">OCR Extraction Review</span>
                <span className={`text-[10px] font-bold ${confidenceColor(ocrPreview.confidence)}`}>
                  Confidence: {(ocrPreview.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <IconButton onClick={() => setShowOcrPreview(false)} aria-label="Close OCR preview">
                <X className="w-4 h-4" />
              </IconButton>
            </div>
            <div className="p-4 space-y-2">
              <div className="text-[10px] text-rmpg-400 mb-2">
                Document Type: <span className="text-white font-bold">{ocrPreview.documentType}</span>
                {' | '} Extracted Fields: <span className="text-white font-bold">{previewFields.length}</span>
              </div>
              <div className="w-full h-1.5 bg-[#222] rounded-sm overflow-hidden">
                <div className={`h-full rounded-sm transition-all ${confidenceBar(ocrPreview.confidence)}`}
                  style={{ width: `${Math.min(100, ocrPreview.confidence * 100)}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                {previewFields.slice(0, 30).map(([key, field]) => (
                  <div key={key} className="flex items-start gap-2 p-2 bg-surface-sunken rounded-sm">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-rmpg-500 uppercase font-mono">{key.replace(/_/g, ' ')}</span>
                        <span className={`text-[8px] font-bold ${confidenceColor(field.confidence)}`}>
                          {(field.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      {editingFields[key] !== undefined ? (
                        <input id="ff-serveintakepage-2"
                          type="text"
                          value={editingFields[key]}
                          onChange={e => setEditingFields(prev => ({ ...prev, [key]: e.target.value }))}
                          className="w-full bg-[#111] border border-[#333] rounded-sm px-2 py-0.5 text-xs text-white mt-0.5"
                          autoFocus
                        />
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-white truncate">{field.value}</span>
                          <IconButton
                            onClick={() => setEditingFields(prev => ({ ...prev, [key]: field.value }))}
                            aria-label={`Edit ${key}`}
                            className="text-rmpg-500 hover:text-brand-400 flex-shrink-0"
                          >
                            <Edit3 className="w-2.5 h-2.5" />
                          </IconButton>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {rawTextPreview(ocrPreview.rawText)}
            </div>
          </div>
        </div>
      )}

      {/* Upload progress — determinate % + ETA while bytes transfer, then an
          indeterminate pulse while the server runs OCR + extraction so the bar
          never sits parked at 100% looking hung. */}
      {processing && (
        <div className="panel-beveled bg-surface-raised p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-wider text-rmpg-300 flex items-center gap-1.5">
              {uploadPhase === 'analyzing' ? (
                <><Loader2 className="w-3 h-3 animate-spin text-[#d4a017]" /> Analyzing Documents</>
              ) : (
                <><Upload className="w-3 h-3 text-[#d4a017]" /> Uploading Documents</>
              )}
            </span>
            <span className="flex items-center gap-2">
              {uploadPhase === 'uploading' && uploadStat && (
                <span className="text-[10px] font-bold font-mono text-[#d4a017]">{uploadStat.pct.toFixed(0)}%</span>
              )}
              {uploadPhase === 'uploading' && (
                <button
                  onClick={cancelUpload}
                  className="text-[9px] font-bold uppercase tracking-wider text-rmpg-400 hover:text-red-400 flex items-center gap-0.5"
                  aria-label="Cancel upload"
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
              )}
            </span>
          </div>
          <div className="w-full h-1.5 bg-[#222] rounded-sm overflow-hidden">
            <div
              className={`h-full bg-[#d4a017] ${uploadPhase === 'analyzing' ? 'animate-pulse' : 'transition-all'}`}
              style={{ width: uploadPhase === 'analyzing' ? '100%' : `${uploadStat?.pct ?? 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[9px] text-rmpg-500 font-mono">
            <span>
              {uploadStat && uploadStat.total > 0
                ? `${formatBytes(uploadStat.loaded)} / ${formatBytes(uploadStat.total)}`
                : ''}
            </span>
            <span className="flex items-center gap-1">
              {uploadPhase === 'analyzing' ? (
                'Running OCR + extraction…'
              ) : uploadStat && formatEta(uploadStat.etaMs) ? (
                <><Clock className="w-2.5 h-2.5" /> {formatEta(uploadStat.etaMs)}</>
              ) : null}
            </span>
          </div>
        </div>
      )}

      {/* Pre-upload guards — block (don't silently skip) a batch the server
          would reject, naming exactly what to fix. Silently dropping an
          oversize legal document could mean dropping the actual summons. */}
      {!processing && !result && oversizeFiles.length > 0 && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-sm p-2.5 text-[10px] text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
          {oversizeFiles.length} file{oversizeFiles.length > 1 ? 's' : ''} exceed the {formatBytes(MAX_UPLOAD_BYTES)} per-file limit
          ({oversizeFiles.map(f => f.name).join(', ')}). Remove or split {oversizeFiles.length > 1 ? 'them' : 'it'} — the server rejects the whole batch otherwise.
        </div>
      )}
      {!processing && !result && tooManyFiles && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-sm p-2.5 text-[10px] text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
          This batch expands to {uploadItemCount} upload items (limit {MAX_UPLOAD_FILES}). Scanned PDFs each split into several page-images —
          remove some documents or process them in two passes.
        </div>
      )}

      {/* Process Button */}
      {files.length > 0 && !result && (
        <button
          onClick={processIntake}
          disabled={processing || files.every(f => f.status === 'error') || blockProcessing}
          className="w-full toolbar-btn toolbar-btn-primary py-3 text-sm font-bold justify-center"
        >
          {processing ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> {uploadPhase === 'analyzing' ? 'Analyzing Documents…' : 'Uploading Documents…'}</>
          ) : (
            <><Upload className="w-4 h-4" /> Create Person + Serve Queue Entry</>
          )}
        </button>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-sm p-3 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 inline mr-1" /> {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="bg-green-900/20 border border-green-700/40 rounded-sm p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-sm font-bold text-green-400">INTAKE COMPLETE</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="panel-beveled bg-surface-raised p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <User className="w-3.5 h-3.5 text-rmpg-400" />
                  <span className="text-[10px] text-rmpg-400 uppercase font-bold">Person Created</span>
                </div>
                <p className="text-sm font-bold text-white">
                  {result.extracted?.name?.first} {result.extracted?.name?.middle} {result.extracted?.name?.last}
                </p>
                {result.extracted?.dob && <p className="text-[10px] text-rmpg-400">DOB: {result.extracted.dob}</p>}
                {result.extracted?.serverName && <p className="text-[10px] text-rmpg-400">Server: {result.extracted.serverName}</p>}
                <button onClick={() => navigate('/records')} className="text-[9px] text-brand-400 mt-1 hover:underline">
                  View in Records →
                </button>
              </div>

              <div className="panel-beveled bg-surface-raised p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Building2 className="w-3.5 h-3.5 text-rmpg-400" />
                  <span className="text-[10px] text-rmpg-400 uppercase font-bold">Document Link</span>
                </div>
                <p className="text-xs text-white">{result.extracted?.address || 'No address extracted'}</p>
                {result.latitude && result.longitude && (
                  <p className="text-[9px] text-green-400 mt-1">
                    <MapPin className="w-3 h-3 inline" /> {result.latitude.toFixed(6)}, {result.longitude.toFixed(6)}
                  </p>
                )}
              </div>

              <div className="panel-beveled bg-surface-raised p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Phone className="w-3.5 h-3.5 text-rmpg-400" />
                  <span className="text-[10px] text-rmpg-400 uppercase font-bold">Serve Queue</span>
                </div>
                <p className="text-sm font-bold text-white font-mono">{result.call_number}</p>
                <p className="text-[10px] text-rmpg-400">{result.extracted?.processType ? result.extracted.processType.charAt(0).toUpperCase() + result.extracted.processType.slice(1).replace(/_/g, ' ') : 'PSO Client Request'} — Pending</p>
                <button onClick={() => navigate('/dispatch')} className="text-[9px] text-brand-400 mt-1 hover:underline">
                  View in Dispatch →
                </button>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-rmpg-700 grid grid-cols-2 gap-2 text-[10px]">
              {result.extracted?.court && <div><span className="text-rmpg-500">Court:</span> <span className="text-rmpg-300">{result.extracted.court}</span></div>}
              {result.extracted?.plaintiff && <div><span className="text-rmpg-500">Plaintiff:</span> <span className="text-rmpg-300">{result.extracted.plaintiff.substring(0, 60)}</span></div>}
              {result.extracted?.docs && <div><span className="text-rmpg-500">Documents:</span> <span className="text-rmpg-300">{result.extracted.docs}</span></div>}
              {result.extracted?.jobNumber && <div><span className="text-rmpg-500">Job #:</span> <span className="text-rmpg-300">{result.extracted.jobNumber}</span></div>}
              {result.extracted?.dueDate && <div><span className="text-rmpg-500">Due:</span> <span className="text-rmpg-300">{result.extracted.dueDate}</span></div>}
              {result.extracted?.attorney?.name && <div><span className="text-rmpg-500">Attorney:</span> <span className="text-rmpg-300">{result.extracted.attorney.name}</span></div>}
              {result.extracted?.fee && <div><span className="text-rmpg-500">Fee:</span> <span className="text-rmpg-300">{result.extracted.fee}</span></div>}
              {result.extracted?.serviceWindows && <div className="col-span-2"><span className="text-rmpg-500">Service Windows:</span> <span className="text-rmpg-300">{result.extracted.serviceWindows}</span></div>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Log First Attempt — only when we have a serve_queue_id to attach to.
                Officer can hit this immediately if they're heading to the address
                next, or skip it and log from the Serve page / dispatch panel later. */}
            {result.serve_queue_id != null && (
              <button
                onClick={() => setShowAttemptModal(true)}
                className="toolbar-btn justify-center py-2 border-amber-700/50 text-amber-300 hover:bg-amber-900/30"
              >
                Log First Attempt
              </button>
            )}
            <button
              onClick={() => { setFiles([]); setResult(null); }}
              className={`toolbar-btn justify-center py-2 ${result.serve_queue_id == null ? 'col-span-2' : ''}`}
            >
              Process Another Set of Documents
            </button>
          </div>
        </div>
      )}

      {/* Attempt modal — opens from "Log First Attempt" button above.
          Captures result + GPS + notes, POSTs to /api/serve-intake/:id/attempts,
          and surfaces the diligence-scheduling recommendation post-submit. */}
      {result?.serve_queue_id != null && (
        <ServeIntakeAttemptModal
          isOpen={showAttemptModal}
          onClose={() => setShowAttemptModal(false)}
          queueId={result.serve_queue_id}
          recipientName={
            [result.extracted?.name?.first, result.extracted?.name?.middle, result.extracted?.name?.last]
              .filter(Boolean).join(' ') || 'Recipient'
          }
          recipientAddress={result.extracted?.address || ''}
          callNumber={result.call_number}
        />
      )}
    </div>
  );
}

function rawTextPreview(text: string): React.ReactNode {
  if (!text || text.length < 10) return null;
  const preview = text.substring(0, 1000);
  return (
    <details className="mt-3">
      <summary className="text-[9px] text-rmpg-500 cursor-pointer hover:text-rmpg-300 uppercase tracking-wider">
        Raw OCR Text ({text.length} chars)
      </summary>
      <pre className="mt-1 p-2 bg-[#050505] border border-[#1a1a1a] rounded-sm text-[9px] text-rmpg-400 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
        {preview}
        {text.length > 1000 && <span className="text-red-400">\n...truncated ({text.length - 1000} more chars)</span>}
      </pre>
    </details>
  );
}
