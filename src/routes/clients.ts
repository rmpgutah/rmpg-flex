import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

// Clients — backed by the live `clients` table (the same one /api/admin/clients
// reads). The page calls /api/clients directly, so these were stub-returning []
// and the client list showed empty even though rows exist. Real CRUD now.
const clients = new Hono<Env>();

// Columns safe to accept on create/update (avoids letting arbitrary keys through
// and keeps us off NOT-NULL/CHECK landmines — `name` + `status` are validated).
const EDITABLE = [
  'name', 'contact_name', 'contact_email', 'contact_phone', 'address',
  'contract_start', 'contract_end', 'sla_response_minutes', 'status', 'notes',
  'billing_email', 'billing_address', 'contract_type', 'contract_value', 'payment_terms',
  'auto_renew', 'client_code', 'industry', 'website', 'tax_id', 'payment_method',
  'billing_cycle', 'billing_day', 'discount_percent', 'late_fee_percent',
  'account_manager', 'priority_client', 'client_since', 'rate_per_hour',
  'rate_per_incident', 'rate_per_cfs',
];

clients.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const status = c.req.query('status');
    const sql = status
      ? 'SELECT * FROM clients WHERE status = ? ORDER BY name'
      : 'SELECT * FROM clients ORDER BY name';
    return c.json(status ? await query(db, sql, status) : await query(db, sql));
  } catch { return c.json([]); }
});

clients.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const client = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM clients WHERE id = ?', id);
    if (!client) return c.json({}, 404);
    // Hydrate with contracts + linked persons so the detail view is complete.
    const contracts = await query(db, 'SELECT * FROM client_contracts WHERE client_id = ? ORDER BY start_date DESC', id).catch(() => []);
    const persons = await query(db, 'SELECT * FROM client_persons WHERE client_id = ? ORDER BY is_primary DESC, id', id).catch(() => []);
    return c.json({ ...client, contracts, persons });
  } catch { return c.json({}); }
});

clients.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, any>>();
    if (!b.name || !String(b.name).trim()) return c.json({ error: 'name required' }, 400);
    const status = b.status === 'inactive' ? 'inactive' : 'active'; // honor CHECK constraint
    const cols = ['name', 'status']; const vals: unknown[] = [String(b.name).trim(), status];
    for (const k of EDITABLE) {
      if (k === 'name' || k === 'status') continue;
      if (k in b) { cols.push(k); vals.push(b[k]); }
    }
    const ph = cols.map(() => '?').join(',');
    const r = await execute(db, `INSERT INTO clients (${cols.join(',')}) VALUES (${ph})`, ...vals);
    return c.json(await queryFirst(db, 'SELECT * FROM clients WHERE id = ?', r.meta.last_row_id), 201);
  } catch (e) { return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

clients.put('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const b = await c.req.json<Record<string, any>>();
    const setCols: string[] = []; const vals: unknown[] = [];
    for (const k of EDITABLE) {
      if (!(k in b)) continue;
      if (k === 'status' && b[k] !== 'active' && b[k] !== 'inactive') continue; // CHECK guard
      setCols.push(`${k} = ?`); vals.push(b[k]);
    }
    if (!setCols.length) return c.json({ error: 'No fields to update' }, 400);
    setCols.push("updated_at = datetime('now')");
    vals.push(id);
    await execute(db, `UPDATE clients SET ${setCols.join(', ')} WHERE id = ?`, ...vals);
    return c.json(await queryFirst(db, 'SELECT * FROM clients WHERE id = ?', id));
  } catch (e) { return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

clients.delete('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    // Soft-delete: flip to inactive rather than orphaning contracts/persons.
    await execute(db, "UPDATE clients SET status = 'inactive', updated_at = datetime('now') WHERE id = ?", id);
    return c.json({ success: true });
  } catch (e) { return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

export default clients;
