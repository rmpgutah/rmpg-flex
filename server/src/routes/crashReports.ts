import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { paramStr } from '../utils/reqHelpers';

const router = Router();
router.use(authenticateToken);

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateReportNumber(db: ReturnType<typeof getDb>): string {
  const year = new Date().getFullYear();
  const prefix = `CR-${year}-`;
  const row = db.prepare(
    `SELECT report_number FROM crash_reports WHERE report_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${prefix}%`) as { report_number: string } | undefined;

  let seq = 1;
  if (row) {
    const parts = row.report_number.split('-');
    const parsed = parseInt(parts[parts.length - 1], 10);
    seq = isNaN(parsed) ? 1 : parsed + 1;
  }
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

// GET / — List crash reports with filters
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, date_from, date_to, search } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (status) { where += ' AND cr.status = ?'; params.push(status); }
    if (date_from) { where += ' AND cr.crash_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND cr.crash_date <= ?'; params.push(date_to); }
    if (search) {
      where += ' AND (cr.report_number LIKE ? OR cr.location LIKE ? OR cr.description LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const rows = db.prepare(`
      SELECT cr.*, u.full_name as officer_name
      FROM crash_reports cr
      LEFT JOIN users u ON cr.officer_id = u.id
      ${where}
      ORDER BY cr.crash_date DESC, cr.created_at DESC
    `).all(...params);

    res.json(rows);
  } catch (err: any) {
    console.error('[CrashReports] List error:', err?.message);
    res.status(500).json({ error: 'Failed to list crash reports', code: 'CRASH_REPORTS_ERROR' });
  }
});

// GET /stats — Crash statistics
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) as count FROM crash_reports').get() as any;
    const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM crash_reports GROUP BY status').all();
    const byMonth = db.prepare(`
      SELECT strftime('%Y-%m', crash_date) as month, COUNT(*) as count
      FROM crash_reports
      WHERE crash_date >= date('now', '-12 months')
      GROUP BY month ORDER BY month
    `).all();
    const withInjuries = db.prepare('SELECT COUNT(*) as count FROM crash_reports WHERE injuries > 0').get() as any;
    const withFatalities = db.prepare('SELECT COUNT(*) as count FROM crash_reports WHERE fatalities > 0').get() as any;

    res.json({
      total: total.count,
      by_status: byStatus,
      by_month: byMonth,
      with_injuries: withInjuries.count,
      with_fatalities: withFatalities.count,
    });
  } catch (err: any) {
    console.error('[CrashReports] Stats error:', err?.message);
    res.status(500).json({ error: 'Failed to get stats', code: 'CRASH_REPORTS_ERROR' });
  }
});

// GET /:id — Single crash report
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const row = db.prepare(`
      SELECT cr.*, u.full_name as officer_name
      FROM crash_reports cr
      LEFT JOIN users u ON cr.officer_id = u.id
      WHERE cr.id = ?
    `).get(id);

    if (!row) {
      res.status(404).json({ error: 'Crash report not found' });
      return;
    }
    res.json(row);
  } catch (err: any) {
    console.error('[CrashReports] Get error:', err?.message);
    res.status(500).json({ error: 'Failed to get crash report', code: 'CRASH_REPORTS_ERROR' });
  }
});

// POST / — Create crash report
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      crash_date, crash_time, location, latitude, longitude,
      description, weather_conditions, road_conditions,
      injuries, fatalities, vehicles_involved,
      officer_id, hit_and_run, dui_involved,
    } = req.body;

    if (!crash_date || !location) {
      res.status(400).json({ error: 'crash_date and location are required' });
      return;
    }

    const report_number = generateReportNumber(db);
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO crash_reports (report_number, crash_date, crash_time, location, latitude, longitude, description, weather_conditions, road_conditions, injuries, fatalities, vehicles_involved, officer_id, hit_and_run, dui_involved, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `).run(
      report_number, crash_date, crash_time || null, location,
      latitude || null, longitude || null, description || null,
      weather_conditions || null, road_conditions || null,
      injuries || 0, fatalities || 0, vehicles_involved || 0,
      officer_id || null, hit_and_run ? 1 : 0, dui_involved ? 1 : 0,
      now, now
    );

    res.status(201).json({ success: true, id: result.lastInsertRowid, report_number });
  } catch (err: any) {
    console.error('[CrashReports] Create error:', err?.message);
    res.status(500).json({ error: 'Failed to create crash report', code: 'CRASH_REPORTS_ERROR' });
  }
});

// PUT /:id — Update crash report
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const {
      crash_date, crash_time, location, latitude, longitude,
      description, weather_conditions, road_conditions,
      injuries, fatalities, vehicles_involved,
      officer_id, hit_and_run, dui_involved, status,
    } = req.body;

    const existing = db.prepare('SELECT id FROM crash_reports WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Crash report not found' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE crash_reports SET
        crash_date = COALESCE(?, crash_date), crash_time = COALESCE(?, crash_time),
        location = COALESCE(?, location), latitude = COALESCE(?, latitude),
        longitude = COALESCE(?, longitude), description = COALESCE(?, description),
        weather_conditions = COALESCE(?, weather_conditions), road_conditions = COALESCE(?, road_conditions),
        injuries = COALESCE(?, injuries), fatalities = COALESCE(?, fatalities),
        vehicles_involved = COALESCE(?, vehicles_involved), officer_id = COALESCE(?, officer_id),
        hit_and_run = COALESCE(?, hit_and_run), dui_involved = COALESCE(?, dui_involved),
        status = COALESCE(?, status), updated_at = ?
      WHERE id = ?
    `).run(
      crash_date || null, crash_time || null, location || null,
      latitude || null, longitude || null, description || null,
      weather_conditions || null, road_conditions || null,
      injuries ?? null, fatalities ?? null, vehicles_involved ?? null,
      officer_id || null, hit_and_run != null ? (hit_and_run ? 1 : 0) : null,
      dui_involved != null ? (dui_involved ? 1 : 0) : null,
      status || null, now, id
    );

    const updated = db.prepare('SELECT * FROM crash_reports WHERE id = ?').get(id);
    res.json(updated);
  } catch (err: any) {
    console.error('[CrashReports] Update error:', err?.message);
    res.status(500).json({ error: 'Failed to update crash report', code: 'CRASH_REPORTS_ERROR' });
  }
});

// DELETE /:id — Delete crash report (admin only)
router.delete('/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);

    const existing = db.prepare('SELECT id FROM crash_reports WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Crash report not found' });
      return;
    }

    db.prepare('DELETE FROM crash_reports WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[CrashReports] Delete error:', err?.message);
    res.status(500).json({ error: 'Failed to delete crash report', code: 'CRASH_REPORTS_ERROR' });
  }
});

export default router;
