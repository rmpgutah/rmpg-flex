// ============================================================
// RMPG Flex — Crash / Collision Reports
// ============================================================
// Backs client/src/pages/CrashReportsPage.tsx. Was a fully-built
// client page with zero matching route. Migration
// 0167_impounds_pawn_tips_crash_animal.sql.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const crashReports = new Hono<Env>();

const WRITE = ['admin', 'manager', 'supervisor', 'officer'];

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

async function generateReportNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `CR-${yy}-`;
  const last = await queryFirst<{ report_number: string }>(
    db, 'SELECT report_number FROM crash_reports WHERE report_number LIKE ? ORDER BY id DESC LIMIT 1', `${prefix}%`);
  let next = 1;
  if (last?.report_number) {
    const m = last.report_number.match(/^CR-\d{2}-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(next).padStart(4, '0')}`;
}

// GET / — list + stats, filterable by search/crash_type/severity/from/to
crashReports.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const { search, crash_type, severity, from, to } = c.req.query();
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (search) { conditions.push('(report_number LIKE ? OR location LIKE ? OR narrative LIKE ?)'); const s = `%${search}%`; params.push(s, s, s); }
    if (crash_type) { conditions.push('crash_type = ?'); params.push(crash_type); }
    if (severity) { conditions.push('severity = ?'); params.push(severity); }
    if (from) { conditions.push('crash_date >= ?'); params.push(from); }
    if (to) { conditions.push('crash_date <= ?'); params.push(to); }
    const where = conditions.join(' AND ');
    const rows = await query<Record<string, unknown>>(
      db, `SELECT * FROM crash_reports WHERE ${where} ORDER BY crash_date DESC LIMIT 500`, ...params);
    const stats = await queryFirst<{ total: number; draft: number; pending_review: number; filed: number }>(db, `
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
        SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) as pending_review,
        SUM(CASE WHEN status = 'filed' THEN 1 ELSE 0 END) as filed
      FROM crash_reports
    `);
    return c.json({
      data: rows,
      stats: { total: stats?.total ?? 0, draft: stats?.draft ?? 0, pending_review: stats?.pending_review ?? 0, filed: stats?.filed ?? 0 },
    });
  } catch (err) {
    return c.json({ error: 'Failed to list crash reports' }, 500);
  }
});

// POST / — create
crashReports.post('/', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, any>>();
    if (typeof b.crash_date !== 'string' || !b.crash_date) return c.json({ error: 'crash_date required' }, 400);
    if (typeof b.location !== 'string' || !b.location.trim()) return c.json({ error: 'location required' }, 400);
    const reportNumber = await generateReportNumber(db);
    const u = c.get('user') as { id: number } | undefined;
    const result = await execute(db,
      `INSERT INTO crash_reports (
        report_number, crash_date, location, crash_type, severity,
        vehicles_involved, injuries, fatalities, status, narrative,
        weather_conditions, road_conditions, parties_description, investigating_officer, created_by
      ) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?)`,
      reportNumber, b.crash_date, b.location, b.crash_type ?? 'vehicle_vehicle', b.severity ?? 'property_damage_only',
      b.vehicles_involved ?? 0, b.injuries ?? 0, b.fatalities ?? 0, b.status ?? 'draft', b.narrative ?? null,
      b.weather_conditions ?? null, b.road_conditions ?? null, b.parties_description ?? null, b.investigating_officer ?? null, u?.id ?? null,
    );
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM crash_reports WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create crash report' }, 500);
  }
});

// PUT /:id — update
crashReports.put('/:id', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, any>>();
    const updatable = new Set([
      'crash_date', 'location', 'crash_type', 'severity', 'vehicles_involved', 'injuries', 'fatalities',
      'status', 'narrative', 'weather_conditions', 'road_conditions', 'parties_description', 'investigating_officer',
    ]);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (!sets.length) return c.json({ error: 'No fields' }, 400);
    sets.push(`updated_at = datetime('now','localtime')`); vals.push(id);
    await execute(db, `UPDATE crash_reports SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM crash_reports WHERE id = ?', id);
    if (!updated) return c.json({ error: 'Not found' }, 404);
    return c.json(updated);
  } catch (err) {
    return c.json({ error: 'Failed to update crash report' }, 500);
  }
});

export default crashReports;
