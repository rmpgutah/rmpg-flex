import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

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
admin.get('/departments', (c) => c.json([]));
admin.get('/retention', (c) => c.json([]));
admin.get('/retention/preview', (c) => c.json([]));
admin.get('/announcements/all', (c) => c.json([]));

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
admin.get('/maintenance-mode', (c) => c.json({
  enabled: false, message: null, scheduled_at: null,
}));

// ── Notification rules (no rule-engine table yet) ────────────
// AdminPage's notification settings tab tries to list rules on
// mount. No backing schema, so respond with an empty list. POST
// will continue to 404 until a real schema lands.
admin.get('/notification-rules', (c) => c.json([]));
