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
import { getDb, query, queryFirst } from '../utils/db';

const statutes = new Hono<Env>();

const COLS = `id, title, chapter, chapter_code, section, subsection, citation,
  short_title, description, offense_level, category, subcategory, part_name,
  code_type, effective_date, source_url, citation_fine`;

// The StatuteLookup UI is multi-state aware but we only hold Utah law.
function utahOnly(state?: string): boolean {
  if (!state) return true;
  const s = state.toUpperCase();
  return s === 'UT' || s === 'ALL' || s === 'UTAH';
}

function shape(r: Record<string, unknown>) {
  // `state`/`state_name`/`definition` keep the legacy StatuteResult shape happy.
  return { ...r, state: 'UT', state_name: 'Utah', definition: null };
}

// GET /search — type-ahead + full-text over citation / title / body.
statutes.get('/search', async (c) => {
  try {
    const db = getDb(c.env);
    const q = (c.req.query('q') || '').trim();
    const category = c.req.query('category');
    const level = c.req.query('level');
    const type = c.req.query('type'); // 'statute' | 'rule'
    const state = c.req.query('state');
    const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 50);

    if (!utahOnly(state)) return c.json({ data: [] });

    const where: string[] = ['is_active = 1'];
    const binds: unknown[] = [];
    if (q.length >= 2) {
      where.push('(citation LIKE ? OR short_title LIKE ? OR description LIKE ?)');
      binds.push(`${q}%`, `%${q}%`, `%${q}%`);
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
              SUM(CASE WHEN offense_level IS NOT NULL THEN 1 ELSE 0 END) AS offense_count
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
