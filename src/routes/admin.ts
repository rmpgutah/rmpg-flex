import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { fireRule, type NotificationRuleRow } from './notificationEngine';

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

// GET /admin/call-templates
admin.get('/call-templates', async (c) => {
  try {
    const db = getDb(c.env);
    const templates = await query<Record<string, unknown>>(db, 'SELECT * FROM call_templates ORDER BY name');
    return c.json(templates);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /admin/clients
admin.get('/clients', async (c) => {
  try {
    const db = getDb(c.env);
    const clients = await query<Record<string, unknown>>(db, 'SELECT * FROM clients ORDER BY name');
    return c.json(clients);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

export default admin;

// Stub admin endpoints
admin.get('/shift-stats', (c) => c.json([]));
admin.get('/upcoming-court-dates', (c) => c.json([]));
admin.get('/expiring-certifications', (c) => c.json([]));
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
  last_backup_at: null, status: 'unknown', size_bytes: 0, location: null,
}));
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
  'nsopw_api_key', 'ofac_api_key',
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
              (SELECT MAX(last_seen_at) FROM sessions s WHERE s.user_id = u.id AND s.is_active = 1) AS last_seen_at
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
