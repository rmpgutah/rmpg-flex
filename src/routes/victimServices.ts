import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const victimServices = new Hono<Env>();

victimServices.get('/victims', async (c) => {
  try {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM victim_services_records ORDER BY created_at DESC LIMIT 200');
  return c.json(rows || []);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

victimServices.post('/victims', async (c) => {
  try {
  const db = getDb(c.env);
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  const result = await execute(db,
    'INSERT INTO victim_services_records (victim_name, case_number, crime_type, status, advocate_id, phone, email, address, safety_plan, protective_order, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    body.victim_name, (body.case_number || (() => { throw new Error("case_number required"); })()) || null, body.crime_type || null, body.status || 'active', body.advocate_id || null, body.phone || null, body.email || null, body.address || null, body.safety_plan || 0, body.protective_order || 0, body.notes || null
  );
  return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

victimServices.put('/victims/:id', async (c) => {
  try {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  await execute(db,
    'UPDATE victim_services_records SET victim_name=?, case_number=?, crime_type=?, status=?, advocate_id=?, phone=?, email=?, address=?, safety_plan=?, protective_order=?, notes=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?',
    body.victim_name, (body.case_number || (() => { throw new Error("case_number required"); })()) || null, body.crime_type || null, body.status || 'active', body.advocate_id || null, body.phone || null, body.email || null, body.address || null, body.safety_plan || 0, body.protective_order || 0, body.notes || null, id
  );
  return c.json({ success: true });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

victimServices.delete('/victims/:id', async (c) => {
  try {
  const db = getDb(c.env);
  const id = c.req.param('id');
  await execute(db, 'DELETE FROM victim_services_records WHERE id=?', id);
  return c.json({ success: true });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

victimServices.get('/stats', async (c) => {
  try {
  const db = getDb(c.env);
  const total = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM victim_services_records');
  const active = await queryFirst<{cnt:number}>(db, "SELECT COUNT(*) as cnt FROM victim_services_records WHERE status='active'");
  const safety = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM victim_services_records WHERE safety_plan=1');
  return c.json({ totalVictims: total?.cnt || 0, activeVictims: active?.cnt || 0, safetyPlans: safety?.cnt || 0 });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

export default victimServices;
