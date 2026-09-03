import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';

const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'officer'] as const;
const DELETE_ROLES = ['admin', 'manager', 'supervisor'] as const;

const specialOps = new Hono<Env>();

specialOps.get('/callouts', async (c) => {
  try {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM special_ops_callouts ORDER BY date DESC LIMIT 100');
  return c.json(rows || []);
  } catch (err) {
    log.error('GET /callouts failed', { src: 'src/routes/specialOps.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

specialOps.post('/callouts', requireRole(...WRITE_ROLES), async (c) => {
  try {
  const db = getDb(c.env);
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  const result = await execute(db,
    'INSERT INTO special_ops_callouts (date, call_type, location, resolution, duration_minutes, team_size, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    body.date || new Date().toISOString(), body.call_type, body.location || null, body.resolution || null, body.duration_minutes || null, body.team_size || null, body.notes || null
  );
  return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) {
    log.error('POST /callouts failed', { src: 'src/routes/specialOps.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

specialOps.put('/callouts/:id', requireRole(...WRITE_ROLES), async (c) => {
  try {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  await execute(db,
    'UPDATE special_ops_callouts SET date=?, call_type=?, location=?, resolution=?, duration_minutes=?, team_size=?, notes=? WHERE id=?',
    body.date, body.call_type, body.location || null, body.resolution || null, body.duration_minutes || null, body.team_size || null, body.notes || null, id
  );
  return c.json({ success: true });
  } catch (err) {
    log.error('PUT /callouts/:id failed', { src: 'src/routes/specialOps.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

specialOps.delete('/callouts/:id', requireRole(...DELETE_ROLES), async (c) => {
  try {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const result = await execute(db, 'DELETE FROM special_ops_callouts WHERE id=?', id);
  if (!result.meta.changes) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /callouts/:id failed', { src: 'src/routes/specialOps.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

specialOps.get('/equipment', async (c) => {
  try {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM special_ops_equipment ORDER BY equipment_type');
  return c.json(rows || []);
  } catch (err) {
    log.error('GET /equipment failed', { src: 'src/routes/specialOps.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

specialOps.post('/equipment', requireRole(...WRITE_ROLES), async (c) => {
  try {
  const db = getDb(c.env);
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  const result = await execute(db,
    'INSERT INTO special_ops_equipment (equipment_type, serial_number, condition, assigned_to, notes) VALUES (?, ?, ?, ?, ?)',
    body.equipment_type, body.serial_number || null, body.condition || 'ready', body.assigned_to || null, body.notes || null
  );
  return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) {
    log.error('POST /equipment failed', { src: 'src/routes/specialOps.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

specialOps.put('/equipment/:id', requireRole(...WRITE_ROLES), async (c) => {
  try {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  await execute(db,
    'UPDATE special_ops_equipment SET equipment_type=?, serial_number=?, condition=?, assigned_to=?, notes=?, updated_at=datetime(\'now\') WHERE id=?',
    body.equipment_type, body.serial_number || null, body.condition || 'ready', body.assigned_to || null, body.notes || null, id
  );
  return c.json({ success: true });
  } catch (err) {
    log.error('PUT /equipment/:id failed', { src: 'src/routes/specialOps.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

specialOps.delete('/equipment/:id', requireRole(...DELETE_ROLES), async (c) => {
  try {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const result = await execute(db, 'DELETE FROM special_ops_equipment WHERE id=?', id);
  if (!result.meta.changes) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /equipment/:id failed', { src: 'src/routes/specialOps.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

specialOps.get('/stats', async (c) => {
  try {
  const db = getDb(c.env);
  const total = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM special_ops_callouts');
  const equipment = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM special_ops_equipment');
  const ready = await queryFirst<{cnt:number}>(db, "SELECT COUNT(*) as cnt FROM special_ops_equipment WHERE condition='ready'");
  return c.json({ totalCallouts: total?.cnt || 0, totalEquipment: equipment?.cnt || 0, readyEquipment: ready?.cnt || 0 });
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/specialOps.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

export default specialOps;
