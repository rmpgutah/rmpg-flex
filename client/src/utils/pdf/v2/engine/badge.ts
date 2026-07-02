import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import { TONES_RGB } from './style';

export type BadgeTone = 'steel' | 'gold' | 'neutral';

export interface BadgeOptions {
  label: string;
  tone?: BadgeTone;
}

const TONE_RGB: Record<BadgeTone, readonly [number, number, number]> = {
  steel:   TONES_RGB.accentSteel,
  gold:    TONES_RGB.accentGold,
  neutral: [90, 90, 90],
};

const BADGE_HEIGHT = 4.5; // mm
const BADGE_PAD_X = 2;    // mm
const BADGE_GAP_BELOW = 1.5; // mm

/**
 * Small filled status/priority chip (e.g. "ACTIVE WARRANT", "CLEARED",
 * "VERIFIED"). Draws full-width-left-aligned at the layout's current
 * cursor and advances past it. Ported from v1's pdfDetailHelpers.ts
 * badge-chip concept, redrawn against the v2 engine's LayoutEngine.
 */
export function drawBadge(doc: jsPDF, layout: LayoutEngine, opts: BadgeOptions): void {
  const tone = opts.tone ?? 'neutral';
  const [r, g, b] = TONE_RGB[tone];
  const text = opts.label.toUpperCase();

  layout.pageBreakIfNeeded(BADGE_HEIGHT + BADGE_GAP_BELOW);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);

  // Defensive clamp: a verbose label (e.g. a long real-world status string)
  // should never draw a badge wider than the available content width.
  // Truncate via splitTextToSize, same pattern as primitives.ts's
  // labeledField (`splitTextToSize(labelText, width - 1)[0]`).
  const maxWidth = layout.rightX - layout.leftX;
  const clampedText = doc.splitTextToSize(text, maxWidth - BADGE_PAD_X * 2)[0] ?? text;

  const textWidth = doc.getTextWidth(clampedText);
  const badgeWidth = textWidth + BADGE_PAD_X * 2;

  const x = layout.leftX;
  const y = layout.cursorY;

  doc.setFillColor(r, g, b);
  doc.roundedRect(x, y, badgeWidth, BADGE_HEIGHT, 0.8, 0.8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text(clampedText, x + BADGE_PAD_X, y + BADGE_HEIGHT - 1.3);

  // Reset to the engine's default colors (black text/draw, white fill) —
  // matches the established sequential-primitive convention in header.ts,
  // context.ts, and primitives.ts's table(), all of which reset to a known
  // default rather than save/restore. (watermark.ts uses save/restore
  // instead because it's a one-shot full-page overlay with a different
  // state-preservation need — not applicable to primitives called in
  // sequence during normal document flow.)
  doc.setTextColor(0, 0, 0);
  doc.setFillColor(255, 255, 255);
  layout.advance(BADGE_HEIGHT + BADGE_GAP_BELOW);
}
