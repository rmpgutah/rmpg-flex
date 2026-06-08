import { Hono } from 'hono';
import type { Env } from '../types';

const stubs = new Hono<Env>();

// ── User Preferences — D1-backed (mounted at /api/user) ──
const PREF_DEFAULTS = {
  notify_dispatch_email: 1, notify_dispatch_inapp: 1,
  notify_bolo_email: 1, notify_bolo_inapp: 1,
  notify_warrant_email: 0, notify_warrant_inapp: 1,
  notify_system_email: 0, notify_system_inapp: 1,
  quiet_hours_start: null, quiet_hours_end: null,
  font_scale: 1.0, compact_mode: 0, show_map_labels: 1,
  default_map_style: 'dark', dispatch_sort: 'priority',
  dispatch_show_cleared: 0, theme_preference: 'dark',
} as const;

const PREF_COLUMNS = new Set<string>(Object.keys(PREF_DEFAULTS));

stubs.get('/preferences', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json(PREF_DEFAULTS);
  const row = await c.env.DB.prepare('SELECT * FROM user_preferences WHERE user_id = ?')
    .bind(userId).first();
  return c.json(row ? { ...PREF_DEFAULTS, ...row } : PREF_DEFAULTS);
});

stubs.put('/preferences', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json({ error: 'unauthorized' }, 401);
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { /* tolerate empty body */ }
  const keys = Object.keys(body).filter((k) => PREF_COLUMNS.has(k));
  if (keys.length === 0) return c.json({ success: true, updated: 0 });
  await c.env.DB.prepare('INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)')
    .bind(userId).run();
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => body[k] as string | number | null);
  await c.env.DB.prepare(
    `UPDATE user_preferences SET ${setClause}, updated_at = datetime('now') WHERE user_id = ?`,
  ).bind(...values, userId).run();
  const row = await c.env.DB.prepare('SELECT * FROM user_preferences WHERE user_id = ?')
    .bind(userId).first();
  return c.json({ success: true, preferences: row ? { ...PREF_DEFAULTS, ...row } : PREF_DEFAULTS });
});

stubs.post('/preferences/reset', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json({ error: 'unauthorized' }, 401);
  await c.env.DB.prepare('DELETE FROM user_preferences WHERE user_id = ?')
    .bind(userId).run();
  return c.json({ success: true, preferences: { ...PREF_DEFAULTS } });
});

// ── Notifications (mounted at /api/notifications) ──
stubs.get('/unread-count', (c) => c.json({ count: 0 }));
stubs.get('/notifications', (c) => c.json([]));

// ── Communication (mounted at /api/comms) ──
stubs.get('/activity-feed', (c) => c.json({ data: [] }));
stubs.get('/bolos/active', (c) => c.json([]));

// GET /api/comms/bolos/check?address=&subject=&vehicle= — active-BOLO match.
stubs.get('/bolos/check', async (c) => {
  try {
    const address = c.req.query('address') || '';
    const subject = c.req.query('subject') || '';
    const vehicle = c.req.query('vehicle') || '';
    if (!address && !subject && !vehicle) return c.json({ matches: [], count: 0 });

    const keywords = (text: string) =>
      text.toUpperCase().split(/[\s,;]+/).filter((w) => w.length >= 3).slice(0, 5);

    const matchClauses: string[] = [];
    const params: unknown[] = [];

    for (const kw of keywords(subject)) {
      matchClauses.push('(UPPER(subject_description) LIKE ? OR UPPER(description) LIKE ?)');
      params.push(`%${kw}%`, `%${kw}%`);
    }
    for (const kw of keywords(vehicle)) {
      matchClauses.push('(UPPER(vehicle_description) LIKE ? OR UPPER(description) LIKE ?)');
      params.push(`%${kw}%`, `%${kw}%`);
    }
    if (address && address.length >= 3) {
      matchClauses.push('UPPER(description) LIKE ?');
      params.push(`%${address.toUpperCase()}%`);
    }
    if (matchClauses.length === 0) return c.json({ matches: [], count: 0 });

    const sql = `
      SELECT id, bolo_number, type, title, description,
             subject_description, vehicle_description, priority,
             created_at, expires_at
      FROM bolos
      WHERE status = 'active' AND (${matchClauses.join(' OR ')})
      ORDER BY priority ASC, created_at DESC
      LIMIT 10`;
    const rows = await c.env.DB.prepare(sql).bind(...params).all();
    const matches = rows.results || [];
    return c.json({ matches, count: matches.length });
  } catch (err) {
    console.error('GET /comms/bolos/check failed:', err);
    return c.json({ matches: [], count: 0 });
  }
});

// ── Comms: drafts (no table yet) ──
stubs.get('/drafts', (c) => c.json([]));

// ── Comms: emergency broadcast ──
stubs.post('/emergency-broadcast', async (c) => {
  try {
    const body = await c.req.json<{ message?: string; priority?: string }>();
    if (!body.message?.trim()) return c.json({ error: 'message required' }, 400);
    return c.json({ success: true, broadcast_id: null, note: 'Emergency broadcast sent (notification fan-out not yet wired)' });
  } catch { return c.json({ error: 'Broadcast failed' }, 500); }
});

// ── Comms stats (mounted at /api/comms) — D1-backed aggregates ──
stubs.get('/bolos/stats', async (c) => {
  try {
    const db = c.env.DB;
    const [{ totalActive }] = (await db.prepare("SELECT COUNT(*) as totalActive FROM bolos WHERE status = 'active'").all()).results as any[];
    const [{ expiringSoon }] = (await db.prepare("SELECT COUNT(*) as expiringSoon FROM bolos WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= datetime('now', '+24 hours')").all()).results as any[];
    const byCategory = (await db.prepare("SELECT type as category, COUNT(*) as count, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count FROM bolos GROUP BY type ORDER BY type").all()).results as any[];
    const byPriority = (await db.prepare("SELECT priority, COUNT(*) as count FROM bolos WHERE status = 'active' GROUP BY priority ORDER BY priority").all()).results as any[];
    const avgLifespan = (await db.prepare("SELECT ROUND(AVG((julianday(expires_at) - julianday(created_at)) * 24), 1) as hours FROM bolos WHERE status IN ('expired','cancelled') AND expires_at IS NOT NULL").first()) as any;
    return c.json({
      byCategory: byCategory || [],
      byPriority: byPriority || [],
      totalActive: totalActive ?? 0,
      expiringSoon: expiringSoon ?? 0,
      avgLifespanHours: avgLifespan?.hours ?? null,
    });
  } catch (err) {
    console.error('GET /comms/bolos/stats failed:', err);
    return c.json({ byCategory: [], byPriority: [], totalActive: 0, expiringSoon: 0, avgLifespanHours: null });
  }
});

stubs.get('/messages/priority-stats', async (c) => {
  try {
    const db = c.env.DB;
    const byPriority = (await db.prepare("SELECT priority, COUNT(*) as total, SUM(CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END) as read_count, ROUND(AVG(CASE WHEN read_at IS NOT NULL THEN (julianday(read_at) - julianday(created_at)) * 24 * 60 END), 1) as avg_read_time_minutes FROM messages GROUP BY priority ORDER BY CASE priority WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END").all()).results as any[];
    const byChannel = (await db.prepare("SELECT channel, COUNT(*) as count FROM messages GROUP BY channel ORDER BY channel").all()).results as any[];
    return c.json({
      byPriority: byPriority || [],
      byChannel: byChannel || [],
    });
  } catch (err) {
    console.error('GET /comms/messages/priority-stats failed:', err);
    return c.json({ byPriority: [], byChannel: [] });
  }
});

// ── Stats dashboard (mounted at /api/stats) — used by ModuleDirectoryPage badges ──
stubs.get('/dashboard', (c) => c.json({
  open_cases: 0, pending_serve: 0, active_warrants: 0,
}));

// ── Weather (mounted at /api/weather) — uses /current to avoid GET / collision ──
stubs.get('/current', (c) => c.json({ temperature: 72, conditions: 'Clear', icon: 'clear-day' }));

// ── Email (mounted at /api/email) — /unread-count handled by line 56 (same stub serves both prefixes) ──

// ── Integrations (mounted at /api/integrations) ──
stubs.get('/google-maps/client-key', (c) => c.json({}));

// ── Dispatch stubs (mounted at /api/dispatch/stats) ──
// `stubs` is mounted at the EXACT prefix '/api/dispatch/stats', so '/' here
// matches /api/dispatch/stats (the bare mount point). Using '/stats' would
// have mapped to /api/dispatch/stats/stats — bug fixed 2026-06-06.
stubs.get('/', (c) => c.json({ total_calls: 0, active_calls: 0, units_online: 0 }));

// ── Integration stubs (Admin integrations tab) ──────────────
stubs.get('/status', (c) => c.json({ configured: false }));
stubs.get('/sources', (c) => c.json([]));
stubs.get('/vehicles', (c) => c.json([]));
stubs.get('/devices', (c) => c.json([]));
stubs.get('/jobs', (c) => c.json([]));
stubs.get('/config', (c) => c.json({}));

// ── ClearPathGPS stubs (mounted at /api/clearpathgps) ───────
stubs.get('/mappings', (c) => c.json([]));
stubs.get('/dashcam-events', (c) => c.json([]));
stubs.get('/dashcam-events/by-officer/:id', (c) => c.json([]));
stubs.get('/dashcam-events/export', (c) => c.json([]));
stubs.get('/credentials', (c) => c.json({ configured: false }));
stubs.get('/settings', (c) => c.json({}));
stubs.get('/media-settings', (c) => c.json({}));
stubs.get('/media-status', (c) => c.json({ syncing: false }));
stubs.post('/test-connection', (c) => c.json({ success: false, error: 'ClearPathGPS not configured' }));
stubs.post('/configure', (c) => c.json({ success: true }));
stubs.post('/enable', (c) => c.json({ success: true }));
stubs.post('/sync', (c) => c.json({ success: true }));
stubs.post('/media-sync-now', (c) => c.json({ success: true }));
stubs.post('/test', (c) => c.json({ success: false, error: 'ClearPathGPS not configured' }));
stubs.post('/discover-accounts', (c) => c.json([]));

// ── Code Enforcement (mounted at /api/code-enforcement) ────
stubs.get('/export/csv', (c) => {
  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', 'attachment; filename="code_violations_export.csv"');
  return c.body('');
});

// ── DAR export (mounted at /api/dar) ────
stubs.get('/export/csv', (c) => {
  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', 'attachment; filename="daily_activity_reports_export.csv"');
  return c.body('');
});

// ── Diagnostics (mounted at /api/diagnostics) ────
stubs.post('/ui-trap', async (c) => {
  return c.json({ received: true });
});

// ── Firecrawl tools (mounted at /api/firecrawl-tools) ────
stubs.post('/pdf-inspect/upload', async (c) => c.json({ pages: 0, text: '', error: 'Firecrawl not configured' }));
stubs.post('/doc-extract/upload', async (c) => c.json({ fields: {}, error: 'Firecrawl not configured' }));
stubs.post('/pdf-manipulate/upload', async (c) => c.json({ error: 'Firecrawl not configured' }));

// ── Mobile CFS (mounted at /api/mobile) ────
stubs.get('/cfs/:callId/challenge', (c) => c.json({ valid: false }));
stubs.post('/cfs/:callId/auth', async (c) => c.json({ authenticated: false }, 401));
stubs.get('/cfs/:callId/status', (c) => c.json({ status: 'unknown' }));

// ── CFS QR token (mounted at /api/cfs) ────
stubs.post('/:id/qr-token', async (c) => c.json({ token: null, error: 'QR token generation not available' }));

// ── PDF artifacts (mounted at /api/pdf-artifacts) ────
stubs.post('/', async (c) => c.json({ id: null, error: 'PDF artifact storage not configured' }, 501));

// ── PDF engine email (mounted at /api/pdf-engine) ────
stubs.post('/email', async (c) => c.json({ sent: false, error: 'Email delivery not configured' }, 501));

// ── Android update checker (mounted at /api/updates) ────
stubs.get('/check', (c) => c.json({ updateAvailable: false, currentVersion: c.req.query('currentVersion') || '0.0.0' }));

// ── Voice persona (mounted at /api/voice-persona) ────
stubs.get('/', (c) => c.json({ persona: null }));
stubs.put('/', async (c) => {
  try { const body = await c.req.json(); return c.json({ success: true, ...body }); }
  catch { return c.json({ success: true }); }
});

// ── Additional ClearPathGPS stubs (from main) ────
stubs.get('/dashcam-events/recent', (c) => c.json([]));
stubs.get('/dashcam-events/:id', (c) => c.json(null));
stubs.get('/live-locations', (c) => c.json([]));

export default stubs;
