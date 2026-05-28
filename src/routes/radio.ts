// ============================================================
// RMPG Flex — Radio Console (Cloudflare Worker)
// ============================================================
// Backs the RadioPage at client/src/pages/radio/. Tables in
// migrations/0038_radio.sql:
//   radio_channels       — operator-visible channels
//   radio_transmissions  — append-only TX log
//   radio_recordings     — per-user saved/bookmarked tx
//
// Endpoints:
//   GET    /channels                          list active (?include_archived=1 for all)
//   POST   /channels                          admin/manager/supervisor
//   PATCH  /channels/:id
//   DELETE /channels/:id                      soft-delete (archived_at)
//   GET    /transmissions                     ?channel_id ?range ?min_duration ?q ?limit
//   POST   /transmissions                     log a tx (caller is implicit user)
//   DELETE /transmissions/:id                 admin/manager only
//   GET    /recordings                        caller's saved tx
//   POST   /recordings                        save/bookmark a tx
//   PATCH  /recordings/:id                    label/notes/loop points
//   DELETE /recordings/:id
//   GET    /stats                             sparkline (24h hourly) + heatmap (7d x 24h)
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { broadcastAll } from './ws';

const rt = new Hono<Env>();

const ALLOWED_RANGES = new Set(['all', 'today', 'h24', 'week', 'month']);

function rangeClause(range: string | undefined): { sql: string; args: unknown[] } {
  if (!range || range === 'all' || !ALLOWED_RANGES.has(range)) return { sql: '', args: [] };
  // SQLite datetime() math in TEXT comparison form — same shape as the
  // other route files (patrol/audit) so query plans stay consistent.
  if (range === 'today') return { sql: " AND date(transmitted_at) = date('now')", args: [] };
  if (range === 'h24')   return { sql: " AND transmitted_at >= datetime('now','-1 day')", args: [] };
  if (range === 'week')  return { sql: " AND transmitted_at >= datetime('now','-7 days')", args: [] };
  if (range === 'month') return { sql: " AND transmitted_at >= datetime('now','-30 days')", args: [] };
  return { sql: '', args: [] };
}

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// ── Channels ──────────────────────────────────────────────────

rt.get('/channels', async (c) => {
  const includeArchived = c.req.query('include_archived') === '1';
  const sql = `SELECT c.*,
                 (SELECT COUNT(*) FROM radio_transmissions t WHERE t.channel_id = c.id) AS tx_count,
                 (SELECT MAX(transmitted_at) FROM radio_transmissions t WHERE t.channel_id = c.id) AS last_tx_at
                 FROM radio_channels c
                 ${includeArchived ? '' : 'WHERE archived_at IS NULL'}
                 ORDER BY sort_order ASC, id ASC`;
  return c.json(await query(getDb(c.env), sql));
});

rt.post('/channels', async (c) => {
  const err = requireRole(c, 'admin', 'manager', 'supervisor');
  if (err) return c.json({ error: err }, 403);
  const body = await c.req.json().catch(() => ({} as any));
  const name = (body.name || '').trim();
  if (!name) return c.json({ error: 'name required' }, 400);
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);
  const result = await execute(
    db,
    `INSERT INTO radio_channels (name, description, frequency, talkgroup, color, sort_order, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    name,
    body.description || null,
    body.frequency || null,
    body.talkgroup || null,
    body.color || null,
    Number.isFinite(body.sort_order) ? body.sort_order : 0,
    user?.id ?? null,
  );
  const id = Number(result.meta.last_row_id);
  // Broadcast so other dispatchers' channel pickers update without a refresh.
  const channel = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM radio_channels WHERE id = ?', id);
  broadcastAll('radio_update', { action: 'channel_created', channel });
  return c.json({ success: true, id });
});

rt.patch('/channels/:id', async (c) => {
  const err = requireRole(c, 'admin', 'manager', 'supervisor');
  if (err) return c.json({ error: err }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json().catch(() => ({} as any));
  const fields: string[] = [];
  const args: unknown[] = [];
  for (const k of ['name', 'description', 'frequency', 'talkgroup', 'color', 'sort_order'] as const) {
    if (k in body) { fields.push(`${k} = ?`); args.push(body[k]); }
  }
  if (!fields.length) return c.json({ error: 'no updatable fields' }, 400);
  args.push(id);
  const db = getDb(c.env);
  await execute(db, `UPDATE radio_channels SET ${fields.join(', ')} WHERE id = ?`, ...args);
  const channel = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM radio_channels WHERE id = ?', id);
  broadcastAll('radio_update', { action: 'channel_updated', channel });
  return c.json({ success: true });
});

rt.delete('/channels/:id', async (c) => {
  const err = requireRole(c, 'admin', 'manager', 'supervisor');
  if (err) return c.json({ error: err }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  // Soft-delete — keeps transmission FK pointers valid for audit.
  await execute(
    getDb(c.env),
    "UPDATE radio_channels SET archived_at = datetime('now') WHERE id = ? AND archived_at IS NULL",
    id,
  );
  broadcastAll('radio_update', { action: 'channel_archived', channel_id: id });
  return c.json({ success: true });
});

// ── Transmissions ─────────────────────────────────────────────

rt.get('/transmissions', async (c) => {
  const channelId = c.req.query('channel_id');
  const range = c.req.query('range');
  const minDur = parseFloat(c.req.query('min_duration') || '0');
  const q = (c.req.query('q') || '').trim();
  const limit = Math.min(parseInt(c.req.query('limit') || '200', 10) || 200, 1000);

  const where: string[] = ['1=1'];
  const args: unknown[] = [];
  if (channelId) { where.push('channel_id = ?'); args.push(parseInt(channelId, 10)); }
  if (minDur > 0) { where.push('duration_seconds >= ?'); args.push(minDur); }
  if (q) {
    // Server-side coarse filter only — the client's matchesSearch()
    // helper does the boolean OR/negation parsing on the page. We
    // narrow first to keep payloads small.
    where.push('(transcript LIKE ? OR unit_label LIKE ? OR tags LIKE ?)');
    const like = `%${q.replace(/[%_]/g, '')}%`;
    args.push(like, like, like);
  }
  const rc = rangeClause(range);
  const sql = `SELECT t.*, c.name AS channel_name, u.full_name AS user_name
                 FROM radio_transmissions t
                 LEFT JOIN radio_channels c ON c.id = t.channel_id
                 LEFT JOIN users u ON u.id = t.user_id
                 WHERE ${where.join(' AND ')} ${rc.sql}
                 ORDER BY transmitted_at DESC LIMIT ?`;
  return c.json(await query(getDb(c.env), sql, ...args, ...rc.args, limit));
});

rt.post('/transmissions', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const channelId = parseInt(body.channel_id, 10);
  if (!Number.isFinite(channelId)) return c.json({ error: 'channel_id required' }, 400);
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);
  const result = await execute(
    db,
    `INSERT INTO radio_transmissions
       (channel_id, user_id, unit_label, duration_seconds, transcript, audio_url, priority, tags, call_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    channelId,
    user?.id ?? null,
    body.unit_label || null,
    Number.isFinite(body.duration_seconds) ? body.duration_seconds : 0,
    body.transcript || null,
    body.audio_url || null,
    Number.isFinite(body.priority) ? body.priority : 0,
    body.tags ? (typeof body.tags === 'string' ? body.tags : JSON.stringify(body.tags)) : null,
    Number.isFinite(body.call_id) ? body.call_id : null,
  );
  const id = Number(result.meta.last_row_id);

  // Fetch the joined row so the WS payload matches what GET /transmissions
  // returns — subscribers can prepend directly without a re-fetch.
  const transmission = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT t.*, c.name AS channel_name, u.full_name AS user_name
       FROM radio_transmissions t
       LEFT JOIN radio_channels c ON c.id = t.channel_id
       LEFT JOIN users u ON u.id = t.user_id
       WHERE t.id = ?`,
    id,
  );
  broadcastAll('radio_update', { action: 'transmission_logged', transmission });
  return c.json({ success: true, id });
});

rt.delete('/transmissions/:id', async (c) => {
  const err = requireRole(c, 'admin', 'manager');
  if (err) return c.json({ error: err }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  await execute(getDb(c.env), 'DELETE FROM radio_transmissions WHERE id = ?', id);
  return c.json({ success: true });
});

// ── Recordings (per-user bookmarks) ───────────────────────────

rt.get('/recordings', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json([]);
  const rows = await query(
    getDb(c.env),
    `SELECT r.*, t.transcript, t.transmitted_at, t.duration_seconds, t.channel_id,
            c.name AS channel_name
       FROM radio_recordings r
       JOIN radio_transmissions t ON t.id = r.transmission_id
       LEFT JOIN radio_channels c ON c.id = t.channel_id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC`,
    user.id,
  );
  return c.json(rows);
});

rt.post('/recordings', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  const body = await c.req.json().catch(() => ({} as any));
  const txId = parseInt(body.transmission_id, 10);
  if (!Number.isFinite(txId)) return c.json({ error: 'transmission_id required' }, 400);
  // Verify the tx exists so we fail fast with 404 instead of a FK error.
  const tx = await queryFirst<{ id: number }>(getDb(c.env), 'SELECT id FROM radio_transmissions WHERE id = ?', txId);
  if (!tx) return c.json({ error: 'transmission not found' }, 404);
  const result = await execute(
    getDb(c.env),
    `INSERT INTO radio_recordings (transmission_id, user_id, label, notes, color, bookmark_seconds, loop_start_seconds, loop_end_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    txId,
    user.id,
    body.label || null,
    body.notes || null,
    body.color || null,
    Number.isFinite(body.bookmark_seconds) ? body.bookmark_seconds : null,
    Number.isFinite(body.loop_start_seconds) ? body.loop_start_seconds : null,
    Number.isFinite(body.loop_end_seconds) ? body.loop_end_seconds : null,
  );
  return c.json({ success: true, id: result.meta.last_row_id });
});

rt.patch('/recordings/:id', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json().catch(() => ({} as any));
  const fields: string[] = [];
  const args: unknown[] = [];
  for (const k of ['label', 'notes', 'color', 'bookmark_seconds', 'loop_start_seconds', 'loop_end_seconds'] as const) {
    if (k in body) { fields.push(`${k} = ?`); args.push(body[k]); }
  }
  if (!fields.length) return c.json({ error: 'no updatable fields' }, 400);
  args.push(id, user.id);
  await execute(getDb(c.env), `UPDATE radio_recordings SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, ...args);
  return c.json({ success: true });
});

rt.delete('/recordings/:id', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  await execute(getDb(c.env), 'DELETE FROM radio_recordings WHERE id = ? AND user_id = ?', id, user.id);
  return c.json({ success: true });
});

// ── Stats (sparkline + heatmap) ───────────────────────────────

rt.get('/stats', async (c) => {
  const db = getDb(c.env);
  // Sparkline: 24 hourly buckets for the trailing 24h. Returned as a
  // fixed-length array (index = hours-ago, 0 = now) so the client can
  // index without a date parse on each entry.
  const hourly = await query<{ hours_ago: number; n: number }>(
    db,
    `SELECT CAST((strftime('%s','now') - strftime('%s', transmitted_at)) / 3600 AS INTEGER) AS hours_ago,
            COUNT(*) AS n
       FROM radio_transmissions
       WHERE transmitted_at >= datetime('now','-1 day')
       GROUP BY hours_ago`,
  );
  const sparkline = Array.from({ length: 24 }, (_, i) => hourly.find((r) => r.hours_ago === i)?.n ?? 0);

  // Heatmap: 7 days x 24 hours, oldest-first row order (Mon..Sun
  // is the client's `labels` array). dow values from strftime are
  // 0=Sun..6=Sat — remap to 0=Mon..6=Sun client-side.
  const cells = await query<{ dow: number; hour: number; n: number }>(
    db,
    `SELECT CAST(strftime('%w', transmitted_at) AS INTEGER) AS dow,
            CAST(strftime('%H', transmitted_at) AS INTEGER) AS hour,
            COUNT(*) AS n
       FROM radio_transmissions
       WHERE transmitted_at >= datetime('now','-7 days')
       GROUP BY dow, hour`,
  );
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const row of cells) {
    const monIndex = (row.dow + 6) % 7;
    heatmap[monIndex][row.hour] = row.n;
  }

  const totals = await queryFirst<{ today: number; week: number; all: number }>(
    db,
    `SELECT
       SUM(CASE WHEN date(transmitted_at) = date('now') THEN 1 ELSE 0 END) AS today,
       SUM(CASE WHEN transmitted_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS week,
       COUNT(*) AS all FROM radio_transmissions`,
  );

  return c.json({ sparkline, heatmap, totals: totals ?? { today: 0, week: 0, all: 0 } });
});

export default rt;
