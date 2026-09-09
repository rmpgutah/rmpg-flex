import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

import { dbErrorResponse } from '../utils/dbErrors';
const alarms = new Hono<Env>();

// Writes to alarm_accounts (permit records) must be role-gated — previously any
// authenticated user, incl. client_viewer/dispatcher, could create/edit/delete.
function denyWrite(c: any, roles: string[]): boolean {
  const u = c.get('user');
  return !u || !roles.includes(u.role);
}
const WRITE_ROLES = ['admin', 'manager', 'supervisor'];
const DELETE_ROLES = ['admin', 'manager'];

alarms.get('/accounts', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query(db, 'SELECT * FROM alarm_accounts ORDER BY created_at DESC LIMIT 200');
    return c.json(rows || []);
  } catch (err) { return dbErrorResponse(c, err, 'Failed to fetch alarm accounts'); }
});

alarms.post('/accounts', async (c) => {
  try {
    if (denyWrite(c, WRITE_ROLES)) return c.json({ error: 'Insufficient role', code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const body = await c.req.json();
    const result = await execute(db,
      'INSERT INTO alarm_accounts (account_number, account_name, address, contact_name, contact_phone, permit_number, permit_status, permit_expiry, alarm_type, false_alarm_count, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      body.account_number, body.account_name, body.address, body.contact_name || null, body.contact_phone || null, body.permit_number || null, body.permit_status || 'active', body.permit_expiry || null, body.alarm_type || null, body.false_alarm_count || 0, body.status || 'active', body.notes || null
    );
    return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to create alarm account'); }
});

alarms.put('/accounts/:id', async (c) => {
  try {
    if (denyWrite(c, WRITE_ROLES)) return c.json({ error: 'Insufficient role', code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const body = await c.req.json();
    await execute(db,
      'UPDATE alarm_accounts SET account_number=?, account_name=?, address=?, contact_name=?, contact_phone=?, permit_number=?, permit_status=?, permit_expiry=?, alarm_type=?, false_alarm_count=?, status=?, notes=?, updated_at=datetime(\'now\') WHERE id=?',
      body.account_number, body.account_name, body.address, body.contact_name || null, body.contact_phone || null, body.permit_number || null, body.permit_status || 'active', body.permit_expiry || null, body.alarm_type || null, body.false_alarm_count || 0, body.status || 'active', body.notes || null, id
    );
    return c.json({ success: true });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to update alarm account'); }
});

alarms.delete('/accounts/:id', async (c) => {
  try {
    if (denyWrite(c, DELETE_ROLES)) return c.json({ error: 'Insufficient role', code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const result = await execute(db, 'DELETE FROM alarm_accounts WHERE id=?', id);
    if (!result.meta.changes) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to delete alarm account'); }
});

alarms.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const total = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM alarm_accounts');
    const falseAlarms = await queryFirst<{cnt:number}>(db, 'SELECT COALESCE(SUM(false_alarm_count),0) as cnt FROM alarm_accounts');
    const active = await queryFirst<{cnt:number}>(db, "SELECT COUNT(*) as cnt FROM alarm_accounts WHERE permit_status='active'");
    const expired = await queryFirst<{cnt:number}>(db, "SELECT COUNT(*) as cnt FROM alarm_accounts WHERE permit_status='expired'");
    return c.json({
      totalAlarms: total?.cnt || 0,
      falseAlarms: falseAlarms?.cnt || 0,
      permitsActive: active?.cnt || 0,
      permitsExpired: expired?.cnt || 0,
      revenueCollected: 0,
    });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to fetch alarm stats'); }
});

// ─── Compatibility Aliases for Alarm Tracking ──────────────────

alarms.get('/permits', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM alarm_accounts ORDER BY created_at DESC LIMIT 200');
    const mapped = (rows || []).map((r) => ({
      id: r.id,
      permit_number: r.permit_number || r.account_number,
      location_name: r.account_name,
      location_address: r.address,
      alarm_company: r.notes || '',
      contact_name: r.contact_name || '',
      contact_phone: r.contact_phone || '',
      contact_email: '',
      alarm_type: r.alarm_type || 'Burglary',
      status: r.permit_status || 'active',
      false_alarm_count: r.false_alarm_count || 0,
      billing_threshold: 3,
      issued_date: r.created_at,
      expiration_date: r.permit_expiry || '',
      notes: r.notes || '',
      created_at: r.created_at,
      updated_at: r.updated_at || r.created_at,
    }));
    return c.json(mapped);
  } catch (err) { return dbErrorResponse(c, err, 'Failed to fetch alarm permits'); }
});

alarms.post('/permits', async (c) => {
  try {
    if (denyWrite(c, WRITE_ROLES)) return c.json({ error: 'Insufficient role', code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    const acctNum = String(b.permit_number || `ALM-${Date.now().toString().slice(-6)}`);
    const acctName = String(b.location_name || b.account_name || 'Unnamed Alarm');
    const address = String(b.location_address || b.address || 'Unknown Address');
    const result = await execute(db,
      'INSERT INTO alarm_accounts (account_number, account_name, address, contact_name, contact_phone, permit_number, permit_status, permit_expiry, alarm_type, false_alarm_count, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      acctNum, acctName, address, b.contact_name || null, b.contact_phone || null, b.permit_number || acctNum,
      b.status || 'active', b.expiration_date || null, String(b.alarm_type || 'burglary').toLowerCase(),
      0, 'active', b.alarm_company ? `Company: ${b.alarm_company}. ${b.notes || ''}`.trim() : (b.notes || null)
    );
    return c.json({ success: true, id: result.meta.last_row_id }, 201);
  } catch (err) { return dbErrorResponse(c, err, 'Failed to create alarm permit'); }
});

alarms.put('/permits/:id', async (c) => {
  try {
    if (denyWrite(c, WRITE_ROLES)) return c.json({ error: 'Insufficient role', code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const b = await c.req.json<Record<string, unknown>>();
    await execute(db,
      'UPDATE alarm_accounts SET account_name=COALESCE(?, account_name), address=COALESCE(?, address), contact_name=COALESCE(?, contact_name), contact_phone=COALESCE(?, contact_phone), permit_number=COALESCE(?, permit_number), permit_status=COALESCE(?, permit_status), permit_expiry=COALESCE(?, permit_expiry), alarm_type=COALESCE(?, alarm_type), notes=COALESCE(?, notes), updated_at=datetime(\'now\') WHERE id=?',
      b.location_name || b.account_name || null, b.location_address || b.address || null,
      b.contact_name || null, b.contact_phone || null, b.permit_number || null,
      b.status || null, b.expiration_date || null, b.alarm_type ? String(b.alarm_type).toLowerCase() : null,
      b.notes || null, id
    );
    return c.json({ success: true });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to update alarm permit'); }
});

alarms.get('/activations', async (c) => {
  return c.json([]);
});

alarms.get('/permits/:id/activations', async (c) => {
  return c.json([]);
});

alarms.post('/activations', async (c) => {
  if (denyWrite(c, WRITE_ROLES)) return c.json({ error: 'Insufficient role', code: 'FORBIDDEN' }, 403);
  return c.json({ success: true, id: 1 }, 201);
});

export default alarms;
