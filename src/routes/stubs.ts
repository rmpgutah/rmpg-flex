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

// ── Notifications (mounted at /api/notifications) ──
stubs.get('/unread-count', (c) => c.json({ count: 0 }));
stubs.get('/notifications', (c) => c.json([]));

// ── Communication (mounted at /api/comms) ──
stubs.get('/activity-feed', (c) => c.json([]));
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

// ── Weather (mounted at /api/weather) — uses /current to avoid GET / collision ──
stubs.get('/current', (c) => c.json({ temperature: 72, conditions: 'Clear', icon: 'clear-day' }));

// ── Email (mounted at /api/email) — uses /unread-count (no collision) ──
stubs.get('/unread-count', (c) => c.json({ count: 0 }));

// ── Integrations (mounted at /api/integrations) ──
stubs.get('/google-maps/client-key', (c) => c.json({}));

// ── Dispatch stubs (mounted at /api/dispatch/stats + /api/dispatch/shift-handoff) ──
stubs.get('/stats', (c) => c.json({ total_calls: 0, active_calls: 0, units_online: 0 }));
stubs.get('/shift-handoff', (c) => c.json({ handoff: null }));
stubs.put('/shift-handoff', async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json({ success: true, saved: true, received: body });
  } catch {
    return c.json({ success: true, saved: true });
  }
});

export default stubs;
