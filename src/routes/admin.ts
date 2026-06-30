import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { fireRule, type NotificationRuleRow } from './notificationEngine';
import { getAnthropicKey, getClaudeModel, callClaude, diagnoseAnthropicError } from '../utils/anthropic';
import { getOpenAiKey, getOpenAiModel, callOpenAi, diagnoseOpenAiError } from '../utils/openai';

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

// GET /admin/config
// Returns flat key/value map from system_config + the structured
// `dispositions` array DispatchPage and DispositionPrompt expect.
// Dispositions come from system_config rows where key starts with
// 'disposition.' (each value is JSON {code, description, color?}),
// falling back to a baked-in common set so the Clear-call dropdown
// is never empty even on a fresh database.
admin.get('/config', async (c) => {
  try {
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || !new Set(['admin', 'manager', 'supervisor']).has(actor.role)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const db = getDb(c.env);
    const config = await query<Record<string, unknown>>(db, 'SELECT * FROM system_config');
    const result: Record<string, any> = {};
    const customDispositions: any[] = [];
    for (const row of config) {
      // Live system_config columns are config_key/config_value (NOT key/value);
      // reading key/value yielded "undefined" for every row, so custom
      // dispositions + flat config never loaded once this route goes live.
      const key = String(row.config_key);
      const value = String(row.config_value ?? '');
      // Disposition rows live under the 'disposition.<code>' namespace
      // so we can keep the flat key/value schema while still allowing
      // the client to consume them as a typed array.
      if (key.startsWith('disposition.')) {
        try {
          const parsed = JSON.parse(value);
          customDispositions.push({
            code: parsed.code,
            description: parsed.description,
            color: parsed.color,
            is_active: parsed.is_active !== false,
            // Keep `config_value` for backward-compat with the existing
            // client mapping that JSON.parses each row.
            config_value: value,
          });
        } catch { /* malformed row — skip */ }
      } else {
        result[key] = value;
      }
    }

    // Baked-in defaults so the dropdown is never empty on a fresh
    // database. Custom rows above OVERRIDE these by code (admin can
    // tweak description/color in system_config without losing the
    // built-in roster).
    const defaults = [
      { code: 'Report Taken',     description: 'Report Taken' },
      { code: 'Unfounded',        description: 'Unfounded' },
      { code: 'GOA',              description: 'Gone on Arrival' },
      { code: 'Referred',         description: 'Referred to other agency' },
      { code: 'No Action',        description: 'No Action Required' },
      { code: 'Arrest',           description: 'Arrest Made' },
      { code: 'Warning',          description: 'Warning Issued' },
      { code: 'Citation',         description: 'Citation Issued' },
      { code: 'Trespass Warning', description: 'Trespass Warning Issued' },
      { code: 'Civil Matter',     description: 'Civil Matter — No Action' },
      { code: 'Resolved',         description: 'Resolved on Scene' },
      { code: 'Transported',      description: 'Subject Transported' },
      { code: 'False Alarm',      description: 'False Alarm' },
      { code: 'Verbal Warning',   description: 'Verbal Warning Issued' },
      { code: 'Field Interview',  description: 'Field Interview (FI) Conducted' },
      { code: 'Counseled',        description: 'Subject Counseled' },
      { code: 'Documentation Only', description: 'Documentation Only' },
      { code: 'UTL',              description: 'Unable to Locate' },
      { code: 'Assist Rendered',  description: 'Assist Rendered' },
      { code: 'Negative Contact', description: 'Negative Contact' },
      { code: 'Patrol Completed', description: 'Patrol Completed' },
      { code: 'Premise Secured',  description: 'Premise Secured' },
      { code: 'Owner Notified',   description: 'Owner/Keyholder Notified' },
      { code: 'Vehicle Towed',    description: 'Vehicle Towed' },
      { code: 'Standby Complete', description: 'Standby Complete' },
      // Process Service outcomes (paper service — pso_client_request / process_service calls).
      // Namespaced with a 'PS ' code prefix so they group together and never
      // collide with the law-enforcement codes above. Per-attempt diligence
      // tracking still lives in the dedicated serve subsystem (serve_attempts);
      // these are the call-level closeout codes.
      { code: 'PS Served',            description: 'Process Served — Personal' },
      { code: 'PS Sub-Served',        description: 'Process Served — Substitute' },
      { code: 'PS Posted',            description: 'Process Served — Posted & Mailed' },
      { code: 'PS Corporate',         description: 'Process Served — Corporate/Registered Agent' },
      { code: 'PS Mailed',            description: 'Process Served — By Mail' },
      { code: 'PS Non-Service',       description: 'Process — Unable to Serve' },
      { code: 'PS Evasive',           description: 'Process — Evasive / Avoiding Service' },
      { code: 'PS Vacant',            description: 'Process — Vacant / Unoccupied' },
      { code: 'PS No Access',         description: 'Process — Gated / No Access' },
      { code: 'PS Unknown',           description: 'Process — Recipient Unknown at Address' },
      { code: 'PS Out of Jurisdiction', description: 'Process — Out of Jurisdiction' },
      { code: 'PS Recalled',          description: 'Process — Recalled by Client' },
      { code: 'PS Non Est',           description: 'Process — Returned Non-Est (Return of Service Filed)' },
      { code: 'Cancelled',        description: 'Call Cancelled' },
    ];
    const overrideCodes = new Set(customDispositions.map((d) => d.code));
    const merged = [
      ...customDispositions,
      ...defaults
        .filter((d) => !overrideCodes.has(d.code))
        .map((d) => ({
          ...d,
          is_active: true,
          config_value: JSON.stringify(d),
        })),
    ];

    result.dispositions = merged;
    return c.json(result);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
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
    sets.push("updated_at = datetime('now','localtime')");
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
    return c.json({ error: 'Failed to delete config', detail: (err as Error).message }, 500);
  }
});

// GET /admin/call-templates
admin.get('/call-templates', async (c) => {
  try {
    const db = getDb(c.env);
    const templates = await query<Record<string, unknown>>(db, 'SELECT * FROM call_templates ORDER BY name');
    return c.json(templates);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// ── /admin/clients — full CRUD (AdminPage, CrmPage, IncidentsPage all call this prefix) ──
admin.get('/clients', async (c) => {
  try {
    const db = getDb(c.env);
    const status = c.req.query('status');
    const sql = status
      ? 'SELECT * FROM clients WHERE status = ? ORDER BY name'
      : 'SELECT * FROM clients ORDER BY name';
    return c.json(status ? await query(db, sql, status) : await query(db, sql));
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

admin.get('/clients/:id', async (c) => {
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
  } catch { return c.json({ error: 'Failed' }, 500); }
});

admin.get('/clients/:id/incidents', async (c) => {
  try {
    const db = getDb(c.env);
    return c.json(await query(db, `SELECT id, incident_number, occurred_date, status, incident_type FROM incidents WHERE client_id = ? ORDER BY occurred_date DESC LIMIT 100`, Number(c.req.param('id'))));
  } catch { return c.json([]); }
});

admin.get('/clients/:id/calls', async (c) => {
  try {
    const db = getDb(c.env);
    return c.json(await query(db, `SELECT id, call_number, created_at, status, incident_type, priority FROM calls_for_service WHERE client_id = ? ORDER BY created_at DESC LIMIT 100`, Number(c.req.param('id'))));
  } catch { return c.json([]); }
});

admin.get('/clients/:id/billing', async (c) => {
  try {
    const db = getDb(c.env);
    const client = await queryFirst<Record<string, unknown>>(db, 'SELECT total_invoiced, total_paid, outstanding_balance, billing_cycle, payment_terms, rate_per_hour, rate_per_incident, rate_per_cfs FROM clients WHERE id = ?', Number(c.req.param('id')));
    return c.json(client || {});
  } catch { return c.json({}); }
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
  } catch (e) { return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
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
  } catch (e) { return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

admin.delete('/clients/:id', async (c) => {
  try {
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || !new Set(['admin', 'manager']).has(actor.role)) return c.json({ error: 'Forbidden' }, 403);
    const db = getDb(c.env);
    await execute(db, "UPDATE clients SET status = 'inactive', updated_at = datetime('now') WHERE id = ?", Number(c.req.param('id')));
    return c.json({ success: true });
  } catch (e) { return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

admin.post('/clients/:id/archive', async (c) => {
  try {
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || !new Set(['admin', 'manager']).has(actor.role)) return c.json({ error: 'Forbidden' }, 403);
    const db = getDb(c.env);
    await execute(db, "UPDATE clients SET status = 'inactive', updated_at = datetime('now') WHERE id = ?", Number(c.req.param('id')));
    return c.json({ success: true });
  } catch (e) { return c.json({ error: 'Failed' }, 500); }
});

admin.post('/clients/:id/unarchive', async (c) => {
  try {
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || !new Set(['admin', 'manager']).has(actor.role)) return c.json({ error: 'Forbidden' }, 403);
    const db = getDb(c.env);
    await execute(db, "UPDATE clients SET status = 'active', updated_at = datetime('now') WHERE id = ?", Number(c.req.param('id')));
    return c.json({ success: true });
  } catch (e) { return c.json({ error: 'Failed' }, 500); }
});

export default admin;

// ── Admin dashboard data endpoints ──
admin.get('/shift-stats', async (c) => {
  try {
    const db = getDb(c.env);
    const now = new Date();
    const shiftHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/Denver', hour: '2-digit', hour12: false }), 10);
    const shiftName = shiftHour >= 6 && shiftHour < 14 ? 'Day' : shiftHour >= 14 && shiftHour < 22 ? 'Swing' : 'Night';
    const startHour = shiftName === 'Day' ? 6 : shiftName === 'Swing' ? 14 : 22;
    const endHour = shiftName === 'Day' ? 14 : shiftName === 'Swing' ? 22 : 6;
    const dateCondition = shiftName === 'Night'
      ? `(CAST(strftime('%H', created_at) AS INTEGER) >= ${startHour} OR CAST(strftime('%H', created_at) AS INTEGER) < ${endHour})`
      : `CAST(strftime('%H', created_at) AS INTEGER) BETWEEN ${startHour} AND ${endHour - 1}`;
    const calls = (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM calls_for_service WHERE ${dateCondition}`))?.n ?? 0;
    const incidents = (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM incidents WHERE ${dateCondition}`))?.n ?? 0;
    const citations = (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM citations WHERE ${dateCondition.replace('created_at','issued_at')}`))?.n ?? 0;
    const patrolScans = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM patrol_scans'))?.n ?? 0;
    return c.json({ shift_name: shiftName, calls, incidents, citations, patrol_scans: patrolScans });
  } catch { return c.json({ shift_name: 'Unknown', calls: 0, incidents: 0, citations: 0, patrol_scans: 0 }); }
});

admin.get('/upcoming-court-dates', async (c) => {
  try {
    const db = getDb(c.env);
    const days = parseInt(c.req.query('days') || '30', 10);
    const rows = await query<{ date: string; case_number: string; officer_name: string }>(db,
      `SELECT ce.hearing_date AS date, ce.case_number, COALESCE(u.full_name, 'Unassigned') AS officer_name
       FROM court_events ce LEFT JOIN users u ON u.id = ce.officer_id
       WHERE ce.hearing_date BETWEEN DATE('now') AND DATE('now','+${Math.min(days, 90)} days')
       ORDER BY ce.hearing_date LIMIT 50`);
    return c.json({ count: rows.length, dates: rows });
  } catch { return c.json({ count: 0, dates: [] }); }
});

admin.get('/expiring-certifications', async (c) => {
  try {
    const db = getDb(c.env);
    const days = parseInt(c.req.query('days') || '30', 10);
    const rows = await query<{ officer_name: string; cert: string; days_left: number; expiry_date: string }>(db,
      `SELECT COALESCE(u.full_name, 'Unknown') AS officer_name, pc.certification_type AS cert,
              CAST(julianday(pc.expiry_date) - julianday('now') AS INTEGER) AS days_left, pc.expiry_date
       FROM personnel_certifications pc LEFT JOIN users u ON u.id = pc.user_id
       WHERE pc.expiry_date BETWEEN DATE('now') AND DATE('now','+${Math.min(days, 90)} days')
       ORDER BY pc.expiry_date LIMIT 30`);
    const expired = await query<{ officer_name: string; cert: string; days_left: number }>(db,
      `SELECT COALESCE(u.full_name, 'Unknown') AS officer_name, pc.certification_type AS cert,
              CAST(julianday('now') - julianday(pc.expiry_date) AS INTEGER) AS days_left
       FROM personnel_certifications pc LEFT JOIN users u ON u.id = pc.user_id
       WHERE pc.expiry_date < DATE('now') ORDER BY pc.expiry_date LIMIT 20`);
    return c.json({ expiring_count: rows.length, expired_count: expired.length, items: [...rows, ...expired.map(e => ({ ...e, expiry_date: 'EXPIRED' }))] });
  } catch { return c.json({ expiring_count: 0, expired_count: 0, items: [] }); }
});

admin.get('/google-maps-config', (c) => c.json({}));
admin.get('/config/branding', (c) => c.json([]));

// ── AdminHealthTab observability stubs ──────────────────────
// AdminHealthTab.tsx polls these on mount + every 60s. Without
// these stubs the console flooded with 404s every minute.
// Shapes match the TypeScript interfaces in AdminHealthTab.tsx
// (HealthData, ChangelogData, plus the inline shape for
// systemHealth/usersActivity/realtimeStats). The UI uses
// optional chaining throughout so null/zero values render as
// "—" or "0" rather than crashing. Promote any of these to
// real queries in a follow-up — D1 size + host metrics aren't
// available to a Worker so the host block stays undefined.
admin.get('/health/detailed', (c) => c.json({
  version: '1.0.0',
  server: {
    uptime: 0,
    memory: { rss: 0, heapUsed: 0, heapTotal: 0, external: 0 },
    nodeVersion: 'workerd',
  },
  database: { sizeBytes: 0, tables: {} },
  operations: { activeSessions: 0, activeUnits: 0, pendingCalls: 0, connectedClients: 0 },
  loginStats: { successful24h: 0, failed24h: 0 },
  recentErrors: [],
}));

admin.get('/changelog', (c) => c.json({
  version: '1.0.0',
  changelog: [],
}));

// Returning null lets the client's `d && setSystemHealth(d)`
// guard skip the setState, keeping the panel hidden until a
// real impl ships rather than rendering a frame of zeros.
admin.get('/system-health', (c) => c.json(null));

admin.get('/users-activity-summary', (c) => c.json({ data: [] }));

admin.get('/realtime-stats', (c) => c.json({
  activeCalls: 0,
  unitsOnDuty: 0,
  pendingIncidents: 0,
  activeBolos: 0,
  activeSessions: 0,
  todayActivity: 0,
  todayCalls: 0,
}));

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
admin.get('/api-stats', (c) => c.json({
  data: [], total_requests: 0, error_count: 0, avg_response_ms: 0,
  by_endpoint: [], by_day: [],
}));
admin.get('/user-activity-heatmap', (c) => c.json({
  data: [], cells: [], peak_hour: null, peak_day: null,
}));
admin.get('/backup-status', (c) => c.json({
  data: { last_backup_at: null, status: 'unknown', size_bytes: 0, location: null },
}));
admin.get('/config-history', async (c) => {
  try {
    const db = getDb(c.env);
    const limit = Math.min(Number(c.req.query('limit') || 20), 100);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT al.* FROM activity_log al
       WHERE al.action IN ('config_update','setting_update','system_config_update')
       ORDER BY al.created_at DESC LIMIT ?`, limit);
    return c.json({ data: rows });
  } catch { return c.json({ data: [] }); }
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
  sets.push(`updated_at = datetime('now','localtime')`);
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
    return c.json({ error: 'Failed to create department', detail: String(err) }, 500);
  }
});

admin.put('/departments/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
    const b = await c.req.json<Record<string, unknown>>();
    // Never let a department become its own parent.
    if (b.parent_id != null && Number(b.parent_id) === id) b.parent_id = null;
    const upd = buildPartialUpdate(b, ['name', 'code', 'description', 'parent_id', 'manager_id', 'is_active']);
    if (!upd) return c.json({ error: 'No fields to update' }, 400);
    await execute(db, `UPDATE departments SET ${upd.setSql} WHERE id = ?`, ...upd.values, id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to update department', detail: String(err) }, 500);
  }
});

admin.delete('/departments/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
    await execute(db, `DELETE FROM departments WHERE id = ?`, id);
    return c.json({ success: true });
  } catch (err) {
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
    return c.json({ error: 'Failed to create announcement', detail: String(err) }, 500);
  }
});

admin.put('/announcements/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
    const b = await c.req.json<Record<string, unknown>>();
    const upd = buildPartialUpdate(b, ['title', 'body', 'type', 'priority', 'target_roles', 'is_active', 'starts_at', 'expires_at']);
    if (!upd) return c.json({ error: 'No fields to update' }, 400);
    await execute(db, `UPDATE announcements SET ${upd.setSql} WHERE id = ?`, ...upd.values, id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to update announcement', detail: String(err) }, 500);
  }
});

admin.delete('/announcements/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
    await execute(db, `DELETE FROM announcements WHERE id = ?`, id);
    return c.json({ success: true });
  } catch (err) {
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
    return c.json({ error: 'Failed to create rule', detail: String(err) }, 500);
  }
});

admin.put('/notification-rules/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
    const b = await c.req.json<Record<string, unknown>>();
    const upd = buildPartialUpdate(b, ['name', 'description', 'trigger_event', 'conditions', 'target_roles', 'target_user_ids', 'notification_type', 'is_active']);
    if (!upd) return c.json({ error: 'No fields to update' }, 400);
    await execute(db, `UPDATE notification_rules SET ${upd.setSql} WHERE id = ?`, ...upd.values, id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to update rule', detail: String(err) }, 500);
  }
});

admin.delete('/notification-rules/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
    await execute(db, `DELETE FROM notification_rules WHERE id = ?`, id);
    return c.json({ success: true });
  } catch (err) {
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
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
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
      `UPDATE system_config SET config_value = ?, updated_at = datetime('now','localtime') WHERE config_key = ?`,
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
  'have_i_been_pwned_key', 'censys_api_key', 'hunter_io_api_key', 'numverify_api_key',
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
        `UPDATE system_config SET config_value = ?, is_active = 1, updated_at = datetime('now','localtime') WHERE config_key = ?`,
        value, key,
      );
    } else {
      await execute(
        db,
        `INSERT INTO system_config (config_key, config_value, category, is_active, created_at, updated_at)
         VALUES (?, ?, 'integrations', 1, datetime('now','localtime'), datetime('now','localtime'))`,
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
      `UPDATE system_config SET config_value = '', is_active = 0, updated_at = datetime('now','localtime') WHERE config_key = ?`,
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

admin.get('/sessions', (c) => c.json([]));
admin.get('/database/stats', (c) => c.json({ tables: 0, rows: 0, size_mb: 0 }));
admin.get('/system-overview', (c) => c.json({ status: 'ok', uptime: 0, workers: 1 }));

// GET /api/admin/users/presence — minimal presence snapshot for the
// God Mode page. Reuses the users table + a sub-query against sessions.
admin.get('/users/presence', async (c) => {
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
admin.get('/ia/complaints', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM ia_complaints ORDER BY created_at DESC LIMIT 200`);
    return c.json(rows);
  } catch (err) { console.error('GET /ia/complaints failed:', err); return c.json([]); }
});

admin.get('/ia/disciplinary', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM disciplinary_records ORDER BY created_at DESC LIMIT 200`);
    return c.json(rows);
  } catch (err) { console.error('GET /ia/disciplinary failed:', err); return c.json([]); }
});

admin.get('/ia/stats', async (c) => {
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
admin.get('/database/backup', (c) => c.json({ message: 'D1 backups are managed by Cloudflare automatically', last_backup: null }));
admin.get('/database/backups', (c) => c.json({ backups: [], note: 'D1 automatic backups — use Cloudflare dashboard or Time Travel API' }));

admin.post('/database/analyze', async (c) => {
  try {
    const db = getDb(c.env);
    await execute(db, 'ANALYZE');
    return c.json({ success: true, message: 'ANALYZE completed' });
  } catch (err) { return c.json({ error: 'ANALYZE failed' }, 500); }
});

admin.get('/database/integrity-check', async (c) => {
  try {
    const db = getDb(c.env);
    const row = await queryFirst<{ integrity_check: string }>(db, "PRAGMA integrity_check");
    return c.json({ result: row?.integrity_check ?? 'unknown', ok: row?.integrity_check === 'ok' });
  } catch (err) { return c.json({ error: 'Integrity check failed' }, 500); }
});

admin.post('/database/vacuum', async (c) => {
  try {
    const db = getDb(c.env);
    const before = await queryFirst<{ page_count: number }>(db, 'PRAGMA page_count');
    return c.json({ success: true, page_count: before?.page_count ?? 0, note: 'D1 manages vacuuming automatically' });
  } catch { return c.json({ error: 'Vacuum info failed' }, 500); }
});

// ── Purge endpoints ────────────────────────────────────────
admin.post('/purge/activity-logs', async (c) => {
  try {
    const body: { before_date?: string } = await c.req.json().catch(() => ({}));
    const cutoff = body.before_date || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const db = getDb(c.env);
    const r = await execute(db, `DELETE FROM audit_log WHERE created_at < ?`, cutoff);
    return c.json({ success: true, deleted: r.meta.changes ?? 0 });
  } catch (err) {
    console.error('POST /purge/activity-logs failed:', err);
    return c.json({ success: false, error: 'Purge failed', deleted: 0 }, 500);
  }
});

admin.post('/purge/notifications', async (c) => {
  try {
    const body: { before_date?: string } = await c.req.json().catch(() => ({}));
    const cutoff = body.before_date || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const db = getDb(c.env);
    const r = await execute(db, `DELETE FROM notifications WHERE created_at < ? AND COALESCE(read_at, '') != ''`, cutoff);
    return c.json({ success: true, deleted: r.meta.changes ?? 0 });
  } catch (err) {
    console.error('POST /purge/notifications failed:', err);
    return c.json({ success: false, error: 'Purge failed', deleted: 0 }, 500);
  }
});

admin.post('/purge/sessions', async (c) => {
  try {
    const db = getDb(c.env);
    const r = await execute(db, `DELETE FROM sessions WHERE is_active = 0 OR expires_at < datetime('now')`);
    return c.json({ success: true, deleted: r.meta.changes ?? 0 });
  } catch (err) {
    console.error('POST /purge/sessions failed:', err);
    return c.json({ success: false, error: 'Purge failed', deleted: 0 }, 500);
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
    const placeholders = ids.map(() => '?').join(',');
    const r = await execute(db,
      `UPDATE calls_for_service SET reporting_officer_id = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`,
      officerId, ...ids);
    return c.json({ updated: r.meta.changes ?? 0, target: officer.full_name || officer.username });
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
        WHERE status NOT IN ('cleared','closed','cancelled','archived')`,
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
  } catch (err: any) {
    console.error('POST /admin/query failed:', err);
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
    return c.json({ data: rows });
  } catch { return c.json({ data: [] }); }
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
  } catch { return c.json({ data: [], errors: [], total: 0 }); }
});

// ── System settings (org-wide config) ──────────────────────
admin.get('/system-settings', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<{ config_key: string; config_value: string }>(db,
      `SELECT config_key, config_value FROM system_config ORDER BY config_key`);
    const settings: Record<string, unknown> = {};
    for (const r of rows) {
      try { settings[r.config_key] = JSON.parse(r.config_value); } catch { settings[r.config_key] = r.config_value; }
    }
    return c.json(settings);
  } catch { return c.json({}); }
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
      await execute(db,
        `INSERT INTO system_config (config_key, config_value, updated_at) VALUES (?, ?, datetime('now'))`,
        key, val);
    }
    return c.json({ success: true });
  } catch (err: any) { return c.json({ error: err?.message || 'Failed' }, 500); }
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
  } catch { return c.json({ ...MAP_DEFAULT_SETTINGS }); }
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
  } catch (err: any) { return c.json({ error: 'Failed' }, 500); }
});

// ── Impersonate (admin-only view-as) ───────────────────────
admin.post('/impersonate', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  const { user_id } = await c.req.json<{ user_id: number }>().catch(() => ({ user_id: 0 }));
  if (!user_id) return c.json({ error: 'user_id required' }, 400);
  try {
    const db = getDb(c.env);
    const target = await queryFirst<Record<string, unknown>>(db,
      `SELECT id, username, full_name, role, badge_number, status FROM users WHERE id = ?`, user_id);
    if (!target) return c.json({ error: 'User not found' }, 404);
    return c.json({ success: true, user: target, note: 'View-only impersonation — no token issued' });
  } catch { return c.json({ error: 'Failed' }, 500); }
});

// ── Config history ─────────────────────────────────────────
admin.get('/config-history', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM config_audit_log ORDER BY created_at DESC LIMIT 200`);
    return c.json({ data: rows });
  } catch { return c.json({ data: [] }); }
});

// ── Settings reset ─────────────────────────────────────────
admin.post('/settings/reset', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  return c.json({ success: true, message: 'Settings reset to defaults', note: 'No-op — org settings require manual review before reset' });
});

// ── Shift plans (admin view) ──────────────────────────────
admin.get('/shift-plans', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM shift_plans WHERE active = 1 ORDER BY name LIMIT 100`);
    return c.json(rows);
  } catch { return c.json([]); }
});

// ── System lockdown ────────────────────────────────────────
admin.post('/system/lockdown', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  const { enabled, reason }: { enabled: boolean; reason?: string } = await c.req.json().catch(() => ({ enabled: false }));
  try {
    const db = getDb(c.env);
    // Same composite-unique-index trap as system-settings above: live UNIQUE
    // is (config_key, config_value), so ON CONFLICT(config_key) throws.
    await execute(db, `DELETE FROM system_config WHERE config_key = 'system_lockdown'`);
    await execute(db,
      `INSERT INTO system_config (config_key, config_value, updated_at)
       VALUES ('system_lockdown', ?, datetime('now'))`,
      JSON.stringify({ enabled, reason: reason || null, at: new Date().toISOString() }));
    return c.json({ success: true, lockdown: enabled });
  } catch { return c.json({ error: 'Failed' }, 500); }
});

// ── Auth recovery ───────────────────────────────────────────
// POST /admin/auth/recover-all — moved to src/routes/auth.ts to bypass the
// auth middleware loop (no JWT needed when login is broken). Kept the mount
// signature here for any future admin-only recovery that assumes a valid
// session. The canonical endpoint lives on the auth router under
// POST /auth/recover-all (public at registry level, secured by RECOVERY_KEY
// env secret + X-Recovery-Key header).
