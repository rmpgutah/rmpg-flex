// ============================================================
// business_visits routes (Task 1.14)
// Append-only patrol log for officer drop-ins / premise checks
// at a business location.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { paramStr } from '../utils/reqHelpers';
import { auditLog } from '../utils/auditLogger';
import { broadcastDispatchUpdate } from '../utils/websocket';

const router = Router();
router.use(authenticateToken);

// GET /api/business-visits/:businessId?since=YYYY-MM-DD&limit=N
// Most recent first; default LIMIT 50, capped at 200.
router.get('/:businessId',
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer', 'client_viewer', 'human_resources', 'contract_manager'),
  (req: Request, res: Response) => {
    try {
      const businessId = parseInt(paramStr(req.params.businessId as string | string[] | undefined), 10);
      const since = paramStr(req.query.since as string | string[] | undefined, '').trim();
      const limit = Math.min(parseInt(paramStr(req.query.limit as string | string[] | undefined, '50'), 10) || 50, 200);
      const db = getDb();
      const params: any[] = [businessId];
      let where = 'business_id = ?';
      if (since) { where += ' AND visit_at >= ?'; params.push(since); }
      params.push(limit);
      const rows = db.prepare(`
        SELECT * FROM business_visits
        WHERE ${where}
        ORDER BY visit_at DESC
        LIMIT ?
      `).all(...params);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load business visits: ' + err.message });
    }
  }
);

// POST /api/business-visits — log a visit. officer_id is taken from the
// JWT, NOT the request body, to prevent spoofing.
router.post('/',
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
  (req: Request, res: Response) => {
    try {
      const { business_id, latitude, longitude, notes } = req.body;
      if (!business_id) { res.status(400).json({ error: 'business_id required' }); return; }
      const db = getDb();
      const biz = db.prepare('SELECT id FROM businesses WHERE id = ?').get(business_id);
      if (!biz) { res.status(404).json({ error: 'Business not found' }); return; }
      const officerId = (req as any).user?.userId ?? null;
      if (!officerId) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const result = db.prepare(`
        INSERT INTO business_visits (business_id, officer_id, latitude, longitude, notes)
        VALUES (?, ?, ?, ?, ?)
      `).run(business_id, officerId, latitude ?? null, longitude ?? null, notes || null);
      const row = db.prepare('SELECT * FROM business_visits WHERE id = ?').get(result.lastInsertRowid);
      auditLog(req, 'CREATE', 'business_visit', Number(result.lastInsertRowid), null, row);
      broadcastDispatchUpdate({ action: 'business_visits_updated', business_id });
      res.status(201).json(row);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to log business visit: ' + err.message });
    }
  }
);

export default router;
