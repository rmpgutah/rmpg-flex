import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { paramStr } from '../utils/reqHelpers';

const router = Router();
router.use(authenticateToken);

// GET /:evidenceId — Get full custody chain for an evidence item
router.get('/:evidenceId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidenceId = parseInt(paramStr(req.params.evidenceId), 10);

    const chain = db.prepare(`
      SELECT cl.*, u.full_name as performed_by_name,
        r.full_name as received_by_name
      FROM custody_log cl
      LEFT JOIN users u ON cl.performed_by = u.id
      LEFT JOIN users r ON cl.received_by = r.id
      WHERE cl.evidence_id = ?
      ORDER BY cl.action_time ASC
    `).all(evidenceId);

    res.json(chain);
  } catch (err: any) {
    console.error('[CustodyLog] Get chain error:', err?.message);
    res.status(500).json({ error: 'Failed to get custody chain', code: 'CUSTODY_LOG_ERROR' });
  }
});

// POST / — Log a custody action
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      evidence_id, action, from_location, to_location,
      received_by, reason, notes,
    } = req.body;

    if (!evidence_id || !action) {
      res.status(400).json({ error: 'evidence_id and action are required' });
      return;
    }

    const validActions = ['intake', 'transfer', 'checkout', 'return', 'dispose', 'destroy', 'release', 'lab_submit', 'lab_return', 'court_submit', 'court_return'];
    if (!validActions.includes(action)) {
      res.status(400).json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` });
      return;
    }

    const user = (req as any).user;
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO custody_log (evidence_id, action, performed_by, received_by, from_location, to_location, reason, notes, action_time, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evidence_id, action, user?.id || null, received_by || null,
      from_location || null, to_location || null, reason || null,
      notes || null, now, now
    );

    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    console.error('[CustodyLog] Log action error:', err?.message);
    res.status(500).json({ error: 'Failed to log custody action', code: 'CUSTODY_LOG_ERROR' });
  }
});

// GET /report/:evidenceId — Formatted chain of custody report
router.get('/report/:evidenceId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidenceId = parseInt(paramStr(req.params.evidenceId), 10);

    const chain = db.prepare(`
      SELECT cl.*, u.full_name as performed_by_name,
        r.full_name as received_by_name
      FROM custody_log cl
      LEFT JOIN users u ON cl.performed_by = u.id
      LEFT JOIN users r ON cl.received_by = r.id
      WHERE cl.evidence_id = ?
      ORDER BY cl.action_time ASC
    `).all(evidenceId) as any[];

    const report = {
      evidence_id: evidenceId,
      total_entries: chain.length,
      current_custodian: chain.length > 0 ? chain[chain.length - 1].performed_by_name : null,
      current_location: chain.length > 0 ? chain[chain.length - 1].to_location : null,
      first_logged: chain.length > 0 ? chain[0].action_time : null,
      last_action: chain.length > 0 ? chain[chain.length - 1].action_time : null,
      chain,
    };

    res.json(report);
  } catch (err: any) {
    console.error('[CustodyLog] Report error:', err?.message);
    res.status(500).json({ error: 'Failed to generate custody report', code: 'CUSTODY_LOG_ERROR' });
  }
});

export default router;
