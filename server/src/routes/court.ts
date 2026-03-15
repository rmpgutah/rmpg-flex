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

const router = Router();
router.use(authenticateToken);
// Court records are sensitive judicial data — restrict to LE roles only
router.use(requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'));

function nextEventNumber(): string {
  const db = getDb();
  const yr = new Date().getFullYear();
  const prefix = `CT-${yr}-`;
  const last = db.prepare(
    "SELECT event_number FROM court_events WHERE event_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`${prefix}%`) as { event_number: string } | undefined;
  const seq = last ? parseInt(last.event_number.replace(prefix, ''), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ─── GET /events ─────────────────────────────────────────
router.get('/events', (req: Request, res: Response) => {
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
    if (officer_id) { where += " AND e.officers_required LIKE ?"; params.push(`%${officer_id}%`); }
    if (search) {
      where += ' AND (e.event_number LIKE ? OR e.defendant_name LIKE ? OR e.court_case_number LIKE ? OR e.court_name LIKE ?)';
      const s = `%${search}%`; params.push(s, s, s, s);
    }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM court_events e ${where}`).get(...params) as any).count;
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
    console.error('Get court events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /events/upcoming ────────────────────────────────
router.get('/events/upcoming', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = localToday();
    const userId = req.user!.userId;
    const rows = db.prepare(`
      SELECT * FROM court_events
      WHERE event_date >= ? AND status = 'scheduled'
      AND (officers_required LIKE ? OR created_by = ?)
      ORDER BY event_date ASC, event_time ASC
      LIMIT 30
    `).all(today, `%${userId}%`, userId);
    res.json({ data: rows });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── GET /calendar ───────────────────────────────────────
router.get('/calendar', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { month, year } = req.query;
    const y = parseInt(year as string, 10) || new Date().getFullYear();
    const m = parseInt(month as string, 10) || (new Date().getMonth() + 1);
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = `${y}-${String(m).padStart(2, '0')}-31`;

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
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── GET /events/:id ─────────────────────────────────────
router.get('/events/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT e.*, p.first_name || ' ' || p.last_name as defendant_full_name
      FROM court_events e LEFT JOIN persons p ON e.defendant_person_id = p.id
      WHERE e.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Court event not found' });
    res.json({ data: row });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── POST /events ────────────────────────────────────────
router.post('/events', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { event_type, event_date, event_time, court_name, courtroom, judge_name,
      court_case_number, citation_id, incident_id, case_id,
      defendant_person_id, defendant_name, prosecutor, defense_attorney,
      officers_required, notes } = req.body;
    if (!event_type || !event_date) return res.status(400).json({ error: 'Event type and date required' });

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

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'create', 'court_event', ?, ?, ?, ?)`).run(req.user!.userId, result.lastInsertRowid, JSON.stringify({ event_number }), req.ip || 'unknown', now);

    res.status(201).json({ data: { id: result.lastInsertRowid, event_number } });
  } catch (error: any) {
    console.error('Create court event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /events/:id ─────────────────────────────────────
router.put('/events/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
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
    res.json({ data: { id: parseInt(req.params.id as string) } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── PUT /events/:id/outcome ─────────────────────────────
router.put('/events/:id/outcome', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { outcome, sentence, fine_amount, notes } = req.body;
    if (!outcome) return res.status(400).json({ error: 'Outcome is required' });

    db.prepare(`
      UPDATE court_events SET outcome = ?, sentence = ?, fine_amount = ?, notes = ?,
        status = 'completed', updated_at = ? WHERE id = ?
    `).run(outcome, sentence || null, fine_amount || null, notes || null, now, req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'outcome', 'court_event', ?, ?, ?, ?)`).run(req.user!.userId, req.params.id, JSON.stringify({ outcome }), req.ip || 'unknown', now);

    res.json({ data: { id: parseInt(req.params.id as string), outcome } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
