export const STALE_THRESHOLD_MS = 3 * 60_000;
export const TICK_INTERVAL_MS = 30_000;
// Matches the live enum in server/src/routes/dispatch/units.ts VALID_UNIT_STATUSES.
// 'onscene' is one word (no underscore). off_duty and out_of_service are the
// two excluded statuses — every other status needs GPS coverage.
export const ON_DUTY_STATUSES = [
  'available', 'dispatched', 'enroute', 'onscene', 'busy',
] as const;

/** Pure policy function: age in ms → escalation level. Monotonic. */
export function evaluateLevel(ageMs: number): 0 | 1 | 2 | 3 {
  if (ageMs < 3  * 60_000) return 0;
  if (ageMs < 10 * 60_000) return 1;
  if (ageMs < 15 * 60_000) return 2;
  return 3;
}
