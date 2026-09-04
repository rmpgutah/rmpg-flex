import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { D1Database } from '@cloudflare/workers-types';
import { log } from '../utils/logger';

const app = new Hono<{ Bindings: { DB: D1Database }; Variables: { user: any } }>();

// ── FTS5 unified search across cases and persons ──
const searchSchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

app.get('/search', zValidator('query', searchSchema), async (c) => {
  const { q, limit, offset } = c.req.valid('query');
  const db = c.env.DB;
  const sanitized = q.replace(/[^\w\s-]/g, '').trim();
  if (!sanitized) {
    return c.json({ data: [], pagination: { total: 0, limit, offset } });
  }

  const ftsQuery = sanitized.split(/\s+/).map(t => `"${t}"`).join(' OR ');

  let casesResult = { results: [] as any[], total: 0 };
  let personsResult = { results: [] as any[], total: 0 };

  try {
    const [casesRes, casesTotal] = await Promise.all([
      db.prepare(
        `SELECT c.id, c.case_number, c.title, c.status, c.case_type, c.priority,
                c.solvability_score, c.created_at, c.updated_at,
                rank(matchinfo(cases_fts)) as fts_rank
         FROM cases_fts JOIN cases c ON cases_fts.rowid = c.id
         WHERE cases_fts MATCH ?
         ORDER BY fts_rank DESC
         LIMIT ? OFFSET ?`
      ).bind(ftsQuery, limit, offset).all(),
      db.prepare(
        `SELECT COUNT(*) as total FROM cases_fts WHERE cases_fts MATCH ?`
      ).bind(ftsQuery).first<{ total: number }>(),
    ]);
    casesResult = { results: casesRes.results || [], total: casesTotal?.total || 0 };
  } catch (err) {
    log.warn('[investigation] FTS cases query failed, trying LIKE fallback', { error: err instanceof Error ? err.message : String(err) });
    try {
      const likeQuery = `%${sanitized.slice(0, 48)}%`;
      const likeRes = await db.prepare(
        `SELECT c.id, c.case_number, c.title, c.status, c.case_type, c.priority,
                c.solvability_score, c.created_at, c.updated_at, 0 as fts_rank
         FROM cases c
         WHERE c.title LIKE ? OR c.case_number LIKE ? OR c.description LIKE ?
         LIMIT ? OFFSET ?`
      ).bind(likeQuery, likeQuery, likeQuery, limit, offset).all();
      const countRes = await db.prepare(
        `SELECT COUNT(*) as total FROM cases c
         WHERE c.title LIKE ? OR c.case_number LIKE ? OR c.description LIKE ?`
      ).bind(likeQuery, likeQuery, likeQuery).first<{ total: number }>();
      casesResult = { results: likeRes.results || [], total: countRes?.total || 0 };
    } catch { /* both paths failed — return empty */ }
  }

  try {
    const [personsRes, personsTotal] = await Promise.all([
      db.prepare(
        `SELECT p.id, p.first_name, p.last_name, p.dob, p.phone,
                p.created_at,
                rank(matchinfo(persons_fts)) as fts_rank
         FROM persons_fts JOIN persons p ON persons_fts.rowid = p.id
         WHERE persons_fts MATCH ?
         ORDER BY fts_rank DESC
         LIMIT ? OFFSET ?`
      ).bind(ftsQuery, limit, offset).all(),
      db.prepare(
        `SELECT COUNT(*) as total FROM persons_fts WHERE persons_fts MATCH ?`
      ).bind(ftsQuery).first<{ total: number }>(),
    ]);
    personsResult = { results: personsRes.results || [], total: personsTotal?.total || 0 };
  } catch (err) {
    log.warn('[investigation] FTS persons query failed, trying LIKE fallback', { error: err instanceof Error ? err.message : String(err) });
    try {
      const likeQuery = `%${sanitized.slice(0, 48)}%`;
      const likeRes = await db.prepare(
        `SELECT p.id, p.first_name, p.last_name, p.dob, p.phone,
                p.created_at, 0 as fts_rank
         FROM persons p
         WHERE p.first_name LIKE ? OR p.last_name LIKE ? OR p.phone LIKE ?
         LIMIT ? OFFSET ?`
      ).bind(likeQuery, likeQuery, likeQuery, limit, offset).all();
      const countRes = await db.prepare(
        `SELECT COUNT(*) as total FROM persons p
         WHERE p.first_name LIKE ? OR p.last_name LIKE ? OR p.phone LIKE ?`
      ).bind(likeQuery, likeQuery, likeQuery).first<{ total: number }>();
      personsResult = { results: likeRes.results || [], total: countRes?.total || 0 };
    } catch { /* both paths failed — return empty */ }
  }

  return c.json({
    data: {
      cases: casesResult.results,
      persons: personsResult.results,
    },
    pagination: {
      cases_total: casesResult.total,
      persons_total: personsResult.total,
      limit,
      offset,
    },
  });
});

// ── Entity link CRUD ──
const linkCreateSchema = z.object({
  source_type: z.enum(['case', 'person', 'vehicle', 'incident', 'call', 'warrant', 'property', 'evidence']),
  source_id: z.coerce.number().int().positive(),
  target_type: z.enum(['case', 'person', 'vehicle', 'incident', 'call', 'warrant', 'property', 'evidence']),
  target_id: z.coerce.number().int().positive(),
  link_category: z.string().max(100).default('related'),
  notes: z.string().max(500).optional(),
});

app.post('/links', zValidator('json', linkCreateSchema), async (c) => {
  const user = c.var.user;
  const { source_type, source_id, target_type, target_id, link_category, notes } = c.req.valid('json');

  const result = await c.env.DB.prepare(
    `INSERT INTO investigation_links (source_type, source_id, target_type, target_id, link_category, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(source_type, source_id, target_type, target_id, link_category, notes || null, user?.id || null).run();

  await c.env.DB.prepare(
    `INSERT INTO case_timeline_events (case_id, event_type, summary, metadata, created_by)
     VALUES (?, 'link_created', ?, ?, ?)`
  ).bind(
    source_type === 'case' ? source_id : target_id,
    `Linked ${source_type} #${source_id} ↔ ${target_type} #${target_id} (${link_category})`,
    JSON.stringify({ source_type, source_id, target_type, target_id, link_category }),
    user?.id || null
  ).run();

  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

app.get('/links/:entityType/:entityId', async (c) => {
  const { entityType, entityId } = c.req.param();
  const id = parseInt(entityId, 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid entity ID' }, 400);

  const rows = await c.env.DB.prepare(
    `SELECT id, source_type, source_id, target_type, target_id, link_category, notes,
            created_at, created_by
     FROM investigation_links
     WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)
     ORDER BY created_at DESC`
  ).bind(entityType, id, entityType, id).all();

  return c.json({ data: rows.results || [] });
});

app.delete('/links/:id', async (c) => {
  const user = c.var.user;
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid link ID' }, 400);

  const link = await c.env.DB.prepare(
    'SELECT id, source_type, source_id, target_type, target_id, link_category FROM investigation_links WHERE id = ?'
  ).bind(id).first<any>();

  if (!link) return c.json({ error: 'Link not found' }, 404);

  await c.env.DB.prepare('DELETE FROM investigation_links WHERE id = ?').bind(id).run();

  await c.env.DB.prepare(
    `INSERT INTO case_timeline_events (case_id, event_type, summary, metadata, created_by)
     VALUES (?, 'link_removed', ?, ?, ?)`
  ).bind(
    link.source_type === 'case' ? link.source_id : link.target_id,
    `Removed link: ${link.source_type} #${link.source_id} ↔ ${link.target_type} #${link.target_id}`,
    JSON.stringify({ source_type: link.source_type, source_id: link.source_id, target_type: link.target_type, target_id: link.target_id }),
    user?.id || null
  ).run();

  return c.json({ success: true });
});

// ── Case Timeline Events ──
app.get('/cases/:id/timeline', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID' }, 400);

  const rows = await c.env.DB.prepare(
    `SELECT id, event_type, summary, metadata, created_by, created_at
     FROM case_timeline_events
     WHERE case_id = ?
     ORDER BY created_at DESC
     LIMIT 100`
  ).bind(id).all();

  return c.json(rows.results || []);
});

// ── MO Pattern Matching ──
const moCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(100).default('general'),
  attributes: z.any().default({}),
  match_confidence: z.number().min(0).max(1).default(0.5),
});

app.get('/mo/patterns', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM mo_patterns WHERE active = 1 ORDER BY category, name'
  ).all();
  return c.json({ data: rows.results || [] });
});

app.post('/mo/patterns', zValidator('json', moCreateSchema), async (c) => {
  const user = c.var.user;
  const { name, description, category, attributes, match_confidence } = c.req.valid('json');
  const result = await c.env.DB.prepare(
    `INSERT INTO mo_patterns (name, description, category, attributes, match_confidence, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(name, description || null, category, JSON.stringify(attributes), match_confidence, user?.id || null).run();
  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

app.delete('/mo/patterns/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid pattern ID' }, 400);
  await c.env.DB.prepare('UPDATE mo_patterns SET active = 0 WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

app.get('/mo/match/:caseId', async (c) => {
  const caseId = parseInt(c.req.param('caseId'), 10);
  if (!Number.isFinite(caseId) || caseId < 1) return c.json({ error: 'Invalid case ID' }, 400);

  const matches = await c.env.DB.prepare(
    `SELECT cm.*, mp.name as pattern_name, mp.category as pattern_category, mp.description as pattern_description
     FROM case_mo_matches cm
     JOIN mo_patterns mp ON cm.pattern_id = mp.id
     WHERE cm.case_id = ?
     ORDER BY cm.confidence DESC`
  ).bind(caseId).all();

  return c.json({ data: matches.results || [] });
});

export default app;
