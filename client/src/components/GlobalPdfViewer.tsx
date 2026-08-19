// ============================================================
// RMPG Flex — GlobalPdfViewer
//
// Listens for 'rmpg:open-pdf' custom events dispatched by openPdfDocument /
// openPdfBlob and renders DocumentViewer over the full screen.
//
// Mount once in App.tsx. All PDF utilities reach this viewer via the event
// bus — no prop-drilling required. This is the single gate that keeps every
// PDF inside the app on the Toughbook desktop kiosk shell.
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import DocumentViewer from './DocumentViewer';
import { OPEN_PDF_EVENT, type OpenPdfDetail } from '../utils/openPdfDocument';

export default function GlobalPdfViewer() {
  const [entry, setEntry] = useState<{ url: string; title: string } | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const { url, title } = (e as CustomEvent<OpenPdfDetail>).detail;
      setEntry({ url, title });
    };
    window.addEventListener(OPEN_PDF_EVENT, handler);
    return () => window.removeEventListener(OPEN_PDF_EVENT, handler);
  }, []);

  const handleClose = useCallback(() => {
    if (entry) URL.revokeObjectURL(entry.url);
    setEntry(null);
  }, [entry]);

  if (!entry) return null;

  return (
    <DocumentViewer
      isOpen
      src={entry.url}
      title={entry.title}
      type="pdf"
      onClose={handleClose}
    />
  );
}
