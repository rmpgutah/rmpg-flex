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

import {
  humanizeType,
  humanizePriority,
  humanizeDisposition,
  humanizeGender,
  humanizeRace,
  humanizeCaseType,
} from './statusLabels';
import { formatEnumValue } from './formatters';

/**
 * Convenience for NEW filter sites only: every whitespace-separated term in
 * `query` must appear in the combined haystack. (Existing sites keep their
 * single-substring `.includes(q)` semantics by using coded() inline — do NOT
 * retrofit matchesQuery onto existing filters; it changes multi-word behavior.)
 */
export function matchesQuery(
  query: string,
  ...parts: Array<string | number | null | undefined>
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = parts
    .filter((p) => p != null && p !== '')
    .map((p) => String(p).toLowerCase())
    .join(' ');
  return q.split(/\s+/).every((term) => hay.includes(term));
}

// Default humanizer per coded field key. NOTE: `status` is intentionally
// absent — humanizeStatus needs a context arg ('call'|'incident'|'unit'), so
// status sites pass an explicit closure: coded(x.status, s => humanizeStatus(s, 'incident')).
const FIELD_HUMANIZERS: Record<string, Humanizer> = {
  type: humanizeType,
  incident_type: humanizeType,
  call_type: humanizeType,
  priority: humanizePriority,
  disposition: humanizeDisposition,
  gender: humanizeGender,
  sex: humanizeGender,
  race: humanizeRace,
  case_type: humanizeCaseType,
};

/** Humanize a coded value by its field key, with generic Title-Case fallback. */
export function humanizeField(key: string, raw: string | null | undefined): string {
  const h = FIELD_HUMANIZERS[key];
  return h ? h(raw) : formatEnumValue(raw);
}

/** coded() driven by the field key's mapped humanizer (or generic fallback). */
export function codedByKey(key: string, raw: string | null | undefined): string {
  return coded(raw, (v) => humanizeField(key, v));
}
