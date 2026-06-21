// ============================================================
// DocumentIntakePage — drop a PDF, review extracted fields, save
// ============================================================
// Surface for /api/document-intake. Handles three states:
//   idle      → drop zone + file picker
//   processing → spinner while server runs pdftotext + OCR fallback
//   review    → DocumentIntakeReviewer with confidence-colored fields
//
// Auth: same JWT as the rest of the app (Layout's <ProtectedRoute>).
// Role-gated to admin/manager/supervisor/officer/dispatcher in nav.

import { useCallback, useState } from 'react';
import { Upload, Loader2, FileText } from 'lucide-react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import PanelTitleBar from '../components/PanelTitleBar';
import DocumentIntakeReviewer, { type DocumentExtraction } from '../components/DocumentIntakeReviewer';
import { useToast } from '../components/ToastProvider';
import { apiFetch } from '../hooks/useApi';

GlobalWorkerOptions.workerSrc = workerUrl;

type State =
  | { kind: 'idle' }
  | { kind: 'processing'; filename: string }
  | { kind: 'review'; extraction: DocumentExtraction; filename: string };

export default function DocumentIntakePage() {
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [dragActive, setDragActive] = useState(false);

  const uploadFile = useCallback(async (file: File) => {
    if (file.type !== 'application/pdf') {
      toast.addToast('Only PDF files are supported', 'error');
      return;
    }
    setState({ kind: 'processing', filename: file.name });
    try {
      // Extract the PDF text layer in-browser via pdfjs. The server's
      // PDF_TOOLS container is off in prod (project-pdf-tools-container-off),
      // so the worker classifies + anchor-extracts from the text we send it —
      // the same born-digital path serve-intake uses. Scanned PDFs with no
      // text layer aren't supported here (use Serve Intake for those).
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await getDocument({ data: arrayBuffer, verbosity: 0 }).promise;
      const pageCount = pdf.numPages;
      const pageTexts: string[] = [];
      for (let i = 1; i <= pageCount; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pageTexts.push(content.items.map((it: any) => it.str).join(' '));
      }
      const text = pageTexts.join('\n');
      if (!text.trim()) {
        throw new Error('No text layer found — this looks like a scanned PDF. OCR is not enabled for document intake.');
      }
      const extraction = await apiFetch<DocumentExtraction>('/document-intake/extract', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, text, page_count: pageCount, used_ocr: false }),
      });
      setState({ kind: 'review', extraction, filename: file.name });
    } catch (err: any) {
      toast.addToast(err?.message || 'Document extraction failed', 'error');
      setState({ kind: 'idle' });
    }
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }, [uploadFile]);

  const handlePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = '';
  }, [uploadFile]);

  return (
    <div className="p-4 space-y-3 min-h-full">
      <PanelTitleBar title="DOCUMENT INTAKE" icon={FileText} />

      {state.kind === 'idle' && (
        <div
          onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="bg-surface-sunken border-2 border-dashed p-12 text-center transition-colors"
          style={{
            borderColor: dragActive ? '#d4a017' : 'var(--border-default)',
            borderRadius: 2,
            background: dragActive ? 'rgba(212,160,23,0.05)' : '#0a0a0a',
          }}
        >
          <Upload className="w-10 h-10 mx-auto mb-3" style={{ color: dragActive ? '#d4a017' : '#666' }} />
          <div className="text-[14px] font-semibold mb-1">
            Drop a PDF here, or
            <label htmlFor="ff-documentintakepage-0" className="ml-2 px-3 py-1 text-[11px] border border-[#d4a017] text-[#d4a017] hover:bg-[#d4a017] hover:text-black cursor-pointer inline-block uppercase" style={{ borderRadius: 2 }}>
              <input id="ff-documentintakepage-0" type="file" accept="application/pdf" className="hidden" onChange={handlePick} />
              Choose File
            </label>
          </div>
          <div className="text-[11px] text-[#888] mt-2">
            Supports court records, ICU investigation docs, info forms, field sheets.
            Auto-detects document type and extracts structured fields.
          </div>
          <div className="text-[10px] text-rmpg-500 mt-3 font-mono">
            Implemented kinds: court_warrant · fi_card · witness_statement · info_form
            <br />
            Stub kinds (low coverage): court_order · trespass_order · evidence_log · investigation_report
          </div>
        </div>
      )}

      {state.kind === 'processing' && (
        <div className="bg-surface-sunken border border-border-default p-12 text-center" style={{ borderRadius: 2 }}>
          <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin" style={{ color: '#d4a017' }} />
          <div className="text-[13px] text-rmpg-300">
            Extracting fields from <span className="font-mono text-[#d4a017]">{state.filename}</span>…
          </div>
          <div className="text-[10px] text-rmpg-500 mt-2">
            Reading the PDF text layer in-browser, then classifying the document
            and pulling structured fields. Born-digital PDFs only (no OCR).
          </div>
        </div>
      )}

      {state.kind === 'review' && (
        <>
          <div className="text-[10px] text-[#888] font-mono">
            Source: {state.filename}
          </div>
          <DocumentIntakeReviewer
            extraction={state.extraction}
            onReset={() => setState({ kind: 'idle' })}
          />
        </>
      )}
    </div>
  );
}
