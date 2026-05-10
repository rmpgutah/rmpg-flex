import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { broadcastDispatchUpdate } from '../../utils/websocket';
import { paramStr } from '../../utils/reqHelpers';

const router = Router();

// GET /api/dispatch/call-stack/:unitId — Get stacked calls for a unit
router.get('/call-stack/:unitId', requireRole('admin', 'manager', 'dispatcher', 'supervisor'), (req: Request, res: Response) => {
  const db = getDb();
  const unitId = paramStr(req.params.unitId);
  const rows = db.prepare(`
    SELECT cs.*, c.call_number, c.incident_type, c.location, c.priority, c.status, c.description,
           c.created_at as call_created_at
    FROM call_stack cs
    JOIN calls_for_service c ON cs.call_id = c.id
    WHERE cs.unit_id = ?
    ORDER BY cs.priority_order ASC
  `).all(unitId);
  res.json(rows);
});

// POST /api/dispatch/call-stack — Add a call to a unit's stack
router.post('/call-stack', requireRole('admin', 'manager', 'dispatcher', 'supervisor'), (req: Request, res: Response) => {
  const db = getDb();
  const { unit_id, call_id, priority_order } = req.body;
  if (!unit_id || !call_id) {
    res.status(400).json({ error: 'unit_id and call_id are required' });
    return;
  }
  // Get next priority order if not specified
  const order = priority_order ?? (db.prepare(
    'SELECT COALESCE(MAX(priority_order), 0) + 1 as next_order FROM call_stack WHERE unit_id = ?'
  ).get(unit_id) as any)?.next_order ?? 1;

  try {
    const result = db.prepare(
      'INSERT INTO call_stack (unit_id, call_id, priority_order, added_by) VALUES (?, ?, ?, ?)'
    ).run(unit_id, call_id, order, (req as any).user?.id);
    broadcastDispatchUpdate({ action: 'call_stack_updated', data: { unit_id } });
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE constraint')) {
      res.status(409).json({ error: 'Call already in unit stack' });
      return;
    }
    throw err;
  }
});

// PUT /api/dispatch/call-stack/reorder — Reorder calls in a unit's stack
router.put('/call-stack/reorder', requireRole('admin', 'manager', 'dispatcher', 'supervisor'), (req: Request, res: Response) => {
  const db = getDb();
  const { unit_id, call_ids } = req.body;
  if (!unit_id || !Array.isArray(call_ids)) {
    res.status(400).json({ error: 'unit_id and call_ids array required' });
    return;
  }
  const update = db.prepare('UPDATE call_stack SET priority_order = ? WHERE unit_id = ? AND call_id = ?');
  const tx = db.transaction(() => {
    call_ids.forEach((callId: number, index: number) => {
      update.run(index, unit_id, callId);
    });
  });
  tx();
  broadcastDispatchUpdate({ action: 'call_stack_updated', data: { unit_id } });
  res.json({ success: true });
});

// DELETE /api/dispatch/call-stack/:unitId/:callId — Remove a call from stack
router.delete('/call-stack/:unitId/:callId', requireRole('admin', 'manager', 'dispatcher', 'supervisor'), (req: Request, res: Response) => {
  const db = getDb();
  const unitId = paramStr(req.params.unitId);
  const callId = parseInt(paramStr(req.params.callId), 10);
  db.prepare('DELETE FROM call_stack WHERE unit_id = ? AND call_id = ?').run(unitId, callId);
  broadcastDispatchUpdate({ action: 'call_stack_updated', data: { unit_id: unitId } });
  res.json({ success: true });
});

// DELETE /api/dispatch/call-stack/:unitId — Clear entire unit stack
router.delete('/call-stack/:unitId', requireRole('admin', 'manager', 'dispatcher', 'supervisor'), (req: Request, res: Response) => {
  const db = getDb();
  const unitId = paramStr(req.params.unitId);
  db.prepare('DELETE FROM call_stack WHERE unit_id = ?').run(unitId);
  broadcastDispatchUpdate({ action: 'call_stack_updated', data: { unit_id: unitId } });
  res.json({ success: true });
});

export default router;
