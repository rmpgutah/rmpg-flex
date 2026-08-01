// Sentinel-string guard for live D1 text columns.
//
// Live D1 stores literal "None"/"N/A"/"0"/"--" in flag and free-text columns
// instead of NULL (see the [[project-sentinel-none-strings]] memory). A naive
// truthiness check (`if (row.gang_affiliation)`) then fires false positives —
// e.g. a bogus officer-safety "gang affiliation noted" alert on a subject with
// no flags, or the AI dispatcher reading "Insurance None." back over the air.
// isFlagSet() treats those sentinels as absent. This is the CANONICAL home —
// import it rather than re-deriving the set per module.

export const FLAG_ABSENT = new Set(
  // 'unknown' is absent here for the same reason as 'none': "we don't know"
  // is not an affirmative flag. isRealValue() in intelMatch.ts already treated
  // it that way, so the two helpers now agree.
  ['', 'none', 'n/a', 'na', '0', 'false', 'no', 'null', 'undefined', '--', 'unknown', 'unk'],
);

/**
 * True when a DB value is a REAL value — not NULL and not a sentinel placeholder.
 *
 * An exact-match set alone was not enough, because two shapes of "empty" got
 * through and produced FALSE officer-safety output:
 *
 *   JSON-encoded empty collections. `flags` columns store the literal string
 *   "[]" — on live that is ALL 42 vehicles_records rows and 68 persons rows.
 *   dispatcherAwareness joins the set flags into a caution string, so every
 *   vehicle lookup emitted `Flags: [].` and every person caution rendered
 *   "[]" — which the AI dispatcher then reads back over the air.
 *
 *   Trailing punctuation. Live data holds "Unknown." and "N/A.", which an exact
 *   match misses, so a mental-health / substance-abuse caution fired for a
 *   subject whose record explicitly says the answer is unknown.
 *
 * This is the same presence-vs-affirmation error as the "Not Stolen" stolen
 * flag: the value existing is not the value being true.
 */
export function isFlagSet(v: unknown): boolean {
  if (v == null) return false;
  const raw = String(v).trim();
  if (raw === '') return false;

  // Parse JSON collections rather than treating their text as content. A
  // non-empty list is a real flag ('["dl_ocr_imported"]' is genuine); an empty
  // one, or one holding only blanks, is not.
  if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.some((item) => isFlagSet(item));
      if (parsed && typeof parsed === 'object') return Object.keys(parsed).length > 0;
    } catch {
      // Not valid JSON after all — fall through to the sentinel match.
    }
  }

  return !FLAG_ABSENT.has(raw.toLowerCase().replace(/[.!?;:,\s]+$/, ''));
}
