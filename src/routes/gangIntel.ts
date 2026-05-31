import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const gangIntel = new Hono<Env>();

gangIntel.get('/', async (c) => {
  try {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM gang_intel_members ORDER BY created_at DESC LIMIT 200');
  return c.json(rows || []);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

gangIntel.post('/', async (c) => {
  try {
  const db = getDb(c.env);
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  const result = await execute(db,
    'INSERT INTO gang_intel_members (name, moniker, gang_name, status, threat_level, notes) VALUES (?, ?, ?, ?, ?, ?)',
    (body.name || (() => { throw new Error("name required"); })()), body.moniker || null, body.gang_name || null, body.status || 'active', body.threat_level || 'low', body.notes || null
  );
  return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

gangIntel.put('/:id', async (c) => {
  try {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  await execute(db,
    'UPDATE gang_intel_members SET name=?, moniker=?, gang_name=?, status=?, threat_level=?, notes=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?',
    (body.name || (() => { throw new Error("name required"); })()), body.moniker || null, body.gang_name || null, body.status || 'active', body.threat_level || 'low', body.notes || null, id
  );
  return c.json({ success: true });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

gangIntel.delete('/:id', async (c) => {
  try {
  const db = getDb(c.env);
  const id = c.req.param('id');
  await execute(db, 'DELETE FROM gang_intel_members WHERE id=?', id);
  return c.json({ success: true });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

gangIntel.get('/gangs', async (c) => {
  try {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM gang_intel_gangs ORDER BY name');
  return c.json(rows || []);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

gangIntel.post('/gangs', async (c) => {
  try {
  const db = getDb(c.env);
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  const result = await execute(db,
    'INSERT INTO gang_intel_gangs (name, colors, member_count, threat_level, territory, notes) VALUES (?, ?, ?, ?, ?, ?)',
    (body.name || (() => { throw new Error("name required"); })()), body.colors || null, body.member_count || 0, body.threat_level || 'low', body.territory || null, body.notes || null
  );
  return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

gangIntel.put('/gangs/:id', async (c) => {
  try {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  await execute(db,
    'UPDATE gang_intel_gangs SET name=?, colors=?, member_count=?, threat_level=?, territory=?, notes=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?',
    (body.name || (() => { throw new Error("name required"); })()), body.colors || null, body.member_count || 0, body.threat_level || 'low', body.territory || null, body.notes || null, id
  );
  return c.json({ success: true });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

gangIntel.delete('/gangs/:id', async (c) => {
  try {
  const db = getDb(c.env);
  const id = c.req.param('id');
  await execute(db, 'DELETE FROM gang_intel_gangs WHERE id=?', id);
  return c.json({ success: true });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

gangIntel.get('/graffiti', async (c) => {
  try {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM gang_graffiti_records ORDER BY created_at DESC LIMIT 200');
  return c.json(rows || []);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

gangIntel.get('/stats', async (c) => {
  try {
  const db = getDb(c.env);
  const total = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM gang_intel_members');
  const active = await queryFirst<{cnt:number}>(db, "SELECT COUNT(*) as cnt FROM gang_intel_members WHERE status = 'active'");
  const gangs = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM gang_intel_gangs');
  return c.json({ totalMembers: total?.cnt || 0, activeMembers: active?.cnt || 0, totalGangs: gangs?.cnt || 0 });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

export default gangIntel;
