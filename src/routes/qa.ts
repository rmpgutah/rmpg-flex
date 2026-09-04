// ============================================================
// RMPG Flex — Quality Assurance
// ============================================================
// Spillman Flex QA parity: reviews, criteria, scores,
// customer satisfaction surveys.
// Migration: 0047_spillman_modules.sql
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

import { log } from '../utils/logger';
const qa = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

async function generateReviewNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `QA-${yy}-`;
  const last = await queryFirst<{ review_number: string }>(
    db, 'SELECT review_number FROM qa_reviews WHERE review_number LIKE ? ORDER BY id DESC LIMIT 1', `${prefix}%`);
  let nextNum = 1;
  if (last?.review_number) {
    const m = last.review_number.match(/^QA-\d{2}-(\d+)$/);
    if (m) nextNum = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

// ═══════════════════════════════════════════════════════════════
// REVIEWS
// ═══════════════════════════════════════════════════════════════

qa.get('/reviews', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const tableCheck = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='qa_reviews'");
    if (!tableCheck?.n) return c.json({ data: [], pagination: { page: 1, per_page: 50, total: 0, totalPages: 0 } });
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('status')) { conditions.push('r.status = ?'); params.push(q('status')); }
    if (q('type')) { conditions.push('r.review_type = ?'); params.push(q('type')); }
    if (q('reviewer_id')) { conditions.push('r.reviewer_id = ?'); params.push(q('reviewer_id')); }
    if (q('officer_id')) { conditions.push('r.reviewed_officer_id = ?'); params.push(q('officer_id')); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(q('per_page') || '50', 10) || 50));
    const offset = (page - 1) * perPage;
    const count = await queryFirst<{ total: number }>(db, `SELECT COUNT(*) as total FROM qa_reviews r ${where}`, ...params);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT r.*, rev.full_name as reviewer_name, off.full_name as reviewed_officer_name
       FROM qa_reviews r LEFT JOIN users rev ON r.reviewer_id = rev.id LEFT JOIN users off ON r.reviewed_officer_id = off.id
       ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, ...params, perPage, offset);
    const total = count?.total ?? 0;
    return c.json({ data: rows, pagination: { page, per_page: perPage, total, totalPages: Math.ceil(total / perPage) } });
  } catch (err) {
    log.error('GET /reviews failed', { src: 'src/routes/qa.ts' }, err);
    return c.json({ error: 'Failed to list reviews' }, 500);
  }
});

qa.post('/reviews', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.review_type !== 'string') return c.json({ error: 'review_type required' }, 400);
    const reviewNumber = await generateReviewNumber(db);
    const result = await execute(db,
      `INSERT INTO qa_reviews (review_number, review_type, entity_type, entity_id, reviewer_id, reviewed_officer_id, status, review_date, findings, recommendations)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      reviewNumber, b.review_type, b.entity_type ?? null, b.entity_id ?? null, userId, b.reviewed_officer_id ?? null,
      'pending', b.review_date ?? null, b.findings ?? null, b.recommendations ?? null);
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM qa_reviews WHERE id = ?', newId);
    return c.json({ data: created, review_number: reviewNumber }, 201);
  } catch (err) {
    log.error('POST /reviews failed', { src: 'src/routes/qa.ts' }, err);
    return c.json({ error: 'Failed to create review' }, 500);
  }
});

const REVIEW_UPDATABLE = new Set(['review_type','entity_type','entity_id','reviewed_officer_id','score','max_score','status','review_date','findings','recommendations']);

qa.put('/reviews/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (REVIEW_UPDATABLE.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    sets.push(`updated_at = datetime('now')`); vals.push(id); // UTC storage standard
    await execute(db, `UPDATE qa_reviews SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM qa_reviews WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /reviews/:id failed', { src: 'src/routes/qa.ts' }, err);
    return c.json({ error: 'Failed to update review' }, 500);
  }
});

qa.delete('/reviews/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    await execute(db, 'DELETE FROM qa_scores WHERE review_id = ?', id);
    const result = await execute(db, 'DELETE FROM qa_reviews WHERE id = ?', id);
    if (result.meta.changes === 0) return c.json({ error: 'Review not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /reviews/:id failed', { src: 'src/routes/qa.ts' }, err);
    return c.json({ error: 'Failed to delete review', code: 'DELETE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// CRITERIA
// ═══════════════════════════════════════════════════════════════

qa.get('/criteria', async (c) => {
  try {
    const db = getDb(c.env);
    const type = c.req.query('review_type');
    let where = 'is_active = 1'; const params: unknown[] = [];
    if (type) { where += ' AND review_type = ?'; params.push(type); }
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM qa_criteria WHERE ${where} ORDER BY sort_order, id`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /criteria failed', { src: 'src/routes/qa.ts' }, err);
    return c.json({ error: 'Failed to list criteria' }, 500);
  }
});

qa.post('/criteria', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.review_type !== 'string') return c.json({ error: 'review_type required' }, 400);
    if (typeof b.criterion !== 'string') return c.json({ error: 'criterion required' }, 400);
    const result = await execute(db,
      `INSERT INTO qa_criteria (review_type, criterion, description, max_points, weight, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      b.review_type, b.criterion, b.description ?? null, b.max_points ?? 5, b.weight ?? 1, b.sort_order ?? 0);
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM qa_criteria WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /criteria failed', { src: 'src/routes/qa.ts' }, err);
    return c.json({ error: 'Failed to create criterion' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// SCORES (per-criterion scores for a review)
// ═══════════════════════════════════════════════════════════════

qa.get('/reviews/:id/scores', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const rows = await query<Record<string, unknown>>(db,
      'SELECT qs.*, qc.criterion, qc.max_points FROM qa_scores qs LEFT JOIN qa_criteria qc ON qs.criterion_id = qc.id WHERE qs.review_id = ? ORDER BY qc.sort_order', id);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /reviews/:id/scores failed', { src: 'src/routes/qa.ts' }, err);
    return c.json({ error: 'Failed to list scores' }, 500);
  }
});

qa.post('/reviews/:id/scores', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const reviewId = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const scores = Array.isArray(b.scores) ? b.scores as Array<Record<string, unknown>> : [b];
    let totalScore = 0; let totalMax = 0;
    for (const s of scores) {
      if (!s.criterion_id || s.score === undefined) continue;
      await execute(db,
        'INSERT INTO qa_scores (review_id, criterion_id, score, notes) VALUES (?, ?, ?, ?)',
        reviewId, s.criterion_id, s.score, s.notes ?? null);
      const crit = await queryFirst<{ max_points: number }>(db, 'SELECT max_points FROM qa_criteria WHERE id = ?', s.criterion_id);
      totalScore += Number(s.score);
      totalMax += crit?.max_points ?? 0;
    }
    if (totalMax > 0) {
      const pct = Math.round((totalScore / totalMax) * 100);
      await execute(db, 'UPDATE qa_reviews SET score = ?, max_score = ? WHERE id = ?', pct, 100, reviewId);
    }
    return c.json({ success: true, added: scores.length, total_score: totalScore, max_possible: totalMax });
  } catch (err) {
    log.error('POST /reviews/:id/scores failed', { src: 'src/routes/qa.ts' }, err);
    return c.json({ error: 'Failed to record scores' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// CUSTOMER SATISFACTION SURVEYS
// ═══════════════════════════════════════════════════════════════

qa.get('/surveys', async (c) => {
  try {
    const db = getDb(c.env);
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const perPage = 50;
    const offset = (page - 1) * perPage;
    const rows = await query<Record<string, unknown>>(db,
      'SELECT * FROM customer_satisfaction_surveys ORDER BY submitted_at DESC LIMIT ? OFFSET ?', perPage, offset);
    return c.json({ data: rows, pagination: { page, per_page: perPage } });
  } catch (err) {
    log.error('GET /surveys failed', { src: 'src/routes/qa.ts' }, err);
    return c.json({ error: 'Failed to list surveys' }, 500);
  }
});

qa.post('/surveys', async (c) => {
  // Public endpoint — no auth for public surveys
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.rating !== 'number' || b.rating < 1 || b.rating > 5) return c.json({ error: 'rating required (1-5)' }, 400);
    const result = await execute(db,
      `INSERT INTO customer_satisfaction_surveys (survey_type, entity_id, respondent_name, respondent_contact, rating, comments, would_recommend)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      b.survey_type ?? 'officer_interaction', b.entity_id ?? null, b.respondent_name ?? null, b.respondent_contact ?? null,
      b.rating, b.comments ?? null, b.would_recommend ?? null);
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM customer_satisfaction_surveys WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /surveys failed', { src: 'src/routes/qa.ts' }, err);
    return c.json({ error: 'Failed to submit survey' }, 500);
  }
});

qa.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const reviewTable = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='qa_reviews'");
    if (!reviewTable?.n) return c.json({ total_reviews: 0, completed_reviews: 0, avg_score: 0, pass_rate: 0, by_category: [], recent_scores: [] });
    const totalReviews = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM qa_reviews'))?.count ?? 0;
    const avgScore = (await queryFirst<{ avg: number }>(db, 'SELECT ROUND(AVG(score),1) as avg FROM qa_reviews WHERE score IS NOT NULL'))?.avg ?? 0;
    const avgRating = (await queryFirst<{ avg: number }>(db, 'SELECT ROUND(AVG(rating),1) as avg FROM customer_satisfaction_surveys'))?.avg ?? 0;
    const surveyCount = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM customer_satisfaction_surveys'))?.count ?? 0;
    return c.json({ total_reviews: totalReviews, avg_review_score: avgScore, avg_survey_rating: avgRating, total_surveys: surveyCount });
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/qa.ts' }, err);
    return c.json({ error: 'Failed to load stats' }, 500);
  }
});

export default qa;
