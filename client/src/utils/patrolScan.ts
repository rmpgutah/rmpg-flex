// ============================================================
// patrolScan — pure helpers for continuous "while driving" ALPR.
//
// Patrol Scan auto-captures a frame from the live field camera
// every PATROL_INTERVAL_MS and posts it to /api/alpr/capture.
// These helpers hold the two decisions that are worth testing in
// isolation: the per-plate dedup window (so we don't spam the
// on-screen log / voice alert while stuck behind one car) and the
// spoken/banner text for a critical hit.
//
// The loop itself + camera + wake lock live in usePatrolScan;
// everything here is pure so it can be unit-tested without a DOM.
// ============================================================

/** How often Patrol Scan grabs a frame while running. */
export const PATROL_INTERVAL_MS = 4000;

/** Suppress re-logging the same plate for this long. */
export const PATROL_DEDUP_MS = 300_000; // 5 minutes

export interface PatrolHitLike {
  kind?: string;
  severity: string;
  detail: string;
}

/** Normalize a plate for dedup comparison: upper, strip non-alnum. */
export function normalizePlate(plate: string | null | undefined): string {
  return (plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Dedup gate for the on-screen log + voice alert. Returns true when this
 * plate should be logged now (first sighting, or last sighting older than
 * windowMs). Mutates `seen` with the new timestamp when it returns true.
 *
 * Empty / unreadable plates are never logged (return false) — they carry no
 * identity to dedup against and would flood the log on every blank frame.
 */
export function shouldLogPlate(
  plate: string | null | undefined,
  nowMs: number,
  seen: Map<string, number>,
  windowMs: number = PATROL_DEDUP_MS,
): boolean {
  const key = normalizePlate(plate);
  if (!key) return false;
  const last = seen.get(key);
  if (last !== undefined && nowMs - last < windowMs) return false;
  seen.set(key, nowMs);
  return true;
}

/**
 * Spoken/banner text for a critical hit on a plate, or null if there is no
 * critical hit. The officer is driving and cannot read the screen, so the
 * string leads with the threat and reads the plate phonetically-friendly.
 *
 * Example: "Stolen vehicle. Plate A B C 1 2 3." — the detail from the server
 * already describes the hit kind; we prefix with the plate for context.
 */
export function patrolAlertText(
  plate: string | null | undefined,
  hits: PatrolHitLike[] | null | undefined,
): string | null {
  const critical = (hits || []).filter((h) => h && h.severity === 'critical');
  if (critical.length === 0) return null;
  const plateText = normalizePlate(plate);
  const detail = critical.map((h) => h.detail).filter(Boolean).join('. ');
  const lead = detail || 'Wanted vehicle';
  return plateText ? `${lead}. Plate ${plateText}.` : `${lead}.`;
}
