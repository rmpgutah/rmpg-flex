import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

import { log } from '../utils/logger';
const victimServices = new Hono<Env>();

// victim_services_records holds victim name, phone, email, HOME ADDRESS,
// safety_plan and protective_order flags, plus advocate notes. Only DELETE
// was gated, so every other role — including the external-facing
// contract_manager and client_viewer — could read and silently rewrite these
// rows. For a protective-order subject, an address leak here is a physical
// safety issue, so reads are restricted to sworn/advocacy roles and writes
// to the supervisory set.
const VS_READ_ROLES = ['admin', 'manager', 'supervisor', 'officer'];
const VS_WRITE_ROLES = ['admin', 'manager', 'supervisor'];

function forbidUnlessRole(c: any, roles: string[]): Response | null {
  const actor = c.get('user') as { role?: string } | undefined;
  if (!actor?.role || !roles.includes(actor.role)) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  return null;
}

victimServices.get('/victims', async (c) => {
  const denied = forbidUnlessRole(c, VS_READ_ROLES);
  if (denied) return denied;
  try {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM victim_services_records ORDER BY created_at DESC LIMIT 200');
  return c.json(rows || []);
  } catch (err) {
    log.error('GET /victims failed', { src: 'src/routes/victimServices.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

victimServices.post('/victims', async (c) => {
  const denied = forbidUnlessRole(c, VS_WRITE_ROLES);
  if (denied) return denied;
  try {
  const db = getDb(c.env);
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
    if (!body.case_number) return c.json({ error: 'case_number required' }, 400);
  const result = await execute(db,
    'INSERT INTO victim_services_records (victim_name, case_number, crime_type, status, advocate_id, phone, email, address, safety_plan, protective_order, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    body.victim_name, body.case_number, body.crime_type || null, body.status || 'active', body.advocate_id || null, body.phone || null, body.email || null, body.address || null, body.safety_plan || 0, body.protective_order || 0, body.notes || null
  );
  return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) {
    log.error('POST /victims failed', { src: 'src/routes/victimServices.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

victimServices.put('/victims/:id', async (c) => {
  const denied = forbidUnlessRole(c, VS_WRITE_ROLES);
  if (denied) return denied;
  try {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
    if (!body.case_number) return c.json({ error: 'case_number required' }, 400);
  await execute(db,
    'UPDATE victim_services_records SET victim_name=?, case_number=?, crime_type=?, status=?, advocate_id=?, phone=?, email=?, address=?, safety_plan=?, protective_order=?, notes=?, updated_at=datetime(\'now\') WHERE id=?',
    body.victim_name, body.case_number, body.crime_type || null, body.status || 'active', body.advocate_id || null, body.phone || null, body.email || null, body.address || null, body.safety_plan || 0, body.protective_order || 0, body.notes || null, id
  );
  return c.json({ success: true });
  } catch (err) {
    log.error('PUT /victims/:id failed', { src: 'src/routes/victimServices.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

victimServices.delete('/victims/:id', async (c) => {
  try {
  const actor = c.get('user') as { role: string } | undefined;
  if (!actor || !new Set(['admin', 'manager']).has(actor.role)) return c.json({ error: 'Forbidden' }, 403);
  const db = getDb(c.env);
  const id = c.req.param('id');
  await execute(db, 'DELETE FROM victim_services_records WHERE id=?', id);
  return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /victims/:id failed', { src: 'src/routes/victimServices.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

victimServices.get('/stats', async (c) => {
  const denied = forbidUnlessRole(c, VS_READ_ROLES);
  if (denied) return denied;
  try {
  const db = getDb(c.env);
  const total = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM victim_services_records');
  const active = await queryFirst<{cnt:number}>(db, "SELECT COUNT(*) as cnt FROM victim_services_records WHERE status='active'");
  const safety = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM victim_services_records WHERE safety_plan=1');
  return c.json({ totalVictims: total?.cnt || 0, activeVictims: active?.cnt || 0, safetyPlans: safety?.cnt || 0 });
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/victimServices.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

export default victimServices;
