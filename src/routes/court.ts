// ============================================================
// RMPG Flex — Court Events (Cloudflare Worker)
// ============================================================
// Court date tracking, subpoenas, outcomes, continuances, witnesses.
// Phase 1 RMS port. Subpoenas are court_events with event_type='subpoena'
// (legacy single-table pattern preserved).
//
// Migration: 0032_court_events.sql.
//
// Endpoints (24 — most legacy /events/:id/* column-update endpoints
// are real single-purpose routes because the React client posts one
// "concern" at a time; the wide PUT /:id is the catch-all):
//
//   GET    /events                       list with filters
//   GET    /events/upcoming
//   GET    /calendar                     date-range index
//   GET    /events/:id
//   POST   /events
//   PUT    /events/:id
//   DELETE /events/:id                   admin only
//   PUT    /events/:id/outcome
//   PUT    /events/:id/verdict
//   PUT    /events/:id/confirm           officer confirms attendance
//   POST   /events/:id/continuance       reschedule + log
//   POST   /events/:id/clone
//   POST   /events/:id/documents         append to documents JSON
//   PUT    /events/:id/witnesses         replace witnesses JSON
//   GET    /events/:id/witnesses
//   PUT    /events/:id/judge-notes
//   PUT    /events/:id/prosecutor
//   PUT    /events/:id/fees
//   PUT    /events/:id/bail
//   POST   /events/from-citation         create from existing citation
//   GET    /events/:id/conflicts         schedule conflict scan
//   GET    /events/:id/linked-records
//   POST   /subpoenas                    create event_type='subpoena'
//   GET    /subpoenas/officer/:officerId
//   GET    /statistics
//   GET    /compliance-rate
//
// Deferred to follow-up PR: generate-reminders / generate-7day-reminders
// (depend on WebSocket notification fan-out + email/SMS that aren't yet
// ported to the Worker).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const ct = new Hono<Env>();

// ── Helpers ─────────────────────────────────────────────────

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

async function generateEventNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const yy = String(new Date().getFullYear());
  const prefix = `CRT-${yy}-`;
  const row = await queryFirst<{ event_number: string }>(
    db,
    `SELECT event_number FROM court_events WHERE event_number LIKE ? ORDER BY id DESC LIMIT 1`,
    `${prefix}%`,
  );
  let seq = 1;
  if (row?.event_number) {
    const parts = row.event_number.split('-');
    const n = parseInt(parts[2], 10);
    seq = isNaN(n) ? 1 : n + 1;
  }
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

function parseJsonCol<T = any>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== 'string') return v as T;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

const EVENT_TYPES = new Set([
  'arraignment', 'pretrial', 'trial', 'sentencing', 'hearing',
  'subpoena', 'status_conference', 'motion', 'plea', 'review', 'other',
]);
const EVENT_STATUSES = new Set([
  'scheduled', 'confirmed', 'continued', 'completed', 'cancelled', 'no_show',
]);

// ── GET /events ─────────────────────────────────────────────
ct.get('/events', async (c) => {
  const db = getDb(c.env);
  const status = c.req.query('status');
  const type = c.req.query('type');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const search = c.req.query('q');
  const limit = Math.min(parseInt(c.req.query('limit') || '200', 10), 1000);

  const where: string[] = [];
  const args: any[] = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (type) { where.push('event_type = ?'); args.push(type); }
  if (from) { where.push('event_date >= ?'); args.push(from); }
  if (to) { where.push('event_date <= ?'); args.push(to); }
  if (search) {
    where.push('(defendant_name LIKE ? OR court_case_number LIKE ? OR event_number LIKE ?)');
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const sql = `SELECT * FROM court_events
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY event_date ASC, event_time ASC LIMIT ?`;
  args.push(limit);
  return c.json(await query(db, sql, ...args));
});

// ── GET /events/upcoming ────────────────────────────────────
ct.get('/events/upcoming', async (c) => {
  const days = parseInt(c.req.query('days') || '14', 10);
  const today = new Date().toISOString().slice(0, 10);
  const sql = `SELECT * FROM court_events
               WHERE event_date >= ? AND event_date <= date(?, '+' || ? || ' days')
                 AND status NOT IN ('cancelled','completed','no_show')
               ORDER BY event_date ASC, event_time ASC LIMIT 500`;
  return c.json(await query(getDb(c.env), sql, today, today, days));
});

// ── GET /calendar ───────────────────────────────────────────
ct.get('/calendar', async (c) => {
  const from = c.req.query('from') || new Date().toISOString().slice(0, 10);
  const to = c.req.query('to') || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const rows = await query<any>(
    getDb(c.env),
    `SELECT id, event_number, event_type, status, event_date, event_time,
            court_name, courtroom, defendant_name, judge_name
       FROM court_events
       WHERE event_date BETWEEN ? AND ?
       ORDER BY event_date ASC, event_time ASC LIMIT 2000`,
    from, to,
  );
  // Bucket by date for calendar UI.
  const byDate: Record<string, any[]> = {};
  for (const r of rows) (byDate[r.event_date] ??= []).push(r);
  return c.json({ from, to, events: rows, by_date: byDate });
});

// ── GET /statistics ─────────────────────────────────────────
ct.get('/statistics', async (c) => {
  const db = getDb(c.env);
  const total = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM court_events');
  const scheduled = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM court_events WHERE status='scheduled'");
  const completed = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM court_events WHERE status='completed'");
  const noShow = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM court_events WHERE status='no_show'");
  const upcoming7 = await queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM court_events WHERE event_date BETWEEN date('now','localtime') AND date('now','localtime','+7 days')`,
  );
  const byType = await query<{ event_type: string; n: number }>(
    db,
    `SELECT event_type, COUNT(*) AS n FROM court_events GROUP BY event_type`,
  );
  return c.json({
    total: total?.n ?? 0,
    scheduled: scheduled?.n ?? 0,
    completed: completed?.n ?? 0,
    no_show: noShow?.n ?? 0,
    upcoming_7d: upcoming7?.n ?? 0,
    by_type: byType,
  });
});

// ── GET /compliance-rate ────────────────────────────────────
ct.get('/compliance-rate', async (c) => {
  const db = getDb(c.env);
  const closed = await queryFirst<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM court_events WHERE status IN ('completed','no_show')",
  );
  const noShow = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM court_events WHERE status='no_show'");
  const c1 = closed?.n ?? 0;
  const n1 = noShow?.n ?? 0;
  const rate = c1 ? Math.round(((c1 - n1) / c1) * 10000) / 100 : 0;
  return c.json({ closed_events: c1, no_shows: n1, compliance_pct: rate });
});

// ── GET /subpoenas/officer/:officerId ───────────────────────
ct.get('/subpoenas/officer/:officerId', async (c) => {
  const officerId = c.req.param('officerId');
  const rows = await query<any>(
    getDb(c.env),
    `SELECT * FROM court_events
       WHERE event_type = 'subpoena' AND officers_required LIKE ?
       ORDER BY event_date ASC LIMIT 200`,
    `%"${officerId}"%`,
  );
  return c.json(rows);
});

// ── POST /subpoenas ─────────────────────────────────────────
ct.post('/subpoenas', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);

  if (!body.hearing_date) return c.json({ error: 'hearing_date required' }, 400);
  const eventNumber = await generateEventNumber(db);
  const officersReq = JSON.stringify(Array.isArray(body.officers_required) ? body.officers_required : []);

  const r = await execute(
    db,
    `INSERT INTO court_events (
       event_number, event_type, status, event_date, event_time,
       court_name, courtroom, court_case_number, defendant_name,
       officers_required, notes, created_by
     ) VALUES (?, 'subpoena', 'scheduled', ?,?, ?,?,?,?, ?,?,?)`,
    eventNumber, body.hearing_date, body.hearing_time ?? null,
    body.court_name ?? null, body.courtroom ?? null, body.court_case_number ?? null,
    body.defendant_name ?? null, officersReq, body.notes ?? null, user?.id ?? null,
  );
  return c.json({ success: true, id: r.meta.last_row_id, event_number: eventNumber }, 201);
});

// ── POST /events/from-citation ──────────────────────────────
ct.post('/events/from-citation', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  if (!body.citation_id || !body.event_date) {
    return c.json({ error: 'citation_id and event_date required' }, 400);
  }
  const db = getDb(c.env);
  const cit = await queryFirst<any>(db, 'SELECT * FROM citations WHERE id = ?', body.citation_id);
  if (!cit) return c.json({ error: 'Citation not found' }, 404);

  const eventNumber = await generateEventNumber(db);
  const r = await execute(
    db,
    `INSERT INTO court_events (
       event_number, event_type, status, event_date, event_time,
       court_name, citation_id, defendant_name, defendant_person_id, created_by
     ) VALUES (?, ?, 'scheduled', ?,?, ?,?,?,?,?)`,
    eventNumber, body.event_type ?? 'arraignment', body.event_date, body.event_time ?? null,
    body.court_name ?? cit.court_name ?? null, body.citation_id,
    body.defendant_name ?? cit.violator_name ?? null,
    body.defendant_person_id ?? cit.violator_person_id ?? null,
    user?.id ?? null,
  );
  return c.json({ success: true, id: r.meta.last_row_id, event_number: eventNumber }, 201);
});

// ── GET /events/:id ─────────────────────────────────────────
ct.get('/events/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const row = await queryFirst<any>(getDb(c.env), 'SELECT * FROM court_events WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  row.officers_required = parseJsonCol(row.officers_required, []);
  row.officer_confirmations = parseJsonCol(row.officer_confirmations, {});
  row.continuance_log = parseJsonCol(row.continuance_log, []);
  row.documents = parseJsonCol(row.documents, []);
  row.witnesses = parseJsonCol(row.witnesses, []);
  row.court_fees = parseJsonCol(row.court_fees, {});
  return c.json(row);
});

// ── GET /events/:id/conflicts ───────────────────────────────
ct.get('/events/:id/conflicts', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const ev = await queryFirst<any>(db, 'SELECT * FROM court_events WHERE id = ?', id);
  if (!ev) return c.json({ error: 'Not found' }, 404);
  const officers = parseJsonCol<string[]>(ev.officers_required, []);
  if (!officers.length) return c.json({ conflicts: [], total: 0 });

  // Same-day events with overlapping officer requirements.
  const others = await query<any>(
    db,
    `SELECT id, event_number, event_type, event_time, court_name, officers_required
       FROM court_events
       WHERE event_date = ? AND id != ? AND status IN ('scheduled','confirmed')`,
    ev.event_date, id,
  );
  const conflicts: any[] = [];
  for (const o of others) {
    const otherOfficers = parseJsonCol<string[]>(o.officers_required, []);
    const overlap = officers.filter((x) => otherOfficers.includes(x));
    if (overlap.length) {
      conflicts.push({ event_id: o.id, event_number: o.event_number, event_time: o.event_time, overlap_officers: overlap });
    }
  }
  return c.json({ event_id: id, date: ev.event_date, conflicts, total: conflicts.length });
});

// ── GET /events/:id/witnesses ───────────────────────────────
ct.get('/events/:id/witnesses', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const row = await queryFirst<{ witnesses: string }>(getDb(c.env), 'SELECT witnesses FROM court_events WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(parseJsonCol(row.witnesses, []));
});

// ── GET /events/:id/linked-records ──────────────────────────
ct.get('/events/:id/linked-records', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const ev = await queryFirst<any>(db, 'SELECT citation_id, incident_id, case_id, defendant_person_id FROM court_events WHERE id = ?', id);
  if (!ev) return c.json({ error: 'Not found' }, 404);
  const out: Record<string, any> = {};
  if (ev.citation_id) out.citation = await queryFirst(db, 'SELECT id, citation_number, violation, violator_name FROM citations WHERE id = ?', ev.citation_id);
  if (ev.incident_id) out.incident = await queryFirst(db, 'SELECT id, incident_number, incident_type FROM incidents WHERE id = ?', ev.incident_id);
  if (ev.case_id) out.case = await queryFirst(db, 'SELECT id, case_number, title FROM cases WHERE id = ?', ev.case_id);
  if (ev.defendant_person_id) out.defendant = await queryFirst(db, 'SELECT id, first_name, last_name, dob FROM persons WHERE id = ?', ev.defendant_person_id);
  return c.json(out);
});

// ── POST /events ────────────────────────────────────────────
ct.post('/events', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);

  if (!body.event_type || !body.event_date) {
    return c.json({ error: 'event_type and event_date required' }, 400);
  }
  if (!EVENT_TYPES.has(body.event_type)) {
    return c.json({ error: `event_type must be one of: ${[...EVENT_TYPES].join(', ')}` }, 400);
  }

  const eventNumber = body.event_number || await generateEventNumber(db);
  const r = await execute(
    db,
    `INSERT INTO court_events (
       event_number, event_type, status, event_date, event_time,
       court_name, courtroom, judge_name, court_case_number,
       citation_id, incident_id, case_id, defendant_person_id, defendant_name, defendant_dob,
       prosecutor, prosecutor_phone, prosecutor_email, defense_attorney,
       officers_required, notes, created_by
     ) VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?, ?,?,?,?, ?,?,?)`,
    eventNumber, body.event_type, body.status ?? 'scheduled', body.event_date, body.event_time ?? null,
    body.court_name ?? null, body.courtroom ?? null, body.judge_name ?? null, body.court_case_number ?? null,
    body.citation_id ?? null, body.incident_id ?? null, body.case_id ?? null,
    body.defendant_person_id ?? null, body.defendant_name ?? null, body.defendant_dob ?? null,
    body.prosecutor ?? null, body.prosecutor_phone ?? null, body.prosecutor_email ?? null, body.defense_attorney ?? null,
    JSON.stringify(body.officers_required ?? []), body.notes ?? null, user?.id ?? null,
  );
  return c.json({ success: true, id: r.meta.last_row_id, event_number: eventNumber }, 201);
});

// ── PUT /events/:id ─────────────────────────────────────────
ct.put('/events/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const db = getDb(c.env);

  const allowed = [
    'event_type', 'status', 'event_date', 'event_time',
    'court_name', 'courtroom', 'judge_name', 'court_case_number',
    'citation_id', 'incident_id', 'case_id', 'defendant_person_id',
    'defendant_name', 'defendant_dob', 'prosecutor', 'prosecutor_phone',
    'prosecutor_email', 'defense_attorney', 'officers_required', 'notes',
  ];
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of allowed) {
    if (!(k in body)) continue;
    if (k === 'event_type' && body[k] && !EVENT_TYPES.has(body[k])) continue;
    if (k === 'status' && body[k] && !EVENT_STATUSES.has(body[k])) continue;
    let v = body[k];
    if (k === 'officers_required' && typeof v !== 'string') v = JSON.stringify(v ?? []);
    sets.push(`${k} = ?`);
    args.push(v ?? null);
  }
  if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
  sets.push("updated_at = datetime('now','localtime')");
  args.push(id);
  await execute(db, `UPDATE court_events SET ${sets.join(', ')} WHERE id = ?`, ...args);
  return c.json({ success: true });
});

// ── DELETE /events/:id — admin only ─────────────────────────
ct.delete('/events/:id', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  await execute(getDb(c.env), 'DELETE FROM court_events WHERE id = ?', id);
  return c.json({ success: true });
});

// ── PUT /events/:id/outcome ─────────────────────────────────
ct.put('/events/:id/outcome', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  await execute(
    getDb(c.env),
    `UPDATE court_events
       SET outcome = ?, sentence = ?, fine_amount = ?, status = COALESCE(?, status),
           updated_at = datetime('now','localtime')
     WHERE id = ?`,
    body.outcome ?? null, body.sentence ?? null, body.fine_amount ?? null,
    body.status && EVENT_STATUSES.has(body.status) ? body.status : null, id,
  );
  return c.json({ success: true });
});

// ── PUT /events/:id/verdict ─────────────────────────────────
ct.put('/events/:id/verdict', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  await execute(
    getDb(c.env),
    `UPDATE court_events SET verdict = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    body.verdict ?? null, id,
  );
  return c.json({ success: true });
});

// ── PUT /events/:id/confirm — officer attendance confirmation ─
// officer_confirmations is a JSON map { "<officer_id>": true|false }.
ct.put('/events/:id/confirm', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json({ error: 'Unauthenticated' }, 401);
  const db = getDb(c.env);
  const row = await queryFirst<{ officer_confirmations: string }>(
    db, 'SELECT officer_confirmations FROM court_events WHERE id = ?', id,
  );
  if (!row) return c.json({ error: 'Not found' }, 404);
  const map = parseJsonCol<Record<string, boolean>>(row.officer_confirmations, {});
  map[String(body.officer_id ?? user.id)] = body.confirmed !== false;
  await execute(
    db,
    `UPDATE court_events SET officer_confirmations = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    JSON.stringify(map), id,
  );
  return c.json({ success: true, officer_confirmations: map });
});

// ── POST /events/:id/continuance — reschedule + audit log ───
ct.post('/events/:id/continuance', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  if (!body.new_date) return c.json({ error: 'new_date required' }, 400);
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);

  const ev = await queryFirst<{ event_date: string; continuance_count: number; continuance_log: string }>(
    db, 'SELECT event_date, continuance_count, continuance_log FROM court_events WHERE id = ?', id,
  );
  if (!ev) return c.json({ error: 'Not found' }, 404);

  const log = parseJsonCol<any[]>(ev.continuance_log, []);
  log.push({
    at: new Date().toISOString(),
    from_date: ev.event_date,
    to_date: body.new_date,
    reason: body.reason ?? null,
    by_id: user?.id ?? null,
  });
  await execute(
    db,
    `UPDATE court_events
       SET event_date = ?, event_time = COALESCE(?, event_time),
           continuance_count = continuance_count + 1,
           continuance_log = ?, status = 'continued',
           updated_at = datetime('now','localtime')
     WHERE id = ?`,
    body.new_date, body.new_time ?? null, JSON.stringify(log), id,
  );
  return c.json({ success: true, continuance_count: (ev.continuance_count ?? 0) + 1 });
});

// ── POST /events/:id/clone — duplicate for follow-up hearing ─
ct.post('/events/:id/clone', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);

  const src = await queryFirst<any>(db, 'SELECT * FROM court_events WHERE id = ?', id);
  if (!src) return c.json({ error: 'Not found' }, 404);
  const eventNumber = await generateEventNumber(db);
  const r = await execute(
    db,
    `INSERT INTO court_events (
       event_number, event_type, status, event_date, event_time,
       court_name, courtroom, judge_name, court_case_number,
       citation_id, incident_id, case_id, defendant_person_id, defendant_name, defendant_dob,
       prosecutor, defense_attorney, officers_required, notes, created_by
     ) VALUES (?,?, 'scheduled', ?,?, ?,?,?,?, ?,?,?,?,?,?, ?,?,?,?, ?)`,
    eventNumber, body.event_type ?? src.event_type, body.event_date ?? src.event_date, body.event_time ?? src.event_time,
    src.court_name, src.courtroom, src.judge_name, src.court_case_number,
    src.citation_id, src.incident_id, src.case_id, src.defendant_person_id, src.defendant_name, src.defendant_dob,
    src.prosecutor, src.defense_attorney, src.officers_required, body.notes ?? src.notes, user?.id ?? null,
  );
  return c.json({ success: true, id: r.meta.last_row_id, event_number: eventNumber }, 201);
});

// ── POST /events/:id/documents — append to documents JSON ───
ct.post('/events/:id/documents', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  if (!body.document) return c.json({ error: 'document required' }, 400);
  const db = getDb(c.env);
  const row = await queryFirst<{ documents: string }>(db, 'SELECT documents FROM court_events WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  const docs = parseJsonCol<any[]>(row.documents, []);
  docs.push({ ...body.document, added_at: new Date().toISOString() });
  await execute(
    db,
    `UPDATE court_events SET documents = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    JSON.stringify(docs), id,
  );
  return c.json({ success: true, documents: docs });
});

// ── PUT /events/:id/witnesses — replace witnesses list ──────
ct.put('/events/:id/witnesses', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const witnesses = Array.isArray(body.witnesses) ? body.witnesses : [];
  await execute(
    getDb(c.env),
    `UPDATE court_events SET witnesses = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    JSON.stringify(witnesses), id,
  );
  return c.json({ success: true });
});

// ── PUT /events/:id/judge-notes ─────────────────────────────
ct.put('/events/:id/judge-notes', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  await execute(
    getDb(c.env),
    `UPDATE court_events SET judge_notes = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    body.judge_notes ?? null, id,
  );
  return c.json({ success: true });
});

// ── PUT /events/:id/prosecutor ──────────────────────────────
ct.put('/events/:id/prosecutor', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  await execute(
    getDb(c.env),
    `UPDATE court_events
       SET prosecutor = ?, prosecutor_phone = ?, prosecutor_email = ?,
           updated_at = datetime('now','localtime')
     WHERE id = ?`,
    body.prosecutor ?? null, body.prosecutor_phone ?? null, body.prosecutor_email ?? null, id,
  );
  return c.json({ success: true });
});

// ── PUT /events/:id/fees ────────────────────────────────────
ct.put('/events/:id/fees', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const fees = body.court_fees && typeof body.court_fees === 'object' ? body.court_fees : {};
  await execute(
    getDb(c.env),
    `UPDATE court_events SET court_fees = ?, fine_amount = COALESCE(?, fine_amount),
       updated_at = datetime('now','localtime') WHERE id = ?`,
    JSON.stringify(fees), body.fine_amount ?? null, id,
  );
  return c.json({ success: true });
});

// ── PUT /events/:id/bail ────────────────────────────────────
ct.put('/events/:id/bail', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  await execute(
    getDb(c.env),
    `UPDATE court_events SET bail_amount = ?, bond_status = ?, surety_info = ?,
       updated_at = datetime('now','localtime') WHERE id = ?`,
    body.bail_amount ?? null, body.bond_status ?? null, body.surety_info ?? null, id,
  );
  return c.json({ success: true });
});

export default ct;
