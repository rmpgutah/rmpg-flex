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
  const seq = (isNaN(parsed) ? 0 : parsed) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ─── GET / ───────────────────────────────────────────────
router.get('/', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
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

    const total = (db.prepare(`SELECT COUNT(*) as count FROM daily_activity_reports d ${where}`).get(...params) as any)?.count || 0;
    const rows = db.prepare(`
      SELECT d.*, u.full_name as reviewer_name
      FROM daily_activity_reports d
      LEFT JOIN users u ON d.reviewed_by = u.id
      ${where}
      ORDER BY d.shift_date DESC, d.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    console.error('Get DARs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:id ────────────────────────────────────────────
router.get('/:id', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM daily_activity_reports WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'DAR not found' });
    res.json({ data: row });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── POST /auto-populate ────────────────────────────────
// Fetches shift data for an officer on a given date
router.post('/auto-populate', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, shift_date } = req.body;
    if (!officer_id || !shift_date) return res.status(400).json({ error: 'Officer ID and shift date required' });

    // Get officer info
    const officer = db.prepare('SELECT full_name FROM users WHERE id = ?').get(officer_id) as any;

    // Get calls handled that day by this officer's units
    const calls = db.prepare(`
      SELECT id, call_number, incident_type, created_at, disposition, status
      FROM calls_for_service
      WHERE DATE(created_at) = ? AND (assigned_unit_ids LIKE ? OR dispatcher_id = ?)
      ORDER BY created_at
    `).all(shift_date, `%${officer_id}%`, officer_id) as any[];

    // Get incidents created
    const incidents = db.prepare(`
      SELECT id, incident_number, incident_type FROM incidents
      WHERE DATE(created_at) = ? AND officer_id = ?
    `).all(shift_date, officer_id) as any[];

    // Get citations issued
    const citations = db.prepare(`
      SELECT id, citation_number, type FROM citations
      WHERE violation_date = ? AND issuing_officer_id = ?
    `).all(shift_date, officer_id) as any[];

    // Get patrol scans
    const patrols = db.prepare(`
      SELECT ps.id, pc.name as checkpoint, ps.scanned_at, ps.status
      FROM patrol_scans ps
      JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      WHERE DATE(ps.scanned_at) = ? AND ps.officer_id = ?
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
        SELECT id, subject_first_name, subject_last_name, location, contact_reason
        FROM field_interviews
        WHERE DATE(created_at) = ? AND officer_id = ?
      `).all(shift_date, officer_id);
    } catch { /* table may not exist */ }

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
    console.error('Auto-populate DAR error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST / ──────────────────────────────────────────────
router.post('/', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { shift_date, officer_id, officer_name, shift_start, shift_end,
      property_id, property_name, post_assignment,
      calls_handled, incidents_created, citations_issued, patrols_completed,
      activities_narrative, notable_events, equipment_issues, safety_concerns, recommendations } = req.body;
    if (!shift_date) return res.status(400).json({ error: 'Shift date is required' });

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

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'create', 'dar', ?, ?, ?, ?)`).run(req.user!.userId, result.lastInsertRowid, JSON.stringify({ dar_number }), req.ip || 'unknown', now);

    res.status(201).json({ data: { id: result.lastInsertRowid, dar_number } });
  } catch (error: any) {
    console.error('Create DAR error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id ────────────────────────────────────────────
router.put('/:id', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
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
    params.push(req.params.id);
    db.prepare(`UPDATE daily_activity_reports SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ data: { id: parseInt(req.params.id as string) } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── PUT /:id/submit ────────────────────────────────────
router.put('/:id/submit', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    db.prepare('UPDATE daily_activity_reports SET status = ?, submitted_at = ?, updated_at = ? WHERE id = ?')
      .run('submitted', now, now, req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'submit', 'dar', ?, '{}', ?, ?)`).run(req.user!.userId, req.params.id, req.ip || 'unknown', now);

    res.json({ data: { id: parseInt(req.params.id as string), status: 'submitted' } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── PUT /:id/approve ───────────────────────────────────
router.put('/:id/approve', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;

    db.prepare(`UPDATE daily_activity_reports SET status = 'approved', reviewed_by = ?,
      reviewed_by_name = ?, reviewed_at = ?, review_notes = ?, updated_at = ? WHERE id = ?`)
      .run(req.user!.userId, user?.full_name || '', now, req.body.review_notes || null, now, req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'approve', 'dar', ?, '{}', ?, ?)`).run(req.user!.userId, req.params.id, req.ip || 'unknown', now);

    res.json({ data: { id: parseInt(req.params.id as string), status: 'approved' } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── PUT /:id/return ────────────────────────────────────
router.put('/:id/return', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;
    const { review_notes } = req.body;
    if (!review_notes) return res.status(400).json({ error: 'Review notes required when returning' });

    db.prepare(`UPDATE daily_activity_reports SET status = 'returned', reviewed_by = ?,
      reviewed_by_name = ?, reviewed_at = ?, review_notes = ?, updated_at = ? WHERE id = ?`)
      .run(req.user!.userId, user?.full_name || '', now, review_notes, now, req.params.id);

    res.json({ data: { id: parseInt(req.params.id as string), status: 'returned' } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
