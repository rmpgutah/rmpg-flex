// ============================================================
// RMPG Flex — Court & Legal Tracker API Routes
// ============================================================
// Court date tracking, subpoena management, and case outcome
// recording. Auto-generates event numbers in CT-YYYY-NNNN format.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastRecordUpdate } from '../utils/websocket';
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
  const parsed = last ? parseInt(last.event_number.replace(prefix, ''), 10) : 0;
  const seq = isNaN(parsed) ? 1 : parsed + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ─── GET /events ─────────────────────────────────────────
router.get('/events', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, event_type, date_from, date_to, officer_id, search, page = '1', limit = '100000' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100000, Math.max(1, (parseInt(limit as string, 10)) || 100000));
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
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    console.error('Get court events error:', error);
    res.status(500).json({ error: 'Failed to get court events', code: 'GET_COURT_EVENTS_ERROR' });
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
  } catch (error: any) { res.status(500).json({ error: 'Server error in court', code: 'COURT_ERROR' }); }
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
    
      LIMIT 1000
    `).all(startDate, endDate);

    // Group by date
    const calendar: Record<string, any[]> = {};
    for (const row of rows as any[]) {
      if (!calendar[row.event_date]) calendar[row.event_date] = [];
      calendar[row.event_date].push(row);
    }

    res.json({ data: calendar });
  } catch (error: any) { res.status(500).json({ error: 'Server error in court', code: 'COURT_ERROR' }); }
});

// ─── GET /events/:id ─────────────────────────────────────
router.get('/events/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid event ID', code: 'INVALID_EVENT_ID' }); return; }
    const row = db.prepare(`
      SELECT e.*, p.first_name || ' ' || p.last_name as defendant_full_name
      FROM court_events e LEFT JOIN persons p ON e.defendant_person_id = p.id
      WHERE e.id = ?
    `).get(id);
    if (!row) return res.status(404).json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' });
    res.json({ data: row });
  } catch (error: any) { res.status(500).json({ error: 'Server error in court', code: 'COURT_ERROR' }); }
});

// ─── POST /events ────────────────────────────────────────
router.post('/events', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { event_type, event_date, event_time, court_name, courtroom, judge_name,
      court_case_number, citation_id, incident_id, case_id,
      defendant_person_id, defendant_name, defendant_dob, prosecutor, defense_attorney,
      officers_required, notes } = req.body;
    if (!event_type || !event_date) return res.status(400).json({ error: 'Event type and date required', code: 'MISSING_FIELDS' });

    // Validate event_date format
    if (typeof event_date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(event_date)) {
      return res.status(400).json({ error: 'event_date must be in YYYY-MM-DD format', code: 'INVALID_DATE_FORMAT' });
    }

    // Input sanitization
    const cleanCourtName = typeof court_name === 'string' ? court_name.trim() : court_name;
    const cleanDefendantName = typeof defendant_name === 'string' ? defendant_name.trim() : defendant_name;
    const cleanNotes = typeof notes === 'string' ? notes.trim() : notes;

    const event_number = nextEventNumber();
    const result = db.prepare(`
      INSERT INTO court_events (event_number, event_type, status, event_date, event_time,
        court_name, courtroom, judge_name, court_case_number,
        citation_id, incident_id, case_id, defendant_person_id, defendant_name, defendant_dob,
        prosecutor, defense_attorney, officers_required, notes,
        created_by, created_at, updated_at)
      VALUES (?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event_number, event_type, event_date, event_time || null,
      court_name || null, courtroom || null, judge_name || null, court_case_number || null,
      citation_id || null, incident_id || null, case_id || null,
      defendant_person_id || null, defendant_name || null, defendant_dob || null,
      prosecutor || null, defense_attorney || null,
      JSON.stringify(officers_required || []), notes || null,
      req.user!.userId, now, now);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'create', 'court_event', ?, ?, ?)`).run(req.user!.userId, result.lastInsertRowid, JSON.stringify({ event_number }), now);

    // Notify assigned officers
    const officerIds = officers_required || [];
    let parsedOfficers: any[];
    try {
      parsedOfficers = typeof officerIds === 'string' ? JSON.parse(officerIds) : officerIds;
    } catch {
      parsedOfficers = [];
    }
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

    broadcastRecordUpdate({ type: 'court_event_created', id: result.lastInsertRowid, event_number });
    res.status(201).json({ data: { id: result.lastInsertRowid, event_number } });
  } catch (error: any) {
    console.error('Create court event error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'CREATE_COURT_EVENT_ERROR' });
  }
});

// ─── PUT /events/:id ─────────────────────────────────────
router.put('/events/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    // God Mode: admin can reschedule past court dates
    const courtEvent = db.prepare('SELECT * FROM court_events WHERE id = ?').get(req.params.id) as any;
    if (req.user?.role === 'admin' && courtEvent) {
      const eventDate = courtEvent.event_date;
      const today = localToday();
      if (eventDate && eventDate < today && req.body.event_date) {
        auditLog(req, 'ADMIN_OVERRIDE', 'court_event', parseInt(req.params.id as string), `Admin God Mode: rescheduling past court date (${eventDate} → ${req.body.event_date})`);
      }
    }

    const fields = ['event_type', 'status', 'event_date', 'event_time', 'court_name', 'courtroom',
      'judge_name', 'court_case_number', 'citation_id', 'incident_id', 'case_id',
      'defendant_person_id', 'defendant_name', 'defendant_dob', 'prosecutor', 'defense_attorney', 'notes'];
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
            parseInt(req.params.id as string),
            'normal'
          );
        }
      }
    }

    res.json({ data: { id: parseInt(req.params.id as string) } });
  } catch (error: any) { res.status(500).json({ error: 'Server error in court', code: 'COURT_ERROR' }); }
});

// ─── PUT /events/:id/outcome ─────────────────────────────
router.put('/events/:id/outcome', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid event ID', code: 'INVALID_EVENT_ID' }); return; }
    const existing = db.prepare('SELECT id FROM court_events WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }); return; }
    const now = localNow();
    const { outcome, sentence, fine_amount, notes } = req.body;
    if (!outcome) return res.status(400).json({ error: 'Outcome is required', code: 'OUTCOME_IS_REQUIRED' });

    // Validate fine_amount if provided
    if (fine_amount !== undefined && fine_amount !== null) {
      const fineNum = parseFloat(fine_amount);
      if (isNaN(fineNum) || fineNum < 0) {
        res.status(400).json({ error: 'fine_amount must be a non-negative number', code: 'FINEAMOUNT_MUST_BE_A' });
        return;
      }
    }

    // God Mode: admin can change court outcomes on already-completed events
    const existingOutcome = db.prepare('SELECT outcome, status FROM court_events WHERE id = ?').get(id) as any;
    if (req.user?.role === 'admin' && existingOutcome?.status === 'completed' && existingOutcome?.outcome) {
      auditLog(req, 'ADMIN_OVERRIDE', 'court_event', id, `Admin God Mode: changing court outcome from "${existingOutcome.outcome}" to "${outcome}"`);
    }

    db.prepare(`
      UPDATE court_events SET outcome = ?, sentence = ?, fine_amount = ?, notes = ?,
        status = 'completed', updated_at = ? WHERE id = ?
    `).run(outcome, sentence || null, fine_amount || null, notes || null, now, id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'outcome', 'court_event', ?, ?, ?)`).run(req.user!.userId, id, JSON.stringify({ outcome }), now);

    res.json({ data: { id, outcome } });
  } catch (error: any) { res.status(500).json({ error: 'Server error in court', code: 'COURT_ERROR' }); }
});

// ─── DELETE /events/:id — Admin God Mode: delete court events ────
router.delete('/events/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid event ID', code: 'INVALID_EVENT_ID' }); return; }
    const existing = db.prepare('SELECT * FROM court_events WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }); return; }

    auditLog(req, 'ADMIN_OVERRIDE', 'court_event', id, `Admin God Mode: deleting court event ${existing.event_number} (status=${existing.status})`);
    db.prepare('DELETE FROM court_events WHERE id = ?').run(id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'delete', 'court_event', ?, ?, ?)`).run(
      req.user!.userId, id, JSON.stringify({ event_number: existing.event_number }), localNow());

    broadcastRecordUpdate({ type: 'court_event_deleted', id });
    res.json({ success: true, message: `Court event ${existing.event_number} deleted` });
  } catch (error: any) {
    console.error('Delete court event error:', error);
    res.status(500).json({ error: 'Failed to delete court event', code: 'DELETE_COURT_EVENT_ERROR' });
  }
});

// ─── POST /events/from-citation ─────────────────────────
// Create a court event from an existing citation
router.post('/events/from-citation', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { citation_id } = req.body;
    if (!citation_id) return res.status(400).json({ error: 'citation_id is required', code: 'CITATIONID_IS_REQUIRED' });

    const citation = db.prepare('SELECT * FROM citations WHERE id = ?').get(citation_id) as any;
    if (!citation) return res.status(404).json({ error: 'Citation not found', code: 'CITATION_NOT_FOUND' });

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
    res.status(500).json({ error: 'Failed to create court event from citation', code: 'CREATE_COURT_EVENT_FROM' });
  }
});

// ─── Feature 2: Officer schedule conflict check ────────
router.get('/events/:id/conflicts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evt = db.prepare('SELECT * FROM court_events WHERE id = ?').get(req.params.id) as any;
    if (!evt) return res.status(404).json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' });

    let officers: any[] = [];
    try { officers = JSON.parse(evt.officers_required || '[]'); } catch { officers = []; }
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
      
        LIMIT 1000
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
    res.status(500).json({ error: 'Failed to court conflict check', code: 'COURT_CONFLICT_CHECK_ERROR' });
  }
});

// ─── Feature 3: Continuance tracking ────────────────────
router.post('/events/:id/continuance', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { reason, new_date, new_time } = req.body;
    if (!reason) return res.status(400).json({ error: 'Continuance reason is required', code: 'CONTINUANCE_REASON_IS_REQUIRED' });

    const evt = db.prepare('SELECT * FROM court_events WHERE id = ?').get(req.params.id) as any;
    if (!evt) return res.status(404).json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' });

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

    res.json({ data: { id: parseInt(req.params.id as string), continuance_count: updates.continuance_count } });
  } catch (error: any) {
    console.error('Continuance error:', error);
    res.status(500).json({ error: 'Failed to continuance', code: 'CONTINUANCE_ERROR' });
  }
});

// ─── Feature 5: Officer appearance confirmation ─────────
router.put('/events/:id/confirm', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const evt = db.prepare('SELECT * FROM court_events WHERE id = ?').get(req.params.id) as any;
    if (!evt) return res.status(404).json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' });

    const confirmations = JSON.parse(evt.officer_confirmations || '{}');
    confirmations[String(req.user!.userId)] = { confirmed: true, at: now };
    db.prepare('UPDATE court_events SET officer_confirmations = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(confirmations), now, req.params.id);

    res.json({ data: { confirmations } });
  } catch (error: any) { res.status(500).json({ error: 'Server error in court', code: 'COURT_ERROR' }); }
});

// ─── Feature 6: Bail/bond tracking ──────────────────────
router.put('/events/:id/bail', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { bail_amount, bond_status, surety_info } = req.body;
    db.prepare(`UPDATE court_events SET bail_amount = ?, bond_status = ?, surety_info = ?, updated_at = ? WHERE id = ?`)
      .run(bail_amount ?? null, bond_status ?? null, surety_info ?? null, now, req.params.id);
    res.json({ data: { id: parseInt(req.params.id as string) } });
  } catch (error: any) { res.status(500).json({ error: 'Server error in court', code: 'COURT_ERROR' }); }
});

// ─── Feature 7: Court document upload ───────────────────
router.post('/events/:id/documents', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { file_url, file_name, doc_type } = req.body;
    if (!file_url || !file_name) return res.status(400).json({ error: 'file_url and file_name required', code: 'FILEURL_AND_FILENAME_REQUIRED' });

    const evt = db.prepare('SELECT * FROM court_events WHERE id = ?').get(req.params.id) as any;
    if (!evt) return res.status(404).json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' });

    const docs = JSON.parse(evt.documents || '[]');
    docs.push({ file_url, file_name, doc_type: doc_type || 'other', uploaded_by: req.user!.userId, uploaded_at: now });
    db.prepare('UPDATE court_events SET documents = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(docs), now, req.params.id);

    res.json({ data: { documents: docs } });
  } catch (error: any) { res.status(500).json({ error: 'Server error in court', code: 'COURT_ERROR' }); }
});

// ─── Feature 8: Judge preferences/notes ─────────────────
router.put('/events/:id/judge-notes', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { judge_notes } = req.body;
    db.prepare('UPDATE court_events SET judge_notes = ?, updated_at = ? WHERE id = ?')
      .run(judge_notes ?? null, now, req.params.id);
    res.json({ data: { id: parseInt(req.params.id as string) } });
  } catch (error: any) { res.status(500).json({ error: 'Server error in court', code: 'COURT_ERROR' }); }
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
    res.status(500).json({ error: 'Failed to court statistics', code: 'COURT_STATISTICS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 6: Court Event Reminders — 24hr before court date
// ════════════════════════════════════════════════════════════

router.post('/events/generate-reminders', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    const events = db.prepare(`
      SELECT * FROM court_events
      WHERE event_date = ? AND status = 'scheduled'
    
      LIMIT 1000
    `).all(tomorrowStr) as any[];

    let notificationsCreated = 0;
    for (const evt of events) {
      let officers: any[] = [];
    try { officers = JSON.parse(evt.officers_required || '[]'); } catch { officers = []; }
      for (const officerId of officers) {
        const id = typeof officerId === 'number' ? officerId : parseInt(officerId, 10);
        if (isNaN(id)) continue;

        // Check if reminder already sent
        const existing = db.prepare(
          "SELECT id FROM notifications WHERE user_id = ? AND entity_type = 'court_event' AND entity_id = ? AND type = 'court_reminder'"
        ).get(id, evt.id);
        if (existing) continue;

        createNotification(
          id,
          'court_reminder',
          `Court Reminder: ${evt.event_number} Tomorrow`,
          `You have a ${evt.event_type || 'court event'} scheduled tomorrow (${evt.event_date}) at ${evt.event_time || 'TBD'}${evt.court_name ? ` — ${evt.court_name}` : ''}${evt.courtroom ? ` Room ${evt.courtroom}` : ''}. Defendant: ${evt.defendant_name || 'N/A'}`,
          'court_event',
          evt.id,
          'high'
        );
        notificationsCreated++;
      }
    }

    res.json({ reminders_sent: notificationsCreated, events_tomorrow: events.length });
  } catch (error: any) {
    console.error('Court reminders error:', error);
    res.status(500).json({ error: 'Failed to court reminders', code: 'COURT_REMINDERS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 7: Prosecutor Contact Info
// ════════════════════════════════════════════════════════════

router.put('/events/:id/prosecutor', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { prosecutor_name, prosecutor_phone, prosecutor_email } = req.body;

    const evt = db.prepare('SELECT id FROM court_events WHERE id = ?').get(req.params.id);
    if (!evt) return res.status(404).json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' });

    // Store prosecutor contact as JSON in the prosecutor field
    const prosecutorInfo = JSON.stringify({
      name: prosecutor_name || '',
      phone: prosecutor_phone || '',
      email: prosecutor_email || '',
    });

    db.prepare('UPDATE court_events SET prosecutor = ?, updated_at = ? WHERE id = ?')
      .run(prosecutorInfo, now, req.params.id);

    res.json({ data: { id: parseInt(req.params.id as string), prosecutor: JSON.parse(prosecutorInfo) } });
  } catch (error: any) {
    console.error('Prosecutor update error:', error);
    res.status(500).json({ error: 'Failed to prosecutor update', code: 'PROSECUTOR_UPDATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 8: Court Fee Tracking
// ════════════════════════════════════════════════════════════

router.put('/events/:id/fees', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { filing_fee, service_fee, other_fees, fee_notes } = req.body;

    const evt = db.prepare('SELECT * FROM court_events WHERE id = ?').get(req.params.id) as any;
    if (!evt) return res.status(404).json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' });

    const fees = JSON.parse(evt.court_fees || '{}');
    if (filing_fee !== undefined) fees.filing_fee = parseFloat(filing_fee) || 0;
    if (service_fee !== undefined) fees.service_fee = parseFloat(service_fee) || 0;
    if (other_fees !== undefined) fees.other_fees = parseFloat(other_fees) || 0;
    if (fee_notes !== undefined) fees.fee_notes = fee_notes;
    fees.total = (fees.filing_fee || 0) + (fees.service_fee || 0) + (fees.other_fees || 0);
    fees.updated_at = now;

    db.prepare('UPDATE court_events SET court_fees = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(fees), now, req.params.id);

    res.json({ data: { id: parseInt(req.params.id as string), fees } });
  } catch (error: any) {
    console.error('Court fees error:', error);
    res.status(500).json({ error: 'Failed to court fees', code: 'COURT_FEES_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 9: Witness List Management
// ════════════════════════════════════════════════════════════

router.get('/events/:id/witnesses', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evt = db.prepare('SELECT witnesses FROM court_events WHERE id = ?').get(req.params.id) as any;
    if (!evt) return res.status(404).json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' });
    res.json({ data: JSON.parse(evt.witnesses || '[]') });
  } catch (error: any) { res.status(500).json({ error: 'Server error in court', code: 'COURT_ERROR' }); }
});

router.put('/events/:id/witnesses', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { witnesses } = req.body;

    const evt = db.prepare('SELECT id FROM court_events WHERE id = ?').get(req.params.id);
    if (!evt) return res.status(404).json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' });

    // witnesses should be array of { name, phone, email, role, contact_status, notes }
    if (!Array.isArray(witnesses)) return res.status(400).json({ error: 'witnesses must be an array', code: 'WITNESSES_MUST_BE_AN' });

    const sanitized = witnesses.slice(0, 50).map((w: any) => ({
      name: String(w.name || '').slice(0, 200),
      phone: String(w.phone || '').slice(0, 30),
      email: String(w.email || '').slice(0, 200),
      role: String(w.role || 'witness').slice(0, 50),
      contact_status: String(w.contact_status || 'pending').slice(0, 30),
      notes: String(w.notes || '').slice(0, 500),
    }));

    db.prepare('UPDATE court_events SET witnesses = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(sanitized), now, req.params.id);

    res.json({ data: sanitized });
  } catch (error: any) {
    console.error('Witnesses update error:', error);
    res.status(500).json({ error: 'Failed to witnesses update', code: 'WITNESSES_UPDATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 10: Court Event Cloning (for continuance)
// ════════════════════════════════════════════════════════════

router.post('/events/:id/clone', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { new_date, new_time, notes_prefix } = req.body;

    if (!new_date) return res.status(400).json({ error: 'new_date is required for cloning', code: 'NEWDATE_IS_REQUIRED_FOR' });

    const evt = db.prepare('SELECT * FROM court_events WHERE id = ?').get(req.params.id) as any;
    if (!evt) return res.status(404).json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' });

    const event_number = nextEventNumber();
    const cloneNotes = `${notes_prefix || 'Continued from'} ${evt.event_number}. ${evt.notes || ''}`.trim();

    const result = db.prepare(`
      INSERT INTO court_events (event_number, event_type, status, event_date, event_time,
        court_name, courtroom, judge_name, court_case_number,
        citation_id, incident_id, case_id, defendant_person_id, defendant_name, defendant_dob,
        prosecutor, defense_attorney, officers_required, notes,
        created_by, created_at, updated_at)
      VALUES (?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event_number, evt.event_type, new_date, new_time || evt.event_time,
      evt.court_name, evt.courtroom, evt.judge_name, evt.court_case_number,
      evt.citation_id, evt.incident_id, evt.case_id,
      evt.defendant_person_id, evt.defendant_name, evt.defendant_dob || null,
      evt.prosecutor, evt.defense_attorney, evt.officers_required,
      cloneNotes, req.user!.userId, now, now
    );

    // Mark original as continued
    db.prepare("UPDATE court_events SET status = 'continued', updated_at = ? WHERE id = ? AND status = 'scheduled'")
      .run(now, req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'clone', 'court_event', ?, ?, ?)`).run(
      req.user!.userId, result.lastInsertRowid,
      JSON.stringify({ event_number, cloned_from: evt.event_number }),
      now
    );

    res.status(201).json({ data: { id: result.lastInsertRowid, event_number, cloned_from: evt.event_number } });
  } catch (error: any) {
    console.error('Court clone error:', error);
    res.status(500).json({ error: 'Failed to court clone', code: 'COURT_CLONE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: 7-Day Court Date Reminders
// ════════════════════════════════════════════════════════════

router.post('/events/generate-7day-reminders', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = new Date();
    const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const sevenDayStr = `${sevenDaysOut.getFullYear()}-${String(sevenDaysOut.getMonth() + 1).padStart(2, '0')}-${String(sevenDaysOut.getDate()).padStart(2, '0')}`;

    const events = db.prepare(`
      SELECT * FROM court_events
      WHERE event_date = ? AND status = 'scheduled'
      LIMIT 500
    `).all(sevenDayStr) as any[];

    let notificationsCreated = 0;
    for (const evt of events) {
      const officers = JSON.parse(evt.officers_required || '[]');
      for (const officerId of officers) {
        const id = typeof officerId === 'number' ? officerId : parseInt(officerId, 10);
        if (isNaN(id)) continue;

        const existing = db.prepare(
          "SELECT id FROM notifications WHERE user_id = ? AND entity_type = 'court_event' AND entity_id = ? AND type = 'court_7day_reminder'"
        ).get(id, evt.id);
        if (existing) continue;

        createNotification(
          id,
          'court_7day_reminder',
          `Court in 7 Days: ${evt.event_number}`,
          `You have a ${evt.event_type || 'court event'} in 7 days (${evt.event_date}) at ${evt.event_time || 'TBD'}${evt.court_name ? ` — ${evt.court_name}` : ''}. Defendant: ${evt.defendant_name || 'N/A'}. Prepare your testimony and materials.`,
          'court_event',
          evt.id,
          'normal'
        );
        notificationsCreated++;
      }
    }

    res.json({ reminders_sent: notificationsCreated, events_in_7_days: events.length });
  } catch (error: any) {
    console.error('7-day court reminders error:', error);
    res.status(500).json({ error: 'Failed to generate 7-day reminders', code: 'COURT_7DAY_REMINDERS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Verdict/Outcome Recording with Detail
// ════════════════════════════════════════════════════════════

router.put('/events/:id/verdict', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid event ID', code: 'INVALID_EVENT_ID' });

    const existing = db.prepare('SELECT * FROM court_events WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' });

    const { verdict, verdict_date, sentence_type, sentence_details, probation_length,
      jail_time, fine_amount, restitution_amount, community_service_hours,
      appeal_deadline, notes } = req.body;

    const validVerdicts = ['guilty', 'not_guilty', 'dismissed', 'nolle_prosequi', 'plea_deal',
      'deferred_adjudication', 'mistrial', 'acquitted', 'no_contest'];
    if (!verdict || !validVerdicts.includes(verdict))
      return res.status(400).json({ error: 'Valid verdict required', code: 'INVALID_VERDICT' });

    const now = localNow();
    const verdictData = JSON.stringify({
      verdict,
      verdict_date: verdict_date || localToday(),
      sentence_type: sentence_type || null,
      sentence_details: sentence_details || null,
      probation_length: probation_length || null,
      jail_time: jail_time || null,
      fine_amount: fine_amount || null,
      restitution_amount: restitution_amount || null,
      community_service_hours: community_service_hours || null,
      appeal_deadline: appeal_deadline || null,
      recorded_by: req.user!.userId,
      recorded_at: now,
    });

    db.prepare(`UPDATE court_events SET outcome = ?, sentence = ?, fine_amount = ?,
      verdict_data = ?, status = 'completed', updated_at = ? WHERE id = ?`)
      .run(verdict, sentence_details || sentence_type || null, fine_amount || null,
        verdictData, now, id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'verdict', 'court_event', ?, ?, ?)`).run(
      req.user!.userId, id, JSON.stringify({ verdict, sentence_type }), now);

    broadcastRecordUpdate({ type: 'court_verdict', id, verdict });
    res.json({ data: { id, verdict, status: 'completed' } });
  } catch (error: any) {
    console.error('Court verdict error:', error);
    res.status(500).json({ error: 'Failed to record verdict', code: 'COURT_VERDICT_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Officer Subpoena Tracking
// ════════════════════════════════════════════════════════════

router.post('/subpoenas', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { officer_id, court_event_id, court_case_number, court_name,
      hearing_date, hearing_time, served_date, served_method, notes } = req.body;

    if (!officer_id || !hearing_date) return res.status(400).json({ error: 'officer_id and hearing_date required', code: 'MISSING_SUBPOENA_FIELDS' });

    // Store as court event of type 'subpoena'
    // Audit 2026-04-11: dropped subpoena_served_date / subpoena_served_method
    // bindings — neither column exists in court_events, so every POST threw a
    // SQLite "no such column" error and the entire feature was unusable.
    // Service-of-process metadata is folded into notes until a proper schema
    // migration adds dedicated columns.
    const event_number = nextEventNumber();
    const servedNote = (served_date || served_method)
      ? `[Served: ${served_date || 'date n/a'}${served_method ? ` via ${served_method}` : ''}]`
      : '';
    const combinedNotes = [servedNote, notes].filter(Boolean).join(' ').trim() || null;
    const result = db.prepare(`
      INSERT INTO court_events (event_number, event_type, status, event_date, event_time,
        court_name, court_case_number, officers_required,
        notes, created_by, created_at, updated_at)
      VALUES (?, 'subpoena', 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event_number, hearing_date, hearing_time || null,
      court_name || null, court_case_number || null,
      JSON.stringify([officer_id]),
      combinedNotes, req.user!.userId, now, now);

    // Notify the officer
    createNotification(
      officer_id,
      'subpoena_received',
      `Subpoena Received: ${event_number}`,
      `You have been subpoenaed for ${hearing_date}${court_name ? ` at ${court_name}` : ''}. Case: ${court_case_number || 'N/A'}`,
      'court_event',
      result.lastInsertRowid as number,
      'high'
    );

    broadcastRecordUpdate({ type: 'subpoena_created', id: result.lastInsertRowid, event_number });
    res.status(201).json({ data: { id: result.lastInsertRowid, event_number } });
  } catch (error: any) {
    console.error('Create subpoena error:', error);
    res.status(500).json({ error: 'Failed to create subpoena', code: 'CREATE_SUBPOENA_ERROR' });
  }
});

// List officer subpoenas
router.get('/subpoenas/officer/:officerId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const officerId = parseInt(req.params.officerId as string, 10);
    if (isNaN(officerId)) return res.status(400).json({ error: 'Invalid officer ID', code: 'INVALID_OFFICER_ID' });

    const rows = db.prepare(`
      SELECT e.*, u.full_name as officer_name
      FROM court_events e
      LEFT JOIN users u ON ? = u.id
      WHERE e.event_type = 'subpoena' AND e.officers_required LIKE ?
        AND e.status IN ('scheduled', 'continued')
      ORDER BY e.event_date ASC
      LIMIT 100
    `).all(officerId, `%${officerId}%`);

    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get officer subpoenas', code: 'OFFICER_SUBPOENAS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Court Appearance Compliance Rate
// ════════════════════════════════════════════════════════════

router.get('/compliance-rate', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { months = '12' } = req.query;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - parseInt(months as string, 10));
    const cutoffStr = cutoff.toISOString().split('T')[0];

    // Officer appearance compliance
    const officerCompliance = db.prepare(`
      SELECT
        u.id as officer_id,
        u.full_name as officer_name,
        COUNT(DISTINCT e.id) as total_events,
        SUM(CASE WHEN json_extract(e.officer_confirmations, '$.' || u.id || '.confirmed') = 1 THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM users u
      CROSS JOIN court_events e
      WHERE e.event_date >= ? AND e.officers_required LIKE '%' || u.id || '%'
      GROUP BY u.id
      HAVING total_events > 0
      ORDER BY total_events DESC
    `).all(cutoffStr) as any[];

    // Overall stats
    const overall = db.prepare(`
      SELECT
        COUNT(*) as total_events,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'missed' OR status = 'no_show' THEN 1 ELSE 0 END) as missed,
        SUM(CASE WHEN status = 'continued' THEN 1 ELSE 0 END) as continued,
        SUM(continuance_count) as total_continuances
      FROM court_events WHERE event_date >= ?
    `).get(cutoffStr) as any;

    const complianceRate = overall.total_events > 0
      ? Math.round((overall.completed / overall.total_events) * 100) : 0;

    res.json({
      data: {
        overall: { ...overall, compliance_rate: complianceRate },
        by_officer: officerCompliance.map((o: any) => ({
          ...o,
          compliance_rate: o.total_events > 0 ? Math.round((o.confirmed / o.total_events) * 100) : 0,
        })),
        period_months: parseInt(months as string, 10),
      },
    });
  } catch (error: any) {
    console.error('Court compliance rate error:', error);
    res.status(500).json({ error: 'Failed to get compliance rate', code: 'COMPLIANCE_RATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Link Court Records to Citations/Arrests
// ════════════════════════════════════════════════════════════

router.get('/events/:id/linked-records', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evt = db.prepare('SELECT * FROM court_events WHERE id = ?').get(req.params.id) as any;
    if (!evt) return res.status(404).json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' });

    const links: any = { citation: null, incident: null, case_record: null, arrests: [], related_events: [] };

    if (evt.citation_id) {
      links.citation = db.prepare('SELECT id, citation_number, violation, person_name, status FROM citations WHERE id = ?').get(evt.citation_id);
    }
    if (evt.incident_id) {
      links.incident = db.prepare('SELECT id, incident_number, incident_type, status FROM incidents WHERE id = ?').get(evt.incident_id);
    }
    if (evt.case_id) {
      links.case_record = db.prepare('SELECT id, case_number, case_type, status FROM cases WHERE id = ?').get(evt.case_id);
    }

    // Find arrests with matching defendant name
    if (evt.defendant_name) {
      links.arrests = db.prepare(`
        SELECT id, full_name, booking_date, charges, status FROM arrest_records
        WHERE full_name LIKE ? OR last_name LIKE ? LIMIT 10
      `).all(`%${evt.defendant_name}%`, `%${evt.defendant_name}%`);
    }

    // Related court events (same case number)
    if (evt.court_case_number) {
      links.related_events = db.prepare(`
        SELECT id, event_number, event_type, event_date, status, outcome
        FROM court_events WHERE court_case_number = ? AND id != ? ORDER BY event_date ASC LIMIT 20
      `).all(evt.court_case_number, evt.id);
    }

    res.json({ data: links });
  } catch (error: any) {
    console.error('Court linked records error:', error);
    res.status(500).json({ error: 'Failed to get linked records', code: 'COURT_LINKS_ERROR' });
  }
});

// ============================================================
// Admin-editable lookups (court_lookups table)
// ============================================================
// Generic CRUD for every Court-Tracker dropdown — courts, judges,
// prosecutors, defense attorneys, event types, outcomes, pleas, bond
// statuses, witness types, officer roles, charge codes. Categories are
// free strings, so adding a new dropdown surface doesn't require a
// server change — just insert a row with a new category.
// See server/src/models/courtSchema.ts for the schema + seed data.

router.get('/lookups/categories', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    res.json(db.prepare('SELECT category, COUNT(*) AS count FROM court_lookups GROUP BY category ORDER BY category').all());
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.get('/lookups', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const cat = req.query.category ? String(req.query.category) : null;
    const includeInactive = String(req.query.includeInactive ?? '') === 'true';
    const where: string[] = [];
    const args: any[] = [];
    if (cat) { where.push('category = ?'); args.push(cat); }
    if (!includeInactive) where.push('is_active = 1');
    const sql = `SELECT id, category, value, display_label, meta, display_order, is_active, created_by, created_at, updated_at
                 FROM court_lookups
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY category ASC, display_order ASC, value ASC`;
    res.json(db.prepare(sql).all(...args));
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.post('/lookups', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const { category, value, display_label, meta, display_order, is_active } = req.body ?? {};
    if (!category || !value) { res.status(400).json({ error: 'category and value required' }); return; }
    const db = getDb();
    const r = db.prepare(
      `INSERT INTO court_lookups (category, value, display_label, meta, display_order, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      String(category), String(value),
      display_label != null ? String(display_label) : null,
      meta != null ? String(meta) : null,
      typeof display_order === 'number' ? display_order : 100,
      is_active === false ? 0 : 1,
      req.user!.userId,
    );
    auditLog(req, 'CREATE', 'court_lookup', Number(r.lastInsertRowid), null, req.body);
    res.json({ success: true, id: Number(r.lastInsertRowid) });
  } catch (err: any) {
    if (String(err?.message ?? '').includes('UNIQUE')) {
      res.status(409).json({ error: 'A lookup with that category + value already exists' }); return;
    }
    res.status(500).json({ error: err?.message || 'Failed' });
  }
});

router.put('/lookups/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const db = getDb();
    const before = db.prepare('SELECT * FROM court_lookups WHERE id = ?').get(id);
    if (!before) { res.status(404).json({ error: 'Not found' }); return; }
    const { value, display_label, meta, display_order, is_active } = req.body ?? {};
    db.prepare(
      `UPDATE court_lookups SET
         value = COALESCE(?, value),
         display_label = ?, meta = ?,
         display_order = COALESCE(?, display_order),
         is_active = COALESCE(?, is_active),
         updated_at = datetime('now','localtime')
       WHERE id = ?`
    ).run(
      value != null ? String(value) : null,
      display_label != null ? String(display_label) : null,
      meta != null ? String(meta) : null,
      typeof display_order === 'number' ? display_order : null,
      is_active === undefined ? null : (is_active ? 1 : 0),
      id,
    );
    auditLog(req, 'UPDATE', 'court_lookup', id, before, req.body);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.delete('/lookups/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const db = getDb();
    const before = db.prepare('SELECT * FROM court_lookups WHERE id = ?').get(id);
    if (!before) { res.status(404).json({ error: 'Not found' }); return; }
    db.prepare('DELETE FROM court_lookups WHERE id = ?').run(id);
    auditLog(req, 'DELETE', 'court_lookup', id, before, null);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

// ============================================================
// Witnesses CRUD
// ============================================================

router.get('/events/:id/witnesses-list', (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const rows = getDb().prepare(
      `SELECT w.*, u.full_name AS served_by_name
       FROM court_witnesses w LEFT JOIN users u ON w.served_by_user_id = u.id
       WHERE w.event_id = ? ORDER BY w.id`
    ).all(id);
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.post('/events/:id/witnesses', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const eventId = parseInt(String(req.params.id), 10);
    const b = req.body ?? {};
    if (!b.witness_name) { res.status(400).json({ error: 'witness_name required' }); return; }
    const r = getDb().prepare(
      `INSERT INTO court_witnesses (event_id, person_id, witness_name, witness_type, contact_phone,
        contact_email, address, appearance_required, witness_fee, mileage_miles, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      eventId, b.person_id ?? null, String(b.witness_name), b.witness_type ?? null,
      b.contact_phone ?? null, b.contact_email ?? null, b.address ?? null,
      b.appearance_required === false ? 0 : 1,
      typeof b.witness_fee === 'number' ? b.witness_fee : null,
      typeof b.mileage_miles === 'number' ? b.mileage_miles : null,
      b.notes ?? null,
    );
    auditLog(req, 'CREATE', 'court_witness', Number(r.lastInsertRowid), null, b);
    res.json({ success: true, id: Number(r.lastInsertRowid) });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.put('/witnesses/:id', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const db = getDb();
    const before = db.prepare('SELECT * FROM court_witnesses WHERE id = ?').get(id);
    if (!before) { res.status(404).json({ error: 'Not found' }); return; }
    const b = req.body ?? {};
    db.prepare(
      `UPDATE court_witnesses SET
         witness_name = COALESCE(?, witness_name),
         witness_type = ?, contact_phone = ?, contact_email = ?, address = ?,
         subpoena_served = COALESCE(?, subpoena_served),
         served_at = ?, served_by_user_id = ?,
         appearance_required = COALESCE(?, appearance_required),
         appeared = COALESCE(?, appeared),
         testified = COALESCE(?, testified),
         witness_fee = ?, mileage_miles = ?, reimbursement_total = ?, notes = ?,
         updated_at = datetime('now','localtime')
       WHERE id = ?`
    ).run(
      b.witness_name ?? null, b.witness_type ?? null, b.contact_phone ?? null,
      b.contact_email ?? null, b.address ?? null,
      typeof b.subpoena_served === 'boolean' ? (b.subpoena_served ? 1 : 0) : null,
      b.served_at ?? null, b.served_by_user_id ?? null,
      typeof b.appearance_required === 'boolean' ? (b.appearance_required ? 1 : 0) : null,
      typeof b.appeared === 'boolean' ? (b.appeared ? 1 : 0) : null,
      typeof b.testified === 'boolean' ? (b.testified ? 1 : 0) : null,
      typeof b.witness_fee === 'number' ? b.witness_fee : null,
      typeof b.mileage_miles === 'number' ? b.mileage_miles : null,
      typeof b.reimbursement_total === 'number' ? b.reimbursement_total : null,
      b.notes ?? null,
      id,
    );
    auditLog(req, 'UPDATE', 'court_witness', id, before, b);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.delete('/witnesses/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const db = getDb();
  const before = db.prepare('SELECT * FROM court_witnesses WHERE id = ?').get(id);
  if (!before) { res.status(404).json({ error: 'Not found' }); return; }
  db.prepare('DELETE FROM court_witnesses WHERE id = ?').run(id);
  auditLog(req, 'DELETE', 'court_witness', id, before, null);
  res.json({ success: true });
});

// ============================================================
// Sentence / pleas / restitution / officer assignments
// ============================================================

router.get('/events/:id/sentence', (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  res.json(getDb().prepare('SELECT * FROM court_sentences WHERE event_id = ?').get(id) ?? null);
});

router.put('/events/:id/sentence', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const b = req.body ?? {};
    getDb().prepare(
      `INSERT INTO court_sentences (event_id, incarceration_days, incarceration_facility, probation_months,
         probation_terms, community_service_hours, fine_amount, court_costs, restitution_amount, restitution_payee,
         protective_order, no_contact_order, treatment_required, license_suspended, license_suspension_months,
         additional_terms, sentenced_at, sentencing_judge)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         incarceration_days = excluded.incarceration_days,
         incarceration_facility = excluded.incarceration_facility,
         probation_months = excluded.probation_months,
         probation_terms = excluded.probation_terms,
         community_service_hours = excluded.community_service_hours,
         fine_amount = excluded.fine_amount, court_costs = excluded.court_costs,
         restitution_amount = excluded.restitution_amount, restitution_payee = excluded.restitution_payee,
         protective_order = excluded.protective_order, no_contact_order = excluded.no_contact_order,
         treatment_required = excluded.treatment_required,
         license_suspended = excluded.license_suspended, license_suspension_months = excluded.license_suspension_months,
         additional_terms = excluded.additional_terms, sentenced_at = excluded.sentenced_at,
         sentencing_judge = excluded.sentencing_judge,
         updated_at = datetime('now','localtime')`
    ).run(
      id,
      b.incarceration_days ?? null, b.incarceration_facility ?? null,
      b.probation_months ?? null, b.probation_terms ?? null,
      b.community_service_hours ?? null, b.fine_amount ?? null,
      b.court_costs ?? null, b.restitution_amount ?? null, b.restitution_payee ?? null,
      b.protective_order ? 1 : 0, b.no_contact_order ? 1 : 0,
      b.treatment_required ?? null,
      b.license_suspended ? 1 : 0, b.license_suspension_months ?? null,
      b.additional_terms ?? null, b.sentenced_at ?? null, b.sentencing_judge ?? null,
    );
    auditLog(req, 'UPSERT', 'court_sentence', id, null, b);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.get('/events/:id/pleas', (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  res.json(getDb().prepare(
    `SELECT p.*, u.full_name AS entered_by_name
     FROM court_pleas p LEFT JOIN users u ON p.entered_by_user_id = u.id
     WHERE p.event_id = ? ORDER BY p.plea_date DESC, p.id DESC`
  ).all(id));
});

router.post('/events/:id/pleas', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const b = req.body ?? {};
    if (!b.plea || !b.plea_date) { res.status(400).json({ error: 'plea + plea_date required' }); return; }
    const r = getDb().prepare(
      `INSERT INTO court_pleas (event_id, plea, plea_date, charge, notes, entered_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, String(b.plea), String(b.plea_date), b.charge ?? null, b.notes ?? null, req.user!.userId);
    auditLog(req, 'CREATE', 'court_plea', Number(r.lastInsertRowid), null, b);
    res.json({ success: true, id: Number(r.lastInsertRowid) });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.delete('/pleas/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const db = getDb();
  const before = db.prepare('SELECT * FROM court_pleas WHERE id = ?').get(id);
  if (!before) { res.status(404).json({ error: 'Not found' }); return; }
  db.prepare('DELETE FROM court_pleas WHERE id = ?').run(id);
  auditLog(req, 'DELETE', 'court_plea', id, before, null);
  res.json({ success: true });
});

router.get('/events/:id/restitution', (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const db = getDb();
  const payments = db.prepare(
    `SELECT r.*, u.full_name AS received_by_name
     FROM court_restitution_payments r LEFT JOIN users u ON r.received_by_user_id = u.id
     WHERE r.event_id = ? ORDER BY r.paid_at DESC`
  ).all(id);
  const sentence = db.prepare('SELECT restitution_amount FROM court_sentences WHERE event_id = ?').get(id) as { restitution_amount?: number } | undefined;
  const totalPaid = (payments as Array<{ amount: number }>).reduce((s, p) => s + (p.amount || 0), 0);
  const owed = sentence?.restitution_amount ?? 0;
  res.json({ owed, totalPaid, balance: owed - totalPaid, payments });
});

router.post('/events/:id/restitution', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const b = req.body ?? {};
    if (typeof b.amount !== 'number' || !b.paid_at) { res.status(400).json({ error: 'amount (number) + paid_at required' }); return; }
    const r = getDb().prepare(
      `INSERT INTO court_restitution_payments (event_id, amount, paid_at, method, reference_number, received_by_user_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, b.amount, String(b.paid_at), b.method ?? null, b.reference_number ?? null, req.user!.userId, b.notes ?? null);
    auditLog(req, 'CREATE', 'court_restitution_payment', Number(r.lastInsertRowid), null, b);
    res.json({ success: true, id: Number(r.lastInsertRowid) });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.delete('/restitution/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const db = getDb();
  const before = db.prepare('SELECT * FROM court_restitution_payments WHERE id = ?').get(id);
  if (!before) { res.status(404).json({ error: 'Not found' }); return; }
  db.prepare('DELETE FROM court_restitution_payments WHERE id = ?').run(id);
  auditLog(req, 'DELETE', 'court_restitution_payment', id, before, null);
  res.json({ success: true });
});

router.get('/events/:id/assignments', (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  res.json(getDb().prepare(
    `SELECT a.*, u.full_name, u.username
     FROM court_officer_assignments a JOIN users u ON a.user_id = u.id
     WHERE a.event_id = ? ORDER BY a.created_at`
  ).all(id));
});

router.post('/events/:id/assignments', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const eventId = parseInt(String(req.params.id), 10);
    const { user_id, role } = req.body ?? {};
    if (!user_id) { res.status(400).json({ error: 'user_id required' }); return; }
    getDb().prepare(
      `INSERT INTO court_officer_assignments (event_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET role = excluded.role, updated_at = datetime('now','localtime')`
    ).run(eventId, user_id, role ?? null);
    auditLog(req, 'UPSERT', 'court_officer_assignment', 0, null, req.body);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.put('/assignments/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const db = getDb();
  const before = db.prepare('SELECT * FROM court_officer_assignments WHERE id = ?').get(id);
  if (!before) { res.status(404).json({ error: 'Not found' }); return; }
  const b = req.body ?? {};
  db.prepare(
    `UPDATE court_officer_assignments SET
       role = COALESCE(?, role),
       confirmed = COALESCE(?, confirmed), confirmed_at = ?,
       appeared = COALESCE(?, appeared), testified = COALESCE(?, testified),
       mileage_miles = ?, hours_billed = ?, reimbursement_total = ?, notes = ?,
       updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(
    b.role ?? null,
    typeof b.confirmed === 'boolean' ? (b.confirmed ? 1 : 0) : null,
    b.confirmed_at ?? null,
    typeof b.appeared === 'boolean' ? (b.appeared ? 1 : 0) : null,
    typeof b.testified === 'boolean' ? (b.testified ? 1 : 0) : null,
    typeof b.mileage_miles === 'number' ? b.mileage_miles : null,
    typeof b.hours_billed === 'number' ? b.hours_billed : null,
    typeof b.reimbursement_total === 'number' ? b.reimbursement_total : null,
    b.notes ?? null, id,
  );
  auditLog(req, 'UPDATE', 'court_officer_assignment', id, before, b);
  res.json({ success: true });
});

router.delete('/assignments/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const db = getDb();
  const before = db.prepare('SELECT * FROM court_officer_assignments WHERE id = ?').get(id);
  if (!before) { res.status(404).json({ error: 'Not found' }); return; }
  db.prepare('DELETE FROM court_officer_assignments WHERE id = ?').run(id);
  auditLog(req, 'DELETE', 'court_officer_assignment', id, before, null);
  res.json({ success: true });
});

// ============================================================
// New views: officer-schedule, defendant-timeline, ical, search,
// bulk-reschedule
// ============================================================

router.get('/officer-schedule', (req: Request, res: Response) => {
  try {
    const userId = req.query.userId ? parseInt(String(req.query.userId), 10) : req.user!.userId;
    const from = req.query.from ? String(req.query.from) : new Date().toISOString().slice(0, 10);
    res.json(getDb().prepare(
      `SELECT e.*, a.role AS officer_role, a.confirmed, a.appeared
       FROM court_events e
       JOIN court_officer_assignments a ON a.event_id = e.id
       WHERE a.user_id = ? AND e.event_date >= ?
       ORDER BY e.event_date ASC, e.event_time ASC`
    ).all(userId, from));
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.get('/defendant-timeline', (req: Request, res: Response) => {
  try {
    const personId = req.query.personId ? parseInt(String(req.query.personId), 10) : null;
    const name = req.query.name ? String(req.query.name) : null;
    if (!personId && !name) { res.status(400).json({ error: 'personId or name required' }); return; }
    const where: string[] = [];
    const args: any[] = [];
    if (personId) { where.push('defendant_person_id = ?'); args.push(personId); }
    if (name) { where.push('LOWER(defendant_name) LIKE ?'); args.push(`%${name.toLowerCase()}%`); }
    res.json(getDb().prepare(
      `SELECT * FROM court_events WHERE ${where.join(' OR ')} ORDER BY event_date ASC, event_time ASC`
    ).all(...args));
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.get('/calendar/ical', (req: Request, res: Response) => {
  try {
    const userId = req.query.userId ? parseInt(String(req.query.userId), 10) : req.user!.userId;
    const onlyMine = String(req.query.onlyMine ?? 'false') === 'true';
    const events = onlyMine
      ? getDb().prepare(
          `SELECT e.* FROM court_events e
           JOIN court_officer_assignments a ON a.event_id = e.id
           WHERE a.user_id = ? AND e.event_date >= date('now', '-7 days')
           ORDER BY e.event_date`
        ).all(userId)
      : getDb().prepare(`SELECT * FROM court_events WHERE event_date >= date('now', '-7 days') ORDER BY event_date`).all();
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RMPG Flex//Court Tracker//EN', 'CALSCALE:GREGORIAN'];
    for (const e of events as any[]) {
      const datePart = String(e.event_date || '').replace(/-/g, '');
      const timePart = String(e.event_time || '0900').replace(/:/g, '').padEnd(6, '0');
      const start = `${datePart}T${timePart}`;
      const summary = `${(e.event_type || '').toUpperCase()} — ${e.defendant_name ?? 'Unknown'}`;
      const desc = [e.court_name, e.judge_name ? `Judge ${e.judge_name}` : null, e.notes].filter(Boolean).join('\\n');
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:court-${e.id}@rmpgutah.us`);
      lines.push(`DTSTAMP:${new Date().toISOString().replace(/-|:/g, '').replace(/\.\d{3}/, '')}`);
      lines.push(`DTSTART:${start}`);
      lines.push(`SUMMARY:${summary}`);
      if (e.courtroom) lines.push(`LOCATION:${e.court_name ?? ''} ${e.courtroom}`);
      if (desc) lines.push(`DESCRIPTION:${desc}`);
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="rmpg-court.ics"');
    res.send(lines.join('\r\n'));
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.get('/search', (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? '').trim().toLowerCase();
    if (!q) { res.json({ count: 0, events: [] }); return; }
    const like = `%${q}%`;
    const events = getDb().prepare(
      `SELECT id, event_number, event_type, status, event_date, defendant_name, court_name, judge_name, notes
       FROM court_events
       WHERE LOWER(event_number) LIKE ? OR LOWER(defendant_name) LIKE ?
          OR LOWER(court_name) LIKE ? OR LOWER(judge_name) LIKE ?
          OR LOWER(prosecutor) LIKE ? OR LOWER(defense_attorney) LIKE ?
          OR LOWER(notes) LIKE ? OR LOWER(sentence) LIKE ?
       ORDER BY event_date DESC LIMIT 200`
    ).all(like, like, like, like, like, like, like, like);
    res.json({ count: (events as any[]).length, events });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.post('/events/bulk-reschedule', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const { from_date, to_date, ids } = req.body ?? {};
    const db = getDb();
    if (Array.isArray(ids) && ids.length > 0 && to_date) {
      const stmt = db.prepare(`UPDATE court_events SET event_date = ?, updated_at = datetime('now','localtime') WHERE id = ?`);
      const tx = db.transaction((rows: number[]) => { for (const id of rows) stmt.run(String(to_date), id); });
      tx(ids);
      auditLog(req, 'BULK_RESCHEDULE', 'court_event', 0, null, { ids, to_date });
      res.json({ success: true, count: ids.length });
      return;
    }
    if (from_date && to_date) {
      const r = db.prepare(`UPDATE court_events SET event_date = ?, updated_at = datetime('now','localtime') WHERE event_date = ?`).run(String(to_date), String(from_date));
      auditLog(req, 'BULK_RESCHEDULE_DATE', 'court_event', 0, null, { from_date, to_date });
      res.json({ success: true, count: r.changes });
      return;
    }
    res.status(400).json({ error: '{from_date+to_date} or {ids+to_date} required' });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

export default router;
