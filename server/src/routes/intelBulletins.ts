import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';
import { localNow } from '../utils/timeUtils';
import { paramStr } from '../utils/reqHelpers';

const router = Router();
router.use(authenticateToken);

// GET /stats/summary - Dashboard stats (mounted BEFORE /:id)
router.get('/stats/summary', (req: Request, res: Response) => {
  const db = getDb();
  const userId = (req as any).user.userId;

  const activeByType = db.prepare(`
    SELECT bulletin_type, COUNT(*) as count
    FROM intel_bulletins
    WHERE status = 'active'
    GROUP BY bulletin_type
  `).all();

  const unacknowledged = db.prepare(`
    SELECT COUNT(*) as count
    FROM intel_bulletins
    WHERE status = 'active'
      AND id NOT IN (
        SELECT bulletin_id FROM intel_bulletin_acknowledgments WHERE user_id = ?
      )
  `).get(userId) as any;

  const expiringWithin24h = db.prepare(`
    SELECT COUNT(*) as count
    FROM intel_bulletins
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at <= datetime('now', '+24 hours')
  `).get() as any;

  res.json({
    activeByType,
    unacknowledgedCount: unacknowledged?.count || 0,
    expiringWithin24h: expiringWithin24h?.count || 0
  });
});

// GET /repeat-locations/analysis - Repeat location analysis (mounted BEFORE /:id)
router.get('/repeat-locations/analysis', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  const db = getDb();
  const days = parseInt(req.query.days as string) || 30;
  const limit = parseInt(req.query.limit as string) || 50;

  const results = db.prepare(`
    SELECT
      location_address,
      COUNT(*) as call_count,
      ROUND(AVG(CAST(priority AS REAL)), 2) as avg_priority,
      GROUP_CONCAT(DISTINCT incident_type) as incident_types
    FROM calls_for_service
    WHERE location_address IS NOT NULL
      AND location_address != ''
      AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY location_address
    HAVING call_count > 1
    ORDER BY call_count DESC
    LIMIT ?
  `).all(days, limit);

  res.json(results);
});

// GET / - List all bulletins
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const { status, type, priority, search } = req.query;

  let sql = 'SELECT * FROM intel_bulletins WHERE 1=1';
  const params: any[] = [];

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  } else {
    sql += " AND status = 'active'";
  }

  if (type) {
    sql += ' AND bulletin_type = ?';
    params.push(type);
  }

  if (priority) {
    sql += ' AND priority = ?';
    params.push(priority);
  }

  if (search) {
    sql += ' AND (title LIKE ? OR description LIKE ? OR suspect_name LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  sql += ` ORDER BY
    CASE priority
      WHEN 'critical' THEN 4
      WHEN 'high' THEN 3
      WHEN 'medium' THEN 2
      WHEN 'low' THEN 1
      ELSE 0
    END DESC,
    created_at DESC`;

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// GET /:id - Get single bulletin
router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);

  const bulletin = db.prepare('SELECT * FROM intel_bulletins WHERE id = ?').get(id);
  if (!bulletin) {
    return res.status(404).json({ error: 'Bulletin not found' });
  }

  res.json(bulletin);
});

// POST / - Create new bulletin
router.post('/', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  const db = getDb();
  const userId = (req as any).user.userId;
  const {
    title, bulletin_type, priority, description,
    suspect_name, suspect_description, vehicle_description,
    location_area, weapons_involved, photo_url, expires_at,
    linked_case_id, linked_warrant_id, linked_call_id
  } = req.body;

  if (!title || !bulletin_type || !priority || !description) {
    return res.status(400).json({ error: 'Missing required fields: title, bulletin_type, priority, description' });
  }

  const now = localNow();

  // Wrap sequence generation + insert in a transaction to prevent race conditions
  const insertBulletin = db.transaction(() => {
    const year = new Date().getFullYear();
    const lastBulletin = db.prepare("SELECT bulletin_number FROM intel_bulletins WHERE bulletin_number LIKE ? ORDER BY id DESC LIMIT 1").get(`IB-${year}-%`) as any;
    let seq = 1;
    if (lastBulletin) {
      const parts = lastBulletin.bulletin_number.split('-');
      if (parts.length === 3 && !isNaN(parseInt(parts[2]))) {
        seq = parseInt(parts[2]) + 1;
      }
    }
    const bulletinNumber = `IB-${year}-${String(seq).padStart(5, '0')}`;

    const result = db.prepare(`
      INSERT INTO intel_bulletins (
        bulletin_number, title, bulletin_type, priority, description,
        suspect_name, suspect_description, vehicle_description,
        location_area, weapons_involved, photo_url, expires_at,
        linked_case_id, linked_warrant_id, linked_call_id,
        status, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      bulletinNumber, title, bulletin_type, priority, description,
      suspect_name ?? null, suspect_description ?? null, vehicle_description ?? null,
      location_area ?? null, weapons_involved ?? null, photo_url ?? null, expires_at ?? null,
      linked_case_id ?? null, linked_warrant_id ?? null, linked_call_id ?? null,
      userId, now
    );

    return db.prepare('SELECT * FROM intel_bulletins WHERE id = ?').get(result.lastInsertRowid);
  });

  const bulletin = insertBulletin();

  auditLog(req, 'CREATE', 'intel_bulletins', (bulletin as any)?.id, null, bulletin);
  broadcast('intel', 'intel_bulletin_created', bulletin);

  res.status(201).json(bulletin);
});

// PUT /:id - Update bulletin
router.put('/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const userId = (req as any).user.userId;

  const existing = db.prepare('SELECT * FROM intel_bulletins WHERE id = ?').get(id) as any;
  if (!existing) {
    return res.status(404).json({ error: 'Bulletin not found' });
  }

  const {
    title, bulletin_type, priority, description,
    suspect_name, suspect_description, vehicle_description,
    location_area, weapons_involved, photo_url, expires_at, status,
    linked_case_id, linked_warrant_id, linked_call_id
  } = req.body;

  const now = localNow();

  let cancelledBy = existing.cancelled_by;
  let cancelledAt = existing.cancelled_at;
  let expiredAt = existing.expired_at;

  if (status && status !== existing.status) {
    if (status === 'cancelled') {
      cancelledBy = userId;
      cancelledAt = now;
    } else if (status === 'expired') {
      expiredAt = now;
    }
  }

  db.prepare(`
    UPDATE intel_bulletins SET
      title = COALESCE(?, title),
      bulletin_type = COALESCE(?, bulletin_type),
      priority = COALESCE(?, priority),
      description = COALESCE(?, description),
      suspect_name = ?,
      suspect_description = ?,
      vehicle_description = ?,
      location_area = ?,
      weapons_involved = ?,
      photo_url = ?,
      expires_at = ?,
      status = COALESCE(?, status),
      linked_case_id = ?,
      linked_warrant_id = ?,
      linked_call_id = ?,
      cancelled_by = ?,
      cancelled_at = ?,
      expired_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    title || null, bulletin_type || null, priority || null, description || null,
    suspect_name !== undefined ? suspect_name : existing.suspect_name,
    suspect_description !== undefined ? suspect_description : existing.suspect_description,
    vehicle_description !== undefined ? vehicle_description : existing.vehicle_description,
    location_area !== undefined ? location_area : existing.location_area,
    weapons_involved !== undefined ? weapons_involved : existing.weapons_involved,
    photo_url !== undefined ? photo_url : existing.photo_url,
    expires_at !== undefined ? expires_at : existing.expires_at,
    status || null,
    linked_case_id !== undefined ? linked_case_id : existing.linked_case_id,
    linked_warrant_id !== undefined ? linked_warrant_id : existing.linked_warrant_id,
    linked_call_id !== undefined ? linked_call_id : existing.linked_call_id,
    cancelledBy, cancelledAt, expiredAt, now,
    id
  );

  const updated = db.prepare('SELECT * FROM intel_bulletins WHERE id = ?').get(id);

  auditLog(req, 'UPDATE', 'intel_bulletins', id, existing, updated);
  broadcast('intel', 'intel_bulletin_updated', updated);

  res.json(updated);
});

// DELETE /:id - Soft delete (cancel)
router.delete('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const userId = (req as any).user.userId;

  const existing = db.prepare('SELECT * FROM intel_bulletins WHERE id = ?').get(id) as any;
  if (!existing) {
    return res.status(404).json({ error: 'Bulletin not found' });
  }

  const now = localNow();

  db.prepare(`
    UPDATE intel_bulletins SET status = 'cancelled', cancelled_by = ?, cancelled_at = ?, updated_at = ? WHERE id = ?
  `).run(userId, now, now, id);

  const updated = db.prepare('SELECT * FROM intel_bulletins WHERE id = ?').get(id);

  auditLog(req, 'DELETE', 'intel_bulletins', id, existing, updated);
  broadcast('intel', 'intel_bulletin_cancelled', updated);

  res.json(updated);
});

// POST /:id/acknowledge - Officer acknowledges bulletin
router.post('/:id/acknowledge', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const userId = (req as any).user.userId;

  const bulletin = db.prepare('SELECT * FROM intel_bulletins WHERE id = ?').get(id);
  if (!bulletin) {
    return res.status(404).json({ error: 'Bulletin not found' });
  }

  const existing = db.prepare(
    'SELECT * FROM intel_bulletin_acknowledgments WHERE bulletin_id = ? AND user_id = ?'
  ).get(id, userId);

  if (existing) {
    return res.status(409).json({ error: 'Already acknowledged' });
  }

  const now = localNow();
  db.prepare(`
    INSERT INTO intel_bulletin_acknowledgments (bulletin_id, user_id, acknowledged_at)
    VALUES (?, ?, ?)
  `).run(id, userId, now);

  res.json({ success: true, acknowledged_at: now });
});

// GET /:id/acknowledgments - List acknowledgments
router.get('/:id/acknowledgments', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);

  const rows = db.prepare(`
    SELECT a.*, u.username, u.full_name
    FROM intel_bulletin_acknowledgments a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.bulletin_id = ?
    ORDER BY a.acknowledged_at DESC
  `).all(id);

  res.json(rows);
});

export default router;
