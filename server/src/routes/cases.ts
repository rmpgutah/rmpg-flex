// ============================================================
// RMPG Flex — Case Management API Routes
// ============================================================
// Investigative case tracking with solvability scoring,
// investigator assignment, case notes, and record linkage.
// Auto-generates case numbers in CASE-YYYY-NNNN format.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastRecordUpdate } from '../utils/websocket';
import { localNow, localToday } from '../utils/timeUtils';
import { generateCaseNumber } from '../utils/caseNumbers';

const router = Router();
router.use(authenticateToken);

// ─── GET /stats ──────────────────────────────────────────
router.get('/stats', (req: Request, res: Response) => {
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
    console.error('Get case stats error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'STATS_ERROR' });
  }
});

// ─── GET / ───────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
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
    console.error('Get cases error:', error);
    res.status(500).json({ error: 'Failed to retrieve cases', code: 'LIST_CASES_ERROR' });
  }
});

// ─── GET /:id ────────────────────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
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
    console.error('Get case error:', error);
    res.status(500).json({ error: 'Failed to retrieve case', code: 'GET_CASE_ERROR' });
  }
});

// ─── POST / ──────────────────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { title, case_type = 'general', priority: requestedPriority, summary, lead_investigator_id, linked_call_id } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required', code: 'MISSING_TITLE' });

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
    console.error('Create case error:', error);
    res.status(500).json({ error: 'Failed to create case', code: 'CREATE_CASE_ERROR' });
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

    const fields = ['title', 'case_type', 'priority', 'summary', 'narrative', 'disposition',
      'disposition_date', 'due_date', 'lead_investigator_id', 'assigned_officers',
      'solvability_score', 'solvability_factors', 'linked_incidents', 'linked_citations',
      'linked_evidence', 'linked_persons', 'linked_field_interviews', 'linked_calls'];
    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(typeof req.body[f] === 'object' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }

    params.push(id);
    db.prepare(`UPDATE cases SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'update', 'case', ?, ?, ?)`).run(req.user!.userId, id, JSON.stringify({ fields: Object.keys(req.body) }), now);

    broadcastRecordUpdate({ type: 'case_updated', id });
    res.json({ data: { id } });
  } catch (error: any) {
    console.error('Update case error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'UPDATE_ERROR' });
  }
});

// ─── PUT /:id/submit-review — Submit case for supervisor review ─
router.put('/:id/submit-review', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id) as any;
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
    } catch { /* notifications table may not exist */ }

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

    const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id) as any;
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

    const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Case not found', code: 'CASE_NOT_FOUND' });

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
    console.error('Update case status error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'STATUS_UPDATE_ERROR' });
  }
});

// ─── POST /:id/notes ────────────────────────────────────
router.post('/:id/notes', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { content, note_type = 'general' } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required', code: 'MISSING_CONTENT' });

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
    console.error('Create case note error:', error);
    res.status(500).json({ error: 'Failed to create case note', code: 'CREATE_CASE_NOTE_ERROR' });
  }
});

// ─── GET /:id/notes ─────────────────────────────────────
router.get('/:id/notes', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const notes = db.prepare(`
      SELECT * FROM case_notes WHERE case_id = ? ORDER BY is_pinned DESC, created_at DESC
      LIMIT 500
    `).all(req.params.id);
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ data: notes });
  } catch (error: any) {
    console.error('Get case notes error:', error);
    res.status(500).json({ error: 'Failed to retrieve case notes', code: 'GET_NOTES_ERROR' });
  }
});

// ─── POST /:id/calculate-solvability ────────────────────
router.post('/:id/calculate-solvability', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { factors } = req.body; // { witness_available, physical_evidence, suspect_named, ... }

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
    console.error('Calculate solvability error:', error);
    res.status(500).json({ error: 'Failed to calculate solvability score', code: 'SOLVABILITY_ERROR' });
  }
});

export default router;
