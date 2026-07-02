import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import { TONES_RGB } from './style';

export interface CrossRefChipOptions {
  /** Human-readable label, e.g. a name or case number. */
  label: string;
  /** Entity kind the label refers to, e.g. 'person', 'vehicle', 'case'. */
  refType: string;
}

const CHIP_HEIGHT = 4.2; // mm
const GAP_BELOW = 1.3;   // mm
const PAD_X = 1.5;       // mm

/**
 * Small inline outline chip linking to a related record, e.g.
 * "PERSON · Jane Doe (#4021)". Ported from v1's pdfDetailHelpers.ts
 * cross-reference badge concept. Outline-only (steel-blue border + text)
 * to stay visually distinct from the filled `drawBadge` status chip.
 */
export function drawCrossRefChip(doc: jsPDF, layout: LayoutEngine, opts: CrossRefChipOptions): void {
  const fullText = `${opts.refType.toUpperCase()} · ${opts.label}`;
  layout.pageBreakIfNeeded(CHIP_HEIGHT + GAP_BELOW);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);

  const maxWidth = layout.rightX - layout.leftX;
  const text = doc.splitTextToSize(fullText, maxWidth - PAD_X * 2)[0] ?? fullText;
  const textWidth = doc.getTextWidth(text);
  const chipWidth = textWidth + PAD_X * 2;

  const x = layout.leftX;
  const y = layout.cursorY;

  doc.setDrawColor(...TONES_RGB.accentSteel);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, chipWidth, CHIP_HEIGHT, 0.8, 0.8);
  doc.setTextColor(...TONES_RGB.accentSteel);
  doc.text(text, x + PAD_X, y + CHIP_HEIGHT - 1.3);

  // Reset to the engine's default colors — matches the established
  // sequential-primitive convention (header.ts, context.ts, primitives.ts's
  // table(), badge.ts, severityMeter.ts) of resetting to a known default
  // rather than save/restore, since this primitive is called in sequence
  // during normal document flow, not as a one-shot overlay.
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  layout.advance(CHIP_HEIGHT + GAP_BELOW);
}
