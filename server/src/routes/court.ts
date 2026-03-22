// ============================================================
// RMPG Flex — Court & Legal Tracker API Routes
// ============================================================
// Court date tracking, subpoena management, and case outcome
// recording. Auto-generates event numbers in CT-YYYY-NNNN format.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow, localToday } from '../utils/timeUtils';
import { escapeLike, validateParamId } from '../middleware/sanitize';
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';
import { sendCsv } from '../utils/csvExport';

const router = Router();
router.use(authenticateToken);

// Validate :id params as positive integers
router.param('id', (req: Request, res: Response, next) => {
  const raw = String(req.params.id);
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1 || String(n) !== raw) {
    res.status(400).json({ error: 'Invalid ID parameter' });
    return;
  }
  next();
});

function nextEventNumber(): string {
  const db = getDb();
  const yr = parseInt(localToday().slice(0, 4), 10);
  const prefix = `CT-${yr}-`;
  const last = db.prepare(
    "SELECT event_number FROM court_events WHERE event_number LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 1"
  ).get(`${escapeLike(prefix)}%`) as { event_number: string } | undefined;
  const parsed = last ? parseInt(last.event_number.replace(prefix, ''), 10) : 0;
  const seq = (isNaN(parsed) ? 0 : parsed) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ─── GET /events ─────────────────────────────────────────
router.get('/events', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, event_type, date_from, date_to, officer_id, search, page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND e.status = ?'; params.push(status); }
    if (event_type) { where += ' AND e.event_type = ?'; params.push(event_type); }
    if (date_from) { where += ' AND e.event_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND e.event_date <= ?'; params.push(date_to); }
    if (officer_id) { where += " AND e.officers_required LIKE ? ESCAPE '\\'"; params.push(`%${escapeLike(String(officer_id))}%`); }
    if (search) {
      where += " AND (e.event_number LIKE ? ESCAPE '\\' OR e.defendant_name LIKE ? ESCAPE '\\' OR e.court_case_number LIKE ? ESCAPE '\\' OR e.court_name LIKE ? ESCAPE '\\')";
      const s = `%${escapeLike(String(search))}%`; params.push(s, s, s, s);
    }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM court_events e ${where}`).get(...params) as any)?.count || 0;
    const rows = db.prepare(`
      SELECT e.*, p.first_name || ' ' || p.last_name as defendant_full_name
      FROM court_events e
      LEFT JOIN persons p ON e.defendant_person_id = p.id
      ${where}
      ORDER BY e.event_date ASC, e.event_time ASC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);
    res.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    console.error('Get court events error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /events/upcoming ────────────────────────────────
router.get('/events/upcoming', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = localToday();
    const userId = req.user!.userId;
    const rows = db.prepare(`
      SELECT * FROM court_events
      WHERE event_date >= ? AND status = 'scheduled'
      AND (officers_required LIKE ? ESCAPE '\\' OR created_by = ?)
      ORDER BY event_date ASC, event_time ASC
      LIMIT 30
    `).all(today, `%${escapeLike(String(userId))}%`, userId);
    res.json({ data: rows });
  } catch (error: any) { console.error('Court event error:', error?.message || error); res.status(500).json({ error: 'Internal server error' }); }
});

// ─── GET /calendar ───────────────────────────────────────
router.get('/calendar', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { month, year } = req.query;
    const y = Math.max(2000, Math.min(2100, parseInt(year as string, 10) || new Date().getFullYear()));
    const m = Math.max(1, Math.min(12, parseInt(month as string, 10) || (new Date().getMonth() + 1)));
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    // Calculate actual last day of month (handles Feb, 30-day months, leap years)
    const lastDay = new Date(y, m, 0).getDate();
    const endDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const rows = db.prepare(`
      SELECT id, event_number, event_type, status, event_date, event_time, defendant_name, court_name
      FROM court_events
      WHERE event_date >= ? AND event_date <= ?
      ORDER BY event_date ASC, event_time ASC
    `).all(startDate, endDate);

    // Group by date
    const calendar: Record<string, any[]> = {};
    for (const row of rows as any[]) {
      if (!calendar[row.event_date]) calendar[row.event_date] = [];
      calendar[row.event_date].push(row);
    }

    res.json({ data: calendar });
  } catch (error: any) { console.error('Court event error:', error?.message || error); res.status(500).json({ error: 'Internal server error' }); }
});

// ─── GET /events/:id ─────────────────────────────────────
router.get('/events/:id', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT e.*, p.first_name || ' ' || p.last_name as defendant_full_name
      FROM court_events e LEFT JOIN persons p ON e.defendant_person_id = p.id
      WHERE e.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Court event not found' });
    res.json({ data: row });
  } catch (error: any) { console.error('Court event error:', error?.message || error); res.status(500).json({ error: 'Internal server error' }); }
});

// ─── POST /events ────────────────────────────────────────
router.post('/events', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { event_type, event_date, event_time, court_name, courtroom, judge_name,
      court_case_number, citation_id, incident_id, case_id,
      defendant_person_id, defendant_name, prosecutor, defense_attorney,
      officers_required, notes } = req.body;
    if (!event_type || !event_date) return res.status(400).json({ error: 'Event type and date required' });
    if (court_case_number !== undefined && court_case_number !== null && typeof court_case_number !== 'string') {
      return res.status(400).json({ error: 'court_case_number must be a string' });
    }
    const validEventTypes = ['arraignment', 'pretrial', 'trial', 'sentencing', 'hearing', 'motion', 'deposition', 'other'];
    if (!validEventTypes.includes(event_type)) {
      return res.status(400).json({ error: `event_type must be one of: ${validEventTypes.join(', ')}` });
    }

    // Wrap sequence generation + INSERT in a transaction to prevent duplicate event numbers
    const createEvent = db.transaction(() => {
      const event_number = nextEventNumber();
      const result = db.prepare(`
        INSERT INTO court_events (event_number, event_type, status, event_date, event_time,
          court_name, courtroom, judge_name, court_case_number,
          citation_id, incident_id, case_id, defendant_person_id, defendant_name,
          prosecutor, defense_attorney, officers_required, notes,
          created_by, created_at, updated_at)
        VALUES (?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(event_number, event_type, event_date, event_time || null,
        court_name || null, courtroom || null, judge_name || null, court_case_number || null,
        citation_id || null, incident_id || null, case_id || null,
        defendant_person_id || null, defendant_name || null,
        prosecutor || null, defense_attorney || null,
        JSON.stringify(officers_required || []), notes || null,
        req.user!.userId, now, now);
      return { result, event_number };
    });
    const { result, event_number } = createEvent();

    auditLog(req, 'CREATE', 'court_event', Number(result.lastInsertRowid), 'Created court event');
    broadcast('records', 'courtEvent:created', { id: Number(result.lastInsertRowid), event_number, event_type, event_date });
    res.status(201).json({ data: { id: Number(result.lastInsertRowid), event_number } });
  } catch (error: any) {
    console.error('Create court event error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /events/:id ─────────────────────────────────────
router.put('/events/:id', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM court_events WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Court event not found' });

    const now = localNow();
    const fields = ['event_type', 'status', 'event_date', 'event_time', 'court_name', 'courtroom',
      'judge_name', 'court_case_number', 'citation_id', 'incident_id', 'case_id',
      'defendant_person_id', 'defendant_name', 'prosecutor', 'defense_attorney', 'notes'];
    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (req.body.officers_required !== undefined) {
      updates.push('officers_required = ?');
      params.push(JSON.stringify(req.body.officers_required));
    }
    params.push(req.params.id);
    db.prepare(`UPDATE court_events SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    auditLog(req, 'UPDATE', 'court_event', String(req.params.id), `Updated court event #${req.params.id}`);
    broadcast('records', 'courtEvent:updated', { id: parseInt(req.params.id as string, 10) });
    res.json({ data: { id: parseInt(req.params.id as string, 10) } });
  } catch (error: any) { console.error('Court event error:', error?.message || error); res.status(500).json({ error: 'Internal server error' }); }
});

// ─── PUT /events/:id/outcome ─────────────────────────────
router.put('/events/:id/outcome', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { outcome, sentence, fine_amount, notes } = req.body;
    if (!outcome || typeof outcome !== 'string') return res.status(400).json({ error: 'Outcome is required and must be a string' });
    if (fine_amount !== undefined && fine_amount !== null) {
      const fa = parseFloat(String(fine_amount));
      if (isNaN(fa) || fa < 0) return res.status(400).json({ error: 'fine_amount must be a non-negative number' });
    }

    db.prepare(`
      UPDATE court_events SET outcome = ?, sentence = ?, fine_amount = ?, notes = ?,
        status = 'completed', updated_at = ? WHERE id = ?
    `).run(outcome, sentence || null, fine_amount ?? null, notes || null, now, req.params.id);

    auditLog(req, 'UPDATE', 'court_event', String(req.params.id), `Recorded court event outcome #${req.params.id}`);
    broadcast('records', 'courtEvent:updated', { id: parseInt(req.params.id as string, 10), outcome, status: 'completed' });
    res.json({ data: { id: parseInt(req.params.id as string, 10), outcome } });
  } catch (error: any) { console.error('Court event error:', error?.message || error); res.status(500).json({ error: 'Internal server error' }); }
});

// ─── GET /events/export/csv ─────────────────────────────
router.get('/events/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT e.court_case_number, e.event_type, e.event_date, e.event_time,
             e.court_name, e.judge_name, e.defendant_name, e.status, e.outcome
      FROM court_events e
      ORDER BY e.event_date DESC, e.event_time DESC
    `).all() as any[];

    sendCsv(res, 'court-events-export.csv', [
      { key: 'court_case_number', header: 'Case Number' },
      { key: 'event_type', header: 'Event Type' },
      { key: 'event_date', header: 'Court Date' },
      { key: 'event_time', header: 'Court Time' },
      { key: 'court_name', header: 'Court Name' },
      { key: 'judge_name', header: 'Judge' },
      { key: 'defendant_name', header: 'Officer Name' },
      { key: 'status', header: 'Status' },
      { key: 'outcome', header: 'Outcome' },
    ], rows);
  } catch (error: any) {
    console.error('Court events CSV export error:', error?.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

export default router;
