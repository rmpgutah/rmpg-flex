// ============================================================
// addressClean — normalize free-form address strings for display
//
// Stored addresses (often a Mapbox `place_name`) sometimes carry trailing
// junk: an unbalanced ")" ("…UNITED STATES)") or a dangling separator
// ("…BOULEVARD,") left when a final component was dropped. These render as
// visible defects in record/CFS reports and detail panels.
//
// cleanAddressText only trims TRAILING junk — it never reorders, drops
// interior content, or touches balanced parentheses (e.g. "Bldg A (rear)"
// is preserved). Safe for both PDF generation and on-screen display.
// ============================================================

/**
 * Trim trailing whitespace, separators (`, ;`), and an UNBALANCED trailing
 * `)` from an address string. Collapses runs of internal whitespace.
 * Returns '' for nullish input. Idempotent.
 */
export function cleanAddressText(addr: string | null | undefined): string {
  if (!addr) return '';
  let s = String(addr).replace(/\s+/g, ' ').trim();
  let prev: string;
  do {
    prev = s;
    s = s.replace(/[\s,;]+$/, '');
    // Strip a trailing ')' only when there is no '(' to match it (dirty data),
    // so legitimate parentheticals like "Suite 2 (rear)" are left intact.
    if (s.endsWith(')') && !s.includes('(')) s = s.slice(0, -1);
  } while (s !== prev);
  return s;
}
