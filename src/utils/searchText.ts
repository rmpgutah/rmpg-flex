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

// ── D1's LIKE pattern cap ────────────────────────────────────────────────────
//
// Cloudflare D1 sets SQLITE_LIMIT_LIKE_PATTERN_LENGTH to **50 characters**.
// Stock SQLite defaults to 50000, so this has no local equivalent: it cannot
// reproduce in `wrangler dev`, in Miniflare, or in any unit test — it only
// surfaces against remote D1, as `D1_ERROR: LIKE or GLOB pattern too complex`.
// Measured empirically against the live DB on 2026-07-24 (50 chars OK, 52 fails).
//
// A pattern of `%<term>%` therefore breaks once the term passes 48 characters —
// well within ordinary input. Two live routes were returning 500s on real user
// text: `/api/legal-data-hunter/validate` (charge strings like "THEFT BY
// RECEIVING STOLEN PROPERTY - 3RD DEGREE FELONY", 53 chars) and
// `/api/records/search`. Note that escapeLike() makes this WORSE, since each
// escaped wildcard costs two characters.
//
// Prefer `containsClause()` below for substring matching. `instr()` is not a
// LIKE pattern, so it has no length cap at all, and it matches literally —
// no wildcard escaping needed.

/** Cloudflare D1's SQLITE_LIMIT_LIKE_PATTERN_LENGTH. Stock SQLite uses 50000. */
export const D1_LIKE_PATTERN_LIMIT = 50;

/**
 * True when `%term%` (after wildcard escaping) would exceed D1's LIKE pattern
 * cap and thus fail at runtime. Use to guard any remaining raw LIKE call site.
 */
export function exceedsLikePatternLimit(term: string): boolean {
  return escapeLike(term).length + 2 > D1_LIKE_PATTERN_LIMIT;
}

/**
 * Build a `%term%` LIKE pattern (escaped for `ESCAPE '\'`) that is GUARANTEED
 * to fit D1's 50-char pattern cap: the escaped term is truncated to 48 chars,
 * and a dangling odd backslash left by the cut is trimmed so it can't escape
 * the trailing `%` wildcard. Prefer containsClause() for new code; use this
 * when a call site must stay on LIKE.
 */
export function cappedLikePattern(term: string): string {
  const escaped = escapeLike(term)
    .slice(0, D1_LIKE_PATTERN_LIMIT - 2)
    .replace(/\\+$/, (m) => (m.length % 2 ? m.slice(0, -1) : m));
  return `%${escaped}%`;
}

/**
 * A case-insensitive "column contains term" clause that is safe at ANY term
 * length — the D1-safe replacement for `col LIKE '%term%'`.
 *
 * Bind the RAW term (no wildcards, no escapeLike) — matching is literal:
 *   const { sql, bind } = containsClause('p.last_name');
 *   query(db, `SELECT * FROM persons WHERE ${sql}`, bind(userInput));
 *
 * `col` MUST be a hard-coded column name, never user input — it is interpolated
 * straight into the SQL string.
 */
export function containsClause(col: string): { sql: string; bind: (term: string) => string } {
  return {
    sql: `instr(lower(${col}), lower(?)) > 0`,
    bind: (term: string) => term,
  };
}

/**
 * OR-joined "contains" across several columns — the D1-safe replacement for
 * `(a LIKE ? OR b LIKE ? OR c LIKE ?)` with one wildcard bind per column:
 *   const m = containsAnyClause(['last_name', 'first_name']);
 *   query(db, `SELECT * FROM persons WHERE ${m.sql}`, ...m.binds(userInput));
 *
 * Every entry of `cols` MUST be a hard-coded column name or SQL expression,
 * never user input.
 */
export function containsAnyClause(cols: string[]): { sql: string; binds: (term: string) => string[] } {
  return {
    sql: '(' + cols.map((c) => `instr(lower(${c}), lower(?)) > 0`).join(' OR ') + ')',
    binds: (term: string) => cols.map(() => term),
  };
}

/**
 * The reverse direction: does the bound TERM contain the column's value?
 * (e.g. does a long charge string contain a short statute title?)
 *
 * Replaces `? LIKE '%' || col || '%'`, which was doubly unsafe — that pattern is
 * built from table DATA, so a single long row broke the query for every caller.
 */
export function containedByClause(col: string): { sql: string; bind: (term: string) => string } {
  return {
    sql: `instr(lower(?), lower(${col})) > 0`,
    bind: (term: string) => term,
  };
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

// ⚠️  Hand-maintained mirror of client/src/utils/statusLabels.ts. If that file
//     changes (new status code, label rename), update this map too — there is
//     no build-time check; drift causes silent search misses, not errors.
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
  // CASE_TYPE_LABELS: admin → 'Administrative' (snake_case = 'administrative' ≠ 'admin')
  'administrative':       ['admin'],
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
 * term returns a never-match clause `{sql:'0', binds:[]}`. This is
 * safe to OR-splice (`... OR 0` is a no-op-style no-match); in an AND context
 * (`... AND 0`) it returns ZERO rows, so guard the caller or check binds.length
 * before splicing an AND.
 *
 * `col` MUST be a hard-coded column name, never user input — it is interpolated
 * directly into the SQL string (only the bind VALUES are parameterized).
 */
export function codedLike(col: string, term: string): { sql: string; binds: string[] } {
  const cands = codeCandidates(term);
  if (cands.length === 0) return { sql: '0', binds: [] };
  const sql = '(' + cands.map(() => `${col} LIKE ? ESCAPE '\\'`).join(' OR ') + ')';
  const binds = cands.map((c) => `%${escapeLike(c)}%`);
  return { sql, binds };
}
