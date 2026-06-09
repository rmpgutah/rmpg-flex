// ============================================================
// RMPG Flex — ETA Urgency & Countdown Math
// Pure helpers for the NAVIGATE ETA band: MM:SS countdown, urgency
// color (gold → amber → red as time runs out), and the projected
// arrival clock time. No React, no DOM.
// ============================================================

export interface EtaThresholds {
  /** at/under this many seconds remaining → red (urgent). */
  red: number;
  /** at/under this many seconds remaining → amber (soon). */
  amber: number;
}

const DEFAULT_THRESHOLDS: EtaThresholds = { red: 60, amber: 300 };

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Format remaining seconds as MM:SS (minutes can exceed 99).
 *   etaCountdown(65)   -> '01:05'
 *   etaCountdown(5)    -> '00:05'
 *   etaCountdown(3725) -> '62:05'
 * Negative / invalid → '00:00'.
 */
export function etaCountdown(remainingSeconds: number): string {
  const total =
    Number.isFinite(remainingSeconds) && remainingSeconds > 0
      ? Math.round(remainingSeconds)
      : 0;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${pad2(mins)}:${pad2(secs)}`;
}

/**
 * Urgency color for the remaining time (Spillman gold/amber/red, no blue).
 *   <= red threshold   -> red
 *   <= amber threshold -> amber
 *   otherwise          -> gold
 */
export function etaColor(
  remainingSeconds: number,
  thresholds: EtaThresholds = DEFAULT_THRESHOLDS,
): string {
  const GOLD = '#d4a017';
  const AMBER = '#c47f17';
  const RED = '#b3261e';
  const s = Number.isFinite(remainingSeconds) ? remainingSeconds : Infinity;
  const t = thresholds ?? DEFAULT_THRESHOLDS;
  if (s <= t.red) return RED;
  if (s <= t.amber) return AMBER;
  return GOLD;
}

/**
 * Projected arrival Date = now + remainingSeconds.
 *   arrivalDate(new Date(0), 90) -> Date at +90s
 */
export function arrivalDate(now: Date, remainingSeconds: number): Date {
  const base = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now();
  const add = Number.isFinite(remainingSeconds) && remainingSeconds > 0 ? remainingSeconds : 0;
  return new Date(base + add * 1000);
}
