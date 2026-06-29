// ============================================================
// RMPG Flex — open a generated jsPDF in a new tab (the RIGHT way)
//
// Replaces jsPDF's `doc.output('dataurlnewwindow')`, which produced the
// "blank Notice of Communication" incident: dataurlnewwindow opens a tiny
// generated HTML page whose <iframe> points at a SESSION-BOUND blob URL.
// Anything saved/shared from that window (browser "Save page as", drag to
// Documents, print-to-PDF of the wrapper) captures the ~240-byte HTML
// wrapper — whose blob reference is already dead — and renders as a
// completely blank page in every viewer from then on. Live D1 evidence:
// attachments row 56, "Notice of Communication.html", 238 bytes, text/html.
//
// This helper opens the REAL PDF bytes instead:
//   • doc.output('blob') wrapped in a File so the browser PDF viewer's
//     download button saves under the intended filename;
//   • window.open on the object URL — Chrome/Edge/Firefox show their native
//     PDF viewer, and "Save" from there writes the actual PDF;
//   • popup-blocked? fall back to a direct .pdf download (same pattern as
//     recordPdfGenerator's download path);
//   • the object URL is revoked after the viewer has had time to load.
// ============================================================

import type jsPDF from 'jspdf';

/**
 * Open a generated jsPDF in a new browser tab as a real PDF document,
 * falling back to a direct download when the popup is blocked.
 */
export function openPdfDocument(doc: jsPDF, filename: string): void {
  const blob = doc.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });
  const url = URL.createObjectURL(file);

  const win = window.open(url, '_blank');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
