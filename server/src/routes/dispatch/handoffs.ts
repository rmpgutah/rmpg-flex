import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { broadcastDispatchUpdate } from '../../utils/websocket';
import { localNow } from '../../utils/timeUtils';
import { auditLog } from '../../utils/auditLogger';
import { paramStr } from '../../utils/reqHelpers';

const router = Router();

// POST /api/dispatch/handoffs — Create a shift handoff
router.post('/handoffs', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = (req as any).user.id;
    const now = localNow();
    const { shift_type, officer_notes, priority_items, weather_conditions, staffing_notes } = req.body;

    // Auto-generate active calls summary
    const activeCalls = db.prepare(`
      SELECT call_number, incident_type, priority, status, location_address
      FROM calls_for_service
      WHERE status NOT IN ('cleared', 'closed', 'cancelled')
      AND (archived_at IS NULL)
      ORDER BY
        CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
        created_at ASC
    `).all();

    const heldCalls = db.prepare(`
      SELECT call_number, incident_type, priority, location_address
      FROM calls_for_service
      WHERE status = 'on_hold'
      AND (archived_at IS NULL)
    `).all();

    const pendingBackups = db.prepare(`
      SELECT c.call_number, c.incident_type, c.priority, c.location_address
      FROM calls_for_service c
      WHERE c.backup_requested = 1 AND c.status NOT IN ('cleared', 'closed', 'cancelled')
      AND (c.archived_at IS NULL)
    `).all();

    const result = db.prepare(`
      INSERT INTO shift_handoffs (outgoing_dispatcher_id, shift_type, active_calls_summary, held_calls_summary, pending_backups, officer_notes, priority_items, weather_conditions, staffing_notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, shift_type || 'day', JSON.stringify(activeCalls), JSON.stringify(heldCalls), JSON.stringify(pendingBackups), officer_notes || null, priority_items || null, weather_conditions || null, staffing_notes || null, now, now);

    auditLog(req, 'CREATE', 'shift_handoffs', result.lastInsertRowid as number, null, { shift_type });
    broadcastDispatchUpdate({ action: 'handoff_created', handoff: { id: result.lastInsertRowid, outgoing_dispatcher_id: userId, shift_type } });

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create handoff', details: err?.message });
  }
});

// GET /api/dispatch/handoffs — List handoffs (last 30 days)
router.get('/handoffs', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const status = req.query.status as string;

    let sql = `
      SELECT h.*, 
        ou.full_name as outgoing_dispatcher_name,
        iu.full_name as incoming_dispatcher_name
      FROM shift_handoffs h
      LEFT JOIN users ou ON h.outgoing_dispatcher_id = ou.id
      LEFT JOIN users iu ON h.incoming_dispatcher_id = iu.id
      WHERE h.created_at >= datetime('now', '-30 days', 'localtime')
    `;
    const params: any[] = [];

    if (status) {
      sql += ' AND h.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY h.created_at DESC LIMIT ?';
    params.push(limit);

    const handoffs = db.prepare(sql).all(...params);
    res.json(handoffs);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list handoffs', details: err?.message });
  }
});

// GET /api/dispatch/handoffs/pending — Get the latest pending handoff
router.get('/handoffs/pending', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const handoff = db.prepare(`
      SELECT h.*,
        ou.full_name as outgoing_dispatcher_name
      FROM shift_handoffs h
      LEFT JOIN users ou ON h.outgoing_dispatcher_id = ou.id
      WHERE h.status = 'pending'
      ORDER BY h.created_at DESC
      LIMIT 1
    `).get();

    res.json(handoff || null);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get pending handoff', details: err?.message });
  }
});

// POST /api/dispatch/handoffs/:id/acknowledge — Incoming dispatcher acknowledges
router.post('/handoffs/:id/acknowledge', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const handoffId = parseInt(paramStr(req.params.id), 10);
    if (isNaN(handoffId)) { res.status(400).json({ error: 'Invalid handoff ID' }); return; }

    const userId = (req as any).user.id;
    const now = localNow();

    const existing = db.prepare('SELECT * FROM shift_handoffs WHERE id = ?').get(handoffId) as any;
    if (!existing) { res.status(404).json({ error: 'Handoff not found' }); return; }
    if (existing.status !== 'pending') { res.status(400).json({ error: 'Handoff already processed' }); return; }

    db.prepare(`
      UPDATE shift_handoffs SET incoming_dispatcher_id = ?, status = 'acknowledged', acknowledged_at = ?, updated_at = ? WHERE id = ?
    `).run(userId, now, now, handoffId);

    auditLog(req, 'UPDATE', 'shift_handoffs', handoffId, { status: 'pending' }, { status: 'acknowledged' });
    broadcastDispatchUpdate({ action: 'handoff_acknowledged', handoff: { id: handoffId, incoming_dispatcher_id: userId } });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to acknowledge handoff', details: err?.message });
  }
});

// POST /api/dispatch/handoffs/:id/complete — Mark handoff as completed
router.post('/handoffs/:id/complete', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const handoffId = parseInt(paramStr(req.params.id), 10);
    if (isNaN(handoffId)) { res.status(400).json({ error: 'Invalid handoff ID' }); return; }

    const now = localNow();
    const existing = db.prepare('SELECT * FROM shift_handoffs WHERE id = ?').get(handoffId) as any;
    if (!existing) { res.status(404).json({ error: 'Handoff not found' }); return; }
    if (existing.status === 'completed') { res.status(400).json({ error: 'Handoff already completed' }); return; }

    db.prepare(`
      UPDATE shift_handoffs SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?
    `).run(now, now, handoffId);

    auditLog(req, 'UPDATE', 'shift_handoffs', handoffId, { status: existing.status }, { status: 'completed' });
    broadcastDispatchUpdate({ action: 'handoff_completed', handoff: { id: handoffId } });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to complete handoff', details: err?.message });
  }
});

export default router;
