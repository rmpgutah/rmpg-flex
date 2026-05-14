import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { apiRateLimit } from '../middleware/rateLimiter';
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';
import { localNow } from '../utils/timeUtils';
import { logger } from '../utils/logger';
import { paramStr } from '../utils/reqHelpers';

const router = Router();
router.use(apiRateLimit);
router.use(authenticateToken);

// GET /api/use-of-force/stats — Dashboard stats
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM use_of_force').get() as any)?.cnt || 0;
    const pending = (db.prepare("SELECT COUNT(*) as cnt FROM use_of_force WHERE status IN ('draft','submitted')").get() as any)?.cnt || 0;
    const reviewed = (db.prepare("SELECT COUNT(*) as cnt FROM use_of_force WHERE status = 'reviewed'").get() as any)?.cnt || 0;
    const thisMonth = (db.prepare("SELECT COUNT(*) as cnt FROM use_of_force WHERE created_at >= strftime('%Y-%m-01', 'now', 'localtime')").get() as any)?.cnt || 0;
    const byType = db.prepare("SELECT force_type, COUNT(*) as count FROM use_of_force WHERE force_type IS NOT NULL GROUP BY force_type ORDER BY count DESC").all();
    const byLevel = db.prepare("SELECT force_level, COUNT(*) as count FROM use_of_force WHERE force_level IS NOT NULL GROUP BY force_level ORDER BY count DESC").all();
    res.json({ total, pending_review: pending, reviewed, this_month: thisMonth, by_type: byType, by_level: byLevel });
  } catch (error: any) {
    logger.error({ err: error }, 'UoF stats error');
    res.status(500).json({ error: 'Failed to get UoF stats', code: 'UOF_STATS_ERROR' });
  }
});

// GET /api/use-of-force — List all UoF reports with filters
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, officer_id, force_type, force_level, page = '1', per_page = '100000', search } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPage = Math.min(100000, Math.max(1, (parseInt(per_page as string, 10)) || 100000));
    const offset = (pageNum - 1) * perPage;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (status) { where += ' AND uof.status = ?'; params.push(status); }
    if (officer_id) { where += ' AND uof.officer_id = ?'; params.push(officer_id); }
    if (force_type) { where += ' AND uof.force_type = ?'; params.push(force_type); }
    if (force_level) { where += ' AND uof.force_level = ?'; params.push(force_level); }
    if (search) {
      where += ' AND (uof.narrative LIKE ? OR uof.justification LIKE ? OR u.full_name LIKE ? OR p.first_name || " " || p.last_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM use_of_force uof LEFT JOIN users u ON uof.officer_id = u.id LEFT JOIN persons p ON uof.subject_person_id = p.id ${where}`).get(...params) as any).cnt;

    const rows = db.prepare(`
      SELECT uof.*,
        u.full_name as officer_name, u.badge_number as officer_badge,
        p.first_name as subject_first_name, p.last_name as subject_last_name, p.dob as subject_dob,
        i.incident_number, i.incident_type,
        r.full_name as reviewer_name
      FROM use_of_force uof
      LEFT JOIN users u ON uof.officer_id = u.id
      LEFT JOIN persons p ON uof.subject_person_id = p.id
      LEFT JOIN incidents i ON uof.incident_id = i.id
      LEFT JOIN users r ON uof.reviewed_by = r.id
      ${where}
      ORDER BY uof.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, perPage, offset);

    res.json({ data: rows, pagination: { page: pageNum, per_page: perPage, total, totalPages: Math.ceil(total / perPage) } });
  } catch (error: any) {
    logger.error({ err: error }, 'List UoF error');
    res.status(500).json({ error: 'Failed to list UoF reports', code: 'LIST_UOF_ERROR' });
  }
});

// GET /api/use-of-force/:id — Detail
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT uof.*,
        u.full_name as officer_name, u.badge_number as officer_badge,
        p.first_name as subject_first_name, p.last_name as subject_last_name, p.dob as subject_dob,
        i.incident_number, i.incident_type,
        r.full_name as reviewer_name
      FROM use_of_force uof
      LEFT JOIN users u ON uof.officer_id = u.id
      LEFT JOIN persons p ON uof.subject_person_id = p.id
      LEFT JOIN incidents i ON uof.incident_id = i.id
      LEFT JOIN users r ON uof.reviewed_by = r.id
      WHERE uof.id = ?
    `).get(req.params.id);
    if (!row) { res.status(404).json({ error: 'UoF report not found', code: 'UOF_NOT_FOUND' }); return; }
    res.json({ data: row });
  } catch (error: any) {
    logger.error({ err: error }, 'Get UoF error');
    res.status(500).json({ error: 'Failed to get UoF report', code: 'GET_UOF_ERROR' });
  }
});

// POST /api/use-of-force — Create new UoF report
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = req.user!;
    const {
      incident_id, subject_person_id, force_type, force_level,
      justification, subject_injuries, officer_injuries,
      de_escalation_attempted, de_escalation_details,
      weapons_used, body_camera_active, witness_officers, narrative,
    } = req.body;

    if (!force_type) { res.status(400).json({ error: 'force_type is required', code: 'FORCE_TYPE_REQUIRED' }); return; }

    const now = localNow();
    const result = db.prepare(`
      INSERT INTO use_of_force (
        incident_id, officer_id, subject_person_id, force_type, force_level,
        justification, subject_injuries, officer_injuries,
        de_escalation_attempted, de_escalation_details,
        weapons_used, body_camera_active, witness_officers,
        narrative, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)
    `).run(
      incident_id || null, user.userId, subject_person_id || null,
      force_type, force_level || null,
      justification || null, subject_injuries || null, officer_injuries || null,
      de_escalation_attempted ? 1 : 0, de_escalation_details || null,
      weapons_used || null, body_camera_active ? 1 : 0,
      JSON.stringify(witness_officers || []),
      narrative || null, now, now,
    );

    auditLog(req, 'CREATE', 'use_of_force', Number(result.lastInsertRowid), `UoF report created: ${force_type}`);
    broadcast('alerts', 'uof_submitted', { id: result.lastInsertRowid, officer_id: user.userId, force_type });

    const created = db.prepare(`
      SELECT uof.*, u.full_name as officer_name FROM use_of_force uof LEFT JOIN users u ON uof.officer_id = u.id WHERE uof.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json({ data: created });
  } catch (error: any) {
    logger.error({ err: error }, 'Create UoF error');
    res.status(500).json({ error: 'Failed to create UoF report', code: 'CREATE_UOF_ERROR' });
  }
});

// PUT /api/use-of-force/:id — Update UoF report
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM use_of_force WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'UoF report not found', code: 'UOF_NOT_FOUND' }); return; }

    const fieldMap: Record<string, (v: any) => any> = {
      incident_id: v => v ?? null, subject_person_id: v => v ?? null,
      force_type: v => v ?? null, force_level: v => v ?? null,
      justification: v => v ?? null, subject_injuries: v => v ?? null,
      officer_injuries: v => v ?? null,
      de_escalation_attempted: v => v ? 1 : 0, de_escalation_details: v => v ?? null,
      weapons_used: v => v ?? null, body_camera_active: v => v ? 1 : 0,
      witness_officers: v => JSON.stringify(v || []),
      narrative: v => v ?? null, status: v => v ?? null,
    };

    const setClauses: string[] = [];
    const values: any[] = [];
    const bodyKeys = Object.keys(req.body);

    for (const [key, transform] of Object.entries(fieldMap)) {
      if (bodyKeys.includes(key)) {
        setClauses.push(`${key} = ?`);
        values.push(transform(req.body[key]));
      }
    }

    if (setClauses.length === 0) { res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS' }); return; }

    setClauses.push('updated_at = ?');
    values.push(localNow());
    values.push(req.params.id);
    db.prepare(`UPDATE use_of_force SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    auditLog(req, 'UPDATE', 'use_of_force', Number(req.params.id), `UoF report updated`);
    const updated = db.prepare(`
      SELECT uof.*, u.full_name as officer_name FROM use_of_force uof LEFT JOIN users u ON uof.officer_id = u.id WHERE uof.id = ?
    `).get(req.params.id);
    res.json({ data: updated });
  } catch (error: any) {
    logger.error({ err: error }, 'Update UoF error');
    res.status(500).json({ error: 'Failed to update UoF report', code: 'UPDATE_UOF_ERROR' });
  }
});

// PUT /api/use-of-force/:id/review — Supervisor review
router.put('/:id/review', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM use_of_force WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'UoF report not found', code: 'UOF_NOT_FOUND' }); return; }

    const now = localNow();
    const { decision, review_notes } = req.body;
    const newStatus = decision === 'approved' ? 'reviewed' : decision === 'returned' ? 'draft' : 'reviewed';

    db.prepare(`
      UPDATE use_of_force SET status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?
    `).run(newStatus, req.user!.userId, now, now, req.params.id);

    auditLog(req, 'UPDATE', 'use_of_force', Number(req.params.id), `UoF report ${decision}: ${review_notes || ''}`);
    broadcast('alerts', 'uof_reviewed', { id: parseInt(paramStr(req.params.id), 10), decision });

    const updated = db.prepare(`
      SELECT uof.*, u.full_name as officer_name, r.full_name as reviewer_name
      FROM use_of_force uof
      LEFT JOIN users u ON uof.officer_id = u.id
      LEFT JOIN users r ON uof.reviewed_by = r.id
      WHERE uof.id = ?
    `).get(req.params.id);
    res.json({ data: updated });
  } catch (error: any) {
    logger.error({ err: error }, 'Review UoF error');
    res.status(500).json({ error: 'Failed to review UoF report', code: 'REVIEW_UOF_ERROR' });
  }
});

// DELETE /api/use-of-force/:id — Delete (admin only)
router.delete('/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM use_of_force WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'UoF report not found', code: 'UOF_NOT_FOUND' }); return; }

    db.prepare('DELETE FROM use_of_force WHERE id = ?').run(req.params.id);
    auditLog(req, 'DELETE', 'use_of_force', Number(req.params.id), `UoF report deleted`);
    res.json({ success: true });
  } catch (error: any) {
    logger.error({ err: error }, 'Delete UoF error');
    res.status(500).json({ error: 'Failed to delete UoF report', code: 'DELETE_UOF_ERROR' });
  }
});

// GET /api/use-of-force/by-officer/:officerId — UoF history for officer
router.get('/by-officer/:officerId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT uof.*, i.incident_number, p.first_name as subject_first_name, p.last_name as subject_last_name
      FROM use_of_force uof
      LEFT JOIN incidents i ON uof.incident_id = i.id
      LEFT JOIN persons p ON uof.subject_person_id = p.id
      WHERE uof.officer_id = ?
      ORDER BY uof.created_at DESC
    `).all(req.params.officerId);
    res.json({ data: rows });
  } catch (error: any) {
    logger.error({ err: error }, 'UoF by officer error');
    res.status(500).json({ error: 'Failed to get officer UoF history', code: 'UOF_BY_OFFICER_ERROR' });
  }
});

export default router;
