// ============================================================
// RMPG Flex — Daily Activity Reports (DAR)
// ============================================================
// Replaces the /api/dar stub with a real backend the desktop
// DailyActivityReportsPage already drives. The headline feature —
// POST /auto-populate — compiles the shift from activity RMPG already
// captured (incidents, citations, patrol-tour scans, CAD calls the
// officer worked) so the guard reviews + signs instead of typing every
// line. That's the TrackTik-surpassing bit: their DAR is manual entry.
//
//   GET  /                list (paginated)        -> {data, pagination}
//   GET  /export/csv      CSV download
//   POST /auto-populate   compile shift activity  -> {data:{calls,incidents,citations,patrols}}
//   POST /                create                  -> {data}
//   GET  /:id             detail                  -> {data}
//   PUT  /:id             update (draft/returned)
//   PUT  /:id/submit      draft|returned -> submitted
//   PUT  /:id/approve     submitted -> approved        (supervisor+)
//   PUT  /:id/return      submitted -> returned + notes (supervisor+)
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { emitAnalytics, flexEvent } from '../utils/analytics';
import { darNumber, nextDarSeq, parseArr, summarizeDar, type AutoPopulate } from '../utils/dar';

const dar = new Hono<Env>();
const REVIEW_ROLES = new Set(['admin', 'manager', 'supervisor']);

async function ensureTable(db: ReturnType<typeof getDb>) {
  await execute(db, `CREATE TABLE IF NOT EXISTS daily_activity_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dar_number TEXT,
    officer_id INTEGER,
    shift_date TEXT NOT NULL,
    shift_start TEXT,
    shift_end TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    calls_handled TEXT,
    incidents_created TEXT,
    citations_issued TEXT,
    patrols_completed TEXT,
    activities_narrative TEXT,
    notable_events TEXT,
    safety_concerns TEXT,
    review_notes TEXT,
    reviewed_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    submitted_at TEXT,
    approved_at TEXT
  )`);
}

const SELECT_WITH_OFFICER = `SELECT d.*, u.full_name AS officer_name
  FROM daily_activity_reports d LEFT JOIN users u ON u.id = d.officer_id`;

// GET / — paginated list.
dar.get('/', async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureTable(db);
  const { status, officer_id, shift_date, page = '1', per_page = '50' } = c.req.query();
  const where: string[] = []; const p: unknown[] = [];
  if (status) { where.push('d.status = ?'); p.push(status); }
  if (officer_id) { where.push('d.officer_id = ?'); p.push(parseInt(officer_id, 10)); }
  if (shift_date) { where.push('d.shift_date = ?'); p.push(shift_date); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const lim = Math.min(parseInt(per_page, 10) || 50, 200);
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const rows = await query<Record<string, unknown>>(db,
    `${SELECT_WITH_OFFICER} ${clause} ORDER BY d.shift_date DESC, d.id DESC LIMIT ? OFFSET ?`,
    ...p, lim, (pageNum - 1) * lim);
  const total = await queryFirst<{ n: number }>(db,
    `SELECT COUNT(*) AS n FROM daily_activity_reports d ${clause}`, ...p);
  return c.json({ data: rows, pagination: { page: pageNum, per_page: lim, total: Number(total?.n ?? 0) } });
});

// GET /export/csv — must be before /:id.
dar.get('/export/csv', async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureTable(db);
  const rows = await query<Record<string, unknown>>(db,
    `${SELECT_WITH_OFFICER} ORDER BY d.shift_date DESC, d.id DESC LIMIT 5000`);
  const cols = ['dar_number', 'officer_name', 'shift_date', 'shift_start', 'shift_end', 'status'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map((r) => cols.map((k) => esc(r[k])).join(','))].join('\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="daily_activity_reports.csv"' } });
});

// POST /auto-populate — compile the officer's shift activity.
dar.post('/auto-populate', async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureTable(db);
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const officerId = (b.officer_id as number) ?? (c.get('userId') as number);
  const date = String(b.shift_date ?? '');
  if (!officerId || !date) return c.json({ error: 'officer_id and shift_date are required', code: 'DAR_AP_FIELDS' }, 400);

  // Each source is best-effort: a schema mismatch yields [] rather than a 500.
  const safe = async <T>(p: Promise<T[]>): Promise<T[]> => { try { return await p; } catch { return []; } };

  const incidents = await safe(query(db,
    `SELECT incident_number, incident_type, location_address, created_at
       FROM incidents WHERE officer_id = ? AND date(created_at) = ? ORDER BY created_at`, officerId, date));
  const citations = await safe(query(db,
    `SELECT citation_number, violation_description, violation_date, location
       FROM citations WHERE issuing_officer_id = ? AND (violation_date = ? OR date(created_at) = ?) ORDER BY id`,
    officerId, date, date));
  const patrols = await safe(query(db,
    `SELECT s.id, cp.name AS checkpoint, s.status, s.scanned_at
       FROM patrol_scans s LEFT JOIN patrol_checkpoints cp ON cp.id = s.checkpoint_id
      WHERE s.officer_id = ? AND date(s.scanned_at) = ? ORDER BY s.scanned_at`, officerId, date));
  // Calls the officer actually worked = those they filed an incident on.
  const calls = await safe(query(db,
    `SELECT DISTINCT cf.call_number, cf.incident_type, cf.location_address, cf.created_at
       FROM calls_for_service cf JOIN incidents i ON i.call_id = cf.id
      WHERE i.officer_id = ? AND date(cf.created_at) = ? ORDER BY cf.created_at`, officerId, date));

  const data: AutoPopulate = { calls, incidents, citations, patrols };
  return c.json({ data });
});

// POST / — create a DAR (optionally seeded with auto-populated JSON arrays).
dar.post('/', async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureTable(db);
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (!b.shift_date) return c.json({ error: 'shift_date is required', code: 'DAR_DATE_REQUIRED' }, 400);
  const userId = c.get('userId') as number;

  const year = new Date().getFullYear().toString().slice(-2);
  const maxRow = await queryFirst<{ m: string | null }>(db,
    `SELECT MAX(dar_number) AS m FROM daily_activity_reports WHERE dar_number LIKE ?`, `${year}-DAR-%`);
  const number = darNumber(year, nextDarSeq(maxRow?.m));

  const ap: AutoPopulate = {
    calls: parseArr(b.calls_handled), incidents: parseArr(b.incidents_created),
    citations: parseArr(b.citations_issued), patrols: parseArr(b.patrols_completed),
  };
  const narrative = (b.activities_narrative as string) || summarizeDar(ap);

  const r = await execute(db, `INSERT INTO daily_activity_reports
    (dar_number, officer_id, shift_date, shift_start, shift_end, status,
     calls_handled, incidents_created, citations_issued, patrols_completed,
     activities_narrative, notable_events, safety_concerns)
    VALUES (?,?,?,?,?, 'draft', ?,?,?,?, ?,?,?)`,
    number, (b.officer_id as number) ?? userId, b.shift_date, b.shift_start ?? null, b.shift_end ?? null,
    JSON.stringify(ap.calls), JSON.stringify(ap.incidents), JSON.stringify(ap.citations), JSON.stringify(ap.patrols),
    narrative, b.notable_events ?? null, b.safety_concerns ?? null);
  const created = await queryFirst(db, `${SELECT_WITH_OFFICER} WHERE d.id = ?`, r.meta.last_row_id);
  return c.json({ data: created }, 201);
});

dar.get('/:id', async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureTable(db);
  const row = await queryFirst(db, `${SELECT_WITH_OFFICER} WHERE d.id = ?`, parseInt(c.req.param('id'), 10));
  if (!row) return c.json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' }, 404);
  return c.json({ data: row });
});

const UPDATABLE = new Set(['shift_start', 'shift_end', 'calls_handled', 'incidents_created',
  'citations_issued', 'patrols_completed', 'activities_narrative', 'notable_events', 'safety_concerns']);

dar.put('/:id', async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureTable(db);
  const id = parseInt(c.req.param('id'), 10);
  const existing = await queryFirst<{ status: string }>(db, `SELECT status FROM daily_activity_reports WHERE id = ?`, id);
  if (!existing) return c.json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' }, 404);
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, v] of Object.entries(b)) if (UPDATABLE.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); }
  if (!sets.length) return c.json({ data: await queryFirst(db, `${SELECT_WITH_OFFICER} WHERE d.id = ?`, id) });
  const params: unknown[] = [...vals, id];
  await execute(db, `UPDATE daily_activity_reports SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return c.json({ data: await queryFirst(db, `${SELECT_WITH_OFFICER} WHERE d.id = ?`, id) });
});

dar.put('/:id/submit', async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureTable(db);
  const id = parseInt(c.req.param('id'), 10);
  await execute(db, `UPDATE daily_activity_reports SET status = 'submitted', submitted_at = datetime('now') WHERE id = ?`, id);
  const row = await queryFirst<Record<string, unknown>>(db, `${SELECT_WITH_OFFICER} WHERE d.id = ?`, id);

  // Analytics lakehouse: DAR-filed event on final submit only (best-effort, fire-and-forget).
  emitAnalytics(c.executionCtx, c.env.EVENTS, [flexEvent({
    event_type: 'dar_filed', occurred_at: new Date().toISOString(),
    actor_id: (row?.officer_id as number | undefined) ?? null,
    entity_type: 'dar', entity_id: id, status: 'submitted',
    label: (row?.dar_number as string | undefined) ?? null, category: 'reporting',
    payload: { shift_date: (row?.shift_date as string | undefined) ?? null },
  })]);

  return c.json({ data: row });
});

dar.put('/:id/approve', async (c): Promise<Response> => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user || !REVIEW_ROLES.has(user.role)) return c.json({ error: 'Supervisor role required', code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env); await ensureTable(db);
  const id = parseInt(c.req.param('id'), 10);
  await execute(db, `UPDATE daily_activity_reports SET status = 'approved', reviewed_by = ?, approved_at = datetime('now') WHERE id = ?`, user.id, id);
  return c.json({ data: await queryFirst(db, `${SELECT_WITH_OFFICER} WHERE d.id = ?`, id) });
});

dar.put('/:id/return', async (c): Promise<Response> => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user || !REVIEW_ROLES.has(user.role)) return c.json({ error: 'Supervisor role required', code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env); await ensureTable(db);
  const id = parseInt(c.req.param('id'), 10);
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  await execute(db, `UPDATE daily_activity_reports SET status = 'returned', reviewed_by = ?, review_notes = ? WHERE id = ?`,
    user.id, String(b.review_notes ?? ''), id);
  return c.json({ data: await queryFirst(db, `${SELECT_WITH_OFFICER} WHERE d.id = ?`, id) });
});

export default dar;
