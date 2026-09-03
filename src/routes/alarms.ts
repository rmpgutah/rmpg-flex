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

export default alarms;
