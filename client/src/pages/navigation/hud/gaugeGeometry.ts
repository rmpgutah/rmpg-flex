// ============================================================
// RMPG Flex — Drive-Mode HUD · gauge arc geometry
// ============================================================
// Self-contained arc math for the SpeedGauge ring (3/4 sweep, gap at bottom).
// Used to place redline ticks at a value on the dial. Drive-lane only.
// ============================================================

export const GAUGE_R = 42;
export const GAUGE_SWEEP = 0.72; // fraction of the full circle the arc spans
export const GAUGE_CIRC = 2 * Math.PI * GAUGE_R;

/** Fraction (0..1) along the visible arc for a value on [0,max]. */
export function gaugeFraction(value: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(1, value / max));
}

/**
 * The SVG (rendered inside a `viewBox="0 0 100 100"` that is CSS-rotated 129°)
 * places the arc starting at the top after rotation. To draw a tick on the arc
 * at a given value we compute the angle along the dasharray sweep and return the
 * inner/outer endpoints of a short radial tick at center (50,50).
 *
 * The ring is a circle stroked with a dasharray of `track` (= CIRC*sweep). The
 * arc visually begins at the SVG's 3-o'clock (angle 0 in standard SVG coords)
 * and proceeds clockwise. After the CSS rotate(129deg) the start sits near the
 * lower-left, matching the rendered gauge. We mirror that here so the tick lands
 * on the painted arc.
 */
export function gaugeTick(value: number, max: number, len = 9): { x1: number; y1: number; x2: number; y2: number } {
  const f = gaugeFraction(value, max);
  // Angle along the arc, in SVG degrees (clockwise from +x). The painted arc
  // spans GAUGE_SWEEP of the circle, and CSS rotates the whole SVG by 129°, so
  // the on-screen start is at SVG angle 0 rotated by 129°.
  const svgDeg = f * GAUGE_SWEEP * 360 + 129;
  const rad = (svgDeg * Math.PI) / 180;
  const cx = 50, cy = 50;
  const outer = GAUGE_R + 4;
  const inner = GAUGE_R + 4 - len;
  return {
    x1: cx + outer * Math.cos(rad),
    y1: cy + outer * Math.sin(rad),
    x2: cx + inner * Math.cos(rad),
    y2: cy + inner * Math.sin(rad),
  };
}
