// client/src/utils/pdfStandaloneHeader.ts
import jsPDF from 'jspdf';

// RGB values sourced from pdfTokens.ts for visual consistency:
// BG_SECTION_HDR, TEXT_INVERTED, TEXT_SUBHEAD_INVERTED, ACCENT_GOLD
const NAVY: [number, number, number] = [26, 47, 92];
const WHITE: [number, number, number] = [255, 255, 255];
const SUBHEAD: [number, number, number] = [190, 200, 215];
const GOLD: [number, number, number] = [212, 160, 23];

const BANNER_H = 36; // pt — taller than old 28pt gold banner to fit 2 rows

export interface NavyBannerOpts {
  title: string;       // document type line, e.g. "TRESPASS ORDER — TO-2026-001"
  subtitle?: string;   // division strap, e.g. "Rocky Mountain Protective Group · Records Division"
  rightLine1?: string; // right-aligned row 1 (usually date/timestamp)
  rightLine2?: string; // right-aligned row 2 (usually officer/author name)
  y?: number;          // top-left y in pt, default 36
  marginPt?: number;   // left/right margin in pt, default 36
}

/**
 * Draws the RMPG navy letterhead banner for standalone (unit:'pt') PDF generators.
 * Returns the new y cursor after banner + gold rule + gap = opts.y + 46.
 *
 * Resets drawColor, lineWidth, and textColor to black/0.5pt before returning
 * so generators don't have to clean up.
 */
export function drawNavyBanner(doc: jsPDF, opts: NavyBannerOpts): number {
  const y = opts.y ?? 36;
  const M = opts.marginPt ?? 36;
  const W = doc.internal.pageSize.getWidth();
  const bannerW = W - 2 * M;

  // Navy fill
  doc.setFillColor(...NAVY);
  doc.rect(M, y, bannerW, BANNER_H, 'F');

  // Row 1: agency name (left, white bold 9pt) + rightLine1 (right, white 8pt)
  doc.setFont('Arial', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...WHITE);
  doc.text('ROCKY MOUNTAIN PROTECTIVE GROUP', M + 8, y + 12);

  if (opts.rightLine1) {
    doc.setFont('Arial', 'normal');
    doc.setFontSize(8);
    doc.text(opts.rightLine1, W - M - 8, y + 12, { align: 'right' });
  }

  // Row 2: title (left, pale steel-blue 8pt bold) + rightLine2 (right, white 7.5pt)
  doc.setFont('Arial', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...SUBHEAD);
  const titleText = opts.subtitle ? `${opts.title}  ·  ${opts.subtitle}` : opts.title;
  doc.text(titleText, M + 8, y + 26);

  if (opts.rightLine2) {
    doc.setFont('Arial', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...WHITE);
    doc.text(opts.rightLine2, W - M - 8, y + 26, { align: 'right' });
  }

  // Gold rule below banner (0.75pt)
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.75);
  doc.line(M, y + BANNER_H + 1, W - M, y + BANNER_H + 1);

  // Reset for subsequent rendering
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.setTextColor(0);
  doc.setFont('Arial', 'normal');
  doc.setFontSize(10);

  return y + BANNER_H + 1 + 9; // = y + 46
}
