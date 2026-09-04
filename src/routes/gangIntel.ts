import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';

import { log } from '../utils/logger';
// Mirror CHECK constraints on gang_intel_members (and gang_intel_gangs.threat_level)
// from migrations/0048_specialized_modules.sql. Keep in sync if the migration moves.
const MEMBER_STATUSES = new Set(['active', 'inactive', 'incarcerated', 'deceased']);
const THREAT_LEVELS = new Set(['low', 'medium', 'high', 'critical']);

function checkEnums(body: any): { ok: true } | { ok: false; field: 'status' | 'threat_level' } {
  if (body.status != null && body.status !== '' && !MEMBER_STATUSES.has(body.status)) {
    return { ok: false, field: 'status' };
  }
  if (body.threat_level != null && body.threat_level !== '' && !THREAT_LEVELS.has(body.threat_level)) {
    return { ok: false, field: 'threat_level' };
  }
  return { ok: true };
}

function enumError(field: 'status' | 'threat_level') {
  const allowed = Array.from(field === 'status' ? MEMBER_STATUSES : THREAT_LEVELS);
  return {
    error: `Invalid ${field}`,
    code: field === 'status' ? 'INVALID_STATUS' : 'INVALID_THREAT_LEVEL',
    allowed,
  };
}

const gangIntel = new Hono<Env>();

// Gang intelligence is CJIS-restricted. The sibling intel.ts router gates every
// endpoint with this same `operational` set (admin/manager/supervisor/officer/
// dispatcher) precisely to exclude the external-facing contract_manager and
// client_viewer roles; this router omitted it, so those roles could read (and
// contract_manager could edit) documented gang-member threat records. Restore
// the gate router-wide — reads AND writes.
gangIntel.use('*', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'));

gangIntel.get('/', async (c) => {
  try {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM gang_intel_members ORDER BY created_at DESC LIMIT 200');
  return c.json(rows || []);
  } catch (err) {
    log.error('GET / failed', { src: 'src/routes/gangIntel.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

gangIntel.post('/', async (c) => {
  try {
  const db = getDb(c.env);
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  const v = checkEnums(body);
  if (!v.ok) return c.json(enumError(v.field), 400);
  const result = await execute(db,
    'INSERT INTO gang_intel_members (name, moniker, gang_name, status, threat_level, notes) VALUES (?, ?, ?, ?, ?, ?)',
    (body.name || (() => { throw new Error("name required"); })()), body.moniker || null, body.gang_name || null, body.status || 'active', body.threat_level || 'low', body.notes || null
  );
  return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) { log.error('gangIntel POST / failed', {}, err instanceof Error ? err : new Error(String(err))); return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500); }
});

gangIntel.put('/:id', async (c) => {
  try {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  const v = checkEnums(body);
  if (!v.ok) return c.json(enumError(v.field), 400);
  await execute(db,
    'UPDATE gang_intel_members SET name=?, moniker=?, gang_name=?, status=?, threat_level=?, notes=?, updated_at=datetime(\'now\') WHERE id=?',
    (body.name || (() => { throw new Error("name required"); })()), body.moniker || null, body.gang_name || null, body.status || 'active', body.threat_level || 'low', body.notes || null, id
  );
  return c.json({ success: true });
  } catch (err) { log.error('gangIntel PUT /:id failed', {}, err instanceof Error ? err : new Error(String(err))); return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500); }
});

gangIntel.delete('/:id', requireRole('admin', 'manager', 'supervisor'), async (c) => {
  try {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const result = await execute(db, 'DELETE FROM gang_intel_members WHERE id=?', id);
  if (!result.meta.changes) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /:id failed', { src: 'src/routes/gangIntel.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

gangIntel.get('/gangs', async (c) => {
  try {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM gang_intel_gangs ORDER BY name');
  return c.json(rows || []);
  } catch (err) {
    log.error('GET /gangs failed', { src: 'src/routes/gangIntel.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

gangIntel.post('/gangs', async (c) => {
  try {
  const db = getDb(c.env);
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  if (body.threat_level != null && body.threat_level !== '' && !THREAT_LEVELS.has(body.threat_level)) {
    return c.json(enumError('threat_level'), 400);
  }
  const result = await execute(db,
    'INSERT INTO gang_intel_gangs (name, colors, member_count, threat_level, territory, notes) VALUES (?, ?, ?, ?, ?, ?)',
    (body.name || (() => { throw new Error("name required"); })()), body.colors || null, body.member_count || 0, body.threat_level || 'low', body.territory || null, body.notes || null
  );
  return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) { log.error('gangIntel POST /gangs failed', {}, err instanceof Error ? err : new Error(String(err))); return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500); }
});

gangIntel.put('/gangs/:id', async (c) => {
  try {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
  if (body.threat_level != null && body.threat_level !== '' && !THREAT_LEVELS.has(body.threat_level)) {
    return c.json(enumError('threat_level'), 400);
  }
  await execute(db,
    'UPDATE gang_intel_gangs SET name=?, colors=?, member_count=?, threat_level=?, territory=?, notes=?, updated_at=datetime(\'now\') WHERE id=?',
    (body.name || (() => { throw new Error("name required"); })()), body.colors || null, body.member_count || 0, body.threat_level || 'low', body.territory || null, body.notes || null, id
  );
  return c.json({ success: true });
  } catch (err) { log.error('gangIntel PUT /gangs/:id failed', {}, err instanceof Error ? err : new Error(String(err))); return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500); }
});

gangIntel.delete('/gangs/:id', requireRole('admin', 'manager', 'supervisor'), async (c) => {
  try {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const result = await execute(db, 'DELETE FROM gang_intel_gangs WHERE id=?', id);
  if (!result.meta.changes) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /gangs/:id failed', { src: 'src/routes/gangIntel.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

gangIntel.get('/graffiti', async (c) => {
  try {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM gang_graffiti_records ORDER BY created_at DESC LIMIT 200');
  return c.json(rows || []);
  } catch (err) {
    log.error('GET /graffiti failed', { src: 'src/routes/gangIntel.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

gangIntel.get('/stats', async (c) => {
  try {
  const db = getDb(c.env);
  const total = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM gang_intel_members');
  const active = await queryFirst<{cnt:number}>(db, "SELECT COUNT(*) as cnt FROM gang_intel_members WHERE status = 'active'");
  const gangs = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM gang_intel_gangs');
  return c.json({ totalMembers: total?.cnt || 0, activeMembers: active?.cnt || 0, totalGangs: gangs?.cnt || 0 });
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/gangIntel.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

export default gangIntel;
