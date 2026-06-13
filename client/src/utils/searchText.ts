// client/src/utils/searchText.ts
// ============================================================
// RMPG Flex — Humanized search helpers
// ============================================================
// Additive WYSIWYG matching: a search/filter haystack should include
// BOTH the raw coded value AND its plain-English humanized form, so an
// officer can search by what they SEE ("Traffic Stop") while raw-code
// and record-number lookups keep working. See
// docs/superpowers/specs/2026-06-12-humanized-search-linkage-design.md
// ============================================================

type Humanizer = (v: string | null | undefined) => string;

/**
 * Lowercase haystack fragment for a coded field: raw + humanized, deduped,
 * null-safe. Slots directly into existing `.includes(q)` filter chains.
 *   coded('traffic_stop', humanizeType) → "traffic_stop traffic stop"
 *   coded('P1', humanizePriority)        → "p1 p1 — emergency"
 *   coded(null)                          → ""
 */
export function coded(raw: string | null | undefined, humanizer?: Humanizer): string {
  if (raw == null || raw === '') return '';
  const rawStr = String(raw);
  const human = humanizer ? humanizer(rawStr) : '';
  const parts =
    human && human.toLowerCase() !== rawStr.toLowerCase() ? [rawStr, human] : [rawStr];
  return parts.join(' ').toLowerCase();
}
