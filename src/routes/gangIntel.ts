import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const gangIntel = new Hono<Env>();

gangIntel.get('/', async (c) => {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM gang_intel_members ORDER BY created_at DESC LIMIT 200');
  return c.json(rows || []);
});

gangIntel.post('/', async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json();
  const result = await execute(db,
    'INSERT INTO gang_intel_members (name, moniker, gang_name, status, threat_level, notes) VALUES (?, ?, ?, ?, ?, ?)',
    body.name, body.moniker || null, body.gang_name || null, body.status || 'active', body.threat_level || 'low', body.notes || null
  );
  return c.json({ success: true, id: result.meta.last_row_id });
});

gangIntel.put('/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const body = await c.req.json();
  await execute(db,
    'UPDATE gang_intel_members SET name=?, moniker=?, gang_name=?, status=?, threat_level=?, notes=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?',
    body.name, body.moniker || null, body.gang_name || null, body.status || 'active', body.threat_level || 'low', body.notes || null, id
  );
  return c.json({ success: true });
});

gangIntel.delete('/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  await execute(db, 'DELETE FROM gang_intel_members WHERE id=?', id);
  return c.json({ success: true });
});

gangIntel.get('/gangs', async (c) => {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM gang_intel_gangs ORDER BY name');
  return c.json(rows || []);
});

gangIntel.post('/gangs', async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json();
  const result = await execute(db,
    'INSERT INTO gang_intel_gangs (name, colors, member_count, threat_level, territory, notes) VALUES (?, ?, ?, ?, ?, ?)',
    body.name, body.colors || null, body.member_count || 0, body.threat_level || 'low', body.territory || null, body.notes || null
  );
  return c.json({ success: true, id: result.meta.last_row_id });
});

gangIntel.put('/gangs/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const body = await c.req.json();
  await execute(db,
    'UPDATE gang_intel_gangs SET name=?, colors=?, member_count=?, threat_level=?, territory=?, notes=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?',
    body.name, body.colors || null, body.member_count || 0, body.threat_level || 'low', body.territory || null, body.notes || null, id
  );
  return c.json({ success: true });
});

gangIntel.delete('/gangs/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  await execute(db, 'DELETE FROM gang_intel_gangs WHERE id=?', id);
  return c.json({ success: true });
});

gangIntel.get('/graffiti', async (c) => {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM gang_graffiti_records ORDER BY created_at DESC LIMIT 200');
  return c.json(rows || []);
});

gangIntel.get('/stats', async (c) => {
  const db = getDb(c.env);
  const total = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM gang_intel_members');
  const active = await queryFirst<{cnt:number}>(db, "SELECT COUNT(*) as cnt FROM gang_intel_members WHERE status = 'active'");
  const gangs = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM gang_intel_gangs');
  return c.json({ totalMembers: total?.cnt || 0, activeMembers: active?.cnt || 0, totalGangs: gangs?.cnt || 0 });
});

export default gangIntel;
