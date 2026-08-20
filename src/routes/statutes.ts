// ============================================================
// RMPG Flex — Utah law book (statutes + administrative rules)
//   GET /api/statutes/search   q / category / state / level / type / limit
//   GET /api/statutes/toc      table of contents (titles → chapters)
//   GET /api/statutes/chapter  ?title=&chapter=  sections within a chapter
//   GET /api/statutes/section/:citation   full detail for one section
//
// Backed by the utah_statutes table (migration 0073), seeded from le.utah.gov
// (Title 76 Criminal, Title 41 Motor Vehicles, Title 58 Security/PI licensing,
// Title 78B Process Server) + the Utah Administrative Code rules.
//
// `/search` is contract-compatible with the legacy endpoint the StatuteLookup
// component already calls ({ data: StatuteResult[] }); it just returns a richer
// superset of fields. Only Utah data is loaded, so non-UT `state` → empty.
// ============================================================
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, queryInChunks } from '../utils/db';
import { log } from '../utils/logger';

const statutes = new Hono<Env>();

const COLS = `id, title, chapter, chapter_code, section, subsection, citation,
  short_title, description, offense_level, category, subcategory, part_name,
  code_type, effective_date, source_url, citation_fine,
  plain_summary, plain_elements, summary_model`;

// The StatuteLookup UI is multi-state aware but we only hold Utah law.
function utahOnly(state?: string): boolean {
  if (!state) return true;
  const s = state.toUpperCase();
  return s === 'UT' || s === 'ALL' || s === 'UTAH';
}

function shape(r: Record<string, unknown>) {
  // `state`/`state_name`/`definition` keep the legacy StatuteResult shape happy.
  // plain_elements is stored as a JSON array string — parse it so the client
  // gets a real string[] (null/garbage degrades to []).
  let plainElements: string[] = [];
  if (typeof r.plain_elements === 'string' && r.plain_elements.trim()) {
    try {
      const parsed = JSON.parse(r.plain_elements);
      if (Array.isArray(parsed)) plainElements = parsed.map((e) => String(e));
    } catch { /* leave [] */ }
  }
  return { ...r, plain_elements: plainElements, state: 'UT', state_name: 'Utah', definition: null };
}

// GET / — paginated list for the Admin panel (limit/offset/q/category).
statutes.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const q = (c.req.query('q') || '').trim();
    const category = c.req.query('category');
    const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100);
    const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);

    const where: string[] = ['is_active = 1'];
    const binds: unknown[] = [];
    if (q.length >= 2) {
      where.push('(citation LIKE ? OR short_title LIKE ? OR description LIKE ?)');
      const safe = q.slice(0, 48); binds.push(`${safe}%`, `%${safe}%`, `%${safe}%`);
    }
    if (category && category !== 'all') { where.push('category = ?'); binds.push(category); }

    const whereClause = where.join(' AND ');
    const countRow = await queryFirst<{ cnt: number }>(db,
      `SELECT COUNT(*) AS cnt FROM utah_statutes WHERE ${whereClause}`, ...binds);
    const total = countRow?.cnt || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const rows = await query<Record<string, unknown>>(db,
      `SELECT ${COLS} FROM utah_statutes WHERE ${whereClause}
       ORDER BY title, chapter, CAST(section AS REAL), section LIMIT ? OFFSET ?`,
      ...binds, limit, offset);
    return c.json({ data: rows.map(shape), pagination: { total, totalPages, limit, offset } });
  } catch (err) {
    console.error('[statutes] list error', err);
    return c.json({ data: [], pagination: { total: 0, totalPages: 1 } });
  }
});

// GET /search — type-ahead + full-text over citation / title / body.
statutes.get('/search', async (c) => {
  try {
    const db = getDb(c.env);
    const q = (c.req.query('q') || '').trim();
    const category = c.req.query('category');
    const level = c.req.query('level');
    const type = c.req.query('type'); // 'statute' | 'rule'
    const state = c.req.query('state');
    const idParam = c.req.query('id');
    const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 50);

    if (!utahOnly(state)) return c.json({ data: [] });

    const where: string[] = ['is_active = 1'];
    const binds: unknown[] = [];
    // Lookup by internal id — used by the law-book deep-link
    // (/law-book?statute_id=…) to resolve a stable id back to its row when
    // the caller doesn't have the citation. Short-circuits everything else.
    if (idParam) {
      const idNum = parseInt(idParam, 10);
      if (Number.isFinite(idNum)) {
        where.push('id = ?');
        binds.push(idNum);
      }
    }
    if (q.length >= 2) {
      where.push('(citation LIKE ? OR short_title LIKE ? OR description LIKE ?)');
      const safe = q.slice(0, 48); binds.push(`${safe}%`, `%${safe}%`, `%${safe}%`);
    }
    if (category && category !== 'all') { where.push('category = ?'); binds.push(category); }
    if (level) { where.push('offense_level = ?'); binds.push(level); }
    if (type) { where.push('code_type = ?'); binds.push(type); }

    // Exact citation, then prefix, then alphabetical title — most-relevant first.
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT ${COLS} FROM utah_statutes
       WHERE ${where.join(' AND ')}
       ORDER BY CASE WHEN citation = ? THEN 0 WHEN citation LIKE ? THEN 1 ELSE 2 END,
                title, chapter, CAST(section AS REAL), section
       LIMIT ?`,
      ...binds, q, `${q}%`, limit,
    );
    return c.json({ data: rows.map(shape) });
  } catch (err) {
    console.error('[statutes] search error', err);
    return c.json({ error: 'Statute search failed', code: 'STATUTE_SEARCH_ERR' }, 500);
  }
});

// GET /toc — table of contents for the law-book browser.
statutes.get('/toc', async (c) => {
  try {
    const db = getDb(c.env);
    const category = c.req.query('category');
    const where: string[] = ['is_active = 1'];
    const binds: unknown[] = [];
    if (category && category !== 'all') { where.push('category = ?'); binds.push(category); }
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT category, title, chapter, chapter_code,
              MIN(subcategory)  AS subcategory,
              MIN(code_type)    AS code_type,
              COUNT(*)          AS section_count,
              SUM(CASE WHEN offense_level IS NOT NULL THEN 1 ELSE 0 END) AS offense_count,
              SUM(CASE WHEN plain_summary IS NOT NULL AND plain_summary != '' THEN 1 ELSE 0 END) AS summary_count
       FROM utah_statutes
       WHERE ${where.join(' AND ')}
       GROUP BY category, title, chapter_code
       ORDER BY category, title, chapter, chapter_code`,
      ...binds,
    );
    return c.json({ data: rows });
  } catch (err) {
    console.error('[statutes] toc error', err);
    return c.json({ error: 'Statute TOC failed', code: 'STATUTE_TOC_ERR' }, 500);
  }
});

// GET /chapter?title=76&chapter=5  — ordered sections within one chapter.
statutes.get('/chapter', async (c) => {
  try {
    const db = getDb(c.env);
    const title = parseInt(c.req.query('title') || '', 10);
    const chapter = c.req.query('chapter');
    if (!Number.isFinite(title) || !chapter) {
      return c.json({ error: 'title and chapter are required', code: 'BAD_REQUEST' }, 400);
    }
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT ${COLS} FROM utah_statutes
       WHERE is_active = 1 AND title = ? AND chapter_code = ?
       ORDER BY CAST(section AS REAL), section`,
      title, chapter,
    );
    return c.json({ data: rows.map(shape) });
  } catch (err) {
    console.error('[statutes] chapter error', err);
    return c.json({ error: 'Statute chapter failed', code: 'STATUTE_CHAPTER_ERR' }, 500);
  }
});

// Standard Utah statutory penalty ranges by offense_level (Utah Code
// §76-3-203 felony sentencing, §76-3-204 class A misdemeanor,
// §76-3-301 fines). Reference data, not case-specific — used to give
// the Penalty Lookup / Enhancement Calculator a real range when the
// per-statute citation_fine column is unset.
const PENALTY_RANGES: Record<string, { jail_max: string; fine_max: number; rank: number }> = {
  infraction: { jail_max: 'None', fine_max: 750, rank: 0 },
  class_c_misdemeanor: { jail_max: 'Up to 90 days', fine_max: 750, rank: 1 },
  class_b_misdemeanor: { jail_max: 'Up to 6 months', fine_max: 1000, rank: 2 },
  class_a_misdemeanor: { jail_max: 'Up to 364 days', fine_max: 2500, rank: 3 },
  third_degree_felony: { jail_max: 'Up to 5 years', fine_max: 5000, rank: 4 },
  second_degree_felony: { jail_max: '1-15 years', fine_max: 10000, rank: 5 },
  first_degree_felony: { jail_max: '5 years to life', fine_max: 10000, rank: 6 },
  capital_felony: { jail_max: 'Life / death penalty', fine_max: 10000, rank: 7 },
};
const PENALTY_ORDER = Object.keys(PENALTY_RANGES).sort((a, b) => PENALTY_RANGES[a].rank - PENALTY_RANGES[b].rank);

function penaltyRangeFor(offenseLevel: string | null | undefined, citationFine?: number | null) {
  const base = offenseLevel ? PENALTY_RANGES[offenseLevel] : undefined;
  if (!base) return null;
  return {
    jail_max: base.jail_max,
    fine_max: citationFine && citationFine > base.fine_max ? citationFine : base.fine_max,
  };
}

// GET /penalty/:citation — penalty range lookup (Feature 36: Penalty Lookup bar).
statutes.get('/penalty/:citation', async (c) => {
  try {
    const db = getDb(c.env);
    const citation = c.req.param('citation');
    const row = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT ${COLS} FROM utah_statutes WHERE citation = ? AND is_active = 1`,
      citation,
    );
    if (!row) return c.json({ error: 'Statute not found', code: 'STATUTE_NOT_FOUND' }, 404);
    const shaped = shape(row);
    return c.json({
      data: {
        ...shaped,
        penalty_range: penaltyRangeFor(row.offense_level as string | null, row.citation_fine as number | null),
      },
    });
  } catch (err) {
    log.error('[statutes] penalty lookup error', {}, err);
    return c.json({ error: 'Penalty lookup failed', code: 'STATUTE_PENALTY_ERR' }, 500);
  }
});

// GET /analytics/top-charged?days=365&limit=20 — most-cited statutes
// (Feature 37: Top Charged panel). Joins the citations table's
// statute_citation column back to utah_statutes for the short_title.
statutes.get('/analytics/top-charged', async (c) => {
  try {
    const db = getDb(c.env);
    const days = Math.min(Math.max(parseInt(c.req.query('days') || '365', 10) || 365, 1), 3650);
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100);
    const rows = await query<{ citation: string; short_title: string | null; offense_level: string | null; total_count: number }>(
      db,
      `SELECT ct.statute_citation AS citation,
              MAX(s.short_title) AS short_title,
              MAX(s.offense_level) AS offense_level,
              COUNT(*) AS total_count
       FROM citations ct
       LEFT JOIN utah_statutes s ON s.citation = ct.statute_citation AND s.is_active = 1
       WHERE ct.statute_citation IS NOT NULL AND ct.statute_citation != ''
         AND ct.created_at >= datetime('now', ?)
       GROUP BY ct.statute_citation
       ORDER BY total_count DESC
       LIMIT ?`,
      `-${days} days`, limit,
    );
    return c.json({ data: rows });
  } catch (err) {
    log.error('[statutes] top-charged error', {}, err);
    return c.json({ error: 'Top-charged lookup failed', code: 'STATUTE_TOP_CHARGED_ERR' }, 500);
  }
});

// POST /calculate-enhancement { citation, factors: {repeat_offender, weapon_used,
// vulnerable_victim, gang_related, domestic_violence} } — bumps the base offense
// level up the PENALTY_ORDER ladder by one step per triggered factor (Feature 39:
// Enhancement Calculator). Simple, transparent model — not a substitute for a
// prosecutor's charging decision, just a quick "how much worse could this get" tool.
statutes.post('/calculate-enhancement', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ citation?: string; factors?: Record<string, boolean> }>().catch(() => ({}) as { citation?: string; factors?: Record<string, boolean> });
    const citation = (body.citation || '').trim();
    if (!citation) return c.json({ error: 'citation is required', code: 'BAD_REQUEST' }, 400);
    const row = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT ${COLS} FROM utah_statutes WHERE citation = ? AND is_active = 1`,
      citation,
    );
    if (!row) return c.json({ error: 'Statute not found', code: 'STATUTE_NOT_FOUND' }, 404);

    const baseLevel = row.offense_level as string | null;
    const baseRank = baseLevel && PENALTY_RANGES[baseLevel] ? PENALTY_RANGES[baseLevel].rank : null;
    const factors = body.factors || {};
    const triggered = Object.entries(factors).filter(([, v]) => v).map(([k]) => k);
    const enhancedLevel = baseRank == null
      ? baseLevel
      : PENALTY_ORDER[Math.min(baseRank + triggered.length, PENALTY_ORDER.length - 1)];

    return c.json({
      data: {
        ...shape(row),
        base_offense_level: baseLevel,
        base_penalty_range: penaltyRangeFor(baseLevel, row.citation_fine as number | null),
        triggered_factors: triggered,
        enhanced_offense_level: enhancedLevel,
        enhanced_penalty_range: penaltyRangeFor(enhancedLevel, row.citation_fine as number | null),
      },
    });
  } catch (err) {
    log.error('[statutes] enhancement calculation error', {}, err);
    return c.json({ error: 'Enhancement calculation failed', code: 'STATUTE_ENHANCEMENT_ERR' }, 500);
  }
});

// POST /compare { statute_ids: number[] } — side-by-side statute detail
// (Feature 40: Statute Comparison). Returns rows in the order requested.
statutes.post('/compare', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ statute_ids?: number[] }>().catch(() => ({}) as { statute_ids?: number[] });
    const ids = (body.statute_ids || []).map((id) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0);
    if (ids.length < 2) return c.json({ error: 'At least 2 statute_ids are required', code: 'BAD_REQUEST' }, 400);
    // Chunked under D1's 100-bound-parameter cap. `statute_ids` is validated for
    // a MINIMUM of 2 above but has no maximum, so a large compare request would
    // have been rejected at bind time and 500'd.
    const rows = await queryInChunks<Record<string, unknown>>(
      db,
      ids,
      (ph) => `SELECT ${COLS} FROM utah_statutes WHERE id IN (${ph}) AND is_active = 1`,
    );
    const byId = new Map(rows.map((r: Record<string, unknown>) => [r.id as number, r]));
    const ordered = ids.map((id: number) => byId.get(id)).filter((r): r is Record<string, unknown> => !!r);
    return c.json({
      data: ordered.map((r) => ({
        ...shape(r),
        penalty_range: penaltyRangeFor(r.offense_level as string | null, r.citation_fine as number | null),
      })),
    });
  } catch (err) {
    log.error('[statutes] compare error', {}, err);
    return c.json({ error: 'Statute comparison failed', code: 'STATUTE_COMPARE_ERR' }, 500);
  }
});

// GET /section/:citation — single statute/rule full detail.
statutes.get('/section/:citation', async (c) => {
  try {
    const db = getDb(c.env);
    const citation = c.req.param('citation');
    const row = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT ${COLS} FROM utah_statutes WHERE citation = ? AND is_active = 1`,
      citation,
    );
    if (!row) return c.json({ error: 'Statute not found', code: 'STATUTE_NOT_FOUND' }, 404);
    return c.json({ data: shape(row) });
  } catch (err) {
    console.error('[statutes] section error', err);
    return c.json({ error: 'Statute lookup failed', code: 'STATUTE_SECTION_ERR' }, 500);
  }
});

export default statutes;
