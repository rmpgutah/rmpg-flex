// ============================================================
// RMPG Flex — NaN-safe pagination params
// ============================================================
// D1 REJECTS a non-integer bound to LIMIT or OFFSET. Probed against
// Miniflare/workerd 2026-08-02:
//
//   LIMIT NaN / Infinity / 1e20 / 'abc'  -> D1_ERROR: datatype mismatch
//   OFFSET NaN                           -> D1_ERROR: datatype mismatch
//   LIMIT -5 / OFFSET -5                 -> OK (SQLite allows negatives)
//
// (By contrast `WHERE id = ?` with NaN returns 0 rows and does NOT throw, so
// the ~800 numeric :id params in this codebase are fine — they degrade to a
// correct 404. LIMIT/OFFSET is the only binding position that throws.)
//
// So `?limit=abc` produced an HTTP 500. The existing guards did not stop it,
// because both of these still yield NaN:
//
//   parseInt(c.req.query('limit') || '50', 10)   'abc' is TRUTHY, so the
//                                                 '50' default never applies
//   Math.min(500, Math.max(1, NaN))              every Math.* op on NaN is NaN
//
// clampIntParam() applies the fallback AFTER parsing, which is the only order
// that works, and bounds the result so a huge-but-finite value (1e20 passes
// Number.isFinite) can't reach D1 either.
// ============================================================

/**
 * Parse a request query param into an integer safe to bind to LIMIT/OFFSET.
 *
 * @param raw   the raw query string value (may be undefined/empty/garbage)
 * @param dflt  value to use when absent or unparseable
 * @param min   lower bound (inclusive)
 * @param max   upper bound (inclusive)
 */
export function clampIntParam(
  raw: string | undefined | null,
  dflt: number,
  min: number,
  max: number,
): number {
  const parsed = parseInt(String(raw ?? ''), 10);
  // Number.isFinite rejects NaN and ±Infinity; Math.trunc guards a float that
  // slipped through a caller using Number() instead of parseInt().
  const value = Number.isFinite(parsed) ? Math.trunc(parsed) : dflt;
  return Math.min(Math.max(value, min), max);
}

export default clampIntParam;
