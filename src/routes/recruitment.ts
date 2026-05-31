import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const recruitment = new Hono<Env>();

recruitment.get('/candidates', async (c) => {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM recruitment_candidates ORDER BY created_at DESC LIMIT 200');
  return c.json(rows || []);
});

recruitment.post('/candidates', async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json();
  const result = await execute(db,
    'INSERT INTO recruitment_candidates (candidate_name, email, phone, position, stage, applied_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    body.candidate_name, body.email || null, body.phone || null, body.position || null, body.stage || 'applied', body.applied_date || new Date().toISOString().slice(0, 10), body.notes || null
  );
  return c.json({ success: true, id: result.meta.last_row_id });
});

recruitment.put('/candidates/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const body = await c.req.json();
  await execute(db,
    'UPDATE recruitment_candidates SET candidate_name=?, email=?, phone=?, position=?, stage=?, applied_date=?, notes=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?',
    body.candidate_name, body.email || null, body.phone || null, body.position || null, body.stage || 'applied', body.applied_date, body.notes || null, id
  );
  return c.json({ success: true });
});

recruitment.delete('/candidates/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  await execute(db, 'DELETE FROM recruitment_candidates WHERE id=?', id);
  return c.json({ success: true });
});

recruitment.get('/stats', async (c) => {
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
});

export default recruitment;
