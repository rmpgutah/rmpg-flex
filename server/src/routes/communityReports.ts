import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { paramStr } from '../utils/reqHelpers';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateTrackingNumber(db: ReturnType<typeof getDb>): string {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefix = `CR-${ymd}-`;
  const row = db.prepare(
    `SELECT tracking_number FROM community_reports WHERE tracking_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${prefix}%`) as { tracking_number: string } | undefined;

  let seq = 1;
  if (row) {
    const parts = row.tracking_number.split('-');
    const parsed = parseInt(parts[parts.length - 1], 10);
    seq = isNaN(parsed) ? 1 : parsed + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS (no auth)
// ═══════════════════════════════════════════════════════════════════════════

// POST /public/submit — Submit a community report (anonymous)
router.post('/public/submit', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { category, description, location, reporter_name, reporter_email, reporter_phone, latitude, longitude } = req.body;

    if (!category || !description) {
      res.status(400).json({ error: 'category and description are required' });
      return;
    }

    const tracking_number = generateTrackingNumber(db);
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO community_reports (tracking_number, category, description, location, reporter_name, reporter_email, reporter_phone, latitude, longitude, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)
    `).run(tracking_number, category, description, location || null, reporter_name || null, reporter_email || null, reporter_phone || null, latitude || null, longitude || null, now, now);

    res.status(201).json({ success: true, id: result.lastInsertRowid, tracking_number });
  } catch (err: any) {
    console.error('[CommunityReports] Submit error:', err?.message);
    res.status(500).json({ error: 'Failed to submit report', code: 'COMMUNITY_REPORTS_ERROR' });
  }
});

// GET /public/status/:trackingNumber — Check report status (anonymous)
router.get('/public/status/:trackingNumber', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const trackingNumber = paramStr(req.params.trackingNumber);
    const row = db.prepare(
      `SELECT tracking_number, category, status, created_at, updated_at FROM community_reports WHERE tracking_number = ?`
    ).get(trackingNumber);

    if (!row) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    res.json(row);
  } catch (err: any) {
    console.error('[CommunityReports] Status lookup error:', err?.message);
    res.status(500).json({ error: 'Failed to look up report status', code: 'COMMUNITY_REPORTS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PROTECTED ENDPOINTS (auth required)
// ═══════════════════════════════════════════════════════════════════════════

router.use(authenticateToken);

// GET / — List community reports
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, category, search, date_from, date_to } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (status) { where += ' AND status = ?'; params.push(status); }
    if (category) { where += ' AND category = ?'; params.push(category); }
    if (date_from) { where += ' AND created_at >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND created_at <= ?'; params.push(date_to); }
    if (search) {
      where += ' AND (description LIKE ? OR location LIKE ? OR reporter_name LIKE ? OR tracking_number LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const rows = db.prepare(`SELECT * FROM community_reports ${where} ORDER BY created_at DESC`).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('[CommunityReports] List error:', err?.message);
    res.status(500).json({ error: 'Failed to list reports', code: 'COMMUNITY_REPORTS_ERROR' });
  }
});

// GET /:id — Get single report
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const row = db.prepare('SELECT * FROM community_reports WHERE id = ?').get(id);
    if (!row) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    res.json(row);
  } catch (err: any) {
    console.error('[CommunityReports] Get error:', err?.message);
    res.status(500).json({ error: 'Failed to get report', code: 'COMMUNITY_REPORTS_ERROR' });
  }
});

// PUT /:id — Update report status/assignment
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const { status, assigned_officer_id, notes } = req.body;
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT id FROM community_reports WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    db.prepare(`
      UPDATE community_reports SET status = COALESCE(?, status), assigned_officer_id = COALESCE(?, assigned_officer_id), notes = COALESCE(?, notes), updated_at = ? WHERE id = ?
    `).run(status || null, assigned_officer_id || null, notes || null, now, id);

    const updated = db.prepare('SELECT * FROM community_reports WHERE id = ?').get(id);
    res.json(updated);
  } catch (err: any) {
    console.error('[CommunityReports] Update error:', err?.message);
    res.status(500).json({ error: 'Failed to update report', code: 'COMMUNITY_REPORTS_ERROR' });
  }
});

// DELETE /:id — Delete report (admin only)
router.delete('/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);

    const existing = db.prepare('SELECT id FROM community_reports WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    db.prepare('DELETE FROM community_reports WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[CommunityReports] Delete error:', err?.message);
    res.status(500).json({ error: 'Failed to delete report', code: 'COMMUNITY_REPORTS_ERROR' });
  }
});

export default router;
