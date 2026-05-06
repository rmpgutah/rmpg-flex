/**
 * PdfPreviewModal — renders a formatted PDF in an iframe with download/print
 * actions. Designed to pair with PrintButtonGroup's preview-first flow.
 *
 * Usage:
 *   const [previewTarget, setPreviewTarget] = useState<PrintTarget|null>(null);
 *
 *   <PrintButtonGroup onPreview={setPreviewTarget} />
 *   {previewTarget && (
 *     <PdfPreviewModal
 *       target={previewTarget}
 *       title={`Citation #${citation.citation_number}`}
 *       getDoc={async (t) => generateRecordPdf('citation', citation, { printTarget: t })}
 *       onClose={() => setPreviewTarget(null)}
 *     />
 *   )}
 *
 * The caller passes a `getDoc(target)` factory that returns the formatted
 * jsPDF doc for the chosen target. The modal generates the blob, shows it
 * in an iframe, and on close revokes the blob URL — long shifts that
 * preview many records would otherwise leak megabytes per session.
 *
 * Why iframe vs. PDF.js viewer: simpler, native browser PDF UI, fast.
 * The proprietary RMPG PDF Engine is for the editor surface (where
 * annotations matter); preview only needs to render the bytes faithfully.
 */

import React, { useEffect, useRef, useState } from 'react';
import type jsPDF from 'jspdf';
import { X, Download, Printer, Smartphone, Loader2, AlertTriangle } from 'lucide-react';
import type { PrintTarget } from '../utils/pdfTokens';

export interface PdfPreviewModalProps {
  /** Which print target to render. Modal regenerates if this changes. */
  target: PrintTarget;
  /** Async factory returning the formatted jsPDF doc for the target. */
  getDoc: (target: PrintTarget) => Promise<jsPDF>;
  /** Title shown in modal header (e.g., "Citation #2026-001234"). */
  title: string;
  /** Suggested filename for download (without extension). */
  filename?: string;
  /** Called when the user closes the modal. Caller should clear preview state. */
  onClose: () => void;
  /** Optional: called after the user clicks Print so caller can audit-log. */
  onPrintAttempt?: (target: PrintTarget) => void;
  /** Optional: called after the user clicks Download. */
  onDownloadAttempt?: (target: PrintTarget) => void;
}

export default function PdfPreviewModal({
  target,
  getDoc,
  title,
  filename,
  onClose,
  onPrintAttempt,
  onDownloadAttempt,
}: PdfPreviewModalProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<jsPDF | null>(null);
  const lastUrlRef = useRef<string | null>(null);

  // Generate the PDF for the current target. Re-runs if `target` changes,
  // so toggling between Office/Mobile inside the modal regenerates correctly.
  useEffect(() => {
    let cancelled = false;
    setBlobUrl(null);
    setError(null);

    (async () => {
      try {
        const doc = await getDoc(target);
        if (cancelled) return;
        docRef.current = doc;
        const blob = doc.output('blob');
        const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        // Revoke the previous URL (e.g., user toggled target) before swapping.
        if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
        lastUrlRef.current = url;
        setBlobUrl(url);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'PDF generation failed';
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target, getDoc]);

  // Cleanup on unmount: revoke the last blob URL so the renderer process
  // doesn't accumulate orphaned bytes across long shifts.
  useEffect(() => {
    return () => {
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
      lastUrlRef.current = null;
    };
  }, []);

  // Esc-to-close — standard modal expectation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleDownload = () => {
    if (!docRef.current) return;
    const base = filename || title.replace(/\s+/g, '_').toLowerCase();
    const suffix = target === 'mobile' ? '_mobile' : '';
    docRef.current.save(`${base}${suffix}.pdf`);
    onDownloadAttempt?.(target);
  };

  const handlePrint = () => {
    if (!blobUrl) return;
    // Print the iframe contents directly — the browser's native print
    // dialog gets the formatted PDF without a round-trip to a new window.
    const iframe = document.getElementById('pdf-preview-iframe') as HTMLIFrameElement | null;
    if (iframe?.contentWindow) {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } else {
      // Fallback: open in new tab so the user can print from there
      window.open(blobUrl, '_blank');
    }
    onPrintAttempt?.(target);
  };

  const targetLabel = target === 'mobile' ? 'Mobile (Brother PJ)' : 'Office (Letter)';
  const TargetIcon = target === 'mobile' ? Smartphone : Printer;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — ${targetLabel} preview`}
    >
      <div className="w-full max-w-5xl h-[90vh] bg-[#0a0a0a] border border-[#2e2e2e] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between bg-gradient-to-r from-[#1a1a1a] to-[#242424] border-b border-[#2e2e2e] px-4 py-2">
          <div className="flex items-center gap-2 text-[#d4a017]">
            <TargetIcon className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wider">
              {title} <span className="text-gray-400">— {targetLabel}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={!blobUrl}
              aria-label="Download PDF"
              title="Download PDF"
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold uppercase tracking-wider bg-[#141414] hover:bg-[#1a1a1a] border border-[#2e2e2e] text-[#d4a017] transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Download
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={!blobUrl}
              aria-label="Print PDF"
              title="Print PDF"
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold uppercase tracking-wider bg-[#d4a017] hover:bg-[#b8881a] border border-[#d4a017] text-black transition-colors disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              Print
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              title="Close (Esc)"
              className="inline-flex items-center justify-center w-7 h-7 bg-[#141414] hover:bg-[#2a0a0a] border border-[#2e2e2e] hover:border-red-700 text-gray-400 hover:text-red-400 transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 bg-[#050505] overflow-hidden">
          {error ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-red-400">
              <AlertTriangle className="w-8 h-8" />
              <div className="text-sm font-semibold">PDF generation failed</div>
              <div className="text-xs text-gray-400 max-w-md text-center">{error}</div>
            </div>
          ) : !blobUrl ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin text-[#d4a017]" />
              <div className="text-xs uppercase tracking-wider">Generating {targetLabel} preview...</div>
            </div>
          ) : (
            <iframe
              id="pdf-preview-iframe"
              src={blobUrl}
              title={`${title} preview`}
              className="w-full h-full border-0 bg-white"
            />
          )}
        </div>
      </div>
    </div>
  );
}
