// ============================================================
// RMPG Flex — Unified Scheduler (/api/scheduler)
// ============================================================
// One agenda across every scheduled thing in the system:
//   serve   → serve_attempt_schedules (+serve_queue)   [Serve Intake / Process Server]
//   shift   → shift_plans (assignments JSON)           [shift roster]
//   court   → court_events                             [court calendar]
//   custom  → scheduler_events (mig 0165)              [Dispatch follow-ups + ad-hoc]
//
// scheduler_events is the write surface: Dispatch links via call_id,
// Serve via serve_queue_id. Reminders fire from the every-minute cron
// (src/utils/schedulerReminders.ts) through the alert hub.
// ============================================================
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const sch = new Hono<Env>();

// Agenda data aggregates internal operational detail (officer assignments,
// serve recipients, court events) — client_viewer must not see it even
// though the mount is plain auth:'required'. Nav hiding alone isn't a gate.
sch.use('*', async (c, next) => {
  const u = c.get('user') as { role?: string } | undefined;
  if (u?.role === 'client_viewer') return c.json({ error: 'Insufficient role' }, 403);
  await next();
});

const WRITE = new Set(['admin', 'manager', 'supervisor', 'officer', 'dispatcher']);
const CATEGORIES = new Set(['general', 'follow_up', 'court', 'meeting', 'patrol', 'maintenance']);
const STATUSES = new Set(['scheduled', 'completed', 'cancelled']);

export interface AgendaItem {
  key: string;                 // "<source>:<id>" — unique across sources
  source: 'serve' | 'shift' | 'court' | 'custom';
  id: number | string;
  date: string;                // YYYY-MM-DD
  start: string | null;        // HH:MM
  end: string | null;          // HH:MM
  title: string;
  subtitle: string | null;
  officer_id: number | null;
  status: string | null;
  link: string | null;         // client route to open the native surface
}

function denverToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());
}

function isoDate(s: unknown): string | null {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function collectAgenda(db: D1Database, start: string, end: string, officerId?: number): Promise<AgendaItem[]> {
  const items: AgendaItem[] = [];

  // ── serve attempt windows ──
  const serveArgs: unknown[] = [start, end];
  let serveSql = `
    SELECT s.id, s.queue_id, s.attempt_number, s.scheduled_date, s.window_start, s.window_end,
           s.window_label, s.officer_id, s.dismissed,
           q.recipient_name, q.recipient_address, q.priority, q.status AS queue_status
    FROM serve_attempt_schedules s
    LEFT JOIN serve_queue q ON q.id = s.queue_id
    WHERE s.scheduled_date BETWEEN ? AND ? AND s.dismissed = 0`;
  if (officerId) { serveSql += ' AND s.officer_id = ?'; serveArgs.push(officerId); }
  serveSql += ' ORDER BY s.scheduled_date, s.window_start LIMIT 500';
  for (const r of await query<Record<string, any>>(db, serveSql, ...serveArgs)) {
    items.push({
      key: `serve:${r.id}`, source: 'serve', id: r.id,
      date: r.scheduled_date, start: r.window_start ?? null, end: r.window_end ?? null,
      title: `Serve attempt #${r.attempt_number ?? '?'} — ${r.recipient_name || 'recipient'}`,
      subtitle: [r.recipient_address, r.window_label].filter(Boolean).join(' · ') || null,
      officer_id: r.officer_id ?? null,
      status: r.queue_status ?? null,
      link: `/serve-intake/scheduler?schedule_id=${r.id}`,
    });
  }

  // ── shift plans (assignments JSON: [{officer_id, officer_name, area?...}]) ──
  const shiftRows = await query<Record<string, any>>(db, `
    SELECT id, name, date, shift_type, assignments, status FROM shift_plans
    WHERE date BETWEEN ? AND ? AND status IN ('draft','active') ORDER BY date LIMIT 200`, start, end);
  const SHIFT_WINDOWS: Record<string, [string, string]> = {
    day: ['06:00', '14:00'], swing: ['14:00', '22:00'], night: ['22:00', '06:00'], graveyard: ['22:00', '06:00'],
  };
  for (const r of shiftRows) {
    let assignments: any[] = [];
    try { assignments = JSON.parse(r.assignments || '[]'); } catch { /* tolerate bad JSON */ }
    if (officerId && !assignments.some((a) => Number(a?.officer_id) === officerId)) continue;
    const w = SHIFT_WINDOWS[r.shift_type] ?? [null, null];
    items.push({
      key: `shift:${r.id}`, source: 'shift', id: r.id,
      date: r.date, start: w[0], end: w[1],
      title: r.name || `${String(r.shift_type || 'custom').toUpperCase()} shift`,
      subtitle: assignments.length
        ? `${assignments.length} assigned: ${assignments.slice(0, 4).map((a) => a?.officer_name).filter(Boolean).join(', ')}${assignments.length > 4 ? '…' : ''}`
        : 'No assignments',
      officer_id: null, status: r.status,
      link: `/shift-plans?date=${r.date}&plan_id=${encodeURIComponent(r.id)}`,
    });
  }

  // ── court events (agency-wide: not officer-scoped, so an officer filter
  // excludes the source entirely rather than pretending to filter it) ──
  const courtRows = officerId ? [] : await query<Record<string, any>>(db, `
    SELECT id, event_number, event_type, event_date, event_time, court_name, courtroom,
           defendant_name, status FROM court_events
    WHERE substr(event_date,1,10) BETWEEN ? AND ? AND status NOT IN ('cancelled')
    ORDER BY event_date LIMIT 200`, start, end);
  for (const r of courtRows) {
    items.push({
      key: `court:${r.id}`, source: 'court', id: r.id,
      date: String(r.event_date).slice(0, 10), start: r.event_time ?? null, end: null,
      title: `${r.event_type || 'Court'} — ${r.defendant_name || r.event_number || ''}`.trim(),
      subtitle: [r.court_name, r.courtroom].filter(Boolean).join(' · ') || null,
      officer_id: null, status: r.status ?? null,
      link: `/court-events`,
    });
  }

  // ── custom scheduler events ──
  const evArgs: unknown[] = [start, end];
  let evSql = `SELECT * FROM scheduler_events WHERE event_date BETWEEN ? AND ? AND status != 'cancelled'`;
  if (officerId) { evSql += ' AND (officer_id = ? OR officer_id IS NULL)'; evArgs.push(officerId); }
  evSql += ' ORDER BY event_date, start_time LIMIT 500';
  for (const r of await query<Record<string, any>>(db, evSql, ...evArgs)) {
    items.push({
      key: `custom:${r.id}`, source: 'custom', id: r.id,
      date: r.event_date, start: r.start_time ?? null, end: r.end_time ?? null,
      title: r.title,
      subtitle: [r.location, r.category !== 'general' ? r.category : null, r.call_id ? `call #${r.call_id}` : null]
        .filter(Boolean).join(' · ') || null,
      officer_id: r.officer_id ?? null, status: r.status,
      link: `/scheduler?event_id=${r.id}`,
    });
  }

  items.sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')));
  return items;
}

// GET /agenda?start=YYYY-MM-DD&end=YYYY-MM-DD&officer_id=&sources=serve,shift
sch.get('/agenda', async (c) => {
  const db = getDb(c.env);
  const start = isoDate(c.req.query('start')) ?? denverToday();
  const end = isoDate(c.req.query('end')) ?? start;
  if (end < start) return c.json({ error: 'end before start' }, 400);
  const officerId = c.req.query('officer_id') ? parseInt(c.req.query('officer_id')!, 10) : undefined;
  let items = await collectAgenda(db, start, end, Number.isFinite(officerId as number) ? officerId : undefined);
  const sources = c.req.query('sources');
  if (sources) {
    const allow = new Set(sources.split(',').map((s) => s.trim()));
    items = items.filter((i) => allow.has(i.source));
  }
  return c.json({ start, end, count: items.length, items });
});

// GET /upcoming?days=7&officer_id= — Dashboard card feed
sch.get('/upcoming', async (c) => {
  const db = getDb(c.env);
  const days = Math.min(Math.max(parseInt(c.req.query('days') || '7', 10) || 7, 1), 31);
  const start = denverToday();
  const endDate = new Date(`${start}T12:00:00`);
  endDate.setDate(endDate.getDate() + days - 1);
  const end = endDate.toISOString().slice(0, 10);
  const officerId = c.req.query('officer_id') ? parseInt(c.req.query('officer_id')!, 10) : undefined;
  const items = await collectAgenda(db, start, end, Number.isFinite(officerId as number) ? officerId : undefined);
  return c.json({ start, end, count: items.length, items: items.slice(0, 40) });
});

// POST /events — create a custom scheduled event (Dispatch follow-up, meeting, …)
sch.post('/events', async (c) => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user || !WRITE.has(user.role)) return c.json({ error: 'Insufficient role' }, 403);
  const b = await c.req.json<any>().catch(() => ({}));
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  const eventDate = isoDate(b.event_date);
  if (!title || !eventDate) return c.json({ error: 'title and event_date (YYYY-MM-DD) required' }, 400);
  const category = CATEGORIES.has(b.category) ? b.category : 'general';
  const hhmm = (v: unknown) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);
  const startTime = hhmm(b.start_time);

  // remind_minutes before start (needs a start time), else notify_at passthrough.
  let notifyAt: string | null = null;
  if (typeof b.notify_at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.notify_at)) {
    notifyAt = b.notify_at;
  } else if (Number.isFinite(b.remind_minutes) && startTime) {
    const d = new Date(`${eventDate}T${startTime}:00`);
    d.setMinutes(d.getMinutes() - Number(b.remind_minutes));
    notifyAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  const r = await execute(getDb(c.env), `
    INSERT INTO scheduler_events (
      title, description, event_date, start_time, end_time, officer_id, created_by,
      call_id, serve_queue_id, case_id, location, category, notify_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    title, b.description ?? null, eventDate, startTime, hhmm(b.end_time),
    b.officer_id ?? null, user.id,
    b.call_id ?? null, b.serve_queue_id ?? null, b.case_id ?? null,
    b.location ?? null, category, notifyAt);
  const created = await queryFirst(getDb(c.env), 'SELECT * FROM scheduler_events WHERE id = ?', r.meta.last_row_id);
  return c.json(created, 201);
});

// GET /events/:id
sch.get('/events/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const row = await queryFirst(getDb(c.env), 'SELECT * FROM scheduler_events WHERE id = ?', id);
  return row ? c.json(row) : c.json({ error: 'Not found' }, 404);
});

// PATCH /events/:id — partial update; resets `notified` if notify_at moves
sch.patch('/events/:id', async (c) => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user || !WRITE.has(user.role)) return c.json({ error: 'Insufficient role' }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const b = await c.req.json<any>().catch(() => ({}));
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, val: unknown) => { sets.push(`${col} = ?`); args.push(val); };
  if (typeof b.title === 'string' && b.title.trim()) set('title', b.title.trim());
  if ('description' in b) set('description', b.description ?? null);
  if (isoDate(b.event_date)) set('event_date', b.event_date);
  if ('start_time' in b) set('start_time', typeof b.start_time === 'string' && /^\d{2}:\d{2}$/.test(b.start_time) ? b.start_time : null);
  if ('end_time' in b) set('end_time', typeof b.end_time === 'string' && /^\d{2}:\d{2}$/.test(b.end_time) ? b.end_time : null);
  if ('officer_id' in b) set('officer_id', b.officer_id ?? null);
  if ('location' in b) set('location', b.location ?? null);
  if (CATEGORIES.has(b.category)) set('category', b.category);
  if (STATUSES.has(b.status)) set('status', b.status);
  if ('notify_at' in b) { set('notify_at', b.notify_at ?? null); set('notified', 0); }
  if (!sets.length) return c.json({ error: 'No valid fields' }, 400);
  sets.push("updated_at = datetime('now')");
  await execute(getDb(c.env), `UPDATE scheduler_events SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
  const row = await queryFirst(getDb(c.env), 'SELECT * FROM scheduler_events WHERE id = ?', id);
  return row ? c.json(row) : c.json({ error: 'Not found' }, 404);
});

// DELETE /events/:id — soft-cancel
sch.delete('/events/:id', async (c) => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user || !WRITE.has(user.role)) return c.json({ error: 'Insufficient role' }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  await execute(getDb(c.env), "UPDATE scheduler_events SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?", id);
  return c.json({ success: true });
});

export default sch;
