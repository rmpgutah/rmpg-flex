// ============================================================
// RMPG Flex — Daily Activity Reports (DAR) API Routes
// ============================================================
// Structured shift reports with auto-populated call/incident
// data, supervisor review workflow, and PDF export.
// Auto-generates numbers in DAR-YYYY-NNNN format.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { sendCsv } from '../utils/csvExport';
import { broadcastRecordUpdate } from '../utils/websocket';
import { localNow, localToday } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

function nextDarNumber(): string {
  const db = getDb();
  const yr = new Date().getFullYear();
  const prefix = `DAR-${yr}-`;
  const last = db.prepare(
    "SELECT dar_number FROM daily_activity_reports WHERE dar_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`${prefix}%`) as { dar_number: string } | undefined;
  const parsed = last ? parseInt(last.dar_number.replace(prefix, ''), 10) : 0;
  const seq = isNaN(parsed) ? 1 : parsed + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ─── GET / ───────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, officer_id, property_id, date_from, date_to, search, page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND d.status = ?'; params.push(status); }
    if (officer_id) { where += ' AND d.officer_id = ?'; params.push(officer_id); }
    if (property_id) { where += ' AND d.property_id = ?'; params.push(property_id); }
    if (date_from) { where += ' AND d.shift_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND d.shift_date <= ?'; params.push(date_to); }
    if (search) {
      where += ' AND (d.dar_number LIKE ? OR d.officer_name LIKE ? OR d.property_name LIKE ? OR d.activities_narrative LIKE ?)';
      const s = `%${search}%`; params.push(s, s, s, s);
    }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM daily_activity_reports d ${where}`).get(...params) as any).count;
    const rows = db.prepare(`
      SELECT d.*, u.full_name as reviewer_name
      FROM daily_activity_reports d
      LEFT JOIN users u ON d.reviewed_by = u.id
      ${where}
      ORDER BY d.shift_date DESC, d.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.set('Cache-Control', 'private, max-age=30');
    res.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Get DARs error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Get DARs error:', error);
    res.status(500).json({ error: 'Failed to retrieve daily activity reports', code: 'LIST_DAR_ERROR' });
>>>>>>> origin/main
  }
});

// ─── GET /:id ────────────────────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }); return; }
    const row = db.prepare('SELECT * FROM daily_activity_reports WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' });
    res.json({ data: row });
  } catch (error: any) { console.error('Get DAR error:', error); res.status(500).json({ error: 'Failed to retrieve DAR', code: 'GET_DAR_ERROR' }); }
});

// ─── POST /auto-populate ────────────────────────────────
// Fetches shift data for an officer on a given date
router.post('/auto-populate', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, shift_date } = req.body;
    if (!officer_id || !shift_date) return res.status(400).json({ error: 'Officer ID and shift date required', code: 'OFFICER_ID_AND_SHIFT' });

    // Get officer info
    const officer = db.prepare('SELECT full_name FROM users WHERE id = ?').get(officer_id) as any;

    // Get calls handled that day by this officer's units
    const calls = db.prepare(`
      SELECT id, call_number, incident_type, created_at, disposition, status
      FROM calls_for_service
      WHERE DATE(created_at) = ? AND (assigned_unit_ids LIKE ? OR dispatcher_id = ?)
      ORDER BY created_at
    
      LIMIT 1000
    `).all(shift_date, `%${officer_id}%`, officer_id) as any[];

    // Get incidents created
    const incidents = db.prepare(`
      SELECT id, incident_number, incident_type FROM incidents
      WHERE DATE(created_at) = ? AND officer_id = ?
    
      LIMIT 1000
    `).all(shift_date, officer_id) as any[];

    // Get citations issued
    const citations = db.prepare(`
      SELECT id, citation_number, type FROM citations
      WHERE violation_date = ? AND issuing_officer_id = ?
    
      LIMIT 1000
    `).all(shift_date, officer_id) as any[];

    // Get patrol scans
    const patrols = db.prepare(`
      SELECT ps.id, pc.name as checkpoint, ps.scanned_at, ps.status
      FROM patrol_scans ps
      JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      WHERE DATE(ps.scanned_at) = ? AND ps.officer_id = ?
    
      LIMIT 1000
    `).all(shift_date, officer_id) as any[];

    // Get time entry for shift start/end
    const timeEntry = db.prepare(`
      SELECT clock_in, clock_out FROM time_entries
      WHERE officer_id = ? AND DATE(clock_in) = ?
      ORDER BY clock_in DESC LIMIT 1
    `).get(officer_id, shift_date) as any;

    // Get schedule / property info
    const schedule = db.prepare(`
      SELECT s.start_time, s.end_time, p.name as property_name, p.id as property_id
      FROM schedules s
      LEFT JOIN properties p ON s.property_id = p.id
      WHERE s.officer_id = ? AND s.shift_date = ?
      ORDER BY s.start_time LIMIT 1
    `).get(officer_id, shift_date) as any;

    // Get field interviews conducted
    let fieldInterviews: any[] = [];
    try {
      fieldInterviews = db.prepare(`
        SELECT id, subject_first_name, subject_last_name, location, reason
        FROM field_interviews
        WHERE DATE(interview_date) = ? AND officer_id = ?
      
        LIMIT 1000
      `).all(shift_date, officer_id);
    } catch (e) { console.error('DAR auto-populate field_interviews query failed:', (e as Error).message); }

    // ── Build auto-generated narrative ──
    const narrativeParts: string[] = [];

    if (schedule?.property_name) {
      narrativeParts.push(`Assigned to ${schedule.property_name}.`);
    }

    if (timeEntry?.clock_in) {
      const clockIn = new Date(timeEntry.clock_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const clockOut = timeEntry.clock_out
        ? new Date(timeEntry.clock_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        : 'ongoing';
      narrativeParts.push(`On duty ${clockIn} - ${clockOut}.`);
    }

    if (calls.length > 0) {
      const typeCounts: Record<string, number> = {};
      for (const c of calls) {
        const t = (c.incident_type || 'other').replace(/_/g, ' ');
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      }
      const typeList = Object.entries(typeCounts)
        .map(([type, count]) => count > 1 ? `${count} ${type}` : type)
        .join(', ');
      narrativeParts.push(`Responded to ${calls.length} call(s): ${typeList}.`);
    }

    if (incidents.length > 0) {
      const incNums = incidents.map((i: any) => i.incident_number).join(', ');
      narrativeParts.push(`Generated ${incidents.length} incident report(s): ${incNums}.`);
    }

    if (citations.length > 0) {
      narrativeParts.push(`Issued ${citations.length} citation(s).`);
    }

    if (fieldInterviews.length > 0) {
      narrativeParts.push(`Conducted ${fieldInterviews.length} field interview(s).`);
    }

    if (patrols.length > 0) {
      const onTime = patrols.filter((p: any) => p.status === 'on_time').length;
      narrativeParts.push(`Completed ${patrols.length} patrol check(s) (${onTime} on-time).`);
    }

    if (narrativeParts.length === 0) {
      narrativeParts.push('No logged activity for this shift.');
    }

    const autoNarrative = narrativeParts.join(' ');

    res.json({
      data: {
        officer_name: officer?.full_name || '',
        shift_start: timeEntry?.clock_in || schedule?.start_time || null,
        shift_end: timeEntry?.clock_out || schedule?.end_time || null,
        property_id: schedule?.property_id || null,
        property_name: schedule?.property_name || null,
        calls_handled: calls.map((c: any) => ({ call_id: c.id, number: c.call_number, type: c.incident_type, time: c.created_at, disposition: c.disposition })),
        incidents_created: incidents.map((i: any) => ({ incident_id: i.id, number: i.incident_number, type: i.incident_type })),
        citations_issued: citations.map((c: any) => ({ citation_id: c.id, number: c.citation_number, type: c.type })),
        field_interviews: fieldInterviews.map((fi: any) => ({ name: `${fi.subject_first_name} ${fi.subject_last_name}`, location: fi.location, reason: fi.contact_reason })),
        patrols_completed: patrols.map((p: any) => ({ checkpoint: p.checkpoint, time: p.scanned_at, status: p.status })),
        auto_narrative: autoNarrative,
      },
    });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Auto-populate DAR error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Auto-populate DAR error:', error);
    res.status(500).json({ error: 'Failed to auto-populate DAR data', code: 'AUTO_POPULATE_ERROR' });
>>>>>>> origin/main
  }
});

// ─── POST / ──────────────────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { shift_date, officer_id, officer_name, shift_start, shift_end,
      property_id, property_name, post_assignment,
      calls_handled, incidents_created, citations_issued, patrols_completed,
      activities_narrative, notable_events, equipment_issues, safety_concerns, recommendations } = req.body;
    if (!shift_date) return res.status(400).json({ error: 'Shift date is required', code: 'MISSING_SHIFT_DATE' });

    // Validate date format
    if (typeof shift_date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(shift_date)) {
      return res.status(400).json({ error: 'shift_date must be in YYYY-MM-DD format', code: 'INVALID_DATE_FORMAT' });
    }

    const effectiveOfficerId = officer_id || req.user!.userId;
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(effectiveOfficerId) as any;
    const dar_number = nextDarNumber();

    const result = db.prepare(`
      INSERT INTO daily_activity_reports (dar_number, status, officer_id, officer_name,
        shift_date, shift_start, shift_end, property_id, property_name, post_assignment,
        calls_handled, incidents_created, citations_issued, patrols_completed,
        activities_narrative, notable_events, equipment_issues, safety_concerns, recommendations,
        created_at, updated_at)
      VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(dar_number, effectiveOfficerId, officer_name || user?.full_name || '',
      shift_date, shift_start || null, shift_end || null,
      property_id || null, property_name || null, post_assignment || null,
      JSON.stringify(calls_handled || []), JSON.stringify(incidents_created || []),
      JSON.stringify(citations_issued || []), JSON.stringify(patrols_completed || []),
      activities_narrative || null, notable_events || null, equipment_issues || null,
      safety_concerns || null, recommendations || null, now, now);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'create', 'dar', ?, ?, ?)`).run(req.user!.userId, result.lastInsertRowid, JSON.stringify({ dar_number }), now);

    res.status(201).json({ data: { id: result.lastInsertRowid, dar_number } });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Create DAR error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Create DAR error:', error);
    res.status(500).json({ error: 'Failed to create daily activity report', code: 'CREATE_DAR_ERROR' });
>>>>>>> origin/main
  }
});

// ─── PUT /:id ────────────────────────────────────────────
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }); return; }
    const existing = db.prepare('SELECT id FROM daily_activity_reports WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' }); return; }
    const now = localNow();
    const fields = ['activities_narrative', 'notable_events', 'equipment_issues',
      'safety_concerns', 'recommendations', 'post_assignment', 'shift_start', 'shift_end'];
    const jsonFields = ['calls_handled', 'incidents_created', 'citations_issued', 'patrols_completed'];

    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    }
    for (const f of jsonFields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(JSON.stringify(req.body[f])); }
    }
    params.push(id);
    db.prepare(`UPDATE daily_activity_reports SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Admin can override dar_number
    if (req.user?.role === 'admin' && req.body.dar_number) {
      db.prepare('UPDATE daily_activity_reports SET dar_number = ? WHERE id = ?').run(req.body.dar_number, id);
      auditLog(req, 'ADMIN_OVERRIDE', 'dar', id, `Admin God Mode: overrode dar_number to ${req.body.dar_number}`);
    }

    res.json({ data: { id } });
  } catch (error: any) { console.error('Update DAR error:', error); res.status(500).json({ error: 'Failed to update DAR', code: 'UPDATE_DAR_ERROR' }); }
});

// ─── PUT /:id/submit ────────────────────────────────────
router.put('/:id/submit', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }); return; }
    const existing = db.prepare('SELECT id, status FROM daily_activity_reports WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' }); return; }
    const now = localNow();
    db.prepare('UPDATE daily_activity_reports SET status = ?, submitted_at = ?, updated_at = ? WHERE id = ?')
      .run('submitted', now, now, id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'submit', 'dar', ?, '{}', ?)`).run(req.user!.userId, id, now);

    broadcastRecordUpdate({ type: 'dar_submitted', id });
    res.json({ data: { id, status: 'submitted' } });
  } catch (error: any) { console.error('Submit DAR error:', error); res.status(500).json({ error: 'Internal server error', code: 'DAR_SUBMIT_ERROR' }); }
});

// ─── PUT /:id/approve ───────────────────────────────────
router.put('/:id/approve', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;

    db.prepare(`UPDATE daily_activity_reports SET status = 'approved', reviewed_by = ?,
      reviewed_by_name = ?, reviewed_at = ?, review_notes = ?, updated_at = ? WHERE id = ?`)
      .run(req.user!.userId, user?.full_name || '', now, req.body.review_notes || null, now, req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'approve', 'dar', ?, '{}', ?)`).run(req.user!.userId, req.params.id, now);

    broadcastRecordUpdate({ type: 'dar_approved', id: parseInt(req.params.id) });
    res.json({ data: { id: parseInt(req.params.id), status: 'approved' } });
  } catch (error: any) { console.error('Approve DAR error:', error); res.status(500).json({ error: 'Internal server error', code: 'DAR_APPROVE_ERROR' }); }
});

// ─── PUT /:id/return ────────────────────────────────────
router.put('/:id/return', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;
    const { review_notes } = req.body;
    if (!review_notes) return res.status(400).json({ error: 'Review notes required when returning', code: 'MISSING_REVIEW_NOTES' });

    db.prepare(`UPDATE daily_activity_reports SET status = 'returned', reviewed_by = ?,
      reviewed_by_name = ?, reviewed_at = ?, review_notes = ?, updated_at = ? WHERE id = ?`)
      .run(req.user!.userId, user?.full_name || '', now, review_notes, now, req.params.id);

    broadcastRecordUpdate({ type: 'dar_returned', id: parseInt(req.params.id) });
    res.json({ data: { id: parseInt(req.params.id), status: 'returned' } });
  } catch (error: any) { console.error('Return DAR error:', error); res.status(500).json({ error: 'Internal server error', code: 'DAR_RETURN_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: DAR Completeness Scoring
// ════════════════════════════════════════════════════════════
router.get('/:id/completeness', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }); return; }

    const dar = db.prepare('SELECT * FROM daily_activity_reports WHERE id = ?').get(id) as any;
    if (!dar) return res.status(404).json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' });

    let score = 0;
    let maxScore = 0;
    const checks: { field: string; filled: boolean; weight: number }[] = [];

    const scoreField = (field: string, value: any, weight: number, minLength = 0) => {
      maxScore += weight;
      const filled = value != null && String(value).trim().length > minLength;
      if (filled) score += weight;
      checks.push({ field, filled, weight });
    };

    scoreField('officer_name', dar.officer_name, 10);
    scoreField('shift_date', dar.shift_date, 10);
    scoreField('shift_start', dar.shift_start, 8);
    scoreField('shift_end', dar.shift_end, 8);
    scoreField('property_name', dar.property_name, 5);
    scoreField('activities_narrative', dar.activities_narrative, 25, 20);
    scoreField('calls_handled', dar.calls_handled, 8, 2);
    scoreField('incidents_created', dar.incidents_created, 8, 2);
    scoreField('patrols_completed', dar.patrols_completed, 5, 2);
    scoreField('notable_events', dar.notable_events, 5, 5);
    scoreField('equipment_issues', dar.equipment_issues, 4);
    scoreField('safety_concerns', dar.safety_concerns, 4);

    const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    let rating: string;
    if (pct >= 90) rating = 'excellent';
    else if (pct >= 75) rating = 'good';
    else if (pct >= 50) rating = 'fair';
    else rating = 'incomplete';

    res.json({ dar_id: id, score: pct, rating, max_score: maxScore, earned_score: score, field_checks: checks });
  } catch (error: any) {
    console.error('DAR completeness error:', error);
    res.status(500).json({ error: 'Failed to calculate completeness', code: 'DAR_COMPLETENESS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Supervisor Review Workflow (pending -> reviewed -> approved)
// ════════════════════════════════════════════════════════════
router.put('/:id/review', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }); return; }
    const existing = db.prepare('SELECT id, status FROM daily_activity_reports WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' }); return; }
    if (existing.status !== 'submitted' && req.user?.role !== 'admin') {
      res.status(400).json({ error: 'DAR must be in submitted status to review', code: 'DAR_MUST_BE_SUBMITTED' });
      return;
    }
    if (req.user?.role === 'admin' && existing.status !== 'submitted') {
      auditLog(req, 'ADMIN_OVERRIDE', 'dar', id, `Admin God Mode: bypassed submitted-only review restriction (status: ${existing.status})`);
    }

    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;

    db.prepare(`UPDATE daily_activity_reports SET status = 'reviewed', reviewed_by = ?,
      reviewed_by_name = ?, reviewed_at = ?, review_notes = ?, updated_at = ? WHERE id = ?`)
      .run(req.user!.userId, user?.full_name || '', now, req.body.review_notes || null, now, id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'review', 'dar', ?, '{}', ?)`).run(req.user!.userId, id, now);

    broadcastRecordUpdate({ type: 'dar_reviewed', id });
    res.json({ data: { id, status: 'reviewed' } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error', code: 'DAR_REVIEW_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: DAR Templates
// ════════════════════════════════════════════════════════════
router.get('/templates/list', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { property_id } = req.query;

    let rows: any[];
    try {
      if (property_id) {
        rows = db.prepare(`
          SELECT * FROM dar_templates WHERE property_id = ? OR property_id IS NULL
          ORDER BY is_default DESC, name ASC LIMIT 100
        `).all(property_id);
      } else {
        rows = db.prepare('SELECT * FROM dar_templates ORDER BY is_default DESC, name ASC LIMIT 100').all();
      }
    } catch {
      rows = [];
    }
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to list templates', code: 'LIST_TEMPLATES_ERROR' });
  }
});

router.post('/templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { name, property_id, post_assignment, activities_narrative_template,
      notable_events_template, is_default } = req.body;
    if (!name) return res.status(400).json({ error: 'Template name required', code: 'TEMPLATE_NAME_REQUIRED' });

    try {
      db.prepare(`CREATE TABLE IF NOT EXISTS dar_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, property_id INTEGER, post_assignment TEXT,
        activities_narrative_template TEXT, notable_events_template TEXT,
        is_default INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT, updated_at TEXT
      )`);
    } catch { /* may already exist */ }

    const result = db.prepare(`
      INSERT INTO dar_templates (name, property_id, post_assignment, activities_narrative_template,
        notable_events_template, is_default, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, property_id || null, post_assignment || null,
      activities_narrative_template || null, notable_events_template || null,
      is_default ? 1 : 0, req.user!.userId, now, now);

    res.status(201).json({ data: { id: result.lastInsertRowid, name } });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create template', code: 'CREATE_TEMPLATE_ERROR' });
  }
});

router.delete('/templates/:templateId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const templateId = parseInt(req.params.templateId, 10);
    if (isNaN(templateId)) { res.status(400).json({ error: 'Invalid template ID' }); return; }
    try { db.prepare('DELETE FROM dar_templates WHERE id = ?').run(templateId); } catch { /* ok */ }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete template', code: 'DELETE_TEMPLATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 4: DAR Stats / Summary
// ════════════════════════════════════════════════════════════
router.get('/stats/summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date_from, date_to } = req.query;
    const from = date_from || localToday();
    const to = date_to || localToday();

    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ? GROUP BY status
    `).all(from, to) as any[];

    const totalDars = statusCounts.reduce((s: number, r: any) => s + r.count, 0);
    const statusMap: Record<string, number> = {};
    for (const r of statusCounts) statusMap[r.status] = r.count;

    const withNarrative = db.prepare(`
      SELECT COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ?
        AND activities_narrative IS NOT NULL AND LENGTH(activities_narrative) > 20
    `).get(from, to) as { count: number };

    const pendingReview = db.prepare(`
      SELECT COUNT(*) as count FROM daily_activity_reports
      WHERE status IN ('submitted', 'reviewed') AND shift_date >= ? AND shift_date <= ?
    `).get(from, to) as { count: number };

    const topOfficers = db.prepare(`
      SELECT officer_name, COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ?
      GROUP BY officer_id ORDER BY count DESC LIMIT 10
    `).all(from, to) as any[];

    res.json({
      total: totalDars, by_status: statusMap, pending_review: pendingReview.count,
      with_narrative: withNarrative.count,
      narrative_rate: totalDars > 0 ? Math.round((withNarrative.count / totalDars) * 100) : 0,
      top_officers: topOfficers, period: { from, to },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get DAR stats', code: 'DAR_STATS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: DAR Completeness Scoring
// ════════════════════════════════════════════════════════════
router.get('/:id/completeness', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }); return; }

    const dar = db.prepare('SELECT * FROM daily_activity_reports WHERE id = ?').get(id) as any;
    if (!dar) return res.status(404).json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' });

    let score = 0;
    let maxScore = 0;
    const checks: { field: string; filled: boolean; weight: number }[] = [];

    const scoreField = (field: string, value: any, weight: number, minLength = 0) => {
      maxScore += weight;
      const filled = value != null && String(value).trim().length > minLength;
      if (filled) score += weight;
      checks.push({ field, filled, weight });
    };

    scoreField('officer_name', dar.officer_name, 10);
    scoreField('shift_date', dar.shift_date, 10);
    scoreField('shift_start', dar.shift_start, 8);
    scoreField('shift_end', dar.shift_end, 8);
    scoreField('property_name', dar.property_name, 5);
    scoreField('activities_narrative', dar.activities_narrative, 25, 20);
    scoreField('calls_handled', dar.calls_handled, 8, 2);
    scoreField('incidents_created', dar.incidents_created, 8, 2);
    scoreField('patrols_completed', dar.patrols_completed, 5, 2);
    scoreField('notable_events', dar.notable_events, 5, 5);
    scoreField('equipment_issues', dar.equipment_issues, 4);
    scoreField('safety_concerns', dar.safety_concerns, 4);

    const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    let rating: string;
    if (pct >= 90) rating = 'excellent';
    else if (pct >= 75) rating = 'good';
    else if (pct >= 50) rating = 'fair';
    else rating = 'incomplete';

    res.json({ dar_id: id, score: pct, rating, max_score: maxScore, earned_score: score, field_checks: checks });
  } catch (error: any) {
    console.error('DAR completeness error:', error);
    res.status(500).json({ error: 'Failed to calculate completeness', code: 'DAR_COMPLETENESS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Supervisor Review Workflow (pending -> reviewed -> approved)
// ════════════════════════════════════════════════════════════
router.put('/:id/review', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }); return; }
    const existing = db.prepare('SELECT id, status FROM daily_activity_reports WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' }); return; }
    if (existing.status !== 'submitted' && req.user?.role !== 'admin') {
      res.status(400).json({ error: 'DAR must be in submitted status to review', code: 'DAR_MUST_BE_SUBMITTED' });
      return;
    }
    if (req.user?.role === 'admin' && existing.status !== 'submitted') {
      auditLog(req, 'ADMIN_OVERRIDE', 'dar', id, `Admin God Mode: bypassed submitted-only review restriction (status: ${existing.status})`);
    }

    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;

    db.prepare(`UPDATE daily_activity_reports SET status = 'reviewed', reviewed_by = ?,
      reviewed_by_name = ?, reviewed_at = ?, review_notes = ?, updated_at = ? WHERE id = ?`)
      .run(req.user!.userId, user?.full_name || '', now, req.body.review_notes || null, now, id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'review', 'dar', ?, '{}', ?)`).run(req.user!.userId, id, now);

    broadcastRecordUpdate({ type: 'dar_reviewed', id });
    res.json({ data: { id, status: 'reviewed' } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error', code: 'DAR_REVIEW_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: DAR Templates
// ════════════════════════════════════════════════════════════
router.get('/templates/list', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { property_id } = req.query;

    let rows: any[];
    try {
      if (property_id) {
        rows = db.prepare(`
          SELECT * FROM dar_templates WHERE property_id = ? OR property_id IS NULL
          ORDER BY is_default DESC, name ASC LIMIT 100
        `).all(property_id);
      } else {
        rows = db.prepare('SELECT * FROM dar_templates ORDER BY is_default DESC, name ASC LIMIT 100').all();
      }
    } catch {
      rows = [];
    }
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to list templates', code: 'LIST_TEMPLATES_ERROR' });
  }
});

router.post('/templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { name, property_id, post_assignment, activities_narrative_template,
      notable_events_template, is_default } = req.body;
    if (!name) return res.status(400).json({ error: 'Template name required', code: 'TEMPLATE_NAME_REQUIRED' });

    try {
      db.prepare(`CREATE TABLE IF NOT EXISTS dar_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, property_id INTEGER, post_assignment TEXT,
        activities_narrative_template TEXT, notable_events_template TEXT,
        is_default INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT, updated_at TEXT
      )`);
    } catch { /* may already exist */ }

    const result = db.prepare(`
      INSERT INTO dar_templates (name, property_id, post_assignment, activities_narrative_template,
        notable_events_template, is_default, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, property_id || null, post_assignment || null,
      activities_narrative_template || null, notable_events_template || null,
      is_default ? 1 : 0, req.user!.userId, now, now);

    res.status(201).json({ data: { id: result.lastInsertRowid, name } });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create template', code: 'CREATE_TEMPLATE_ERROR' });
  }
});

router.delete('/templates/:templateId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const templateId = parseInt(req.params.templateId, 10);
    if (isNaN(templateId)) { res.status(400).json({ error: 'Invalid template ID' }); return; }
    try { db.prepare('DELETE FROM dar_templates WHERE id = ?').run(templateId); } catch { /* ok */ }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete template', code: 'DELETE_TEMPLATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 4: DAR Stats / Summary
// ════════════════════════════════════════════════════════════
router.get('/stats/summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date_from, date_to } = req.query;
    const from = date_from || localToday();
    const to = date_to || localToday();

    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ? GROUP BY status
    `).all(from, to) as any[];

    const totalDars = statusCounts.reduce((s: number, r: any) => s + r.count, 0);
    const statusMap: Record<string, number> = {};
    for (const r of statusCounts) statusMap[r.status] = r.count;

    const withNarrative = db.prepare(`
      SELECT COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ?
        AND activities_narrative IS NOT NULL AND LENGTH(activities_narrative) > 20
    `).get(from, to) as { count: number };

    const pendingReview = db.prepare(`
      SELECT COUNT(*) as count FROM daily_activity_reports
      WHERE status IN ('submitted', 'reviewed') AND shift_date >= ? AND shift_date <= ?
    `).get(from, to) as { count: number };

    const topOfficers = db.prepare(`
      SELECT officer_name, COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ?
      GROUP BY officer_id ORDER BY count DESC LIMIT 10
    `).all(from, to) as any[];

    res.json({
      total: totalDars, by_status: statusMap, pending_review: pendingReview.count,
      with_narrative: withNarrative.count,
      narrative_rate: totalDars > 0 ? Math.round((withNarrative.count / totalDars) * 100) : 0,
      top_officers: topOfficers, period: { from, to },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get DAR stats', code: 'DAR_STATS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: DAR Completeness Scoring
// ════════════════════════════════════════════════════════════
router.get('/:id/completeness', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }); return; }

    const dar = db.prepare('SELECT * FROM daily_activity_reports WHERE id = ?').get(id) as any;
    if (!dar) return res.status(404).json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' });

    let score = 0;
    let maxScore = 0;
    const checks: { field: string; filled: boolean; weight: number }[] = [];

    const scoreField = (field: string, value: any, weight: number, minLength = 0) => {
      maxScore += weight;
      const filled = value != null && String(value).trim().length > minLength;
      if (filled) score += weight;
      checks.push({ field, filled, weight });
    };

    scoreField('officer_name', dar.officer_name, 10);
    scoreField('shift_date', dar.shift_date, 10);
    scoreField('shift_start', dar.shift_start, 8);
    scoreField('shift_end', dar.shift_end, 8);
    scoreField('property_name', dar.property_name, 5);
    scoreField('activities_narrative', dar.activities_narrative, 25, 20);
    scoreField('calls_handled', dar.calls_handled, 8, 2);
    scoreField('incidents_created', dar.incidents_created, 8, 2);
    scoreField('patrols_completed', dar.patrols_completed, 5, 2);
    scoreField('notable_events', dar.notable_events, 5, 5);
    scoreField('equipment_issues', dar.equipment_issues, 4);
    scoreField('safety_concerns', dar.safety_concerns, 4);

    const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    let rating: string;
    if (pct >= 90) rating = 'excellent';
    else if (pct >= 75) rating = 'good';
    else if (pct >= 50) rating = 'fair';
    else rating = 'incomplete';

    res.json({ dar_id: id, score: pct, rating, max_score: maxScore, earned_score: score, field_checks: checks });
  } catch (error: any) {
    console.error('DAR completeness error:', error);
    res.status(500).json({ error: 'Failed to calculate completeness', code: 'DAR_COMPLETENESS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Supervisor Review Workflow (pending -> reviewed -> approved)
// ════════════════════════════════════════════════════════════
router.put('/:id/review', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }); return; }
    const existing = db.prepare('SELECT id, status FROM daily_activity_reports WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' }); return; }
    if (existing.status !== 'submitted' && req.user?.role !== 'admin') {
      res.status(400).json({ error: 'DAR must be in submitted status to review', code: 'DAR_MUST_BE_SUBMITTED' });
      return;
    }
    if (req.user?.role === 'admin' && existing.status !== 'submitted') {
      auditLog(req, 'ADMIN_OVERRIDE', 'dar', id, `Admin God Mode: bypassed submitted-only review restriction (status: ${existing.status})`);
    }

    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;

    db.prepare(`UPDATE daily_activity_reports SET status = 'reviewed', reviewed_by = ?,
      reviewed_by_name = ?, reviewed_at = ?, review_notes = ?, updated_at = ? WHERE id = ?`)
      .run(req.user!.userId, user?.full_name || '', now, req.body.review_notes || null, now, id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'review', 'dar', ?, '{}', ?)`).run(req.user!.userId, id, now);

    broadcastRecordUpdate({ type: 'dar_reviewed', id });
    res.json({ data: { id, status: 'reviewed' } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error', code: 'DAR_REVIEW_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: DAR Templates
// ════════════════════════════════════════════════════════════
router.get('/templates/list', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { property_id } = req.query;

    let rows: any[];
    try {
      if (property_id) {
        rows = db.prepare(`
          SELECT * FROM dar_templates WHERE property_id = ? OR property_id IS NULL
          ORDER BY is_default DESC, name ASC LIMIT 100
        `).all(property_id);
      } else {
        rows = db.prepare('SELECT * FROM dar_templates ORDER BY is_default DESC, name ASC LIMIT 100').all();
      }
    } catch {
      rows = [];
    }
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to list templates', code: 'LIST_TEMPLATES_ERROR' });
  }
});

router.post('/templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { name, property_id, post_assignment, activities_narrative_template,
      notable_events_template, is_default } = req.body;
    if (!name) return res.status(400).json({ error: 'Template name required', code: 'TEMPLATE_NAME_REQUIRED' });

    try {
      db.prepare(`CREATE TABLE IF NOT EXISTS dar_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, property_id INTEGER, post_assignment TEXT,
        activities_narrative_template TEXT, notable_events_template TEXT,
        is_default INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT, updated_at TEXT
      )`);
    } catch { /* may already exist */ }

    const result = db.prepare(`
      INSERT INTO dar_templates (name, property_id, post_assignment, activities_narrative_template,
        notable_events_template, is_default, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, property_id || null, post_assignment || null,
      activities_narrative_template || null, notable_events_template || null,
      is_default ? 1 : 0, req.user!.userId, now, now);

    res.status(201).json({ data: { id: result.lastInsertRowid, name } });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create template', code: 'CREATE_TEMPLATE_ERROR' });
  }
});

router.delete('/templates/:templateId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const templateId = parseInt(req.params.templateId, 10);
    if (isNaN(templateId)) { res.status(400).json({ error: 'Invalid template ID' }); return; }
    try { db.prepare('DELETE FROM dar_templates WHERE id = ?').run(templateId); } catch { /* ok */ }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete template', code: 'DELETE_TEMPLATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 4: DAR Stats / Summary
// ════════════════════════════════════════════════════════════
router.get('/stats/summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date_from, date_to } = req.query;
    const from = date_from || localToday();
    const to = date_to || localToday();

    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ? GROUP BY status
    `).all(from, to) as any[];

    const totalDars = statusCounts.reduce((s: number, r: any) => s + r.count, 0);
    const statusMap: Record<string, number> = {};
    for (const r of statusCounts) statusMap[r.status] = r.count;

    const withNarrative = db.prepare(`
      SELECT COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ?
        AND activities_narrative IS NOT NULL AND LENGTH(activities_narrative) > 20
    `).get(from, to) as { count: number };

    const pendingReview = db.prepare(`
      SELECT COUNT(*) as count FROM daily_activity_reports
      WHERE status IN ('submitted', 'reviewed') AND shift_date >= ? AND shift_date <= ?
    `).get(from, to) as { count: number };

    const topOfficers = db.prepare(`
      SELECT officer_name, COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ?
      GROUP BY officer_id ORDER BY count DESC LIMIT 10
    `).all(from, to) as any[];

    res.json({
      total: totalDars, by_status: statusMap, pending_review: pendingReview.count,
      with_narrative: withNarrative.count,
      narrative_rate: totalDars > 0 ? Math.round((withNarrative.count / totalDars) * 100) : 0,
      top_officers: topOfficers, period: { from, to },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get DAR stats', code: 'DAR_STATS_ERROR' });
  }
});

// ─── CSV Export ──────────────────────────────────────────
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM daily_activity_reports ORDER BY shift_date DESC, created_at DESC').all() as any[];
    sendCsv(res, 'daily_activity_reports_export.csv', [
      { key: 'id', header: 'ID' },
      { key: 'dar_number', header: 'DAR Number' },
      { key: 'status', header: 'Status' },
      { key: 'officer_name', header: 'Officer' },
      { key: 'shift_date', header: 'Shift Date' },
      { key: 'shift_start', header: 'Shift Start' },
      { key: 'shift_end', header: 'Shift End' },
      { key: 'property_name', header: 'Property' },
      { key: 'post_assignment', header: 'Post Assignment' },
      { key: 'calls_handled', header: 'Calls Handled' },
      { key: 'incidents_created', header: 'Incidents Created' },
      { key: 'citations_issued', header: 'Citations Issued' },
      { key: 'patrols_completed', header: 'Patrols Completed' },
      { key: 'activities_narrative', header: 'Narrative' },
      { key: 'notable_events', header: 'Notable Events' },
      { key: 'equipment_issues', header: 'Equipment Issues' },
      { key: 'safety_concerns', header: 'Safety Concerns' },
      { key: 'created_at', header: 'Created' },
    ], rows);
  } catch (error: any) {
    console.error('Export DARs error:', error);
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_FAILED' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: DAR Completeness Scoring
// ════════════════════════════════════════════════════════════
router.get('/:id/completeness', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }); return; }

    const dar = db.prepare('SELECT * FROM daily_activity_reports WHERE id = ?').get(id) as any;
    if (!dar) return res.status(404).json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' });

    let score = 0;
    let maxScore = 0;
    const checks: { field: string; filled: boolean; weight: number }[] = [];

    const scoreField = (field: string, value: any, weight: number, minLength = 0) => {
      maxScore += weight;
      const filled = value != null && String(value).trim().length > minLength;
      if (filled) score += weight;
      checks.push({ field, filled, weight });
    };

    scoreField('officer_name', dar.officer_name, 10);
    scoreField('shift_date', dar.shift_date, 10);
    scoreField('shift_start', dar.shift_start, 8);
    scoreField('shift_end', dar.shift_end, 8);
    scoreField('property_name', dar.property_name, 5);
    scoreField('activities_narrative', dar.activities_narrative, 25, 20);
    scoreField('calls_handled', dar.calls_handled, 8, 2);
    scoreField('incidents_created', dar.incidents_created, 8, 2);
    scoreField('patrols_completed', dar.patrols_completed, 5, 2);
    scoreField('notable_events', dar.notable_events, 5, 5);
    scoreField('equipment_issues', dar.equipment_issues, 4);
    scoreField('safety_concerns', dar.safety_concerns, 4);

    const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    let rating: string;
    if (pct >= 90) rating = 'excellent';
    else if (pct >= 75) rating = 'good';
    else if (pct >= 50) rating = 'fair';
    else rating = 'incomplete';

    res.json({ dar_id: id, score: pct, rating, max_score: maxScore, earned_score: score, field_checks: checks });
  } catch (error: any) {
    console.error('DAR completeness error:', error);
    res.status(500).json({ error: 'Failed to calculate completeness', code: 'DAR_COMPLETENESS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Supervisor Review Workflow (pending -> reviewed -> approved)
// ════════════════════════════════════════════════════════════
router.put('/:id/review', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }); return; }
    const existing = db.prepare('SELECT id, status FROM daily_activity_reports WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' }); return; }
    if (existing.status !== 'submitted' && req.user?.role !== 'admin') {
      res.status(400).json({ error: 'DAR must be in submitted status to review', code: 'DAR_MUST_BE_SUBMITTED' });
      return;
    }
    if (req.user?.role === 'admin' && existing.status !== 'submitted') {
      auditLog(req, 'ADMIN_OVERRIDE', 'dar', id, `Admin God Mode: bypassed submitted-only review restriction (status: ${existing.status})`);
    }

    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;

    db.prepare(`UPDATE daily_activity_reports SET status = 'reviewed', reviewed_by = ?,
      reviewed_by_name = ?, reviewed_at = ?, review_notes = ?, updated_at = ? WHERE id = ?`)
      .run(req.user!.userId, user?.full_name || '', now, req.body.review_notes || null, now, id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'review', 'dar', ?, '{}', ?)`).run(req.user!.userId, id, now);

    broadcastRecordUpdate({ type: 'dar_reviewed', id });
    res.json({ data: { id, status: 'reviewed' } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error', code: 'DAR_REVIEW_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: DAR Templates
// ════════════════════════════════════════════════════════════
router.get('/templates/list', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { property_id } = req.query;

    let rows: any[];
    try {
      if (property_id) {
        rows = db.prepare(`
          SELECT * FROM dar_templates WHERE property_id = ? OR property_id IS NULL
          ORDER BY is_default DESC, name ASC LIMIT 100
        `).all(property_id);
      } else {
        rows = db.prepare('SELECT * FROM dar_templates ORDER BY is_default DESC, name ASC LIMIT 100').all();
      }
    } catch {
      rows = [];
    }
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to list templates', code: 'LIST_TEMPLATES_ERROR' });
  }
});

router.post('/templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { name, property_id, post_assignment, activities_narrative_template,
      notable_events_template, is_default } = req.body;
    if (!name) return res.status(400).json({ error: 'Template name required', code: 'TEMPLATE_NAME_REQUIRED' });

    try {
      db.prepare(`CREATE TABLE IF NOT EXISTS dar_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, property_id INTEGER, post_assignment TEXT,
        activities_narrative_template TEXT, notable_events_template TEXT,
        is_default INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT, updated_at TEXT
      )`);
    } catch { /* may already exist */ }

    const result = db.prepare(`
      INSERT INTO dar_templates (name, property_id, post_assignment, activities_narrative_template,
        notable_events_template, is_default, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, property_id || null, post_assignment || null,
      activities_narrative_template || null, notable_events_template || null,
      is_default ? 1 : 0, req.user!.userId, now, now);

    res.status(201).json({ data: { id: result.lastInsertRowid, name } });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create template', code: 'CREATE_TEMPLATE_ERROR' });
  }
});

router.delete('/templates/:templateId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const templateId = parseInt(req.params.templateId, 10);
    if (isNaN(templateId)) { res.status(400).json({ error: 'Invalid template ID' }); return; }
    try { db.prepare('DELETE FROM dar_templates WHERE id = ?').run(templateId); } catch { /* ok */ }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete template', code: 'DELETE_TEMPLATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 4: DAR Stats / Summary
// ════════════════════════════════════════════════════════════
router.get('/stats/summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date_from, date_to } = req.query;
    const from = date_from || localToday();
    const to = date_to || localToday();

    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ? GROUP BY status
    `).all(from, to) as any[];

    const totalDars = statusCounts.reduce((s: number, r: any) => s + r.count, 0);
    const statusMap: Record<string, number> = {};
    for (const r of statusCounts) statusMap[r.status] = r.count;

    const withNarrative = db.prepare(`
      SELECT COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ?
        AND activities_narrative IS NOT NULL AND LENGTH(activities_narrative) > 20
    `).get(from, to) as { count: number };

    const pendingReview = db.prepare(`
      SELECT COUNT(*) as count FROM daily_activity_reports
      WHERE status IN ('submitted', 'reviewed') AND shift_date >= ? AND shift_date <= ?
    `).get(from, to) as { count: number };

    const topOfficers = db.prepare(`
      SELECT officer_name, COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ?
      GROUP BY officer_id ORDER BY count DESC LIMIT 10
    `).all(from, to) as any[];

    res.json({
      total: totalDars, by_status: statusMap, pending_review: pendingReview.count,
      with_narrative: withNarrative.count,
      narrative_rate: totalDars > 0 ? Math.round((withNarrative.count / totalDars) * 100) : 0,
      top_officers: topOfficers, period: { from, to },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get DAR stats', code: 'DAR_STATS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: DAR Completeness Scoring
// ════════════════════════════════════════════════════════════
router.get('/:id/completeness', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }); return; }

    const dar = db.prepare('SELECT * FROM daily_activity_reports WHERE id = ?').get(id) as any;
    if (!dar) return res.status(404).json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' });

    let score = 0;
    let maxScore = 0;
    const checks: { field: string; filled: boolean; weight: number }[] = [];

    const scoreField = (field: string, value: any, weight: number, minLength = 0) => {
      maxScore += weight;
      const filled = value != null && String(value).trim().length > minLength;
      if (filled) score += weight;
      checks.push({ field, filled, weight });
    };

    scoreField('officer_name', dar.officer_name, 10);
    scoreField('shift_date', dar.shift_date, 10);
    scoreField('shift_start', dar.shift_start, 8);
    scoreField('shift_end', dar.shift_end, 8);
    scoreField('property_name', dar.property_name, 5);
    scoreField('activities_narrative', dar.activities_narrative, 25, 20);
    scoreField('calls_handled', dar.calls_handled, 8, 2);
    scoreField('incidents_created', dar.incidents_created, 8, 2);
    scoreField('patrols_completed', dar.patrols_completed, 5, 2);
    scoreField('notable_events', dar.notable_events, 5, 5);
    scoreField('equipment_issues', dar.equipment_issues, 4);
    scoreField('safety_concerns', dar.safety_concerns, 4);

    const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    let rating: string;
    if (pct >= 90) rating = 'excellent';
    else if (pct >= 75) rating = 'good';
    else if (pct >= 50) rating = 'fair';
    else rating = 'incomplete';

    res.json({ dar_id: id, score: pct, rating, max_score: maxScore, earned_score: score, field_checks: checks });
  } catch (error: any) {
    console.error('DAR completeness error:', error);
    res.status(500).json({ error: 'Failed to calculate completeness', code: 'DAR_COMPLETENESS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Supervisor Review Workflow (pending -> reviewed -> approved)
// ════════════════════════════════════════════════════════════
router.put('/:id/review', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }); return; }
    const existing = db.prepare('SELECT id, status FROM daily_activity_reports WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' }); return; }
    if (existing.status !== 'submitted' && req.user?.role !== 'admin') {
      res.status(400).json({ error: 'DAR must be in submitted status to review', code: 'DAR_MUST_BE_SUBMITTED' });
      return;
    }
    if (req.user?.role === 'admin' && existing.status !== 'submitted') {
      auditLog(req, 'ADMIN_OVERRIDE', 'dar', id, `Admin God Mode: bypassed submitted-only review restriction (status: ${existing.status})`);
    }

    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;

    db.prepare(`UPDATE daily_activity_reports SET status = 'reviewed', reviewed_by = ?,
      reviewed_by_name = ?, reviewed_at = ?, review_notes = ?, updated_at = ? WHERE id = ?`)
      .run(req.user!.userId, user?.full_name || '', now, req.body.review_notes || null, now, id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'review', 'dar', ?, '{}', ?)`).run(req.user!.userId, id, now);

    broadcastRecordUpdate({ type: 'dar_reviewed', id });
    res.json({ data: { id, status: 'reviewed' } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error', code: 'DAR_REVIEW_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: DAR Templates
// ════════════════════════════════════════════════════════════
router.get('/templates/list', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { property_id } = req.query;

    let rows: any[];
    try {
      if (property_id) {
        rows = db.prepare(`
          SELECT * FROM dar_templates WHERE property_id = ? OR property_id IS NULL
          ORDER BY is_default DESC, name ASC LIMIT 100
        `).all(property_id);
      } else {
        rows = db.prepare('SELECT * FROM dar_templates ORDER BY is_default DESC, name ASC LIMIT 100').all();
      }
    } catch {
      rows = [];
    }
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to list templates', code: 'LIST_TEMPLATES_ERROR' });
  }
});

router.post('/templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { name, property_id, post_assignment, activities_narrative_template,
      notable_events_template, is_default } = req.body;
    if (!name) return res.status(400).json({ error: 'Template name required', code: 'TEMPLATE_NAME_REQUIRED' });

    try {
      db.prepare(`CREATE TABLE IF NOT EXISTS dar_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, property_id INTEGER, post_assignment TEXT,
        activities_narrative_template TEXT, notable_events_template TEXT,
        is_default INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT, updated_at TEXT
      )`);
    } catch { /* may already exist */ }

    const result = db.prepare(`
      INSERT INTO dar_templates (name, property_id, post_assignment, activities_narrative_template,
        notable_events_template, is_default, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, property_id || null, post_assignment || null,
      activities_narrative_template || null, notable_events_template || null,
      is_default ? 1 : 0, req.user!.userId, now, now);

    res.status(201).json({ data: { id: result.lastInsertRowid, name } });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create template', code: 'CREATE_TEMPLATE_ERROR' });
  }
});

router.delete('/templates/:templateId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const templateId = parseInt(req.params.templateId, 10);
    if (isNaN(templateId)) { res.status(400).json({ error: 'Invalid template ID' }); return; }
    try { db.prepare('DELETE FROM dar_templates WHERE id = ?').run(templateId); } catch { /* ok */ }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete template', code: 'DELETE_TEMPLATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 4: DAR Stats / Summary
// ════════════════════════════════════════════════════════════
router.get('/stats/summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date_from, date_to } = req.query;
    const from = date_from || localToday();
    const to = date_to || localToday();

    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ? GROUP BY status
    `).all(from, to) as any[];

    const totalDars = statusCounts.reduce((s: number, r: any) => s + r.count, 0);
    const statusMap: Record<string, number> = {};
    for (const r of statusCounts) statusMap[r.status] = r.count;

    const withNarrative = db.prepare(`
      SELECT COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ?
        AND activities_narrative IS NOT NULL AND LENGTH(activities_narrative) > 20
    `).get(from, to) as { count: number };

    const pendingReview = db.prepare(`
      SELECT COUNT(*) as count FROM daily_activity_reports
      WHERE status IN ('submitted', 'reviewed') AND shift_date >= ? AND shift_date <= ?
    `).get(from, to) as { count: number };

    const topOfficers = db.prepare(`
      SELECT officer_name, COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ?
      GROUP BY officer_id ORDER BY count DESC LIMIT 10
    `).all(from, to) as any[];

    res.json({
      total: totalDars, by_status: statusMap, pending_review: pendingReview.count,
      with_narrative: withNarrative.count,
      narrative_rate: totalDars > 0 ? Math.round((withNarrative.count / totalDars) * 100) : 0,
      top_officers: topOfficers, period: { from, to },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get DAR stats', code: 'DAR_STATS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: DAR Completeness Scoring
// ════════════════════════════════════════════════════════════
router.get('/:id/completeness', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }); return; }

    const dar = db.prepare('SELECT * FROM daily_activity_reports WHERE id = ?').get(id) as any;
    if (!dar) return res.status(404).json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' });

    let score = 0;
    let maxScore = 0;
    const checks: { field: string; filled: boolean; weight: number }[] = [];

    const scoreField = (field: string, value: any, weight: number, minLength = 0) => {
      maxScore += weight;
      const filled = value != null && String(value).trim().length > minLength;
      if (filled) score += weight;
      checks.push({ field, filled, weight });
    };

    scoreField('officer_name', dar.officer_name, 10);
    scoreField('shift_date', dar.shift_date, 10);
    scoreField('shift_start', dar.shift_start, 8);
    scoreField('shift_end', dar.shift_end, 8);
    scoreField('property_name', dar.property_name, 5);
    scoreField('activities_narrative', dar.activities_narrative, 25, 20);
    scoreField('calls_handled', dar.calls_handled, 8, 2);
    scoreField('incidents_created', dar.incidents_created, 8, 2);
    scoreField('patrols_completed', dar.patrols_completed, 5, 2);
    scoreField('notable_events', dar.notable_events, 5, 5);
    scoreField('equipment_issues', dar.equipment_issues, 4);
    scoreField('safety_concerns', dar.safety_concerns, 4);

    const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    let rating: string;
    if (pct >= 90) rating = 'excellent';
    else if (pct >= 75) rating = 'good';
    else if (pct >= 50) rating = 'fair';
    else rating = 'incomplete';

    res.json({ dar_id: id, score: pct, rating, max_score: maxScore, earned_score: score, field_checks: checks });
  } catch (error: any) {
    console.error('DAR completeness error:', error);
    res.status(500).json({ error: 'Failed to calculate completeness', code: 'DAR_COMPLETENESS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Supervisor Review Workflow (pending -> reviewed -> approved)
// ════════════════════════════════════════════════════════════
router.put('/:id/review', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }); return; }
    const existing = db.prepare('SELECT id, status FROM daily_activity_reports WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' }); return; }
    if (existing.status !== 'submitted') {
      res.status(400).json({ error: 'DAR must be in submitted status to review', code: 'DAR_MUST_BE_SUBMITTED' });
      return;
    }

    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;

    db.prepare(`UPDATE daily_activity_reports SET status = 'reviewed', reviewed_by = ?,
      reviewed_by_name = ?, reviewed_at = ?, review_notes = ?, updated_at = ? WHERE id = ?`)
      .run(req.user!.userId, user?.full_name || '', now, req.body.review_notes || null, now, id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'review', 'dar', ?, '{}', ?)`).run(req.user!.userId, id, now);

    broadcastRecordUpdate({ type: 'dar_reviewed', id });
    res.json({ data: { id, status: 'reviewed' } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error', code: 'DAR_REVIEW_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: DAR Templates
// ════════════════════════════════════════════════════════════
router.get('/templates/list', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { property_id } = req.query;

    let rows: any[];
    try {
      if (property_id) {
        rows = db.prepare(`
          SELECT * FROM dar_templates WHERE property_id = ? OR property_id IS NULL
          ORDER BY is_default DESC, name ASC LIMIT 100
        `).all(property_id);
      } else {
        rows = db.prepare('SELECT * FROM dar_templates ORDER BY is_default DESC, name ASC LIMIT 100').all();
      }
    } catch {
      rows = [];
    }
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to list templates', code: 'LIST_TEMPLATES_ERROR' });
  }
});

router.post('/templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { name, property_id, post_assignment, activities_narrative_template,
      notable_events_template, is_default } = req.body;
    if (!name) return res.status(400).json({ error: 'Template name required', code: 'TEMPLATE_NAME_REQUIRED' });

    try {
      db.prepare(`CREATE TABLE IF NOT EXISTS dar_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, property_id INTEGER, post_assignment TEXT,
        activities_narrative_template TEXT, notable_events_template TEXT,
        is_default INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT, updated_at TEXT
      )`);
    } catch { /* may already exist */ }

    const result = db.prepare(`
      INSERT INTO dar_templates (name, property_id, post_assignment, activities_narrative_template,
        notable_events_template, is_default, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, property_id || null, post_assignment || null,
      activities_narrative_template || null, notable_events_template || null,
      is_default ? 1 : 0, req.user!.userId, now, now);

    res.status(201).json({ data: { id: result.lastInsertRowid, name } });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create template', code: 'CREATE_TEMPLATE_ERROR' });
  }
});

router.delete('/templates/:templateId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const templateId = parseInt(req.params.templateId, 10);
    if (isNaN(templateId)) { res.status(400).json({ error: 'Invalid template ID' }); return; }
    try { db.prepare('DELETE FROM dar_templates WHERE id = ?').run(templateId); } catch { /* ok */ }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete template', code: 'DELETE_TEMPLATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 4: DAR Stats / Summary
// ════════════════════════════════════════════════════════════
router.get('/stats/summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date_from, date_to } = req.query;
    const from = date_from || localToday();
    const to = date_to || localToday();

    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ? GROUP BY status
    `).all(from, to) as any[];

    const totalDars = statusCounts.reduce((s: number, r: any) => s + r.count, 0);
    const statusMap: Record<string, number> = {};
    for (const r of statusCounts) statusMap[r.status] = r.count;

    const withNarrative = db.prepare(`
      SELECT COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ?
        AND activities_narrative IS NOT NULL AND LENGTH(activities_narrative) > 20
    `).get(from, to) as { count: number };

    const pendingReview = db.prepare(`
      SELECT COUNT(*) as count FROM daily_activity_reports
      WHERE status IN ('submitted', 'reviewed') AND shift_date >= ? AND shift_date <= ?
    `).get(from, to) as { count: number };

    const topOfficers = db.prepare(`
      SELECT officer_name, COUNT(*) as count FROM daily_activity_reports
      WHERE shift_date >= ? AND shift_date <= ?
      GROUP BY officer_id ORDER BY count DESC LIMIT 10
    `).all(from, to) as any[];

    res.json({
      total: totalDars, by_status: statusMap, pending_review: pendingReview.count,
      with_narrative: withNarrative.count,
      narrative_rate: totalDars > 0 ? Math.round((withNarrative.count / totalDars) * 100) : 0,
      top_officers: topOfficers, period: { from, to },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get DAR stats', code: 'DAR_STATS_ERROR' });
  }
});

export default router;
