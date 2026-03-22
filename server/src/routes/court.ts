// ============================================================
// RMPG Flex — Court & Legal Tracker API Routes
// ============================================================
// Court date tracking, subpoena management, and case outcome
// recording. Auto-generates event numbers in CT-YYYY-NNNN format.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { localNow, localToday } from '../utils/timeUtils';
import { createNotification } from './notifications';

const router = Router();
router.use(authenticateToken);

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

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'create', 'court_event', ?, ?, ?)`).run(req.user!.userId, result.lastInsertRowid, JSON.stringify({ event_number }), now);

    // Notify assigned officers
    const officerIds = officers_required || [];
    const parsedOfficers = typeof officerIds === 'string' ? JSON.parse(officerIds) : officerIds;
    if (Array.isArray(parsedOfficers)) {
      for (const officerId of parsedOfficers) {
        const id = typeof officerId === 'number' ? officerId : parseInt(officerId, 10);
        if (isNaN(id) || id === req.user!.userId) continue;
        createNotification(
          id,
          'court_assignment',
          `Court ${event_type || 'Event'}: ${event_number}`,
          `You have been assigned to a court event on ${event_date}${court_name ? ` at ${court_name}` : ''}. ${defendant_name ? `Defendant: ${defendant_name}` : ''}`,
          'court_event',
          result.lastInsertRowid as number,
          event_type === 'subpoena' ? 'high' : 'normal'
        );
      }
    }

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

    // Notify newly assigned officers
    if (req.body.officers_required !== undefined) {
      const eventRow = db.prepare('SELECT * FROM court_events WHERE id = ?').get(req.params.id) as any;
      const officerIds = req.body.officers_required || [];
      if (Array.isArray(officerIds)) {
        for (const officerId of officerIds) {
          const id = typeof officerId === 'number' ? officerId : parseInt(officerId, 10);
          if (isNaN(id) || id === req.user!.userId) continue;
          createNotification(
            id,
            'court_assignment',
            `Court Event Updated: ${eventRow?.event_number || ''}`,
            `A court event on ${eventRow?.event_date || ''}${eventRow?.court_name ? ` at ${eventRow.court_name}` : ''} has been updated.`,
            'court_event',
            parseInt(req.params.id),
            'normal'
          );
        }
      }
    }

    res.json({ data: { id: parseInt(req.params.id) } });
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

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'outcome', 'court_event', ?, ?, ?)`).run(req.user!.userId, req.params.id, JSON.stringify({ outcome }), now);

    res.json({ data: { id: parseInt(req.params.id), outcome } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── POST /events/from-citation ─────────────────────────
// Create a court event from an existing citation
router.post('/events/from-citation', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { citation_id } = req.body;
    if (!citation_id) return res.status(400).json({ error: 'citation_id is required' });

    const citation = db.prepare('SELECT * FROM citations WHERE id = ?').get(citation_id) as any;
    if (!citation) return res.status(404).json({ error: 'Citation not found' });

    const now = localNow();
    const event_number = nextEventNumber();

    const result = db.prepare(`
      INSERT INTO court_events (event_number, event_type, status, event_date, event_time,
        court_name, court_case_number, citation_id,
        defendant_name, notes,
        created_by, created_at, updated_at)
      VALUES (?, 'arraignment', 'scheduled', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event_number,
      citation.court_date || localToday(),
      citation.court_name || null,
      citation.citation_number || null,
      citation_id,
      citation.person_name || null,
      `Auto-created from citation ${citation.citation_number}`,
      req.user!.userId, now, now
    );

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'create', 'court_event', ?, ?, ?)`).run(
      req.user!.userId, result.lastInsertRowid,
      JSON.stringify({ event_number, source: 'citation', citation_id }),
      now
    );

    res.status(201).json({ data: { id: result.lastInsertRowid, event_number } });
  } catch (error: any) {
    console.error('Create court event from citation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Feature 2: Officer schedule conflict check ────────
router.get('/events/:id/conflicts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evt = db.prepare('SELECT * FROM court_events WHERE id = ?').get(req.params.id) as any;
    if (!evt) return res.status(404).json({ error: 'Court event not found' });

    const officers = JSON.parse(evt.officers_required || '[]');
    const conflicts: any[] = [];
    for (const officerId of officers) {
      // Check schedules for conflicts
      const shift = db.prepare(`
        SELECT s.* FROM schedules s
        WHERE s.officer_id = ? AND s.shift_date = ? AND s.status != 'cancelled'
      `).get(officerId, evt.event_date) as any;
      if (shift) {
        const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(officerId) as any;
        conflicts.push({
          officer_id: officerId,
          officer_name: user?.full_name || 'Unknown',
          conflict_type: 'shift',
          details: `Shift scheduled: ${shift.start_time || ''} - ${shift.end_time || ''}`,
        });
      }
      // Check other court events on same date
      const otherCourt = db.prepare(`
        SELECT * FROM court_events
        WHERE id != ? AND event_date = ? AND status = 'scheduled'
        AND officers_required LIKE ?
      `).all(evt.id, evt.event_date, `%${officerId}%`) as any[];
      if (otherCourt.length > 0) {
        const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(officerId) as any;
        for (const oc of otherCourt) {
          conflicts.push({
            officer_id: officerId,
            officer_name: user?.full_name || 'Unknown',
            conflict_type: 'court',
            details: `Also assigned to ${oc.event_number} at ${oc.event_time || 'TBD'}`,
          });
        }
      }
    }
    res.json({ data: conflicts });
  } catch (error: any) {
    console.error('Court conflict check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Feature 3: Continuance tracking ────────────────────
router.post('/events/:id/continuance', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { reason, new_date, new_time } = req.body;
    if (!reason) return res.status(400).json({ error: 'Continuance reason is required' });

    const evt = db.prepare('SELECT * FROM court_events WHERE id = ?').get(req.params.id) as any;
    if (!evt) return res.status(404).json({ error: 'Court event not found' });

    const log = JSON.parse(evt.continuance_log || '[]');
    log.push({
      date: now,
      reason,
      old_date: evt.event_date,
      old_time: evt.event_time,
      new_date: new_date || null,
      new_time: new_time || null,
      requested_by: req.user!.userId,
    });

    const updates: any = {
      continuance_count: (evt.continuance_count || 0) + 1,
      continuance_log: JSON.stringify(log),
      status: 'continued',
      updated_at: now,
    };
    if (new_date) { updates.event_date = new_date; updates.status = 'scheduled'; }
    if (new_time) updates.event_time = new_time;

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE court_events SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'continuance', 'court_event', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, JSON.stringify({ reason, new_date }), now);

    res.json({ data: { id: parseInt(req.params.id), continuance_count: updates.continuance_count } });
  } catch (error: any) {
    console.error('Continuance error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Feature 5: Officer appearance confirmation ─────────
router.put('/events/:id/confirm', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const evt = db.prepare('SELECT * FROM court_events WHERE id = ?').get(req.params.id) as any;
    if (!evt) return res.status(404).json({ error: 'Court event not found' });

    const confirmations = JSON.parse(evt.officer_confirmations || '{}');
    confirmations[String(req.user!.userId)] = { confirmed: true, at: now };
    db.prepare('UPDATE court_events SET officer_confirmations = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(confirmations), now, req.params.id);

    res.json({ data: { confirmations } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── Feature 6: Bail/bond tracking ──────────────────────
router.put('/events/:id/bail', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { bail_amount, bond_status, surety_info } = req.body;
    db.prepare(`UPDATE court_events SET bail_amount = ?, bond_status = ?, surety_info = ?, updated_at = ? WHERE id = ?`)
      .run(bail_amount ?? null, bond_status ?? null, surety_info ?? null, now, req.params.id);
    res.json({ data: { id: parseInt(req.params.id) } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── Feature 7: Court document upload ───────────────────
router.post('/events/:id/documents', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { file_url, file_name, doc_type } = req.body;
    if (!file_url || !file_name) return res.status(400).json({ error: 'file_url and file_name required' });

    const evt = db.prepare('SELECT * FROM court_events WHERE id = ?').get(req.params.id) as any;
    if (!evt) return res.status(404).json({ error: 'Court event not found' });

    const docs = JSON.parse(evt.documents || '[]');
    docs.push({ file_url, file_name, doc_type: doc_type || 'other', uploaded_by: req.user!.userId, uploaded_at: now });
    db.prepare('UPDATE court_events SET documents = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(docs), now, req.params.id);

    res.json({ data: { documents: docs } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── Feature 8: Judge preferences/notes ─────────────────
router.put('/events/:id/judge-notes', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { judge_notes } = req.body;
    db.prepare('UPDATE court_events SET judge_notes = ?, updated_at = ? WHERE id = ?')
      .run(judge_notes ?? null, now, req.params.id);
    res.json({ data: { id: parseInt(req.params.id) } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── Feature 10: Case disposition statistics ────────────
router.get('/statistics', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { period = '12' } = req.query; // months
    const months = parseInt(period as string, 10) || 12;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const byOutcome = db.prepare(`
      SELECT outcome, COUNT(*) as count FROM court_events
      WHERE outcome IS NOT NULL AND event_date >= ?
      GROUP BY outcome ORDER BY count DESC
    `).all(cutoffStr);

    const byType = db.prepare(`
      SELECT event_type, COUNT(*) as count FROM court_events
      WHERE event_date >= ?
      GROUP BY event_type ORDER BY count DESC
    `).all(cutoffStr);

    const byMonth = db.prepare(`
      SELECT strftime('%Y-%m', event_date) as month, outcome, COUNT(*) as count
      FROM court_events
      WHERE outcome IS NOT NULL AND event_date >= ?
      GROUP BY month, outcome
      ORDER BY month ASC
    `).all(cutoffStr);

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled,
        SUM(continuance_count) as total_continuances,
        AVG(fine_amount) as avg_fine
      FROM court_events WHERE event_date >= ?
    `).get(cutoffStr);

    res.json({ data: { byOutcome, byType, byMonth, totals } });
  } catch (error: any) {
    console.error('Court statistics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
