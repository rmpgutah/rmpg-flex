import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { fireRule, type NotificationRuleRow } from './notificationEngine';

const admin = new Hono<Env>();

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
      const key = String(row.key);
      const value = String(row.value ?? '');
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
  try {
    const db = getDb(c.env);
    const u = c.get('user');
    const b = await c.req.json<Record<string, unknown>>();
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) return c.json({ error: 'Rule name is required' }, 400);
    if (!b.trigger_event) return c.json({ error: 'Trigger event is required' }, 400);
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
    }, { testPrefix: true });
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
