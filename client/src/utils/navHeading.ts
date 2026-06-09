// ============================================================
// RMPG Flex — Heading / Bearing Formatter
// One source of truth for how the compass, the scope readout, and
// contact rows render a heading, so they all match. Pure math — no
// React, no DOM. (Does NOT touch locationImagery.)
// ============================================================

const CARDINALS = [
  'N', 'NNE', 'NE', 'ENE',
  'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW',
  'W', 'WNW', 'NW', 'NNW',
] as const;

/** Normalize any degree value into [0, 360). */
export function normalizeDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return ((deg % 360) + 360) % 360;
}

/** Cardinal/intercardinal point for a heading (16-point compass rose). */
export function cardinal(deg: number): (typeof CARDINALS)[number] {
  const d = normalizeDeg(deg);
  const idx = Math.round(d / 22.5) % 16;
  return CARDINALS[idx];
}

/**
 * Format a heading as a zero-padded 3-digit degree + cardinal.
 *   formatHeading(58)  -> '058 NE'
 *   formatHeading(0)   -> '000 N'
 *   formatHeading(360) -> '000 N'
 */
export function formatHeading(deg: number): string {
  const d = normalizeDeg(deg);
  const rounded = Math.round(d) % 360;
  const padded = String(rounded).padStart(3, '0');
  return `${padded} ${cardinal(rounded)}`;
}

/**
 * Relative bearing of a target given the platform's current heading,
 * normalized to [0, 360). 0 = dead ahead, 90 = off the right side.
 *   relativeBearing(90, 45) -> 45
 *   relativeBearing(10, 350) -> 20  (wrap-around)
 */
export function relativeBearing(targetDeg: number, headingDeg: number): number {
  return normalizeDeg(normalizeDeg(targetDeg) - normalizeDeg(headingDeg));
}

/**
 * Back-azimuth — the reciprocal bearing (the way you'd look back).
 *   backAzimuth(58) -> 238
 *   backAzimuth(238) -> 58
 */
export function backAzimuth(deg: number): number {
  return normalizeDeg(deg + 180);
}
