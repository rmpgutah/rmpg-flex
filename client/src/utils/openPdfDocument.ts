// ============================================================
// RMPG Flex — open a generated jsPDF inside the app (Toughbook-safe)
//
// All PDF output is routed through openPdfBlob() which dispatches a custom
// DOM event. GlobalPdfViewer (mounted in App.tsx) catches the event and
// renders DocumentViewer — a full-screen in-app iframe modal with
// zoom/print/download controls. No secondary tabs or OS-level file dialogs
// are opened, which is required on the Panasonic Toughbook desktop where the
// kiosk shell blocks external windows.
//
// Blob URL lifecycle: GlobalPdfViewer owns the URL and revokes it on close.
// ============================================================

import type jsPDF from 'jspdf';

/** Custom event name consumed by GlobalPdfViewer. */
export const OPEN_PDF_EVENT = 'rmpg:open-pdf' as const;

export interface OpenPdfDetail {
  url: string;
  title: string;
}

/**
 * Open a blob URL in the in-app PDF viewer.
 * The viewer takes ownership of the URL and revokes it on close.
 */
export function openPdfBlob(url: string, title: string): void {
  window.dispatchEvent(
    new CustomEvent<OpenPdfDetail>(OPEN_PDF_EVENT, { detail: { url, title } }),
  );
}

/**
 * Open a generated jsPDF in the in-app PDF viewer.
 */
export function openPdfDocument(doc: jsPDF, filename: string): void {
  const blob = doc.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });
  const url = URL.createObjectURL(file);
  openPdfBlob(url, filename);
}

/**
 * Get the raw PDF bytes from a jsPDF document as a Uint8Array.
 * Used when routing to the PDF editor for pre-print editing.
 */
export function getPdfBytes(doc: jsPDF): Uint8Array {
  return new Uint8Array(doc.output('arraybuffer'));
}

/**
 * Store a generated PDF in sessionStorage so the PDF editor can pick it up.
 * sessionStorage is per-tab but persists through navigation within the same tab.
 */
export function storePdfForEditor(bytes: Uint8Array, filename: string): void {
  try {
    const base64 = btoa(String.fromCharCode(...bytes));
    sessionStorage.setItem('rmpg-pdf-editor-pending', JSON.stringify({ bytes: base64, filename }));
  } catch {
    // sessionStorage can fail if too large — fall through
  }
}

/**
 * Retrieve and clear a pending PDF from sessionStorage for the PDF editor.
 */
export function loadPdfFromEditor(): { bytes: Uint8Array; filename: string } | null {
  try {
    const raw = sessionStorage.getItem('rmpg-pdf-editor-pending');
    if (!raw) return null;
    sessionStorage.removeItem('rmpg-pdf-editor-pending');
    const { bytes: base64, filename } = JSON.parse(raw);
    const binary = atob(base64);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return { bytes: arr, filename };
  } catch {
    return null;
  }
}
