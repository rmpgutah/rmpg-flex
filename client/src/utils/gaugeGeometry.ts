// ============================================================
// RMPG Flex — Speed Gauge Ring Geometry
// Shared SVG arc math for the SpeedGauge and any future radial
// gauges. Angles use the SVG/compass convention: 0° = 12 o'clock
// (top), increasing CLOCKWISE. Pure — no React, no DOM.
// ============================================================

/** Convert a gauge angle (deg, 0=top, CW+) to an x/y on the ring. */
export function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number,
): { x: number; y: number } {
  // 0° at top, clockwise → standard math angle = (angle - 90)
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

/**
 * SVG path 'd' string for a circular arc from startDeg → endDeg
 * (both in the 0=top, CW+ convention). Drawn clockwise.
 *   arcPath(50,50,40,0,90) -> 'M 50 10 A 40 40 0 0 1 90 50'
 */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, endDeg);
  const sweep = endDeg - startDeg;
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const sweepFlag = sweep < 0 ? 0 : 1; // 1 = clockwise
  const fmt = (n: number) => {
    const r2 = Math.round(n * 1000) / 1000;
    return Object.is(r2, -0) ? '0' : String(r2);
  };
  return `M ${fmt(start.x)} ${fmt(start.y)} A ${fmt(r)} ${fmt(r)} 0 ${largeArc} ${sweepFlag} ${fmt(end.x)} ${fmt(end.y)}`;
}

/**
 * Map a value (0..max) onto a gauge angle within a sweep.
 * Returns the angle in the 0=top CW+ convention, offset by the
 * gauge's start angle. Clamps value into range.
 *   valueToAngle(50, 100, 270)        -> 135 (half of a 270° sweep)
 *   valueToAngle(50, 100, 270, -135)  ->   0 (sweep centered at top)
 */
export function valueToAngle(
  value: number,
  max: number,
  sweep: number,
  startDeg = 0,
): number {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const v = Number.isFinite(value) ? Math.max(0, Math.min(safeMax, value)) : 0;
  const frac = v / safeMax;
  return startDeg + frac * sweep;
}
