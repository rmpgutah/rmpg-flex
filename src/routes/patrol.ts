// ============================================================
// RMPG Flex — Patrol (Cloudflare Worker)
// ============================================================
// Checkpoints + scans + breaks + tour verifications.
// Phase 1 RMS port — MVP scope covers the daily officer workflow.
//
// Migration: 0034_patrol.sql.
//
// Endpoints (19 MVP of 31 legacy):
//   GET    /checkpoints                     list (filter by property/active)
//   GET    /checkpoints/property/:propertyId
//   GET    /checkpoints/map                 lat/lng-only for map view
//   GET    /checkpoints/:id/instructions    special_instructions only
//   POST   /checkpoints                     admin/manager/supervisor
//   PUT    /checkpoints/:id
//   DELETE /checkpoints/:id
//   POST   /checkpoints/:id/archive
//   POST   /checkpoints/:id/unarchive
//   POST   /scan                            officer logs scan (auto on_time/late)
//   GET    /scans                           filter by officer/checkpoint/date
//   GET    /compliance                      property/officer roll-up
//   GET    /exceptions                      late + missed scans
//   GET    /shift-summary                   officer's scans + breaks for date
//   POST   /breaks/start
//   POST   /breaks/end
//   GET    /breaks                          filter by officer/date
//   POST   /verify-tour                     supervisor sign-off
//   GET    /verifications
//
// Deferred (analytics-heavy, can layer later):
//   - /optimize-route, /coverage-heatmap, /coverage/analysis
//   - /log/generate, /scans/export (PDF/CSV bulk export)
//   - /scan/:scanId/create-incident, /scan/:scanId/weather
//   - /efficiency, /time-tracking, /compliance/by-officer
//   - /breaks/summary, /proximity-check
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { emitAnalytics, flexEvent } from '../utils/analytics';

import { dbErrorResponse } from '../utils/dbErrors';
const pt = new Hono<Env>();

// ── Helpers ─────────────────────────────────────────────────

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

const SCAN_STATUSES = new Set(['on_time', 'late', 'missed']);
const BREAK_TYPES = new Set(['break', 'meal', 'rest']);

// How long an un-ended break is still considered the officer's CURRENT break
// by POST /breaks/start. Past this it is treated as abandoned (someone forgot
// to press End) and a new break is started instead. 12h comfortably covers a
// long shift, including one that crosses midnight, while guaranteeing a stale
// row can never permanently block the Break button. See the query below.
const OPEN_BREAK_WINDOW_HOURS = 12;

// ─────────────────────────────────────────────────────────────
// Static / specific paths first (Hono trie still prefers literals,
// but explicit ordering documents the contract).
// ─────────────────────────────────────────────────────────────

// GET /checkpoints/map
pt.get('/checkpoints/map', async (c) => {
  const propertyId = c.req.query('property_id');
  const where: string[] = ['is_active = 1', 'latitude IS NOT NULL', 'longitude IS NOT NULL'];
  const args: any[] = [];
  if (propertyId) { where.push('property_id = ?'); args.push(parseInt(propertyId, 10)); }
  const rows = await query(
    getDb(c.env),
    `SELECT id, property_id, name, latitude, longitude, sequence_order
       FROM patrol_checkpoints WHERE ${where.join(' AND ')} ORDER BY sequence_order`,
    ...args,
  );
  return c.json(rows);
});

// GET /checkpoints/property/:propertyId
pt.get('/checkpoints/property/:propertyId', async (c) => {
  const propertyId = parseInt(c.req.param('propertyId'), 10);
  if (!Number.isFinite(propertyId) || propertyId < 1) return c.json({ error: 'Invalid propertyId' }, 400);
  const includeArchived = c.req.query('include_archived') === '1';
  const sql = `SELECT * FROM patrol_checkpoints WHERE property_id = ?
               ${includeArchived ? '' : 'AND is_active = 1'}
               ORDER BY sequence_order ASC, id ASC`;
  return c.json(await query(getDb(c.env), sql, propertyId));
});

// GET /checkpoints/:id/instructions
pt.get('/checkpoints/:id/instructions', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const row = await queryFirst<{ id: number; name: string; special_instructions: string; location_description: string }>(
    getDb(c.env),
    'SELECT id, name, special_instructions, location_description FROM patrol_checkpoints WHERE id = ?',
    id,
  );
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

// GET /checkpoints
pt.get('/checkpoints', async (c) => {
  const propertyId = c.req.query('property_id');
  const includeArchived = c.req.query('include_archived') === '1';
  const where: string[] = [];
  const args: any[] = [];
  if (propertyId) { where.push('property_id = ?'); args.push(parseInt(propertyId, 10)); }
  if (!includeArchived) where.push('is_active = 1');
  const sql = `SELECT * FROM patrol_checkpoints
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY property_id, sequence_order, id LIMIT 1000`;
  return c.json(await query(getDb(c.env), sql, ...args));
});

// POST /checkpoints
pt.post('/checkpoints', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  if (!body.property_id || !body.name) {
    return c.json({ error: 'property_id and name required' }, 400);
  }
  const r = await execute(
    getDb(c.env),
    `INSERT INTO patrol_checkpoints (
       property_id, assigned_officer_id, name, description, location_description,
       special_instructions, latitude, longitude, qr_code, sequence_order,
       scan_required_interval_minutes, is_active
     ) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?)`,
    body.property_id, body.assigned_officer_id ?? null, body.name, body.description ?? null,
    body.location_description ?? null, body.special_instructions ?? null,
    body.latitude ?? null, body.longitude ?? null,
    // Auto-generate a QR code when the client omits one — otherwise the
    // "Show QR" button on a freshly-created checkpoint has nothing to render.
    body.qr_code ?? `CP-${crypto.randomUUID().slice(0, 12).toUpperCase()}`,
    body.sequence_order ?? 0, body.scan_required_interval_minutes ?? 60,
    body.is_active === false ? 0 : 1,
  );
  return c.json({ success: true, id: r.meta.last_row_id }, 201);
});

// PUT /checkpoints/:id
pt.put('/checkpoints/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const allowed = [
    'property_id', 'assigned_officer_id', 'name', 'description', 'location_description',
    'special_instructions', 'latitude', 'longitude', 'qr_code', 'sequence_order',
    'scan_required_interval_minutes', 'is_active',
  ];
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of allowed) {
    if (!(k in body)) continue;
    sets.push(`${k} = ?`);
    args.push(k === 'is_active' ? (body[k] ? 1 : 0) : body[k]);
  }
  if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
  args.push(id);
  await execute(getDb(c.env), `UPDATE patrol_checkpoints SET ${sets.join(', ')} WHERE id = ?`, ...args);
  return c.json({ success: true });
});

// DELETE /checkpoints/:id
pt.delete('/checkpoints/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  try {
    const db = getDb(c.env);
    // patrol_scans.checkpoint_id is a NOT NULL RESTRICT FK — a checkpoint that
    // was ever scanned can't be deleted until its scans are removed. Scans are
    // checkpoint-specific log rows, so purge them with the checkpoint.
    await execute(db, 'DELETE FROM patrol_scans WHERE checkpoint_id = ?', id);
    await execute(db, 'DELETE FROM patrol_checkpoints WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    console.error('[patrol] delete checkpoint failed:', err);
    return dbErrorResponse(c, err, 'Failed to delete checkpoint');
  }
});

// POST /checkpoints/:id/archive
pt.post('/checkpoints/:id/archive', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  await execute(
    getDb(c.env),
    `UPDATE patrol_checkpoints SET is_active = 0, archived_at = datetime('now') WHERE id = ?`,
    id,
  );
  return c.json({ success: true });
});

// POST /checkpoints/:id/unarchive
pt.post('/checkpoints/:id/unarchive', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  await execute(
    getDb(c.env),
    `UPDATE patrol_checkpoints SET is_active = 1, archived_at = NULL WHERE id = ?`,
    id,
  );
  return c.json({ success: true });
});

// ─────────────────────────────────────────────────────────────
// Scans
// ─────────────────────────────────────────────────────────────

// POST /scan — officer logs a checkpoint scan. Auto-classifies
// status as 'on_time' or 'late' based on last scan + interval.
pt.post('/scan', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json({ error: 'Unauthenticated' }, 401);
  const body = await c.req.json<any>().catch(() => ({}));
  if (!body.checkpoint_id) return c.json({ error: 'checkpoint_id required' }, 400);
  const db = getDb(c.env);

  const cp = await queryFirst<{ scan_required_interval_minutes: number; is_active: number }>(
    db, 'SELECT scan_required_interval_minutes, is_active FROM patrol_checkpoints WHERE id = ?', body.checkpoint_id,
  );
  if (!cp) return c.json({ error: 'Checkpoint not found' }, 404);
  if (!cp.is_active) return c.json({ error: 'Checkpoint is archived' }, 400);

  // Classify on_time/late by comparing minutes-since-last-scan to interval.
  const last = await queryFirst<{ scanned_at: string }>(
    db, 'SELECT scanned_at FROM patrol_scans WHERE checkpoint_id = ? ORDER BY id DESC LIMIT 1', body.checkpoint_id,
  );
  let status = 'on_time';
  if (last?.scanned_at) {
    // patrol_scans.scanned_at is written via datetime('now') → UTC. Parsing
    // it as a JS Date in a non-UTC browser/runtime would skew the delta by
    // hours. Compute minutes-since in SQL instead, where both sides
    // (julianday('now') and the stored value) are UTC — no timezone
    // juggling needed.
    const sinceRow = await queryFirst<{ mins: number }>(
      db,
      `SELECT (julianday('now') - julianday(?)) * 1440 AS mins`,
      last.scanned_at,
    );
    const minutesSince = Number(sinceRow?.mins ?? 0);
    if (minutesSince > cp.scan_required_interval_minutes * 1.5) status = 'late';
  }
  if (body.status && SCAN_STATUSES.has(body.status)) status = body.status; // explicit override

  const r = await execute(
    db,
    `INSERT INTO patrol_scans (checkpoint_id, officer_id, latitude, longitude, notes, status, weather_json)
     VALUES (?,?,?,?,?,?,?)`,
    body.checkpoint_id, user.id, body.latitude ?? null, body.longitude ?? null,
    body.notes ?? null, status, body.weather_json ? JSON.stringify(body.weather_json) : null,
  );

  // Analytics lakehouse: patrol-scan event = proof-of-patrol (best-effort, fire-and-forget).
  emitAnalytics(c, c.env.EVENTS, [flexEvent({
    event_type: 'patrol_scan', occurred_at: new Date().toISOString(),
    actor_id: user.id, entity_type: 'checkpoint', entity_id: body.checkpoint_id,
    lat: body.latitude, lng: body.longitude, status, category: 'patrol',
    payload: { scan_id: Number(r.meta.last_row_id) },
  })]);

  return c.json({ success: true, id: r.meta.last_row_id, status }, 201);
});

// GET /scans
pt.get('/scans', async (c) => {
  const officerId = c.req.query('officer_id');
  const checkpointId = c.req.query('checkpoint_id');
  const propertyId = c.req.query('property_id');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const where: string[] = [];
  const args: any[] = [];
  if (officerId) { where.push('s.officer_id = ?'); args.push(parseInt(officerId, 10)); }
  if (checkpointId) { where.push('s.checkpoint_id = ?'); args.push(parseInt(checkpointId, 10)); }
  if (propertyId) { where.push('cp.property_id = ?'); args.push(parseInt(propertyId, 10)); }
  // datetime-local inputs emit 'YYYY-MM-DDTHH:MM' but scanned_at is stored
  // 'YYYY-MM-DD HH:MM:SS' — a lexicographic compare with the 'T' separator
  // under-matches. Normalise both bounds to a space.
  if (from) { where.push('s.scanned_at >= ?'); args.push(String(from).replace('T', ' ')); }
  if (to) { where.push('s.scanned_at <= ?'); args.push(String(to).replace('T', ' ')); }
  const sql = `
    SELECT s.*, cp.name AS checkpoint_name, cp.property_id, u.full_name AS officer_name
      FROM patrol_scans s
      LEFT JOIN patrol_checkpoints cp ON cp.id = s.checkpoint_id
      LEFT JOIN users u ON u.id = s.officer_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY s.scanned_at DESC LIMIT 500`;
  return c.json(await query(getDb(c.env), sql, ...args));
});

// GET /scans/export?format=csv — same filters as /scans, returns CSV.
// The PatrolPage "Export CSV" toolbar button hits this; without it the
// download silently 404'd.
pt.get('/scans/export', async (c) => {
  const officerId = c.req.query('officer_id');
  const checkpointId = c.req.query('checkpoint_id');
  const propertyId = c.req.query('property_id');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const where: string[] = [];
  const args: any[] = [];
  if (officerId) { where.push('s.officer_id = ?'); args.push(parseInt(officerId, 10)); }
  if (checkpointId) { where.push('s.checkpoint_id = ?'); args.push(parseInt(checkpointId, 10)); }
  if (propertyId) { where.push('cp.property_id = ?'); args.push(parseInt(propertyId, 10)); }
  if (from) { where.push('s.scanned_at >= ?'); args.push(String(from).replace('T', ' ')); }
  if (to) { where.push('s.scanned_at <= ?'); args.push(String(to).replace('T', ' ')); }
  const rows = await query<any>(getDb(c.env), `
    SELECT s.id, s.scanned_at, cp.name AS checkpoint, p.name AS property,
           u.full_name AS officer, s.status, s.latitude, s.longitude, s.notes
      FROM patrol_scans s
      LEFT JOIN patrol_checkpoints cp ON cp.id = s.checkpoint_id
      LEFT JOIN properties p ON p.id = cp.property_id
      LEFT JOIN users u ON u.id = s.officer_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY s.scanned_at DESC LIMIT 5000`, ...args);
  const esc = (v: any) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = 'id,scanned_at,checkpoint,property,officer,status,latitude,longitude,notes';
  const body = rows.map((r: any) =>
    [r.id, r.scanned_at, r.checkpoint, r.property, r.officer, r.status, r.latitude, r.longitude, r.notes].map(esc).join(',')
  ).join('\n');
  return new Response(`${header}\n${body}\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="patrol-scans-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

// GET /compliance — per-property scan rate over a window
pt.get('/compliance', async (c) => {
  const propertyId = c.req.query('property_id');
  const days = parseInt(c.req.query('days') || '7', 10);
  const args: any[] = [days];
  let where = '';
  if (propertyId) { where = 'AND cp.property_id = ?'; args.push(parseInt(propertyId, 10)); }
  const rows = await query<any>(
    getDb(c.env),
    `SELECT cp.id, cp.name, cp.property_id,
            COUNT(s.id) AS scans,
            SUM(CASE WHEN s.status='on_time' THEN 1 ELSE 0 END) AS on_time,
            SUM(CASE WHEN s.status='late' THEN 1 ELSE 0 END) AS late,
            SUM(CASE WHEN s.status='missed' THEN 1 ELSE 0 END) AS missed
       FROM patrol_checkpoints cp
       LEFT JOIN patrol_scans s
         ON s.checkpoint_id = cp.id
        AND s.scanned_at >= datetime('now','-' || ? || ' days')
       WHERE cp.is_active = 1 ${where}
       GROUP BY cp.id, cp.name, cp.property_id
       ORDER BY cp.property_id, cp.sequence_order`,
    ...args,
  );
  return c.json({
    days,
    checkpoints: rows.map((r) => ({
      ...r,
      on_time_pct: r.scans ? Math.round((r.on_time / r.scans) * 10000) / 100 : 0,
    })),
  });
});

// GET /exceptions — late / missed scans needing attention
pt.get('/exceptions', async (c) => {
  const days = parseInt(c.req.query('days') || '3', 10);
  const rows = await query(
    getDb(c.env),
    `SELECT s.*, cp.name AS checkpoint_name, cp.property_id, u.full_name AS officer_name
       FROM patrol_scans s
       LEFT JOIN patrol_checkpoints cp ON cp.id = s.checkpoint_id
       LEFT JOIN users u ON u.id = s.officer_id
       WHERE s.status IN ('late','missed')
         AND s.scanned_at >= datetime('now','-' || ? || ' days')
       ORDER BY s.scanned_at DESC LIMIT 200`,
    days,
  );
  return c.json(rows);
});

// GET /shift-summary — single officer's scans + breaks for a date
pt.get('/shift-summary', async (c) => {
  const officerId = parseInt(c.req.query('officer_id') || '0', 10);
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);
  if (!officerId) return c.json({ error: 'officer_id required' }, 400);
  const db = getDb(c.env);
  const scans = await query<any>(
    db,
    // cp.property_id is needed for the properties_visited derivation below.
    // patrol_scans has no property_id of its own; it lives on patrol_checkpoints.
    `SELECT s.*, cp.name AS checkpoint_name, cp.property_id AS property_id
       FROM patrol_scans s
       LEFT JOIN patrol_checkpoints cp ON cp.id = s.checkpoint_id
       WHERE s.officer_id = ? AND date(s.scanned_at) = ?
       ORDER BY s.scanned_at ASC`,
    officerId, date,
  );
  const breaks = await query<any>(
    db,
    `SELECT * FROM patrol_breaks WHERE officer_id = ? AND shift_date = ? ORDER BY break_start ASC`,
    officerId, date,
  );
  // Derived fields the Shift Summary panel renders. Scan-based counts are exact;
  // break minutes are summed from duration_minutes (or break_start/end diff).
  const scans_total = scans.length;
  const scans_on_time = scans.filter((s: any) => s.status === 'on_time').length;
  const scans_late = scans.filter((s: any) => s.status === 'late').length;
  let total_break_minutes = 0;
  for (const b of breaks) {
    if (b.duration_minutes != null) {
      total_break_minutes += Number(b.duration_minutes) || 0;
    } else if (b.break_start && b.break_end) {
      const ms = new Date(b.break_end).getTime() - new Date(b.break_start).getTime();
      if (ms > 0) total_break_minutes += Math.round(ms / 60000);
    }
  }
  const properties_visited = Array.from(new Set(scans.map((s: any) => s.property_id).filter(Boolean)));
  return c.json({
    officer_id: officerId, date, scans, breaks, scan_count: scans.length,
    scans_total, scans_on_time, scans_late, total_break_minutes,
    properties_visited,
    // Not yet computed server-side — surfaced as 0 so the panel renders cleanly
    // rather than showing blanks (tracked as a follow-up enrichment).
    incidents_count: 0, estimated_mileage: 0,
  });
});

// ─────────────────────────────────────────────────────────────
// Breaks
// ─────────────────────────────────────────────────────────────

// POST /breaks/start
pt.post('/breaks/start', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json({ error: 'Unauthenticated' }, 401);
  const body = await c.req.json<any>().catch(() => ({}));
  const breakType = BREAK_TYPES.has(body.break_type) ? body.break_type : 'break';
  const today = new Date().toISOString().slice(0, 10);
  const db = getDb(c.env);

  // An officer can only be on ONE break at a time, and this INSERT used to be
  // unconditional. A double-click (or a second device) therefore created two
  // rows with break_end IS NULL — and /breaks/end below closes only the
  // most-recent open break, so the EARLIER duplicate could never be closed by
  // any later action. It stayed open forever and skewed break/time tracking.
  //
  // Confirmed in live data before this fix: patrol_breaks ids 3/4 (2026-07-04
  // 04:18:21 and :23) and 10/11 (2026-07-29 21:26:43 and :45) are double-click
  // pairs two seconds apart.
  //
  // Returning the already-open break makes "start break" idempotent, which the
  // client-side disabled guard alone cannot achieve across tabs or devices.
  const open = await queryFirst<{ id: number; break_start: string; break_type: string }>(
    db,
    // The window is load-bearing, not a nicety. "Has an open break" was
    // originally unbounded in time, but an officer who forgets to press End
    // leaves a row open forever — and an unbounded guard then treats that
    // abandoned row as the officer's CURRENT break and never lets them start
    // a new one again. Live D1 had 7 such rows for officer 1, the oldest from
    // 2026-06-09, so /breaks/start would have returned a two-day-old break on
    // every click and the Break button would have looked broken.
    //
    // A break older than the window is abandoned, not open: ignore it and
    // start a fresh one. Deliberately NOT scoped to shift_date — a night shift
    // legitimately spans midnight, so a date comparison would split it.
    `SELECT id, break_start, break_type FROM patrol_breaks
       WHERE officer_id = ? AND break_end IS NULL
         AND break_start >= datetime('now', ?)
       ORDER BY id DESC LIMIT 1`,
    user.id, `-${OPEN_BREAK_WINDOW_HOURS} hours`,
  );
  if (open) {
    return c.json({
      success: true,
      id: open.id,
      break_start: open.break_start,
      break_type: open.break_type,
      already_open: true,
    });
  }

  const r = await execute(
    db,
    `INSERT INTO patrol_breaks (officer_id, shift_date, break_start, break_type)
     VALUES (?,?, datetime('now'), ?)`,
    user.id, body.shift_date ?? today, breakType,
  );
  // Return the canonical server clock so the client's elapsed counter does not
  // drift off the device clock (it previously fell back to a local new Date()
  // because this handler never sent break_start at all).
  const created = await queryFirst<{ break_start: string }>(
    db,
    'SELECT break_start FROM patrol_breaks WHERE id = ?',
    r.meta.last_row_id,
  );
  return c.json({
    success: true,
    id: r.meta.last_row_id,
    break_start: created?.break_start,
    break_type: breakType,
    already_open: false,
  }, 201);
});

// POST /breaks/end — close the most-recent open break for this officer.
// duration_minutes is computed in SQL to keep the clock authoritative.
pt.post('/breaks/end', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json({ error: 'Unauthenticated' }, 401);
  const db = getDb(c.env);
  const open = await queryFirst<{ id: number; break_start: string }>(
    db,
    `SELECT id, break_start FROM patrol_breaks
       WHERE officer_id = ? AND break_end IS NULL
       ORDER BY id DESC LIMIT 1`,
    user.id,
  );
  if (!open) return c.json({ error: 'No open break to end' }, 404);
  await execute(
    db,
    `UPDATE patrol_breaks
       SET break_end = datetime('now'),
           duration_minutes = (julianday(datetime('now')) - julianday(break_start)) * 1440
     WHERE id = ?`,
    open.id,
  );
  return c.json({ success: true, id: open.id });
});

// GET /breaks
pt.get('/breaks', async (c) => {
  const officerId = c.req.query('officer_id');
  const date = c.req.query('date');
  const where: string[] = [];
  const args: any[] = [];
  if (officerId) { where.push('officer_id = ?'); args.push(parseInt(officerId, 10)); }
  if (date) { where.push('shift_date = ?'); args.push(date); }
  const sql = `SELECT * FROM patrol_breaks ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY break_start DESC LIMIT 200`;
  return c.json(await query(getDb(c.env), sql, ...args));
});

// ─────────────────────────────────────────────────────────────
// Tour verifications
// ─────────────────────────────────────────────────────────────

// POST /verify-tour — supervisor approves a tour. Snapshots total +
// on-time scan counts from patrol_scans for the (officer,date) pair.
pt.post('/verify-tour', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  if (!body.officer_id || !body.tour_date) {
    return c.json({ error: 'officer_id and tour_date required' }, 400);
  }
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);
  const totals = await queryFirst<{ total: number; on_time: number }>(
    db,
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status='on_time' THEN 1 ELSE 0 END) AS on_time
       FROM patrol_scans WHERE officer_id = ? AND date(scanned_at) = ?`,
    body.officer_id, body.tour_date,
  );
  const status = body.status === 'rejected' ? 'rejected' : 'approved';
  // Upsert via INSERT OR REPLACE on the UNIQUE(officer_id, tour_date).
  const r = await execute(
    db,
    `INSERT INTO patrol_tour_verifications
       (officer_id, tour_date, verified_by, verified_at, status, notes, total_scans, on_time_scans)
     VALUES (?,?,?, datetime('now'), ?, ?, ?, ?)
     ON CONFLICT(officer_id, tour_date) DO UPDATE SET
       verified_by = excluded.verified_by,
       verified_at = excluded.verified_at,
       status = excluded.status,
       notes = excluded.notes,
       total_scans = excluded.total_scans,
       on_time_scans = excluded.on_time_scans,
       updated_at = datetime('now')`,
    body.officer_id, body.tour_date, user?.id ?? null, status, body.notes ?? null,
    totals?.total ?? 0, totals?.on_time ?? 0,
  );
  return c.json({ success: true, id: r.meta.last_row_id, status, totals });
});

// GET /verifications
pt.get('/verifications', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const officerId = c.req.query('officer_id');
  const where: string[] = [];
  const args: any[] = [];
  if (officerId) { where.push('officer_id = ?'); args.push(parseInt(officerId, 10)); }
  const sql = `SELECT v.*, o.full_name AS officer_name, vb.full_name AS verified_by_name
                 FROM patrol_tour_verifications v
                 LEFT JOIN users o ON o.id = v.officer_id
                 LEFT JOIN users vb ON vb.id = v.verified_by
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY v.tour_date DESC LIMIT 200`;
  return c.json(await query(getDb(c.env), sql, ...args));
});

// ============================================================
// Analytics / log-generation endpoints — added 2026-06-06.
// PatrolPage calls /log/generate, /optimize-route, /time-tracking,
// /coverage-heatmap, /efficiency on the analytics tab. Without
// these the page renders no data and the console 404-floods.
// Lightweight stubs backed by real aggregations against the
// patrol_* tables — the data is real, the response shape is
// minimal so the client renders empty-tile gracefully if a
// table is empty (patrol_checkpoints / patrol_scans).
// ============================================================

pt.get('/log/generate', async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = c.req.query('officer_id');
    const start = c.req.query('start') || new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
    const end = c.req.query('end') || new Date().toISOString().slice(0, 10);
    const args: any[] = [start, end];
    let officerFilter = '';
    if (officerId) { officerFilter = ' AND officer_id = ?'; args.push(parseInt(officerId, 10)); }
    const rows = await query<any>(
      db,
      `SELECT date(scanned_at) AS day,
              COUNT(*) AS total_scans,
              SUM(CASE WHEN status = 'on_time' THEN 1 ELSE 0 END) AS on_time_scans,
              COUNT(DISTINCT checkpoint_id) AS unique_checkpoints
         FROM patrol_scans
        WHERE date(scanned_at) BETWEEN ? AND ?${officerFilter}
        GROUP BY date(scanned_at)
        ORDER BY day`,
      ...args,
    );
    return c.json({ start, end, days: rows });
  } catch (err) {
    console.error('GET /patrol/log/generate failed:', err);
    return c.json({ days: [] });
  }
});

pt.get('/optimize-route', async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = c.req.query('officer_id');
    const propertyId = c.req.query('property_id');
    // Optional starting position (officer's current GPS). When omitted, the
    // first checkpoint is used as the starting node — the route still
    // optimises pairwise distances, just with an arbitrary anchor.
    const startLat = parseFloat(c.req.query('start_lat') || '');
    const startLng = parseFloat(c.req.query('start_lng') || '');
    const hasStart = Number.isFinite(startLat) && Number.isFinite(startLng);

    const where: string[] = ['is_active = 1', 'latitude IS NOT NULL', 'longitude IS NOT NULL'];
    const args: any[] = [];
    if (officerId) { where.push('assigned_officer_id = ?'); args.push(parseInt(officerId, 10)); }
    if (propertyId) { where.push('property_id = ?'); args.push(parseInt(propertyId, 10)); }
    const checkpoints = await query<{
      id: number; name: string; latitude: number; longitude: number; property_id: number | null;
    }>(
      db,
      `SELECT id, name, latitude, longitude, property_id
         FROM patrol_checkpoints
         WHERE ${where.join(' AND ')}
         ORDER BY property_id, sequence_order, id
         LIMIT 100`,
      ...args,
    );

    if (checkpoints.length === 0) {
      return c.json({
        officer_id: officerId ? parseInt(officerId, 10) : null,
        checkpoints: [],
        optimized_order: [],
        suggested_order: [],
        total_distance_km: 0,
        total_distance_meters: 0,
        optimized_at: new Date().toISOString(),
      });
    }
    if (checkpoints.length === 1) {
      const only = checkpoints[0];
      const d = hasStart ? haversineKm(startLat, startLng, only.latitude, only.longitude) : 0;
      return c.json({
        officer_id: officerId ? parseInt(officerId, 10) : null,
        checkpoints,
        optimized_order: [{ ...only, distance_from_previous_km: round2(d) }],
        suggested_order: [only.id],
        total_distance_km: round2(d),
        total_distance_meters: Math.round(d * 1000),
        optimized_at: new Date().toISOString(),
      });
    }

    // ── Pairwise distance matrix (Haversine, km) ──
    // Index 0 is the starting node (officer GPS or first checkpoint); 1..N
    // are the real checkpoints. For O(N²) memory at N≤100 this is ~80KB —
    // fine in a Worker.
    type Node = { lat: number; lng: number; cp?: typeof checkpoints[number] };
    const nodes: Node[] = [];
    if (hasStart) nodes.push({ lat: startLat, lng: startLng });
    for (const cp of checkpoints) nodes.push({ lat: cp.latitude, lng: cp.longitude, cp });
    const N = nodes.length;
    const dist: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const d = haversineKm(nodes[i].lat, nodes[i].lng, nodes[j].lat, nodes[j].lng);
        dist[i][j] = d; dist[j][i] = d;
      }
    }

    // ── Nearest-neighbor seed ──
    // Always start at node 0 (the anchor) and never revisit. NN is O(N²);
    // for our N≤100 this is microseconds.
    const tour: number[] = [0];
    const visited = new Uint8Array(N);
    visited[0] = 1;
    for (let step = 1; step < N; step++) {
      const last = tour[tour.length - 1];
      let best = -1; let bestD = Infinity;
      for (let j = 0; j < N; j++) {
        if (visited[j]) continue;
        if (dist[last][j] < bestD) { bestD = dist[last][j]; best = j; }
      }
      if (best === -1) break;
      visited[best] = 1;
      tour.push(best);
    }

    // ── 2-opt improvement ──
    // Classic edge-swap loop: while any swap (i,k) improves the tour cost,
    // accept it and restart. We DO NOT close the loop back to node 0 — this
    // is an open path (officer ends at the last checkpoint, not back at
    // their starting position). 2-opt converges quickly for N≤100; cap at
    // a few iterations as a runtime safety net.
    const tourCost = (t: number[]) => {
      let s = 0;
      for (let i = 0; i < t.length - 1; i++) s += dist[t[i]][t[i + 1]];
      return s;
    };
    let improved = true;
    let safetyIters = 0;
    const maxIters = 200; // bounded — practical convergence is well under this
    while (improved && safetyIters++ < maxIters) {
      improved = false;
      for (let i = 1; i < tour.length - 1; i++) {
        for (let k = i + 1; k < tour.length; k++) {
          // Reverse tour[i..k] and see if total cost drops.
          const a = tour[i - 1], b = tour[i], cN = tour[k];
          const dNext = k + 1 < tour.length ? tour[k + 1] : -1;
          const before = dist[a][b] + (dNext >= 0 ? dist[cN][dNext] : 0);
          const after = dist[a][cN] + (dNext >= 0 ? dist[b][dNext] : 0);
          if (after + 1e-9 < before) {
            // Reverse in place
            let lo = i, hi = k;
            while (lo < hi) { const tmp = tour[lo]; tour[lo] = tour[hi]; tour[hi] = tmp; lo++; hi--; }
            improved = true;
          }
        }
      }
    }

    // ── Build response ──
    let total = 0;
    const optimized_order = [];
    for (let i = 0; i < tour.length; i++) {
      const node = nodes[tour[i]];
      if (!node.cp) continue; // skip the synthetic start node
      const prev = i > 0 ? dist[tour[i - 1]][tour[i]] : 0;
      total += prev;
      optimized_order.push({
        id: node.cp.id,
        name: node.cp.name,
        latitude: node.cp.latitude,
        longitude: node.cp.longitude,
        property_id: node.cp.property_id,
        distance_from_previous_km: round2(prev),
      });
    }

    return c.json({
      officer_id: officerId ? parseInt(officerId, 10) : null,
      start: hasStart ? { latitude: startLat, longitude: startLng } : null,
      checkpoints,
      optimized_order,
      // Backwards-compatible alias the older client field expected.
      suggested_order: optimized_order.map(o => o.id),
      total_distance_km: round2(total),
      total_distance_meters: Math.round(total * 1000),
      algorithm: '2-opt over nearest-neighbor seed',
      iterations: safetyIters,
      optimized_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /patrol/optimize-route failed:', err);
    return dbErrorResponse(c, err, 'optimization failed');
  }
});

// Haversine distance (kilometres) between two WGS84 points.
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // earth radius km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

pt.get('/time-tracking', async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = c.req.query('officer_id');
    const days = Math.min(parseInt(c.req.query('days') || '7', 10) || 7, 90);
    // NEGATIVE offset: datetime('now', '-7 days') looks back 7 days. Binding a
    // positive value built datetime('now','7 days') (7 days in the FUTURE), which
    // matched no rows. Sibling /coverage-heatmap + /efficiency already use -days.
    const args: any[] = [-days];
    let officerFilter = '';
    if (officerId) { officerFilter = ' AND officer_id = ?'; args.push(parseInt(officerId, 10)); }
    const rows = await query<any>(
      db,
      `SELECT date(scanned_at) AS day,
              SUM(CASE WHEN status = 'on_time' THEN 1 ELSE 0 END) AS on_time_scans,
              SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) AS late_scans,
              SUM(CASE WHEN status = 'missed' THEN 1 ELSE 0 END) AS missed_scans
         FROM patrol_scans
        WHERE scanned_at >= datetime('now', ? || ' days')${officerFilter}
        GROUP BY date(scanned_at)
        ORDER BY day`,
      ...args,
    );
    return c.json({ days, summary: rows });
  } catch (err) {
    console.error('GET /patrol/time-tracking failed:', err);
    return c.json({ days: 0, summary: [] });
  }
});

pt.get('/coverage-heatmap', async (c) => {
  try {
    const db = getDb(c.env);
    const days = Math.min(parseInt(c.req.query('days') || '7', 10) || 7, 90);
    // 24x7 grid of scan counts — used by PatrolPage's coverage card.
    const rows = await query<any>(
      db,
      `SELECT CAST(strftime('%H', scanned_at) AS INTEGER) AS hour,
              CAST(strftime('%w', scanned_at) AS INTEGER) AS dow,
              COUNT(*) AS count
         FROM patrol_scans
        WHERE scanned_at >= datetime('now', ? || ' days')
        GROUP BY hour, dow
        ORDER BY dow, hour`,
      -days,
    );
    return c.json({ days, cells: rows });
  } catch (err) {
    console.error('GET /patrol/coverage-heatmap failed:', err);
    return c.json({ days: 0, cells: [] });
  }
});

pt.get('/efficiency', async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = c.req.query('officer_id');
    const days = Math.min(parseInt(c.req.query('days') || '7', 10) || 7, 90);
    const args: any[] = [-days];
    let filter = '';
    if (officerId) { filter = ' AND s.officer_id = ?'; args.push(parseInt(officerId, 10)); }
    const row = await queryFirst<any>(
      db,
      `SELECT COUNT(*) AS total_scans,
              SUM(CASE WHEN s.status = 'on_time' THEN 1 ELSE 0 END) AS on_time_scans,
              COUNT(DISTINCT s.checkpoint_id) AS unique_checkpoints,
              COUNT(DISTINCT s.officer_id) AS active_officers
         FROM patrol_scans s
        WHERE s.scanned_at >= datetime('now', ? || ' days')${filter}`,
      ...args,
    );
    return c.json({
      days,
      officer_id: officerId ? parseInt(officerId, 10) : null,
      total_scans: row?.total_scans ?? 0,
      on_time_scans: row?.on_time_scans ?? 0,
      unique_checkpoints: row?.unique_checkpoints ?? 0,
      active_officers: row?.active_officers ?? 0,
      efficiency_pct: row?.total_scans ? Math.round(((row.on_time_scans ?? 0) / row.total_scans) * 100) : 0,
    });
  } catch (err) {
    console.error('GET /patrol/efficiency failed:', err);
    return c.json({ days: 0, total_scans: 0, on_time_scans: 0, efficiency_pct: 0 });
  }
});

export default pt;
