import { Hono } from 'hono';
import type { Env } from '../types';
import { encryptBrowserData, decryptBrowserData } from '../utils/companyBrowserCrypto';
import { ACTIVE_CALL_WHERE } from '../utils/callStatus';
import { broadcastAll } from './ws';

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
  desktop_layout_json: null, desktop_wallpaper: 'blue-silver-default',
  desktop_widgets_json: null,
  desktop_accent: 'default', desktop_notes_json: null,
  browser_bookmarks_json: null, browser_history_json: null,
} as const;

const PREF_COLUMNS = new Set<string>(Object.keys(PREF_DEFAULTS));

const ENCRYPTED_BROWSER_COLUMNS = ['browser_bookmarks_json', 'browser_history_json'] as const;

async function decryptBrowserColumns(env: { COMPANY_BROWSER_DATA_KEY?: string; JWT_SECRET: string }, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = { ...row };
  for (const col of ENCRYPTED_BROWSER_COLUMNS) {
    const value = out[col];
    if (typeof value === 'string') {
      out[col] = await decryptBrowserData(env, value);
    }
  }
  return out;
}

stubs.get('/preferences', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json(PREF_DEFAULTS);
  const row = await c.env.DB.prepare('SELECT * FROM user_preferences WHERE user_id = ?')
    .bind(userId).first();
  if (!row) return c.json(PREF_DEFAULTS);
  const decryptedRow = await decryptBrowserColumns(c.env, row as Record<string, unknown>);
  return c.json({ ...PREF_DEFAULTS, ...decryptedRow });
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
  const values = await Promise.all(keys.map(async (k) => {
    const value = body[k] as string | number | null;
    if ((k === 'browser_bookmarks_json' || k === 'browser_history_json') && typeof value === 'string') {
      return encryptBrowserData(c.env, value);
    }
    return value;
  }));
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  await c.env.DB.prepare(
    `UPDATE user_preferences SET ${setClause}, updated_at = datetime('now') WHERE user_id = ?`,
  ).bind(...values, userId).run();
  const row = await c.env.DB.prepare('SELECT * FROM user_preferences WHERE user_id = ?')
    .bind(userId).first();
  const decryptedRow = row ? await decryptBrowserColumns(c.env, row as Record<string, unknown>) : null;
  return c.json({ success: true, preferences: decryptedRow ? { ...PREF_DEFAULTS, ...decryptedRow } : PREF_DEFAULTS });
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
    // Optional per-user scope — AdminUsersTab's Activity Log sub-tab calls
    // this with ?user_id=<id> and expects ONLY that user's actions back.
    // Without this filter every admin's "Activity Log" showed the same
    // global feed regardless of which user was selected.
    const userIdParam = c.req.query('user_id');
    const userId = userIdParam != null ? parseInt(userIdParam, 10) : null;
    const userFilter = userId != null && Number.isFinite(userId) ? 'AND al.user_id = ?' : '';
    // Machine telemetry actions (page-view instrumentation, API-error pings —
    // see useFleetV2Audit.ts / auditEmit.ts) write raw JSON into `details` and
    // were never meant for the human-facing feed; they're consumed by
    // AdminFleetV2HealthTab via /audit/count instead. Excluding them here
    // stops unformatted JSON blobs from leaking into Recent Activity.
    const TELEMETRY_ACTIONS = "('FLEET_V2_VIEW','FLEET_V2_API_ERROR')";
    const countBind = userFilter ? [userId] : [];
    const [{ total }] = (await db.prepare(
      `SELECT COUNT(*) as total FROM audit_log al WHERE al.action NOT IN ${TELEMETRY_ACTIONS} ${userFilter}`
    ).bind(...countBind).all()).results as { total: number }[];
    const rowBind = userFilter ? [userId, limit, offset] : [limit, offset];
    const rows = (await db.prepare(
      `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id, al.details,
              al.ip_address, al.created_at,
              u.full_name as user_name, u.badge_number, u.role as user_role
       FROM audit_log al LEFT JOIN users u ON u.id = al.user_id
       WHERE al.action NOT IN ${TELEMETRY_ACTIONS} ${userFilter}
       ORDER BY al.created_at DESC LIMIT ? OFFSET ?`
    ).bind(...rowBind).all()).results as any[];
    return c.json({ data: rows, total: total ?? 0, limit, offset });
  } catch (err) {
    console.error('GET /comms/activity-feed failed:', err);
    return c.json({ data: [], total: 0, limit: 50, offset: 0 });
  }
});
stubs.get('/bolos/active', (c) => c.json([]));

// NB: /bolos/check and /bolos/stats used to be handled here, but they're
// unreachable — bolosRouter is mounted at /api/comms/bolos BEFORE this stubs
// mount and owns the whole /bolos subtree (see routesConfig.ts), so those
// paths now live in src/routes/dispatch/extensions.ts.

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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
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
    // Notify all connected clients so the inbox refreshes in real time.
    try { broadcastAll('data_changed', { module: 'comms', entity: 'messages', id: newId, channel }); } catch { /* non-fatal */ }
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
      `UPDATE messages SET read_at = datetime('now')
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
      `UPDATE messages SET read_at = COALESCE(read_at, datetime('now'))
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
       VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
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
       VALUES (?, NULL, 'broadcast', ?, ?, 'emergency', datetime('now'))`
    ).bind(userId, text, body.subject || 'EMERGENCY BROADCAST').run();
    const broadcastId = result.meta.last_row_id as number;
    try { broadcastAll('data_changed', { module: 'comms', entity: 'messages', id: broadcastId, channel: 'broadcast' }); } catch { /* non-fatal */ }
    return c.json({ success: true, broadcast_id: broadcastId });
  } catch (err) {
    console.error('POST /comms/emergency-broadcast failed:', err);
    return c.json({ error: 'Broadcast failed' }, 500);
  }
});

// NB: /bolos/stats used to be handled here — see the note near /bolos/active
// above. It now lives in src/routes/dispatch/extensions.ts.

stubs.get('/messages/priority-stats', async (c) => {
  // Same public-mount leak surface as the /bolos/* routes noted above.
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

// ── Stats dashboard (mounted at /api/stats) — used by ModuleDirectoryPage +
// useNavBadges (Nav Index toolbar badges). Was a hardcoded-zero stub, which
// made those badges permanently show nothing regardless of real counts.
stubs.get('/dashboard', async (c) => {
  // Same public-mount leak surface as the /bolos/* and /messages/* routes:
  // this router is ALSO mounted at '/api/diagnostics' and '/api/updates',
  // both `auth: 'public'`, so every path it defines was reachable there with
  // no token — publishing live open_cases / pending_serve / active_warrants
  // counts to anyone. On the auth-required mounts (/api/stats,
  // /api/dispatch/stats) userId is set, so this guard costs nothing there.
  if (c.get('userId') == null) return c.json({ error: 'unauthorized' }, 401);
  try {
    const row = await c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM cases WHERE status = 'open') AS open_cases,
         (SELECT COUNT(*) FROM serve_queue WHERE status IN ('pending','assigned')) AS pending_serve,
         (SELECT COUNT(*) FROM warrants WHERE status = 'active') AS active_warrants`
    ).first();
    return c.json(row ?? { open_cases: 0, pending_serve: 0, active_warrants: 0 });
  } catch (err) {
    console.error('GET /stats/dashboard failed:', err);
    return c.json({ open_cases: 0, pending_serve: 0, active_warrants: 0 });
  }
});

// ── Weather (mounted at /api/weather) — uses /current to avoid GET / collision ──
stubs.get('/current', (c) => c.json({ temperature: 72, conditions: 'Clear', icon: 'clear-day' }));

// ── Email (mounted at /api/email) — /unread-count handled by line 56 (same stub serves both prefixes) ──

// ── Integrations (mounted at /api/integrations) ──
stubs.get('/google-maps/client-key', (c) => c.json({}));

// ── Dispatch stats (mounted at /api/dispatch/stats) ──
// `stubs` is mounted at the EXACT prefix '/api/dispatch/stats', so '/' here
// matches /api/dispatch/stats (the bare mount point). Using '/stats' would
// have mapped to /api/dispatch/stats/stats — bug fixed 2026-06-06.
//
// Was a hardcoded-zero stub returning {total_calls, active_calls,
// units_online} — fields neither of its actual consumers reads.
// Layout.tsx's header badge reads `stats.activeCalls` (camelCase) and
// `stats.callsByPriority`; useNavBadges (Nav Index toolbar + the desktop
// Live Ops widget) reads `active_warrants`. Real query returns all three.
stubs.get('/', async (c) => {
  // Public-mount guard: bare GET /api/diagnostics hit this handler with no
  // token and returned live operational posture (active call count by
  // priority, units currently on shift, active warrants).
  if (c.get('userId') == null) return c.json({ error: 'unauthorized' }, 401);
  try {
    const [activeRow, warrantsRow, priorityRows, unitsRow] = await Promise.all([
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM calls_for_service WHERE ${ACTIVE_CALL_WHERE}`
      ).first<{ n: number }>(),
      c.env.DB.prepare(`SELECT COUNT(*) AS n FROM warrants WHERE status = 'active'`).first<{ n: number }>(),
      c.env.DB.prepare(
        `SELECT priority, COUNT(*) AS count FROM calls_for_service
         WHERE ${ACTIVE_CALL_WHERE} GROUP BY priority`
      ).all<{ priority: string; count: number }>(),
      c.env.DB.prepare(`SELECT COUNT(*) AS n FROM units WHERE status != 'off_duty'`).first<{ n: number }>(),
    ]);
    return c.json({
      activeCalls: activeRow?.n ?? 0,
      active_warrants: warrantsRow?.n ?? 0,
      callsByPriority: priorityRows?.results ?? [],
      units_online: unitsRow?.n ?? 0,
    });
  } catch (err) {
    console.error('GET /dispatch/stats failed:', err);
    return c.json({ activeCalls: 0, active_warrants: 0, callsByPriority: [], units_online: 0 });
  }
});

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

// ── PDF artifacts (mounted at /api/pdf-artifacts) ────
stubs.post('/', async (c) => c.json({ id: null, error: 'PDF artifact storage not configured' }, 501));

// ── PDF engine email (mounted at /api/pdf-engine) ────
stubs.post('/email', async (c) => c.json({ sent: false, error: 'Email delivery not configured' }, 501));

// ── Android update checker (mounted at /api/updates) ────
stubs.get('/check', (c) => c.json({ updateAvailable: false, currentVersion: c.req.query('currentVersion') || '0.0.0' }));

// ── Voice persona (mounted at /api/voice-persona) ────
stubs.get('/', (c) => c.json({ persona: null }));
stubs.put('/', async (c) => {
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  return c.json({ success: true, ...body });
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
