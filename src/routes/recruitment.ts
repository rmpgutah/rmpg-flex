import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';
const recruitment = new Hono<Env>();

const MANAGER_ROLES = ['admin', 'manager', 'supervisor', 'human_resources'] as const;

recruitment.get('/candidates', async (c) => {
  try {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM recruitment_candidates ORDER BY created_at DESC LIMIT 200');
  return c.json(rows || []);
  } catch (err) {
    log.error('GET /candidates failed', { src: 'src/routes/recruitment.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

recruitment.get('/candidates/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM recruitment_candidates WHERE id=?', id);
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  } catch (err) {
    log.error('GET /candidates/:id failed', { src: 'src/routes/recruitment.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

recruitment.post('/candidates', requireRole(...MANAGER_ROLES), async (c) => {
  try {
  const db = getDb(c.env);
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  const result = await execute(db,
    'INSERT INTO recruitment_candidates (candidate_name, email, phone, position, stage, applied_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    (body.candidate_name || (() => { throw new Error("candidate_name required"); })()), body.email || null, body.phone || null, body.position || null, body.stage || 'applied', body.applied_date || new Date().toISOString().slice(0, 10), body.notes || null
  );
  return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) {
    log.error('POST /candidates failed', { src: 'src/routes/recruitment.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

recruitment.put('/candidates/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  await execute(db,
    'UPDATE recruitment_candidates SET candidate_name=?, email=?, phone=?, position=?, stage=?, applied_date=?, notes=?, updated_at=datetime(\'now\') WHERE id=?',
    (body.candidate_name || (() => { throw new Error("candidate_name required"); })()), body.email || null, body.phone || null, body.position || null, body.stage || 'applied', body.applied_date || null, body.notes || null, id
  );
  return c.json({ success: true });
  } catch (err) {
    log.error('PUT /candidates/:id failed', { src: 'src/routes/recruitment.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

recruitment.delete('/candidates/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
  const db = getDb(c.env);
  const id = c.req.param('id');
  await execute(db, 'DELETE FROM recruitment_candidates WHERE id=?', id);
  return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /candidates/:id failed', { src: 'src/routes/recruitment.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

recruitment.get('/stats', async (c) => {
  try {
  const db = getDb(c.env);
  const total = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM recruitment_candidates');
  const inProcess = await queryFirst<{cnt:number}>(db, "SELECT COUNT(*) as cnt FROM recruitment_candidates WHERE stage NOT IN ('hired','rejected','withdrawn')");
  const hired = await queryFirst<{cnt:number}>(db, "SELECT COUNT(*) as cnt FROM recruitment_candidates WHERE stage='hired'");
  return c.json({
    applicants: total?.cnt || 0,
    inProcess: inProcess?.cnt || 0,
    hired: hired?.cnt || 0,
    academyClasses: 0,
  });
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/recruitment.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

export default recruitment;
