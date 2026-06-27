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
  // A File (vs bare Blob) carries the filename into the browser PDF viewer's
  // download action, so a user who saves from the viewer gets
  // "Notice-of-Communication-….pdf" instead of a random UUID.
  const file = new File([blob], filename, { type: 'application/pdf' });
  const url = URL.createObjectURL(file);

  const win = window.open(url, '_blank');
  if (!win) {
    // Popup blocked — deliver as a download instead so the user still gets
    // the real PDF bytes.
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Give the new tab ample time to load the bytes before revoking. Once the
  // viewer has parsed the document, printing/saving keeps working after the
  // URL is revoked.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
