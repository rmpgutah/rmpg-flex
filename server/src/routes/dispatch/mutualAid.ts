import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { broadcastDispatchUpdate } from '../../utils/websocket';
import { localNow } from '../../utils/timeUtils';
import { auditLog } from '../../utils/auditLogger';
import { paramStr } from '../../utils/reqHelpers';

const router = Router();

// POST /api/dispatch/mutual-aid — Create mutual aid request
router.post('/mutual-aid', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = (req as any).user.id;
    const now = localNow();
    const {
      responding_agency, call_id, request_type, units_requested,
      reason, priority, contact_name, contact_phone, contact_radio
    } = req.body;

    if (!responding_agency) { res.status(400).json({ error: 'responding_agency is required' }); return; }

    const result = db.prepare(`
      INSERT INTO mutual_aid_requests (responding_agency, call_id, request_type, units_requested, reason, priority, contact_name, contact_phone, contact_radio, requested_by, requested_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      responding_agency, call_id || null, request_type || 'units',
      units_requested || 1, reason || null, priority || 'P2',
      contact_name || null, contact_phone || null, contact_radio || null,
      userId, now, now, now
    );

    auditLog(req, 'CREATE', 'mutual_aid_requests', result.lastInsertRowid as number, null, { responding_agency, reason });
    broadcastDispatchUpdate({ action: 'mutual_aid_requested', request: { id: result.lastInsertRowid, responding_agency, priority } });

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create mutual aid request', details: err?.message });
  }
});

// GET /api/dispatch/mutual-aid — List mutual aid requests
router.get('/mutual-aid', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const status = req.query.status as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    let sql = `
      SELECT m.*,
        ru.full_name as requested_by_name,
        rsu.full_name as responded_by_name,
        c.call_number, c.incident_type as call_type
      FROM mutual_aid_requests m
      LEFT JOIN users ru ON m.requested_by = ru.id
      LEFT JOIN users rsu ON m.responded_by = rsu.id
      LEFT JOIN calls_for_service c ON m.call_id = c.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      sql += ' AND m.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY m.requested_at DESC LIMIT ?';
    params.push(limit);

    const requests = db.prepare(sql).all(...params);
    res.json(requests);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list mutual aid requests', details: err?.message });
  }
});

// GET /api/dispatch/mutual-aid/stats — Mutual aid statistics
router.get('/mutual-aid/stats', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.min(parseInt(req.query.days as string) || 90, 365);

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_requests,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) as denied,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(units_requested) as total_units_requested,
        SUM(units_provided) as total_units_provided
      FROM mutual_aid_requests
      WHERE requested_at >= datetime('now', '-' || ? || ' days', 'localtime')
    `).get(days);

    const byAgency = db.prepare(`
      SELECT responding_agency,
        COUNT(*) as request_count,
        SUM(CASE WHEN status IN ('approved','completed') THEN 1 ELSE 0 END) as fulfilled
      FROM mutual_aid_requests
      WHERE requested_at >= datetime('now', '-' || ? || ' days', 'localtime')
      GROUP BY responding_agency
      ORDER BY request_count DESC
    `).all(days);

    res.json({ ...stats as any, by_agency: byAgency, period_days: days });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get mutual aid stats', details: err?.message });
  }
});

// POST /api/dispatch/mutual-aid/:id/respond — Respond to mutual aid
router.post('/mutual-aid/:id/respond', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const requestId = parseInt(paramStr(req.params.id), 10);
    if (isNaN(requestId)) { res.status(400).json({ error: 'Invalid request ID' }); return; }

    const userId = (req as any).user.id;
    const now = localNow();
    const { units_provided, response_notes, status } = req.body;

    const existing = db.prepare('SELECT * FROM mutual_aid_requests WHERE id = ?').get(requestId) as any;
    if (!existing) { res.status(404).json({ error: 'Request not found' }); return; }

    const newStatus = status || (units_provided > 0 ? 'approved' : 'denied');

    db.prepare(`
      UPDATE mutual_aid_requests SET units_provided = ?, response_notes = ?, status = ?, responded_by = ?, responded_at = ?, updated_at = ? WHERE id = ?
    `).run(units_provided || 0, response_notes || null, newStatus, userId, now, now, requestId);

    auditLog(req, 'UPDATE', 'mutual_aid_requests', requestId, { status: existing.status }, { status: newStatus });
    broadcastDispatchUpdate({ action: 'mutual_aid_responded', request: { id: requestId, status: newStatus, units_provided } });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to respond to mutual aid', details: err?.message });
  }
});

// POST /api/dispatch/mutual-aid/:id/complete — Complete mutual aid
router.post('/mutual-aid/:id/complete', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const requestId = parseInt(paramStr(req.params.id), 10);
    if (isNaN(requestId)) { res.status(400).json({ error: 'Invalid request ID' }); return; }

    const now = localNow();
    const existing = db.prepare('SELECT * FROM mutual_aid_requests WHERE id = ?').get(requestId) as any;
    if (!existing) { res.status(404).json({ error: 'Request not found' }); return; }

    db.prepare(`UPDATE mutual_aid_requests SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`).run(now, now, requestId);

    auditLog(req, 'UPDATE', 'mutual_aid_requests', requestId, { status: existing.status }, { status: 'completed' });
    broadcastDispatchUpdate({ action: 'mutual_aid_completed', request: { id: requestId } });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to complete mutual aid', details: err?.message });
  }
});

// POST /api/dispatch/mutual-aid/:id/cancel — Cancel mutual aid
router.post('/mutual-aid/:id/cancel', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const requestId = parseInt(paramStr(req.params.id), 10);
    if (isNaN(requestId)) { res.status(400).json({ error: 'Invalid request ID' }); return; }

    const now = localNow();

    db.prepare(`UPDATE mutual_aid_requests SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`).run(now, now, requestId);

    auditLog(req, 'UPDATE', 'mutual_aid_requests', requestId, null, { status: 'cancelled' });
    broadcastDispatchUpdate({ action: 'mutual_aid_cancelled', request: { id: requestId } });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to cancel mutual aid', details: err?.message });
  }
});

export default router;
