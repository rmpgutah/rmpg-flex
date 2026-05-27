// ============================================================
// src/routes/radio.ts — Radio subsystem API
// ============================================================
//
// Backs RadioPage (`client/src/pages/radio/RadioPage.tsx`) + any future
// MDT radio panels. Three resource families:
//
//   - /channels        operator-visible channels (CRUD, soft-delete)
//   - /transmissions   append-only TX log per channel
//   - /recordings      per-user bookmarks of transmissions
//
// Schema lives in migrations/0038_radio.sql; tables exist on the
// new-Worker D1 (8893480a-…). See [[project-live-d1-schema-patches]]
// for the targeting rule.
//
// Auth model:
//   - All endpoints require authentication (mounted with auth: 'required'
//     in routesConfig.ts).
//   - Channel CRUD beyond list is restricted to admin/manager/supervisor
//     (channels are agency-wide config; line officers shouldn't add or
//     archive them mid-shift).
//   - Anyone can POST a transmission (officers do this from MDT) or
//     bookmark/edit their own recordings.
//
// Broadcasts: new transmissions fan out via broadcastAll('radio_update',
// {action, ...}) so every connected RadioPage / MDT updates without
// polling. Matches the dispatch_update pattern.

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { broadcastAll } from './ws';

const radio = new Hono<Env>();

// MST year-round helper — matches the 2026-05-26 timezone cutover.
const NOW_MST = "datetime('now', '-7 hours')";

// ═══════════════════════════════════════════════════════════════════
// CHANNELS
// ═══════════════════════════════════════════════════════════════════

// GET /api/radio/channels?include_archived=true
// Returns active channels by default; pass include_archived to see all.
radio.get('/channels', async (c) => {
  const db = getDb(c.env);
  const includeArchived = c.req.query('include_archived') === 'true';
  const sql = includeArchived
    ? 'SELECT * FROM radio_channels ORDER BY sort_order, id'
    : 'SELECT * FROM radio_channels WHERE archived_at IS NULL ORDER BY sort_order, id';
  const rows = await query<Record<string, unknown>>(db, sql);
  return c.json(rows);
});

// POST /api/radio/channels
// body: { name, description?, frequency?, talkgroup?, color?,
//         is_default?, sort_order? }
radio.post(
  '/channels',
  requireRole('admin', 'manager', 'supervisor'),
  async (c) => {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const body = await c.req.json<{
      name?: string; description?: string; frequency?: string;
      talkgroup?: string; color?: string;
      is_default?: boolean | number; sort_order?: number;
    }>();
    if (!body.name || !String(body.name).trim()) {
      return c.json({ error: 'name is required' }, 400);
    }

    // is_default is a single-winner toggle — only one channel is default
    // at a time. If the caller sets it true, clear it on every other row
    // first so the unique winner is whoever just claimed it.
    if (body.is_default) {
      await execute(db, 'UPDATE radio_channels SET is_default = 0 WHERE is_default = 1');
    }

    const result = await execute(
      db,
      `INSERT INTO radio_channels
         (name, description, frequency, talkgroup, color, is_default,
          sort_order, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ${NOW_MST}, ?)`,
      String(body.name).trim(),
      body.description ?? null,
      body.frequency ?? null,
      body.talkgroup ?? null,
      body.color ?? null,
      body.is_default ? 1 : 0,
      Number.isFinite(body.sort_order) ? body.sort_order : 0,
      userId,
    );
    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM radio_channels WHERE id = ?', result.meta.last_row_id,
    );
    broadcastAll('radio_update', { action: 'channel_created', channel: created });
    return c.json(created, 201);
  },
);

// PATCH /api/radio/channels/:id
// Partial update of name, description, frequency, talkgroup, color,
// is_default, sort_order. Sending archived_at: null unarchives; sending
// a timestamp archives.
radio.patch(
  '/channels/:id',
  requireRole('admin', 'manager', 'supervisor'),
  async (c) => {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const body = await c.req.json<Record<string, unknown>>();

    const allowed = new Set([
      'name', 'description', 'frequency', 'talkgroup', 'color',
      'is_default', 'sort_order', 'archived_at',
    ]);
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (!allowed.has(k)) continue;
      if (k === 'is_default') {
        if (v) {
          // Same single-winner rule as on create.
          await execute(db, 'UPDATE radio_channels SET is_default = 0 WHERE is_default = 1 AND id != ?', id);
        }
        sets.push('is_default = ?');
        params.push(v ? 1 : 0);
      } else {
        sets.push(`${k} = ?`);
        params.push(v ?? null);
      }
    }
    if (sets.length === 0) return c.json({ error: 'No updatable fields' }, 400);
    params.push(id);
    await execute(db, `UPDATE radio_channels SET ${sets.join(', ')} WHERE id = ?`, ...params);
    const updated = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM radio_channels WHERE id = ?', id,
    );
    broadcastAll('radio_update', { action: 'channel_updated', channel: updated });
    return c.json(updated);
  },
);

// DELETE /api/radio/channels/:id — soft delete via archived_at.
// Transmission history is preserved (the FK is not cascaded).
radio.delete(
  '/channels/:id',
  requireRole('admin', 'manager', 'supervisor'),
  async (c) => {
    const db = getDb(c.env);
    const id = c.req.param('id');
    await execute(
      db,
      `UPDATE radio_channels SET archived_at = ${NOW_MST} WHERE id = ? AND archived_at IS NULL`,
      id,
    );
    broadcastAll('radio_update', { action: 'channel_archived', channel_id: Number(id) });
    return c.json({ success: true });
  },
);

// ═══════════════════════════════════════════════════════════════════
// TRANSMISSIONS
// ═══════════════════════════════════════════════════════════════════

// GET /api/radio/transmissions?channel_id=&limit=&since=&call_id=&min_priority=
// Default limit 100, max 500. `since` filters transmitted_at > value.
// `min_priority` lets clients pull only urgent/emergency tx.
radio.get('/transmissions', async (c) => {
  const db = getDb(c.env);
  const channelId = c.req.query('channel_id');
  const callId = c.req.query('call_id');
  const since = c.req.query('since');
  const minPriority = c.req.query('min_priority');
  const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') || '100', 10)));

  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (channelId) { where.push('t.channel_id = ?'); params.push(channelId); }
  if (callId) { where.push('t.call_id = ?'); params.push(callId); }
  if (since) { where.push('t.transmitted_at > ?'); params.push(since); }
  if (minPriority) { where.push('t.priority >= ?'); params.push(Number(minPriority)); }

  // Join users for the speaker's display name — saves a round-trip per row.
  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT t.*, u.full_name as user_name, u.badge_number,
            c.name as channel_name, c.color as channel_color
     FROM radio_transmissions t
     LEFT JOIN users u ON u.id = t.user_id
     LEFT JOIN radio_channels c ON c.id = t.channel_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.transmitted_at DESC
     LIMIT ?`,
    ...params, limit,
  );
  return c.json(rows);
});

// GET /api/radio/transmissions/:id — single tx detail with the same
// joined shape as the list endpoint.
radio.get('/transmissions/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const row = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT t.*, u.full_name as user_name, u.badge_number,
            c.name as channel_name, c.color as channel_color
     FROM radio_transmissions t
     LEFT JOIN users u ON u.id = t.user_id
     LEFT JOIN radio_channels c ON c.id = t.channel_id
     WHERE t.id = ?`,
    id,
  );
  if (!row) return c.json({ error: 'Transmission not found' }, 404);
  return c.json(row);
});

// POST /api/radio/transmissions
// body: { channel_id, unit_label?, duration_seconds?, transcript?,
//         audio_url?, priority?, tags?, call_id? }
// Officer posts this from MDT after a PTT release. Broadcasts so other
// dispatchers + listening RadioPages update live.
radio.post('/transmissions', async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const user = c.get('user') as { id: number; username: string; full_name: string };
  const body = await c.req.json<{
    channel_id?: number; unit_label?: string;
    duration_seconds?: number; transcript?: string; audio_url?: string;
    priority?: number; tags?: string; call_id?: number;
  }>();
  if (!body.channel_id) return c.json({ error: 'channel_id is required' }, 400);

  // Sanity-check the channel exists and isn't archived — silently logging
  // tx against a dead channel would leak audit trail.
  const ch = await queryFirst<{ id: number; archived_at: string | null }>(
    db, 'SELECT id, archived_at FROM radio_channels WHERE id = ?', body.channel_id,
  );
  if (!ch) return c.json({ error: 'Channel not found' }, 404);
  if (ch.archived_at) return c.json({ error: 'Channel is archived' }, 409);

  const priority = Number.isFinite(body.priority) ? Number(body.priority) : 0;
  const result = await execute(
    db,
    `INSERT INTO radio_transmissions
       (channel_id, user_id, unit_label, transmitted_at, duration_seconds,
        transcript, audio_url, priority, tags, call_id)
     VALUES (?, ?, ?, ${NOW_MST}, ?, ?, ?, ?, ?, ?)`,
    body.channel_id, userId,
    body.unit_label ?? null,
    Number.isFinite(body.duration_seconds) ? body.duration_seconds : 0,
    body.transcript ?? null,
    body.audio_url ?? null,
    priority,
    body.tags ?? null,
    body.call_id ?? null,
  );

  const created = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT t.*, u.full_name as user_name, u.badge_number,
            c.name as channel_name, c.color as channel_color
     FROM radio_transmissions t
     LEFT JOIN users u ON u.id = t.user_id
     LEFT JOIN radio_channels c ON c.id = t.channel_id
     WHERE t.id = ?`,
    result.meta.last_row_id,
  );

  broadcastAll('radio_update', {
    action: 'transmission_logged',
    transmission: created,
    speaker: user.full_name,
  });
  return c.json(created, 201);
});

// ═══════════════════════════════════════════════════════════════════
// RECORDINGS (per-user bookmarks)
// ═══════════════════════════════════════════════════════════════════

// GET /api/radio/recordings — current user's bookmarks by default.
// Admins can pass ?user_id= to inspect anyone's bookmarks.
radio.get('/recordings', async (c) => {
  const db = getDb(c.env);
  const requestor = c.get('user') as { id: number; role: string };
  const askedUser = c.req.query('user_id');
  // Only admins/managers can read another user's bookmarks; everyone
  // else is silently scoped to their own.
  const targetUserId = (askedUser && ['admin', 'manager', 'supervisor'].includes(requestor.role))
    ? Number(askedUser)
    : requestor.id;

  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT r.*, t.transmitted_at, t.unit_label, t.transcript,
            t.channel_id, c.name as channel_name, c.color as channel_color
     FROM radio_recordings r
     LEFT JOIN radio_transmissions t ON t.id = r.transmission_id
     LEFT JOIN radio_channels c ON c.id = t.channel_id
     WHERE r.user_id = ?
     ORDER BY r.created_at DESC
     LIMIT 500`,
    targetUserId,
  );
  return c.json(rows);
});

// POST /api/radio/recordings
// body: { transmission_id, label?, notes?, color?, bookmark_seconds?,
//         loop_start_seconds?, loop_end_seconds? }
radio.post('/recordings', async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const body = await c.req.json<{
    transmission_id?: number; label?: string; notes?: string; color?: string;
    bookmark_seconds?: number; loop_start_seconds?: number; loop_end_seconds?: number;
  }>();
  if (!body.transmission_id) return c.json({ error: 'transmission_id is required' }, 400);

  // Confirm the transmission exists before bookmarking — protects against
  // stale client state pointing at a deleted tx.
  const tx = await queryFirst<{ id: number }>(
    db, 'SELECT id FROM radio_transmissions WHERE id = ?', body.transmission_id,
  );
  if (!tx) return c.json({ error: 'Transmission not found' }, 404);

  const result = await execute(
    db,
    `INSERT INTO radio_recordings
       (transmission_id, user_id, label, notes, color,
        bookmark_seconds, loop_start_seconds, loop_end_seconds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${NOW_MST})`,
    body.transmission_id, userId,
    body.label ?? null,
    body.notes ?? null,
    body.color ?? null,
    Number.isFinite(body.bookmark_seconds) ? body.bookmark_seconds : null,
    Number.isFinite(body.loop_start_seconds) ? body.loop_start_seconds : null,
    Number.isFinite(body.loop_end_seconds) ? body.loop_end_seconds : null,
  );
  const created = await queryFirst<Record<string, unknown>>(
    db, 'SELECT * FROM radio_recordings WHERE id = ?', result.meta.last_row_id,
  );
  return c.json(created, 201);
});

// PATCH /api/radio/recordings/:id — owner-only update.
radio.patch('/recordings/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const userId = c.get('userId') as number;
  const body = await c.req.json<Record<string, unknown>>();

  // Scope by user_id on update — a user can only edit their own bookmarks.
  const existing = await queryFirst<{ user_id: number }>(
    db, 'SELECT user_id FROM radio_recordings WHERE id = ?', id,
  );
  if (!existing) return c.json({ error: 'Recording not found' }, 404);
  if (existing.user_id !== userId) return c.json({ error: 'Not authorized' }, 403);

  const allowed = new Set([
    'label', 'notes', 'color',
    'bookmark_seconds', 'loop_start_seconds', 'loop_end_seconds',
  ]);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.has(k)) continue;
    sets.push(`${k} = ?`);
    params.push(v ?? null);
  }
  if (sets.length === 0) return c.json({ error: 'No updatable fields' }, 400);
  params.push(id);
  await execute(db, `UPDATE radio_recordings SET ${sets.join(', ')} WHERE id = ?`, ...params);
  const updated = await queryFirst<Record<string, unknown>>(
    db, 'SELECT * FROM radio_recordings WHERE id = ?', id,
  );
  return c.json(updated);
});

// DELETE /api/radio/recordings/:id — owner-only.
radio.delete('/recordings/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const userId = c.get('userId') as number;
  const existing = await queryFirst<{ user_id: number }>(
    db, 'SELECT user_id FROM radio_recordings WHERE id = ?', id,
  );
  if (!existing) return c.json({ error: 'Recording not found' }, 404);
  if (existing.user_id !== userId) return c.json({ error: 'Not authorized' }, 403);
  await execute(db, 'DELETE FROM radio_recordings WHERE id = ?', id);
  return c.json({ success: true });
});

export default radio;
