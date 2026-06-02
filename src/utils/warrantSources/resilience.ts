/**
 * Per-source resilience helpers for the warrant-puller multi-source scan orchestrator.
 *
 * Pure functions only — no timers, no network, no Math.random, no Date.now.
 * They encode the math/string logic that backs polite vs. aggressive polling
 * against the `warrant_scraper_config` fields (etag / last_modified / jitter_seed
 * + a trailing run-history window). Being pure + deterministic keeps them unit
 * testable and the orchestrator resume-safe.
 */

/** Number of consecutive failed runs (newest first) that trips the breaker. */
const CIRCUIT_THRESHOLD = 5;

/** Width of the jitter band added on top of the base delay, in ms. */
const JITTER_SPAN_MS = 2000;

/**
 * ≥5 trailing failures → circuit open.
 *
 * `trailingErrorCounts` is the per-run error count, newest first. A run is
 * "failed" if its error count is > 0. Count consecutive failed runs from the
 * start of the array; the first run with 0 errors (or the end of the array)
 * stops the count and closes the circuit. Open iff that consecutive streak is
 * at least {@link CIRCUIT_THRESHOLD}.
 */
export function isCircuitOpen(trailingErrorCounts: number[]): boolean {
  let consecutive = 0;
  for (const count of trailingErrorCounts) {
    if (count > 0) {
      consecutive++;
      if (consecutive >= CIRCUIT_THRESHOLD) return true;
    } else {
      // A run with 0 errors closes the circuit and resets the streak.
      break;
    }
  }
  return consecutive >= CIRCUIT_THRESHOLD;
}

/**
 * Conditional-GET request headers built from stored config state. A header is
 * omitted when its value is absent (null/undefined/empty string).
 */
export function conditionalHeaders(cfg: {
  etag?: string | null;
  last_modified?: string | null;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof cfg.etag === 'string' && cfg.etag.length > 0) {
    headers['If-None-Match'] = cfg.etag;
  }
  if (typeof cfg.last_modified === 'string' && cfg.last_modified.length > 0) {
    headers['If-Modified-Since'] = cfg.last_modified;
  }
  return headers;
}

/** True iff the HTTP response says "unchanged since last fetch" (304). */
export function isUnchanged(status: number): boolean {
  return status === 304;
}

/**
 * Deterministic-but-varied delay in ms within [baseMs, baseMs + JITTER_SPAN_MS).
 *
 * Derived purely from `seed` + `attempt` via a Knuth-multiplicative integer mix
 * (no Math.random, no Date.now) so the same inputs always yield the same delay
 * — letting a resumed scan reproduce its back-off schedule exactly.
 */
export function jitterDelayMs(baseMs: number, seed: number, attempt: number): number {
  // Mix seed + attempt into a 32-bit unsigned hash, then fold into the band.
  const hash = (Math.imul(seed >>> 0, 2654435761) + Math.imul(attempt >>> 0, 40503)) >>> 0;
  const offset = hash % JITTER_SPAN_MS;
  return baseMs + offset;
}
