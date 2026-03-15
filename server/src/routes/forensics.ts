// ============================================================
// RMPG Flex — Forensic Lab Management API Routes
// ============================================================
// Lab case management with exhibit tracking, analysis workflow,
// examiner assignment, and timeline logging.
// Auto-generates lab case numbers in FL-YYYY-NNNN format.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import { computeFileHashes, computeContentFingerprint } from '../utils/ipedManager';
import path from 'path';
import fs from 'fs';

const router = Router();
router.use(authenticateToken);

// ── Helpers ──────────────────────────────────────────────

/** Generate lab case number — wrapped in transaction to prevent race conditions */
function generateLabCaseNumber(): string {
  const db = getDb();
  const year = new Date().getFullYear();
  const prefix = `FL-${year}-`;
  return db.transaction(() => {
    const last = db.prepare(
      `SELECT lab_case_number FROM forensic_cases WHERE lab_case_number LIKE ? ORDER BY id DESC LIMIT 1`,
    ).get(`${prefix}%`) as { lab_case_number: string } | undefined;
    const parsed = last ? parseInt(last.lab_case_number.replace(prefix, ''), 10) : 0;
    const seq = (isNaN(parsed) ? 0 : parsed) + 1;
    return `${prefix}${String(seq).padStart(4, '0')}`;
  })();
}

function addTimelineEntry(caseId: number, action: string, description: string, userId: number, userName: string) {
  const db = getDb();
  db.prepare(`
    INSERT INTO forensic_timeline (forensic_case_id, action, description, performed_by, performed_by_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(caseId, action, description, userId, userName, localNow());
}

// ─── GET /stats ──────────────────────────────────────────

router.get('/stats', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM forensic_cases WHERE archived_at IS NULL GROUP BY status
    `).all() as any[];
    const typeCounts = db.prepare(`
      SELECT case_type, COUNT(*) as count FROM forensic_cases WHERE archived_at IS NULL GROUP BY case_type
    `).all() as any[];
    const priorityCounts = db.prepare(`
      SELECT priority, COUNT(*) as count FROM forensic_cases WHERE archived_at IS NULL GROUP BY priority
    `).all() as any[];
    const total = db.prepare(`SELECT COUNT(*) as count FROM forensic_cases WHERE archived_at IS NULL`).get() as any;
    const overdue = db.prepare(`
      SELECT COUNT(*) as count FROM forensic_cases
      WHERE archived_at IS NULL AND due_date IS NOT NULL AND due_date < datetime('now','localtime')
      AND status NOT IN ('closed','cancelled','report_final')
    `).get() as any;

    res.json({
      by_status: Object.fromEntries(statusCounts.map((r: any) => [r.status, r.count])),
      by_type: Object.fromEntries(typeCounts.map((r: any) => [r.case_type, r.count])),
      by_priority: Object.fromEntries(priorityCounts.map((r: any) => [r.priority, r.count])),
      total: total?.count || 0,
      overdue: overdue?.count || 0,
    });
  } catch (error: any) {
    console.error('Forensic stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET / — List forensic cases ─────────────────────────

router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, case_type, priority, examiner, search, page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE fc.archived_at IS NULL';
    const params: any[] = [];

    if (status) { where += ' AND fc.status = ?'; params.push(status); }
    if (case_type) { where += ' AND fc.case_type = ?'; params.push(case_type); }
    if (priority) { where += ' AND fc.priority = ?'; params.push(priority); }
    if (examiner) { where += ' AND fc.assigned_examiner_id = ?'; params.push(examiner); }
    if (search) {
      where += ` AND (fc.lab_case_number LIKE ? OR fc.title LIKE ? OR fc.synopsis LIKE ? OR fc.requesting_officer_name LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const countRow = db.prepare(`SELECT COUNT(*) as count FROM forensic_cases fc ${where}`).get(...params) as any;
    const rows = db.prepare(`
      SELECT fc.*,
        (SELECT COUNT(*) FROM forensic_exhibits WHERE forensic_case_id = fc.id) as exhibit_count,
        (SELECT COUNT(*) FROM forensic_analyses WHERE forensic_case_id = fc.id) as analysis_count
      FROM forensic_cases fc
      ${where}
      ORDER BY
        CASE fc.priority WHEN 'rush' THEN 0 WHEN 'urgent' THEN 1 WHEN 'expedited' THEN 2 ELSE 3 END,
        fc.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset) as any[];

    res.json({
      data: rows,
      total: countRow?.count || 0,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error: any) {
    console.error('List forensic cases error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:id — Get single case with details ─────────────

router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Case not found' });

    const exhibits = db.prepare('SELECT * FROM forensic_exhibits WHERE forensic_case_id = ? ORDER BY exhibit_number').all(req.params.id);
    const analyses = db.prepare('SELECT * FROM forensic_analyses WHERE forensic_case_id = ? ORDER BY created_at DESC').all(req.params.id);
    const timeline = db.prepare('SELECT * FROM forensic_timeline WHERE forensic_case_id = ? ORDER BY created_at DESC').all(req.params.id);

    res.json({ ...row, exhibits, analyses, timeline });
  } catch (error: any) {
    console.error('Get forensic case error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST / — Create forensic case ───────────────────────

router.post('/', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const {
      title, case_type = 'digital', priority = 'routine', incident_id,
      evidence_ids, requesting_officer_id, requesting_officer_name,
      assigned_examiner_id, assigned_examiner_name, lab_location,
      synopsis, due_date, notes,
    } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

    const lab_case_number = generateLabCaseNumber();
    const now = localNow();

    const result = db.prepare(`
      INSERT INTO forensic_cases (
        lab_case_number, title, case_type, status, priority, incident_id,
        evidence_ids, requesting_officer_id, requesting_officer_name,
        assigned_examiner_id, assigned_examiner_name, lab_location,
        synopsis, due_date, notes, received_date, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      lab_case_number, title.trim(), case_type, priority, incident_id || null,
      JSON.stringify(evidence_ids || []), requesting_officer_id || null,
      requesting_officer_name || null, assigned_examiner_id || null,
      assigned_examiner_name || null, lab_location || null,
      synopsis || null, due_date || null, notes || null, now,
      user.userId, now, now,
    );

    addTimelineEntry(
      result.lastInsertRowid as number, 'created',
      `Case ${lab_case_number} created — ${title}`,
      user.userId, user.fullName || user.username,
    );

    const created = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(result.lastInsertRowid);
    if (!created) { res.status(500).json({ error: 'Failed to retrieve created forensic case' }); return; }
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Create forensic case error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id — Update forensic case ─────────────────────

router.put('/:id', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const existing = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Case not found' });

    const {
      title, case_type, status, priority, incident_id,
      evidence_ids, requesting_officer_id, requesting_officer_name,
      assigned_examiner_id, assigned_examiner_name, lab_location,
      synopsis, findings, conclusion, methodology, due_date,
      started_date, completed_date, report_date, notes,
    } = req.body;

    const now = localNow();

    // Calculate turnaround days if completing
    let turnaround_days = existing.turnaround_days;
    if (status === 'closed' && existing.status !== 'closed' && existing.received_date) {
      const received = new Date(existing.received_date);
      const completed = new Date();
      turnaround_days = Math.ceil((completed.getTime() - received.getTime()) / (1000 * 60 * 60 * 24));
    }

    db.prepare(`
      UPDATE forensic_cases SET
        title = COALESCE(?, title),
        case_type = COALESCE(?, case_type),
        status = COALESCE(?, status),
        priority = COALESCE(?, priority),
        incident_id = ?,
        evidence_ids = COALESCE(?, evidence_ids),
        requesting_officer_id = ?,
        requesting_officer_name = ?,
        assigned_examiner_id = ?,
        assigned_examiner_name = ?,
        lab_location = ?,
        synopsis = ?,
        findings = ?,
        conclusion = ?,
        methodology = ?,
        due_date = ?,
        started_date = ?,
        completed_date = ?,
        report_date = ?,
        turnaround_days = ?,
        notes = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      title || null, case_type || null, status || null, priority || null,
      incident_id ?? existing.incident_id,
      evidence_ids ? JSON.stringify(evidence_ids) : null,
      requesting_officer_id ?? existing.requesting_officer_id,
      requesting_officer_name ?? existing.requesting_officer_name,
      assigned_examiner_id ?? existing.assigned_examiner_id,
      assigned_examiner_name ?? existing.assigned_examiner_name,
      lab_location ?? existing.lab_location,
      synopsis ?? existing.synopsis,
      findings ?? existing.findings,
      conclusion ?? existing.conclusion,
      methodology ?? existing.methodology,
      due_date ?? existing.due_date,
      started_date ?? existing.started_date,
      completed_date ?? existing.completed_date,
      report_date ?? existing.report_date,
      turnaround_days,
      notes ?? existing.notes,
      now, req.params.id,
    );

    // Log status changes
    if (status && status !== existing.status) {
      addTimelineEntry(
        existing.id, 'status_change',
        `Status changed from ${existing.status} to ${status}`,
        user.userId, user.fullName || user.username,
      );
    }
    if (assigned_examiner_name && assigned_examiner_name !== existing.assigned_examiner_name) {
      addTimelineEntry(
        existing.id, 'assigned',
        `Assigned to ${assigned_examiner_name}`,
        user.userId, user.fullName || user.username,
      );
    }

    const updated = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update forensic case error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /:id ─────────────────────────────────────────

router.delete('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Case not found' });
    db.prepare('DELETE FROM forensic_cases WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete forensic case error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══ EXHIBITS ═══════════════════════════════════════════

// ─── GET /:id/exhibits ───────────────────────────────────

router.get('/:id/exhibits', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const exhibits = db.prepare('SELECT * FROM forensic_exhibits WHERE forensic_case_id = ? ORDER BY exhibit_number').all(req.params.id);
    res.json(exhibits);
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/exhibits ─────────────────────────────────

router.post('/:id/exhibits', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const caseRow = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.id) as any;
    if (!caseRow) return res.status(404).json({ error: 'Case not found' });

    const { description, item_type, evidence_id, condition_received, examination_requested, notes } = req.body;
    if (!description?.trim()) return res.status(400).json({ error: 'Description is required' });

    // Auto-generate exhibit number (A, B, C, ...)
    const countRow = db.prepare('SELECT COUNT(*) as c FROM forensic_exhibits WHERE forensic_case_id = ?').get(req.params.id) as any;
    const count = countRow?.c ?? 0;
    const exhibit_number = String.fromCharCode(65 + count); // A=65

    const now = localNow();
    const result = db.prepare(`
      INSERT INTO forensic_exhibits (forensic_case_id, exhibit_number, evidence_id, description, item_type, condition_received, examination_requested, notes, received_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, exhibit_number, evidence_id || null, description.trim(), item_type || null, condition_received || null, examination_requested || null, notes || null, now, now, now);

    addTimelineEntry(caseRow.id, 'exhibit_added', `Exhibit ${exhibit_number} added — ${description}`, user.userId, user.fullName || user.username);

    const created = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ?').get(result.lastInsertRowid);
    if (!created) { res.status(500).json({ error: 'Failed to retrieve created exhibit' }); return; }
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Create exhibit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:caseId/exhibits/:exhibitId ────────────────────

router.put('/:caseId/exhibits/:exhibitId', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { description, item_type, condition_received, examination_requested, examination_performed, results, status, notes, returned_date } = req.body;
    const now = localNow();

    db.prepare(`
      UPDATE forensic_exhibits SET
        description = COALESCE(?, description),
        item_type = COALESCE(?, item_type),
        condition_received = ?,
        examination_requested = ?,
        examination_performed = ?,
        results = ?,
        status = COALESCE(?, status),
        notes = ?,
        returned_date = ?,
        updated_at = ?
      WHERE id = ? AND forensic_case_id = ?
    `).run(
      description || null, item_type || null, condition_received ?? null,
      examination_requested ?? null, examination_performed ?? null,
      results ?? null, status || null, notes ?? null, returned_date ?? null,
      now, req.params.exhibitId, req.params.caseId,
    );

    const updated = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ?').get(req.params.exhibitId);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══ ANALYSES ═══════════════════════════════════════════

// ─── GET /:id/analyses ───────────────────────────────────

router.get('/:id/analyses', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const analyses = db.prepare('SELECT * FROM forensic_analyses WHERE forensic_case_id = ? ORDER BY created_at DESC').all(req.params.id);
    res.json(analyses);
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/analyses ─────────────────────────────────

router.post('/:id/analyses', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const caseRow = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.id) as any;
    if (!caseRow) return res.status(404).json({ error: 'Case not found' });

    const { analysis_type, exhibit_id, examiner_id, examiner_name, methodology, instruments_used, notes } = req.body;
    if (!analysis_type) return res.status(400).json({ error: 'Analysis type is required' });

    const now = localNow();
    const result = db.prepare(`
      INSERT INTO forensic_analyses (forensic_case_id, exhibit_id, analysis_type, examiner_id, examiner_name, status, methodology, instruments_used, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(req.params.id, exhibit_id || null, analysis_type, examiner_id || null, examiner_name || null, methodology || null, instruments_used || null, notes || null, now, now);

    addTimelineEntry(caseRow.id, 'analysis_created', `${analysis_type} analysis created`, user.userId, user.fullName || user.username);

    const created = db.prepare('SELECT * FROM forensic_analyses WHERE id = ?').get(result.lastInsertRowid);
    if (!created) { res.status(500).json({ error: 'Failed to retrieve created analysis' }); return; }
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Create analysis error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:caseId/analyses/:analysisId ───────────────────

router.put('/:caseId/analyses/:analysisId', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { analysis_type, examiner_id, examiner_name, status, methodology, instruments_used, results, conclusion, started_at, completed_at, notes } = req.body;
    const now = localNow();

    const existing = db.prepare('SELECT * FROM forensic_analyses WHERE id = ? AND forensic_case_id = ?').get(req.params.analysisId, req.params.caseId) as any;
    if (!existing) return res.status(404).json({ error: 'Analysis not found' });

    db.prepare(`
      UPDATE forensic_analyses SET
        analysis_type = COALESCE(?, analysis_type),
        examiner_id = ?,
        examiner_name = ?,
        status = COALESCE(?, status),
        methodology = ?,
        instruments_used = ?,
        results = ?,
        conclusion = ?,
        started_at = ?,
        completed_at = ?,
        notes = ?,
        updated_at = ?
      WHERE id = ? AND forensic_case_id = ?
    `).run(
      analysis_type || null,
      examiner_id ?? existing.examiner_id, examiner_name ?? existing.examiner_name,
      status || null,
      methodology ?? existing.methodology, instruments_used ?? existing.instruments_used,
      results ?? existing.results, conclusion ?? existing.conclusion,
      started_at ?? existing.started_at, completed_at ?? existing.completed_at,
      notes ?? existing.notes, now, req.params.analysisId, req.params.caseId,
    );

    if (status && status !== existing.status) {
      addTimelineEntry(
        parseInt(req.params.caseId as string, 10), 'analysis_update',
        `${existing.analysis_type} analysis → ${status}`,
        user.userId, user.fullName || user.username,
      );
    }

    const updated = db.prepare('SELECT * FROM forensic_analyses WHERE id = ?').get(req.params.analysisId);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══ TIMELINE ═══════════════════════════════════════════

router.get('/:id/timeline', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const timeline = db.prepare('SELECT * FROM forensic_timeline WHERE forensic_case_id = ? ORDER BY created_at DESC').all(req.params.id);
    res.json(timeline);
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/timeline — Add manual note/entry ──────────

router.post('/:id/timeline', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { action = 'note', description } = req.body;
    if (!description?.trim()) return res.status(400).json({ error: 'Description is required' });

    addTimelineEntry(parseInt(req.params.id as string, 10), action, description.trim(), user.userId, user.fullName || user.username);
    res.status(201).json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══ HASHING ═══════════════════════════════════════════

// ─── GET /:id/hashes — List hashes for a forensic case ──

router.get('/:id/hashes', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const caseRow = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.id) as any;
    if (!caseRow) return res.status(404).json({ error: 'Case not found' });

    const hashes = db.prepare(`
      SELECT deh.*, fe.exhibit_number, fe.description as exhibit_description
      FROM digital_evidence_hashes deh
      LEFT JOIN forensic_exhibits fe ON deh.exhibit_id = fe.id
      WHERE deh.forensic_case_id = ?
      ORDER BY deh.created_at DESC
    `).all(req.params.id);

    // Stats for the case
    const total = hashes.length;
    const flagged = (hashes as any[]).filter(h => h.flagged === 1).length;
    const matched = (hashes as any[]).filter(h => h.hash_set_match === 1).length;

    res.json({ hashes, total, flagged, matched });
  } catch (error: any) {
    console.error('List forensic hashes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/hashes/compute — Compute hashes for an exhibit's file or a direct path ──

router.post('/:id/hashes/compute', requireRole('admin', 'manager', 'supervisor', 'officer'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const caseRow = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.id) as any;
    if (!caseRow) return res.status(404).json({ error: 'Case not found' });

    const { exhibit_id, file_path: rawFilePath, file_name: rawFileName } = req.body;

    let filePath: string | null = null;
    let fileName: string | null = rawFileName || null;
    let fileSize: number = 0;
    let mimeType: string | null = null;
    let evidenceId: number | null = null;
    let attachmentId: number | null = null;
    let exhibitId: number | null = exhibit_id || null;

    // Option 1: Hash a file from an exhibit's linked evidence/attachment
    if (exhibit_id) {
      const exhibit = db.prepare('SELECT * FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?').get(exhibit_id, req.params.id) as any;
      if (!exhibit) return res.status(404).json({ error: 'Exhibit not found' });

      if (exhibit.evidence_id) {
        evidenceId = exhibit.evidence_id;
        // Find attachments linked to this evidence
        const attachment = db.prepare(`
          SELECT * FROM attachments WHERE entity_type = 'evidence' AND entity_id = ? LIMIT 1
        `).get(exhibit.evidence_id) as any;
        if (attachment) {
          attachmentId = attachment.id;
          filePath = path.resolve(attachment.file_path);
          fileName = fileName || attachment.original_name || attachment.stored_name;
          mimeType = attachment.mime_type;
        }
      }
    }

    // Option 2: Hash a file by direct path (for disk evidence, forensic images)
    if (!filePath && rawFilePath) {
      filePath = path.resolve(rawFilePath);
      // Prevent path traversal — only allow files within the uploads directory
      const uploadsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../uploads');
      if (!filePath.startsWith(uploadsDir)) {
        return res.status(403).json({ error: 'Access denied: file path must be within the uploads directory' });
      }
      if (!fileName) {
        fileName = path.basename(filePath);
      }
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(400).json({ error: 'No valid file found to hash. Provide a file_path or an exhibit_id linked to evidence with attachments.' });
    }

    // Get file stats
    const stat = fs.statSync(filePath);
    fileSize = stat.size;

    // Compute hashes (MD5, SHA-1, SHA-256, SHA-512) via streaming
    const hashes = await computeFileHashes(filePath);

    // Compute content fingerprint for similarity detection
    let contentFingerprint: string | null = null;
    try {
      contentFingerprint = computeContentFingerprint(filePath);
    } catch { /* non-critical */ }

    // Check for existing hash (avoid duplicates)
    const existing = db.prepare(`
      SELECT id FROM digital_evidence_hashes
      WHERE forensic_case_id = ? AND sha256 = ?
    `).get(req.params.id, hashes.sha256) as any;

    if (existing) {
      // Update existing record
      const now = localNow();
      db.prepare(`
        UPDATE digital_evidence_hashes SET
          md5 = ?, sha1 = ?, sha512 = ?,
          dhash = COALESCE(?, dhash),
          file_size = ?, updated_at = ?
        WHERE id = ?
      `).run(hashes.md5, hashes.sha1, hashes.sha512, contentFingerprint, fileSize, now, existing.id);

      const record = db.prepare('SELECT * FROM digital_evidence_hashes WHERE id = ?').get(existing.id);
      addTimelineEntry(caseRow.id, 'hash_computed', `Hashes recomputed for ${fileName} (SHA-256 match found)`, user.userId, user.fullName || user.username);
      return res.json(record);
    }

    // Insert new hash record
    const now = localNow();
    const result = db.prepare(`
      INSERT INTO digital_evidence_hashes (
        evidence_id, attachment_id, forensic_case_id, exhibit_id,
        file_name, file_path, file_size, mime_type,
        md5, sha1, sha256, sha512, dhash,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evidenceId, attachmentId, parseInt(req.params.id as string, 10), exhibitId,
      fileName, filePath, fileSize, mimeType,
      hashes.md5, hashes.sha1, hashes.sha256, hashes.sha512,
      contentFingerprint,
      now, now,
    );

    addTimelineEntry(
      caseRow.id, 'hash_computed',
      `Hashes computed for ${fileName} — MD5: ${hashes.md5.substring(0, 12)}...`,
      user.userId, user.fullName || user.username,
    );

    const record = db.prepare('SELECT * FROM digital_evidence_hashes WHERE id = ?').get(result.lastInsertRowid);
    if (!record) { res.status(500).json({ error: 'Failed to retrieve hash record' }); return; }
    res.status(201).json(record);
  } catch (error: any) {
    console.error('Compute hash error:', error);
    res.status(500).json({ error: 'Hash computation failed' });
  }
});

// ─── POST /:id/hashes/manual — Manually add a hash record (e.g., from external tools) ──

router.post('/:id/hashes/manual', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const caseRow = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(req.params.id) as any;
    if (!caseRow) return res.status(404).json({ error: 'Case not found' });

    const {
      exhibit_id, file_name, file_path: fp, file_size, mime_type,
      md5, sha1, sha256, sha512,
      hash_set_name, hash_set_category, hash_set_match, match_confidence,
      flagged, flag_reason, notes,
    } = req.body;

    if (!file_name?.trim()) return res.status(400).json({ error: 'file_name is required' });
    if (!md5 && !sha1 && !sha256) return res.status(400).json({ error: 'At least one hash value (md5, sha1, or sha256) is required' });

    const now = localNow();
    const result = db.prepare(`
      INSERT INTO digital_evidence_hashes (
        forensic_case_id, exhibit_id, file_name, file_path, file_size, mime_type,
        md5, sha1, sha256, sha512,
        hash_set_match, hash_set_name, hash_set_category, match_confidence,
        flagged, flag_reason, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parseInt(req.params.id as string, 10), exhibit_id || null, file_name.trim(), fp || null, file_size || null, mime_type || null,
      md5 || null, sha1 || null, sha256 || null, sha512 || null,
      hash_set_match ? 1 : 0, hash_set_name || null, hash_set_category || null, match_confidence || null,
      flagged ? 1 : 0, flag_reason || null, notes || null,
      now, now,
    );

    addTimelineEntry(
      caseRow.id, 'hash_added',
      `Hash record added for ${file_name}${hash_set_match ? ` — MATCH: ${hash_set_name}` : ''}`,
      user.userId, user.fullName || user.username,
    );

    const record = db.prepare('SELECT * FROM digital_evidence_hashes WHERE id = ?').get(result.lastInsertRowid);
    if (!record) { res.status(500).json({ error: 'Failed to retrieve hash record' }); return; }
    res.status(201).json(record);
  } catch (error: any) {
    console.error('Manual hash add error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id/hashes/:hashId — Update hash record (flag, review, set match) ──

router.put('/:id/hashes/:hashId', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const existing = db.prepare(`
      SELECT * FROM digital_evidence_hashes WHERE id = ? AND forensic_case_id = ?
    `).get(req.params.hashId, req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Hash record not found' });

    const {
      hash_set_match, hash_set_name, hash_set_category, match_confidence,
      flagged, flag_reason, reviewed_by, reviewed_at, notes,
    } = req.body;

    const now = localNow();
    db.prepare(`
      UPDATE digital_evidence_hashes SET
        hash_set_match = COALESCE(?, hash_set_match),
        hash_set_name = ?,
        hash_set_category = ?,
        match_confidence = ?,
        flagged = COALESCE(?, flagged),
        flag_reason = ?,
        reviewed_by = ?,
        reviewed_at = ?,
        notes = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      hash_set_match !== undefined ? (hash_set_match ? 1 : 0) : null,
      hash_set_name ?? existing.hash_set_name,
      hash_set_category ?? existing.hash_set_category,
      match_confidence ?? existing.match_confidence,
      flagged !== undefined ? (flagged ? 1 : 0) : null,
      flag_reason ?? existing.flag_reason,
      reviewed_by ?? user.userId,
      reviewed_at ?? now,
      notes ?? existing.notes,
      now, req.params.hashId,
    );

    // Log flagging
    if (flagged !== undefined && flagged !== existing.flagged) {
      addTimelineEntry(
        parseInt(req.params.id as string, 10),
        flagged ? 'hash_flagged' : 'hash_unflagged',
        `${existing.file_name} ${flagged ? 'FLAGGED' : 'unflagged'}${flag_reason ? `: ${flag_reason}` : ''}`,
        user.userId, user.fullName || user.username,
      );
    }

    const updated = db.prepare('SELECT * FROM digital_evidence_hashes WHERE id = ?').get(req.params.hashId);
    res.json(updated);
  } catch (error: any) {
    console.error('Update hash error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /:id/hashes/:hashId — Delete hash record ──

router.delete('/:id/hashes/:hashId', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare(`
      SELECT * FROM digital_evidence_hashes WHERE id = ? AND forensic_case_id = ?
    `).get(req.params.hashId, req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Hash record not found' });

    db.prepare('DELETE FROM digital_evidence_hashes WHERE id = ?').run(req.params.hashId);

    const user = (req as any).user;
    addTimelineEntry(
      parseInt(req.params.id as string, 10), 'hash_deleted',
      `Hash record deleted: ${existing.file_name}`,
      user.userId, user.fullName || user.username,
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete hash error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/hashes/verify — Verify a hash against known hash sets ──

router.post('/:id/hashes/verify', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { hash_value, hash_type = 'sha256' } = req.body;
    if (!hash_value?.trim()) return res.status(400).json({ error: 'hash_value is required' });

    const validTypes = ['md5', 'sha1', 'sha256', 'sha512'];
    if (!validTypes.includes(hash_type)) return res.status(400).json({ error: `hash_type must be one of: ${validTypes.join(', ')}` });

    // Search for matches across ALL hash records in the database
    // Use safe column lookup map (defense-in-depth even though hash_type is validated above)
    const hashColumnMap: Record<string, string> = { md5: 'md5', sha1: 'sha1', sha256: 'sha256', sha512: 'sha512' };
    const col = hashColumnMap[hash_type];
    const matches = db.prepare(`
      SELECT deh.*, fc.lab_case_number, fc.title as case_title
      FROM digital_evidence_hashes deh
      LEFT JOIN forensic_cases fc ON deh.forensic_case_id = fc.id
      WHERE deh."${col}" = ?
      ORDER BY deh.created_at DESC
    `).all(hash_value.trim().toLowerCase());

    res.json({
      hash_type,
      hash_value: hash_value.trim().toLowerCase(),
      matches_found: matches.length,
      matches,
    });
  } catch (error: any) {
    console.error('Verify hash error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// LINKED EVIDENCE — Cross-module evidence linkage system
// ═══════════════════════════════════════════════════════════════

// ─── Helper: resolve linked record details ───────────────────
function resolveLinkedRecord(type: string, id: number): any {
  const db = getDb();
  try {
    switch (type) {
      case 'bodycam_video': {
        const r = db.prepare(`SELECT bv.id, bv.title, bv.file_path, bv.file_size, bv.classification, bv.case_number,
          bv.recorded_at, bv.notes, bv.officer_id, u.full_name as officer_name
          FROM bodycam_videos bv LEFT JOIN users u ON bv.officer_id = u.id WHERE bv.id = ?`).get(id) as any;
        return r ? { ...r, display_name: r.title, display_detail: `Officer: ${r.officer_name || 'Unknown'} | ${r.classification || 'routine'}`, icon: 'video' } : null;
      }
      case 'dashcam_video': {
        const r = db.prepare(`SELECT id, cpg_device_id, event_type, event_timestamp, speed_mph, address, latitude, longitude, notes
          FROM dashcam_events WHERE id = ?`).get(id) as any;
        return r ? { ...r, display_name: `Dashcam ${r.event_type} @ ${r.address || 'Unknown location'}`, display_detail: `Speed: ${r.speed_mph || '—'} mph | ${r.event_timestamp || '—'}`, icon: 'dashcam' } : null;
      }
      case 'evidence': {
        const r = db.prepare(`SELECT e.id, e.evidence_number, e.description, e.evidence_type, e.storage_location, e.status,
          e.created_at, u.full_name as collected_by_name
          FROM evidence e LEFT JOIN users u ON e.collected_by = u.id WHERE e.id = ?`).get(id) as any;
        return r ? { ...r, display_name: `${r.evidence_number || 'Evidence'}: ${r.description || ''}`, display_detail: `Type: ${r.evidence_type || '—'} | Status: ${r.status}`, icon: 'evidence' } : null;
      }
      case 'attachment': {
        const r = db.prepare(`SELECT a.id, a.original_name, a.file_path, a.mime_type, a.file_size, a.entity_type, a.entity_id,
          a.created_at, u.full_name as uploaded_by_name
          FROM attachments a LEFT JOIN users u ON a.uploaded_by = u.id WHERE a.id = ?`).get(id) as any;
        return r ? { ...r, display_name: r.original_name, display_detail: `Type: ${r.mime_type || '—'} | Size: ${r.file_size ? Math.round(r.file_size / 1024) + ' KB' : '—'}`, icon: 'file' } : null;
      }
      case 'incident': {
        const r = db.prepare(`SELECT i.id, i.incident_number, i.incident_type, i.status, i.location_address, i.narrative,
          i.created_at, u.full_name as officer_name
          FROM incidents i LEFT JOIN users u ON i.officer_id = u.id WHERE i.id = ?`).get(id) as any;
        return r ? { ...r, display_name: `${r.incident_number || 'Incident'}: ${r.incident_type}`, display_detail: `Status: ${r.status} | ${r.location_address || '—'}`, icon: 'incident' } : null;
      }
      case 'supplemental_report': {
        const r = db.prepare(`SELECT sr.id, sr.report_number, sr.subject, sr.report_type, sr.status, sr.created_at,
          u.full_name as author_name
          FROM supplemental_reports sr LEFT JOIN users u ON sr.author_id = u.id WHERE sr.id = ?`).get(id) as any;
        return r ? { ...r, display_name: `${r.report_number || 'Report'}: ${r.subject}`, display_detail: `Type: ${r.report_type} | By: ${r.author_name || '—'}`, icon: 'report' } : null;
      }
      case 'case': {
        const r = db.prepare(`SELECT c.id, c.case_number, c.title, c.case_type, c.status, c.priority, c.opened_date,
          u.full_name as investigator_name
          FROM cases c LEFT JOIN users u ON c.lead_investigator_id = u.id WHERE c.id = ?`).get(id) as any;
        return r ? { ...r, display_name: `${r.case_number}: ${r.title}`, display_detail: `Status: ${r.status} | ${r.case_type}`, icon: 'case' } : null;
      }
      case 'radio_transcript': {
        const r = db.prepare(`SELECT id, channel, transcript_text, recorded_at, duration_seconds FROM radio_transcripts WHERE id = ?`).get(id) as any;
        return r ? { ...r, display_name: `Radio Transcript: ${r.channel || 'Unknown channel'}`, display_detail: `Duration: ${r.duration_seconds || '—'}s | ${r.recorded_at || '—'}`, icon: 'radio' } : null;
      }
      case 'field_interview': {
        const r = db.prepare(`SELECT fi.id, fi.fi_number, fi.subject_name, fi.location, fi.reason, fi.status, fi.created_at
          FROM field_interviews fi WHERE fi.id = ?`).get(id) as any;
        return r ? { ...r, display_name: `${r.fi_number || 'FI'}: ${r.subject_name || 'Unknown subject'}`, display_detail: `Location: ${r.location || '—'} | ${r.reason || '—'}`, icon: 'interview' } : null;
      }
      case 'citation': {
        const r = db.prepare(`SELECT id, citation_number, violation_description, violator_name, status, issued_date FROM citations WHERE id = ?`).get(id) as any;
        return r ? { ...r, display_name: `${r.citation_number || 'Citation'}: ${r.violation_description || '—'}`, display_detail: `Violator: ${r.violator_name || '—'} | ${r.issued_date || '—'}`, icon: 'citation' } : null;
      }
      case 'daily_activity_report': {
        const r = db.prepare(`SELECT id, dar_number, officer_name, shift_date, status FROM daily_activity_reports WHERE id = ?`).get(id) as any;
        return r ? { ...r, display_name: `${r.dar_number}: ${r.officer_name || 'Unknown'}`, display_detail: `Shift: ${r.shift_date || '—'} | ${r.status}`, icon: 'dar' } : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ─── GET /:id/links — List all linked evidence for a case ────
router.get('/:id/links', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const caseId = parseInt(req.params.id as string, 10);

    // Verify case exists
    const fc = db.prepare('SELECT id FROM forensic_cases WHERE id = ?').get(caseId);
    if (!fc) return res.status(404).json({ error: 'Forensic case not found' });

    const links = db.prepare(`
      SELECT * FROM forensic_case_links WHERE forensic_case_id = ? ORDER BY linked_at DESC
    `).all(caseId) as any[];

    // Resolve each linked record's details
    const resolved = links.map(link => ({
      ...link,
      resolved: resolveLinkedRecord(link.linked_type, link.linked_id),
    }));

    // Stats by type
    const byType: Record<string, number> = {};
    const byRelevance: Record<string, number> = {};
    for (const l of links) {
      byType[l.linked_type] = (byType[l.linked_type] || 0) + 1;
      byRelevance[l.relevance || 'standard'] = (byRelevance[l.relevance || 'standard'] || 0) + 1;
    }

    res.json({
      links: resolved,
      total: links.length,
      by_type: byType,
      by_relevance: byRelevance,
    });
  } catch (error: any) {
    console.error('Get links error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/links — Link evidence to a forensic case ─────
router.post('/:id/links', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const caseId = parseInt(req.params.id as string, 10);
    const user = (req as any).user;
    const { linked_type, linked_id, relationship, relevance, notes } = req.body;

    // Validate
    const fc = db.prepare('SELECT id, lab_case_number FROM forensic_cases WHERE id = ?').get(caseId) as any;
    if (!fc) return res.status(404).json({ error: 'Forensic case not found' });
    if (!linked_type || !linked_id) return res.status(400).json({ error: 'linked_type and linked_id are required' });

    // Verify the target record actually exists
    const resolved = resolveLinkedRecord(linked_type, linked_id);
    if (!resolved) return res.status(404).json({ error: `${linked_type} #${linked_id} not found` });

    // Insert link (UNIQUE constraint prevents duplicates)
    const result = db.prepare(`
      INSERT INTO forensic_case_links (forensic_case_id, linked_type, linked_id, relationship, relevance, notes, linked_by, linked_by_name, linked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(caseId, linked_type, linked_id, relationship || 'associated', relevance || 'standard', notes || null, user.id, user.full_name, localNow());

    // Timeline entry
    addTimelineEntry(caseId, 'evidence_linked',
      `Linked ${linked_type.replace(/_/g, ' ')} "${resolved.display_name}" (${relationship || 'associated'})`,
      user.id, user.full_name
    );

    const link = db.prepare('SELECT * FROM forensic_case_links WHERE id = ?').get(result.lastInsertRowid) as any;
    if (!link) { res.status(500).json({ error: 'Failed to retrieve created link' }); return; }
    res.status(201).json({ ...link, resolved });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'This item is already linked to this case' });
    }
    console.error('Create link error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id/links/:linkId — Update link metadata ──────────
router.put('/:id/links/:linkId', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const caseId = parseInt(req.params.id as string, 10);
    const linkId = parseInt(req.params.linkId as string, 10);
    const user = (req as any).user;
    const { relationship, relevance, notes } = req.body;

    const existing = db.prepare('SELECT * FROM forensic_case_links WHERE id = ? AND forensic_case_id = ?').get(linkId, caseId) as any;
    if (!existing) return res.status(404).json({ error: 'Link not found' });

    const updates: string[] = [];
    const params: any[] = [];
    if (relationship !== undefined) { updates.push('relationship = ?'); params.push(relationship); }
    if (relevance !== undefined) { updates.push('relevance = ?'); params.push(relevance); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }

    if (updates.length > 0) {
      params.push(linkId, caseId);
      db.prepare(`UPDATE forensic_case_links SET ${updates.join(', ')} WHERE id = ? AND forensic_case_id = ?`).run(...params);
    }

    // Log if relationship or relevance changed
    if (relationship && relationship !== existing.relationship) {
      addTimelineEntry(caseId, 'link_updated',
        `Changed link relationship for ${existing.linked_type} #${existing.linked_id}: ${existing.relationship} → ${relationship}`,
        user.id, user.full_name
      );
    }

    const updated = db.prepare('SELECT * FROM forensic_case_links WHERE id = ?').get(linkId) as any;
    if (!updated) { res.status(404).json({ error: 'Link not found after update' }); return; }
    res.json({ ...updated, resolved: resolveLinkedRecord(updated.linked_type, updated.linked_id) });
  } catch (error: any) {
    console.error('Update link error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /:id/links/:linkId — Remove a link ──────────────
router.delete('/:id/links/:linkId', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const caseId = parseInt(req.params.id as string, 10);
    const linkId = parseInt(req.params.linkId as string, 10);
    const user = (req as any).user;

    const existing = db.prepare('SELECT * FROM forensic_case_links WHERE id = ? AND forensic_case_id = ?').get(linkId, caseId) as any;
    if (!existing) return res.status(404).json({ error: 'Link not found' });

    db.prepare('DELETE FROM forensic_case_links WHERE id = ?').run(linkId);

    addTimelineEntry(caseId, 'evidence_unlinked',
      `Removed link to ${existing.linked_type.replace(/_/g, ' ')} #${existing.linked_id}`,
      user.id, user.full_name
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete link error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:id/links/search — Search available records to link ─
router.get('/:id/links/search', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const caseId = parseInt(req.params.id as string, 10);
    const { type, q } = req.query;

    if (!type) return res.status(400).json({ error: 'type parameter required' });

    const search = q ? `%${String(q).toLowerCase()}%` : '%';

    // Get already-linked IDs for this type so we can mark them
    const alreadyLinked = db.prepare(
      'SELECT linked_id FROM forensic_case_links WHERE forensic_case_id = ? AND linked_type = ?'
    ).all(caseId, type).map((r: any) => r.linked_id);

    let results: any[] = [];

    switch (type) {
      case 'bodycam_video':
        results = db.prepare(`
          SELECT bv.id, bv.title, bv.classification, bv.case_number, bv.recorded_at, bv.file_size,
            u.full_name as officer_name
          FROM bodycam_videos bv LEFT JOIN users u ON bv.officer_id = u.id
          WHERE LOWER(bv.title) LIKE ? OR LOWER(bv.case_number) LIKE ? OR LOWER(u.full_name) LIKE ?
          ORDER BY bv.created_at DESC LIMIT 50
        `).all(search, search, search);
        break;

      case 'dashcam_video':
        results = db.prepare(`
          SELECT id, cpg_device_id, event_type, event_timestamp, speed_mph, address
          FROM dashcam_events
          WHERE LOWER(address) LIKE ? OR LOWER(event_type) LIKE ? OR LOWER(cpg_device_id) LIKE ?
          ORDER BY event_timestamp DESC LIMIT 50
        `).all(search, search, search);
        break;

      case 'evidence':
        results = db.prepare(`
          SELECT e.id, e.evidence_number, e.description, e.evidence_type, e.status,
            u.full_name as collected_by_name
          FROM evidence e LEFT JOIN users u ON e.collected_by = u.id
          WHERE LOWER(e.evidence_number) LIKE ? OR LOWER(e.description) LIKE ? OR LOWER(e.evidence_type) LIKE ?
          ORDER BY e.created_at DESC LIMIT 50
        `).all(search, search, search);
        break;

      case 'attachment':
        results = db.prepare(`
          SELECT a.id, a.original_name, a.mime_type, a.file_size, a.entity_type, a.entity_id,
            u.full_name as uploaded_by_name
          FROM attachments a LEFT JOIN users u ON a.uploaded_by = u.id
          WHERE LOWER(a.original_name) LIKE ?
          ORDER BY a.created_at DESC LIMIT 50
        `).all(search);
        break;

      case 'incident':
        results = db.prepare(`
          SELECT i.id, i.incident_number, i.incident_type, i.status, i.location_address,
            u.full_name as officer_name
          FROM incidents i LEFT JOIN users u ON i.officer_id = u.id
          WHERE LOWER(i.incident_number) LIKE ? OR LOWER(i.incident_type) LIKE ? OR LOWER(i.location_address) LIKE ?
          ORDER BY i.created_at DESC LIMIT 50
        `).all(search, search, search);
        break;

      case 'supplemental_report':
        results = db.prepare(`
          SELECT sr.id, sr.report_number, sr.subject, sr.report_type, sr.status,
            u.full_name as author_name
          FROM supplemental_reports sr LEFT JOIN users u ON sr.author_id = u.id
          WHERE LOWER(sr.report_number) LIKE ? OR LOWER(sr.subject) LIKE ?
          ORDER BY sr.created_at DESC LIMIT 50
        `).all(search, search);
        break;

      case 'case':
        results = db.prepare(`
          SELECT c.id, c.case_number, c.title, c.case_type, c.status, c.priority
          FROM cases c
          WHERE LOWER(c.case_number) LIKE ? OR LOWER(c.title) LIKE ?
          ORDER BY c.created_at DESC LIMIT 50
        `).all(search, search);
        break;

      case 'radio_transcript':
        results = db.prepare(`
          SELECT id, channel, recorded_at, duration_seconds
          FROM radio_transcripts
          WHERE LOWER(channel) LIKE ? OR LOWER(transcript_text) LIKE ?
          ORDER BY recorded_at DESC LIMIT 50
        `).all(search, search);
        break;

      case 'field_interview':
        results = db.prepare(`
          SELECT id, fi_number, subject_name, location, reason, status
          FROM field_interviews
          WHERE LOWER(fi_number) LIKE ? OR LOWER(subject_name) LIKE ? OR LOWER(location) LIKE ?
          ORDER BY created_at DESC LIMIT 50
        `).all(search, search, search);
        break;

      case 'citation':
        results = db.prepare(`
          SELECT id, citation_number, violation_description, violator_name, status, issued_date
          FROM citations
          WHERE LOWER(citation_number) LIKE ? OR LOWER(violation_description) LIKE ? OR LOWER(violator_name) LIKE ?
          ORDER BY created_at DESC LIMIT 50
        `).all(search, search, search);
        break;

      case 'daily_activity_report':
        results = db.prepare(`
          SELECT id, dar_number, officer_name, shift_date, status
          FROM daily_activity_reports
          WHERE LOWER(dar_number) LIKE ? OR LOWER(officer_name) LIKE ?
          ORDER BY created_at DESC LIMIT 50
        `).all(search, search);
        break;

      default:
        return res.status(400).json({ error: `Unknown link type: ${type}` });
    }

    // Mark already-linked items
    const markedResults = results.map((r: any) => ({
      ...r,
      already_linked: alreadyLinked.includes(r.id),
    }));

    res.json({ results: markedResults, total: markedResults.length });
  } catch (error: any) {
    console.error('Search linkable records error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:id/links/summary — Case linkage summary for formatting ─
router.get('/:id/links/summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const caseId = parseInt(req.params.id as string, 10);

    const fc = db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(caseId) as any;
    if (!fc) return res.status(404).json({ error: 'Forensic case not found' });

    const links = db.prepare(`
      SELECT * FROM forensic_case_links WHERE forensic_case_id = ? ORDER BY relevance DESC, linked_at ASC
    `).all(caseId) as any[];

    // Build chronological timeline from linked records
    const timelineItems: any[] = [];
    for (const link of links) {
      const resolved = resolveLinkedRecord(link.linked_type, link.linked_id);
      if (!resolved) continue;

      const timestamp = resolved.recorded_at || resolved.event_timestamp || resolved.created_at || resolved.issued_date || resolved.shift_date || link.linked_at;
      timelineItems.push({
        timestamp,
        type: link.linked_type,
        relationship: link.relationship,
        relevance: link.relevance,
        display_name: resolved.display_name,
        display_detail: resolved.display_detail,
        icon: resolved.icon,
        link_id: link.id,
        linked_id: link.linked_id,
      });
    }

    // Sort by timestamp
    timelineItems.sort((a, b) => {
      if (!a.timestamp) return 1;
      if (!b.timestamp) return -1;
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    // Group by type for organized view
    const grouped: Record<string, any[]> = {};
    for (const item of timelineItems) {
      if (!grouped[item.type]) grouped[item.type] = [];
      grouped[item.type].push(item);
    }

    res.json({
      case: fc,
      total_links: links.length,
      timeline: timelineItems,
      grouped,
    });
  } catch (error: any) {
    console.error('Link summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
