// ============================================================
// RMPG Flex — Compass Smoothing & Deadband
// Stabilizes the live heading dial: shortest-arc exponential
// smoothing across the 0/360 seam, plus a deadband that suppresses
// jitter when the platform is effectively stationary. Pure — no
// React, no DOM.
// ============================================================

/** Normalize any degree value into [0, 360). */
function norm(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return ((deg % 360) + 360) % 360;
}

/** Signed shortest angular delta from a → b, in (-180, 180]. */
export function shortestDelta(a: number, b: number): number {
  let d = (norm(b) - norm(a)) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export interface SmoothHeadingOptions {
  /**
   * Deadband in degrees: changes smaller than this are ignored
   * (returns prev unchanged) to kill stationary jitter. Default 2°.
   */
  deadbandDeg?: number;
  /**
   * Speed in m/s below which smoothing is frozen entirely (heading
   * is meaningless when stopped). When provided and under this, prev
   * is returned. Default: disabled (undefined).
   */
  minSpeedMs?: number;
  /** Current speed in m/s, used with minSpeedMs. */
  speedMs?: number;
}

/**
 * Smooth a new heading toward the target using shortest-arc EMA.
 *   alpha 1 = jump straight to next, alpha 0 = hold prev.
 * Wrap-safe: smoothHeading(350, 10, 0.5) ≈ 0 (crosses north, not 180).
 * Deadband and stationary freeze suppress jitter.
 */
export function smoothHeading(
  prev: number,
  next: number,
  alpha: number,
  opts: SmoothHeadingOptions = {},
): number {
  const p = norm(prev);
  const n = norm(next);
  const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.5;
  const deadband = opts.deadbandDeg ?? 2;

  // Stationary freeze — heading is noise when not moving.
  if (opts.minSpeedMs != null && (opts.speedMs ?? 0) < opts.minSpeedMs) {
    return p;
  }

  const delta = shortestDelta(p, n);
  if (Math.abs(delta) < deadband) return p; // within deadband → hold

  return norm(p + delta * a);
}
