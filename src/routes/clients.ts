import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

import { log } from '../utils/logger';
// Clients — backed by the live `clients` table (the same one /api/admin/clients
// reads). The page calls /api/clients directly, so these were stub-returning []
// and the client list showed empty even though rows exist. Real CRUD now.
const clients = new Hono<Env>();

// This router is a PARALLEL door into the exact `clients` table that
// /api/admin/clients was hardened to protect: there is no tenancy column on
// `users`, so nothing scopes a client-side account to its OWN client, and any
// external-facing role (contract_manager, client_viewer) could otherwise read
// every client's negotiated rates or rewrite another client's billing.
// Previously POST/PUT had NO role check (readOnlyRoleGuard blocks only
// client_viewer from writes) and the GETs returned `SELECT *` incl.
// rate_per_hour / contract_value / rate_per_cfs to every role. Mirror the
// admin router: writes are internal-supervisory-only; reads exclude the
// external roles and redact commercial terms for everyone below full access.
const CLIENT_FULL_ROLES = new Set(['admin', 'manager', 'supervisor']);
// Roles that may see a client at all (a dispatcher needs the name/address of
// the client tied to a call; officers see it on the dispatch detail panel).
const CLIENT_READ_ROLES = new Set(['admin', 'manager', 'supervisor', 'officer', 'dispatcher']);

// Commercial/PII columns stripped from a read unless the caller is full-access.
const CLIENT_FINANCIAL_COLS = new Set([
  'contract_value', 'rate_per_hour', 'rate_per_incident', 'rate_per_cfs',
  'discount_percent', 'late_fee_percent', 'payment_terms', 'payment_method',
  'billing_email', 'billing_address', 'billing_cycle', 'billing_day',
  'total_invoiced', 'total_paid', 'outstanding_balance', 'tax_id', 'account_manager',
]);

function forbidUnlessRole(c: any, roles: Set<string>): Response | null {
  const actor = c.get('user') as { role?: string } | undefined;
  if (!actor?.role || !roles.has(actor.role)) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  return null;
}

function isFullClientAccess(c: any): boolean {
  const actor = c.get('user') as { role?: string } | undefined;
  return !!actor?.role && CLIENT_FULL_ROLES.has(actor.role);
}

// Drop financial keys from a client row (or array of rows) for non-full roles.
function redactClient<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row };
  for (const k of CLIENT_FINANCIAL_COLS) delete (out as Record<string, unknown>)[k];
  return out;
}

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
  const denied = forbidUnlessRole(c, CLIENT_READ_ROLES);
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const status = c.req.query('status');
    const sql = status
      ? 'SELECT * FROM clients WHERE status = ? ORDER BY name'
      : 'SELECT * FROM clients ORDER BY name';
    const rows = status ? await query<Record<string, unknown>>(db, sql, status) : await query<Record<string, unknown>>(db, sql);
    return c.json(isFullClientAccess(c) ? rows : rows.map(redactClient));
  } catch (err) { log.error('GET failed', { src: 'src/routes/clients.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

clients.get('/:id', async (c) => {
  const denied = forbidUnlessRole(c, CLIENT_READ_ROLES);
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const client = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM clients WHERE id = ?', id);
    if (!client) return c.json({}, 404);
    // Hydrate with contracts + linked persons so the detail view is complete.
    const contracts = await query(db, 'SELECT * FROM client_contracts WHERE client_id = ? ORDER BY start_date DESC', id).catch(() => []);
    const persons = await query(db, 'SELECT * FROM client_persons WHERE client_id = ? ORDER BY is_primary DESC, id', id).catch(() => []);
    const full = isFullClientAccess(c);
    // Contracts carry rate/value terms too, so they ride the same gate.
    return c.json({ ...(full ? client : redactClient(client)), contracts: full ? contracts : [], persons });
  } catch (err) { log.error('GET failed', { src: 'src/routes/clients.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

clients.post('/', async (c) => {
  const denied = forbidUnlessRole(c, CLIENT_FULL_ROLES);
  if (denied) return denied;
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
  } catch (e) {
    log.error('POST / failed', { src: 'src/routes/clients.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

clients.put('/:id', async (c) => {
  const denied = forbidUnlessRole(c, CLIENT_FULL_ROLES);
  if (denied) return denied;
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
  } catch (e) {
    log.error('PUT /:id failed', { src: 'src/routes/clients.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

clients.delete('/:id', async (c) => {
  try {
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || !new Set(['admin', 'manager']).has(actor.role)) return c.json({ error: 'Forbidden' }, 403);
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    // Soft-delete: flip to inactive rather than orphaning contracts/persons.
    await execute(db, "UPDATE clients SET status = 'inactive', updated_at = datetime('now') WHERE id = ?", id);
    return c.json({ success: true });
  } catch (e) {
    log.error('DELETE /:id failed', { src: 'src/routes/clients.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

export default clients;
