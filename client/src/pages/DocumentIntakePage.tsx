// ============================================================
// DocumentIntakePage — drop a PDF, review extracted fields, save
// ============================================================
// Surface for /api/document-intake. Handles four states:
//   idle       → drop zone + file picker
//   processing → spinner while server runs pdftotext + OCR fallback
//   review     → DocumentIntakeReviewer with confidence-colored fields
//   error      → distinct error state with retry affordance
//
// Auth: same JWT as the rest of the app (Layout's <ProtectedRoute>).
// Role-gated to admin/manager/supervisor/officer/dispatcher in nav.
//
// Page 57 audit (v1075): per-page contract every v1024+ audit page
// exposes — keyboard cascade (Esc unwinds to idle, N reopens the
// picker from the review pane), `?new=1` deep-link to land directly
// on the picker, theme-token sweep on inline hex, and a clerk-trail
// "Print Intake Report" PDF on the review pane (so a supervisor or
// defense-discovery responder can read what got pulled from the
// packet before it landed in records).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Loader2, FileText, AlertTriangle } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import DocumentIntakeReviewer, { type DocumentExtraction } from '../components/DocumentIntakeReviewer';
import { useToast } from '../components/ToastProvider';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';

GlobalWorkerOptions.workerSrc = workerUrl;

type State =
  | { kind: 'idle' }
  | { kind: 'processing'; filename: string }
  | { kind: 'review'; extraction: DocumentExtraction; filename: string }
  | { kind: 'error'; message: string };

const UPLOAD_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];

export default function DocumentIntakePage() {
  const { user } = useAuth();
  const canUpload = UPLOAD_ROLES.includes(user?.role ?? '');
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [dragActive, setDragActive] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const deepLinkHandled = useRef(false);

  const uploadFile = useCallback(async (file: File) => {
    if (!canUpload) return;
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Document extraction failed';
      toast.addToast(msg, 'error');
      setState({ kind: 'error', message: msg });
    }
  }, [toast, canUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (!canUpload) return;
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }, [uploadFile, canUpload]);

  const handlePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = '';
  }, [uploadFile]);

  // ── Deep-link hydration ────────────────────────────────────────
  // `?new=1` immediately surfaces the picker — useful from a saved
  // chat link or a tile that wants to drop the clerk directly into
  // the upload affordance. There is no persistent intake-record id
  // to deep-link to (extraction is ephemeral pre-save), so this is
  // the only param we accept. Stripped after first paint so a
  // refresh doesn't keep re-triggering the picker.
  useEffect(() => {
    if (deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    const newParam = searchParams.get('new');
    if (newParam === '1' && state.kind === 'idle') {
      // Defer to next tick so the input is in the DOM.
      setTimeout(() => fileInputRef.current?.click(), 0);
    }
    if (newParam) {
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keyboard shortcuts ─────────────────────────────────────────
  // Esc cascade: review → idle (cancels the in-progress review and
  // returns to the drop zone). On the idle screen Esc is a no-op so
  // we don't fight a chrome-level shortcut. We don't allow Esc out
  // of the `processing` state because the underlying fetch can't be
  // cancelled cleanly — the toast will appear when it resolves.
  //
  // `N` shortcut: from any state without a typing surface focused,
  // re-opens the file picker. Mirrors the muscle memory established
  // by GeographyPage / ServePage / DARs / TasksPage / ForensicLab.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const inTextField = !!t && (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable
      );
      if (e.key === 'Escape') {
        if (state.kind === 'review') {
          e.preventDefault();
          setState({ kind: 'idle' });
        }
        return;
      }
      if ((e.key === 'n' || e.key === 'N') && !inTextField) {
        // Don't intercept while a file dialog or modal owned by the
        // reviewer is open — the reviewer's own ConfirmDialog has
        // its own Esc handling and an N inside a confirmation reads
        // as a typo, not "new upload".
        e.preventDefault();
        if (state.kind === 'review') {
          // Reviewer manages its own dirty-state confirm via the
          // "Upload Another" button. Hard-route through that path
          // to avoid silently dropping edits.
          return;
        }
        fileInputRef.current?.click();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.kind]);

  return (
    <div className="p-4 space-y-3 min-h-full">
      <PanelTitleBar title="DOCUMENT INTAKE" icon={FileText} />

      {/* ── Idle: drop zone ──────────────────────────────────────── */}
      {state.kind === 'idle' && (
        <div
          onDragEnter={(e) => { e.preventDefault(); if (canUpload) setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="bg-surface-sunken border-2 border-dashed p-12 text-center transition-colors"
          style={{
            borderColor: dragActive ? 'rgb(var(--brand-gold-500-rgb))' : 'var(--border-default)',
            borderRadius: 2,
            background: dragActive
              ? 'rgb(var(--brand-gold-500-rgb) / 0.05)'
              : 'rgb(var(--surface-sunken-rgb))',
          }}
        >
          <Upload
            className="w-10 h-10 mx-auto mb-3"
            style={{ color: dragActive
              ? 'rgb(var(--brand-gold-500-rgb))'
              : 'rgb(var(--rmpg-500-rgb))' }}
          />
          <div className="text-[14px] font-semibold mb-1">
            Drop a PDF here, or
            <label
              className="ml-2 px-3 py-1 text-[11px] border border-brand-gold-500 text-brand-gold-500 hover:bg-brand-gold-500 hover:text-black cursor-pointer inline-block uppercase"
              style={{ borderRadius: 2 }}
            >
              <input
                id="ff-documentintakepage-0"
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handlePick}
              />
              Choose File
            </label>
          </div>
          <div className="text-[11px] text-rmpg-400 mt-2">
            Supports court records, ICU investigation docs, info forms, field sheets.
            Auto-detects document type and extracts structured fields.
          </div>
          <div className="text-[10px] text-rmpg-500 mt-3 font-mono">
            Implemented kinds: court_warrant · fi_card · witness_statement · info_form
            <br />
            Stub kinds (low coverage): court_order · trespass_order · evidence_log · investigation_report
          </div>
          <div className="text-[10px] text-rmpg-500 mt-3 font-mono">
            Press <span className="text-brand-gold-500">N</span> to re-open the picker
          </div>
        </div>
      )}

      {/* ── Processing ───────────────────────────────────────────── */}
      {state.kind === 'processing' && (
        <div
          className="bg-surface-sunken border border-border-default p-12 text-center"
          style={{ borderRadius: 2 }}
        >
          <Loader2
            className="w-8 h-8 mx-auto mb-3 animate-spin"
            style={{ color: 'rgb(var(--brand-gold-500-rgb))' }}
          />
          <div className="text-[13px] text-rmpg-300">
            Extracting fields from{' '}
            <span className="font-mono text-brand-gold-500">{state.filename}</span>…
          </div>
          <div className="text-[10px] text-rmpg-500 mt-2">
            Reading the PDF text layer in-browser, then classifying the document
            and pulling structured fields. Born-digital PDFs only (no OCR).
          </div>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────── */}
      {state.kind === 'error' && (
        <div
          className="bg-surface-sunken border border-border-default p-12 text-center"
          style={{ borderRadius: 2 }}
        >
          <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-red-400" />
          <div className="text-[13px] text-rmpg-300 mb-1">Extraction failed</div>
          <div className="text-[11px] text-rmpg-400 font-mono mb-4">{state.message}</div>
          {canUpload && (
            <button
              type="button"
              className="px-3 py-1 text-[11px] border border-brand-gold-500 text-brand-gold-500 hover:bg-brand-gold-500 hover:text-black uppercase"
              style={{ borderRadius: 2 }}
              onClick={() => { setState({ kind: 'idle' }); }}
            >
              Try Another File
            </button>
          )}
        </div>
      )}

      {/* ── Review ───────────────────────────────────────────────── */}
      {state.kind === 'review' && (
        <>
          <div className="text-[10px] text-rmpg-400 font-mono">
            Source: {state.filename}
          </div>
          <DocumentIntakeReviewer
            extraction={state.extraction}
            filename={state.filename}
            onReset={() => setState({ kind: 'idle' })}
          />
        </>
      )}

      {/* ── Discard review confirm ────────────────────────────────── */}
      <ConfirmDialog
        isOpen={discardConfirmOpen}
        onClose={() => setDiscardConfirmOpen(false)}
        onConfirm={() => { setDiscardConfirmOpen(false); setState({ kind: 'idle' }); }}
        title="Discard Intake Review"
        message="Return to the upload screen? Any unsaved edits to the extracted fields will be lost."
        confirmLabel="Discard and go back"
        cancelLabel="Keep reviewing"
        confirmVariant="warning"
      />
    </div>
  );
}
