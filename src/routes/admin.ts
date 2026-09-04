import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, executeInChunks } from '../utils/db';
import { fireRule, type NotificationRuleRow } from './notificationEngine';
import { getAnthropicKey, getClaudeModel, callClaude, diagnoseAnthropicError } from '../utils/anthropic';
import { getOpenAiKey, getOpenAiModel, callOpenAi, diagnoseOpenAiError } from '../utils/openai';
import { denverNowDateExpr, denverHourExpr, denverStrftimeExpr } from '../utils/denverTime';
import { ACTIVE_CALL_WHERE } from '../utils/callStatus';
import { mergeDispositions, isDispositionRow, type DispositionConfigRow } from '../utils/dispositionConfig';

import { log } from '../utils/logger';
import { recordAudit } from '../utils/auditLog';
import { parseUserAgentLabel } from '../utils/userAgent';
import { getUserGraphToken } from '../utils/userGraphTokens';
const admin = new Hono<Env>();

// Admin mutations are reachable by any authenticated user once authMiddleware
// passes (it verifies the JWT but does NOT enforce a role). Gate the writes to
// admin + manager — the same inline-helper pattern used across the route layer
// (arrests.ts, training.ts, radio.ts, …). Reads stay open to all signed-in users.
function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// system_config is a shared flat key/value bag — third-party API keys/secrets
// (see ALLOWED_THIRD_PARTY_KEYS below) live in the SAME table as ordinary UI
// config (dropdown defaults, feature flags, etc.), distinguished only by
// naming convention. Any route that dumps this table (like GET /config below)
// must exclude secret-shaped keys or it becomes a plaintext secret leak to
// every admin/manager/supervisor account — a much lower bar than the
// dedicated /third-party-keys endpoints' redact-to-{configured:boolean}.
const SECRET_KEY_PATTERN = /_(api_key|access_key|access_key_id|secret|secret_access_key|token|password|client_secret|app_key|key_id|webhook_url|webhook_token)$/i;

// ── Router-wide role gate ───────────────────────────────────
// Being mounted under /api/admin proves only that the caller has a VALID
// SESSION — it does not make them an administrator. authMiddleware sets
// `user` for every role, and readOnlyRoleGuard blocks only `client_viewer`
// from writes, so an `officer` or `contract_manager` token reaches every
// handler in this file. Each one must therefore declare its own roles;
// a number of them historically did not, which left secret dumps, audit-log
// purges and session revocation open to any logged-in account.
//
// Usage: `const denied = forbidUnlessRole(c, 'admin', 'manager'); if (denied) return denied;`
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function forbidUnlessRole(c: any, ...roles: string[]): Response | null {
  const actor = c.get('user') as { role?: string } | undefined;
  if (!actor?.role || !roles.includes(actor.role)) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  return null;
}

// GET /admin/config
// Returns flat key/value map from system_config + the structured
// `dispositions` array DispatchPage and DispositionPrompt expect.
// Dispositions are recognized from BOTH historical namespaces — legacy
// config_key='disposition.<CODE>' rows and category='dispositions' rows
// (what AdminSystemTab.tsx writes today, always under config_key
// 'disposition_code') — and merged with the built-in roster for any code
// not otherwise present. See src/utils/dispositionConfig.ts
// (mergeDispositions/isDispositionRow) for the assembly + precedence rules.
admin.get('/config', async (c) => {
  try {
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || !new Set(['admin', 'manager', 'supervisor']).has(actor.role)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const db = getDb(c.env);
    const config = await query<Record<string, unknown>>(db, 'SELECT * FROM system_config ORDER BY id');
    const result: Record<string, any> = {};
    const dispositionRows: DispositionConfigRow[] = [];

    for (const row of config) {
      // Live system_config columns are config_key/config_value (NOT key/value);
      // reading key/value yielded "undefined" for every row.
      const key = String(row.config_key);
      const value = String(row.config_value ?? '');
      const candidate: DispositionConfigRow = {
        config_key: key,
        config_value: value,
        category: row.category == null ? null : String(row.category),
      };

      if (isDispositionRow(candidate)) {
        // Consumed as a disposition below. Deliberately NOT also written into
        // the flat map: every category='dispositions' row shares the constant
        // config_key 'disposition_code', so doing both left a meaningless
        // last-write-wins scalar on the response. Nothing reads it.
        dispositionRows.push(candidate);
      } else if (!SECRET_KEY_PATTERN.test(key)) {
        result[key] = value;
      }
    }

    result.dispositions = mergeDispositions(dispositionRows);
    return c.json(result);
  } catch (err) {
    log.error('GET /config failed', { src: 'src/routes/admin.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// ============================================================
// /admin/config-items — grouped Record<category, ConfigItem[]>
// ============================================================
// AdminSystemTab.tsx fetches the FULL editable system_config row
// set grouped by category (incident_types, dispositions, priority_config,
// call_sources, unit_types, zones_beats, evidence_types, security_config,
// branding, system_settings). The legacy /admin/config GET above returns
// a FLAT key/value map for DispatchPage / IncidentsPage consumers, which
// the admin tab can't use to edit individual rows (no ids, no category
// grouping). This sibling endpoint preserves backwards compat: the flat
// route stays untouched; the admin tab calls THIS one and gets the row
// shape it needs for inline Add / Edit / Delete against POST /admin/config,
// PUT /admin/config/:id, DELETE /admin/config/:id below.
admin.get('/config-items', async (c) => {
  const actor = c.get('user') as { role: string } | undefined;
  if (!actor || !new Set(['admin', 'manager', 'supervisor']).has(actor.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  try {
    const db = getDb(c.env);
    const rows = await query<{
      id: number; config_key: string; config_value: string;
      category: string; sort_order: number; is_active: number;
      created_at: string; updated_at: string;
    }>(db,
      `SELECT id, config_key, config_value, category, sort_order, is_active, created_at, updated_at
       FROM system_config
       WHERE is_active = 1
       ORDER BY category, sort_order, config_key`);
    const grouped: Record<string, typeof rows> = {};
    for (const row of rows) {
      const cat = row.category || 'general';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(row);
    }
    return c.json(grouped);
  } catch (err) {
    log.error('GET /config-items failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to fetch config items', detail: (err as Error).message }, 500);
  }
});

// ============================================================
// POST /admin/config — insert a system_config row
// ============================================================
// Body: { config_key, config_value, category?, sort_order? }
// Returns the inserted row including its new auto-incremented id, so the
// client can cache the id for subsequent PUT/DELETE without a roundtrip.
// admin + manager only. Rejects duplicate (config_key, config_value) with
// 409 — the live D1 unique index enforces this and we surface the conflict
// honestly instead of letting it leak as a generic 500.
admin.post('/config', async (c) => {
  const guard = requireRole(c, 'admin', 'manager');
  if (guard) return c.json({ error: guard }, 403);
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const { config_key, config_value, category, sort_order } = body ?? {};
    if (typeof config_key !== 'string' || !config_key.trim()) {
      return c.json({ error: 'config_key (non-empty string) is required' }, 400);
    }
    if (typeof config_value !== 'string') {
      return c.json({ error: 'config_value (string) is required' }, 400);
    }
    const cat = typeof category === 'string' && category.trim() ? category.trim() : 'general';
    const sort = Number.isFinite(sort_order) ? Number(sort_order) : 0;
    const db = getDb(c.env);
    const result = await execute(db,
      `INSERT INTO system_config (config_key, config_value, category, sort_order)
       VALUES (?, ?, ?, ?)`,
      config_key.trim(), config_value, cat, sort);
    const id = Number(result.meta.last_row_id);
    const row = await queryFirst<{
      id: number; config_key: string; config_value: string;
      category: string; sort_order: number; is_active: number;
      created_at: string; updated_at: string;
    }>(db,
      `SELECT id, config_key, config_value, category, sort_order, is_active, created_at, updated_at
       FROM system_config WHERE id = ?`, id);
    return c.json(row);
  } catch (err) {
    log.error('POST /config failed', { src: 'src/routes/admin.ts' }, err);
    const msg = (err as Error).message || '';
    // Live D1 has UNIQUE(config_key, config_value); surface duplicates clearly.
    if (/UNIQUE constraint failed/i.test(msg)) {
      return c.json({ error: 'A row with this config_key + config_value already exists', code: 'DUPLICATE' }, 409);
    }
    return c.json({ error: 'Failed to insert config', detail: msg }, 500);
  }
});

// ============================================================
// PUT /admin/config/:id — update config_value by id
// ============================================================
// Body: { config_value: string, category?: string, sort_order?: number,
//         is_active?: 0|1 }. The client only sends config_value today;
// the other fields are accepted for future use without breaking existing
// callers. Bounces missing/non-numeric id with 400 — that was the cause
// of `PUT /api/admin/config/undefined` 404 spam in prod when the client
// cached an `undefined` id from a previous 404'd POST.
admin.put('/config/:id', async (c) => {
  const guard = requireRole(c, 'admin', 'manager');
  if (guard) return c.json({ error: guard }, 403);
  const idStr = c.req.param('id');
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: `Invalid id "${idStr}"`, code: 'INVALID_ID' }, 400);
  }
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const { config_value, category, sort_order, is_active } = body ?? {};
    if (typeof config_value !== 'string') {
      return c.json({ error: 'config_value (string) is required' }, 400);
    }
    const db = getDb(c.env);
    const sets: string[] = ['config_value = ?'];
    const args: unknown[] = [config_value];
    if (typeof category === 'string' && category.trim()) { sets.push('category = ?'); args.push(category.trim()); }
    if (Number.isFinite(sort_order)) { sets.push('sort_order = ?'); args.push(Number(sort_order)); }
    if (is_active === 0 || is_active === 1) { sets.push('is_active = ?'); args.push(is_active); }
    sets.push("updated_at = datetime('now')");
    args.push(id);
    const result = await execute(db,
      `UPDATE system_config SET ${sets.join(', ')} WHERE id = ?`, ...args);
    if ((result.meta.changes ?? 0) === 0) {
      return c.json({ error: `No config row with id ${id}` }, 404);
    }
    const row = await queryFirst<{
      id: number; config_key: string; config_value: string;
      category: string; sort_order: number; is_active: number;
      created_at: string; updated_at: string;
    }>(db,
      `SELECT id, config_key, config_value, category, sort_order, is_active, created_at, updated_at
       FROM system_config WHERE id = ?`, id);
    return c.json(row);
  } catch (err) {
    log.error('PUT /config/:id failed', { src: 'src/routes/admin.ts' }, err);
    const msg = (err as Error).message || '';
    if (/UNIQUE constraint failed/i.test(msg)) {
      return c.json({ error: 'Update would produce a duplicate config_key + config_value', code: 'DUPLICATE' }, 409);
    }
    return c.json({ error: 'Failed to update config', detail: msg }, 500);
  }
});

// ============================================================
// DELETE /admin/config/:id — hard delete by id (admin only)
// ============================================================
// Hard delete matches the AdminSystemTab UX: clicking the trash icon
// next to an incident type / disposition / etc. should remove the row.
// Soft-delete via is_active=0 is available via PUT if a future flow
// needs it (also filtered out by GET /admin/config-items above).
admin.delete('/config/:id', async (c) => {
  const guard = requireRole(c, 'admin');
  if (guard) return c.json({ error: guard }, 403);
  const idStr = c.req.param('id');
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: `Invalid id "${idStr}"`, code: 'INVALID_ID' }, 400);
  }
  try {
    const db = getDb(c.env);
    const result = await execute(db, 'DELETE FROM system_config WHERE id = ?', id);
    if ((result.meta.changes ?? 0) === 0) {
      return c.json({ error: `No config row with id ${id}` }, 404);
    }
    return c.json({ success: true, id });
  } catch (err) {
    log.error('DELETE /config/:id failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to delete config', detail: (err as Error).message }, 500);
  }
});

// GET /admin/call-templates — AdminSystemTab's Quick Templates panel reads
// `description_template`, which maps to this table's `notes` column.
admin.get('/call-templates', async (c) => {
  const denied = forbidUnlessRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const templates = await query<Record<string, unknown>>(db,
      `SELECT id, name, incident_type, priority, notes AS description_template,
              owner_user_id, is_shared, use_count, active, created_at, updated_at
         FROM call_templates ORDER BY name`);
    return c.json(templates);
  } catch (err) {
    log.error('GET /call-templates failed', { src: 'src/routes/admin.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

admin.post('/call-templates', async (c) => {
  const denied = forbidUnlessRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    type CallTemplateBody = { name?: string; incident_type?: string; priority?: string; description_template?: string | null };
    const body = await c.req.json<CallTemplateBody>().catch(() => ({} as CallTemplateBody));
    if (!body.name || !body.incident_type) return c.json({ error: 'name and incident_type are required' }, 400);
    const r = await execute(db,
      `INSERT INTO call_templates (name, incident_type, priority, notes, owner_user_id)
       VALUES (?, ?, ?, ?, ?)`,
      body.name, body.incident_type, body.priority || 'P3', body.description_template ?? null, userId);
    return c.json({ success: true, id: r.meta.last_row_id });
  } catch (err) {
    log.error('POST /call-templates failed', { src: 'src/routes/admin.ts' }, err); return c.json({ error: 'Failed to create call template' }, 500); }
});

admin.put('/call-templates/:id', async (c) => {
  const denied = forbidUnlessRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    type CallTemplateBody = { name?: string; incident_type?: string; priority?: string; description_template?: string | null };
    const body = await c.req.json<CallTemplateBody>().catch(() => ({} as CallTemplateBody));
    const sets: string[] = []; const vals: unknown[] = [];
    if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name); }
    if (body.incident_type !== undefined) { sets.push('incident_type = ?'); vals.push(body.incident_type); }
    if (body.priority !== undefined) { sets.push('priority = ?'); vals.push(body.priority); }
    if (body.description_template !== undefined) { sets.push('notes = ?'); vals.push(body.description_template); }
    if (!sets.length) return c.json({ success: true });
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    const r = await execute(db, `UPDATE call_templates SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /call-templates/:id failed', { src: 'src/routes/admin.ts' }, err); return c.json({ error: 'Failed to update call template' }, 500); }
});

admin.delete('/call-templates/:id', async (c) => {
  const denied = forbidUnlessRole(c, 'admin', 'manager');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const result = await execute(db, 'DELETE FROM call_templates WHERE id = ?', id);
    if (!result.meta.changes) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /call-templates/:id failed', { src: 'src/routes/admin.ts' }, err); return c.json({ error: 'Failed to delete call template' }, 500); }
});

// ── /admin/clients — full CRUD (AdminPage, CrmPage, IncidentsPage all call this prefix) ──
// Roles allowed to see full client records incl. commercial terms. The
// external-facing roles (contract_manager, client_viewer) are deliberately
// absent — there is no tenancy column on `users`, so nothing scopes a
// client-side account to its OWN client, and any of them could otherwise
// read every other client's rates by incrementing :id.
const CLIENT_FULL_ROLES = ['admin', 'manager', 'supervisor'];

admin.get('/clients', async (c) => {
  try {
    const db = getDb(c.env);
    const status = c.req.query('status');
    // This list is a CLIENT PICKER for dispatch / incidents / serve /
    // invoices, so it must stay readable to officers and dispatchers — but
    // `SELECT *` also handed rate_per_hour, contract_value, total_invoiced,
    // total_paid and outstanding_balance to every role. Privileged roles get
    // the full row; everyone else gets only what a picker needs.
    const actor = c.get('user') as { role?: string } | undefined;
    // Restricted set is limited to columns the surrounding query already
    // proves exist (ORDER BY name / WHERE status) — live D1 carries schema
    // drift, and naming a missing column here would 500 the picker for
    // every officer rather than degrade.
    const cols = CLIENT_FULL_ROLES.includes(actor?.role ?? '')
      ? '*'
      : 'id, name, status';
    const sql = status
      ? `SELECT ${cols} FROM clients WHERE status = ? ORDER BY name`
      : `SELECT ${cols} FROM clients ORDER BY name`;
    return c.json(status ? await query(db, sql, status) : await query(db, sql));
  } catch (err) {
    log.error('GET /clients failed', { src: 'src/routes/admin.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

admin.get('/clients/:id', async (c) => {
  // Detail view: contracts, contact persons, and the client's incidents and
  // calls. Only AdminClientsTab consumes it, so gating costs no function.
  const denied = forbidUnlessRole(c, ...CLIENT_FULL_ROLES);
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const client = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM clients WHERE id = ?', id);
    if (!client) return c.json({ error: 'Not found' }, 404);
    const contracts = await query(db, 'SELECT * FROM client_contracts WHERE client_id = ? ORDER BY start_date DESC', id).catch(() => []);
    const persons = await query(db, 'SELECT * FROM client_persons WHERE client_id = ? ORDER BY is_primary DESC, id', id).catch(() => []);
    const incidents = await query(db, `SELECT id, incident_number, occurred_date, status, incident_type FROM incidents WHERE client_id = ? ORDER BY occurred_date DESC LIMIT 50`, id).catch(() => []);
    const calls = await query(db, `SELECT id, call_number, created_at, status, incident_type, priority FROM calls_for_service WHERE client_id = ? ORDER BY created_at DESC LIMIT 50`, id).catch(() => []);
    return c.json({ ...client, contracts, persons, incidents, calls });
  } catch (err) {
    log.error('GET /clients/:id failed', { src: 'src/routes/admin.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

admin.get('/clients/:id/incidents', async (c) => {
  const denied = forbidUnlessRole(c, ...CLIENT_FULL_ROLES);
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    return c.json(await query(db, `SELECT id, incident_number, occurred_date, status, incident_type FROM incidents WHERE client_id = ? ORDER BY occurred_date DESC LIMIT 100`, Number(c.req.param('id'))));
  } catch (err) {
    log.error('admin GET /clients/:id/incidents failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to fetch incidents' }, 500);
  }
});

admin.get('/clients/:id/calls', async (c) => {
  const denied = forbidUnlessRole(c, ...CLIENT_FULL_ROLES);
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    return c.json(await query(db, `SELECT id, call_number, created_at, status, incident_type, priority FROM calls_for_service WHERE client_id = ? ORDER BY created_at DESC LIMIT 100`, Number(c.req.param('id'))));
  } catch (err) {
    log.error('admin GET /clients/:id/calls failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to fetch calls' }, 500);
  }
});

admin.get('/clients/:id/billing', async (c) => {
  // Rates, invoiced/paid totals and outstanding balance.
  const denied = forbidUnlessRole(c, ...CLIENT_FULL_ROLES);
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const client = await queryFirst<Record<string, unknown>>(db, 'SELECT total_invoiced, total_paid, outstanding_balance, billing_cycle, payment_terms, rate_per_hour, rate_per_incident, rate_per_cfs FROM clients WHERE id = ?', Number(c.req.param('id')));
    return c.json(client || {});
  } catch (err) {
    log.error('admin GET /clients/:id/billing failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to fetch billing' }, 500);
  }
});

const CLIENT_EDITABLE = [
  'name', 'contact_name', 'contact_email', 'contact_phone', 'address',
  'contract_start', 'contract_end', 'sla_response_minutes', 'status', 'notes',
  'billing_email', 'billing_address', 'contract_type', 'contract_value', 'payment_terms',
  'auto_renew', 'client_code', 'industry', 'website', 'tax_id', 'payment_method',
  'billing_cycle', 'billing_day', 'discount_percent', 'late_fee_percent',
  'account_manager', 'priority_client', 'client_since', 'rate_per_hour',
  'rate_per_incident', 'rate_per_cfs',
];

admin.post('/clients', async (c) => {
  try {
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || !new Set(['admin', 'manager']).has(actor.role)) return c.json({ error: 'Forbidden' }, 403);
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, any>>();
    if (!b.name || !String(b.name).trim()) return c.json({ error: 'name required' }, 400);
    const status = b.status === 'inactive' ? 'inactive' : 'active';
    const cols = ['name', 'status']; const vals: unknown[] = [String(b.name).trim(), status];
    for (const k of CLIENT_EDITABLE) {
      if (k === 'name' || k === 'status') continue;
      if (k in b) { cols.push(k); vals.push(b[k]); }
    }
    const r = await execute(db, `INSERT INTO clients (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...vals);
    return c.json(await queryFirst(db, 'SELECT * FROM clients WHERE id = ?', r.meta.last_row_id), 201);
  } catch (e) {
    log.error('POST /clients failed', { src: 'src/routes/admin.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

admin.put('/clients/:id', async (c) => {
  try {
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || !new Set(['admin', 'manager']).has(actor.role)) return c.json({ error: 'Forbidden' }, 403);
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const b = await c.req.json<Record<string, any>>();
    const sets: string[] = []; const vals: unknown[] = [];
    for (const k of CLIENT_EDITABLE) {
      if (!(k in b)) continue;
      if (k === 'status' && b[k] !== 'active' && b[k] !== 'inactive') continue;
      sets.push(`${k} = ?`); vals.push(b[k]);
    }
    if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    await execute(db, `UPDATE clients SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    return c.json(await queryFirst(db, 'SELECT * FROM clients WHERE id = ?', id));
  } catch (e) {
    log.error('PUT /clients/:id failed', { src: 'src/routes/admin.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

admin.delete('/clients/:id', async (c) => {
  try {
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || !new Set(['admin', 'manager']).has(actor.role)) return c.json({ error: 'Forbidden' }, 403);
    const db = getDb(c.env);
    await execute(db, "UPDATE clients SET status = 'inactive', updated_at = datetime('now') WHERE id = ?", Number(c.req.param('id')));
    return c.json({ success: true });
  } catch (e) {
    log.error('DELETE /clients/:id failed', { src: 'src/routes/admin.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

admin.post('/clients/:id/archive', async (c) => {
  try {
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || !new Set(['admin', 'manager']).has(actor.role)) return c.json({ error: 'Forbidden' }, 403);
    const db = getDb(c.env);
    await execute(db, "UPDATE clients SET status = 'inactive', updated_at = datetime('now') WHERE id = ?", Number(c.req.param('id')));
    return c.json({ success: true });
  } catch (e) {
    log.error('POST /clients/:id/archive failed', { src: 'src/routes/admin.ts' }, e); return c.json({ error: 'Failed' }, 500); }
});

admin.post('/clients/:id/unarchive', async (c) => {
  try {
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || !new Set(['admin', 'manager']).has(actor.role)) return c.json({ error: 'Forbidden' }, 403);
    const db = getDb(c.env);
    await execute(db, "UPDATE clients SET status = 'active', updated_at = datetime('now') WHERE id = ?", Number(c.req.param('id')));
    return c.json({ success: true });
  } catch (e) {
    log.error('POST /clients/:id/unarchive failed', { src: 'src/routes/admin.ts' }, e); return c.json({ error: 'Failed' }, 500); }
});

export default admin;

// ── Admin dashboard data endpoints ──
admin.get('/shift-stats', async (c) => {
  const denied = forbidUnlessRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const now = new Date();
    const shiftHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/Denver', hour: '2-digit', hour12: false }), 10);
    const shiftName = shiftHour >= 6 && shiftHour < 14 ? 'Day' : shiftHour >= 14 && shiftHour < 22 ? 'Swing' : 'Night';
    const startHour = shiftName === 'Day' ? 6 : shiftName === 'Swing' ? 14 : 22;
    const endHour = shiftName === 'Day' ? 14 : shiftName === 'Swing' ? 22 : 6;
    // shiftHour/startHour/endHour are Denver wall-clock hours, but created_at is
    // stored UTC — strftime('%H', created_at) read the raw UTC hour, off by the
    // MT UTC offset (6-7h). denverHourExpr shifts the timestamp into Denver
    // time before extracting the hour (utils/denverTime.ts), same helper used
    // by reports.ts's shift-comparison endpoint.
    const shiftedHourExpr = denverHourExpr('created_at');
    const dateCondition = shiftName === 'Night'
      ? `(${shiftedHourExpr} >= ${startHour} OR ${shiftedHourExpr} < ${endHour})`
      : `${shiftedHourExpr} BETWEEN ${startHour} AND ${endHour - 1}`;
    const calls = (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM calls_for_service WHERE ${dateCondition}`))?.n ?? 0;
    const incidents = (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM incidents WHERE ${dateCondition}`))?.n ?? 0;
    const citations = (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM citations WHERE ${dateCondition.replace(/created_at/g, 'citation_date')}`))?.n ?? 0;
    const patrolScans = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM patrol_scans'))?.n ?? 0;
    return c.json({ shift_name: shiftName, calls, incidents, citations, patrol_scans: patrolScans });
  } catch (err) {
    log.error('admin GET /shift-stats failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ shift_name: 'Unknown', calls: 0, incidents: 0, citations: 0, patrol_scans: 0 });
  }
});

admin.get('/upcoming-court-dates', async (c) => {
  const denied = forbidUnlessRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const daysRaw = parseInt(c.req.query('days') || '30', 10);
    const days = Number.isFinite(daysRaw) ? daysRaw : 30;
    // hearing_date is a plain calendar date (no time-of-day), but "today" needs
    // to be Denver's calendar date, not UTC's — DATE('now') is UTC and drifts a
    // day off for ~6-7 hours around each midnight. Uses the shared
    // denverNowDateExpr helper (utils/denverTime.ts) — same fix as shift-stats
    // above and reports.ts.
    const rows = await query<{ date: string; case_number: string; officer_name: string }>(db,
      // Live court_events uses event_date / court_case_number, and has no
      // officer_id — created_by is the only user FK on the row.
      `SELECT ce.event_date AS date, ce.court_case_number AS case_number,
              COALESCE(u.full_name, 'Unassigned') AS officer_name
       FROM court_events ce LEFT JOIN users u ON u.id = ce.created_by
       WHERE ce.event_date BETWEEN ${denverNowDateExpr()} AND ${denverNowDateExpr(`+${Math.min(days, 90)} days`)}
       ORDER BY ce.event_date LIMIT 50`);
    return c.json({ count: rows.length, dates: rows });
  } catch (err) {
    log.error('admin GET /upcoming-court-dates failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ count: 0, dates: [] });
  }
});

admin.get('/expiring-certifications', async (c) => {
  try {
    const db = getDb(c.env);
    const daysRaw = parseInt(c.req.query('days') || '30', 10);
    const days = Number.isFinite(daysRaw) ? daysRaw : 30;
    const rows = await query<{ officer_name: string; cert: string; days_left: number; expiry_date: string }>(db,
      // No personnel_certifications table: it's officer_certifications, keyed
      // by officer_id, with expiration_date and a cert_type_id FK into
      // certification_types (there is no certification_type text column).
      `SELECT COALESCE(u.full_name, 'Unknown') AS officer_name,
              COALESCE(ct.cert_name, 'Certification') AS cert,
              CAST(julianday(pc.expiration_date) - julianday('now') AS INTEGER) AS days_left,
              pc.expiration_date AS expiry_date
       FROM officer_certifications pc
       LEFT JOIN users u ON u.id = pc.officer_id
       LEFT JOIN certification_types ct ON ct.id = pc.cert_type_id
       WHERE pc.expiration_date BETWEEN DATE('now') AND DATE('now','+${Math.min(days, 90)} days')
       ORDER BY pc.expiration_date LIMIT 30`);
    const expired = await query<{ officer_name: string; cert: string; days_left: number }>(db,
      `SELECT COALESCE(u.full_name, 'Unknown') AS officer_name,
              COALESCE(ct.cert_name, 'Certification') AS cert,
              CAST(julianday('now') - julianday(pc.expiration_date) AS INTEGER) AS days_left
       FROM officer_certifications pc
       LEFT JOIN users u ON u.id = pc.officer_id
       LEFT JOIN certification_types ct ON ct.id = pc.cert_type_id
       WHERE pc.expiration_date < DATE('now') ORDER BY pc.expiration_date LIMIT 20`);
    return c.json({ expiring_count: rows.length, expired_count: expired.length, items: [...rows, ...expired.map(e => ({ ...e, expiry_date: 'EXPIRED' }))] });
  } catch (err) {
    log.error('admin GET /expiring-certifications failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ expiring_count: 0, expired_count: 0, items: [] });
  }
});

admin.get('/google-maps-config', (c) => c.json({}));
admin.get('/config/branding', (c) => c.json([]));

// ── AdminHealthTab observability ────────────────────────────
// AdminHealthTab.tsx polls these on mount + every 60s. Host/process
// metrics (rss, heap, node version) genuinely don't exist on a Worker
// runtime, so `server` stays zeroed — but everything D1 can answer
// (sessions, units, calls, login/error activity) is now real, using
// only tables that already exist (sessions, units, calls_for_service,
// login_attempts, error_log) rather than a not-yet-built metrics pipeline.
admin.get('/health/detailed', async (c) => {
  const denied = forbidUnlessRole(c, 'admin');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const cnt = async (sql: string, ...params: unknown[]) => (await queryFirst<{ n: number }>(db, sql, ...params).catch(() => null))?.n ?? 0;
    const [activeSessions, activeUnits, pendingCalls, successful24h, failed24h, recentErrors] = await Promise.all([
      cnt(`SELECT COUNT(*) AS n FROM sessions WHERE COALESCE(is_active,1) = 1 AND expires_at > datetime('now')`),
      cnt(`SELECT COUNT(*) AS n FROM units WHERE status NOT IN ('off_duty','out_of_service','OFD')`),
      cnt(`SELECT COUNT(*) AS n FROM calls_for_service WHERE ${ACTIVE_CALL_WHERE}`),
      // Logins are recorded in `login_attempts` (username/ip_address/success/
      // failure_reason), NOT as audit_log rows. Nothing anywhere writes
      // action='login_success'/'login_failed' — those strings existed only in
      // these two queries — so the admin security panel reported zero login
      // activity permanently. Verified on live: the audit_log form returns 0
      // while this form returns 11 for the same 24h window.
      // Same source as /api/auth/security/event-timeline (auth.ts).
      cnt(`SELECT COUNT(*) AS n FROM login_attempts WHERE COALESCE(success,0) = 1 AND created_at > datetime('now','-1 day')`),
      cnt(`SELECT COUNT(*) AS n FROM login_attempts WHERE COALESCE(success,0) = 0 AND created_at > datetime('now','-1 day')`),
      query<Record<string, unknown>>(db, `SELECT id, severity, message, created_at FROM error_log ORDER BY created_at DESC LIMIT 10`).catch(() => []),
    ]);
    return c.json({
      version: '1.0.0',
      server: { uptime: 0, memory: { rss: 0, heapUsed: 0, heapTotal: 0, external: 0 }, nodeVersion: 'workerd' },
      database: { sizeBytes: 0, tables: {} },
      operations: { activeSessions, activeUnits, pendingCalls, connectedClients: 0 },
      loginStats: { successful24h, failed24h },
      recentErrors,
    });
  } catch (err) {
    console.error('[Admin] GET health/detailed failed:', err);
    return c.json({
      version: '1.0.0',
      server: { uptime: 0, memory: { rss: 0, heapUsed: 0, heapTotal: 0, external: 0 }, nodeVersion: 'workerd' },
      database: { sizeBytes: 0, tables: {} },
      operations: { activeSessions: 0, activeUnits: 0, pendingCalls: 0, connectedClients: 0 },
      loginStats: { successful24h: 0, failed24h: 0 },
      recentErrors: [],
    });
  }
});

admin.get('/changelog', (c) => c.json({
  version: '1.0.0',
  changelog: [],
}));

admin.get('/system-health', async (c) => {
  try {
    const db = getDb(c.env);
    const start = Date.now();
    await queryFirst(db, 'SELECT 1');
    const dbLatencyMs = Date.now() - start;
    return c.json({ status: 'ok', database: { connected: true, latencyMs: dbLatencyMs }, checkedAt: new Date().toISOString() });
  } catch (err) {
    return c.json({ status: 'degraded', database: { connected: false, latencyMs: null }, checkedAt: new Date().toISOString() });
  }
});

admin.get('/users-activity-summary', async (c) => {
  // Per-user 7-day activity counts (AdminHealthTab) — same ungated leak as
  // GET /users above; restrict to admin/manager.
  const denied = forbidUnlessRole(c, 'admin', 'manager');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT u.id AS user_id, u.full_name, u.role,
              COUNT(a.id) AS action_count,
              MAX(a.created_at) AS last_active_at
         FROM users u LEFT JOIN audit_log a ON a.user_id = u.id AND a.created_at > datetime('now','-7 days')
        WHERE u.status = 'active'
        GROUP BY u.id
        ORDER BY action_count DESC LIMIT 50`);
    return c.json({ data: rows });
  } catch (err) {
    log.error('admin GET top-users failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ data: [] });
  }
});

admin.get('/realtime-stats', async (c) => {
  const denied = forbidUnlessRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const cnt = async (sql: string) => (await queryFirst<{ n: number }>(db, sql).catch(() => null))?.n ?? 0;
    const [activeCalls, unitsOnDuty, pendingIncidents, activeBolos, activeSessions, todayActivity, todayCalls] = await Promise.all([
      cnt(`SELECT COUNT(*) AS n FROM calls_for_service WHERE ${ACTIVE_CALL_WHERE}`),
      cnt(`SELECT COUNT(*) AS n FROM units WHERE status NOT IN ('off_duty','out_of_service','OFD')`),
      cnt(`SELECT COUNT(*) AS n FROM incidents WHERE status NOT IN ('closed','cleared')`),
      cnt(`SELECT COUNT(*) AS n FROM bolos WHERE status = 'active'`),
      cnt(`SELECT COUNT(*) AS n FROM sessions WHERE COALESCE(is_active,1) = 1 AND expires_at > datetime('now')`),
      cnt(`SELECT COUNT(*) AS n FROM audit_log WHERE created_at > datetime('now','-1 day')`),
      cnt(`SELECT COUNT(*) AS n FROM calls_for_service WHERE created_at > datetime('now','-1 day')`),
    ]);
    return c.json({ activeCalls, unitsOnDuty, pendingIncidents, activeBolos, activeSessions, todayActivity, todayCalls });
  } catch (err) {
    console.error('[Admin] GET realtime-stats failed:', err);
    return c.json({ activeCalls: 0, unitsOnDuty: 0, pendingIncidents: 0, activeBolos: 0, activeSessions: 0, todayActivity: 0, todayCalls: 0 });
  }
});

// ── Departments / Retention / Announcements list stubs ─────
// AdminDepartmentsTab, AdminRetentionTab, AdminAnnouncementsTab
// all render an "empty state" gracefully when given []. Write
// endpoints (POST/PUT/DELETE) on these resources still 404 and
// need real implementations when the features come online —
// not in this PR's scope.
// Departments, Announcements and Notification Rules now have real CRUD —
// handlers appended at the end of this file (2026-06-02). Retention stays a
// read-only [] stub: the destructive auto-purge was intentionally not built
// and the Data Retention tab was removed in the same pass.
admin.get('/retention', (c) => c.json([]));
admin.get('/retention/preview', (c) => c.json([]));

// ── Admin observability stubs (AdminPage dashboard tiles) ────
// All four 404'd in prod (no handler in either rewrite or legacy).
// Empty-shape responses keep AdminPage's top tiles from showing
// red error toasts on mount. Real implementations need a metrics
// pipeline (api_call_log, system_health_pings tables) that doesn't
// exist on live D1 yet.
// GET /admin/api-stats — top actions + top users over the window (AdminHealthTab's
// ApiUsageStats panel reads stats.byAction/stats.byUser, NOT raw HTTP request
// metrics — no request-log table exists, so this is action-volume from audit_log,
// which is exactly what the panel already renders).
admin.get('/api-stats', async (c) => {
  const denied = forbidUnlessRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const days = Math.min(Number(c.req.query('days') || 7), 90);
    const byAction = await query<{ action: string; count: number }>(db, `
      SELECT action, COUNT(*) AS count FROM audit_log
      WHERE created_at > datetime('now', ?) AND action IS NOT NULL
      GROUP BY action ORDER BY count DESC LIMIT 8
    `, `-${days} days`);
    const byUser = await query<{ full_name: string | null; count: number }>(db, `
      SELECT u.full_name AS full_name, COUNT(*) AS count
      FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.created_at > datetime('now', ?)
      GROUP BY a.user_id ORDER BY count DESC LIMIT 8
    `, `-${days} days`);
    return c.json({ data: { byAction: byAction || [], byUser: byUser || [] } });
  } catch (err) {
    console.error('[Admin] GET api-stats failed:', err);
    return c.json({ data: { byAction: [], byUser: [] } });
  }
});

// GET /admin/user-activity-heatmap — hour-of-day × day-of-week action volume
// from audit_log over the window (AdminHealthTab's UserActivityHeatmap panel).
admin.get('/user-activity-heatmap', async (c) => {
  const denied = forbidUnlessRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const days = Math.min(Number(c.req.query('days') || 30), 90);
    // Bucket in Mountain Time via the shared denverStrftimeExpr helper
    // (utils/denverTime.ts), not raw UTC — matches the app-wide "MT MUST BE
    // MT" display rule; a UTC-bucketed heatmap would show shift patterns
    // shifted by 6-7 hours from what dispatchers actually see.
    const rows = await query<{ day_of_week: number; hour: number; count: number }>(db, `
      SELECT ${denverStrftimeExpr('%w', 'created_at')} AS day_of_week,
             ${denverStrftimeExpr('%H', 'created_at')} AS hour,
             COUNT(*) AS count
      FROM audit_log
      WHERE created_at > datetime('now', ?)
      GROUP BY day_of_week, hour
    `, `-${days} days`);
    return c.json({ data: rows || [] });
  } catch (err) {
    console.error('[Admin] GET user-activity-heatmap failed:', err);
    return c.json({ data: [] });
  }
});
admin.get('/backup-status', (c) => c.json({
  data: { last_backup_at: null, status: 'unknown', size_bytes: 0, location: null },
}));
// Sole /config-history handler. A second one reading config_audit_log was
// registered further down this file and was unreachable (Hono dispatches the
// first match); config_audit_log has no writers anywhere in src/. Deleted
// 2026-07-25.
admin.get('/config-history', async (c) => {
  const denied = forbidUnlessRole(c, 'admin', 'manager');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const limit = Math.min(Number(c.req.query('limit') || 20), 100);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT al.* FROM activity_log al
       WHERE al.action IN ('config_update','setting_update','system_config_update')
       ORDER BY al.created_at DESC LIMIT ?`, limit);
    return c.json({ data: rows });
  } catch (err) {
    log.error('admin GET config-changes failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ data: [] });
  }
});

// Maintenance-mode GET/PUT now persist to system_config — see appended block.

// ============================================================
// Real CRUD handlers (added 2026-06-02) — replaces the GET-[] stubs
// that made these features look healthy while every write 404'd.
// Tables created in migration 0070. Mounted under /api/admin via
// routesConfig; proxy already routes these prefixes to env.API.
// ============================================================

// Small helper: build a partial UPDATE from a whitelist so toggle-style
// PATCH-via-PUT calls (e.g. { is_active: 0 }) don't wipe other columns.
function buildPartialUpdate(
  body: Record<string, unknown>,
  allowed: string[],
): { setSql: string; values: unknown[] } | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const col of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, col)) {
      sets.push(`${col} = ?`);
      values.push(body[col] ?? null);
    }
  }
  if (sets.length === 0) return null;
  sets.push(`updated_at = datetime('now')`);
  return { setSql: sets.join(', '), values };
}

// ── Departments ─────────────────────────────────────────────
admin.get('/departments', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT d.*, p.name AS parent_name, u.full_name AS manager_name
         FROM departments d
         LEFT JOIN departments p ON d.parent_id = p.id
         LEFT JOIN users u ON d.manager_id = u.id
        ORDER BY d.name`,
    );
    return c.json(rows);
  } catch (err) {
    log.error('GET /departments failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to load departments', detail: String(err) }, 500);
  }
});

admin.post('/departments', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) return c.json({ error: 'Department name is required' }, 400);
    const r = await execute(
      db,
      `INSERT INTO departments (name, code, description, parent_id, manager_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      name, b.code ?? null, b.description ?? null,
      b.parent_id ?? null, b.manager_id ?? null, b.is_active === 0 ? 0 : 1,
    );
    return c.json({ success: true, id: r.meta.last_row_id }, 201);
  } catch (err) {
    log.error('POST /departments failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to create department', detail: String(err) }, 500);
  }
});

admin.put('/departments/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    const b = await c.req.json<Record<string, unknown>>();
    // Never let a department become its own parent.
    if (b.parent_id != null && Number(b.parent_id) === id) b.parent_id = null;
    const upd = buildPartialUpdate(b, ['name', 'code', 'description', 'parent_id', 'manager_id', 'is_active']);
    if (!upd) return c.json({ error: 'No fields to update' }, 400);
    await execute(db, `UPDATE departments SET ${upd.setSql} WHERE id = ?`, ...upd.values, id);
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /departments/:id failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to update department', detail: String(err) }, 500);
  }
});

admin.delete('/departments/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    const delResult = await execute(db, `DELETE FROM departments WHERE id = ?`, id);
    if (!delResult.meta.changes) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /departments/:id failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to delete department', detail: String(err) }, 500);
  }
});

// ── Announcements (admin CRUD) ──────────────────────────────
// The officer-facing reader lives in src/routes/announcements.ts
// (GET /api/announcements — active + role-scoped + within window).
admin.get('/announcements/all', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db, `SELECT * FROM announcements ORDER BY created_at DESC, id DESC`,
    );
    return c.json(rows);
  } catch (err) {
    log.error('GET /announcements/all failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to load announcements', detail: String(err) }, 500);
  }
});

admin.post('/announcements', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const u = c.get('user');
    const b = await c.req.json<Record<string, unknown>>();
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title) return c.json({ error: 'Title is required' }, 400);
    const r = await execute(
      db,
      `INSERT INTO announcements (title, body, type, priority, target_roles, is_active, starts_at, expires_at, created_by, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      title, b.body ?? null, b.type ?? 'info', b.priority ?? 'normal',
      typeof b.target_roles === 'string' ? b.target_roles : '[]',
      b.is_active === 0 ? 0 : 1, b.starts_at ?? null, b.expires_at ?? null,
      u?.id ?? null, u?.full_name ?? null,
    );
    return c.json({ success: true, id: r.meta.last_row_id }, 201);
  } catch (err) {
    log.error('POST /announcements failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to create announcement', detail: String(err) }, 500);
  }
});

admin.put('/announcements/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    const b = await c.req.json<Record<string, unknown>>();
    const upd = buildPartialUpdate(b, ['title', 'body', 'type', 'priority', 'target_roles', 'is_active', 'starts_at', 'expires_at']);
    if (!upd) return c.json({ error: 'No fields to update' }, 400);
    await execute(db, `UPDATE announcements SET ${upd.setSql} WHERE id = ?`, ...upd.values, id);
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /announcements/:id failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to update announcement', detail: String(err) }, 500);
  }
});

admin.delete('/announcements/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    await execute(db, `DELETE FROM announcements WHERE id = ?`, id);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /announcements/:id failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to delete announcement', detail: String(err) }, 500);
  }
});

// ── Notification rules (Alert Rules engine) ─────────────────
admin.get('/notification-rules', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db, `SELECT * FROM notification_rules ORDER BY created_at DESC, id DESC`,
    );
    return c.json(rows);
  } catch (err) {
    log.error('GET /notification-rules failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to load notification rules', detail: String(err) }, 500);
  }
});

admin.post('/notification-rules', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const u = c.get('user');
    const b = await c.req.json<Record<string, unknown>>();
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) return c.json({ error: 'Rule name is required' }, 400);
    if (!b.trigger_event) return c.json({ error: 'Trigger event is required' }, 400);
    // A rule with neither roles nor users notifies NOBODY — reject rather than
    // silently accept a dead rule on (often officer-safety) triggers.
    const parseArr = (v: unknown) => { try { const a = JSON.parse(typeof v === 'string' ? v : '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
    if (parseArr(b.target_roles).length === 0 && parseArr(b.target_user_ids).length === 0) {
      return c.json({ error: 'Select at least one target role or user', code: 'NO_TARGETS' }, 400);
    }
    const r = await execute(
      db,
      `INSERT INTO notification_rules
         (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      name, b.description ?? null, String(b.trigger_event),
      typeof b.conditions === 'string' ? b.conditions : '{}',
      typeof b.target_roles === 'string' ? b.target_roles : '[]',
      typeof b.target_user_ids === 'string' ? b.target_user_ids : '[]',
      b.notification_type ?? 'in_app', b.is_active === 0 ? 0 : 1,
      u?.id ?? null, u?.full_name ?? null,
    );
    return c.json({ success: true, id: r.meta.last_row_id }, 201);
  } catch (err) {
    log.error('POST /notification-rules failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to create rule', detail: String(err) }, 500);
  }
});

admin.put('/notification-rules/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    const b = await c.req.json<Record<string, unknown>>();
    const upd = buildPartialUpdate(b, ['name', 'description', 'trigger_event', 'conditions', 'target_roles', 'target_user_ids', 'notification_type', 'is_active']);
    if (!upd) return c.json({ error: 'No fields to update' }, 400);
    await execute(db, `UPDATE notification_rules SET ${upd.setSql} WHERE id = ?`, ...upd.values, id);
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /notification-rules/:id failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to update rule', detail: String(err) }, 500);
  }
});

admin.delete('/notification-rules/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    await execute(db, `DELETE FROM notification_rules WHERE id = ?`, id);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /notification-rules/:id failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to delete rule', detail: String(err) }, 500);
  }
});

// POST /notification-rules/:id/test — fan a [TEST] notification to the
// rule's real targets so the admin can confirm delivery end-to-end.
admin.post('/notification-rules/:id/test', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    const rule = await queryFirst<NotificationRuleRow>(
      db, `SELECT * FROM notification_rules WHERE id = ?`, id,
    );
    if (!rule) return c.json({ error: 'Rule not found' }, 404);
    const notified = await fireRule(db, rule, {
      title: `Test: ${rule.name}`,
      message: rule.description || `Test notification for "${rule.name}"`,
    }, { testPrefix: true }, c.env);
    return c.json({ success: true, notified });
  } catch (err) {
    log.error('POST /notification-rules/:id/test failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to send test notification', detail: String(err) }, 500);
  }
});

// ── Maintenance mode (system_config-backed) ─────────────────
const MAINT_KEY = 'maintenance_mode';
const MAINT_DEFAULT = { enabled: false, message: null as string | null, scheduled_at: null as string | null };

admin.get('/maintenance-mode', async (c) => {
  try {
    const db = getDb(c.env);
    const row = await queryFirst<{ config_value: string }>(
      db, `SELECT config_value FROM system_config WHERE config_key = ? ORDER BY id DESC LIMIT 1`, MAINT_KEY,
    );
    if (!row) return c.json(MAINT_DEFAULT);
    try { return c.json({ ...MAINT_DEFAULT, ...JSON.parse(row.config_value) }); }
    catch { return c.json(MAINT_DEFAULT); }
  } catch (err) {
    return c.json({ ...MAINT_DEFAULT, error: String(err) });
  }
});

admin.put('/maintenance-mode', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    const value = JSON.stringify({
      enabled: !!b.enabled,
      message: b.message ?? null,
      scheduled_at: b.scheduled_at ?? null,
    });
    // system_config has no UNIQUE(config_key) on live, so update-then-insert.
    const r = await execute(
      db,
      `UPDATE system_config SET config_value = ?, updated_at = datetime('now') WHERE config_key = ?`,
      value, MAINT_KEY,
    );
    if (!r.meta.changes) {
      await execute(
        db,
        `INSERT INTO system_config (config_key, config_value, category) VALUES (?, ?, 'system')`,
        MAINT_KEY, value,
      );
    }
    return c.json({ success: true, ...JSON.parse(value) });
  } catch (err) {
    log.error('PUT /maintenance-mode failed', { src: 'src/routes/admin.ts' }, err);
    return c.json({ error: 'Failed to update maintenance mode', detail: String(err) }, 500);
  }
});

// ============================================================
// Third-party API keys (AdminIntegrationsTab) — added 2026-06-06.
// Stored plaintext in system_config (the Mapbox / third-party stack is
// not encrypted at rest — see comment in AdminIntegrationsTab.tsx).
// The legacy /api/admin/third-party-keys endpoints were never ported
// to the Worker, so the AdminPage fired 1 + N 404s per mount. Real
// handlers below + client-side N+1 removal (see commit) eliminate both.
// ============================================================

const ALLOWED_THIRD_PARTY_KEYS = new Set<string>([
  'lead_gen_rapidapi_key', 'dl_ocr_rapidapi_key', 'plate_check_rapidapi_key',
  'google_cloud_vision_key', 'google_cloud_speech_key', 'google_generative_language_key',
  'mapbox_api_key', 'mapbox_access_token', 'mapbox_username', 'mapbox_style_url',
  'ncic_api_key', 'utah_dps_api_key', 'utah_courts_api_key', 'fbi_wanted_api_key',
  'dea_api_key', 'usms_api_key', 'atf_api_key', 'interpol_api_key',
  'nsopw_api_key', 'ofac_api_key', 'screening_ofac_csl_api_key',
  'openweathermap_api_key', 'nominatim_api_key', 'opencage_api_key',
  'ipinfo_api_key', 'virustotal_api_key', 'abuseipdb_api_key', 'shodan_api_key',
  'have_i_been_pwned_key', 'hibp_api_key', 'censys_api_key', 'hunter_io_api_key', 'numverify_api_key',
  'usa_people_search_rapidapi_key', 'pdl_api_key', 'apollo_api_key', 'courtlistener_token',
  'skiptracer_rapidapi_key',
  'abstract_api_key', 'whoisxml_api_key', 'urlscan_api_key', 'emailrep_api_key',
  'twilio_api_key', 'twilio_account_sid', 'sendgrid_api_key', 'pushover_api_key',
  'ntfy_topic_key', 'slack_webhook_url', 'discord_webhook_url', 'telegram_bot_token',
  'openai_api_key', 'anthropic_api_key', 'replicate_api_key', 'huggingface_api_key',
  'deepgram_api_key', 'assemblyai_api_key',
  'aws_access_key_id', 'aws_secret_access_key', 'aws_s3_bucket',
  'backblaze_key_id', 'backblaze_app_key', 'cloudflare_api_key', 'wasabi_access_key',
  'openmeteo_api_key', 'clearpath_gps_api_key', 'microbilt_client_id', 'microbilt_client_secret',
  'nhtsa_api_key', 'fcc_api_key', 'here_api_key', 'what3words_api_key',
  'plaid_api_key', 'clearbit_api_key', 'pipl_api_key', 'towerdata_api_key',
  'plate_recognizer_api_key', 'roboflow_api_key', 'carjam_api_key', 'spokeo_api_key',
  'traccar_webhook_token', 'traccar_url', 'traccar_email', 'traccar_password',
  'traccar_enabled', 'traccar_poll_interval',
]);

// GET /api/admin/third-party-keys — bulk list: which keys are configured.
// Powers the AdminPage N+1 cleanup — client now reads this once and
// indexes by config_key in-memory.
admin.get('/third-party-keys', async (c) => {
  try {
    const db = getDb(c.env);
    // Single query — fetch all rows we care about at once, then map.
    const rows = await query<{ config_key: string; config_value: string }>(
      db, `SELECT config_key, config_value FROM system_config WHERE is_active = 1 AND config_key IN (${Array.from(ALLOWED_THIRD_PARTY_KEYS, () => '?').join(',')})`,
      ...ALLOWED_THIRD_PARTY_KEYS,
    );
    const present = new Set(rows.map((r) => r.config_key));
    const result = Array.from(ALLOWED_THIRD_PARTY_KEYS).map((config_key) => ({
      config_key,
      has_value: present.has(config_key),
    }));
    return c.json(result);
  } catch (err) {
    console.error('[Admin] Third-party keys list failed:', err);
    return c.json({ error: 'Failed to list keys' }, 500);
  }
});

// GET /api/admin/third-party-keys/:key — single-key check. Kept for
// the per-key endpoint the client previously used in fallback mode.
admin.get('/third-party-keys/:key', async (c) => {
  const key = c.req.param('key');
  if (!ALLOWED_THIRD_PARTY_KEYS.has(key)) return c.json({ error: 'Unknown key' }, 400);
  try {
    const db = getDb(c.env);
    const row = await queryFirst<{ config_value: string }>(
      db, `SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1 LIMIT 1`, key,
    );
    return c.json({ configured: !!row?.config_value });
  } catch {
    return c.json({ configured: false });
  }
});

// PUT /api/admin/third-party-keys — save a single key. Body: { key, value }.
admin.put('/third-party-keys', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const body = await c.req.json<{ key?: string; value?: string }>();
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    const value = typeof body.value === 'string' ? body.value.trim() : '';
    if (!key || !value) return c.json({ error: 'key and value are required' }, 400);
    if (!ALLOWED_THIRD_PARTY_KEYS.has(key)) return c.json({ error: 'Unknown key' }, 400);
    const db = getDb(c.env);
    const existing = await queryFirst<{ id: number }>(
      db, `SELECT id FROM system_config WHERE config_key = ? LIMIT 1`, key,
    );
    if (existing) {
      await execute(
        db,
        `UPDATE system_config SET config_value = ?, is_active = 1, updated_at = datetime('now') WHERE config_key = ?`,
        value, key,
      );
    } else {
      await execute(
        db,
        `INSERT INTO system_config (config_key, config_value, category, is_active, created_at, updated_at)
         VALUES (?, ?, 'integrations', 1, datetime('now'), datetime('now'))`,
        key, value,
      );
    }
    return c.json({ success: true, message: `${key} saved` });
  } catch (err) {
    console.error('[Admin] Third-party key save failed:', err);
    return c.json({ error: 'Failed to save key' }, 500);
  }
});

// DELETE /api/admin/third-party-keys — clear a single key. Body: { key }.
admin.delete('/third-party-keys', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const body = await c.req.json<{ key?: string }>();
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (!key || !ALLOWED_THIRD_PARTY_KEYS.has(key)) return c.json({ error: 'Unknown key' }, 400);
    const db = getDb(c.env);
    await execute(
      db,
      `UPDATE system_config SET config_value = '', is_active = 0, updated_at = datetime('now') WHERE config_key = ?`,
      key,
    );
    return c.json({ success: true, message: `${key} cleared` });
  } catch (err) {
    console.error('[Admin] Third-party key clear failed:', err);
    return c.json({ error: 'Failed to clear key' }, 500);
  }
});

// POST /api/admin/third-party-keys/:key/test — live connectivity probe for keys
// we know how to test. Currently anthropic_api_key and openai_api_key — both
// send a minimal Chat-like ping and classify the result so an admin can tell
// "configured + funded + reachable" apart from "configured but broken" (the
// "Configured" badge only proves a value exists; AI consumers silently fall
// back through the callAi chain when an upstream tier is unhealthy).
// Always returns 200; read body.ok.
admin.post('/third-party-keys/:key/test', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const key = c.req.param('key');
  if (!ALLOWED_THIRD_PARTY_KEYS.has(key)) return c.json({ error: 'Unknown key' }, 400);

  if (key === 'anthropic_api_key') {
    const apiKey = await getAnthropicKey(c.env);
    if (!apiKey) return c.json({ ok: false, testable: true, message: 'Key not configured' });
    try {
      const model = await getClaudeModel(c.env);
      const text = await callClaude(apiKey, { text: 'Reply with the single word: ok', maxTokens: 8, model });
      return c.json({ ok: true, testable: true, model, message: `OK — ${model} responded`, sample: text.trim().slice(0, 40) });
    } catch (e: any) {
      const { status, hint } = diagnoseAnthropicError(String(e?.message || e));
      return c.json({ ok: false, testable: true, status, message: hint });
    }
  }

  if (key === 'openai_api_key') {
    const apiKey = await getOpenAiKey(c.env);
    if (!apiKey) return c.json({ ok: false, testable: true, message: 'Key not configured' });
    try {
      const model = await getOpenAiModel(c.env);
      const text = await callOpenAi(apiKey, { text: 'Reply with the single word: ok', maxTokens: 8, model });
      return c.json({ ok: true, testable: true, model, message: `OK — ${model} responded`, sample: text.trim().slice(0, 40) });
    } catch (e: any) {
      const { status, hint } = diagnoseOpenAiError(String(e?.message || e));
      return c.json({ ok: false, testable: true, status, message: hint });
    }
  }

  return c.json({ ok: false, testable: false, message: 'No live test available for this key yet' });
});

// ============================================================
// Users (read-only) — added 2026-06-06.
// Required by AdminGodModeTab, AdminTrainingTab, AdminUsersTab, and
// PatrolPage's MileageAuditTab. The previous 404 flooded the admin page.
// ============================================================

admin.get('/users', async (c) => {
  // Personnel roster (name, email, badge #, role) for every active user —
  // was ungated while every other /users/:id/* endpoint in this file
  // requires admin/manager. A client_viewer or contract_manager account
  // could enumerate the entire org's staff directory.
  const denied = forbidUnlessRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const role = c.req.query('role');
    const limit = Math.min(parseInt(c.req.query('limit') || '500', 10) || 500, 1000);
    const cols = 'id, username, full_name, role, badge_number, call_sign, email, created_at';
    let rows: Record<string, unknown>[];
    try {
      const sql = role
        ? `SELECT ${cols}, status FROM users WHERE role = ? AND status = 'active' ORDER BY full_name LIMIT ?`
        : `SELECT ${cols}, status FROM users WHERE status = 'active' ORDER BY full_name LIMIT ?`;
      const params = role ? [role, limit] : [limit];
      rows = await query<Record<string, unknown>>(db, sql, ...params);
    } catch {
      const sql = role
        ? `SELECT ${cols} FROM users WHERE role = ? ORDER BY full_name LIMIT ?`
        : `SELECT ${cols} FROM users ORDER BY full_name LIMIT ?`;
      const params = role ? [role, limit] : [limit];
      rows = await query<Record<string, unknown>>(db, sql, ...params);
    }
    return c.json(rows);
  } catch (err) {
    console.error('[Admin] List users failed:', err);
    return c.json({ error: 'Failed to list users' }, 500);
  }
});

// ── Admin user security management (AdminUsersTab "Security" sub-tab) ──────
// handleReset2FA, handleForcePasswordChange, handleRevokeAllSessions, the
// inline "Reset 2FA" toolbar shortcut (DELETE /totp), and the Security
// Questions panel have all called these since they shipped — none of them
// existed, so every button in the sub-tab 404'd, and GET /admin/sessions
// below was a permanent-empty stub, so "Active Sessions" always showed 0
// regardless of what was actually live.

async function resetUserTotp(db: ReturnType<typeof getDb>, userId: number): Promise<void> {
  await execute(db,
    `UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_backup_codes = NULL,
       totp_pending_secret = NULL, updated_at = datetime('now') WHERE id = ?`,
    userId);
  // Matches the client's own copy ("...delete the user's TOTP secret, backup
  // codes, and trusted devices") — a reset device shouldn't still skip 2FA.
  await execute(db, 'DELETE FROM trusted_devices WHERE user_id = ?', userId).catch(() => undefined);
}

// GET /admin/users/:id/security — status card data for the Security sub-tab.
admin.get('/users/:id/security', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    const user = await queryFirst<{ totp_enabled: number | null; must_change_password: number | null; password_changed_at: string | null }>(
      db, 'SELECT totp_enabled, must_change_password, password_changed_at FROM users WHERE id = ?', id);
    if (!user) return c.json({ error: 'User not found' }, 404);
    const sq = await queryFirst<{ id: number }>(db, 'SELECT id FROM user_security_questions WHERE user_id = ?', id);

    // 90-day policy mirrors GET /auth/password-policy's expiryDays — no
    // enforcement exists yet (no login block on an expired password), this
    // is purely the admin-facing status display.
    let passwordExpiresAt: string | null = null;
    let passwordExpiringSoon = false;
    if (user.password_changed_at) {
      const changed = new Date(user.password_changed_at.replace(' ', 'T'));
      if (!isNaN(changed.getTime())) {
        const expires = new Date(changed.getTime() + 90 * 24 * 60 * 60 * 1000);
        passwordExpiresAt = expires.toISOString();
        passwordExpiringSoon = expires.getTime() - Date.now() < 14 * 24 * 60 * 60 * 1000;
      }
    }

    return c.json({
      totpEnabled: !!user.totp_enabled,
      totpSetupRequired: false,
      passwordChangedAt: user.password_changed_at,
      passwordExpiresAt,
      passwordExpiringSoon,
      forcePasswordChange: !!user.must_change_password,
      securityQuestionsConfigured: !!sq,
    });
  } catch (err) {
    console.error('[Admin] GET user security failed:', err);
    return c.json({ error: 'Failed to load user security status' }, 500);
  }
});

// POST /admin/users/:id/reset-2fa — same effect as the inline DELETE /totp
// shortcut below; kept as two routes because the client calls both from
// different buttons (the Security sub-tab's card vs. the header shortcut).
admin.post('/users/:id/reset-2fa', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    await resetUserTotp(db, id);
    await recordAudit(c, { action: 'USER_2FA_RESET', entityType: 'user', entityId: id, details: 'Admin reset 2FA (POST /reset-2fa)' });
    return c.json({ message: '2FA has been reset. User will be prompted to set up 2FA on next login.' });
  } catch (err) {
    console.error('[Admin] reset-2fa failed:', err);
    return c.json({ error: 'Failed to reset 2FA' }, 500);
  }
});

admin.delete('/users/:id/totp', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    await resetUserTotp(db, id);
    await recordAudit(c, { action: 'USER_2FA_RESET', entityType: 'user', entityId: id, details: 'Admin reset 2FA (DELETE /totp)' });
    return c.json({ success: true });
  } catch (err) {
    console.error('[Admin] DELETE totp failed:', err);
    return c.json({ error: 'Failed to reset 2FA' }, 500);
  }
});

// POST /admin/users/:id/force-password-change
admin.post('/users/:id/force-password-change', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    await execute(db, `UPDATE users SET must_change_password = 1, updated_at = datetime('now') WHERE id = ?`, id);
    await recordAudit(c, { action: 'USER_FORCE_PASSWORD_CHANGE', entityType: 'user', entityId: id, details: 'Admin forced password change on next login' });
    return c.json({ message: 'User will be required to change their password on next login.' });
  } catch (err) {
    console.error('[Admin] force-password-change failed:', err);
    return c.json({ error: 'Failed to force password change' }, 500);
  }
});

// POST /admin/users/:id/revoke-sessions — revoke every active session for a user.
admin.post('/users/:id/revoke-sessions', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    const result = await execute(db,
      `UPDATE sessions SET is_active = 0 WHERE user_id = ? AND COALESCE(is_active, 1) = 1`, id);
    const count = result.meta.changes ?? 0;
    await recordAudit(c, { action: 'USER_SESSIONS_REVOKED', entityType: 'user', entityId: id, details: `Admin revoked ${count} active session${count === 1 ? '' : 's'}` });
    return c.json({ message: `${count} session${count === 1 ? '' : 's'} revoked.`, count });
  } catch (err) {
    console.error('[Admin] revoke-sessions failed:', err);
    return c.json({ error: 'Failed to revoke sessions' }, 500);
  }
});

// GET /admin/users/:id/security-questions — { configured, questions }. Never
// returns answers (bcrypt-hashed, one-way) — an admin can see WHAT the
// questions are and whether they're set up, not the answers themselves.
admin.get('/users/:id/security-questions', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    const sq = await queryFirst<{ question_1: string; question_2: string; question_3: string }>(
      db, 'SELECT question_1, question_2, question_3 FROM user_security_questions WHERE user_id = ?', id);
    return c.json({ configured: !!sq, questions: sq ? [sq.question_1, sq.question_2, sq.question_3] : [] });
  } catch (err) {
    console.error('[Admin] GET user security-questions failed:', err);
    return c.json({ error: 'Failed to load security questions' }, 500);
  }
});

// DELETE /admin/users/:id/security-questions — clears them so the user can
// set up fresh ones (locked out and can't answer the old ones, or an admin
// suspects they were compromised). Does NOT reset the password itself —
// pair with Reset 2FA / Force Password Change as needed.
admin.delete('/users/:id/security-questions', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    await execute(db, 'DELETE FROM user_security_questions WHERE user_id = ?', id);
    await recordAudit(c, { action: 'USER_SECURITY_QUESTIONS_CLEARED', entityType: 'user', entityId: id, details: 'Admin cleared security questions' });
    return c.json({ success: true });
  } catch (err) {
    console.error('[Admin] DELETE user security-questions failed:', err);
    return c.json({ error: 'Failed to clear security questions' }, 500);
  }
});

// GET /admin/users/:id/email-status — read-only view of whether this user
// has connected their own Microsoft Graph mailbox (per-officer email, see
// src/routes/email.ts's /connect/* flow). Reuses getUserGraphToken rather
// than a separate query so this can never drift from what /email/connect
// actually stores. Never returns the encrypted access/refresh tokens
// themselves — only connected/mailbox, same shape as the self-service
// GET /email/connect/status an officer sees on their own account.
admin.get('/users/:id/email-status', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    const token = await getUserGraphToken(db, c.env, id);
    return c.json({ connected: !!token, mailbox: token?.mailbox ?? null });
  } catch (err) {
    console.error('[Admin] GET user email-status failed:', err);
    return c.json({ error: 'Failed to load email connection status' }, 500);
  }
});

// GET /admin/sessions — every currently-active session, joined for the
// client's own user_id-based filter (AdminUsersTab's loadUserSessions).
// Was a permanent `[]` stub, so "Active Sessions" always read 0.
admin.get('/sessions', async (c) => {
  // Returns up to 500 live sessions with user_id + ip_address + user_agent.
  // Ungated, every account got a map of who is logged in from where.
  const denied = forbidUnlessRole(c, 'admin', 'manager');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const rows = await query<{ user_agent: string | null; browser: string | null; os: string | null }>(db,
      `SELECT session_id AS id, user_id, ip_address, user_agent, created_at, last_used_at, expires_at,
              COALESCE(is_active, 1) AS is_active,
              device_type, browser, os, country, region, city, postal_code, timezone, latitude, longitude, asn, isp,
              http_protocol, tls_version, likely_vpn_or_hosting, device_platform, device_platform_version,
              device_latitude, device_longitude, device_geo_accuracy_m, device_geo_captured_at
         FROM sessions
        WHERE COALESCE(is_active, 1) = 1 AND expires_at > datetime('now')
        ORDER BY COALESCE(last_used_at, created_at) DESC
        LIMIT 500`);
    // The client only renders `device_name` — derive a friendly label. Rows
    // created after migration 0231 already have real browser/os columns
    // (captured at login); older rows fall back to parsing the raw UA.
    const withDeviceName = (rows || []).map((r: any) => ({
      ...r,
      device_name: (r.browser || r.os) ? `${r.browser ?? 'Unknown Browser'} on ${r.os ?? 'Unknown OS'}` : parseUserAgentLabel(r.user_agent),
      location: [r.city, r.region, r.country].filter(Boolean).join(', ') || null,
    }));
    return c.json(withDeviceName);
  } catch (err) {
    console.error('[Admin] GET sessions failed:', err);
    return c.json([]);
  }
});

// DELETE /admin/sessions/:id — revoke a single session (AdminSessionsTab).
admin.delete('/sessions/:id', async (c) => {
  // Revokes ANY session by id, with no ownership check. Combined with the
  // ungated list above, any authenticated account could knock a specific
  // officer or admin offline mid-shift. Matches the gating already on
  // POST /users/:id/revoke-sessions.
  const denied = forbidUnlessRole(c, 'admin', 'manager');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    await execute(db, `UPDATE sessions SET is_active = 0 WHERE session_id = ?`, id);
    return c.json({ success: true });
  } catch (err) {
    console.error('[Admin] DELETE session failed:', err);
    return c.json({ error: 'Failed to revoke session' }, 500);
  }
});
// GET /admin/database/stats — real D1 introspection for AdminGodModeTab's DbStats panel.
admin.get('/database/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const tableRows = await query<{ name: string }>(db,
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%'`);
    const indexCount = await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`);
    const pageCount = await queryFirst<{ page_count: number }>(db, 'PRAGMA page_count');
    const pageSize = await queryFirst<{ page_size: number }>(db, 'PRAGMA page_size');
    const freelist = await queryFirst<{ freelist_count: number }>(db, 'PRAGMA freelist_count');
    const journalMode = await queryFirst<{ journal_mode: string }>(db, 'PRAGMA journal_mode');
    const sizeMb = ((pageCount?.page_count ?? 0) * (pageSize?.page_size ?? 4096)) / (1024 * 1024);
    const freelistMb = ((freelist?.freelist_count ?? 0) * (pageSize?.page_size ?? 4096)) / (1024 * 1024);
    const tables = (await Promise.all((tableRows || []).slice(0, 40).map(async (t) => {
      const row = await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM "${t.name}"`).catch(() => null);
      return { name: t.name, row_count: row?.n ?? 0 };
    })));
    const totalRows = tables.reduce((sum, t) => sum + t.row_count, 0);
    return c.json({
      database_size_mb: Math.round(sizeMb * 100) / 100,
      freelist_mb: Math.round(freelistMb * 100) / 100,
      reclaimable_percent: sizeMb > 0 ? Math.round((freelistMb / sizeMb) * 10000) / 100 : 0,
      table_count: tableRows?.length ?? 0,
      total_rows: totalRows,
      index_count: indexCount?.n ?? 0,
      journal_mode: journalMode?.journal_mode ?? 'unknown',
      integrity: 'not checked — use Integrity Check button',
      tables,
    });
  } catch (err) {
    console.error('[Admin] GET database/stats failed:', err);
    return c.json({ database_size_mb: 0, freelist_mb: 0, reclaimable_percent: 0, table_count: 0, total_rows: 0, index_count: 0, journal_mode: 'unknown', integrity: 'unknown', tables: [] });
  }
});

// GET /admin/system-overview — real D1-derived counts (Workers has no process/node
// runtime info to report, so `server` is omitted rather than faked).
admin.get('/system-overview', async (c) => {
  try {
    const db = getDb(c.env);
    const active24h = await queryFirst<{ n: number }>(db,
      `SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE COALESCE(last_used_at, created_at) > datetime('now', '-1 day')`);
    const countTable = async (t: string) => (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM "${t}"`).catch(() => null))?.n ?? 0;
    const [users, calls, persons, warrants] = await Promise.all([
      countTable('users'), countTable('calls_for_service'), countTable('persons'), countTable('warrants'),
    ]);
    return c.json({
      status: 'ok',
      active_users_24h: active24h?.n ?? 0,
      record_counts: { users, calls_for_service: calls, persons, warrants },
    });
  } catch (err) {
    console.error('[Admin] GET system-overview failed:', err);
    return c.json({ status: 'degraded', active_users_24h: 0, record_counts: {} });
  }
});

// GET /admin/gps-health — per-unit GPS freshness dashboard (AdminGpsHealthTab).
//
// "Authoritative" position = units.latitude/longitude/gps_source/gps_updated_at,
// the canonical row every other surface (map, dispatch, CAD board) reads from.
// "Live" = the most recent gps_breadcrumbs row for that unit, regardless of
// source — breadcrumbs land more often than the authoritative row updates in
// some flows (e.g. a lower-priority browser source pinging while a
// higher-priority source is momentarily stale), which is exactly the
// "fallback" case this dashboard exists to surface. No new schema — reuses
// units.gps_source/gps_updated_at and gps_breadcrumbs.gps_source/recorded_at.
const OFF_DUTY_STATUSES = new Set(['off_duty', 'out_of_service', 'OFD']);
admin.get('/gps-health', async (c) => {
  try {
    const db = getDb(c.env);
    // gps_breadcrumbs grows unbounded (229k+ rows live and climbing) and this
    // tab polls every 5s — an unbounded ROW_NUMBER() window over the whole
    // table read 1.1M+ rows for 10 units in testing (live D1 EXPLAIN QUERY
    // PLAN confirmed a full table SCAN: the bare recorded_at index migration
    // 0001 defines never actually landed on live D1's dirty prod schema —
    // fixed by migration 0196). Bounding to a 2-day window (nothing older
    // matters — that's already "silent" via auth_age_seconds off the units
    // row) plus the MATERIALIZED hint (recent_bc is referenced by both
    // latest_bc and bc_24h_counts below; without it SQLite re-inlines and
    // re-scans the base table for each reference) brought live reads from
    // 1.1M down to ~36k for the same result set — verified via
    // d1_database_query against 785de7ae before/after.
    const rows = await query<{
      id: number; call_sign: string; status: string; gps_source: string | null; gps_updated_at: string | null;
      latitude: number | null; longitude: number | null; officer_name: string | null; badge_number: string | null;
      live_source: string | null; live_at: string | null;
      auth_age_seconds: number | null; live_age_seconds: number | null;
      total_points_24h: number; authoritative_points_24h: number;
    }>(db, `
      WITH recent_bc AS MATERIALIZED (
        SELECT unit_id, gps_source, recorded_at
        FROM gps_breadcrumbs
        WHERE recorded_at > datetime('now', '-2 days')
      ),
      latest_bc AS (
        SELECT unit_id, gps_source, recorded_at,
               ROW_NUMBER() OVER (PARTITION BY unit_id ORDER BY recorded_at DESC) AS rn
        FROM recent_bc
      ),
      bc_24h_counts AS (
        SELECT unit_id,
               COUNT(*) AS total_points_24h,
               SUM(CASE WHEN gps_source = (SELECT gps_source FROM units WHERE id = recent_bc.unit_id) THEN 1 ELSE 0 END) AS authoritative_points_24h
        FROM recent_bc
        WHERE recorded_at > datetime('now', '-1 day')
        GROUP BY unit_id
      )
      SELECT
        u.id, u.call_sign, u.status, u.gps_source, u.gps_updated_at, u.latitude, u.longitude,
        usr.full_name AS officer_name, usr.badge_number,
        lb.gps_source AS live_source, lb.recorded_at AS live_at,
        CASE WHEN u.gps_updated_at IS NULL THEN NULL
             ELSE CAST((julianday('now') - julianday(u.gps_updated_at)) * 86400 AS INTEGER) END AS auth_age_seconds,
        CASE WHEN lb.recorded_at IS NULL THEN NULL
             ELSE CAST((julianday('now') - julianday(lb.recorded_at)) * 86400 AS INTEGER) END AS live_age_seconds,
        COALESCE(cnt.total_points_24h, 0) AS total_points_24h,
        COALESCE(cnt.authoritative_points_24h, 0) AS authoritative_points_24h
      FROM units u
      LEFT JOIN users usr ON usr.id = u.officer_id
      LEFT JOIN latest_bc lb ON lb.unit_id = u.id AND lb.rn = 1
      LEFT JOIN bc_24h_counts cnt ON cnt.unit_id = u.id
      ORDER BY u.call_sign
    `);

    const units = (rows || []).map((r) => {
      let classification: 'healthy' | 'warning' | 'critical' | 'silent' | 'fallback' | 'off_duty';
      if (OFF_DUTY_STATUSES.has(r.status)) {
        classification = 'off_duty';
      } else if (r.auth_age_seconds == null || r.auth_age_seconds >= 86400) {
        classification = 'silent';
      } else if (r.auth_age_seconds >= 900) {
        classification = 'critical';
      } else if (r.auth_age_seconds >= 300) {
        classification = 'warning';
      } else if (
        r.live_source != null && r.live_source !== r.gps_source &&
        r.live_age_seconds != null && (r.auth_age_seconds == null || r.live_age_seconds < r.auth_age_seconds)
      ) {
        // Authoritative source is healthy, but a different source is
        // currently writing fresher breadcrumbs than the authoritative row.
        classification = 'fallback';
      } else {
        classification = 'healthy';
      }
      return {
        id: r.id,
        call_sign: r.call_sign,
        status: r.status,
        gps_source: r.gps_source,
        gps_updated_at: r.gps_updated_at,
        last_authoritative_gps_at: r.gps_updated_at,
        last_authoritative_gps_source: r.gps_source,
        latitude: r.latitude,
        longitude: r.longitude,
        officer_name: r.officer_name,
        badge_number: r.badge_number,
        authoritative_points_24h: r.authoritative_points_24h ?? 0,
        total_points_24h: r.total_points_24h ?? 0,
        auth_age_seconds: r.auth_age_seconds,
        live_age_seconds: r.live_age_seconds,
        classification,
      };
    });

    return c.json({ units, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error('[Admin] GET gps-health failed:', err);
    return c.json({ units: [], generated_at: new Date().toISOString() });
  }
});

// GET /api/admin/users/presence — minimal presence snapshot for the
// God Mode page. Reuses the users table + a sub-query against sessions.
admin.get('/users/presence', async (c) => {
  // Live "who is online right now" feed for AdminGodModeTab — was ungated
  // alongside GET /users above; same fix (admin/manager only).
  const denied = forbidUnlessRole(c, 'admin', 'manager');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT u.id, u.full_name, u.role, u.call_sign, u.status,
              (SELECT MAX(last_used_at) FROM sessions s WHERE s.user_id = u.id AND s.is_active = 1) AS last_seen_at
         FROM users u
        WHERE u.status = 'active'
        ORDER BY u.full_name
        LIMIT 500`,
    );
    return c.json({ users: rows });
  } catch (err) {
    console.error('[Admin] Users presence failed:', err);
    return c.json({ error: 'Failed to load presence' }, 500);
  }
});

// ── Internal Affairs ────────────────────────────────────────
// IA complaints and disciplinary records are restricted personnel files:
// they name the subject officer and the allegation. These three reads were
// ungated, so an `officer` could read complaints filed against colleagues
// (or themselves), and the external-facing `contract_manager` /
// `client_viewer` roles could read the whole IA file. hr.ts gates its
// parallel /disciplinary endpoints — this matches that standard.
admin.get('/ia/complaints', async (c) => {
  const denied = forbidUnlessRole(c, 'admin', 'manager');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM ia_complaints ORDER BY created_at DESC LIMIT 200`);
    return c.json(rows);
  } catch (err) { console.error('GET /ia/complaints failed:', err); return c.json([]); }
});

admin.get('/ia/disciplinary', async (c) => {
  const denied = forbidUnlessRole(c, 'admin', 'manager');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM disciplinary_records ORDER BY created_at DESC LIMIT 200`);
    return c.json(rows);
  } catch (err) { console.error('GET /ia/disciplinary failed:', err); return c.json([]); }
});

admin.get('/ia/stats', async (c) => {
  const denied = forbidUnlessRole(c, 'admin', 'manager');
  if (denied) return denied;
  const db = getDb(c.env);
  async function cnt(sql: string): Promise<number> {
    try { const r = await queryFirst<{ n: number }>(db, sql); return r?.n ?? 0; } catch { return 0; }
  }
  const [total, sustained, notSustained, exonerated, unfounded] = await Promise.all([
    cnt(`SELECT COUNT(*) AS n FROM ia_complaints`),
    cnt(`SELECT COUNT(*) AS n FROM ia_complaints WHERE status = 'sustained'`),
    cnt(`SELECT COUNT(*) AS n FROM ia_complaints WHERE status = 'not_sustained'`),
    cnt(`SELECT COUNT(*) AS n FROM ia_complaints WHERE status = 'exonerated'`),
    cnt(`SELECT COUNT(*) AS n FROM ia_complaints WHERE status = 'unfounded'`),
  ]);
  return c.json({
    totalComplaints: total, sustained, notSustained, exonerated, unfounded,
    avgInvestigationDays: 0, byType: [], byOfficer: [], trend: 'stable' as const,
  });
});

admin.get('/policies/acknowledgements', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM policy_acknowledgements ORDER BY due_date DESC LIMIT 500`);
    return c.json(rows);
  } catch (err) { console.error('GET /policies/acknowledgements failed:', err); return c.json([]); }
});

// ── Database management ────────────────────────────────────
admin.on(['GET', 'POST'], '/database/backup', (c) => c.json({ message: 'D1 backups are managed by Cloudflare automatically', last_backup: null }));
admin.get('/database/backups', (c) => c.json({ backups: [], note: 'D1 automatic backups — use Cloudflare dashboard or Time Travel API' }));

admin.post('/database/analyze', async (c) => {
  try {
    const db = getDb(c.env);
    await execute(db, 'ANALYZE');
    return c.json({ success: true, message: 'ANALYZE completed' });
  } catch (err) {
    log.error('POST /database/analyze failed', { src: 'src/routes/admin.ts' }, err); return c.json({ error: 'ANALYZE failed' }, 500); }
});

// D1 rejects PRAGMA integrity_check outright (SQLITE_AUTH: "not authorized") —
// confirmed live via a direct d1_database_query probe, not just a Workers-runtime
// restriction. There's no substitute query that verifies page-level integrity,
// so this honestly reports the platform limitation (200, not_supported) instead
// of masking it as a fake "ok" (the pre-2026-07-20 stub) or a bare 500.
admin.on(['GET', 'POST'], '/database/integrity-check', async (c) => {
  try {
    const db = getDb(c.env);
    const row = await queryFirst<{ integrity_check: string }>(db, "PRAGMA integrity_check");
    const healthy = row?.integrity_check === 'ok';
    return c.json({ result: row?.integrity_check ?? 'unknown', ok: healthy, healthy });
  } catch (err) {
    return c.json({
      result: 'not_supported',
      ok: false,
      healthy: false,
      code: 'not_supported',
      message: 'D1 does not authorize PRAGMA integrity_check — Cloudflare manages storage integrity internally with no user-facing equivalent.',
    });
  }
});

admin.post('/database/vacuum', async (c) => {
  try {
    const db = getDb(c.env);
    const before = await queryFirst<{ page_count: number }>(db, 'PRAGMA page_count');
    return c.json({ success: true, page_count: before?.page_count ?? 0, note: 'D1 manages vacuuming automatically' });
  } catch (err) {
    log.error('POST /database/vacuum failed', { src: 'src/routes/admin.ts' }, err); return c.json({ error: 'Vacuum info failed' }, 500); }
});

// ── Purge endpoints ────────────────────────────────────────
admin.post('/purge/activity-logs', async (c) => {
  // Admin-only: this DELETEs from audit_log, i.e. it destroys the CJIS audit
  // trail — including the record of the actor's own prior access. Ungated,
  // any authenticated non-client_viewer role could erase the entire table
  // with `{"before_date":"9999-12-31"}`. Compare audit.ts /retention/enforce,
  // which correctly requires admin for the same class of deletion.
  const denied = forbidUnlessRole(c, 'admin');
  if (denied) return denied;
  try {
    const body: { before_date?: string; days_to_keep?: number } = await c.req.json().catch(() => ({}));
    const cutoff = body.before_date
      || new Date(Date.now() - (body.days_to_keep ?? 90) * 86400000).toISOString().slice(0, 10);
    const db = getDb(c.env);
    const r = await execute(db, `DELETE FROM audit_log WHERE created_at < ?`, cutoff);
    const deleted = r.meta.changes ?? 0;
    return c.json({ success: true, deleted, purged: deleted });
  } catch (err) {
    console.error('POST /purge/activity-logs failed:', err);
    return c.json({ success: false, error: 'Purge failed', deleted: 0, purged: 0 }, 500);
  }
});

admin.post('/purge/notifications', async (c) => {
  const denied = forbidUnlessRole(c, 'admin');
  if (denied) return denied;
  try {
    const body: { before_date?: string; days_to_keep?: number } = await c.req.json().catch(() => ({}));
    const cutoff = body.before_date
      || new Date(Date.now() - (body.days_to_keep ?? 30) * 86400000).toISOString().slice(0, 10);
    const db = getDb(c.env);
    const r = await execute(db, `DELETE FROM notifications WHERE created_at < ? AND COALESCE(read_at, '') != ''`, cutoff);
    const deleted = r.meta.changes ?? 0;
    return c.json({ success: true, deleted, purged: deleted });
  } catch (err) {
    console.error('POST /purge/notifications failed:', err);
    return c.json({ success: false, error: 'Purge failed', deleted: 0, purged: 0 }, 500);
  }
});

admin.post('/purge/sessions', async (c) => {
  // Deletes every inactive/expired session row. Ungated, any authenticated
  // account could mass-invalidate session bookkeeping.
  const denied = forbidUnlessRole(c, 'admin');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const r = await execute(db, `DELETE FROM sessions WHERE is_active = 0 OR expires_at < datetime('now')`);
    const deleted = r.meta.changes ?? 0;
    return c.json({ success: true, deleted, purged: deleted });
  } catch (err) {
    console.error('POST /purge/sessions failed:', err);
    return c.json({ success: false, error: 'Purge failed', deleted: 0, purged: 0 }, 500);
  }
});

// ── God-mode bulk call operations (AdminGodModeTab) ────────
// These two endpoints back buttons in client/src/pages/admin/AdminGodModeTab.tsx
// that previously POSTed to unmounted paths (404 → dead buttons).

// POST /admin/calls/bulk-reassign — reassign a set of calls to one officer.
admin.post('/calls/bulk-reassign', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  try {
    const db = getDb(c.env);
    const { call_ids, target_officer_id } = await c.req.json<{ call_ids?: number[]; target_officer_id?: number }>();
    const ids = (call_ids ?? []).map(Number).filter((n) => Number.isFinite(n));
    const officerId = Number(target_officer_id);
    if (!ids.length || !Number.isFinite(officerId)) return c.json({ error: 'call_ids and target_officer_id are required' }, 400);
    const officer = await queryFirst<{ full_name: string | null; username: string }>(db, 'SELECT full_name, username FROM users WHERE id = ?', officerId);
    if (!officer) return c.json({ error: 'Target officer not found' }, 404);
    // Chunked under D1's 100-bound-parameter cap (1 leading binding for
    // officerId + one per id). A bulk reassign of 100+ calls was rejected at
    // bind time and 500'd. NOT atomic across chunks — see executeInChunks; the
    // single-statement version had the same partial-failure exposure.
    const updated = await executeInChunks(
      db,
      ids,
      (ph) => `UPDATE calls_for_service SET reporting_officer_id = ?, updated_at = datetime('now') WHERE id IN (${ph})`,
      [officerId],
    );
    return c.json({ updated, target: officer.full_name || officer.username });
  } catch (err) {
    console.error('POST /admin/calls/bulk-reassign failed:', err);
    return c.json({ error: 'Bulk reassign failed' }, 500);
  }
});

// POST /admin/calls/force-close-all — close every open call with a disposition.
admin.post('/calls/force-close-all', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  try {
    const db = getDb(c.env);
    const { disposition } = await c.req.json<{ disposition?: string }>();
    const disp = String(disposition ?? 'Closed by Admin').slice(0, 200);
    const r = await execute(db,
      `UPDATE calls_for_service
          SET status = 'closed', closed_at = datetime('now'), disposition = ?, updated_at = datetime('now')
        WHERE ${ACTIVE_CALL_WHERE}`,
      disp);
    return c.json({ closed: r.meta.changes ?? 0 });
  } catch (err) {
    console.error('POST /admin/calls/force-close-all failed:', err);
    return c.json({ error: 'Force close failed' }, 500);
  }
});

// ── Read-only SQL query (admin diagnostic tool) ────────────
admin.post('/query', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  try {
    const { sql } = await c.req.json<{ sql: string }>();
    if (!sql) return c.json({ error: 'sql required' }, 400);
    const upper = sql.trim().toUpperCase();
    if (!upper.startsWith('SELECT') && !upper.startsWith('PRAGMA') && !upper.startsWith('EXPLAIN')) {
      return c.json({ error: 'Only SELECT, PRAGMA, and EXPLAIN queries allowed' }, 400);
    }
    const WRITE_KW = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|REPLACE|REINDEX)\b/i;
    if (WRITE_KW.test(sql)) {
      return c.json({ error: 'Write operations are not allowed in read-only query tool' }, 400);
    }
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, sql);
    return c.json({ data: rows, count: rows.length });
  } catch (err) {
    log.error('POST /admin/query failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Query failed' }, 400);
  }
});

// ── Activity feed (admin-wide recent actions) ──────────────
admin.get('/activity-feed', async (c) => {
  try {
    const db = getDb(c.env);
    const limit = Math.min(200, parseInt(c.req.query('limit') || '50', 10) || 50);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT a.*, u.full_name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT ?`, limit);
    return c.json({ data: rows, actions: rows });
  } catch (err) {
    log.error('admin GET /activity-feed failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ data: [], actions: [] });
  }
});

// ── Client-error telemetry (ErrorBoundary crash reports) ────
// ErrorBoundary POSTs { message, stack, componentStack, url, timestamp } on
// every client-side crash. A proxy stub swallowed these with a fake 200 since
// the boundary shipped — zero reports were ever stored. Backed by
// client_errors (migration 0088, exists on live D1).
admin.post('/health/client-error', async (c) => {
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const userId = (c.get('user') as { id: number } | undefined)?.id ?? null;
    const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null);
    await execute(db,
      `INSERT INTO client_errors (user_id, message, stack, component_stack, url, client_timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      userId, s(b.message, 2000), s(b.stack, 10000), s(b.componentStack, 10000), s(b.url, 1000), s(b.timestamp, 64));
    return c.json({ success: true });
  } catch {
    // Telemetry must never throw back at a crashing client.
    return c.json({ success: false });
  }
});

admin.get('/health/client-error', async (c) => {
  try {
    const db = getDb(c.env);
    const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50));
    const rows = await query<Record<string, unknown>>(db,
      `SELECT ce.*, u.full_name FROM client_errors ce LEFT JOIN users u ON u.id = ce.user_id
       ORDER BY ce.created_at DESC LIMIT ?`, limit);
    return c.json({ data: rows, errors: rows, total: rows.length });
  } catch (err) {
    log.error('admin GET /health/client-error failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ data: [], errors: [], total: 0 });
  }
});

// ── System settings (org-wide config) ──────────────────────
admin.get('/system-settings', async (c) => {
  // system_config is the SAME flat bag that PUT /third-party-keys writes
  // integration secrets into (microbilt_client_secret, traccar_password,
  // roboflow_api_key, …). This handler used to return the whole table with
  // no role check and no redaction, so any authenticated account — including
  // client_viewer, since a GET isn't blocked by readOnlyRoleGuard — could
  // read every third-party credential in plaintext. Mirror GET /config:
  // gate the role AND drop secret-shaped keys.
  const denied = forbidUnlessRole(c, 'admin', 'manager');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const rows = await query<{ config_key: string; config_value: string }>(db,
      `SELECT config_key, config_value FROM system_config ORDER BY config_key`);
    const settings: Record<string, unknown> = {};
    for (const r of rows) {
      if (SECRET_KEY_PATTERN.test(r.config_key)) continue;
      try { settings[r.config_key] = JSON.parse(r.config_value); } catch { settings[r.config_key] = r.config_value; }
    }
    return c.json(settings);
  } catch (err) {
    log.error('admin GET /system-settings failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({});
  }
});

admin.put('/system-settings', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || !['admin', 'manager'].includes(user.role)) return c.json({ error: 'Insufficient role' }, 403);
  try {
    const body = await c.req.json<Record<string, unknown>>();
    const db = getDb(c.env);
    for (const [key, value] of Object.entries(body)) {
      const val = typeof value === 'string' ? value : JSON.stringify(value);
      // Live system_config's UNIQUE index is COMPOSITE (config_key, config_value)
      // — no unique index on config_key alone, so ON CONFLICT(config_key) throws
      // on live D1 ("does not match any UNIQUE constraint"). DELETE+INSERT
      // collapses any multi-row history for the key to the single new value.
      await execute(db, `DELETE FROM system_config WHERE config_key = ?`, key);
      // `category` is REQUIRED here. system_config.category is NOT NULL DEFAULT
      // 'general', so omitting it silently filed every setting under 'general'
      // while AdminSystemTab reloads from GET /config-items → grouped.system_settings
      // — the panel's 60 fields saved and then reverted to defaults on refresh.
      // 'system_settings' is the convention src/routes/audit.ts:312 already uses.
      await execute(db,
        `INSERT INTO system_config (config_key, config_value, category, is_active, updated_at)
         VALUES (?, ?, 'system_settings', 1, datetime('now'))`,
        key, val);
    }
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /system-settings failed', { src: 'src/routes/admin.ts' }, err instanceof Error ? err : new Error(String(err))); return c.json({ error: err instanceof Error ? err.message : 'Failed' }, 500); }
});

// ── Map config ─────────────────────────────────────────────
// Rich map defaults — ported from legacy/server-vps/src/routes/adminMapConfig.ts.
// The client's AdminMapSettingsTab + useMapConfig hook expect this full key set
// (layer styling, clustering, GPS, markers, controls). Stored under config_key
// 'map_settings' (category 'map_settings') — the key the live data + legacy use.
// The previous handlers read/wrote 'map_config', a key with no live data, so the
// admin map tab always loaded the 3-key default and ignored the saved settings.
const MAP_DEFAULT_SETTINGS: Record<string, unknown> = {
  default_center_lat: 40.7608, default_center_lng: -111.891, default_zoom: 12,
  min_zoom: 1, max_zoom: 22, default_style: 'dark',
  enabled_styles: ['dark', 'night_nav', 'satellite', 'streets', 'terrain', 'light'],
  show_attribution: false, rotation_enabled: false,
  max_bounds_sw_lat: null, max_bounds_sw_lng: null, max_bounds_ne_lat: null, max_bounds_ne_lng: null,
  custom_style_url: '', clustering_enabled: true, cluster_radius: 50, cluster_max_zoom: 14,
  default_pitch: 0, default_bearing: 0, min_pitch: 0, max_pitch: 85,
  scroll_zoom: true, box_zoom: true, drag_rotate: true, drag_pan: true,
  double_click_zoom: true, touch_zoom_rotate: true, cooperative_gestures: false,
  show_compass: true, show_zoom_controls: true, keyboard_enabled: true,
  language: '', render_world_copies: true, fade_duration: 300, click_tolerance: 3,
  local_ideograph_font_family: '', cross_source_collisions: true,
  default_visible_layers: ['county', 'beat'],
  layer_beat_fill: '#22c55e', layer_beat_fill_opacity: 0.2, layer_beat_stroke: '#22c55e',
  layer_beat_stroke_opacity: 0.6, layer_beat_stroke_weight: 1.2, layer_beat_min_zoom: 10,
  layer_county_fill: '#141414', layer_county_fill_opacity: 0.15, layer_county_stroke: '#444444',
  layer_county_stroke_opacity: 0.5, layer_county_stroke_weight: 1.5, layer_county_min_zoom: 8,
  layer_municipality_fill: '#a855f7', layer_municipality_fill_opacity: 0.06, layer_municipality_stroke: '#a855f7',
  layer_municipality_stroke_opacity: 0.35, layer_municipality_stroke_weight: 1, layer_municipality_min_zoom: 9,
  layer_highway_stroke: '#ef4444', layer_highway_stroke_opacity: 0.6, layer_highway_stroke_weight: 3,
  layer_state_boundary_stroke: '#ffffff', layer_state_boundary_stroke_opacity: 0.3, layer_state_boundary_stroke_weight: 2,
  layer_place_fill: '#22c55e', layer_place_fill_opacity: 0.7, layer_place_stroke: '#22c55e',
  layer_place_stroke_opacity: 0.9, layer_place_stroke_weight: 1, layer_place_min_zoom: 10,
  gps_batch_interval_ms: 5000, gps_max_accuracy_meters: 100, gps_max_speed_ms: 80, gps_high_accuracy: true,
  screenshot_width: 1280, screenshot_height: 720, screenshot_style: 'dark',
  unit_marker_pulse: true, call_marker_pulse: true, marker_font_size: 9,
};

admin.get('/map-config', async (c) => {
  try {
    const db = getDb(c.env);
    const row = await queryFirst<{ config_value: string }>(db,
      `SELECT config_value FROM system_config WHERE config_key = 'map_settings' AND category = 'map_settings' AND is_active = 1 LIMIT 1`);
    let stored: Record<string, unknown> = {};
    if (row?.config_value) { try { stored = JSON.parse(row.config_value); } catch { stored = {}; } }
    return c.json({ ...MAP_DEFAULT_SETTINGS, ...stored });
  } catch (err) {
    log.error('admin GET /map-config failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ ...MAP_DEFAULT_SETTINGS });
  }
});

admin.put('/map-config', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || !['admin', 'manager'].includes(user.role)) return c.json({ error: 'Insufficient role' }, 403);
  try {
    const body = await c.req.json<Record<string, unknown>>();
    const merged = { ...MAP_DEFAULT_SETTINGS, ...body };
    const db = getDb(c.env);
    // Composite-unique-index trap (same as system-settings above): DELETE+INSERT,
    // never ON CONFLICT(config_key).
    await execute(db, `DELETE FROM system_config WHERE config_key = 'map_settings' AND category = 'map_settings'`);
    await execute(db,
      `INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at)
       VALUES ('map_settings', ?, 'map_settings', 0, 1, datetime('now'), datetime('now'))`,
      JSON.stringify(merged));
    return c.json(merged);
  } catch (err) {
    log.error('PUT /map-config failed', { src: 'src/routes/admin.ts' }, err instanceof Error ? err : new Error(String(err))); return c.json({ error: 'Failed' }, 500); }
});

// ── Impersonate (admin-only view-as) ───────────────────────
admin.post('/impersonate/:id', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  const user_id = parseInt(c.req.param('id'), 10);
  if (!user_id) return c.json({ error: 'user_id required' }, 400);
  try {
    const db = getDb(c.env);
    const target = await queryFirst<Record<string, unknown>>(db,
      `SELECT id, username, full_name, role, badge_number, status FROM users WHERE id = ?`, user_id);
    if (!target) return c.json({ error: 'User not found' }, 404);
    return c.json({ success: true, user: target, note: 'View-only impersonation — no token issued' });
  } catch (err) {
    log.error('POST /impersonate/:id failed', { src: 'src/routes/admin.ts' }, err instanceof Error ? err : new Error(String(err))); return c.json({ error: 'Failed' }, 500); }
});

// NOTE: '/settings/reset' used to be a no-op stub here. Removed 2026-07-20 —
// it resolved to the exact same final path as adminSettings.ts's real,
// working POST /reset (mounted at /api/admin/settings, so /reset there ==
// /api/admin/settings/reset here). Hono dispatches app.route() mounts in
// registration order (see src/index.ts), and this router is registered
// before adminSettings.ts in ROUTE_REGISTRY, so this fake-success stub was
// silently shadowing the real reset handler — the Console Settings "Reset"
// button returned a success toast but never actually reset anything.

// ── Shift plans (admin view) ──────────────────────────────
admin.get('/shift-plans', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM shift_plans WHERE active = 1 ORDER BY name LIMIT 100`);
    return c.json(rows);
  } catch (err) {
    log.error('admin GET /shift-plans failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json([]);
  }
});

// ── System lockdown ────────────────────────────────────────
// GET /admin/system/lockdown — current status (AdminGodModeTab loads this on mount).
admin.get('/system/lockdown', async (c) => {
  try {
    const db = getDb(c.env);
    const row = await queryFirst<{ config_value: string }>(db,
      `SELECT config_value FROM system_config WHERE config_key = 'system_lockdown'`);
    const parsed = row?.config_value ? JSON.parse(row.config_value) : { enabled: false };
    return c.json({ enabled: !!parsed.enabled, reason: parsed.reason ?? null, at: parsed.at ?? null });
  } catch (err) {
    log.error('admin GET /system/lockdown failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ enabled: false });
  }
});

admin.post('/system/lockdown', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  const body: { enabled?: boolean; reason?: string; message?: string; kick_sessions?: boolean } =
    await c.req.json().catch(() => ({}));
  const enabled = body.enabled ?? true;
  const reason = body.reason ?? body.message;
  try {
    const db = getDb(c.env);
    // Same composite-unique-index trap as system-settings above: live UNIQUE
    // is (config_key, config_value), so ON CONFLICT(config_key) throws.
    await execute(db, `DELETE FROM system_config WHERE config_key = 'system_lockdown'`);
    await execute(db,
      `INSERT INTO system_config (config_key, config_value, updated_at)
       VALUES ('system_lockdown', ?, datetime('now'))`,
      JSON.stringify({ enabled, reason: reason || null, at: new Date().toISOString() }));
    if (enabled && body.kick_sessions) {
      await execute(db, `UPDATE sessions SET is_active = 0`);
    }
    return c.json({ success: true, lockdown: enabled, enabled });
  } catch (err) {
    log.error('POST /system/lockdown failed', { src: 'src/routes/admin.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// DELETE /admin/system/lockdown — disable lockdown (AdminGodModeTab's toggle-off path).
admin.delete('/system/lockdown', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  try {
    const db = getDb(c.env);
    await execute(db, `DELETE FROM system_config WHERE config_key = 'system_lockdown'`);
    await execute(db,
      `INSERT INTO system_config (config_key, config_value, updated_at)
       VALUES ('system_lockdown', ?, datetime('now'))`,
      JSON.stringify({ enabled: false, at: new Date().toISOString() }));
    return c.json({ success: true, lockdown: false, enabled: false });
  } catch (err) {
    log.error('DELETE /system/lockdown failed', { src: 'src/routes/admin.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// ── Auth recovery ───────────────────────────────────────────
// POST /admin/auth/recover-all — moved to src/routes/auth.ts to bypass the
// auth middleware loop (no JWT needed when login is broken). Kept the mount
// signature here for any future admin-only recovery that assumes a valid
// session. The canonical endpoint lives on the auth router under
// POST /auth/recover-all (public at registry level, secured by RECOVERY_KEY
// env secret + X-Recovery-Key header).
