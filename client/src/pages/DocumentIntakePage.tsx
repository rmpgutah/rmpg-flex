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
import PanelTitleBar from '../components/PanelTitleBar';
import DocumentIntakeReviewer, { type DocumentExtraction } from '../components/DocumentIntakeReviewer';
import { useToast } from '../components/ToastProvider';

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
    const form = new FormData();
    form.append('pdf', file);
    try {
      // Manual fetch — apiFetch JSON-stringifies bodies, but multipart
      // needs the browser to set the boundary. We attach the bearer
      // token from localStorage directly (same key apiFetch uses).
      const token = localStorage.getItem('rmpg_token');
      const res = await fetch('/api/document-intake/extract', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const extraction = (await res.json()) as DocumentExtraction;
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
          className="bg-[#0a0a0a] border-2 border-dashed p-12 text-center transition-colors"
          style={{
            borderColor: dragActive ? '#d4a017' : '#2a2a2a',
            borderRadius: 2,
            background: dragActive ? 'rgba(212,160,23,0.05)' : '#0a0a0a',
          }}
        >
          <Upload className="w-10 h-10 mx-auto mb-3" style={{ color: dragActive ? '#d4a017' : '#666' }} />
          <div className="text-[14px] font-semibold mb-1">
            Drop a PDF here, or
            <label className="ml-2 px-3 py-1 text-[11px] border border-[#d4a017] text-[#d4a017] hover:bg-[#d4a017] hover:text-black cursor-pointer inline-block uppercase" style={{ borderRadius: 2 }}>
              <input type="file" accept="application/pdf" className="hidden" onChange={handlePick} />
              Choose File
            </label>
          </div>
          <div className="text-[11px] text-[#888] mt-2">
            Supports court records, ICU investigation docs, info forms, field sheets.
            Auto-detects document type and extracts structured fields.
          </div>
          <div className="text-[10px] text-[#666] mt-3 font-mono">
            Implemented kinds: court_warrant · fi_card · witness_statement · info_form
            <br />
            Stub kinds (low coverage): court_order · trespass_order · evidence_log · investigation_report
          </div>
        </div>
      )}

      {state.kind === 'processing' && (
        <div className="bg-[#0a0a0a] border border-[#222] p-12 text-center" style={{ borderRadius: 2 }}>
          <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin" style={{ color: '#d4a017' }} />
          <div className="text-[13px] text-[#ccc]">
            Extracting fields from <span className="font-mono text-[#d4a017]">{state.filename}</span>…
          </div>
          <div className="text-[10px] text-[#666] mt-2">
            Running pdftotext, falling through to OCR if the PDF has no text layer.
            This can take up to 90 seconds for scanned multi-page documents.
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
