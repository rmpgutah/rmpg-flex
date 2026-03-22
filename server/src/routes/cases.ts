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
import { localNow, localToday } from '../utils/timeUtils';
import { generateCaseNumber } from '../utils/caseNumbers';
import { validateParamId, escapeLike } from '../middleware/sanitize';
import { auditLog } from '../utils/auditLogger';
import { sendCsv } from '../utils/csvExport';

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

    res.json({
      data: {
        by_status: Object.fromEntries(statusCounts.map(r => [r.status, r.count])),
        by_type: Object.fromEntries(typeCounts.map(r => [r.case_type, r.count])),
        total: statusCounts.reduce((a: number, b: any) => a + b.count, 0),
        avg_solvability: avgSolvability?.avg || 0,
      },
    });
  } catch (error: any) {
    console.error('Get case stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
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
      where += " AND (c.case_number LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\' OR c.summary LIKE ? ESCAPE '\\')";
      const s = `%${escapeLike(String(search))}%`;
      params.push(s, s, s);
    }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM cases c ${where}`).get(...params) as any)?.count || 0;
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
    console.error('Get cases error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:id ────────────────────────────────────────────
router.get('/:id', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT c.*, u.full_name as lead_investigator_name
      FROM cases c LEFT JOIN users u ON c.lead_investigator_id = u.id
      WHERE c.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Case not found' });
    res.json({ data: row });
  } catch (error: any) {
    console.error('Get case error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST / ──────────────────────────────────────────────
router.post('/', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { title, case_type = 'general', priority = 'normal', summary, lead_investigator_id, linked_call_id } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    // Wrap in transaction to prevent duplicate case numbers from concurrent requests
    const createCase = db.transaction(() => {
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
        const callId = parseInt(String(linked_call_id), 10);
        if (isNaN(callId)) throw new Error('Invalid linked_call_id');
        db.prepare('UPDATE calls_for_service SET case_id = ?, case_number = ? WHERE id = ?')
          .run(Number(result.lastInsertRowid), case_number, callId);
      }

      auditLog(req, 'CREATE', 'case', Number(result.lastInsertRowid) as number, JSON.stringify({ case_number, title }));

      return { id: Number(result.lastInsertRowid), case_number };
    });

    const caseData = createCase();
    auditLog(req, 'CREATE' as any, 'case' as any, caseData.id, `Created case ${caseData.case_number}`);
    res.status(201).json({ data: caseData });
  } catch (error: any) {
    console.error('Create case error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id ────────────────────────────────────────────
router.put('/:id', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Case not found' });

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

    params.push(req.params.id);
    db.prepare(`UPDATE cases SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    auditLog(req, 'UPDATE', 'case', parseInt(String(req.params.id), 10), `Updated case fields: ${Object.keys(req.body).join(', ')}`);
    res.json({ data: { id: parseInt(req.params.id as string, 10) } });
  } catch (error: any) {
    console.error('Update case error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id/status ────────────────────────────────────
router.put('/:id/status', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { status } = req.body;
    const validStatuses = ['open', 'assigned', 'active', 'suspended', 'closed_cleared', 'closed_unfounded', 'closed_exception'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Case not found' });

    const updates: any = { status, updated_at: now };
    if (status.startsWith('closed_')) updates.closed_date = localToday();
    if (status === 'assigned' && !existing.assigned_at) updates.assigned_at = now;

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE cases SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), req.params.id);

    auditLog(req, 'UPDATE', 'case', parseInt(String(req.params.id), 10), `Case status changed from ${existing.status} to ${status}`);
    res.json({ data: { id: parseInt(req.params.id as string, 10), status } });
  } catch (error: any) {
    console.error('Update case status error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/notes ────────────────────────────────────
router.post('/:id/notes', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { content, note_type = 'general' } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;
    const result = db.prepare(`
      INSERT INTO case_notes (case_id, author_id, author_name, note_type, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.id, req.user!.userId, user?.full_name || '', note_type, content, now);

    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, req.params.id);
    auditLog(req, 'CREATE' as any, 'case_note' as any, Number(result.lastInsertRowid), `Added ${note_type} note to case ${req.params.id}`);
    res.status(201).json({ data: { id: Number(result.lastInsertRowid) } });
  } catch (error: any) {
    console.error('Create case note error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:id/notes ─────────────────────────────────────
router.get('/:id/notes', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const notes = db.prepare(`
      SELECT * FROM case_notes WHERE case_id = ? ORDER BY is_pinned DESC, created_at DESC
    `).all(req.params.id);
    res.json({ data: notes });
  } catch (error: any) {
    console.error('Get case notes error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/calculate-solvability ────────────────────
router.post('/:id/calculate-solvability', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
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

    auditLog(req, 'UPDATE' as any, 'case' as any, req.params.id, `Calculated solvability score: ${score}`);
    res.json({ data: { score, factors } });
  } catch (error: any) {
    console.error('Calculate solvability error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /export/csv ────────────────────────────────────
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT c.case_number, c.title, c.case_type, c.status,
             u.full_name as assigned_to_name, c.opened_date, c.closed_date
      FROM cases c
      LEFT JOIN users u ON c.lead_investigator_id = u.id
      WHERE c.archived_at IS NULL
      ORDER BY c.created_at DESC
    `).all() as any[];

    sendCsv(res, 'cases-export.csv', [
      { key: 'case_number', header: 'Case Number' },
      { key: 'title', header: 'Title' },
      { key: 'case_type', header: 'Case Type' },
      { key: 'status', header: 'Status' },
      { key: 'assigned_to_name', header: 'Assigned To' },
      { key: 'opened_date', header: 'Opened Date' },
      { key: 'closed_date', header: 'Closed Date' },
    ], rows);
  } catch (error: any) {
    console.error('Cases CSV export error:', error?.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

export default router;
