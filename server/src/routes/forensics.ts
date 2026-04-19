// ============================================================
// RMPG Flex — Forensics Lab API Routes
// ============================================================
// Full CRUD for forensic cases, exhibits, analyses, and
// chain-of-custody activity logging.
// Lab numbers: LAB-YY-#####
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastRecordUpdate, broadcastDispatchUpdate } from '../utils/websocket';
import { localNow } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

// ── Lab Number Generation ────────────────────────────────
function generateLabNumber(): string {
  const db = getDb();
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `LAB-${yy}-`;
  const last = db.prepare(
    `SELECT lab_number FROM forensic_cases WHERE lab_number LIKE ? ORDER BY id DESC LIMIT 1`,
  ).get(`${prefix}%`) as { lab_number: string } | undefined;

  let nextNum = 1;
  if (last) {
    const match = last.lab_number.match(/LAB-\d{2}-(\d{5})/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  return `${prefix}${String(nextNum).padStart(5, '0')}`;
}

// ── Activity Log Helper ──────────────────────────────────
function logActivity(caseId: number, action: string, details: string, userId: number, userName: string, exhibitId?: number) {
  const db = getDb();
  db.prepare(`
    INSERT INTO forensic_activity_log (forensic_case_id, exhibit_id, action, details, performed_by, performed_by_name, performed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(caseId, exhibitId || null, action, details, userId, userName, localNow());
}

// ════════════════════════════════════════════════════════════
// CASES
// ════════════════════════════════════════════════════════════

// ─── GET /stats ──────────────────────────────────────────
router.get('/stats', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM forensic_cases GROUP BY status
    `).all() as any[];
    const typeCounts = db.prepare(`
      SELECT case_type, COUNT(*) as count FROM forensic_cases GROUP BY case_type
    `).all() as any[];
    const priorityCounts = db.prepare(`
      SELECT priority, COUNT(*) as count FROM forensic_cases WHERE status NOT IN ('released','cancelled') GROUP BY priority
    `).all() as any[];
    const totalExhibits = (db.prepare(`SELECT COUNT(*) as cnt FROM forensic_exhibits`).get() as any)?.cnt || 0;
    const totalAnalyses = (db.prepare(`SELECT COUNT(*) as cnt FROM forensic_analyses`).get() as any)?.cnt || 0;
    const pendingAnalyses = (db.prepare(`SELECT COUNT(*) as cnt FROM forensic_analyses WHERE status IN ('pending','in_progress')`).get() as any)?.cnt || 0;

    res.set('Cache-Control', 'private, max-age=60');
    res.json({
      data: {
        by_status: Object.fromEntries(statusCounts.map(r => [r.status, r.count])),
        by_type: Object.fromEntries(typeCounts.map(r => [r.case_type, r.count])),
        by_priority: Object.fromEntries(priorityCounts.map(r => [r.priority, r.count])),
        total: statusCounts.reduce((a: number, b: any) => a + b.count, 0),
        total_exhibits: totalExhibits,
        total_analyses: totalAnalyses,
        pending_analyses: pendingAnalyses,
      },
    });
  } catch (error: any) {
    console.error('Forensics stats error:', error);
    res.status(500).json({ error: 'Failed to forensics stats', code: 'FORENSICS_STATS_ERROR' });
  }
});

// ─── GET / ───────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, case_type, priority, search, page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (status) { where += ' AND fc.status = ?'; params.push(status); }
    if (case_type) { where += ' AND fc.case_type = ?'; params.push(case_type); }
    if (priority) { where += ' AND fc.priority = ?'; params.push(priority); }
    if (search) {
      where += ' AND (fc.lab_number LIKE ? OR fc.title LIKE ? OR fc.description LIKE ? OR fc.requesting_officer LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM forensic_cases fc ${where}`).get(...params) as any).count;

    const rows = db.prepare(`
      SELECT fc.*,
        u.full_name as lead_examiner_name,
        cb.full_name as created_by_name,
        (SELECT COUNT(*) FROM forensic_exhibits WHERE forensic_case_id = fc.id) as exhibit_count,
        (SELECT COUNT(*) FROM forensic_analyses WHERE forensic_case_id = fc.id) as analysis_count,
        (SELECT COUNT(*) FROM forensic_analyses WHERE forensic_case_id = fc.id AND status = 'completed') as completed_analysis_count
      FROM forensic_cases fc
      LEFT JOIN users u ON fc.lead_examiner_id = u.id
      LEFT JOIN users cb ON fc.created_by = cb.id
      ${where}
      ORDER BY
        CASE fc.priority WHEN 'urgent' THEN 0 WHEN 'rush' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        CASE fc.status WHEN 'received' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'analysis_complete' THEN 2
          WHEN 'report_drafted' THEN 3 WHEN 'reviewed' THEN 4 WHEN 'released' THEN 5 ELSE 6 END,
        fc.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    console.error('Get forensic cases error:', error);
    res.status(500).json({ error: 'Failed to get forensic cases', code: 'GET_FORENSIC_CASES_ERROR' });
  }
});

// ─── GET /:id ────────────────────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid forensic case ID', code: 'INVALID_FORENSIC_CASE_ID' }); return; }
    const row = db.prepare(`
      SELECT fc.*,
        u.full_name as lead_examiner_name,
        cb.full_name as created_by_name
      FROM forensic_cases fc
      LEFT JOIN users u ON fc.lead_examiner_id = u.id
      LEFT JOIN users cb ON fc.created_by = cb.id
      WHERE fc.id = ?
    `).get(id);
    if (!row) return res.status(404).json({ error: 'Forensic case not found', code: 'FORENSIC_CASE_NOT_FOUND' });
    res.json({ data: row });
  } catch (error: any) {
    console.error('Get forensic case error:', error);
    res.status(500).json({ error: 'Failed to get forensic case', code: 'GET_FORENSIC_CASE_ERROR' });
  }
});

// ─── POST / ──────────────────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const {
      case_type = 'general', priority = 'normal', title, description,
      requesting_agency = 'RMPG', requesting_officer, lead_examiner_id,
      linked_incident_id, linked_case_id, linked_incident_number,
      linked_case_number, due_date, notes,
    } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: 'Title is required', code: 'MISSING_TITLE' });

    // Validate priority
    const validPriorities = ['normal', 'rush', 'urgent'];
    if (!validPriorities.includes(priority)) return res.status(400).json({ error: 'Invalid priority', code: 'INVALID_PRIORITY' });

    // Input sanitization
    const cleanTitle = typeof title === 'string' ? title.trim() : title;
    const cleanDescription = typeof description === 'string' ? description.trim() : description;

    const lab_number = generateLabNumber();
    const now = localNow();

    const result = db.prepare(`
      INSERT INTO forensic_cases (
        lab_number, case_type, status, priority, title, description,
        requesting_agency, requesting_officer, lead_examiner_id,
        linked_incident_id, linked_case_id, linked_incident_number,
        linked_case_number, received_date, due_date, notes,
        created_by, created_at, updated_at
      ) VALUES (?, ?, 'received', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      lab_number, case_type, priority, title.trim(), description || null,
      requesting_agency, requesting_officer || null, lead_examiner_id || null,
      linked_incident_id || null, linked_case_id || null,
      linked_incident_number || null, linked_case_number || null,
      now, due_date || null, notes || null,
      user.id, now, now,
    );

    logActivity(result.lastInsertRowid as number, 'case_created', `Lab case ${lab_number} created`, user.id, user.full_name);
    auditLog(req, 'CREATE', 'forensic_case', result.lastInsertRowid as number, `Created forensic case ${lab_number}`);
    broadcastRecordUpdate({ type: 'forensic_case_created', id: result.lastInsertRowid, lab_number });

    const newCase = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ data: newCase });
  } catch (error: any) {
    console.error('Create forensic case error:', error);
    console.error('[Forensics] Error:', error?.message);
    res.status(500).json({ error: 'Internal server error', code: 'CREATE_FORENSIC_ERROR' });
  }
});

// ─── PUT /:id ────────────────────────────────────────────
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const existing = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Forensic case not found', code: 'FORENSIC_CASE_NOT_FOUND' });

    const {
      case_type, priority, title, description, status,
      requesting_agency, requesting_officer, lead_examiner_id,
      linked_incident_id, linked_case_id, linked_incident_number,
      linked_case_number, due_date, notes,
    } = req.body;

    const now = localNow();
    const newStatus = status || existing.status;
    let completed_date = existing.completed_date;
    let released_date = existing.released_date;

    // God Mode: admin can release evidence without supervisor approval
    if (user.role === 'admin' && newStatus === 'released' && existing.status !== 'released') {
      auditLog(req, 'ADMIN_OVERRIDE', 'forensic_case', existing.id, `Admin God Mode: releasing forensic case ${existing.lab_number} without supervisor approval`);
    }

    if (newStatus === 'analysis_complete' && !completed_date) completed_date = now;
    if (newStatus === 'released' && !released_date) released_date = now;

    db.prepare(`
      UPDATE forensic_cases SET
        case_type = ?, priority = ?, title = ?, description = ?, status = ?,
        requesting_agency = ?, requesting_officer = ?, lead_examiner_id = ?,
        linked_incident_id = ?, linked_case_id = ?, linked_incident_number = ?,
        linked_case_number = ?, due_date = ?, completed_date = ?, released_date = ?,
        notes = ?, updated_at = ?
      WHERE id = ?
    `).run(
      case_type || existing.case_type, priority || existing.priority,
      title || existing.title, description ?? existing.description,
      newStatus,
      requesting_agency ?? existing.requesting_agency,
      requesting_officer ?? existing.requesting_officer,
      lead_examiner_id ?? existing.lead_examiner_id,
      linked_incident_id ?? existing.linked_incident_id,
      linked_case_id ?? existing.linked_case_id,
      linked_incident_number ?? existing.linked_incident_number,
      linked_case_number ?? existing.linked_case_number,
      due_date ?? existing.due_date,
      completed_date, released_date,
      notes ?? existing.notes, now, req.params.id,
    );

    if (status && status !== existing.status) {
      logActivity(existing.id, 'status_changed', `Status: ${existing.status} → ${status}`, user.id, user.full_name);
    }

    const updated = db.prepare(`
      SELECT fc.*, u.full_name as lead_examiner_name, cb.full_name as created_by_name
      FROM forensic_cases fc
      LEFT JOIN users u ON fc.lead_examiner_id = u.id
      LEFT JOIN users cb ON fc.created_by = cb.id
      WHERE fc.id = ?
    `).get(req.params.id);
    res.json({ data: updated });
  } catch (error: any) {
    console.error('Update forensic case error:', error);
    console.error('[Forensics] Error:', error?.message);
    res.status(500).json({ error: 'Failed to [forensics]', code: 'FORENSICS_ERROR' });
  }
});

// ─── DELETE /:id ─────────────────────────────────────────
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Forensic case not found', code: 'FORENSIC_CASE_NOT_FOUND' });
    db.prepare('DELETE FROM forensic_cases WHERE id = ?').run(req.params.id);
    res.json({ message: 'Forensic case deleted' });
  } catch (error: any) {
    console.error('Delete forensic case error:', error);
    res.status(500).json({ error: 'Failed to delete forensic case', code: 'DELETE_FORENSIC_CASE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// EXHIBITS
// ════════════════════════════════════════════════════════════

// ─── GET /:caseId/exhibits ───────────────────────────────
router.get('/:caseId/exhibits', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM forensic_exhibits WHERE forensic_case_id = ? ORDER BY exhibit_number
    
      LIMIT 1000
    `).all(req.params.caseId);
    res.json({ data: rows });
  } catch (error: any) {
    console.error('Get exhibits error:', error);
    res.status(500).json({ error: 'Failed to get exhibits', code: 'GET_EXHIBITS_ERROR' });
  }
});

// ─── POST /:caseId/exhibits ──────────────────────────────
router.post('/:caseId/exhibits', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const fc = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.caseId) as any;
    if (!fc) return res.status(404).json({ error: 'Forensic case not found', code: 'FORENSIC_CASE_NOT_FOUND' });

    const {
      exhibit_type = 'other', description, quantity = 1, condition_received,
      storage_location, storage_temp, collected_by, collected_date,
      collection_method, hash_md5, hash_sha256, notes,
      examination_requested, // previously silent-dropped (gotcha #38)
    } = req.body;

    if (!description?.trim()) return res.status(400).json({ error: 'Description is required', code: 'DESCRIPTION_IS_REQUIRED' });

    // Auto-generate exhibit number
    const lastExhibit = db.prepare(
      `SELECT exhibit_number FROM forensic_exhibits WHERE forensic_case_id = ? ORDER BY id DESC LIMIT 1`
    ).get(req.params.caseId) as any;
    let nextNum = 1;
    if (lastExhibit) {
      const match = lastExhibit.exhibit_number.match(/(\d+)$/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    const exhibit_number = `EX-${String(nextNum).padStart(3, '0')}`;

    const now = localNow();
    const initialCustody = JSON.stringify([{
      action: 'received',
      by: user.full_name,
      at: now,
      notes: 'Initial intake',
    }]);

    const result = db.prepare(`
      INSERT INTO forensic_exhibits (
        forensic_case_id, exhibit_number, exhibit_type, description, quantity,
        condition_received, storage_location, storage_temp, collected_by,
        collected_date, collection_method, hash_md5, hash_sha256,
        chain_of_custody, notes, examination_requested, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.caseId, exhibit_number, exhibit_type, description.trim(), quantity,
      condition_received || null, storage_location || null, storage_temp || null,
      collected_by || null, collected_date || null, collection_method || null,
      hash_md5 || null, hash_sha256 || null, initialCustody,
      notes || null, examination_requested || null, now, now,
    );

    logActivity(parseInt(req.params.caseId as string), 'exhibit_added', `Exhibit ${exhibit_number}: ${description}`, user.id, user.full_name, result.lastInsertRowid as number);

    const newExhibit = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ?').get(result.lastInsertRowid);

    // Dispatcher Brain fan-in (Phase 2): evidence-logged rule. The tag
    // number is the exhibit_number; case number is the forensic case id.
    broadcastDispatchUpdate({
      action: 'evidence_logged',
      tag_number: exhibit_number,
      case_number: req.params.caseId,
    });

    res.status(201).json({ data: newExhibit });
  } catch (error: any) {
    console.error('Create exhibit error:', error);
    console.error('[Forensics] Error:', error?.message);
    res.status(500).json({ error: 'Failed to [forensics]', code: 'FORENSICS_ERROR' });
  }
});

// ─── PUT /:caseId/exhibits/:exhibitId ────────────────────
router.put('/:caseId/exhibits/:exhibitId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const existing = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?').get(req.params.exhibitId, req.params.caseId) as any;
    if (!existing) return res.status(404).json({ error: 'Exhibit not found', code: 'EXHIBIT_NOT_FOUND' });

    const {
      exhibit_type, description, quantity, condition_received,
      storage_location, storage_temp, collected_by, collected_date,
      collection_method, hash_md5, hash_sha256, disposition,
      disposition_date, disposition_notes, notes,
    } = req.body;

    const now = localNow();
    db.prepare(`
      UPDATE forensic_exhibits SET
        exhibit_type = ?, description = ?, quantity = ?, condition_received = ?,
        storage_location = ?, storage_temp = ?, collected_by = ?, collected_date = ?,
        collection_method = ?, hash_md5 = ?, hash_sha256 = ?, disposition = ?,
        disposition_date = ?, disposition_notes = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(
      exhibit_type || existing.exhibit_type, description || existing.description,
      quantity ?? existing.quantity, condition_received ?? existing.condition_received,
      storage_location ?? existing.storage_location, storage_temp ?? existing.storage_temp,
      collected_by ?? existing.collected_by, collected_date ?? existing.collected_date,
      collection_method ?? existing.collection_method, hash_md5 ?? existing.hash_md5,
      hash_sha256 ?? existing.hash_sha256, disposition ?? existing.disposition,
      disposition_date ?? existing.disposition_date, disposition_notes ?? existing.disposition_notes,
      notes ?? existing.notes, now, req.params.exhibitId,
    );

    if (disposition && disposition !== existing.disposition) {
      logActivity(parseInt(req.params.caseId as string), 'exhibit_disposition', `Exhibit ${existing.exhibit_number}: ${existing.disposition} → ${disposition}`, user.id, user.full_name, existing.id);
    }

    const updated = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ?').get(req.params.exhibitId);
    res.json({ data: updated });
  } catch (error: any) {
    console.error('Update exhibit error:', error);
    console.error('[Forensics] Error:', error?.message);
    res.status(500).json({ error: 'Failed to [forensics]', code: 'FORENSICS_ERROR' });
  }
});

// ─── DELETE /:caseId/exhibits/:exhibitId ─────────────────
router.delete('/:caseId/exhibits/:exhibitId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const existing = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?').get(req.params.exhibitId, req.params.caseId) as any;
    if (!existing) return res.status(404).json({ error: 'Exhibit not found', code: 'EXHIBIT_NOT_FOUND' });

    // God Mode: admin can delete evidence items
    if (user.role === 'admin') {
      auditLog(req, 'ADMIN_OVERRIDE', 'forensic_exhibit', existing.id, `Admin God Mode: deleting exhibit ${existing.exhibit_number}`);
    }

    db.prepare('DELETE FROM forensic_exhibits WHERE id = ?').run(req.params.exhibitId);
    logActivity(parseInt(req.params.caseId as string), 'exhibit_deleted', `Exhibit ${existing.exhibit_number} deleted`, user.id, user.full_name);
    res.json({ message: 'Exhibit deleted' });
  } catch (error: any) {
    console.error('Delete exhibit error:', error);
    res.status(500).json({ error: 'Failed to delete exhibit', code: 'DELETE_EXHIBIT_ERROR' });
  }
});

// ─── POST /:caseId/exhibits/:exhibitId/custody ───────────
router.post('/:caseId/exhibits/:exhibitId/custody', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const existing = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?').get(req.params.exhibitId, req.params.caseId) as any;
    if (!existing) return res.status(404).json({ error: 'Exhibit not found', code: 'EXHIBIT_NOT_FOUND' });

    const { action, notes: custodyNotes } = req.body;
    if (!action) return res.status(400).json({ error: 'Action is required', code: 'ACTION_IS_REQUIRED' });

    // God Mode: admin can break chain of custody (add any action without supervisor approval)
    if (user.role === 'admin') {
      auditLog(req, 'ADMIN_OVERRIDE', 'forensic_exhibit', existing.id, `Admin God Mode: chain of custody action "${action}" on exhibit ${existing.exhibit_number} (no supervisor approval required)`);
    }

    const chain = JSON.parse(existing.chain_of_custody || '[]');
    chain.push({ action, by: user.full_name, at: localNow(), notes: custodyNotes || '', admin_override: user.role === 'admin' });

    db.prepare('UPDATE forensic_exhibits SET chain_of_custody = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(chain), localNow(), existing.id);

    logActivity(parseInt(req.params.caseId as string), 'custody_transfer', `${existing.exhibit_number}: ${action}`, user.id, user.full_name, existing.id);

    const updated = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ?').get(existing.id);
    res.json({ data: updated });
  } catch (error: any) {
    console.error('Custody update error:', error);
    res.status(500).json({ error: 'Failed to custody update', code: 'CUSTODY_UPDATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// ANALYSES
// ════════════════════════════════════════════════════════════

// ─── GET /:caseId/analyses ───────────────────────────────
router.get('/:caseId/analyses', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT a.*, u.full_name as examiner_name, e.exhibit_number
      FROM forensic_analyses a
      LEFT JOIN users u ON a.examiner_id = u.id
      LEFT JOIN forensic_exhibits e ON a.exhibit_id = e.id
      WHERE a.forensic_case_id = ?
      ORDER BY a.created_at DESC
    
      LIMIT 1000
    `).all(req.params.caseId);
    res.json({ data: rows });
  } catch (error: any) {
    console.error('Get analyses error:', error);
    res.status(500).json({ error: 'Failed to get analyses', code: 'GET_ANALYSES_ERROR' });
  }
});

// ─── POST /:caseId/analyses ──────────────────────────────
router.post('/:caseId/analyses', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const fc = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.caseId) as any;
    if (!fc) return res.status(404).json({ error: 'Forensic case not found', code: 'FORENSIC_CASE_NOT_FOUND' });

    const {
      exhibit_id, analysis_type, methodology, equipment_used,
      examiner_id, notes,
    } = req.body;

    if (!analysis_type) return res.status(400).json({ error: 'Analysis type is required', code: 'ANALYSIS_TYPE_IS_REQUIRED' });

    const now = localNow();
    const result = db.prepare(`
      INSERT INTO forensic_analyses (
        forensic_case_id, exhibit_id, analysis_type, methodology,
        equipment_used, examiner_id, status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      req.params.caseId, exhibit_id || null, analysis_type,
      methodology || null, equipment_used || null,
      examiner_id || user.id, notes || null, now, now,
    );

    logActivity(parseInt(req.params.caseId as string), 'analysis_created', `${analysis_type} analysis created`, user.id, user.full_name);

    const newAnalysis = db.prepare(`
      SELECT a.*, u.full_name as examiner_name, e.exhibit_number
      FROM forensic_analyses a
      LEFT JOIN users u ON a.examiner_id = u.id
      LEFT JOIN forensic_exhibits e ON a.exhibit_id = e.id
      WHERE a.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json({ data: newAnalysis });
  } catch (error: any) {
    console.error('Create analysis error:', error);
    console.error('[Forensics] Error:', error?.message);
    res.status(500).json({ error: 'Failed to [forensics]', code: 'FORENSICS_ERROR' });
  }
});

// ─── PUT /:caseId/analyses/:analysisId ───────────────────
router.put('/:caseId/analyses/:analysisId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const existing = db.prepare('SELECT * FROM forensic_analyses WHERE id = ? AND forensic_case_id = ?').get(req.params.analysisId, req.params.caseId) as any;
    if (!existing) return res.status(404).json({ error: 'Analysis not found', code: 'ANALYSIS_NOT_FOUND' });

    const {
      analysis_type, methodology, equipment_used, examiner_id,
      status, started_at, completed_at, results, conclusion,
      limitations, notes,
    } = req.body;

    const now = localNow();
    const newStatus = status || existing.status;
    let newStarted = started_at ?? existing.started_at;
    let newCompleted = completed_at ?? existing.completed_at;

    if (newStatus === 'in_progress' && !newStarted) newStarted = now;
    if ((newStatus === 'completed' || newStatus === 'inconclusive') && !newCompleted) newCompleted = now;

    db.prepare(`
      UPDATE forensic_analyses SET
        analysis_type = ?, methodology = ?, equipment_used = ?, examiner_id = ?,
        status = ?, started_at = ?, completed_at = ?, results = ?,
        conclusion = ?, limitations = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(
      analysis_type || existing.analysis_type, methodology ?? existing.methodology,
      equipment_used ?? existing.equipment_used, examiner_id ?? existing.examiner_id,
      newStatus, newStarted, newCompleted,
      results ?? existing.results, conclusion ?? existing.conclusion,
      limitations ?? existing.limitations, notes ?? existing.notes,
      now, req.params.analysisId,
    );

    if (status && status !== existing.status) {
      logActivity(parseInt(req.params.caseId as string), 'analysis_status', `${existing.analysis_type}: ${existing.status} → ${status}`, user.id, user.full_name);
    }

    const updated = db.prepare(`
      SELECT a.*, u.full_name as examiner_name, e.exhibit_number
      FROM forensic_analyses a
      LEFT JOIN users u ON a.examiner_id = u.id
      LEFT JOIN forensic_exhibits e ON a.exhibit_id = e.id
      WHERE a.id = ?
    `).get(req.params.analysisId);
    res.json({ data: updated });
  } catch (error: any) {
    console.error('Update analysis error:', error);
    console.error('[Forensics] Error:', error?.message);
    res.status(500).json({ error: 'Failed to [forensics]', code: 'FORENSICS_ERROR' });
  }
});

// ─── DELETE /:caseId/analyses/:analysisId ────────────────
router.delete('/:caseId/analyses/:analysisId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const existing = db.prepare('SELECT * FROM forensic_analyses WHERE id = ? AND forensic_case_id = ?').get(req.params.analysisId, req.params.caseId) as any;
    if (!existing) return res.status(404).json({ error: 'Analysis not found', code: 'ANALYSIS_NOT_FOUND' });
    db.prepare('DELETE FROM forensic_analyses WHERE id = ?').run(req.params.analysisId);
    logActivity(parseInt(req.params.caseId as string), 'analysis_deleted', `${existing.analysis_type} analysis deleted`, user.id, user.full_name);
    res.json({ message: 'Analysis deleted' });
  } catch (error: any) {
    console.error('Delete analysis error:', error);
    res.status(500).json({ error: 'Failed to delete analysis', code: 'DELETE_ANALYSIS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// ACTIVITY LOG
// ════════════════════════════════════════════════════════════

router.get('/:caseId/activity', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM forensic_activity_log WHERE forensic_case_id = ? ORDER BY performed_at DESC
    
      LIMIT 1000
    `).all(req.params.caseId);
    res.json({ data: rows });
  } catch (error: any) {
    console.error('Get activity log error:', error);
    res.status(500).json({ error: 'Failed to get activity log', code: 'GET_ACTIVITY_LOG_ERROR' });
  }
});

// ============================================================
// ── Hash Set Management ─────────────────────────────────────
// ============================================================

// GET /api/forensics/hash-sets — List all hash sets
router.get('/hash-sets', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const sets = db.prepare(`
      SELECT * FROM forensic_hash_sets ORDER BY created_at DESC
    
      LIMIT 1000
    `).all();
    res.json({ data: sets });
  } catch (error: any) {
    console.error('Get hash sets error:', error);
    res.status(500).json({ error: 'Failed to get hash sets', code: 'GET_HASH_SETS_ERROR' });
  }
});

// POST /api/forensics/hash-sets — Create hash set with optional CSV entries
router.post('/hash-sets', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, set_type, description, version, entries } = req.body;

    if (!name || !set_type) {
      res.status(400).json({ error: 'Name and set_type are required', code: 'NAME_AND_SETTYPE_ARE' });
      return;
    }

    const now = localNow();
    const userName = (req as any).user?.username || 'unknown';
    const userId = (req as any).user?.userId || null;

    const insertSet = db.prepare(`
      INSERT INTO forensic_hash_sets (name, set_type, description, version, imported_by, imported_by_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = insertSet.run(name, set_type, description || null, version || null, userId, userName, now, now);
    const setId = result.lastInsertRowid;

    // Bulk insert entries if provided
    let hashCount = 0;
    if (Array.isArray(entries) && entries.length > 0) {
      const insertEntry = db.prepare(`
        INSERT OR IGNORE INTO forensic_hash_entries (hash_set_id, hash_value, hash_type, file_name, file_size, category)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const bulkInsert = db.transaction((items: any[]) => {
        for (const entry of items) {
          // Support multiple hash columns per row
          if (entry.md5) { insertEntry.run(setId, entry.md5.toLowerCase(), 'md5', entry.file_name || null, entry.file_size || null, entry.category || null); hashCount++; }
          if (entry.sha1) { insertEntry.run(setId, entry.sha1.toLowerCase(), 'sha1', entry.file_name || null, entry.file_size || null, entry.category || null); hashCount++; }
          if (entry.sha256) { insertEntry.run(setId, entry.sha256.toLowerCase(), 'sha256', entry.file_name || null, entry.file_size || null, entry.category || null); hashCount++; }
          // Fallback: single hash_value + hash_type
          if (!entry.md5 && !entry.sha1 && !entry.sha256 && entry.hash_value && entry.hash_type) {
            insertEntry.run(setId, entry.hash_value.toLowerCase(), entry.hash_type, entry.file_name || null, entry.file_size || null, entry.category || null);
            hashCount++;
          }
        }
      });
      bulkInsert(entries);

      // Update hash count on the set
      db.prepare('UPDATE forensic_hash_sets SET hash_count = ?, updated_at = ? WHERE id = ?').run(hashCount, now, setId);
    }

    const created = db.prepare('SELECT * FROM forensic_hash_sets WHERE id = ?').get(setId);
    res.status(201).json({ data: created, hash_count: hashCount });
  } catch (error: any) {
    console.error('Create hash set error:', error);
    res.status(500).json({ error: 'Failed to create hash set', code: 'CREATE_HASH_SET_ERROR' });
  }
});

// DELETE /api/forensics/hash-sets/:id — Delete hash set and all entries
router.delete('/hash-sets/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }

    const existing = db.prepare('SELECT id, name FROM forensic_hash_sets WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ error: 'Hash set not found', code: 'HASH_SET_NOT_FOUND' }); return; }

    // CASCADE will remove entries
    db.prepare('DELETE FROM forensic_hash_sets WHERE id = ?').run(id);
    res.json({ message: `Hash set "${existing.name}" deleted` });
  } catch (error: any) {
    console.error('Delete hash set error:', error);
    res.status(500).json({ error: 'Failed to delete hash set', code: 'DELETE_HASH_SET_ERROR' });
  }
});

// POST /api/forensics/hash-sets/check — Check hashes against loaded sets
router.post('/hash-sets/check', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { hashes } = req.body; // string[] of hash values

    if (!Array.isArray(hashes) || hashes.length === 0) {
      res.status(400).json({ error: 'Provide an array of hashes', code: 'PROVIDE_AN_ARRAY_OF' });
      return;
    }

    const placeholders = hashes.map(() => '?').join(',');
    const lowerHashes = hashes.map((h: string) => h.toLowerCase());

    const matches = db.prepare(`
      SELECT e.hash_value, e.hash_type, e.file_name, e.category,
             s.id as set_id, s.name as set_name, s.set_type
      FROM forensic_hash_entries e
      JOIN forensic_hash_sets s ON s.id = e.hash_set_id
      WHERE LOWER(e.hash_value) IN (${placeholders})
    
      LIMIT 1000
    `).all(...lowerHashes) as any[];

    // Group by hash value
    const results: Record<string, any[]> = {};
    for (const m of matches) {
      if (!results[m.hash_value]) results[m.hash_value] = [];
      results[m.hash_value].push({
        set_id: m.set_id,
        set_name: m.set_name,
        set_type: m.set_type,
        hash_type: m.hash_type,
        file_name: m.file_name,
        category: m.category,
      });
    }

    res.json({ data: results, total_matches: matches.length });
  } catch (error: any) {
    console.error('Hash check error:', error);
    res.status(500).json({ error: 'Failed to hash check', code: 'HASH_CHECK_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 26: Evidence Intake Form (standardized)
// ════════════════════════════════════════════════════════════

router.post('/:caseId/evidence-intake', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const fc = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.caseId) as any;
    if (!fc) return res.status(404).json({ error: 'Forensic case not found', code: 'FORENSIC_CASE_NOT_FOUND' });

    const {
      item_description, item_type, item_make, item_model, item_serial,
      condition_on_receipt, packaging_type, packaging_sealed,
      collected_by, collected_date, collected_location,
      chain_of_custody_from, storage_location, storage_requirements,
      hazardous, biohazard, notes,
    } = req.body;

    if (!item_description) return res.status(400).json({ error: 'item_description is required', code: 'ITEMDESCRIPTION_IS_REQUIRED' });

    const now = localNow();
    // Auto-generate exhibit number
    const exhibitCount = (db.prepare('SELECT COUNT(*) as cnt FROM forensic_exhibits WHERE forensic_case_id = ?').get(req.params.caseId) as any).cnt;
    const exhibit_number = `${fc.lab_number}-E${String(exhibitCount + 1).padStart(3, '0')}`;

    const info = db.prepare(`
      INSERT INTO forensic_exhibits (
        forensic_case_id, exhibit_number, description, evidence_type,
        device_make, device_model, device_serial,
        condition_on_receipt, packaging_type, packaging_sealed,
        collected_by, collected_date, collected_location,
        received_from, storage_location, storage_requirements,
        is_hazardous, is_biohazard, notes,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)
    `).run(
      req.params.caseId, exhibit_number, item_description, item_type || 'other',
      item_make || null, item_model || null, item_serial || null,
      condition_on_receipt || 'good', packaging_type || 'sealed_bag',
      packaging_sealed ? 1 : 0,
      collected_by || user.full_name, collected_date || now, collected_location || '',
      chain_of_custody_from || '', storage_location || 'Evidence Locker',
      storage_requirements || 'standard',
      hazardous ? 1 : 0, biohazard ? 1 : 0, notes || '',
      now, now
    );

    logActivity(parseInt(req.params.caseId as string), 'evidence_intake', `Evidence intake: ${exhibit_number} — ${item_description}`, user.id, user.full_name, Number(info.lastInsertRowid));

    const exhibit = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ data: exhibit });
  } catch (error: any) {
    console.error('Evidence intake error:', error);
    console.error('[Forensics] Error:', error?.message);
    res.status(500).json({ error: 'Failed to [forensics]', code: 'FORENSICS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 27: Lab Queue Management
// ════════════════════════════════════════════════════════════

router.get('/queue/priority', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const queue = db.prepare(`
      SELECT fc.id, fc.lab_number, fc.title, fc.case_type, fc.priority, fc.status,
             fc.received_date, fc.due_date, fc.lead_examiner_id,
             u.full_name as lead_examiner_name,
             (SELECT COUNT(*) FROM forensic_exhibits WHERE forensic_case_id = fc.id) as exhibit_count,
             (SELECT COUNT(*) FROM forensic_analyses WHERE forensic_case_id = fc.id AND status IN ('pending','in_progress')) as pending_analyses,
             CASE fc.priority
               WHEN 'rush' THEN 1 WHEN 'urgent' THEN 2 WHEN 'expedited' THEN 3 ELSE 4
             END as priority_order,
             JULIANDAY(COALESCE(fc.due_date, '9999-12-31')) - JULIANDAY('now') as days_until_due
      FROM forensic_cases fc
      LEFT JOIN users u ON fc.lead_examiner_id = u.id
      WHERE fc.status NOT IN ('closed', 'cancelled', 'released')
      ORDER BY priority_order ASC, days_until_due ASC, fc.received_date ASC
    `).all();

    res.json({ data: queue });
  } catch (error: any) {
    console.error('Lab queue error:', error);
    res.status(500).json({ error: 'Failed to lab queue', code: 'LAB_QUEUE_ERROR' });
  }
});

router.put('/queue/reorder', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { case_id, new_priority } = req.body;
    if (!case_id || !new_priority) return res.status(400).json({ error: 'case_id and new_priority required', code: 'CASEID_AND_NEWPRIORITY_REQUIRED' });

    const valid = ['routine', 'expedited', 'urgent', 'rush'];
    if (!valid.includes(new_priority)) return res.status(400).json({ error: 'Invalid priority', code: 'INVALID_PRIORITY' });

    db.prepare('UPDATE forensic_cases SET priority = ?, updated_at = ? WHERE id = ?')
      .run(new_priority, localNow(), case_id);

    const user = (req as any).user;
    logActivity(case_id, 'priority_changed', `Priority changed to ${new_priority}`, user.id, user.full_name);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 28: Chain of Custody Transfer (digital signature)
// ════════════════════════════════════════════════════════════

router.post('/:caseId/exhibits/:exhibitId/custody-transfer', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const exhibit = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?')
      .get(req.params.exhibitId, req.params.caseId) as any;
    if (!exhibit) return res.status(404).json({ error: 'Exhibit not found', code: 'EXHIBIT_NOT_FOUND' });

    const { transferred_to_id, transferred_to_name, reason, signature_data, location } = req.body;
    if (!transferred_to_name && !transferred_to_id) return res.status(400).json({ error: 'transferred_to is required', code: 'TRANSFERREDTO_IS_REQUIRED' });

    const now = localNow();
    const transferData = {
      exhibit_id: exhibit.id,
      exhibit_number: exhibit.exhibit_number,
      transferred_from_id: user.id,
      transferred_from_name: user.full_name,
      transferred_to_id: transferred_to_id || null,
      transferred_to_name: transferred_to_name || '',
      reason: reason || 'examination',
      signature_data: signature_data || null,
      location: location || '',
      transferred_at: now,
    };

    logActivity(
      parseInt(req.params.caseId as string),
      'custody_transfer',
      `Custody transfer: ${exhibit.exhibit_number} from ${user.full_name} to ${transferred_to_name || 'unknown'}. Reason: ${reason || 'examination'}`,
      user.id, user.full_name, exhibit.id
    );

    // Update exhibit current custodian
    db.prepare('UPDATE forensic_exhibits SET current_custodian = ?, current_custodian_id = ?, updated_at = ? WHERE id = ?')
      .run(transferred_to_name || '', transferred_to_id || null, now, exhibit.id);

    res.status(201).json({ data: transferData });
  } catch (error: any) {
    console.error('Custody transfer error:', error);
    console.error('[Forensics] Error:', error?.message);
    res.status(500).json({ error: 'Failed to [forensics]', code: 'FORENSICS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 29: Exam Report Template
// ════════════════════════════════════════════════════════════

router.get('/templates/report', (_req: Request, res: Response) => {
  const templates: Record<string, any> = {
    digital: {
      title: 'Digital Forensics Examination Report',
      sections: [
        { name: 'Case Information', fields: ['lab_number', 'case_type', 'requesting_agency', 'requesting_officer', 'received_date'] },
        { name: 'Evidence Description', fields: ['device_type', 'make', 'model', 'serial', 'condition'] },
        { name: 'Examination Methodology', fields: ['tools_used', 'imaging_method', 'hash_algorithm', 'source_hash', 'image_hash'] },
        { name: 'Findings', fields: ['files_recovered', 'artifacts_found', 'timeline_events', 'notable_items'] },
        { name: 'Conclusions', fields: ['summary', 'opinion'] },
        { name: 'Examiner Certification', fields: ['examiner_name', 'examiner_credentials', 'signature', 'date'] },
      ],
    },
    biological: {
      title: 'Biological Evidence Examination Report',
      sections: [
        { name: 'Case Information', fields: ['lab_number', 'requesting_agency', 'received_date'] },
        { name: 'Evidence Description', fields: ['sample_type', 'quantity', 'collection_method', 'storage_conditions'] },
        { name: 'Testing Methodology', fields: ['test_type', 'reagents_used', 'controls'] },
        { name: 'Results', fields: ['positive_findings', 'negative_findings', 'quantitative_results'] },
        { name: 'Conclusions', fields: ['interpretation', 'statistical_analysis'] },
        { name: 'Examiner Certification', fields: ['examiner_name', 'credentials', 'signature', 'date'] },
      ],
    },
    latent_prints: {
      title: 'Latent Print Examination Report',
      sections: [
        { name: 'Case Information', fields: ['lab_number', 'requesting_agency', 'received_date'] },
        { name: 'Evidence Processed', fields: ['surface_type', 'processing_method', 'prints_developed'] },
        { name: 'Comparison Results', fields: ['identified_prints', 'inconclusive_prints', 'eliminated_prints'] },
        { name: 'Conclusions', fields: ['identification_summary'] },
        { name: 'Examiner Certification', fields: ['examiner_name', 'signature', 'date'] },
      ],
    },
    drug_analysis: {
      title: 'Controlled Substance Analysis Report',
      sections: [
        { name: 'Case Information', fields: ['lab_number', 'requesting_agency', 'received_date'] },
        { name: 'Evidence Description', fields: ['appearance', 'packaging', 'gross_weight', 'net_weight'] },
        { name: 'Analysis', fields: ['presumptive_test', 'confirmatory_test', 'instrument_used'] },
        { name: 'Results', fields: ['substance_identified', 'schedule', 'purity'] },
        { name: 'Examiner Certification', fields: ['examiner_name', 'signature', 'date'] },
      ],
    },
  };

  res.json({ data: templates });
});

router.post('/:caseId/generate-report', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const fc = db.prepare(`
      SELECT fc.*, u.full_name as lead_examiner_name
      FROM forensic_cases fc LEFT JOIN users u ON fc.lead_examiner_id = u.id
      WHERE fc.id = ?
    `).get(req.params.caseId) as any;
    if (!fc) return res.status(404).json({ error: 'Case not found', code: 'CASE_NOT_FOUND' });

    const exhibits = db.prepare('SELECT * FROM forensic_exhibits WHERE forensic_case_id = ?').all(req.params.caseId);
    const analyses = db.prepare('SELECT * FROM forensic_analyses WHERE forensic_case_id = ?').all(req.params.caseId);
    const activity = db.prepare('SELECT * FROM forensic_activity_log WHERE forensic_case_id = ? ORDER BY performed_at ASC').all(req.params.caseId);

    const { findings, conclusions, additional_notes } = req.body;

    const report = {
      lab_number: fc.lab_number,
      title: fc.title,
      case_type: fc.case_type,
      requesting_agency: fc.requesting_agency,
      requesting_officer: fc.requesting_officer,
      received_date: fc.received_date,
      completed_date: fc.completed_date || localNow(),
      examiner: fc.lead_examiner_name || user.full_name,
      exhibits,
      analyses,
      chain_of_custody: activity.filter((a: any) => a.action === 'custody_transfer'),
      findings: findings || '',
      conclusions: conclusions || '',
      additional_notes: additional_notes || '',
      generated_at: localNow(),
      generated_by: user.full_name,
    };

    // Update case status
    const now = localNow();
    db.prepare('UPDATE forensic_cases SET status = ?, completed_date = COALESCE(completed_date, ?), updated_at = ? WHERE id = ?')
      .run('report_draft', now, now, req.params.caseId);
    logActivity(parseInt(req.params.caseId as string), 'report_generated', 'Examination report generated', user.id, user.full_name);

    res.json({ data: report });
  } catch (error: any) {
    console.error('Generate report error:', error);
    console.error('[Forensics] Error:', error?.message);
    res.status(500).json({ error: 'Failed to [forensics]', code: 'FORENSICS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 30: Lab Capacity Planning
// ════════════════════════════════════════════════════════════

router.get('/capacity/planning', (_req: Request, res: Response) => {
  try {
    const db = getDb();

    // Get all examiners with active caseloads
    const examiners = db.prepare(`
      SELECT u.id, u.full_name,
        COUNT(CASE WHEN fc.status NOT IN ('closed', 'cancelled', 'released') THEN 1 END) as active_cases,
        COUNT(CASE WHEN fc.priority = 'rush' AND fc.status NOT IN ('closed', 'cancelled', 'released') THEN 1 END) as rush_cases,
        COUNT(CASE WHEN fc.priority = 'urgent' AND fc.status NOT IN ('closed', 'cancelled', 'released') THEN 1 END) as urgent_cases
      FROM users u
      LEFT JOIN forensic_cases fc ON fc.lead_examiner_id = u.id
      WHERE u.status = 'active' AND (u.role IN ('admin', 'officer') OR fc.lead_examiner_id IS NOT NULL)
      GROUP BY u.id
      HAVING active_cases > 0
      ORDER BY active_cases DESC
    `).all() as any[];

    // Cases by week (next 4 weeks)
    const weeklyLoad: any[] = [];
    for (let w = 0; w < 4; w++) {
      const weekStart = new Date(Date.now() + w * 7 * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      const dueThisWeek = db.prepare(`
        SELECT COUNT(*) as cnt FROM forensic_cases
        WHERE due_date BETWEEN ? AND ? AND status NOT IN ('closed', 'cancelled', 'released')
      `).get(weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]) as any;

      weeklyLoad.push({
        week: w + 1,
        start: weekStart.toISOString().split('T')[0],
        end: weekEnd.toISOString().split('T')[0],
        cases_due: dueThisWeek?.cnt || 0,
      });
    }

    // Pending analyses count
    const pendingAnalyses = (db.prepare(`
      SELECT COUNT(*) as cnt FROM forensic_analyses WHERE status IN ('pending', 'in_progress')
    `).get() as any)?.cnt || 0;

    // Average turnaround time
    const avgTurnaround = db.prepare(`
      SELECT AVG(JULIANDAY(completed_date) - JULIANDAY(received_date)) as avg_days
      FROM forensic_cases
      WHERE completed_date IS NOT NULL AND received_date IS NOT NULL
    `).get() as any;

    res.json({
      data: {
        examiners,
        weekly_load: weeklyLoad,
        pending_analyses: pendingAnalyses,
        avg_turnaround_days: Math.round((avgTurnaround?.avg_days || 0) * 10) / 10,
        total_active_cases: examiners.reduce((s: number, e: any) => s + e.active_cases, 0),
      },
    });
  } catch (error: any) {
    console.error('Capacity planning error:', error);
    res.status(500).json({ error: 'Failed to capacity planning', code: 'CAPACITY_PLANNING_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// Case Links & Hash Results
// ════════════════════════════════════════════════════════════

// GET /api/forensic-lab/:caseId/links — Get linked records for a case
router.get('/:caseId/links', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const links = db.prepare(`
      SELECT * FROM forensic_case_links WHERE forensic_case_id = ? ORDER BY linked_at DESC
    
      LIMIT 1000
    `).all(req.params.caseId);
    res.json(links);
  } catch (error: any) {
    console.error('Forensic case links error:', error);
    res.status(500).json({ error: 'Failed to forensic case links', code: 'FORENSIC_CASE_LINKS_ERROR' });
  }
});

// POST /api/forensic-lab/:caseId/links — Add a linked record
router.post('/:caseId/links', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { linked_type, linked_id, linked_label } = req.body;
    if (!linked_type || !linked_id) {
      res.status(400).json({ error: 'linked_type and linked_id required', code: 'LINKEDTYPE_AND_LINKEDID_REQUIRED' });
      return;
    }
    const result = db.prepare(`
      INSERT INTO forensic_case_links (forensic_case_id, linked_type, linked_id, relationship)
      VALUES (?, ?, ?, ?)
    `).run(req.params.caseId, linked_type, linked_id, linked_label || null);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('Forensic case add link error:', error);
    res.status(500).json({ error: 'Failed to forensic case add link', code: 'FORENSIC_CASE_ADD_LINK' });
  }
});

// GET /api/forensic-lab/:caseId/hashes — Get hash check results for a case
router.get('/:caseId/hashes', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const hashes = db.prepare(`
      SELECT * FROM forensic_hash_results WHERE case_id = ? ORDER BY created_at DESC
    
      LIMIT 1000
    `).all(req.params.caseId);

    const stats = {
      total: hashes.length,
      matches: (hashes as any[]).filter((h: any) => h.match_found).length,
      clean: (hashes as any[]).filter((h: any) => !h.match_found).length,
    };

    res.json({ hashes, stats });
  } catch (error: any) {
    console.error('Forensic case hashes error:', error);
    res.status(500).json({ error: 'Failed to forensic case hashes', code: 'FORENSIC_CASE_HASHES_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Lab Turnaround Time Tracking
// ════════════════════════════════════════════════════════════

router.get('/turnaround-times', (_req: Request, res: Response) => {
  try {
    const db = getDb();

    // Average turnaround by case type
    const byType = db.prepare(`
      SELECT case_type,
        COUNT(*) as cases_completed,
        ROUND(AVG(JULIANDAY(completed_date) - JULIANDAY(received_date)), 1) as avg_days,
        ROUND(MIN(JULIANDAY(completed_date) - JULIANDAY(received_date)), 1) as min_days,
        ROUND(MAX(JULIANDAY(completed_date) - JULIANDAY(received_date)), 1) as max_days
      FROM forensic_cases
      WHERE completed_date IS NOT NULL AND received_date IS NOT NULL
      GROUP BY case_type ORDER BY avg_days DESC
    `).all();

    // Average turnaround by priority
    const byPriority = db.prepare(`
      SELECT priority,
        COUNT(*) as cases_completed,
        ROUND(AVG(JULIANDAY(completed_date) - JULIANDAY(received_date)), 1) as avg_days
      FROM forensic_cases
      WHERE completed_date IS NOT NULL AND received_date IS NOT NULL
      GROUP BY priority
    `).all();

    // Monthly turnaround trend
    const monthlyTrend = db.prepare(`
      SELECT strftime('%Y-%m', completed_date) as month,
        COUNT(*) as cases_completed,
        ROUND(AVG(JULIANDAY(completed_date) - JULIANDAY(received_date)), 1) as avg_days
      FROM forensic_cases
      WHERE completed_date IS NOT NULL AND received_date IS NOT NULL
        AND completed_date >= datetime('now', '-12 months')
      GROUP BY month ORDER BY month
    `).all();

    // Currently overdue cases
    const overdue = db.prepare(`
      SELECT id, lab_number, title, case_type, priority, due_date, received_date,
        CAST(JULIANDAY('now') - JULIANDAY(due_date) AS INTEGER) as days_overdue
      FROM forensic_cases
      WHERE due_date IS NOT NULL AND due_date < DATE('now')
        AND status NOT IN ('released', 'cancelled', 'closed')
      ORDER BY days_overdue DESC
      LIMIT 50
    `).all();

    // Analysis turnaround
    const analysisTurnaround = db.prepare(`
      SELECT analysis_type,
        COUNT(*) as completed,
        ROUND(AVG(JULIANDAY(completed_at) - JULIANDAY(created_at)), 1) as avg_days
      FROM forensic_analyses
      WHERE completed_at IS NOT NULL
      GROUP BY analysis_type ORDER BY avg_days DESC
    `).all();

    res.json({
      data: {
        by_type: byType,
        by_priority: byPriority,
        monthly_trend: monthlyTrend,
        overdue_cases: overdue,
        analysis_turnaround: analysisTurnaround,
      },
    });
  } catch (error: any) {
    console.error('Turnaround times error:', error);
    res.status(500).json({ error: 'Failed to get turnaround times', code: 'TURNAROUND_TIMES_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Exhibit Chain of Custody Validation
// ════════════════════════════════════════════════════════════

router.get('/:caseId/exhibits/:exhibitId/custody-audit', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const exhibit = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?')
      .get(req.params.exhibitId, req.params.caseId) as any;
    if (!exhibit) return res.status(404).json({ error: 'Exhibit not found', code: 'EXHIBIT_NOT_FOUND' });

    let chain: any[] = [];
    try { chain = JSON.parse(exhibit.chain_of_custody || '[]'); } catch { /* ignore */ }

    // Get transfers from activity log
    const transfers = db.prepare(`
      SELECT * FROM forensic_activity_log
      WHERE forensic_case_id = ? AND exhibit_id = ? AND action IN ('custody_transfer', 'received', 'check_in', 'check_out')
      ORDER BY performed_at ASC
    `).all(req.params.caseId, req.params.exhibitId) as any[];

    const gaps: any[] = [];
    const issues: string[] = [];

    // Check for time gaps > 24 hours in chain
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1];
      const curr = chain[i];
      const prevTime = prev.at || prev.timestamp;
      const currTime = curr.at || curr.timestamp;
      if (prevTime && currTime) {
        const gapHours = (new Date(currTime).getTime() - new Date(prevTime).getTime()) / (1000 * 60 * 60);
        if (gapHours > 24) {
          gaps.push({ from_index: i - 1, to_index: i, gap_hours: Math.round(gapHours * 10) / 10 });
        }
      }
    }

    // Check for missing signatures
    for (let i = 0; i < chain.length; i++) {
      if (!chain[i].by && !chain[i].user_name && !chain[i].user_id) {
        issues.push(`Entry ${i + 1}: Missing responsible party`);
      }
    }

    // Verify exhibit still has current custodian
    if (!exhibit.current_custodian && !exhibit.storage_location) {
      issues.push('No current custodian or storage location recorded');
    }

    res.json({
      data: {
        exhibit_id: exhibit.id,
        exhibit_number: exhibit.exhibit_number,
        chain_entries: chain.length,
        transfer_records: transfers.length,
        gaps,
        issues,
        is_valid: gaps.length === 0 && issues.length === 0,
        current_custodian: exhibit.current_custodian || null,
        current_location: exhibit.storage_location || null,
      },
    });
  } catch (error: any) {
    console.error('Custody audit error:', error);
    res.status(500).json({ error: 'Failed to audit custody', code: 'CUSTODY_AUDIT_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Analysis Result Templates
// ════════════════════════════════════════════════════════════

router.get('/analysis-templates', (_req: Request, res: Response) => {
  const templates: Record<string, any> = {
    dna: {
      name: 'DNA Analysis',
      result_fields: ['profile_type', 'loci_tested', 'allele_calls', 'match_probability', 'codis_eligible', 'mixture_detected'],
      conclusion_options: ['match', 'exclusion', 'inconclusive', 'mixture_detected', 'insufficient_sample'],
    },
    fingerprint: {
      name: 'Fingerprint Comparison',
      result_fields: ['print_quality', 'ridge_detail', 'comparison_points', 'afis_searched', 'candidate_matches'],
      conclusion_options: ['identification', 'exclusion', 'inconclusive', 'unsuitable_for_comparison'],
    },
    toxicology: {
      name: 'Toxicology Screen',
      result_fields: ['specimen_type', 'tests_performed', 'substances_detected', 'concentrations', 'detection_limits'],
      conclusion_options: ['positive', 'negative', 'inconclusive', 'below_threshold'],
    },
    firearms: {
      name: 'Firearms/Toolmarks',
      result_fields: ['firearm_type', 'caliber', 'rifling_characteristics', 'nibin_entered', 'comparison_results'],
      conclusion_options: ['identification', 'elimination', 'inconclusive', 'unsuitable'],
    },
    digital: {
      name: 'Digital Forensics',
      result_fields: ['device_type', 'os_version', 'encryption_status', 'data_recovered', 'artifacts_found', 'timeline_events'],
      conclusion_options: ['evidence_found', 'no_relevant_evidence', 'partial_recovery', 'device_inaccessible'],
    },
    drug_analysis: {
      name: 'Drug Analysis',
      result_fields: ['presumptive_result', 'confirmatory_result', 'substance_identified', 'schedule', 'net_weight', 'purity'],
      conclusion_options: ['controlled_substance_identified', 'no_controlled_substance', 'inconclusive'],
    },
    trace_evidence: {
      name: 'Trace Evidence',
      result_fields: ['material_type', 'microscopy_results', 'spectroscopy_results', 'comparison_results'],
      conclusion_options: ['consistent', 'inconsistent', 'inconclusive', 'insufficient_sample'],
    },
  };
  res.json({ data: templates });
});

// Apply template to an analysis
router.post('/:caseId/analyses/:analysisId/apply-template', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const existing = db.prepare('SELECT * FROM forensic_analyses WHERE id = ? AND forensic_case_id = ?')
      .get(req.params.analysisId, req.params.caseId) as any;
    if (!existing) return res.status(404).json({ error: 'Analysis not found', code: 'ANALYSIS_NOT_FOUND' });

    const { template_name, result_data, conclusion } = req.body;
    if (!template_name) return res.status(400).json({ error: 'template_name required', code: 'TEMPLATE_NAME_REQUIRED' });

    const now = localNow();
    db.prepare(`UPDATE forensic_analyses SET
      template_name = ?, results = ?, conclusion = ?, updated_at = ? WHERE id = ?`)
      .run(template_name, JSON.stringify(result_data || {}), conclusion || existing.conclusion, now, req.params.analysisId);

    logActivity(parseInt(req.params.caseId as string), 'template_applied',
      `Applied ${template_name} template to analysis`, user.id, user.full_name);

    const updated = db.prepare('SELECT * FROM forensic_analyses WHERE id = ?').get(req.params.analysisId);
    res.json({ data: updated });
  } catch (error: any) {
    console.error('Apply template error:', error);
    res.status(500).json({ error: 'Failed to apply template', code: 'APPLY_TEMPLATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Quality Control Checks
// ════════════════════════════════════════════════════════════

router.post('/:caseId/qc-check', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const fc = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.caseId) as any;
    if (!fc) return res.status(404).json({ error: 'Forensic case not found', code: 'FORENSIC_CASE_NOT_FOUND' });

    const { check_type, reviewer_notes, items_checked, pass } = req.body;
    if (!check_type) return res.status(400).json({ error: 'check_type required', code: 'CHECK_TYPE_REQUIRED' });

    const validTypes = ['peer_review', 'admin_review', 'technical_review', 'calibration_check', 'blank_check', 'positive_control', 'negative_control'];
    if (!validTypes.includes(check_type)) return res.status(400).json({ error: 'Invalid check type', code: 'INVALID_CHECK_TYPE' });

    const now = localNow();
    const qcData = {
      check_type,
      reviewer_id: user.id,
      reviewer_name: user.full_name,
      items_checked: items_checked || [],
      pass: pass !== false,
      reviewer_notes: reviewer_notes || '',
      performed_at: now,
    };

    logActivity(parseInt(req.params.caseId as string), 'qc_check',
      `QC ${check_type}: ${pass !== false ? 'PASS' : 'FAIL'} by ${user.full_name}. ${reviewer_notes || ''}`,
      user.id, user.full_name);

    // If peer review and pass, advance status
    if (check_type === 'peer_review' && pass !== false && fc.status === 'report_drafted') {
      db.prepare('UPDATE forensic_cases SET status = ?, updated_at = ? WHERE id = ?')
        .run('reviewed', now, req.params.caseId);
      logActivity(parseInt(req.params.caseId as string), 'status_changed', 'Status: report_drafted → reviewed (QC passed)', user.id, user.full_name);
    }

    res.json({ data: qcData });
  } catch (error: any) {
    console.error('QC check error:', error);
    res.status(500).json({ error: 'Failed to record QC check', code: 'QC_CHECK_ERROR' });
  }
});

// Get QC history for a case
router.get('/:caseId/qc-history', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const checks = db.prepare(`
      SELECT * FROM forensic_activity_log
      WHERE forensic_case_id = ? AND action = 'qc_check'
      ORDER BY performed_at DESC
      LIMIT 100
    `).all(req.params.caseId);
    res.json({ data: checks });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get QC history', code: 'QC_HISTORY_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Forensic Backlog Metrics
// ════════════════════════════════════════════════════════════

router.get('/metrics/backlog', (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const backlogByType = db.prepare(`
      SELECT case_type, COUNT(*) as count,
        ROUND(AVG(JULIANDAY('now') - JULIANDAY(received_date)), 1) as avg_age_days
      FROM forensic_cases
      WHERE status NOT IN ('released', 'cancelled', 'closed')
      GROUP BY case_type ORDER BY count DESC
    `).all();

    const backlogByExaminer = db.prepare(`
      SELECT u.full_name as examiner, COUNT(*) as active_cases,
        ROUND(AVG(JULIANDAY('now') - JULIANDAY(fc.received_date)), 1) as avg_age_days
      FROM forensic_cases fc
      LEFT JOIN users u ON fc.lead_examiner_id = u.id
      WHERE fc.status NOT IN ('released', 'cancelled', 'closed')
      GROUP BY fc.lead_examiner_id ORDER BY active_cases DESC
    `).all();

    const unassigned = (db.prepare(`
      SELECT COUNT(*) as count FROM forensic_cases
      WHERE lead_examiner_id IS NULL AND status NOT IN ('released', 'cancelled', 'closed')
    `).get() as any)?.count || 0;

    const pendingAnalyses = (db.prepare(`
      SELECT COUNT(*) as count FROM forensic_analyses WHERE status = 'pending'
    `).get() as any)?.count || 0;

    const inProgressAnalyses = (db.prepare(`
      SELECT COUNT(*) as count FROM forensic_analyses WHERE status = 'in_progress'
    `).get() as any)?.count || 0;

    res.json({
      data: {
        backlog_by_type: backlogByType,
        backlog_by_examiner: backlogByExaminer,
        unassigned_cases: unassigned,
        pending_analyses: pendingAnalyses,
        in_progress_analyses: inProgressAnalyses,
        total_backlog: (backlogByType as any[]).reduce((s: number, t: any) => s + t.count, 0),
      },
    });
  } catch (error: any) {
    console.error('Forensic backlog error:', error);
    res.status(500).json({ error: 'Failed to get backlog metrics', code: 'BACKLOG_METRICS_ERROR' });
  }
});

// ── Forensic Lab CSV Export ───────────────────────────────────────────────────
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT fc.lab_number, fc.case_number, fc.case_type, fc.status, fc.priority,
             fc.submitted_by_name, fc.lead_examiner_name, fc.description,
             fc.received_date, fc.due_date, fc.completed_date, fc.created_at,
             (SELECT COUNT(*) FROM forensic_exhibits WHERE forensic_case_id = fc.id) as exhibit_count
      FROM forensic_cases fc
      ORDER BY fc.created_at DESC
      LIMIT 10000
    `).all() as any[];
    const headers = ['Lab #', 'Case #', 'Case Type', 'Status', 'Priority', 'Submitted By', 'Lead Examiner', 'Description', 'Received Date', 'Due Date', 'Completed Date', 'Exhibits', 'Created'];
    const csv = [
      headers.join(','),
      ...rows.map((r: any) => [
        r.lab_number, r.case_number, r.case_type, r.status, r.priority,
        (r.submitted_by_name || '').replace(/"/g, '""'),
        (r.lead_examiner_name || '').replace(/"/g, '""'),
        (r.description || '').replace(/"/g, '""'),
        r.received_date, r.due_date, r.completed_date, r.exhibit_count, r.created_at
      ].map(v => `"${v || ''}"`).join(','))
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="forensic_cases_export_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (error: any) {
    console.error('Forensics CSV export error:', error);
    res.status(500).json({ error: 'Failed to export forensic cases', code: 'FORENSICS_EXPORT_ERROR' });
  }
});

export default router;
