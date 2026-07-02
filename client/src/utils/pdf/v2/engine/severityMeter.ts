import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import { TONES_RGB } from './style';

export interface SeverityMeterOptions {
  /** 1-based current severity level. Callers must pass 1 <= level <= max. */
  level: number;
  /** Total number of segments in the meter. Callers must pass max >= 1. */
  max: number;
}

const SEGMENT_HEIGHT = 3;   // mm
const SEGMENT_GAP = 1;      // mm
const GAP_BELOW = 2;        // mm
const UNFILLED_RGB: readonly [number, number, number] = [230, 230, 230];
const ESCALATED_RGB: readonly [number, number, number] = [212, 30, 30]; // matches WATERMARK_VOID red

/**
 * Horizontal segmented severity/priority bar. Segments up to `level` fill
 * steel-blue, escalating to gold past 60% and red at the final (max)
 * segment; segments past `level` render as light-gray outline fill.
 * Ported from v1's pdfDetailHelpers.ts severity-meter concept.
 *
 * Callers are expected to pass a valid 1-based `level`/`max` (level <= max,
 * max >= 1) — this primitive does not guard against `max: 0` (would divide
 * by zero) or an out-of-range `level`, matching the rest of the v2 engine's
 * convention of trusting well-formed schema-driven input over the small
 * runtime-facing text clamp in badge.ts's `drawBadge`.
 */
export function drawSeverityMeter(doc: jsPDF, layout: LayoutEngine, opts: SeverityMeterOptions): void {
  const { level, max } = opts;
  layout.pageBreakIfNeeded(SEGMENT_HEIGHT + GAP_BELOW);

  const totalWidth = layout.rightX - layout.leftX;
  const segWidth = (totalWidth - SEGMENT_GAP * (max - 1)) / max;
  let x = layout.leftX;
  const y = layout.cursorY;

  for (let i = 1; i <= max; i++) {
    if (i <= level) {
      const rgb = i === max
        ? ESCALATED_RGB
        : i > max * 0.6
          ? TONES_RGB.accentGold
          : TONES_RGB.accentSteel;
      doc.setFillColor(...rgb);
    } else {
      doc.setFillColor(...UNFILLED_RGB);
    }
    doc.rect(x, y, segWidth, SEGMENT_HEIGHT, 'F');
    x += segWidth + SEGMENT_GAP;
  }

  // Reset fill to the engine's default (white) — matches the established
  // sequential-primitive convention (header.ts, context.ts, primitives.ts's
  // table(), badge.ts) of resetting to a known default between primitives
  // called in normal document flow.
  doc.setFillColor(255, 255, 255);
  layout.advance(SEGMENT_HEIGHT + GAP_BELOW);
}
