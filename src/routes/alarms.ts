import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const alarms = new Hono<Env>();

alarms.get('/accounts', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query(db, 'SELECT * FROM alarm_accounts ORDER BY created_at DESC LIMIT 200');
    return c.json(rows || []);
  } catch (err) { return c.json({ error: 'Failed to fetch alarm accounts', detail: (err as Error)?.message }, 500); }
});

alarms.post('/accounts', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json();
    const result = await execute(db,
      'INSERT INTO alarm_accounts (account_number, account_name, address, contact_name, contact_phone, permit_number, permit_status, permit_expiry, alarm_type, false_alarm_count, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      body.account_number, body.account_name, body.address, body.contact_name || null, body.contact_phone || null, body.permit_number || null, body.permit_status || 'active', body.permit_expiry || null, body.alarm_type || null, body.false_alarm_count || 0, body.status || 'active', body.notes || null
    );
    return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) { return c.json({ error: 'Failed to create alarm account', detail: (err as Error)?.message }, 500); }
});

alarms.put('/accounts/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const body = await c.req.json();
    await execute(db,
      'UPDATE alarm_accounts SET account_number=?, account_name=?, address=?, contact_name=?, contact_phone=?, permit_number=?, permit_status=?, permit_expiry=?, alarm_type=?, false_alarm_count=?, status=?, notes=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?',
      body.account_number, body.account_name, body.address, body.contact_name || null, body.contact_phone || null, body.permit_number || null, body.permit_status || 'active', body.permit_expiry || null, body.alarm_type || null, body.false_alarm_count || 0, body.status || 'active', body.notes || null, id
    );
    return c.json({ success: true });
  } catch (err) { return c.json({ error: 'Failed to update alarm account', detail: (err as Error)?.message }, 500); }
});

alarms.delete('/accounts/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    await execute(db, 'DELETE FROM alarm_accounts WHERE id=?', id);
    return c.json({ success: true });
  } catch (err) { return c.json({ error: 'Failed to delete alarm account', detail: (err as Error)?.message }, 500); }
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
  } catch (err) { return c.json({ error: 'Failed to fetch alarm stats', detail: (err as Error)?.message }, 500); }
});

export default alarms;
