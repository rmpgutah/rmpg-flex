import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertTriangle, Loader2, MapPin, User, Building2, Phone, X, Camera, Edit3, Eye, Clock, CalendarDays, ScanLine, ScanText } from 'lucide-react';
import ServeAttemptCalendar from '../components/serve/ServeAttemptCalendar';
import LiveDlScanner, { type IdScanResult } from '../components/LiveDlScanner';
import { aamvaToServeOverrides } from '../utils/scanIdToRecipient';
import { useToast } from '../components/ToastProvider';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { apiFetch } from '../hooks/useApi';
import { useNavigate, useSearchParams } from 'react-router';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import ServeIntakeAttemptModal from '../components/serve-intake/ServeIntakeAttemptModal';
import ServeRecordMatchPanel from '../components/serve/ServeRecordMatchPanel';
import { parseDefendants, type DetectedDefendant } from '../utils/serveIntakeDefendants';
import type { FieldVerdict } from '../types/serveIntakeJudge';
import DefendantsPicker from '../components/serve-intake/DefendantsPicker';
import JudgeFlagChip from '../components/serve-intake/JudgeFlagChip';
import { toDisplayLabel } from '../utils/formatters';
import { importWithRetry } from '../utils/importWithRetry';
import QualityReviewPanel from '../components/serve-intake/QualityReviewPanel';

GlobalWorkerOptions.workerSrc = workerUrl;

// Maps server CRITICAL_FIELDS human-readable labels → PUT /api/serve-intake/:id body keys.
// Labels that don't have a corresponding PUT field (e.g. "DOB", "phone") are omitted —
// the server doesn't accept those columns via this endpoint, so we skip them rather than
// silently dropping data.
const MISSING_FIELD_TO_PUT_KEY: Record<string, string> = {
  'recipient name': 'recipient_name',
  'address': 'recipient_address',
  'case number': 'case_number',
  'court': 'court_name',
  'service deadline': 'deadline',
};

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
  // Set when the server-side field-extraction call for this PDF (scanPdfOcr)
  // failed or timed out. `status` alone can't signal this: it's set to
  // 'extracted' at upload time purely from whether pdfjs found a text layer
  // client-side, before scanPdfOcr's async server round-trip even starts, so
  // a later server-side failure previously left the checkmark showing green
  // with zero indication the fields were never actually extracted.
  ocrScanFailed?: boolean;
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
  defendant_person_id: number;
  plaintiff_person_id: number | null;
  attorney_person_id: number | null;
  property_id: number | null;
  case_id: number;
  call_id: number;
  call_number: string;
  serve_queue_id: number | null;
  latitude: number | null;
  longitude: number | null;
  weather: string | null;
  lighting: string | null;
  extracted: {
    defendant: { first: string; middle: string; last: string; dob: string };
    name: { first: string; middle: string; last: string };
    dob: string;
    address: string;
    plaintiff: string;
    court: string;
    documents: string;
    docs: string;
    primaryDoc: string;
    serviceType: string;
    clientJobNumber: string;
    jobNumber: string;
    dueDate: string;
    attorney: { name: string; phone: string; email: string; bar: string };
    fee: string;
    processType: string;
    serviceWindows: string;
    deadlineStr: string;
    serverName: string;
  };
  // /upload-only extras: per-document OCR provenance + the critical fields
  // the extractor could NOT find (rendered as a verify-before-service strip).
  // `model` is the LLM that actually did the FIELD extraction (e.g.
  // 'claude:claude-opus-4-8' or '@cf/meta/llama-3.3-70b-instruct-fp8-fast') —
  // distinct from `ocr_engine`, which for PDFs only describes how the raw TEXT
  // was acquired (pdfjs-client/tesseract/pdftotext), not which model read it.
  documents?: Array<{
    file_name: string; doc_type?: string | null; ocr_engine?: string | null;
    confidence?: number; success?: boolean; page_count?: number | null; model?: string | null;
  }>;
  missing_critical?: string[];
  // Diligence planner output — dated attempt windows computed at intake.
  attempt_plan?: Array<{ attempt: number; date: string; weekday: string; window: string; focus: string }>;
  // Set when this packet matched an existing ACTIVE queue entry: documents
  // were attached to it and no new call/queue records were created.
  duplicate_of?: { serve_queue_id: number; status: string; case_number: string | null } | null;
}

interface OcrScanResult {
  success: boolean;
  documentType: string;
  confidence: number;
  fields: Record<string, { value: string; confidence: number }>;
  rawText: string;
  allDates: string[];
  // The LLM that performed extraction — 'claude:...' when the advanced engine
  // ran, a '@cf/meta/...' Workers AI model id when it fell back. Used to warn
  // the operator when advanced OCR is unavailable and results may be weaker.
  model?: string;
}

// True when a document's extraction fell back to the free Workers AI model
// instead of the configured paid engine (Claude/OpenAI). Absent `model` (older
// cached results, or a doc that never reached extraction) is NOT treated as
// degraded — there's nothing to warn about yet. Server always labels a paid
// result as `${provider}:${model}` (see serveIntakeExtract.ts / visionExtract.ts),
// so an OpenAI result is always 'openai:gpt-...' — never a bare 'gpt-...' id.
function isFallbackEngine(model: string | null | undefined): boolean {
  if (!model) return false;
  return !model.startsWith('claude:') && !model.startsWith('openai:');
}

const DOCUMENT_TYPES = [
  { value: 'court_filing', label: 'Court Filing / Docket', color: 'bg-red-900/40 text-red-400 border-red-700/40' },
  { value: 'field_sheet', label: 'Field Sheet', color: 'bg-amber-900/40 text-amber-400 border-amber-700/40' },
  { value: 'info_page', label: 'Information Page', color: 'bg-green-900/40 text-green-400 border-green-700/40' },
  { value: 'affidavit', label: 'Affidavit of Service', color: 'bg-purple-900/40 text-purple-400 border-purple-700/40' },
  { value: 'summons', label: 'Summons & Complaint', color: 'bg-rmpg-900/40 text-rmpg-400 border-rmpg-700/40' },
  { value: 'complaint', label: 'Complaint', color: 'bg-orange-900/40 text-orange-400 border-orange-700/40' },
  { value: 'small_claims', label: 'Small Claims Filing', color: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40' },
  { value: 'divorce_family', label: 'Divorce & Family Petition', color: 'bg-sky-900/40 text-sky-400 border-sky-700/40' },
  { value: 'garnishment', label: 'Writ of Garnishment', color: 'bg-indigo-900/40 text-indigo-400 border-indigo-700/40' },
  { value: 'subpoena', label: 'Subpoena', color: 'bg-pink-900/40 text-pink-400 border-pink-700/40' },
  { value: 'eviction', label: 'Eviction / UD Notice', color: 'bg-yellow-900/40 text-yellow-400 border-yellow-700/40' },
  { value: 'restraining_order', label: 'Restraining / Protective Order', color: 'bg-rose-900/40 text-rose-400 border-rose-700/40' },
  { value: 'probate', label: 'Probate / Guardianship Citation', color: 'bg-teal-900/40 text-teal-400 border-teal-700/40' },
  { value: 'identification', label: 'ID / Passport', color: 'bg-rmpg-900/40 text-rmpg-400 border-rmpg-700/40' },
  { value: 'correspondence', label: 'Correspondence', color: 'bg-surface-overlay/40 text-rmpg-400 border-rmpg-700/40' },
  { value: 'other', label: 'Other Legal Document', color: 'bg-surface-overlay/40 text-rmpg-400 border-rmpg-700/40' },
];

// Human-readable label for the per-document `ocr_engine` slug shown in the
// "Extraction Context" panel below. Kept in sync with (but not imported
// from, since this is a client-only display concern) the server-side
// ENGINE_LABEL map in src/utils/serveIntakeBriefing.ts — an engine slug not
// listed here falls back to the raw slug rather than blank text.
const OCR_ENGINE_LABELS: Record<string, string> = {
  'pdfjs-client': 'PDF text',
  'workers-ai-vision': 'Vision OCR',
  'workers-ai-tomarkdown': 'Structured PDF (Markdown)',
  tesseract: 'Tesseract OCR',
  pdftotext: 'pdftotext',
};

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
  if (f.lastModified) parts.push(new Date(f.lastModified).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' })); // new-date-ok: File.lastModified is epoch ms (number), not a naive server timestamp string
  return parts.join(' · ');
}

// fetch() can't surface upload progress (the Fetch API has no request-body
// progress hook), so the multipart submit goes through XMLHttpRequest — its
// `upload` object emits byte-level progress events. onProgress(loaded, total)
// drives the % + ETA; onSent fires when the last byte leaves the browser so
// the caller can flip the bar from determinate % to an indeterminate
// "analyzing" state while the server runs OCR + extraction. Resolves with the
// raw status/text the caller needs (mirrors what it used from the Response).
// Read the bytes into an in-memory File so the eventual upload doesn't fail
// with ERR_UPLOAD_FILE_CHANGED when something touches the disk file between
// pick and submit. The intake flow holds files in state for seconds-to-
// minutes while the operator reviews OCR — plenty of time for iCloud Drive
// / OneDrive / Spotlight / anti-virus to bump lastModified on the original.
// The snapshot is backed by an ArrayBuffer the browser owns, so a disk
// change can no longer abort the multipart send. Preserves name/type/
// lastModified so the rest of the page (status badges, dedupe heuristics,
// scan-OCR docType inference) is unaffected.
async function snapshotFile(f: File): Promise<File> {
  const bytes = await f.arrayBuffer();
  return new File([bytes], f.name, { type: f.type, lastModified: f.lastModified });
}

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
    // XHR onerror doesn't surface the underlying browser code (ERR_UPLOAD_FILE_CHANGED,
    // ERR_INTERNET_DISCONNECTED, ERR_HTTP2_PROTOCOL_ERROR, etc.) — the spec
    // gives us nothing. We can at least disambiguate the offline case via
    // navigator.onLine, and tell the operator what to check next; the
    // ERR_UPLOAD_FILE_CHANGED race is now defended at the snapshotFile() seam
    // in handleFiles, so a generic network failure here is most likely a real
    // connectivity / firewall issue.
    xhr.onerror = () => {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      reject(new Error(
        offline
          ? 'Upload failed: device is offline. Reconnect and try again.'
          : 'Upload failed: network error. Check your connection or VPN/firewall; if the file is in iCloud/OneDrive, copy it to a local folder first and retry.',
      ));
    };
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
  const [confirmRemoveFileIdx, setConfirmRemoveFileIdx] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  // Upload telemetry. `uploadPhase` distinguishes the byte-transfer phase
  // (determinate %) from the server-side OCR/extraction phase (indeterminate)
  // so the bar never parks at 100% looking hung. See xhrUpload.
  const [uploadStat, setUploadStat] = useState<UploadStat | null>(null);
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'uploading' | 'analyzing'>('idle');
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocrPreview, setOcrPreview] = useState<OcrScanResult | null>(null);
  // Tracks which field keys are currently showing an edit input in the OCR
  // Extraction Review modal (true = editing). The actual value being typed
  // lives in `editOverrides` (the same state that feeds `field_overrides` on
  // submit) — this used to be its own disconnected Record<string,string>
  // that nothing ever read back out, so edits made here silently vanished.
  const [editingFields, setEditingFields] = useState<Record<string, boolean>>({});
  const [showOcrPreview, setShowOcrPreview] = useState(false);
  const [showAttemptModal, setShowAttemptModal] = useState(false);
  // Tab: 'intake' = upload flow, 'schedule' = attempt calendar, 'enforcement' = quality review
  const [activeTab, setActiveTab] = useState<'intake' | 'schedule' | 'enforcement'>('intake');
  // Badge count for the Enforcement tab — shows pending needs_review items.
  const [reviewPendingCount, setReviewPendingCount] = useState(0);

  useEffect(() => {
    apiFetch<{ count: number }>('/serve-intake/review-queue?count=1')
      .then(d => setReviewPendingCount(d.count ?? 0))
      .catch(() => {});
  }, []);
  // Pre-submission field overrides: operator edits BEFORE clicking Create.
  // Keys match the server's field key names (e.g. `recipient_first_name`).
  const [editOverrides, setEditOverrides] = useState<Record<string, string>>({});
  // Tracks which field keys were populated by OCR (vs. typed by the operator).
  // Used to show a subtle "OCR" badge so operators know what was auto-filled.
  const [ocrSourced, setOcrSourced] = useState<Set<string>>(new Set());
  const [showIdScanner, setShowIdScanner] = useState(false);
  const { addToast } = useToast();
  // Active clients for the client selector dropdown.
  const [clients, setClients] = useState<{id: number; name: string; contact_name: string | null; contact_phone: string | null}[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  // Audit caught (2026-06-21): bare .catch(() => {}) left the clients
  // dropdown empty when the load failed. Operator couldn't tell whether
  // there were no clients or whether the load broke — they then created
  // intakes with no client attached, breaking downstream billing
  // auto-assign. Surface the failure and block submit.
  const [clientLoadError, setClientLoadError] = useState<string | null>(null);
  const [detectedDefendants, setDetectedDefendants] = useState<DetectedDefendant[]>([]);
  const [selectedDefendants, setSelectedDefendants] = useState<string[]>([]);
  const [judgeVerdicts, setJudgeVerdicts] = useState<Record<string, FieldVerdict>>({});
  // ConfirmDialog for the "Process Another Set" reset — clears uploaded documents.
  const [confirmReset, setConfirmReset] = useState(false);
  // Actionable missing-field inputs on the success screen.
  // Keyed by the human-readable CRITICAL_FIELDS label so they stay in sync
  // with result.missing_critical without an extra mapping step.
  const [missingFieldValues, setMissingFieldValues] = useState<Record<string, string>>({});
  const [missingFieldSaving, setMissingFieldSaving] = useState(false);
  const [missingFieldSaved, setMissingFieldSaved] = useState(false);
  const [clientsLoading, setClientsLoading] = useState(true);
  useEffect(() => {
    setClientsLoading(true);
    apiFetch<{id:number;name:string;contact_name:string|null;contact_phone:string|null}[]>('/serve-intake/clients')
      .then((data) => { setClients(data); setClientLoadError(null); })
      .catch((err: any) => setClientLoadError(err?.message || 'Failed to load clients — refresh to retry'))
      .finally(() => setClientsLoading(false));
  }, []);
  // Auto-match client from OCR-extracted plaintiff/client_name when no client is
  // selected yet. Uses simple substring matching (case-insensitive, both directions)
  // to avoid false positives from partial names.
  useEffect(() => {
    if (selectedClientId !== null || clients.length === 0) return;
    const candidate = (editOverrides['client_name'] || editOverrides['plaintiff'] || '').trim().toLowerCase();
    if (!candidate || candidate.length < 4) return;
    const match = clients.find(c => {
      const n = c.name.toLowerCase();
      return n.includes(candidate) || candidate.includes(n);
    });
    if (match) {
      setSelectedClientId(match.id);
      setEditOverrides(prev => ({ ...prev, client_name: match.name }));
    }
  }, [editOverrides, clients, selectedClientId]);

  const navigate = useNavigate();
  const { user } = useAuth();
  // Roles that may create new intake records.
  const MANAGE_ROLES = new Set(['admin', 'manager', 'supervisor', 'officer', 'dispatcher']);
  const canManage = MANAGE_ROLES.has(user?.role ?? '');

  const [searchParams, setSearchParams] = useSearchParams();
  // Deep-link: ?intake_id= jumps to a completed intake result. Captured at mount
  // via ref so the value survives later setSearchParams strips.
  const pendingIntakeIdRef = useRef<string | null>(searchParams.get('intake_id'));

  const [dragActive, setDragActive] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
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

  // Deep-link: strip ?intake_id= / ?case_id= after mount (no-ops if absent).
  // ?case_id= redirects to /dispatch immediately; ?intake_id= toasts the id.
  useEffect(() => {
    const id = pendingIntakeIdRef.current;
    if (!id) return;
    pendingIntakeIdRef.current = null;
    const next = new URLSearchParams(searchParams);
    next.delete('intake_id');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Keyboard shortcuts:
  //   N  — start a new intake (focus the file picker); gated by canManage
  //   Esc — cascade: close OCR preview → attempt modal → reset result
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showOcrPreview) { e.stopPropagation(); setShowOcrPreview(false); return; }
        if (showAttemptModal) { e.stopPropagation(); setShowAttemptModal(false); return; }
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        if (isTyping(e.target)) return;
        if (!canManage) return;
        e.preventDefault();
        fileInputRef.current?.click();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showOcrPreview, showAttemptModal, canManage]);

  // Merge OCR field values from newly-loaded images into editOverrides.
  // "Fill empty slots" strategy: only writes keys not already set by the
  // operator (or a prior file), so manual edits and earlier-file values
  // are never overwritten when a second document is added to the batch.
  // Takes the highest-confidence value per field across all image files.
  useEffect(() => {
    const best: Record<string, { value: string; conf: number }> = {};
    for (const f of files) {
      if (!f.ocrResult?.fields) continue;
      for (const [k, v] of Object.entries(f.ocrResult.fields as Record<string, { value: string; confidence: number }>)) {
        if (v.value && v.confidence > (best[k]?.conf ?? 0)) {
          best[k] = { value: v.value, conf: v.confidence };
        }
      }
    }
    if (Object.keys(best).length === 0) return;
    setEditOverrides(prev => {
      const next = { ...prev };
      const newlySourced: string[] = [];
      for (const [k, { value }] of Object.entries(best)) {
        if (!next[k]) { next[k] = value; newlySourced.push(k); }
      }
      if (newlySourced.length > 0) {
        setOcrSourced(s => { const n = new Set(s); newlySourced.forEach(k => n.add(k)); return n; });
      }
      return next;
    });
    let bestDefendant = '';
    let bestConf = 0;
    for (const f of files) {
      const v = f.ocrResult?.fields?.defendant;
      if (v?.value && v.confidence > bestConf) { bestDefendant = v.value; bestConf = v.confidence; }
    }
    const detected = parseDefendants(bestDefendant);
    setDetectedDefendants(detected);
    setSelectedDefendants(prev => {
      if (prev.length === 0 && detected.length > 0) return detected.map(d => d.name);
      return prev.filter(n => detected.some(d => d.name === n));
    });
  }, [files]);

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
        ctx.fillStyle = 'white';
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

  const ocrScanImage = useCallback(async (file: File, docType: string = 'auto'): Promise<OcrScanResult | null> => {
    try {
      const formData = new FormData();
      formData.append('image', file);
      // 'auto' → the server's Claude-vision engine classifies the image (ID card /
      // license plate / serve document) AND extracts its fields in one call.
      formData.append('docType', docType);
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

  // Server-side field extraction for born-digital PDFs. The client already
  // extracted the text via pdfjs; we send that text alongside the file so the
  // Worker skips the OCR container (not rolled out in prod) and runs the LLM
  // extraction directly. When the scan resolves, the file entry is updated with
  // the ocrResult so the useEffect below can merge fields into editOverrides.
  // Fire-and-forget — errors are silent so they don't block the UI.
  const scanPdfOcr = useCallback(async (file: File, text: string) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('client_text', text);
      const token = localStorage.getItem('rmpg_token');
      const resp = await fetch('/api/serve-intake/scan-document', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (!resp.ok) {
        setFiles(prev => prev.map(f => f.file === file ? { ...f, ocrScanFailed: true } : f));
        return;
      }
      const scanResult: OcrScanResult = await resp.json();
      if (scanResult?.fields) {
        setFiles(prev => prev.map(f =>
          f.file === file ? { ...f, ocrResult: scanResult } : f,
        ));
      }
    } catch {
      // Network/timeout failure — still surface it rather than silently
      // leaving a false-positive "extracted" checkmark (see ocrScanFailed doc).
      setFiles(prev => prev.map(f => f.file === file ? { ...f, ocrScanFailed: true } : f));
    }
  }, []);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const newFiles: UploadedFile[] = [];
    // Born-digital PDFs queued for server-side LLM field extraction after setFiles.
    const pdfScans: Array<{ file: File; text: string }> = [];
    for (const rawFile of Array.from(fileList)) {
      const isImage = rawFile.type.startsWith('image/');
      const isPdf = rawFile.type === 'application/pdf';
      if (!isImage && !isPdf) continue;

      // Snapshot to in-memory bytes immediately so the eventual upload
      // can't abort with ERR_UPLOAD_FILE_CHANGED if the disk file is
      // touched while the operator reviews OCR. See snapshotFile() above.
      let file: File;
      try {
        file = await snapshotFile(rawFile);
      } catch {
        // arrayBuffer() can throw if the underlying file vanished between
        // pick and read (rare). Skip the file rather than wedge the batch.
        continue;
      }

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
        // We also run ocrScanImage on each page immediately so editOverrides
        // gets pre-filled from the scanned content — same path as dropped images.
        if (text.trim().length < SCANNED_PDF_TEXT_THRESHOLD) {
          const pages = await rasterizePdf(file);
          for (let p = 0; p < pages.length; p++) {
            const pageOcr = await ocrScanImage(pages[p], type);
            newFiles.push({
              name: pages[p].name,
              type,
              text: pageOcr?.rawText || '',
              status: 'extracted',
              file: pages[p],
              derivedFrom: file.name,
              ocrResult: pageOcr ?? undefined,
            });
          }
          // A scanned PDF that rasterized OK isn't an error — its OCR rides on
          // the derived images. Mark it so the row shows "Scan OCR" + a green
          // check instead of a misleading ⚠️ "no text" warning.
          scanned = pages.length > 0;
        } else {
          // Born-digital PDF with a text layer: queue for server-side LLM
          // field extraction so the review panel pre-fills with extracted values.
          // Fired after setFiles so the file is already in state when the result
          // arrives and updates it. Same flow as ocrScanImage for image files.
          pdfScans.push({ file, text });
        }
      } else if (isImage) {
        const scan = await ocrScanImage(file);
        // Attach whenever OCR ran at all, not just when scan.success is true.
        // success requires a field with confidence > 0.3 (serveIntakeExtract.ts),
        // but fields can be extracted correctly at a lower self-reported
        // confidence — gating on success here silently dropped the whole
        // result (and with it, the "Review" step that fills editOverrides),
        // even though the field values were right there in scan.fields.
        // The rasterized-scanned-PDF-page branch above never had this gate.
        if (scan) {
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
    // Fire server-side extraction for born-digital PDFs in parallel (best-effort).
    // Results trickle back and update the file entries, which triggers the
    // useEffect below to merge fields into editOverrides.
    pdfScans.forEach(({ file, text }) => scanPdfOcr(file, text));
  }, [extractPdfText, ocrScanImage, scanPdfOcr]);

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
  // Gated to canManage — non-managers cannot remove documents.
  const removeFile = (idx: number) => setFiles(prev => {
    const target = prev[idx];
    return prev.filter((f, i) => i !== idx && f.derivedFrom !== target?.name);
  });
  const requestRemoveFile = (idx: number) => {
    if (!canManage) return;
    setConfirmRemoveFileIdx(idx);
  };
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
    if (detectedDefendants.length > 1 && selectedDefendants.length === 0) {
      setError('Pick at least one defendant to serve.');
      return;
    }
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
        if (selectedDefendants.length > 0 || detectedDefendants.length > 1) {
          formData.append('defendants_selected', JSON.stringify(selectedDefendants));
        }
        formData.append('client_text', JSON.stringify(
          filesWithBlobs.map(f => ({ name: f.name, type: f.type, text: f.text || '' })),
        ));
        // Send operator overrides from the pre-submission review panel.
        // Server applies them at confidence 1.0 after its own extraction,
        // so they win over any AI-extracted value.
        const nonEmptyOverrides = Object.fromEntries(
          Object.entries(editOverrides).filter(([, v]) => v.trim()),
        );
        if (Object.keys(nonEmptyOverrides).length > 0) {
          formData.append('field_overrides', JSON.stringify(nonEmptyOverrides));
        }
        if (selectedClientId) {
          formData.append('client_id', String(selectedClientId));
        }
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
          if ((body as any).judge_verdicts) {
            setJudgeVerdicts((body as any).judge_verdicts);
          }
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
        const legacyBody: Record<string, unknown> = { documents };
        if (selectedClientId) legacyBody.client_id = selectedClientId;
        if (selectedDefendants.length > 0) legacyBody.defendants_selected = selectedDefendants;
        const legacyOverrides = Object.fromEntries(Object.entries(editOverrides).filter(([, v]) => v.trim()));
        if (Object.keys(legacyOverrides).length > 0) legacyBody.field_overrides = legacyOverrides;
        const resp = await apiFetch<IntakeResult>('/serve-intake/intake', {
          method: 'POST',
          body: JSON.stringify(legacyBody),
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
    } finally {
      uploadXhrRef.current = null;
      setProcessing(false);
      setUploadPhase('idle');
      setUploadStat(null);
    }
  }, [files, editOverrides, detectedDefendants, selectedDefendants, selectedClientId]);

  // Abort an in-flight upload. Only offered during the byte-transfer phase —
  // once the server is analyzing it may already be committing records, so
  // canceling then would leave the operator unsure what was created.
  const cancelUpload = useCallback(() => {
    uploadXhrRef.current?.abort();
  }, []);

  // Scan a physical DL/ID barcode to prefill recipient fields without manual
  // typing. Only merges non-empty mapped fields into editOverrides so it
  // never blanks a value the operator already entered/corrected.
  const handleIdScanComplete = useCallback(async ({ barcodeText }: IdScanResult) => {
    setShowIdScanner(false);
    if (!barcodeText) { addToast('No barcode read — try again or enter manually', 'error'); return; }
    try {
      const { parseAamva, looksLikeAamva } = await importWithRetry(() => import('../utils/aamvaParser'));
      if (!looksLikeAamva(barcodeText)) { addToast('Barcode did not decode as a DL/ID', 'error'); return; }
      const parsed = parseAamva(barcodeText);
      const scanFields = aamvaToServeOverrides(parsed);
      setEditOverrides((prev) => {
        const next = { ...prev };
        const newlySourced: string[] = [];
        for (const [k, v] of Object.entries(scanFields)) {
          if (v && !next[k]) { next[k] = v; newlySourced.push(k); }
          else if (v) next[k] = v;
        }
        setOcrSourced(s => { const n = new Set(s); newlySourced.forEach(k => n.add(k)); return n; });
        return next;
      });
      addToast('Recipient fields filled from ID scan — review before submitting', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Scan failed to parse — enter manually', 'error');
    }
  }, [addToast]);

  const previewFields = ocrPreview?.fields
    ? Object.entries(ocrPreview.fields).filter(([, f]) => f.value && f.confidence > 0).sort((a, b) => b[1].confidence - a[1].confidence)
    : [];

  // Field change handler: update value and clear the OCR-sourced indicator so
  // a manually-edited field no longer shows the "OCR" autofill badge.
  const overrideField = useCallback((key: string, value: string) => {
    setEditOverrides(prev => ({ ...prev, [key]: value }));
    setOcrSourced(prev => { const n = new Set(prev); n.delete(key); return n; });
  }, []);

  // Saves the operator-filled missing-critical fields to the queue entry via PATCH.
  const handleMissingFieldSave = useCallback(async (queueId: number) => {
    const body: Record<string, string> = {};
    for (const [label, value] of Object.entries(missingFieldValues)) {
      const putKey = MISSING_FIELD_TO_PUT_KEY[label];
      if (putKey && value.trim()) body[putKey] = value.trim();
    }
    if (Object.keys(body).length === 0) return;
    setMissingFieldSaving(true);
    try {
      await apiFetch(`/serve-intake/${queueId}`, { method: 'PUT', body: JSON.stringify(body) });
      setMissingFieldSaved(true);
    } catch {
      // Keep the inputs so the operator can retry; addToast isn't available in
      // this callback scope — error is surfaced by the button staying active.
    } finally {
      setMissingFieldSaving(false);
    }
  }, [missingFieldValues]);

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
  // clientLoadError is part of this guard, not decoration. The 2026-06-21 audit
  // added the state and wired it to the catch, but neither of the two things it
  // exists for — surfacing the failure and blocking submit — was ever built, so
  // the failure it describes stayed live: with the dropdown silently empty an
  // operator cannot tell "no clients" from "the load broke", attaches no client,
  // and downstream billing auto-assign has nothing to key on.
  const blockProcessing = oversizeFiles.length > 0 || tooManyFiles || !!clientLoadError;

  // Degraded-engine warning: true when at least one document that finished
  // OCR fell back to the free Workers AI model instead of the configured
  // Claude/OpenAI engine (dead key, exhausted credit, or a transient outage).
  // Checked both pre-submission (files[].ocrResult, set as scans trickle in)
  // and post-submission (result.documents, the server's authoritative record)
  // so the operator sees it whichever phase they're in.
  const preSubmitFallback = files.some(f => isFallbackEngine(f.ocrResult?.model));
  const postSubmitFallback = !!result?.documents?.some(d => isFallbackEngine(d.model));
  const showFallbackWarning = preSubmitFallback || postSubmitFallback;

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <PanelTitleBar title="Process Service Intake" icon={Upload} />

      {user && ['admin', 'manager'].includes(user.role) && (
        <button
          onClick={() => navigate('/tesseract-training')}
          className="flex items-center gap-1.5 px-3 py-1 text-[11px] border border-surface-border hover:bg-surface-raised"
        >
          <ScanText size={12} /> OCR Learning
        </button>
      )}

      {activeTab === 'intake' && showFallbackWarning && (
        <div className="flex items-start gap-2 px-3 py-2 panel-beveled bg-amber-900/20 border border-amber-700/40 text-amber-300 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Advanced OCR (Claude/OpenAI) is currently unavailable — this batch used the standard
            fallback engine, which reads real-world documents less reliably. Double-check
            every extracted field below before submitting.
          </span>
        </div>
      )}

      {/* Tab strip */}
      <div className="flex gap-0 border-b border-surface-border">
        {(['intake', 'schedule', 'enforcement'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-[6px] text-[11px] font-semibold uppercase tracking-wide border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-brand-400 text-brand-300'
                : 'border-transparent text-rmpg-500 hover:text-rmpg-300'
            }`}
          >
            {tab === 'intake' ? <Upload size={11} /> : tab === 'schedule' ? <CalendarDays size={11} /> : <ScanText size={11} />}
            {tab === 'intake' ? 'Intake' : tab === 'schedule' ? 'Attempt Schedule' : 'Enforcement'}
            {tab === 'enforcement' && reviewPendingCount > 0 && (
              <span className="ml-0.5 min-w-[16px] px-1 py-px text-[9px] font-bold rounded-full bg-amber-600 text-white leading-none">
                {reviewPendingCount > 99 ? '99+' : reviewPendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Schedule calendar view */}
      {activeTab === 'schedule' && (
        <ServeAttemptCalendar />
      )}

      {/* Enforcement tab — Quality Review Queue */}
      {activeTab === 'enforcement' && (
        <div className="space-y-0">
          <QualityReviewPanel />
          {user && ['admin', 'manager'].includes(user.role) && (
            <div className="px-3 pb-3 border-t border-surface-border pt-2">
              <button
                onClick={() => navigate('/tesseract-training')}
                className="flex items-center gap-1.5 px-3 py-1 text-[10px] border border-surface-border hover:bg-surface-raised text-rmpg-400"
              >
                <ScanText size={11} /> Tesseract OCR Learning
              </button>
            </div>
          )}
        </div>
      )}

      {/* Intake upload flow — hidden when on schedule tab */}
      {activeTab === 'intake' && <>

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
        className={`border-2 border-dashed rounded-sm p-8 text-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400/40 transition-all ${
          dragActive
            ? 'border-brand-400 bg-brand-400/10 ring-2 ring-brand-400/40'
            : 'border-rmpg-600 hover:border-rmpg-400 hover:bg-surface-raised/50 focus:border-rmpg-400'
        }`}
        style={dragActive ? undefined : { background: 'var(--surface-sunken)' }}
      >
        <Upload className={`w-10 h-10 mx-auto mb-3 ${dragActive ? 'text-brand-400' : 'text-rmpg-500'}`} />
        <p className="text-sm font-bold text-rmpg-300">{dragActive ? 'RELEASE TO ADD DOCUMENTS' : 'DRAG & DROP DOCUMENTS'}</p>
        <p className="text-[10px] text-rmpg-500 mt-1">PDF or Images — a whole job folder works too</p>
        <p className="text-[9px] text-rmpg-600 mt-2">
          <span>click to browse files</span>
          <span className="mx-1 text-rmpg-700">·</span>
          <button
            type="button"
            className="underline hover:text-rmpg-400 transition-colors"
            onClick={e => { e.stopPropagation(); folderInputRef.current?.click(); }}
          >or pick a folder</button>
        </p>
        <input id="ff-serveintakepage-0"
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/*"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is not in HTMLInputElement types but is supported by all modern browsers
          webkitdirectory=""
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {/* Empty state — no files loaded, not processing, no completed result */}
      {!processing && !result && files.length === 0 && (
        <p className="text-center text-[10px] text-rmpg-600 py-2">
          {canManage
            ? 'Drop a job packet above or press N to browse — PDF, images, or a whole folder.'
            : 'Contact a supervisor to process service intakes.'}
        </p>
      )}

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
                <span className="text-rmpg-100 font-medium truncate block">{f.name}</span>
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
                  <option key={dt.value} value={dt.value} className="bg-surface-raised text-rmpg-100 text-[9px]">{dt.label}</option>
                ))}
              </select>
              {f.ocrResult && (
                <span className={`text-[9px] font-bold ${confidenceColor(Number(f.ocrResult.confidence ?? 0))}`}>
                  {(Number(f.ocrResult.confidence ?? 0) * 100).toFixed(0)}%
                </span>
              )}
              {f.ocrScanFailed ? (
                <span title="Server-side field extraction failed or timed out — verify/enter this document's fields manually">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                </span>
              ) : f.status === 'extracted' ? (
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
              {canManage && (
                <IconButton onClick={() => requestRemoveFile(i)} aria-label={`Remove ${f.name}`} className="p-0.5 text-rmpg-500 hover:text-red-400"><X className="w-3 h-3" /></IconButton>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pre-submission review panel — editable fields populated from
          client-side OCR (image files) so the operator can correct/
          supplement extracted values before records are created. */}
      {files.some(f => !f.derivedFrom) && !result && (
        <div className="panel-beveled bg-surface-raised">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
            <Edit3 className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-[10px] uppercase font-bold tracking-wider text-rmpg-300">Review &amp; Edit Before Creating Records</span>
            <span className="text-[9px] text-rmpg-500 ml-1">— Fields pre-filled from OCR. Edit any value before submitting.</span>
          </div>
          <div className="p-3">
            <DefendantsPicker
              detected={detectedDefendants}
              selected={selectedDefendants}
              onChange={setSelectedDefendants}
            />
            {/* Recipient identity */}
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Recipient</p>
              <button
                type="button"
                onClick={() => setShowIdScanner(true)}
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-brand-400 border border-brand-400 px-2 py-1"
                aria-label="Scan recipient ID barcode"
              >
                <ScanLine className="w-3 h-3" /> Scan ID
              </button>
            </div>
            {/* Recipient type indicator + entity-aware layout */}
            {(() => {
              const isBusiness = !!(editOverrides['recipient_business_name'] || editOverrides['registered_agent_name']);
              const recipientType = editOverrides['recipient_type']?.toLowerCase();
              const entityLabel = recipientType === 'business' ? 'Business Entity'
                : recipientType === 'person' ? 'Individual'
                : isBusiness ? 'Business Entity' : null;

              const businessRow = isBusiness ? (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {[
                    { key: 'recipient_business_name', label: 'Business Name' },
                    { key: 'registered_agent_name',   label: 'Registered Agent' },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="text-[9px] text-rmpg-500 uppercase font-mono block mb-0.5">
                        {label}
                        {ocrSourced.has(key) && <span className="ml-1 text-[8px] text-brand-400 font-bold">OCR</span>}
                      </label>
                      <input
                        id={`ff-intake-override-${key}`}
                        type="text"
                        value={editOverrides[key] ?? ''}
                        onChange={e => overrideField(key, e.target.value)}
                        placeholder="—"
                        className={`w-full bg-surface-sunken border rounded-sm px-2 py-1 text-xs text-rmpg-100 placeholder-rmpg-700 focus:outline-none focus:border-brand-500 ${ocrSourced.has(key) ? 'border-brand-700' : 'border-border-subtle'}`}
                      />
                      {judgeVerdicts[key] && <JudgeFlagChip verdict={judgeVerdicts[key]} />}
                    </div>
                  ))}
                </div>
              ) : null;

              const personFieldLabel = (base: string) => isBusiness
                ? (base === 'First Name' ? 'Agent First' : base === 'Last Name' ? 'Agent Last' : base === 'Middle Name' ? 'Agent Middle' : base)
                : base;

              const personRow = (
                <div className="mb-3">
                  {isBusiness && (
                    <p className="text-[9px] text-rmpg-500 mb-1">Contact / Agent Person <span className="text-rmpg-600">(optional for business service)</span></p>
                  )}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {[
                      { key: 'recipient_first_name', label: 'First Name' },
                      { key: 'recipient_last_name',  label: 'Last Name' },
                      { key: 'recipient_middle_name',label: 'Middle Name' },
                      { key: 'recipient_dob',        label: 'Date of Birth' },
                      { key: 'recipient_phone',      label: 'Phone' },
                    ].map(({ key, label }) => (
                      <div key={key}>
                        <label className="text-[9px] text-rmpg-500 uppercase font-mono block mb-0.5">
                          {personFieldLabel(label)}
                          {ocrSourced.has(key) && <span className="ml-1 text-[8px] text-brand-400 font-bold">OCR</span>}
                        </label>
                        <input
                          id={`ff-intake-override-${key}`}
                          type="text"
                          value={editOverrides[key] ?? ''}
                          onChange={e => overrideField(key, e.target.value)}
                          placeholder="—"
                          className={`w-full bg-surface-sunken border rounded-sm px-2 py-1 text-xs text-rmpg-100 placeholder-rmpg-700 focus:outline-none focus:border-brand-500 ${ocrSourced.has(key) ? 'border-brand-700' : 'border-border-subtle'}`}
                        />
                        {judgeVerdicts[key] && <JudgeFlagChip verdict={judgeVerdicts[key]} />}
                      </div>
                    ))}
                  </div>
                </div>
              );

              return (
                <>
                  {entityLabel && (
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-[9px] px-1.5 py-0.5 border border-brand-600 text-brand-300 uppercase tracking-wider font-semibold">
                        {entityLabel}
                        {ocrSourced.has('recipient_type') && <span className="ml-1 text-brand-400">OCR</span>}
                      </span>
                    </div>
                  )}
                  {/* Business row first — entity name is the primary identifier */}
                  {isBusiness ? <>{businessRow}{personRow}</> : <>{personRow}{businessRow}</>}
                </>
              );
            })()}
            {/* Address */}
            <p className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1.5">Address</p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
              <div className="md:col-span-2">
                <label className="text-[9px] text-rmpg-500 uppercase font-mono block mb-0.5">
                  Street
                  {ocrSourced.has('recipient_address') && <span className="ml-1 text-[8px] text-brand-400 font-bold">OCR</span>}
                </label>
                <input
                  id="ff-intake-override-recipient_address"
                  type="text"
                  value={editOverrides['recipient_address'] ?? ''}
                  onChange={e => overrideField('recipient_address', e.target.value)}
                  placeholder="—"
                  className={`w-full bg-surface-sunken border rounded-sm px-2 py-1 text-xs text-rmpg-100 placeholder-rmpg-700 focus:outline-none focus:border-brand-500 ${ocrSourced.has('recipient_address') ? 'border-brand-700' : 'border-border-subtle'}`}
                />
                {judgeVerdicts['recipient_address'] && <JudgeFlagChip verdict={judgeVerdicts['recipient_address']} />}
              </div>
              {[
                { key: 'recipient_city',  label: 'City' },
                { key: 'recipient_state', label: 'State' },
                { key: 'recipient_zip',   label: 'Zip' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="text-[9px] text-rmpg-500 uppercase font-mono block mb-0.5">
                    {label}
                    {ocrSourced.has(key) && <span className="ml-1 text-[8px] text-brand-400 font-bold">OCR</span>}
                  </label>
                  <input
                    id={`ff-intake-override-${key}`}
                    type="text"
                    value={editOverrides[key] ?? ''}
                    onChange={e => overrideField(key, e.target.value)}
                    placeholder="—"
                    className={`w-full bg-surface-sunken border rounded-sm px-2 py-1 text-xs text-rmpg-100 placeholder-rmpg-700 focus:outline-none focus:border-brand-500 ${ocrSourced.has(key) ? 'border-brand-700' : 'border-border-subtle'}`}
                  />
                  {judgeVerdicts[key] && <JudgeFlagChip verdict={judgeVerdicts[key]} />}
                </div>
              ))}
            </div>
            {/* Client selector — links the serve to an active RMPG client */}
            <p className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1.5">Client</p>
            <div className="mb-3">
              <select
                id="ff-intake-client"
                value={selectedClientId ?? ''}
                onChange={e => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setSelectedClientId(id);
                  const name = clients.find(c => c.id === id)?.name ?? '';
                  setEditOverrides(prev => ({ ...prev, client_name: name }));
                }}
                className="w-full bg-surface-sunken border border-border-subtle rounded-sm px-2 py-1 text-xs text-rmpg-100 focus:outline-none focus:border-brand-500"
              >
                <option value="">
                  — {clientsLoading
                    ? 'Loading clients…'
                    : clientLoadError
                      ? 'Client list unavailable'
                      : 'Select client (optional)'} —
                </option>
                {clients.map(cl => (
                  <option key={cl.id} value={cl.id}>{cl.name}{cl.contact_name ? ` · ${cl.contact_name}` : ''}</option>
                ))}
              </select>
              {/* An empty dropdown is ambiguous on its own — "no clients exist"
                  and "the request failed" look identical. Say which, and say
                  that submit is held, so the operator isn't left guessing why
                  the button is disabled. */}
              {clientLoadError && (
                <p role="alert" className="mt-1 text-[10px] text-red-400 leading-tight">
                  {clientLoadError} — intake is held until the client list loads,
                  so a job cannot be filed without its client.
                </p>
              )}
            </div>
            {/* Case details */}
            <p className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1.5">Case</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
              {[
                { key: 'plaintiff',         label: 'Plaintiff' },
                { key: 'defendant',         label: 'Defendant' },
                { key: 'court_name',        label: 'Court' },
                { key: 'case_number',       label: 'Case #' },
                { key: 'job_number',        label: 'Job #' },
                { key: 'service_deadline',  label: 'Due Date' },
                { key: 'hearing_date',      label: 'Hearing Date' },
                { key: 'jurisdiction',      label: 'Jurisdiction' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="text-[9px] text-rmpg-500 uppercase font-mono block mb-0.5">
                    {label}
                    {ocrSourced.has(key) && <span className="ml-1 text-[8px] text-brand-400 font-bold">OCR</span>}
                  </label>
                  <input
                    id={`ff-intake-override-${key}`}
                    type="text"
                    value={editOverrides[key] ?? ''}
                    onChange={e => overrideField(key, e.target.value)}
                    placeholder="—"
                    className={`w-full bg-surface-sunken border rounded-sm px-2 py-1 text-xs text-rmpg-100 placeholder-rmpg-700 focus:outline-none focus:border-brand-500 ${ocrSourced.has(key) ? 'border-brand-700' : 'border-border-subtle'}`}
                  />
                  {judgeVerdicts[key] && <JudgeFlagChip verdict={judgeVerdicts[key]} />}
                </div>
              ))}
            </div>
            {/* Service */}
            <p className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1.5">Service</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              {[
                { key: 'attorney_name',       label: 'Attorney' },
                { key: 'attorney_phone',      label: 'Attorney Phone' },
                { key: 'attorney_email',      label: 'Attorney Email' },
                { key: 'attorney_bar_number', label: 'Bar #' },
                { key: 'fee_amount',          label: 'Fee' },
                { key: 'service_windows',     label: 'Service Windows' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="text-[9px] text-rmpg-500 uppercase font-mono block mb-0.5">
                    {label}
                    {ocrSourced.has(key) && <span className="ml-1 text-[8px] text-brand-400 font-bold">OCR</span>}
                  </label>
                  <input
                    id={`ff-intake-override-${key}`}
                    type="text"
                    value={editOverrides[key] ?? ''}
                    onChange={e => overrideField(key, e.target.value)}
                    placeholder="—"
                    className={`w-full bg-surface-sunken border rounded-sm px-2 py-1 text-xs text-rmpg-100 placeholder-rmpg-700 focus:outline-none focus:border-brand-500 ${ocrSourced.has(key) ? 'border-brand-700' : 'border-border-subtle'}`}
                  />
                  {judgeVerdicts[key] && <JudgeFlagChip verdict={judgeVerdicts[key]} />}
                </div>
              ))}
            </div>
            {/* Process type + Priority row */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-[9px] text-rmpg-500 uppercase font-mono block mb-0.5">
                  Process Type
                  {ocrSourced.has('process_type') && <span className="ml-1 text-[8px] text-brand-400 font-bold">OCR</span>}
                </label>
                <select
                  id="ff-intake-override-process_type"
                  value={editOverrides['process_type'] ?? ''}
                  onChange={e => overrideField('process_type', e.target.value)}
                  className="w-full bg-surface-sunken border border-border-subtle rounded-sm px-2 py-1 text-xs text-rmpg-100 focus:outline-none focus:border-brand-500"
                >
                  <option value="">— Select —</option>
                  <option value="personal">Personal Service</option>
                  <option value="substitute">Substitute Service</option>
                  <option value="posted">Posted Service</option>
                  <option value="mail">Mail Service</option>
                  <option value="eviction">Eviction / UD</option>
                  <option value="subpoena">Subpoena</option>
                  <option value="restraining_order">Restraining Order</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-[9px] text-rmpg-500 uppercase font-mono block mb-0.5">Priority</label>
                <select
                  id="ff-intake-override-priority"
                  value={editOverrides['priority'] ?? 'normal'}
                  onChange={e => overrideField('priority', e.target.value)}
                  className="w-full bg-surface-sunken border border-border-subtle rounded-sm px-2 py-1 text-xs text-rmpg-100 focus:outline-none focus:border-brand-500"
                >
                  <option value="routine">Routine</option>
                  <option value="normal">Normal</option>
                  <option value="rush">Rush</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            {/* Service instructions */}
            <div className="mb-3">
              <label className="text-[9px] text-rmpg-500 uppercase font-mono block mb-0.5">
                Service Instructions
                {ocrSourced.has('service_instructions') && <span className="ml-1 text-[8px] text-brand-400 font-bold">OCR</span>}
              </label>
              <textarea
                id="ff-intake-override-service_instructions"
                value={editOverrides['service_instructions'] ?? ''}
                onChange={e => overrideField('service_instructions', e.target.value)}
                placeholder="Special access notes, gating, time restrictions…"
                rows={2}
                className={`w-full bg-surface-sunken border rounded-sm px-2 py-1 text-xs text-rmpg-100 placeholder-rmpg-700 focus:outline-none focus:border-brand-500 resize-none ${ocrSourced.has('service_instructions') ? 'border-brand-700' : 'border-border-subtle'}`}
              />
              {judgeVerdicts['service_instructions'] && <JudgeFlagChip verdict={judgeVerdicts['service_instructions']} />}
            </div>

            {/* Scheduling constraints — only shown when the server extracted them or
                the operator wants to set them manually before creating the entry. */}
            <div className="space-y-2">
              <p className="text-[9px] text-rmpg-500 uppercase font-bold">Scheduling Constraints</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[9px] text-[color:var(--field-label-color)] uppercase font-semibold block mb-0.5">
                    Address Class
                    {ocrSourced.has('address_class') && <span className="ml-1 text-[8px] text-brand-400 font-bold">OCR</span>}
                  </label>
                  <select
                    value={editOverrides['address_class'] ?? ''}
                    onChange={e => overrideField('address_class', e.target.value)}
                    className={`w-full bg-surface-sunken border rounded-sm px-2 py-1 text-xs text-rmpg-100 focus:outline-none focus:border-brand-500 ${ocrSourced.has('address_class') ? 'border-brand-700' : 'border-border-subtle'}`}
                  >
                    <option value="">— unknown —</option>
                    <option value="residential">Residential</option>
                    <option value="corporate">Corporate / Large Business</option>
                    <option value="small_business">Small Business</option>
                    <option value="government">Government Office</option>
                    <option value="business">Business (generic)</option>
                    <option value="gated">Gated / HOA</option>
                    <option value="po_box">PO Box</option>
                  </select>
                  {judgeVerdicts['address_class'] && <JudgeFlagChip verdict={judgeVerdicts['address_class']} />}
                  <p className="text-[8px] text-rmpg-500 mt-0.5">Venue overlay can be forced below; otherwise inferred into the OPS tree.</p>
                </div>
                <div>
                  <label className="text-[9px] text-[color:var(--field-label-color)] uppercase font-semibold block mb-0.5">Venue overlay</label>
                  <select
                    value={editOverrides['venue_kind'] ?? ''}
                    onChange={e => overrideField('venue_kind', e.target.value)}
                    className="w-full bg-surface-sunken border border-border-subtle rounded-sm px-2 py-1 text-xs text-rmpg-100 focus:outline-none focus:border-brand-500"
                  >
                    <option value="">Auto infer</option>
                    <option value="none">None</option>
                    <option value="medical_hospice">Medical / Hospice</option>
                    <option value="hospital">Hospital</option>
                    <option value="nursing_home">Nursing / Assisted Living</option>
                    <option value="financial">Bank / Financial</option>
                    <option value="law_office">Law Office</option>
                    <option value="school">School / Campus</option>
                    <option value="hotel">Hotel / Lodging</option>
                    <option value="warehouse">Warehouse / Industrial</option>
                    <option value="church">House of Worship</option>
                    <option value="storage">Self-Storage</option>
                    <option value="apartment_complex">Apartment Complex</option>
                    <option value="high_rise">High-Rise / Office</option>
                    <option value="military">Military / Restricted</option>
                    <option value="construction">Construction Site</option>
                    <option value="rural">Rural / Farm</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] text-[color:var(--field-label-color)] uppercase font-semibold block mb-0.5">
                    Not Before
                    {ocrSourced.has('attempt_start_not_before') && <span className="ml-1 text-[8px] text-brand-400 font-bold">OCR</span>}
                  </label>
                  <input
                    type="date"
                    value={editOverrides['attempt_start_not_before'] ?? ''}
                    onChange={e => overrideField('attempt_start_not_before', e.target.value)}
                    className={`w-full bg-surface-sunken border rounded-sm px-2 py-1 text-xs text-rmpg-100 focus:outline-none focus:border-brand-500 ${ocrSourced.has('attempt_start_not_before') ? 'border-brand-700' : 'border-border-subtle'}`}
                  />
                  {judgeVerdicts['attempt_start_not_before'] && <JudgeFlagChip verdict={judgeVerdicts['attempt_start_not_before']} />}
                </div>
                <div>
                  <label className="text-[9px] text-[color:var(--field-label-color)] uppercase font-semibold block mb-0.5">
                    Allowed Days
                    {ocrSourced.has('service_days_allowed') && <span className="ml-1 text-[8px] text-brand-400 font-bold">OCR</span>}
                  </label>
                  <input
                    type="text"
                    value={editOverrides['service_days_allowed'] ?? ''}
                    onChange={e => overrideField('service_days_allowed', e.target.value)}
                    placeholder="e.g. Mon-Fri"
                    className={`w-full bg-surface-sunken border rounded-sm px-2 py-1 text-xs text-rmpg-100 placeholder-rmpg-700 focus:outline-none focus:border-brand-500 ${ocrSourced.has('service_days_allowed') ? 'border-brand-700' : 'border-border-subtle'}`}
                  />
                  {judgeVerdicts['service_days_allowed'] && <JudgeFlagChip verdict={judgeVerdicts['service_days_allowed']} />}
                </div>
              </div>
            </div>

            <ServeRecordMatchPanel
              address={editOverrides['recipient_address'] || ''}
              businessName={editOverrides['recipient_business_name'] || ''}
            />
          </div>
        </div>
      )}

      {/* OCR Preview Modal */}
      {showOcrPreview && ocrPreview && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowOcrPreview(false)}>
          <div className="bg-surface-base border border-border-default rounded-sm max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-brand-400" />
                <span className="text-xs font-bold text-rmpg-100 uppercase">OCR Extraction Review</span>
                <span className={`text-[10px] font-bold ${confidenceColor(Number(ocrPreview.confidence ?? 0))}`}>
                  Confidence: {(Number(ocrPreview.confidence ?? 0) * 100).toFixed(0)}%
                </span>
              </div>
              <IconButton onClick={() => setShowOcrPreview(false)} aria-label="Close OCR preview">
                <X className="w-4 h-4" />
              </IconButton>
            </div>
            <div className="p-4 space-y-2">
              <div className="text-[10px] text-rmpg-400 mb-2">
                Document Type: <span className="text-rmpg-100 font-bold">{ocrPreview.documentType}</span>
                {' | '} Extracted Fields: <span className="text-rmpg-100 font-bold">{previewFields.length}</span>
              </div>
              <div className="w-full h-1.5 bg-surface-raised rounded-sm overflow-hidden">
                <div className={`h-full rounded-sm transition-all ${confidenceBar(Number(ocrPreview.confidence ?? 0))}`}
                  style={{ width: `${Math.min(100, Number(ocrPreview.confidence ?? 0) * 100)}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                {previewFields.map(([key, field]) => (
                  <div key={key} className="flex items-start gap-2 p-2 bg-surface-sunken rounded-sm">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-rmpg-500 uppercase font-mono">{toDisplayLabel(key)}</span>
                        <span className={`text-[8px] font-bold ${confidenceColor(Number(field.confidence ?? 0))}`}>
                          {(Number(field.confidence ?? 0) * 100).toFixed(0)}%
                        </span>
                      </div>
                      {editingFields[key] ? (
                        <input id="ff-serveintakepage-2"
                          type="text"
                          value={editOverrides[key] ?? field.value}
                          onChange={e => setEditOverrides(prev => ({ ...prev, [key]: e.target.value }))}
                          onBlur={() => setEditingFields(prev => ({ ...prev, [key]: false }))}
                          className="w-full bg-surface-overlay border border-border-subtle rounded-sm px-2 py-0.5 text-xs text-rmpg-100 mt-0.5"
                          autoFocus
                        />
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-rmpg-100 truncate">{editOverrides[key] ?? field.value}</span>
                          <IconButton
                            onClick={() => setEditingFields(prev => ({ ...prev, [key]: true }))}
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
                <><Loader2 className="w-3 h-3 animate-spin text-brand-400" /> Analyzing Documents</>
              ) : (
                <><Upload className="w-3 h-3 text-brand-400" /> Uploading Documents</>
              )}
            </span>
            <span className="flex items-center gap-2">
              {uploadPhase === 'uploading' && uploadStat && (
                <span className="text-[10px] font-bold font-mono text-brand-400">{uploadStat.pct.toFixed(0)}%</span>
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
          <div className="w-full h-1.5 bg-surface-raised rounded-sm overflow-hidden">
            <div
              className={`h-full bg-brand-400 ${uploadPhase === 'analyzing' ? 'animate-pulse' : 'transition-all'}`}
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
        <>
          {editOverrides['service_deadline'] && isNaN(Date.parse(editOverrides['service_deadline'])) && (
            <div className="bg-amber-900/20 border border-amber-700/40 rounded-sm p-2 text-[10px] text-amber-400">
              <AlertTriangle className="w-3 h-3 inline mr-1" />
              Service deadline "{editOverrides['service_deadline']}" doesn't look like a valid date — update it before submitting.
            </div>
          )}
          <button
            onClick={processIntake}
            disabled={processing || files.every(f => f.status === 'error') || blockProcessing || !canManage}
            className="w-full toolbar-btn toolbar-btn-primary py-3 text-sm font-bold justify-center"
          >
            {processing ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> {uploadPhase === 'analyzing' ? 'Analyzing Documents…' : 'Uploading Documents…'}</>
            ) : (
              <><Upload className="w-4 h-4" /> Create Person + Serve Queue Entry</>
            )}
          </button>
          {!canManage && (
            <p className="text-[10px] text-rmpg-500 text-center">Contact a supervisor to process intakes.</p>
          )}
        </>
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

            {result.duplicate_of && (
              <div className="bg-amber-900/30 border border-amber-700/50 rounded-sm p-2 mb-3 text-[11px] text-amber-300 flex items-start justify-between gap-2">
                <span>
                  <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                  Duplicate intake: active serve entry #{result.duplicate_of.serve_queue_id}
                  {result.duplicate_of.case_number ? ` (case ${result.duplicate_of.case_number})` : ''} already covers this
                  recipient — status {result.duplicate_of.status}. Documents were attached to the existing entry; no new call was created.
                </span>
                <button
                  type="button"
                  onClick={() => navigate(`/serve?job_id=${result.duplicate_of!.serve_queue_id}`)}
                  className="text-[10px] text-brand-400 whitespace-nowrap hover:underline shrink-0"
                >
                  View Entry →
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="panel-beveled bg-surface-raised p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <User className="w-3.5 h-3.5 text-rmpg-400" />
                  <span className="text-[10px] text-rmpg-400 uppercase font-bold">Person Created</span>
                </div>
                <p className="text-sm font-bold text-rmpg-100">
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
                <p className="text-xs text-rmpg-100">{result.extracted?.address || 'No address extracted'}</p>
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
                <p className="text-sm font-bold text-rmpg-100 font-mono">{result.call_number}</p>
                <p className="text-[10px] text-rmpg-400">{result.extracted?.processType ? result.extracted.processType.charAt(0).toUpperCase() + toDisplayLabel(result.extracted.processType.slice(1)) : 'PSO Client Request'} — Pending</p>
                <div className="flex flex-wrap gap-x-2 mt-1">
                  {result.serve_queue_id != null && (
                    <button
                      type="button"
                      onClick={() => navigate(`/serve?job_id=${result.serve_queue_id}`)}
                      className="text-[9px] text-brand-400 hover:underline"
                    >
                      Open in Process Server →
                    </button>
                  )}
                  <button type="button" onClick={() => navigate('/dispatch')} className="text-[9px] text-brand-400 hover:underline">
                    View in Dispatch →
                  </button>
                </div>
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

            {/* OCR & extraction context — per-document provenance + the
                critical fields OCR couldn't find. Mirrors the 'OCR' note
                filed on the call's Notes tab so the uploader sees what to
                verify without opening dispatch. */}
            {(result.documents?.length || result.missing_critical?.length) ? (
              <div className="mt-3 pt-3 border-t border-rmpg-700">
                <p className="text-[9px] text-rmpg-400 uppercase font-bold mb-1.5">Extraction Context</p>
                {result.documents?.map((d) => (
                  <div key={d.file_name} className="flex items-center gap-2 text-[10px] py-[2px]">
                    <span className="text-rmpg-300 truncate max-w-[260px]">{d.file_name}</span>
                    {d.success !== false ? (
                      <>
                        <span className="text-rmpg-500">{toDisplayLabel(d.doc_type || 'unclassified')}</span>
                        <span className="text-rmpg-500">{(d.ocr_engine && OCR_ENGINE_LABELS[d.ocr_engine]) || d.ocr_engine || ''}</span>
                        <span className={`font-bold ${confidenceColor(d.confidence ?? 0)}`}>{Math.round((d.confidence ?? 0) * 100)}%</span>
                      </>
                    ) : (
                      <span className="text-red-400 font-bold">extraction failed — review manually</span>
                    )}
                  </div>
                ))}
                {result.missing_critical && result.missing_critical.length > 0 && (
                  <div className="mt-2 border border-amber-700/50 rounded-sm p-2 bg-amber-900/20">
                    <p className="text-[9px] text-amber-400 uppercase font-bold mb-1.5 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Not found in documents — fill in before dispatch
                    </p>
                    <div className="space-y-1.5">
                      {result.missing_critical.map((label) => {
                        const putKey = MISSING_FIELD_TO_PUT_KEY[label];
                        if (!putKey) {
                          // No PUT-body mapping (e.g. DOB, phone) — show read-only note
                          return (
                            <p key={label} className="text-[10px] text-amber-300/70 italic">
                              {label} — verify manually before service
                            </p>
                          );
                        }
                        return (
                          <div key={label} className="flex items-center gap-2">
                            <label className="text-[9px] text-amber-400 uppercase font-semibold w-24 shrink-0">
                              {label}
                            </label>
                            <input
                              type="text"
                              value={missingFieldValues[label] ?? ''}
                              onChange={(e) => setMissingFieldValues(prev => ({ ...prev, [label]: e.target.value }))}
                              placeholder={`Enter ${label}`}
                              disabled={missingFieldSaved}
                              className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-[2px] text-[10px] text-rmpg-100 px-2 py-[3px] placeholder-rmpg-500 focus:outline-none focus:border-brand-500 disabled:opacity-50"
                            />
                          </div>
                        );
                      })}
                    </div>
                    {result.serve_queue_id != null && (
                      <div className="mt-2 flex items-center gap-2">
                        {missingFieldSaved ? (
                          <span className="text-[10px] text-green-400 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Saved to queue entry
                          </span>
                        ) : (
                          <button
                            onClick={() => handleMissingFieldSave(result.serve_queue_id!)}
                            disabled={missingFieldSaving || Object.values(missingFieldValues).every(v => !v.trim())}
                            className="toolbar-btn py-1 text-[10px] border-amber-700/60 text-amber-300 hover:bg-amber-900/30 disabled:opacity-40"
                          >
                            {missingFieldSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                            Save Missing Fields
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}

            {/* Diligence planner — dated attempt windows. Mirrors the
                RECOMMENDED ATTEMPT PLAN section of the intake briefing. */}
            {result.attempt_plan && result.attempt_plan.length > 0 && (
              <div className="mt-3 pt-3 border-t border-rmpg-700">
                <p className="text-[9px] text-rmpg-400 uppercase font-bold mb-1.5">Recommended Attempt Plan</p>
                {result.attempt_plan.map((w) => (
                  <div key={w.attempt} className="flex items-center gap-2 text-[10px] py-[2px]">
                    <span className="text-rmpg-500 font-bold">#{w.attempt}</span>
                    <span className="text-rmpg-100 font-mono">{w.weekday} {w.date}</span>
                    <span className="text-brand-400 font-mono">{w.window}</span>
                    <span className="text-rmpg-500">{w.focus}</span>
                  </div>
                ))}
              </div>
            )}
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
              onClick={() => setConfirmReset(true)}
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
      <ConfirmDialog
        isOpen={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => { setConfirmReset(false); setFiles([]); setResult(null); setEditOverrides({}); setOcrSourced(new Set()); setJudgeVerdicts({}); setDetectedDefendants([]); setSelectedDefendants([]); setSelectedClientId(null); setMissingFieldValues({}); setMissingFieldSaved(false); }}
        title="Start New Intake?"
        message="This will clear all loaded documents and results."
        confirmLabel="Clear & Start New"
        confirmVariant="warning"
      />
      </>}
      {showIdScanner && (
        <LiveDlScanner
          onComplete={handleIdScanComplete}
          onClose={() => setShowIdScanner(false)}
          onUploadInstead={() => {
            setShowIdScanner(false);
            addToast('Photo-upload scanning isn\'t available on this screen — try again or use another entry method', 'error');
          }}
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
      <pre className="mt-1 p-2 bg-surface-overlay border border-border-default rounded-sm text-[9px] text-rmpg-400 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
        {preview}
        {text.length > 1000 && <span className="text-red-400">\n...truncated ({text.length - 1000} more chars)</span>}
      </pre>
    </details>
  );
}
