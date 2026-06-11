import type jsPDF from 'jspdf';
import { ARIAL_REGULAR_B64, ARIAL_BOLD_B64, ARIAL_ITALIC_B64 } from './arialFontData';

// Registers Liberation Sans (Arial-metric-compatible) on a jsPDF document under
// the family name "Arial", so generators can call setFont('Arial', 'normal' |
// 'bold' | 'italic'). jsPDF's built-in 'helvetica' is visually Arial-like, but
// this embeds the literal Arial-compatible glyphs into the output PDF.
//
// jsPDF's VFS + font registry is PER-DOCUMENT, so this must run once on every
// new jsPDF() instance before any setFont('Arial', …) call. It is cheap and
// idempotent: the (doc as any).__arialRegistered guard makes repeat calls a
// no-op, and the VFS files are tiny (~16KB/style, subset to Latin glyphs).

const VFS = {
  normal: { file: 'Arial-normal.ttf', b64: ARIAL_REGULAR_B64 },
  bold: { file: 'Arial-bold.ttf', b64: ARIAL_BOLD_B64 },
  italic: { file: 'Arial-italic.ttf', b64: ARIAL_ITALIC_B64 },
} as const;

/**
 * Embed the Arial-compatible font family into `doc`. Returns the family name to
 * pass to setFont (always 'Arial'). Safe to call multiple times per document.
 *
 * The glyphs are registered under BOTH the 'Arial' family AND the built-in
 * 'helvetica' family. Overriding 'helvetica' on this document means every
 * existing setFont('helvetica', …) and PDF_VALUE_FONT call (PDF_VALUE_FONT is
 * 'helvetica') — i.e. the entire record body and the page-2+ continuation
 * header — renders with the embedded Arial-compatible glyphs, with zero changes
 * to the hundreds of call sites. Generators that never call this keep jsPDF's
 * built-in Helvetica, so the override is scoped to the record PDFs that draw a
 * NIBRS header. Liberation Sans is Arial-metric-compatible, so text widths
 * stay self-consistent for wrapping/alignment. 'bolditalic' maps to the bold
 * face (no bold-italic glyphs are shipped; it is effectively unused in forms).
 */
export function registerArialFont(doc: jsPDF): 'Arial' {
  const d = doc as unknown as {
    __arialRegistered?: boolean;
    addFileToVFS: (file: string, data: string) => void;
    addFont: (file: string, family: string, style: string) => void;
  };
  if (d.__arialRegistered) return 'Arial';
  for (const family of ['Arial', 'helvetica']) {
    for (const [style, { file, b64 }] of Object.entries(VFS)) {
      d.addFileToVFS(file, b64);
      d.addFont(file, family, style);
    }
    // Map bolditalic → bold face so styled calls don't fall back to a default.
    d.addFont(VFS.bold.file, family, 'bolditalic');
  }
  d.__arialRegistered = true;
  return 'Arial';
}
