// ============================================================
// RMPG Flex — Case Management API Routes
// ============================================================
// Investigative case tracking with solvability scoring,
// investigator assignment, case notes, and record linkage.
// Auto-generates case numbers in CASE-YYYY-NNNN format.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastRecordUpdate } from '../utils/websocket';
import { localNow, localToday } from '../utils/timeUtils';
import { generateCaseNumber } from '../utils/caseNumbers';

const router = Router();
router.use(authenticateToken);

// ─── GET /stats ──────────────────────────────────────────
router.get('/stats', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM cases WHERE archived_at IS NULL GROUP BY status
    `).all() as any[];
    const typeCounts = db.prepare(`
      SELECT case_type, COUNT(*) as count FROM cases WHERE archived_at IS NULL GROUP BY case_type
    `).all() as any[];
    const avgSolvability = db.prepare(`
      SELECT ROUND(AVG(solvability_score), 1) as avg FROM cases WHERE archived_at IS NULL AND status NOT LIKE 'closed_%'
    `).get() as any;

    res.set('Cache-Control', 'private, max-age=60');
    res.json({
      data: {
        by_status: Object.fromEntries(statusCounts.map(r => [r.status, r.count])),
        by_type: Object.fromEntries(typeCounts.map(r => [r.case_type, r.count])),
        total: statusCounts.reduce((a: number, b: any) => a + b.count, 0),
        avg_solvability: avgSolvability?.avg || 0,
      },
    });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Get case stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Get case stats error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'STATS_ERROR' });
>>>>>>> origin/main
  }
});

// ─── POST /migrate-json-to-junctions — Admin only ────────
router.post('/migrate-json-to-junctions', requireRole('admin'), (req: Request, res: Response) => {
  try {
    ensureCaseTables();
    const db = getDb();
    const cases = db.prepare('SELECT id, linked_calls, linked_incidents, linked_persons FROM cases').all() as any[];
    let migrated = 0;
    const now = localNow();
    for (const c of cases) {
      // Migrate linked_calls
      try {
        const calls = JSON.parse(c.linked_calls || '[]');
        for (const callId of calls) {
          if (typeof callId === 'number') {
            db.prepare('INSERT OR IGNORE INTO case_calls (case_id, call_id, added_by, created_at) VALUES (?, ?, 1, ?)').run(c.id, callId, now);
          }
        }
      } catch { /* skip invalid JSON */ }
      // Migrate linked_incidents
      try {
        const incidents = JSON.parse(c.linked_incidents || '[]');
        for (const incId of incidents) {
          if (typeof incId === 'number') {
            db.prepare('INSERT OR IGNORE INTO case_incidents (case_id, incident_id, added_by, created_at) VALUES (?, ?, 1, ?)').run(c.id, incId, now);
          }
        }
      } catch { /* skip invalid JSON */ }
      migrated++;
    }
    auditLog(req, 'MIGRATE', 'cases', 0, `Migrated ${migrated} cases from JSON to junction tables`);
    res.json({ success: true, cases_migrated: migrated });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── GET / ───────────────────────────────────────────────
router.get('/', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, case_type, priority, investigator, search, page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE c.archived_at IS NULL';
    const params: any[] = [];

    if (status) { where += ' AND c.status = ?'; params.push(status); }
    if (case_type) { where += ' AND c.case_type = ?'; params.push(case_type); }
    if (priority) { where += ' AND c.priority = ?'; params.push(priority); }
    if (investigator) { where += ' AND c.lead_investigator_id = ?'; params.push(investigator); }
    if (search) {
      where += ' AND (c.case_number LIKE ? OR c.title LIKE ? OR c.summary LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM cases c ${where}`).get(...params) as any).count;
    const rows = db.prepare(`
      SELECT c.*, u.full_name as lead_investigator_name
      FROM cases c
      LEFT JOIN users u ON c.lead_investigator_id = u.id
      ${where}
      ORDER BY
        CASE c.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        c.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Get cases error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Get cases error:', error);
    res.status(500).json({ error: 'Failed to retrieve cases', code: 'LIST_CASES_ERROR' });
>>>>>>> origin/main
  }
});

// ─── GET /:id ────────────────────────────────────────────
router.get('/:id', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid case ID', code: 'INVALID_ID' }); return; }
    const row = db.prepare(`
      SELECT c.*, u.full_name as lead_investigator_name
      FROM cases c LEFT JOIN users u ON c.lead_investigator_id = u.id
      WHERE c.id = ?
    `).get(id);
    if (!row) return res.status(404).json({ error: 'Case not found', code: 'NOT_FOUND' });
    res.json({ data: row });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Get case error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Get case error:', error);
    res.status(500).json({ error: 'Failed to retrieve case', code: 'GET_CASE_ERROR' });
>>>>>>> origin/main
  }
});

// ─── POST / ──────────────────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { title, case_type = 'general', priority: requestedPriority, summary, lead_investigator_id, linked_call_id } = req.body;
    if (!title || (typeof title === 'string' && title.trim().length === 0)) return res.status(400).json({ error: 'Title is required', code: 'MISSING_TITLE' });
    if (typeof title === 'string' && title.length > 500) return res.status(400).json({ error: 'Title must be 500 characters or less', code: 'TITLE_TOO_LONG' });

    // Input sanitization
    const cleanTitle = typeof title === 'string' ? title.trim() : title;
    const cleanSummary = typeof summary === 'string' ? summary.trim() : summary;

    // Feature 10: Auto-calculate case priority based on incident type severity
    let priority = requestedPriority || 'normal';
    if (!requestedPriority && case_type) {
      const HIGH_SEVERITY_TYPES = ['homicide', 'sexual_assault', 'use_of_force', 'death', 'assault', 'kidnapping'];
      const ELEVATED_TYPES = ['burglary', 'robbery', 'narcotics', 'arson', 'domestic', 'missing_person'];
      const LOW_TYPES = ['admin', 'civil', 'property', 'other'];
      if (HIGH_SEVERITY_TYPES.includes(case_type)) priority = 'critical';
      else if (ELEVATED_TYPES.includes(case_type)) priority = 'high';
      else if (LOW_TYPES.includes(case_type)) priority = 'low';
      else priority = 'normal';
    }

    const case_number = generateCaseNumber(db, case_type);
    const result = db.prepare(`
      INSERT INTO cases (case_number, title, case_type, status, priority, lead_investigator_id,
        summary, linked_calls, created_by, created_at, updated_at, opened_date)
      VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(case_number, title, case_type, priority, lead_investigator_id || null, summary || null,
      linked_call_id ? JSON.stringify([linked_call_id]) : '[]',
      req.user!.userId, now, now, localToday());

    // Update the linked call with this case_id for bidirectional linkage
    if (linked_call_id) {
      db.prepare('UPDATE calls_for_service SET case_id = ?, case_number = ? WHERE id = ?')
        .run(result.lastInsertRowid, case_number, linked_call_id);
    }

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'create', 'case', ?, ?, ?)`).run(req.user!.userId, result.lastInsertRowid, JSON.stringify({ case_number, title: cleanTitle }), now);

    broadcastRecordUpdate({ type: 'case_created', id: result.lastInsertRowid, case_number });
    res.status(201).json({ data: { id: result.lastInsertRowid, case_number } });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Create case error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Create case error:', error);
    res.status(500).json({ error: 'Failed to create case', code: 'CREATE_CASE_ERROR' });
>>>>>>> origin/main
  }
});

// ─── PUT /:id ────────────────────────────────────────────
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid case ID', code: 'INVALID_CASE_ID' }); return; }
    const now = localNow();
    const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Case not found', code: 'CASE_NOT_FOUND' });

    // God Mode: admin can change case_number
    const fields = ['title', 'case_type', 'priority', 'summary', 'narrative', 'disposition',
      'disposition_date', 'due_date', 'lead_investigator_id', 'assigned_officers',
      'solvability_score', 'solvability_factors', 'linked_incidents', 'linked_citations',
      'linked_evidence', 'linked_persons', 'linked_field_interviews', 'linked_calls',
      ...(req.user?.role === 'admin' ? ['case_number'] : [])];
    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(typeof req.body[f] === 'object' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }

    // God Mode: admin can edit closed cases and change case_number
    if (req.user?.role === 'admin' && (existing.status?.startsWith('closed_') || req.body.case_number)) {
      auditLog(req, 'ADMIN_OVERRIDE', 'case', id, `Admin God Mode: editing case #${id} (status=${existing.status}, case_number change=${!!req.body.case_number})`);
    }

    params.push(id);
    db.prepare(`UPDATE cases SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'update', 'case', ?, ?, ?)`).run(req.user!.userId, id, JSON.stringify({ fields: Object.keys(req.body) }), now);

    broadcastRecordUpdate({ type: 'case_updated', id });
    res.json({ data: { id } });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Update case error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Update case error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'UPDATE_ERROR' });
  }
});

// ─── PUT /:id/submit-review — Submit case for supervisor review ─
router.put('/:id/submit-review', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const reviewId = parseInt(req.params.id, 10);
    if (isNaN(reviewId)) return res.status(400).json({ error: 'Invalid case ID', code: 'INVALID_CASE_ID' });
    const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(reviewId) as any;
    if (!existing) return res.status(404).json({ error: 'Case not found', code: 'CASE_NOT_FOUND' });

    db.prepare(`UPDATE cases SET approval_status = 'pending_review', updated_at = ? WHERE id = ?`)
      .run(now, req.params.id);

    // Create notification for supervisors
    try {
      const supervisors = db.prepare(`SELECT id FROM users WHERE role IN ('admin','manager','supervisor') AND status = 'active'`).all() as any[];
      for (const sup of supervisors) {
        db.prepare(`INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, created_at)
          VALUES ('system', 'normal', ?, ?, 'case', ?, ?, ?)`).run(
          `Case Review: ${existing.case_number}`,
          `${existing.title} submitted for supervisor review by ${req.user!.fullName || 'an officer'}`,
          req.params.id, sup.id, now
        );
      }
    } catch (e) { console.warn('Case review notification failed:', (e as Error).message); }

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'submit_review', 'case', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, JSON.stringify({ case_number: existing.case_number }), now);

    broadcastRecordUpdate({ type: 'case_submitted_review', id: parseInt(req.params.id) });
    res.json({ data: { id: parseInt(req.params.id), approval_status: 'pending_review' } });
  } catch (error: any) {
    console.error('Submit case for review error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'SUBMIT_REVIEW_ERROR' });
  }
});

// ─── PUT /:id/approve — Supervisor approves/returns case ────
router.put('/:id/approve', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { action, return_reason } = req.body; // action: 'approve' | 'return'

    // Only supervisors+ can approve
    if (!['admin', 'manager', 'supervisor'].includes(req.user!.role)) {
      return res.status(403).json({ error: 'Only supervisors can approve cases', code: 'ONLY_SUPERVISORS_CAN_APPROVE' });
    }

    const approveId = parseInt(req.params.id, 10);
    if (isNaN(approveId)) return res.status(400).json({ error: 'Invalid case ID', code: 'INVALID_CASE_ID' });
    const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(approveId) as any;
    if (!existing) return res.status(404).json({ error: 'Case not found', code: 'CASE_NOT_FOUND' });

    if (action === 'approve') {
      db.prepare(`UPDATE cases SET approval_status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`)
        .run(req.user!.userId, now, now, req.params.id);
    } else if (action === 'return') {
      db.prepare(`UPDATE cases SET approval_status = 'returned', return_reason = ?, updated_at = ? WHERE id = ?`)
        .run(return_reason || '', now, req.params.id);
    } else {
      return res.status(400).json({ error: 'Invalid action. Use "approve" or "return"', code: 'INVALID_ACTION_USE_APPROVE' });
    }

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, ?, 'case', ?, ?, ?)`).run(
      req.user!.userId, action === 'approve' ? 'approve_case' : 'return_case', req.params.id,
      JSON.stringify({ case_number: existing.case_number, action, return_reason }), now);

    broadcastRecordUpdate({ type: 'case_approval_updated', id: parseInt(req.params.id), approval_status: action === 'approve' ? 'approved' : 'returned' });
    res.json({ data: { id: parseInt(req.params.id), approval_status: action === 'approve' ? 'approved' : 'returned' } });
  } catch (error: any) {
    console.error('Approve case error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'APPROVAL_ERROR' });
>>>>>>> origin/main
  }
});

// ─── PUT /:id/status ────────────────────────────────────
router.put('/:id/status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { status } = req.body;
    const validStatuses = ['open', 'assigned', 'active', 'suspended', 'under_review', 'closed_cleared', 'closed_unfounded', 'closed_exception'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status', code: 'INVALID_STATUS' });

    const statusId = parseInt(req.params.id, 10);
    if (isNaN(statusId)) return res.status(400).json({ error: 'Invalid case ID', code: 'INVALID_CASE_ID' });
    const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(statusId) as any;
    if (!existing) return res.status(404).json({ error: 'Case not found', code: 'CASE_NOT_FOUND' });

    // God Mode: admin can reopen closed cases
    if (req.user?.role === 'admin' && existing.status?.startsWith('closed_') && !status.startsWith('closed_')) {
      auditLog(req, 'ADMIN_OVERRIDE', 'case', statusId, `Admin God Mode: reopening closed case #${statusId} (${existing.status} → ${status})`);
    }

    const updates: any = { status, updated_at: now };
    if (status.startsWith('closed_')) updates.closed_date = localToday();
    if (status === 'assigned' && !existing.assigned_at) updates.assigned_at = now;

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE cases SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'status_change', 'case', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, JSON.stringify({ from: existing.status, to: status }), now);

    broadcastRecordUpdate({ type: 'case_status_changed', id: parseInt(req.params.id), status });
    res.json({ data: { id: parseInt(req.params.id), status } });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Update case status error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Update case status error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'STATUS_UPDATE_ERROR' });
  }
});

// ─── DELETE /:id — Admin God Mode: delete case in any status ─
router.delete('/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const delId = parseInt(req.params.id, 10);
    if (isNaN(delId)) return res.status(400).json({ error: 'Invalid case ID', code: 'INVALID_CASE_ID' });
    const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(delId) as any;
    if (!existing) return res.status(404).json({ error: 'Case not found', code: 'CASE_NOT_FOUND' });

    auditLog(req, 'ADMIN_OVERRIDE', 'case', delId, `Admin God Mode: deleting case ${existing.case_number} (status=${existing.status})`);

    // Delete associated records
    db.prepare('DELETE FROM case_notes WHERE case_id = ?').run(delId);
    db.prepare('DELETE FROM case_persons WHERE case_id = ?').run(delId);
    try { db.prepare('DELETE FROM case_calls WHERE case_id = ?').run(delId); } catch { /* table may not exist */ }
    try { db.prepare('DELETE FROM case_incidents WHERE case_id = ?').run(delId); } catch { /* table may not exist */ }
    try { db.prepare('DELETE FROM case_vehicles WHERE case_id = ?').run(delId); } catch { /* table may not exist */ }
    try { db.prepare('DELETE FROM case_properties WHERE case_id = ?').run(delId); } catch { /* table may not exist */ }
    try { db.prepare('DELETE FROM case_evidence WHERE case_id = ?').run(delId); } catch { /* table may not exist */ }
    try { db.prepare('DELETE FROM case_warrants WHERE case_id = ?').run(delId); } catch { /* table may not exist */ }
    try { db.prepare('DELETE FROM case_citations WHERE case_id = ?').run(delId); } catch { /* table may not exist */ }
    db.prepare('DELETE FROM cases WHERE id = ?').run(delId);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'delete', 'case', ?, ?, ?)`).run(
      req.user!.userId, delId, JSON.stringify({ case_number: existing.case_number, status: existing.status }), localNow());

    broadcastRecordUpdate({ type: 'case_deleted', id: delId });
    res.json({ success: true, message: `Case ${existing.case_number} deleted` });
  } catch (error: any) {
    console.error('Delete case error:', error);
    res.status(500).json({ error: 'Failed to delete case', code: 'DELETE_CASE_ERROR' });
>>>>>>> origin/main
  }
});

// ─── POST /:id/notes ────────────────────────────────────
router.post('/:id/notes', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const notesCaseId = parseInt(req.params.id, 10);
    if (isNaN(notesCaseId)) return res.status(400).json({ error: 'Invalid case ID', code: 'INVALID_CASE_ID' });
    const { content, note_type = 'general' } = req.body;
    if (!content || (typeof content === 'string' && content.trim().length === 0)) return res.status(400).json({ error: 'Content is required', code: 'MISSING_CONTENT' });
    if (typeof content === 'string' && content.length > 50000) return res.status(400).json({ error: 'Content must be 50000 characters or less', code: 'CONTENT_TOO_LONG' });

    // Input sanitization
    const cleanContent = typeof content === 'string' ? content.trim() : content;

    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;
    const result = db.prepare(`
      INSERT INTO case_notes (case_id, author_id, author_name, note_type, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.id, req.user!.userId, user?.full_name || '', note_type, content, now);

    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, req.params.id);
    res.status(201).json({ data: { id: result.lastInsertRowid } });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Create case note error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Create case note error:', error);
    res.status(500).json({ error: 'Failed to create case note', code: 'CREATE_CASE_NOTE_ERROR' });
>>>>>>> origin/main
  }
});

// ─── GET /:id/notes ─────────────────────────────────────
router.get('/:id/notes', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const notes = db.prepare(`
      SELECT * FROM case_notes WHERE case_id = ? ORDER BY is_pinned DESC, created_at DESC
      LIMIT 500
    `).all(req.params.id);
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ data: notes });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Get case notes error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Get case notes error:', error);
    res.status(500).json({ error: 'Failed to retrieve case notes', code: 'GET_NOTES_ERROR' });
>>>>>>> origin/main
  }
});

// ─── POST /:id/calculate-solvability ────────────────────
router.post('/:id/calculate-solvability', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const solvId = parseInt(req.params.id, 10);
    if (isNaN(solvId)) return res.status(400).json({ error: 'Invalid case ID', code: 'INVALID_CASE_ID' });
    const { factors } = req.body; // { witness_available, physical_evidence, suspect_named, ... }

    if (factors && typeof factors !== 'object') return res.status(400).json({ error: 'factors must be an object', code: 'INVALID_FACTORS' });

    const weights: Record<string, number> = {
      witness_available: 15, physical_evidence: 20, suspect_named: 25,
      suspect_described: 10, suspect_vehicle: 10, video_available: 10,
      traceable_property: 5, significant_modus: 5,
    };
    let score = 0;
    for (const [key, val] of Object.entries(factors || {})) {
      if (val && weights[key]) score += weights[key];
    }

    db.prepare('UPDATE cases SET solvability_score = ?, solvability_factors = ?, updated_at = ? WHERE id = ?')
      .run(score, JSON.stringify(factors), now, req.params.id);

    res.json({ data: { score, factors } });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Calculate solvability error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Calculate solvability error:', error);
    res.status(500).json({ error: 'Failed to calculate solvability score', code: 'SOLVABILITY_ERROR' });
>>>>>>> origin/main
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 33: Case Timeline Visualization Data
// ════════════════════════════════════════════════════════════
router.get('/:id/timeline', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id) as any;
    if (!caseRow) { res.status(404).json({ error: 'Case not found', code: 'NOT_FOUND' }); return; }
    const events: any[] = [];
    // Case creation
    events.push({ type: 'case_created', date: caseRow.created_at, title: 'Case Opened', description: `${caseRow.case_number} created` });
    if (caseRow.assigned_at) events.push({ type: 'assigned', date: caseRow.assigned_at, title: 'Investigator Assigned' });
    if (caseRow.approved_at) events.push({ type: 'approved', date: caseRow.approved_at, title: 'Case Approved' });
    if (caseRow.closed_date) events.push({ type: 'closed', date: caseRow.closed_date, title: `Case Closed (${caseRow.status})` });
    // Notes timeline
    try {
      const notes = db.prepare('SELECT id, note_type, content, author_name, created_at FROM case_notes WHERE case_id = ? ORDER BY created_at ASC LIMIT 100').all(req.params.id) as any[];
      for (const n of notes) { events.push({ type: 'note', date: n.created_at, title: `Note (${n.note_type})`, description: n.content?.substring(0, 100), author: n.author_name }); }
    } catch { /* case_notes may not exist */ }
    // Activity log entries
    const activities = db.prepare("SELECT action, details, created_at FROM activity_log WHERE entity_type = 'case' AND entity_id = ? ORDER BY created_at ASC LIMIT 50").all(req.params.id) as any[];
    for (const a of activities) { events.push({ type: 'activity', date: a.created_at, title: a.action, description: a.details }); }
    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    res.json({ data: events });
  } catch (error: any) { console.error('Case timeline error:', error); res.status(500).json({ error: 'Failed to get timeline', code: 'TIMELINE_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 34: Linked Evidence Count
// ════════════════════════════════════════════════════════════
router.get('/:id/evidence-summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const caseRow = db.prepare('SELECT id, linked_evidence FROM cases WHERE id = ?').get(req.params.id) as any;
    if (!caseRow) { res.status(404).json({ error: 'Case not found', code: 'NOT_FOUND' }); return; }
    let evidenceIds: number[] = [];
    try { evidenceIds = JSON.parse(caseRow.linked_evidence || '[]'); } catch { evidenceIds = []; }
    let evidenceItems: any[] = [];
    if (evidenceIds.length > 0) {
      const placeholders = evidenceIds.map(() => '?').join(',');
      try {
        evidenceItems = db.prepare(`SELECT id, evidence_number, type, description, status, location, chain_of_custody FROM evidence WHERE id IN (${placeholders})`).all(...evidenceIds) as any[];
      } catch { /* evidence table may not exist */ }
    }
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const e of evidenceItems) {
      byType[e.type || 'unknown'] = (byType[e.type || 'unknown'] || 0) + 1;
      byStatus[e.status || 'unknown'] = (byStatus[e.status || 'unknown'] || 0) + 1;
    }
    res.json({ data: { total_evidence: evidenceItems.length, items: evidenceItems, by_type: byType, by_status: byStatus } });
  } catch (error: any) { console.error('Evidence summary error:', error); res.status(500).json({ error: 'Failed to get evidence summary', code: 'EVIDENCE_SUMMARY_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 35: Suspect/Witness/Victim Role Tracking
// ════════════════════════════════════════════════════════════
try { const db = getDb(); db.prepare(`CREATE TABLE IF NOT EXISTS case_persons (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, person_id INTEGER, person_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'involved', notes TEXT, added_by INTEGER, created_at TEXT NOT NULL)`).run(); } catch { /* already exists */ }

// ── Case Entity Junction Tables ─────────────────────────────
function initCaseJunctionTables(): void {
  try {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS case_persons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        person_id INTEGER,
        person_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'involved',
        notes TEXT,
        added_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS case_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        user_id INTEGER,
        author_id INTEGER,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS case_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        call_id INTEGER NOT NULL,
        added_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        FOREIGN KEY (call_id) REFERENCES calls_for_service(id) ON DELETE CASCADE,
        UNIQUE(case_id, call_id)
      );
      CREATE TABLE IF NOT EXISTS case_incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        incident_id INTEGER NOT NULL,
        added_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
        UNIQUE(case_id, incident_id)
      );
      CREATE TABLE IF NOT EXISTS case_vehicles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        vehicle_id INTEGER NOT NULL,
        role TEXT DEFAULT 'involved',
        notes TEXT,
        added_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        UNIQUE(case_id, vehicle_id)
      );
      CREATE TABLE IF NOT EXISTS case_properties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        property_id INTEGER NOT NULL,
        role TEXT DEFAULT 'scene',
        added_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
        UNIQUE(case_id, property_id)
      );
      CREATE TABLE IF NOT EXISTS case_evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        evidence_id INTEGER NOT NULL,
        added_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        UNIQUE(case_id, evidence_id)
      );
      CREATE TABLE IF NOT EXISTS case_warrants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        warrant_id INTEGER NOT NULL,
        added_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        UNIQUE(case_id, warrant_id)
      );
      CREATE TABLE IF NOT EXISTS case_citations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        citation_id INTEGER NOT NULL,
        added_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        UNIQUE(case_id, citation_id)
      );
    `);
  } catch { /* Tables will be created on first use */ }
}

// Initialize on module load (may fail if DB not ready — ensureCaseTables handles retry)
try { initCaseJunctionTables(); } catch { /* deferred */ }

let _caseTablesReady = false;
function ensureCaseTables(): void {
  if (_caseTablesReady) return;
  try { initCaseJunctionTables(); _caseTablesReady = true; } catch { /* will retry next request */ }
}

// ── Auto-Cascade Helpers ────────────────────────────────────
function autoCascadeFromCall(db: any, caseId: number, callId: number, userId: number, processed?: Set<string>): void {
  ensureCaseTables();
  const seen = processed || new Set<string>();
  const key = `call:${callId}`;
  if (seen.has(key)) return;
  seen.add(key);

  const now = localNow();

  // Import call_persons → case_persons
  try {
    const callPersons = db.prepare('SELECT person_id, role FROM call_persons WHERE call_id = ? AND person_id IS NOT NULL').all(callId) as any[];
    for (const cp of callPersons) {
      const person = db.prepare("SELECT first_name || ' ' || last_name as full_name FROM persons WHERE id = ?").get(cp.person_id) as any;
      if (person) {
        db.prepare('INSERT OR IGNORE INTO case_persons (case_id, person_id, person_name, role, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(caseId, cp.person_id, person.full_name, cp.role || 'involved', userId, now);
      }
    }
  } catch { /* call_persons may not exist */ }

  // Find incidents linked to this call → case_incidents
  try {
    const incidents = db.prepare('SELECT id FROM incidents WHERE call_id = ?').all(callId) as any[];
    for (const inc of incidents) {
      db.prepare('INSERT OR IGNORE INTO case_incidents (case_id, incident_id, added_by, created_at) VALUES (?, ?, ?, ?)').run(caseId, inc.id, userId, now);
      autoCascadeFromIncident(db, caseId, inc.id, userId, seen);
    }
  } catch { /* incidents table may not exist */ }
}

function autoCascadeFromIncident(db: any, caseId: number, incidentId: number, userId: number, processed?: Set<string>): void {
  const seen = processed || new Set<string>();
  const key = `incident:${incidentId}`;
  if (seen.has(key)) return;
  seen.add(key);

  const now = localNow();

  // Import incident_persons → case_persons
  try {
    const incPersons = db.prepare('SELECT person_id, role FROM incident_persons WHERE incident_id = ?').all(incidentId) as any[];
    for (const ip of incPersons) {
      const person = db.prepare("SELECT first_name || ' ' || last_name as full_name FROM persons WHERE id = ?").get(ip.person_id) as any;
      if (person) {
        db.prepare('INSERT OR IGNORE INTO case_persons (case_id, person_id, person_name, role, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(caseId, ip.person_id, person.full_name, ip.role || 'involved', userId, now);
      }
    }
  } catch { /* incident_persons may not exist */ }

  // Import incident_vehicles → case_vehicles
  try {
    const incVehicles = db.prepare('SELECT vehicle_id, role FROM incident_vehicles WHERE incident_id = ?').all(incidentId) as any[];
    for (const iv of incVehicles) {
      db.prepare('INSERT OR IGNORE INTO case_vehicles (case_id, vehicle_id, role, added_by, created_at) VALUES (?, ?, ?, ?, ?)').run(caseId, iv.vehicle_id, iv.role || 'involved', userId, now);
    }
  } catch { /* incident_vehicles may not exist */ }

  // If incident has a call_id, auto-link that CFS too
  try {
    const incident = db.prepare('SELECT call_id FROM incidents WHERE id = ?').get(incidentId) as any;
    if (incident?.call_id) {
      db.prepare('INSERT OR IGNORE INTO case_calls (case_id, call_id, added_by, created_at) VALUES (?, ?, ?, ?)').run(caseId, incident.call_id, userId, now);
      autoCascadeFromCall(db, caseId, incident.call_id, userId, seen);
    }
  } catch { /* incidents table may not exist */ }
}

router.get('/:id/persons', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const caseRow = db.prepare('SELECT id FROM cases WHERE id = ?').get(req.params.id);
    if (!caseRow) { res.status(404).json({ error: 'Case not found', code: 'NOT_FOUND' }); return; }
    const persons = db.prepare(`SELECT cp.*, p.first_name, p.last_name, p.dob, p.photo_url, p.flags, u.full_name as added_by_name FROM case_persons cp LEFT JOIN persons p ON cp.person_id = p.id LEFT JOIN users u ON cp.added_by = u.id WHERE cp.case_id = ? ORDER BY CASE cp.role WHEN 'suspect' THEN 0 WHEN 'victim' THEN 1 WHEN 'witness' THEN 2 ELSE 3 END, cp.created_at DESC`).all(req.params.id);
    const roleCounts: Record<string, number> = {};
    for (const p of persons as any[]) { roleCounts[p.role] = (roleCounts[p.role] || 0) + 1; }
    res.json({ data: { persons, role_counts: roleCounts } });
  } catch (error: any) { console.error('Get case persons error:', error); res.status(500).json({ error: 'Failed to get case persons', code: 'GET_CASE_PERSONS_ERROR' }); }
});

router.post('/:id/persons', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const caseRow = db.prepare('SELECT id, case_number FROM cases WHERE id = ?').get(req.params.id) as any;
    if (!caseRow) { res.status(404).json({ error: 'Case not found', code: 'NOT_FOUND' }); return; }
    const { person_id, person_name, role, notes } = req.body;
    const validRoles = ['suspect', 'victim', 'witness', 'involved', 'person_of_interest', 'informant'];
    if (!validRoles.includes(role || '')) { res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}`, code: 'INVALID_ROLE' }); return; }
    if (!person_name?.trim() && !person_id) { res.status(400).json({ error: 'person_name or person_id required', code: 'MISSING_PERSON_INFO' }); return; }
    let name = person_name || '';
    if (person_id && !name) { const p = db.prepare('SELECT first_name, last_name FROM persons WHERE id = ?').get(person_id) as any; if (p) name = `${p.first_name} ${p.last_name}`; }
    const now = localNow();
    const result = db.prepare('INSERT INTO case_persons (case_id, person_id, person_name, role, notes, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(req.params.id, person_id || null, name, role, notes || null, req.user!.userId, now);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, req.params.id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, 'add_case_person', 'case', ?, ?, ?)`).run(req.user!.userId, req.params.id, JSON.stringify({ person_name: name, role }), now);
    broadcastRecordUpdate({ type: 'case_person_added', case_id: parseInt(req.params.id), role });
    res.status(201).json({ data: { id: result.lastInsertRowid } });
  } catch (error: any) { console.error('Add case person error:', error); res.status(500).json({ error: 'Failed to add person to case', code: 'ADD_CASE_PERSON_ERROR' }); }
});

router.put('/:id/persons/:personEntryId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const entry = db.prepare('SELECT * FROM case_persons WHERE id = ? AND case_id = ?').get(req.params.personEntryId, req.params.id) as any;
    if (!entry) { res.status(404).json({ error: 'Person entry not found', code: 'PERSON_ENTRY_NOT_FOUND' }); return; }
    const { role, notes } = req.body;
    const now = localNow();
    const updates: string[] = [];
    const params: any[] = [];
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (updates.length > 0) { params.push(req.params.personEntryId); db.prepare(`UPDATE case_persons SET ${updates.join(', ')} WHERE id = ?`).run(...params); }
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, req.params.id);
    res.json({ success: true });
  } catch (error: any) { console.error('Update case person error:', error); res.status(500).json({ error: 'Failed to update person entry', code: 'UPDATE_CASE_PERSON_ERROR' }); }
});

router.delete('/:id/persons/:personEntryId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const entry = db.prepare('SELECT * FROM case_persons WHERE id = ? AND case_id = ?').get(req.params.personEntryId, req.params.id) as any;
    if (!entry) { res.status(404).json({ error: 'Person entry not found', code: 'PERSON_ENTRY_NOT_FOUND' }); return; }
    db.prepare('DELETE FROM case_persons WHERE id = ?').run(req.params.personEntryId);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), req.params.id);
    res.json({ success: true });
  } catch (error: any) { console.error('Delete case person error:', error); res.status(500).json({ error: 'Failed to remove person', code: 'DELETE_CASE_PERSON_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 36: Cases CSV Export
// ════════════════════════════════════════════════════════════
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, case_type, date_from, date_to } = req.query;
    let where = 'WHERE c.archived_at IS NULL';
    const params: any[] = [];
    if (status) { where += ' AND c.status = ?'; params.push(status); }
    if (case_type) { where += ' AND c.case_type = ?'; params.push(case_type); }
    if (date_from) { where += ' AND c.created_at >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND c.created_at <= ?'; params.push(date_to); }
    const rows = db.prepare(`SELECT c.case_number, c.title, c.case_type, c.status, c.priority, c.solvability_score, u.full_name as investigator, c.opened_date, c.closed_date, c.disposition, c.created_at FROM cases c LEFT JOIN users u ON c.lead_investigator_id = u.id ${where} ORDER BY c.created_at DESC LIMIT 10000`).all(...params) as any[];
    const headers = ['Case #', 'Title', 'Type', 'Status', 'Priority', 'Solvability', 'Investigator', 'Opened', 'Closed', 'Disposition', 'Created'];
    const csvRows = rows.map((r: any) => [r.case_number, (r.title || '').replace(/"/g, '""'), r.case_type, r.status, r.priority, r.solvability_score, r.investigator, r.opened_date, r.closed_date, (r.disposition || '').replace(/"/g, '""'), r.created_at]);
    const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${v || ''}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="cases_export_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (error: any) { console.error('Export cases error:', error); res.status(500).json({ error: 'Failed to export cases', code: 'EXPORT_CASES_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 37: Case Data Completeness
// ════════════════════════════════════════════════════════════
router.get('/:id/completeness', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const c = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id) as any;
    if (!c) { res.status(404).json({ error: 'Case not found', code: 'NOT_FOUND' }); return; }
    const requiredFields = ['title', 'case_type', 'status', 'priority'];
    const recommendedFields = ['summary', 'narrative', 'lead_investigator_id', 'solvability_score', 'disposition', 'linked_evidence', 'linked_persons'];
    const filledRequired = requiredFields.filter(f => c[f] != null && String(c[f]).trim() !== '').length;
    const filledRecommended = recommendedFields.filter(f => c[f] != null && String(c[f]).trim() !== '' && c[f] !== '[]').length;
    const score = Math.round(((filledRequired / requiredFields.length) * 50 + (filledRecommended / recommendedFields.length) * 50));
    res.json({ data: { case_id: c.id, score, grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D', missing_required: requiredFields.filter(f => !c[f] || String(c[f]).trim() === ''), missing_recommended: recommendedFields.filter(f => !c[f] || String(c[f]).trim() === '' || c[f] === '[]') } });
  } catch (error: any) { console.error('Case completeness error:', error); res.status(500).json({ error: 'Failed to get completeness', code: 'CASE_COMPLETENESS_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 38: Case Archive
// ════════════════════════════════════════════════════════════
router.post('/:id/archive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id) as any;
    if (!caseRow) { res.status(404).json({ error: 'Case not found', code: 'NOT_FOUND' }); return; }
    if (caseRow.archived_at) { res.status(400).json({ error: 'Case already archived', code: 'ALREADY_ARCHIVED' }); return; }
    db.prepare('UPDATE cases SET archived_at = ?, updated_at = ? WHERE id = ?').run(now, now, req.params.id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, 'archive_case', 'case', ?, ?, ?)`).run(req.user!.userId, req.params.id, JSON.stringify({ case_number: caseRow.case_number }), now);
    res.json({ success: true });
  } catch (error: any) { console.error('Archive case error:', error); res.status(500).json({ error: 'Failed to archive case', code: 'ARCHIVE_CASE_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// CASE FOLDER — Linked Entity Management
// ════════════════════════════════════════════════════════════

// ── GET /:id/full — Aggregate Endpoint ──────────────────────
router.get('/:id/full', (req: Request, res: Response) => {
  ensureCaseTables();
  try {
    const db = getDb();
    const caseRow = db.prepare(`
      SELECT c.*, u.full_name as lead_investigator_name
      FROM cases c LEFT JOIN users u ON c.lead_investigator_id = u.id
      WHERE c.id = ?
    `).get(req.params.id) as any;
    if (!caseRow) { res.status(404).json({ error: 'Case not found' }); return; }

    const calls = db.prepare(`SELECT cc.id as link_id, cfs.* FROM case_calls cc JOIN calls_for_service cfs ON cc.call_id = cfs.id WHERE cc.case_id = ? ORDER BY cfs.created_at DESC`).all(req.params.id);
    const incidents = db.prepare(`SELECT ci.id as link_id, i.* FROM case_incidents ci JOIN incidents i ON ci.incident_id = i.id WHERE ci.case_id = ? ORDER BY i.created_at DESC`).all(req.params.id);
    const persons = db.prepare(`SELECT cp.*, p.first_name, p.last_name, p.dob, p.phone, p.address FROM case_persons cp LEFT JOIN persons p ON cp.person_id = p.id WHERE cp.case_id = ? ORDER BY cp.created_at DESC`).all(req.params.id);
    const vehicles = db.prepare(`SELECT cv.id as link_id, cv.role, v.* FROM case_vehicles cv JOIN vehicles_records v ON cv.vehicle_id = v.id WHERE cv.case_id = ? ORDER BY cv.created_at DESC`).all(req.params.id);
    const properties = db.prepare(`SELECT cpr.id as link_id, cpr.role, p.* FROM case_properties cpr JOIN properties p ON cpr.property_id = p.id WHERE cpr.case_id = ? ORDER BY cpr.created_at DESC`).all(req.params.id);
    const evidence = db.prepare(`SELECT ce.id as link_id, e.* FROM case_evidence ce JOIN evidence e ON ce.evidence_id = e.id WHERE ce.case_id = ? ORDER BY e.created_at DESC`).all(req.params.id);
    const warrants = db.prepare(`SELECT cw.id as link_id, w.*, sp.first_name || ' ' || sp.last_name as subject_name FROM case_warrants cw JOIN warrants w ON cw.warrant_id = w.id LEFT JOIN persons sp ON w.subject_person_id = sp.id WHERE cw.case_id = ? ORDER BY w.created_at DESC`).all(req.params.id);
    const citations = db.prepare(`SELECT cc2.id as link_id, ct.* FROM case_citations cc2 JOIN citations ct ON cc2.citation_id = ct.id WHERE cc2.case_id = ? ORDER BY ct.created_at DESC`).all(req.params.id);
    const notes = db.prepare(`SELECT cn.*, u.full_name as author_name FROM case_notes cn LEFT JOIN users u ON cn.author_id = u.id WHERE cn.case_id = ? ORDER BY cn.created_at DESC`).all(req.params.id);

    res.json({
      ...caseRow,
      calls, incidents, persons, vehicles, properties,
      evidence, warrants, citations, notes,
      counts: {
        calls: calls.length, incidents: incidents.length,
        persons: persons.length, vehicles: vehicles.length,
        properties: properties.length, evidence: evidence.length,
        warrants: warrants.length, citations: citations.length,
        notes: notes.length,
      },
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Calls ───────────────────────────────────────────────────
router.get('/:id/calls', (req: Request, res: Response) => {
  try {
    ensureCaseTables();
    const db = getDb();
    const rows = db.prepare(`
      SELECT cc.id as link_id, cc.created_at as linked_at,
        c.id, c.call_number, c.incident_type, c.status, c.priority,
        c.location_address, c.created_at, c.disposition,
        u.full_name as added_by_name
      FROM case_calls cc
      JOIN calls_for_service c ON cc.call_id = c.id
      LEFT JOIN users u ON cc.added_by = u.id
      WHERE cc.case_id = ?
      ORDER BY c.created_at DESC
    `).all(req.params.id);
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/calls', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    ensureCaseTables();
    const db = getDb();
    const { call_id } = req.body;
    if (!call_id) { res.status(400).json({ error: 'call_id required' }); return; }
    const now = localNow();
    db.prepare('INSERT OR IGNORE INTO case_calls (case_id, call_id, added_by, created_at) VALUES (?, ?, ?, ?)').run(req.params.id, call_id, req.user!.userId, now);
    // Also set case_id on the call itself
    const caseRow = db.prepare('SELECT case_number FROM cases WHERE id = ?').get(req.params.id) as any;
    if (caseRow) {
      db.prepare('UPDATE calls_for_service SET case_id = ?, case_number = ?, updated_at = ? WHERE id = ?').run(req.params.id, caseRow.case_number, now, call_id);
    }
    // Auto-cascade: import persons, incidents, vehicles from this call
    autoCascadeFromCall(db, Number(req.params.id), call_id, req.user!.userId);
    auditLog(req, 'LINK', 'case_call', Number(req.params.id), `Linked call #${call_id} to case`);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/calls/:linkId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM case_calls WHERE id = ? AND case_id = ?').run(req.params.linkId, req.params.id);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Incidents ───────────────────────────────────────────────
router.get('/:id/incidents', (req: Request, res: Response) => {
  try {
    ensureCaseTables();
    const db = getDb();
    const rows = db.prepare(`
      SELECT ci.id as link_id, ci.created_at as linked_at,
        i.id, i.incident_number, i.incident_type, i.status, i.priority,
        i.location_address, i.narrative, i.created_at,
        u.full_name as added_by_name
      FROM case_incidents ci
      JOIN incidents i ON ci.incident_id = i.id
      LEFT JOIN users u ON ci.added_by = u.id
      WHERE ci.case_id = ?
      ORDER BY i.created_at DESC
    `).all(req.params.id);
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/incidents', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    ensureCaseTables();
    const db = getDb();
    const { incident_id } = req.body;
    if (!incident_id) { res.status(400).json({ error: 'incident_id required' }); return; }
    const now = localNow();
    db.prepare('INSERT OR IGNORE INTO case_incidents (case_id, incident_id, added_by, created_at) VALUES (?, ?, ?, ?)').run(req.params.id, incident_id, req.user!.userId, now);
    // Auto-cascade: import persons, vehicles from this incident
    autoCascadeFromIncident(db, Number(req.params.id), incident_id, req.user!.userId);
    auditLog(req, 'LINK', 'case_incident', Number(req.params.id), `Linked incident #${incident_id} to case`);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/incidents/:linkId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM case_incidents WHERE id = ? AND case_id = ?').run(req.params.linkId, req.params.id);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Vehicles ────────────────────────────────────────────────
router.get('/:id/vehicles', (req: Request, res: Response) => {
  try {
    ensureCaseTables();
    const db = getDb();
    const rows = db.prepare(`
      SELECT cv.id as link_id, cv.role, cv.notes, cv.created_at as linked_at,
        v.id, v.plate_number, v.state, v.vin, v.year, v.make, v.model, v.color, v.owner_person_id,
        u.full_name as added_by_name
      FROM case_vehicles cv
      JOIN vehicles_records v ON cv.vehicle_id = v.id
      LEFT JOIN users u ON cv.added_by = u.id
      WHERE cv.case_id = ?
      ORDER BY cv.created_at DESC
    `).all(req.params.id);
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/vehicles', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    ensureCaseTables();
    const db = getDb();
    const { vehicle_id, role, notes } = req.body;
    if (!vehicle_id) { res.status(400).json({ error: 'vehicle_id required' }); return; }
    const now = localNow();
    db.prepare('INSERT OR IGNORE INTO case_vehicles (case_id, vehicle_id, role, notes, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(req.params.id, vehicle_id, role || 'involved', notes || null, req.user!.userId, now);
    auditLog(req, 'LINK', 'case_vehicle', Number(req.params.id), `Linked vehicle #${vehicle_id} to case`);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/vehicles/:linkId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM case_vehicles WHERE id = ? AND case_id = ?').run(req.params.linkId, req.params.id);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Properties ──────────────────────────────────────────────
router.get('/:id/properties', (req: Request, res: Response) => {
  try {
    ensureCaseTables();
    const db = getDb();
    const rows = db.prepare(`
      SELECT cpr.id as link_id, cpr.role, cpr.created_at as linked_at,
        p.id, p.name, p.address, p.city, p.state, p.zip, p.client_id,
        u.full_name as added_by_name
      FROM case_properties cpr
      JOIN properties p ON cpr.property_id = p.id
      LEFT JOIN users u ON cpr.added_by = u.id
      WHERE cpr.case_id = ?
      ORDER BY cpr.created_at DESC
    `).all(req.params.id);
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/properties', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    ensureCaseTables();
    const db = getDb();
    const { property_id, role } = req.body;
    if (!property_id) { res.status(400).json({ error: 'property_id required' }); return; }
    const now = localNow();
    db.prepare('INSERT OR IGNORE INTO case_properties (case_id, property_id, role, added_by, created_at) VALUES (?, ?, ?, ?, ?)').run(req.params.id, property_id, role || 'scene', req.user!.userId, now);
    auditLog(req, 'LINK', 'case_property', Number(req.params.id), `Linked property #${property_id} to case`);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/properties/:linkId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM case_properties WHERE id = ? AND case_id = ?').run(req.params.linkId, req.params.id);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Evidence ────────────────────────────────────────────────
router.get('/:id/evidence', (req: Request, res: Response) => {
  try {
    ensureCaseTables();
    const db = getDb();
    const rows = db.prepare(`
      SELECT ce.id as link_id, ce.created_at as linked_at,
        e.id, e.evidence_number, e.description, e.evidence_type, e.status,
        e.collected_by, e.location_found,
        u.full_name as added_by_name
      FROM case_evidence ce
      JOIN evidence e ON ce.evidence_id = e.id
      LEFT JOIN users u ON ce.added_by = u.id
      WHERE ce.case_id = ?
      ORDER BY e.created_at DESC
    `).all(req.params.id);
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/evidence', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    ensureCaseTables();
    const db = getDb();
    const { evidence_id } = req.body;
    if (!evidence_id) { res.status(400).json({ error: 'evidence_id required' }); return; }
    const now = localNow();
    db.prepare('INSERT OR IGNORE INTO case_evidence (case_id, evidence_id, added_by, created_at) VALUES (?, ?, ?, ?)').run(req.params.id, evidence_id, req.user!.userId, now);
    auditLog(req, 'LINK', 'case_evidence', Number(req.params.id), `Linked evidence #${evidence_id} to case`);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/evidence/:linkId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM case_evidence WHERE id = ? AND case_id = ?').run(req.params.linkId, req.params.id);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Warrants ────────────────────────────────────────────────
router.get('/:id/warrants', (req: Request, res: Response) => {
  try {
    ensureCaseTables();
    const db = getDb();
    const rows = db.prepare(`
      SELECT cw.id as link_id, cw.created_at as linked_at,
        w.id, w.warrant_number, w.type, w.status,
        w.charge_description, w.offense_level,
        sp.first_name || ' ' || sp.last_name as subject_name,
        u.full_name as added_by_name
      FROM case_warrants cw
      JOIN warrants w ON cw.warrant_id = w.id
      LEFT JOIN persons sp ON w.subject_person_id = sp.id
      LEFT JOIN users u ON cw.added_by = u.id
      WHERE cw.case_id = ?
      ORDER BY w.created_at DESC
    `).all(req.params.id);
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/warrants', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    ensureCaseTables();
    const db = getDb();
    const { warrant_id } = req.body;
    if (!warrant_id) { res.status(400).json({ error: 'warrant_id required' }); return; }
    const now = localNow();
    db.prepare('INSERT OR IGNORE INTO case_warrants (case_id, warrant_id, added_by, created_at) VALUES (?, ?, ?, ?)').run(req.params.id, warrant_id, req.user!.userId, now);
    auditLog(req, 'LINK', 'case_warrant', Number(req.params.id), `Linked warrant #${warrant_id} to case`);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/warrants/:linkId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM case_warrants WHERE id = ? AND case_id = ?').run(req.params.linkId, req.params.id);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Citations ───────────────────────────────────────────────
router.get('/:id/citations', (req: Request, res: Response) => {
  try {
    ensureCaseTables();
    const db = getDb();
    const rows = db.prepare(`
      SELECT cc2.id as link_id, cc2.created_at as linked_at,
        ct.id, ct.citation_number, ct.type, ct.status, ct.person_name,
        ct.violation_description, ct.violation_date,
        u.full_name as added_by_name
      FROM case_citations cc2
      JOIN citations ct ON cc2.citation_id = ct.id
      LEFT JOIN users u ON cc2.added_by = u.id
      WHERE cc2.case_id = ?
      ORDER BY ct.created_at DESC
    `).all(req.params.id);
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/citations', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    ensureCaseTables();
    const db = getDb();
    const { citation_id } = req.body;
    if (!citation_id) { res.status(400).json({ error: 'citation_id required' }); return; }
    const now = localNow();
    db.prepare('INSERT OR IGNORE INTO case_citations (case_id, citation_id, added_by, created_at) VALUES (?, ?, ?, ?)').run(req.params.id, citation_id, req.user!.userId, now);
    auditLog(req, 'LINK', 'case_citation', Number(req.params.id), `Linked citation #${citation_id} to case`);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/citations/:linkId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM case_citations WHERE id = ? AND case_id = ?').run(req.params.linkId, req.params.id);
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
