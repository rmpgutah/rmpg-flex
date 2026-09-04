// ============================================================
// RMPG Flex — Community Engagement
// ============================================================
// Spillman Flex Community Engagement parity: events, public tips,
// neighborhood watch, community alerts.
// Migration: 0047_spillman_modules.sql
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

import { log } from '../utils/logger';
const community = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

async function generateTipNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `TIP-${yy}-`;
  const last = await queryFirst<{ tip_number: string }>(
    db, 'SELECT tip_number FROM public_tips WHERE tip_number LIKE ? ORDER BY id DESC LIMIT 1', `${prefix}%`);
  let nextNum = 1;
  if (last?.tip_number) {
    const m = last.tip_number.match(/^TIP-\d{2}-(\d+)$/);
    if (m) nextNum = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

// ═══════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════

community.get('/events', async (c) => {
  try {
    const db = getDb(c.env);
    const tableCheck = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='community_events'");
    if (!tableCheck?.n) return c.json({ data: [] });
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    if (q('type')) { conditions.push('event_type = ?'); params.push(q('type')); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await query<Record<string, unknown>>(db, `SELECT * FROM community_events ${where} ORDER BY start_date DESC LIMIT 200`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /events failed', { src: 'src/routes/community.ts' }, err);
    return c.json({ error: 'Failed to list events' }, 500);
  }
});

community.post('/events', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.event_name !== 'string' || !b.event_name.trim()) return c.json({ error: 'event_name required' }, 400);
    if (typeof b.start_date !== 'string') return c.json({ error: 'start_date required' }, 400);
    const result = await execute(db,
      `INSERT INTO community_events (event_name, event_type, description, location, start_date, end_date, organizer_id, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.event_name, b.event_type ?? 'other', b.description ?? null, b.location ?? null,
      b.start_date, b.end_date ?? null, b.organizer_id ?? null, b.status ?? 'planned', b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM community_events WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /events failed', { src: 'src/routes/community.ts' }, err);
    return c.json({ error: 'Failed to create event' }, 500);
  }
});

community.put('/events/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const updatable = new Set(['event_name','event_type','description','location','start_date','end_date','organizer_id','attendees_count','status','notes']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    vals.push(id);
    await execute(db, `UPDATE community_events SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM community_events WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /events/:id failed', { src: 'src/routes/community.ts' }, err);
    return c.json({ error: 'Failed to update event' }, 500);
  }
});

community.delete('/events/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const result = await execute(db, 'DELETE FROM community_events WHERE id = ?', id);
    if (result.meta.changes === 0) return c.json({ error: 'Event not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /events/:id failed', { src: 'src/routes/community.ts' }, err);
    return c.json({ error: 'Failed to delete event', code: 'DELETE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// PUBLIC TIPS
// ═══════════════════════════════════════════════════════════════

community.get('/tips', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    if (q('priority')) { conditions.push('priority = ?'); params.push(q('priority')); }
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(q('per_page') || '50', 10) || 50));
    const offset = (page - 1) * perPage;
    const where = `WHERE ${conditions.join(' AND ')}`;
    const count = await queryFirst<{ total: number }>(db, `SELECT COUNT(*) as total FROM public_tips ${where}`, ...params);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT t.*, u.full_name as assigned_to_name FROM public_tips t LEFT JOIN users u ON t.assigned_to = u.id ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`, ...params, perPage, offset);
    const total = count?.total ?? 0;
    return c.json({ data: rows, pagination: { page, per_page: perPage, total, totalPages: Math.ceil(total / perPage) } });
  } catch (err) {
    log.error('GET /tips failed', { src: 'src/routes/community.ts' }, err);
    return c.json({ error: 'Failed to list tips' }, 500);
  }
});

community.post('/tips', async (c) => {
  // Public endpoint — no auth required for anonymous tips
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.tip_text !== 'string' || !b.tip_text.trim()) return c.json({ error: 'tip_text required' }, 400);
    const tipNumber = await generateTipNumber(db);
    const result = await execute(db,
      `INSERT INTO public_tips (tip_number, submitter_name, submitter_contact, is_anonymous, tip_text, category, location, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      tipNumber, b.submitter_name ?? null, b.submitter_contact ?? null, b.is_anonymous ?? 0,
      b.tip_text, b.category ?? null, b.location ?? null, b.priority ?? 'normal',
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM public_tips WHERE id = ?', newId);
    return c.json({ data: created, tip_number: tipNumber }, 201);
  } catch (err) {
    log.error('POST /tips failed', { src: 'src/routes/community.ts' }, err);
    return c.json({ error: 'Failed to submit tip' }, 500);
  }
});

community.put('/tips/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const updatable = new Set(['status','assigned_to','priority','resolution']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    sets.push(`updated_at = datetime('now')`); vals.push(id);
    await execute(db, `UPDATE public_tips SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM public_tips WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /tips/:id failed', { src: 'src/routes/community.ts' }, err);
    return c.json({ error: 'Failed to update tip' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// NEIGHBORHOOD WATCH
// ═══════════════════════════════════════════════════════════════

community.get('/watch-groups', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM neighborhood_watch_groups ORDER BY created_at DESC');
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /watch-groups failed', { src: 'src/routes/community.ts' }, err);
    return c.json({ error: 'Failed to list watch groups' }, 500);
  }
});

community.post('/watch-groups', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.group_name !== 'string' || !b.group_name.trim()) return c.json({ error: 'group_name required' }, 400);
    const result = await execute(db,
      `INSERT INTO neighborhood_watch_groups (group_name, neighborhood, beat_id, coordinator_name, coordinator_contact, member_count, last_meeting, next_meeting, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.group_name, b.neighborhood ?? null, b.beat_id ?? null, b.coordinator_name ?? null, b.coordinator_contact ?? null,
      b.member_count ?? 0, b.last_meeting ?? null, b.next_meeting ?? null, b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM neighborhood_watch_groups WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /watch-groups failed', { src: 'src/routes/community.ts' }, err);
    return c.json({ error: 'Failed to create watch group' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// COMMUNITY ALERTS
// ═══════════════════════════════════════════════════════════════

community.get('/alerts', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      'SELECT ca.*, u.full_name as created_by_name FROM community_alerts ca LEFT JOIN users u ON ca.created_by = u.id ORDER BY ca.created_at DESC LIMIT 200');
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /alerts failed', { src: 'src/routes/community.ts' }, err);
    return c.json({ error: 'Failed to list alerts' }, 500);
  }
});

community.post('/alerts', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.alert_title !== 'string' || !b.alert_title.trim()) return c.json({ error: 'alert_title required' }, 400);
    if (typeof b.alert_text !== 'string' || !b.alert_text.trim()) return c.json({ error: 'alert_text required' }, 400);
    const result = await execute(db,
      `INSERT INTO community_alerts (alert_title, alert_text, alert_type, severity, target_area, target_beat_ids, sent_via_email, sent_via_sms, sent_via_push, sent_at, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.alert_title, b.alert_text, b.alert_type ?? 'safety', b.severity ?? 'info',
      b.target_area ?? null, b.target_beat_ids ?? null, b.sent_via_email ?? 0, b.sent_via_sms ?? 0,
      b.sent_via_push ?? 0, b.sent_at ?? null, b.expires_at ?? null, userId,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM community_alerts WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /alerts failed', { src: 'src/routes/community.ts' }, err);
    return c.json({ error: 'Failed to create alert' }, 500);
  }
});

community.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const eventTable = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='community_events'");
    if (!eventTable?.n) return c.json({ total_events: 0, upcoming_events: 0, total_tips: 0, active_tips: 0, watch_groups: 0, active_alerts: 0 });
    const events = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM community_events'))?.count ?? 0;
    const tips = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM public_tips'))?.count ?? 0;
    const groups = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM neighborhood_watch_groups'))?.count ?? 0;
    const alerts = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM community_alerts'))?.count ?? 0;
    return c.json({ events, tips, watch_groups: groups, alerts });
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/community.ts' }, err);
    return c.json({ error: 'Failed to load stats' }, 500);
  }
});

export default community;
