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
stubs.get('/activity-feed', async (c) => {
  if (c.get('userId') == null) return c.json({ data: [], total: 0, limit: 50, offset: 0 });
  try {
    const db = c.env.DB;
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 200);
    const offset = parseInt(c.req.query('offset') || '0', 10) || 0;
    const [{ total }] = (await db.prepare('SELECT COUNT(*) as total FROM audit_log').all()).results as { total: number }[];
    const rows = (await db.prepare(
      `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id, al.details,
              al.ip_address, al.created_at,
              u.full_name as user_name, u.badge_number, u.role as user_role
       FROM audit_log al LEFT JOIN users u ON u.id = al.user_id
       ORDER BY al.created_at DESC LIMIT ? OFFSET ?`
    ).bind(limit, offset).all()).results as any[];
    return c.json({ data: rows, total: total ?? 0, limit, offset });
  } catch (err) {
    console.error('GET /comms/activity-feed failed:', err);
    return c.json({ data: [], total: 0, limit: 50, offset: 0 });
  }
});
stubs.get('/bolos/active', (c) => c.json([]));

// GET /api/comms/bolos/check?address=&subject=&vehicle= — active-BOLO match.
stubs.get('/bolos/check', async (c) => {
  // The same `stubs` router is also mounted at /api/diagnostics + /api/updates
  // as auth:'public' (for /ui-trap and /check). authMiddleware only sets
  // userId on the auth:'required' mounts, so this gate keeps live BOLO data
  // (subject_description, vehicle_description, priority) from leaking publicly.
  if (c.get('userId') == null) return c.json({ error: 'unauthorized' }, 401);
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

// ── Comms: messages CRUD (mounted at /api/comms) ──
// GET /messages — inbox for the authenticated user (sent + received, paginated).
stubs.get('/messages', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json({ error: 'unauthorized' }, 401);
  try {
    const db = c.env.DB;
    const limit = Math.min(parseInt(c.req.query('limit') || '200', 10) || 200, 500);
    const rows = (await db.prepare(
      `SELECT m.*,
              f.full_name  AS from_name, f.badge_number AS from_badge,
              t.full_name  AS to_name
       FROM messages m
       LEFT JOIN users f ON f.id = m.from_user_id
       LEFT JOIN users t ON t.id = m.to_user_id
       WHERE (m.to_user_id = ? OR m.from_user_id = ? OR m.channel IN ('broadcast','dispatch','zone'))
         AND (m.is_draft IS NULL OR m.is_draft = 0)
       ORDER BY m.created_at DESC LIMIT ?`
    ).bind(userId, userId, limit).all()).results as any[];
    const [{ unreadCount }] = (await db.prepare(
      `SELECT COUNT(*) as unreadCount FROM messages
       WHERE (to_user_id = ? OR channel IN ('broadcast','dispatch','zone'))
         AND read_at IS NULL AND (is_draft IS NULL OR is_draft = 0)`
    ).bind(userId).all()).results as { unreadCount: number }[];
    return c.json({ data: rows, unreadCount: unreadCount ?? 0 });
  } catch (err) {
    console.error('GET /comms/messages failed:', err);
    return c.json({ data: [], unreadCount: 0 });
  }
});

// POST /messages — send a new direct/broadcast message.
stubs.post('/messages', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json({ error: 'unauthorized' }, 401);
  try {
    const db = c.env.DB;
    const body = await c.req.json<{
      to_user_id?: number | string | null;
      channel?: string;
      content?: string;
      subject?: string;
      priority?: string;
      parent_id?: number | string | null;
    }>();
    const content = (body.content || '').trim();
    if (!content) return c.json({ error: 'content is required' }, 400);
    const channel = body.channel === 'broadcast' ? 'broadcast' : 'direct';
    const toUserId = channel === 'broadcast' ? null : (body.to_user_id ? Number(body.to_user_id) : null);
    // Derive thread_id:
    //  • Replies: use the parent's thread_id, or the parent's own id if the
    //    parent has no thread_id (it was a root message sent before threading).
    //  • Root messages: set thread_id to the newly-inserted row's own id so
    //    future replies can anchor their thread correctly. We do this in a
    //    second UPDATE after insert.
    let threadId: string | null = null;
    if (body.parent_id) {
      const parent = await db.prepare('SELECT id, thread_id FROM messages WHERE id = ?')
        .bind(Number(body.parent_id)).first() as { id: number; thread_id: string | null } | null;
      threadId = parent ? (parent.thread_id || String(parent.id)) : null;
    }
    const result = await db.prepare(
      `INSERT INTO messages (from_user_id, to_user_id, channel, content, subject, priority, parent_id, thread_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`
    ).bind(
      userId,
      toUserId,
      channel,
      content,
      (body.subject || '').trim() || null,
      body.priority || 'routine',
      body.parent_id ? Number(body.parent_id) : null,
      threadId,
    ).run();
    const newId = result.meta.last_row_id as number;
    // Root messages self-anchor their thread_id so future replies know the root.
    if (!body.parent_id) {
      await db.prepare('UPDATE messages SET thread_id = ? WHERE id = ? AND thread_id IS NULL')
        .bind(String(newId), newId).run();
    }
    const created = await db.prepare('SELECT * FROM messages WHERE id = ?').bind(newId).first();
    return c.json(created, 201);
  } catch (err) {
    console.error('POST /comms/messages failed:', err);
    return c.json({ error: 'Failed to send message' }, 500);
  }
});

// PUT /messages/:id/read — mark a single message as read.
stubs.put('/messages/:id/read', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json({ error: 'unauthorized' }, 401);
  try {
    const db = c.env.DB;
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'invalid id' }, 400);
    await db.prepare(
      `UPDATE messages SET read_at = datetime('now','localtime')
       WHERE id = ? AND read_at IS NULL AND (to_user_id = ? OR channel IN ('broadcast','dispatch','zone'))`
    ).bind(id, userId).run();
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /comms/messages/:id/read failed:', err);
    return c.json({ error: 'Failed to mark read' }, 500);
  }
});

// PUT /messages/:id/acknowledge — ACK a broadcast message (sets read_at).
stubs.put('/messages/:id/acknowledge', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json({ error: 'unauthorized' }, 401);
  try {
    const db = c.env.DB;
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'invalid id' }, 400);
    await db.prepare(
      `UPDATE messages SET read_at = COALESCE(read_at, datetime('now','localtime'))
       WHERE id = ? AND channel IN ('broadcast','dispatch','zone')`
    ).bind(id).run();
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /comms/messages/:id/acknowledge failed:', err);
    return c.json({ error: 'Failed to acknowledge' }, 500);
  }
});

// DELETE /messages/:id — sender may delete their own messages.
stubs.delete('/messages/:id', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json({ error: 'unauthorized' }, 401);
  try {
    const db = c.env.DB;
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'invalid id' }, 400);
    const msg = await db.prepare('SELECT from_user_id FROM messages WHERE id = ?').bind(id).first() as { from_user_id: number } | null;
    if (!msg) return c.json({ error: 'not found' }, 404);
    if (msg.from_user_id !== userId) return c.json({ error: 'forbidden' }, 403);
    await db.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /comms/messages/:id failed:', err);
    return c.json({ error: 'Failed to delete message' }, 500);
  }
});

// ── Comms: drafts (stored in the messages table with is_draft=1) ──
stubs.get('/drafts', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json([]);
  try {
    const db = c.env.DB;
    const rows = (await db.prepare(
      `SELECT m.*, f.full_name AS from_name, t.full_name AS to_name
       FROM messages m
       LEFT JOIN users f ON f.id = m.from_user_id
       LEFT JOIN users t ON t.id = m.to_user_id
       WHERE m.from_user_id = ? AND m.is_draft = 1
       ORDER BY m.draft_updated_at DESC, m.created_at DESC LIMIT 50`
    ).bind(userId).all()).results as any[];
    return c.json(rows);
  } catch {
    return c.json([]);
  }
});

stubs.post('/drafts', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json({ error: 'unauthorized' }, 401);
  try {
    const db = c.env.DB;
    const body = await c.req.json<{
      to_user_id?: number | string | null;
      channel?: string;
      content?: string;
      subject?: string;
      priority?: string;
    }>();
    const content = (body.content || '').trim();
    if (!content) return c.json({ error: 'content is required' }, 400);
    const result = await db.prepare(
      `INSERT INTO messages (from_user_id, to_user_id, channel, content, subject, priority, is_draft, draft_updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now','localtime'), datetime('now','localtime'))`
    ).bind(
      userId,
      body.to_user_id ? Number(body.to_user_id) : null,
      body.channel || 'direct',
      content,
      (body.subject || '').trim() || null,
      body.priority || 'routine',
    ).run();
    return c.json({ success: true, id: result.meta.last_row_id }, 201);
  } catch (err) {
    console.error('POST /comms/drafts failed:', err);
    return c.json({ error: 'Failed to save draft' }, 500);
  }
});

// ── Comms: emergency broadcast ──
// Sends as a broadcast message (channel='broadcast', priority='emergency').
// Client sends { content, subject }; the old stub expected { message } — fixed.
stubs.post('/emergency-broadcast', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json({ error: 'unauthorized' }, 401);
  try {
    const db = c.env.DB;
    const body = await c.req.json<{ content?: string; message?: string; subject?: string; priority?: string }>();
    // Accept both 'content' (current client) and 'message' (old stub compat).
    const text = (body.content || body.message || '').trim();
    if (!text) return c.json({ error: 'content is required' }, 400);
    const result = await db.prepare(
      `INSERT INTO messages (from_user_id, to_user_id, channel, content, subject, priority, created_at)
       VALUES (?, NULL, 'broadcast', ?, ?, 'emergency', datetime('now','localtime'))`
    ).bind(userId, text, body.subject || 'EMERGENCY BROADCAST').run();
    return c.json({ success: true, broadcast_id: result.meta.last_row_id });
  } catch (err) {
    console.error('POST /comms/emergency-broadcast failed:', err);
    return c.json({ error: 'Broadcast failed' }, 500);
  }
});

// ── Comms stats (mounted at /api/comms) — D1-backed aggregates ──
stubs.get('/bolos/stats', async (c) => {
  // See /bolos/check above — same router is also mounted public, so this
  // aggregate over the live `bolos` table needs an in-handler gate.
  if (c.get('userId') == null) return c.json({ error: 'unauthorized' }, 401);
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
  // See /bolos/check / /bolos/stats — same public-mount leak surface.
  if (c.get('userId') == null) return c.json({ error: 'unauthorized' }, 401);
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

// ── Code Enforcement: moved to src/routes/codeEnforcement.ts ──
// (the former '/export/csv' stub here also shadowed the DAR export
// below — Hono first-match meant /api/dar/export/csv answered with
// the code_violations filename)

// ── DAR export (mounted at /api/dar) ────
stubs.get('/export/csv', (c) => {
  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', 'attachment; filename="daily_activity_reports_export.csv"');
  return c.body('');
});

// ── Diagnostics (mounted at /api/diagnostics) ────
// NOTE: /ui-trap is intentionally public and unauthenticated. A frozen or
// logged-out client must still be able to report freeze state — gating on a JWT
// defeats the whole point. Abuse surface is bounded by: (a) 60 KB body cap
// enforced below, (b) 30-day KV TTL keeping storage bounded, and (c) the zone's
// Cloudflare managed-challenge as the outermost gate (bots don't solve it).
// No per-IP rate-limit today — acceptable for an internal ops crew of known size.
stubs.post('/ui-trap', async (c) => {
  try {
    const raw = await c.req.text();
    if (raw && raw.length <= 60000) {
      const key = `uitrap:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      // 30-day TTL; prefix `uitrap:` so captures are listable for analysis.
      await c.env.KV.put(key, raw, { expirationTtl: 60 * 60 * 24 * 30 });
    }
  } catch {
    // Never let diagnostics storage failure affect the (already-struggling) client.
  }
  return c.json({ received: true });
});

// ── Firecrawl tools moved to the dedicated firecrawlTools router
//    (/api/firecrawl-tools) — see src/routes/firecrawlTools.ts.

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

// ── ServeManager stubs (superseded by src/routes/serveManagerRoutes.ts) ──
stubs.get('/sync/log', (c) => c.json({ data: [] }));
stubs.get('/poller/status', (c) => c.json({
  enabled: false, poll_interval: 300, target_client: '',
  auto_create_calls: false, last_poll_at: null,
}));
stubs.get('/jobs/:jobId', (c) => c.json({ error: 'Not found' }, 404));
stubs.put('/api-key', (c) => c.json({ success: true }));
stubs.delete('/api-key', (c) => c.json({ success: true }));
stubs.put('/poller/settings', (c) => c.json({ success: true }));
stubs.post('/poller/poll-now', (c) => c.json({ synced: 0, callsCreated: 0 }));

export default stubs;
