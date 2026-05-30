import { useState, useCallback, useRef } from 'react';
import { Upload, FileText, CheckCircle, AlertTriangle, Loader2, MapPin, User, Building2, Phone, X, Camera, Edit3, Eye } from 'lucide-react';
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
  derivedFrom?: string;
}

// A PDF whose pdfjs text layer yields fewer than this many characters is
// treated as a scan (image-only) and rasterized to images for Vision OCR.
// Matches the server's MIN_CLIENT_TEXT_CHARS so the two ends agree on what
// "born-digital" means.
const SCANNED_PDF_TEXT_THRESHOLD = 200;
// Pages to rasterize from a scanned PDF. Recipient/service data on civil
// papers lives in the first few pages (cover sheet, summons face, field
// sheet); rendering every page of a 40-page docket would blow the 12-file
// upload cap and the Vision latency budget for no extraction gain.
const MAX_RASTER_PAGES = 4;
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
  { value: 'summons', label: 'Summons', color: 'bg-blue-900/40 text-blue-400 border-blue-700/40' },
  { value: 'complaint', label: 'Complaint', color: 'bg-orange-900/40 text-orange-400 border-orange-700/40' },
  { value: 'subpoena', label: 'Subpoena', color: 'bg-pink-900/40 text-pink-400 border-pink-700/40' },
  { value: 'eviction', label: 'Eviction/UD', color: 'bg-yellow-900/40 text-yellow-400 border-yellow-700/40' },
  { value: 'restraining_order', label: 'Restraining Order', color: 'bg-rose-900/40 text-rose-400 border-rose-700/40' },
  { value: 'identification', label: 'ID/Passport', color: 'bg-cyan-900/40 text-cyan-400 border-cyan-700/40' },
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

export default function ServeIntakePage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocrPreview, setOcrPreview] = useState<OcrScanResult | null>(null);
  const [editingFields, setEditingFields] = useState<Record<string, string>>({});
  const [showOcrPreview, setShowOcrPreview] = useState(false);
  const [showAttemptModal, setShowAttemptModal] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const extractPdfText = useCallback(async (file: File): Promise<string> => {
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
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map(item => (item as any).str).join(' '));
      }
      return pages.join('\n');
    } catch {
      return '';
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
    } catch { }
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

      if (isPdf) {
        text = await extractPdfText(file);
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
        status: text.length > 50 || ocrResult?.success ? 'extracted' : 'error',
        ocrResult,
        file,
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
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const removeFile = (idx: number) => setFiles(prev => prev.filter((_, i) => i !== idx));
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
        const resp = await fetch('/api/serve-intake/upload', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData,
        });
        if (!resp.ok) {
          throw new Error(`Server returned ${resp.status}: ${await resp.text().catch(() => '')}`);
        }
        const body = await resp.json() as IntakeResult & { warning?: string };
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
        // already-extracted browser text.
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
      setError(err?.message || 'Failed to process documents');
    }
    setProcessing(false);
  }, [files]);

  const previewFields = ocrPreview?.fields
    ? Object.entries(ocrPreview.fields).filter(([, f]) => f.value && f.confidence > 0).sort((a, b) => b[1].confidence - a[1].confidence)
    : [];

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <PanelTitleBar title="Process Service Intake" icon={Upload} />

      <div
        ref={dropRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
        role="button"
        tabIndex={0}
        aria-label="Upload documents: drag and drop or press Enter to browse"
        className="border-2 border-dashed border-rmpg-600 rounded-sm p-8 text-center cursor-pointer hover:border-rmpg-400 hover:bg-surface-raised/50 focus:outline-none focus:border-rmpg-400 focus:ring-2 focus:ring-[#d4a017]/40 transition-all"
        style={{ background: 'var(--surface-sunken)' }}
      >
        <Upload className="w-10 h-10 text-rmpg-500 mx-auto mb-3" />
        <p className="text-sm font-bold text-rmpg-300">DRAG & DROP DOCUMENTS</p>
        <p className="text-[10px] text-rmpg-500 mt-1">PDF or Images (Court Filing, Field Sheet, ID, Passport)</p>
        <p className="text-[9px] text-rmpg-600 mt-2">or click to browse files</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/*"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">
            {files.length} Document{files.length > 1 ? 's' : ''} Loaded
            <span className="text-rmpg-600 font-normal ml-2">(OCR confidence shown per document)</span>
          </p>
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 panel-beveled bg-surface-raised text-xs">
              {f.derivedFrom ? (
                <Camera className="w-4 h-4 text-cyan-400 flex-shrink-0" />
              ) : (
                <FileText className="w-4 h-4 text-rmpg-400 flex-shrink-0" />
              )}
              <span className="text-white font-medium truncate flex-1">{f.name}</span>
              {f.derivedFrom && (
                <span
                  className="text-[8px] font-bold uppercase px-1 py-0.5 rounded-sm border bg-cyan-900/40 text-cyan-300 border-cyan-700/40 whitespace-nowrap"
                  title={`Rasterized page from scanned PDF "${f.derivedFrom}" — read by Vision OCR on submit`}
                >
                  Scan OCR
                </span>
              )}
              <select
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
                        <input
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

      {/* Process Button */}
      {files.length > 0 && !result && (
        <button
          onClick={processIntake}
          disabled={processing || files.every(f => f.status === 'error')}
          className="w-full toolbar-btn toolbar-btn-primary py-3 text-sm font-bold justify-center"
        >
          {processing ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Processing Documents...</>
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
