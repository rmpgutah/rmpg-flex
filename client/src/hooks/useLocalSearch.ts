import { useMemo } from 'react';

// ============================================================
// RMPG Flex — Client-Side Search Hook
// ============================================================
// Fast fuzzy-ish search across object arrays. Useful for
// filtering tables, lists, and dropdowns without an API call.
// ============================================================

type SearchableValue = string | number | boolean | null | undefined;

/**
 * Search an array of objects by matching a query against specified fields.
 * Returns filtered results ranked by match quality.
 *
 * @example
 * const filtered = useLocalSearch(warrants, searchTerm, [
 *   'warrant_number',
 *   'subject_name',
 *   'charge_description',
 * ]);
 *
 * // Or with nested field access:
 * const filtered = useLocalSearch(calls, query, [
 *   'call_number',
 *   'address',
 *   (item) => item.assigned_units?.map(u => u.callsign).join(' '),
 * ]);
 */
export function useLocalSearch<T>(
  items: T[],
  query: string,
  fields: Array<keyof T | ((item: T) => SearchableValue)>,
): T[] {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;

    // Split query into terms for multi-word matching
    const terms = q.split(/\s+/).filter(Boolean);

    type Scored = { item: T; score: number };
    const scored: Scored[] = [];

    for (const item of items) {
      let totalScore = 0;
      let allTermsFound = true;

      for (const term of terms) {
        let termScore = 0;

        for (const field of fields) {
          const rawValue =
            typeof field === 'function'
              ? field(item)
              : (item[field as keyof T] as SearchableValue);

          if (rawValue == null) continue;

          const value = String(rawValue).toLowerCase();

          if (value === term) {
            // Exact field match — highest score
            termScore = Math.max(termScore, 100);
          } else if (value.startsWith(term)) {
            // Starts with — high score
            termScore = Math.max(termScore, 75);
          } else if (value.includes(term)) {
            // Contains — medium score
            termScore = Math.max(termScore, 50);
          }
        }

        if (termScore === 0) {
          allTermsFound = false;
          break;
        }
        totalScore += termScore;
      }

      if (allTermsFound && totalScore > 0) {
        scored.push({ item, score: totalScore });
      }
    }

    // Sort by score descending, then maintain original order for ties
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.item);
  }, [items, query, fields]);
}

/**
 * Highlight matching portions of text for search results.
 * Returns an array of { text, highlight } segments.
 *
 * @example
 * const segments = highlightMatch('John Smith', 'smi');
 * // [{ text: 'John ', highlight: false }, { text: 'Smi', highlight: true }, { text: 'th', highlight: false }]
 */
export function highlightMatch(
  text: string,
  query: string,
): Array<{ text: string; highlight: boolean }> {
  if (!query.trim()) return [{ text, highlight: false }];

  const q = query.trim().toLowerCase();
  const segments: Array<{ text: string; highlight: boolean }> = [];
  let remaining = text;

  while (remaining.length > 0) {
    const idx = remaining.toLowerCase().indexOf(q);
    if (idx === -1) {
      segments.push({ text: remaining, highlight: false });
      break;
    }

    if (idx > 0) {
      segments.push({ text: remaining.substring(0, idx), highlight: false });
    }
    segments.push({ text: remaining.substring(idx, idx + q.length), highlight: true });
    remaining = remaining.substring(idx + q.length);
  }

  return segments;
}

export default useLocalSearch;
