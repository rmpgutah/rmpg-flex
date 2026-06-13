// ============================================================
// RMPG Flex — backend humanized-search query expansion
// ============================================================
// Mirror of the web coded() helper: expand the user's QUERY term into candidate
// match strings (raw + snake_case + closed-enum reverse-maps) and OR them into
// a LIKE clause. Additive — the raw term is always included, so name/number
// search is unaffected.
// Spec: docs/superpowers/specs/2026-06-12-humanized-search-linkage-design.md
// ============================================================

/** Escape LIKE wildcards so a search for "50%" doesn't match everything. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// ── Reverse-map: plain-English term → stored code(s) ─────────────────────────
//
// Only entries where snake_case(label) does NOT already equal the stored code.
// Derived from client/src/utils/statusLabels.ts:
//
// 1. PRIORITY_LABELS — stored codes are "P1"/"P2"/"P3"/"P4"; the full labels
//    are "P1 — Emergency", "P2 — Urgent", "P3 — Routine", "P4 — Scheduled".
//    A user typing the adjective word alone (e.g. "emergency") would never
//    snake_case to "P1", so we map the word-portion of each label:
//      "emergency" → ["P1"]
//      "urgent"    → ["P2"]
//      "routine"   → ["P3"]
//      "scheduled" → ["P4"]
//
// 2. CALL_STATUS_LABELS / UNIT_STATUS_LABELS — two statuses store the words
//    run together (no underscore) but display with a space:
//      enroute → "En Route"  (snake_case("en route") = "en_route" ≠ "enroute")
//      onscene → "On Scene"  (snake_case("on scene") = "on_scene" ≠ "onscene")
//
// 3. INCIDENT_STATUS_LABELS — two statuses display with trailing qualifiers:
//      submitted → "Submitted for Review"
//        (snake_case = "submitted_for_review" ≠ "submitted")
//      returned  → "Returned for Revision"
//        (snake_case = "returned_for_revision" ≠ "returned")
//
// All other stored codes in all maps are either a single word (lowercase = code)
// or snake_case of their display label, so the base raw+snake_case path covers
// them without any reverse-map entry.

const LABEL_TO_CODE: Record<string, string[]> = {
  // Priority words (from PRIORITY_LABELS)
  emergency:              ['P1'],
  urgent:                 ['P2'],
  routine:                ['P3'],
  scheduled:              ['P4'],
  // Spaceless run-together status codes (from CALL_STATUS_LABELS / UNIT_STATUS_LABELS)
  'en route':             ['enroute'],
  'on scene':             ['onscene'],
  // Incident status codes whose display label has trailing qualifier words
  'submitted for review': ['submitted'],
  'returned for revision': ['returned'],
};

/**
 * Additive candidate match strings for a human query term:
 *   "Traffic Stop" → ["Traffic Stop", "traffic_stop"]
 * plus any reverse-mapped codes for closed enums.
 */
export function codeCandidates(term: string): string[] {
  const t = term.trim();
  if (!t) return [];
  const out = new Set<string>([t]);
  out.add(t.toLowerCase().replace(/\s+/g, '_'));
  const rev = LABEL_TO_CODE[t.toLowerCase()];
  if (rev) for (const code of rev) out.add(code);
  return [...out];
}

/**
 * Build ( col LIKE ? ESCAPE '\' OR col LIKE ? ... ) plus escaped, wildcard-
 * wrapped binds for a human query term. Use for CODED columns only
 * (incident_type, status, priority, category, disposition). For an empty
 * term returns a never-match clause so callers can splice unconditionally.
 */
export function codedLike(col: string, term: string): { sql: string; binds: string[] } {
  const cands = codeCandidates(term);
  if (cands.length === 0) return { sql: '0', binds: [] };
  const sql = '(' + cands.map(() => `${col} LIKE ? ESCAPE '\\'`).join(' OR ') + ')';
  const binds = cands.map((c) => `%${escapeLike(c)}%`);
  return { sql, binds };
}
