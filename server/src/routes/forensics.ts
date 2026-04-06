// ============================================================
// RMPG Flex — Forensics Lab API Routes
// ============================================================
// Full CRUD for forensic cases, exhibits, analyses, and
// chain-of-custody activity logging.
// Lab numbers: LAB-YY-#####
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:id ────────────────────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT fc.*,
        u.full_name as lead_examiner_name,
        cb.full_name as created_by_name
      FROM forensic_cases fc
      LEFT JOIN users u ON fc.lead_examiner_id = u.id
      LEFT JOIN users cb ON fc.created_by = cb.id
      WHERE fc.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Forensic case not found' });
    res.json({ data: row });
  } catch (error: any) {
    console.error('Get forensic case error:', error);
    res.status(500).json({ error: 'Internal server error' });
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

    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

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

    const newCase = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ data: newCase });
  } catch (error: any) {
    console.error('Create forensic case error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ─── PUT /:id ────────────────────────────────────────────
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const existing = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Forensic case not found' });

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
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ─── DELETE /:id ─────────────────────────────────────────
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Forensic case not found' });
    db.prepare('DELETE FROM forensic_cases WHERE id = ?').run(req.params.id);
    res.json({ message: 'Forensic case deleted' });
  } catch (error: any) {
    console.error('Delete forensic case error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
    `).all(req.params.caseId);
    res.json({ data: rows });
  } catch (error: any) {
    console.error('Get exhibits error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:caseId/exhibits ──────────────────────────────
router.post('/:caseId/exhibits', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const fc = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.caseId) as any;
    if (!fc) return res.status(404).json({ error: 'Forensic case not found' });

    const {
      exhibit_type = 'other', description, quantity = 1, condition_received,
      storage_location, storage_temp, collected_by, collected_date,
      collection_method, hash_md5, hash_sha256, notes,
    } = req.body;

    if (!description?.trim()) return res.status(400).json({ error: 'Description is required' });

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
        chain_of_custody, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.caseId, exhibit_number, exhibit_type, description.trim(), quantity,
      condition_received || null, storage_location || null, storage_temp || null,
      collected_by || null, collected_date || null, collection_method || null,
      hash_md5 || null, hash_sha256 || null, initialCustody,
      notes || null, now, now,
    );

    logActivity(parseInt(req.params.caseId as string), 'exhibit_added', `Exhibit ${exhibit_number}: ${description}`, user.id, user.full_name, result.lastInsertRowid as number);

    const newExhibit = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ data: newExhibit });
  } catch (error: any) {
    console.error('Create exhibit error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ─── PUT /:caseId/exhibits/:exhibitId ────────────────────
router.put('/:caseId/exhibits/:exhibitId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const existing = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?').get(req.params.exhibitId, req.params.caseId) as any;
    if (!existing) return res.status(404).json({ error: 'Exhibit not found' });

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
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ─── DELETE /:caseId/exhibits/:exhibitId ─────────────────
router.delete('/:caseId/exhibits/:exhibitId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const existing = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?').get(req.params.exhibitId, req.params.caseId) as any;
    if (!existing) return res.status(404).json({ error: 'Exhibit not found' });
    db.prepare('DELETE FROM forensic_exhibits WHERE id = ?').run(req.params.exhibitId);
    logActivity(parseInt(req.params.caseId as string), 'exhibit_deleted', `Exhibit ${existing.exhibit_number} deleted`, user.id, user.full_name);
    res.json({ message: 'Exhibit deleted' });
  } catch (error: any) {
    console.error('Delete exhibit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:caseId/exhibits/:exhibitId/custody ───────────
router.post('/:caseId/exhibits/:exhibitId/custody', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const existing = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?').get(req.params.exhibitId, req.params.caseId) as any;
    if (!existing) return res.status(404).json({ error: 'Exhibit not found' });

    const { action, notes: custodyNotes } = req.body;
    if (!action) return res.status(400).json({ error: 'Action is required' });

    const chain = JSON.parse(existing.chain_of_custody || '[]');
    chain.push({ action, by: user.full_name, at: localNow(), notes: custodyNotes || '' });

    db.prepare('UPDATE forensic_exhibits SET chain_of_custody = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(chain), localNow(), existing.id);

    logActivity(parseInt(req.params.caseId as string), 'custody_transfer', `${existing.exhibit_number}: ${action}`, user.id, user.full_name, existing.id);

    const updated = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ?').get(existing.id);
    res.json({ data: updated });
  } catch (error: any) {
    console.error('Custody update error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
    `).all(req.params.caseId);
    res.json({ data: rows });
  } catch (error: any) {
    console.error('Get analyses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:caseId/analyses ──────────────────────────────
router.post('/:caseId/analyses', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const fc = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.caseId) as any;
    if (!fc) return res.status(404).json({ error: 'Forensic case not found' });

    const {
      exhibit_id, analysis_type, methodology, equipment_used,
      examiner_id, notes,
    } = req.body;

    if (!analysis_type) return res.status(400).json({ error: 'Analysis type is required' });

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
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ─── PUT /:caseId/analyses/:analysisId ───────────────────
router.put('/:caseId/analyses/:analysisId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const existing = db.prepare('SELECT * FROM forensic_analyses WHERE id = ? AND forensic_case_id = ?').get(req.params.analysisId, req.params.caseId) as any;
    if (!existing) return res.status(404).json({ error: 'Analysis not found' });

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
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ─── DELETE /:caseId/analyses/:analysisId ────────────────
router.delete('/:caseId/analyses/:analysisId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const existing = db.prepare('SELECT * FROM forensic_analyses WHERE id = ? AND forensic_case_id = ?').get(req.params.analysisId, req.params.caseId) as any;
    if (!existing) return res.status(404).json({ error: 'Analysis not found' });
    db.prepare('DELETE FROM forensic_analyses WHERE id = ?').run(req.params.analysisId);
    logActivity(parseInt(req.params.caseId as string), 'analysis_deleted', `${existing.analysis_type} analysis deleted`, user.id, user.full_name);
    res.json({ message: 'Analysis deleted' });
  } catch (error: any) {
    console.error('Delete analysis error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
    `).all(req.params.caseId);
    res.json({ data: rows });
  } catch (error: any) {
    console.error('Get activity log error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
    `).all();
    res.json({ data: sets });
  } catch (error: any) {
    console.error('Get hash sets error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/forensics/hash-sets — Create hash set with optional CSV entries
router.post('/hash-sets', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, set_type, description, version, entries } = req.body;

    if (!name || !set_type) {
      res.status(400).json({ error: 'Name and set_type are required' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/forensics/hash-sets/:id — Delete hash set and all entries
router.delete('/hash-sets/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID' }); return; }

    const existing = db.prepare('SELECT id, name FROM forensic_hash_sets WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ error: 'Hash set not found' }); return; }

    // CASCADE will remove entries
    db.prepare('DELETE FROM forensic_hash_sets WHERE id = ?').run(id);
    res.json({ message: `Hash set "${existing.name}" deleted` });
  } catch (error: any) {
    console.error('Delete hash set error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/forensics/hash-sets/check — Check hashes against loaded sets
router.post('/hash-sets/check', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { hashes } = req.body; // string[] of hash values

    if (!Array.isArray(hashes) || hashes.length === 0) {
      res.status(400).json({ error: 'Provide an array of hashes' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
