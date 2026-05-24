/**
 * Dispatch run cards — CRUD for incident-type defaults.
 *
 * GET    /api/dispatch/run-cards            list all
 * GET    /api/dispatch/run-cards/:type      one by incident_type
 * POST   /api/dispatch/run-cards            create
 * PUT    /api/dispatch/run-cards/:id        update
 * DELETE /api/dispatch/run-cards/:id        soft delete (admin only)
 */
import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { auditLog } from '../../utils/auditLogger';
import { paramStr } from '../../utils/reqHelpers';
import { logger } from '../../utils/logger';

const router = Router();

router.get('/run-cards', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM dispatch_run_cards ORDER BY incident_type').all();
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, 'run-cards list failed');
    res.status(500).json({ error: 'Failed to list run cards', code: 'RUN_CARDS_LIST_ERROR' });
  }
});

router.get('/run-cards/:type', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM dispatch_run_cards WHERE incident_type = ?').get(paramStr(req.params.type));
    if (!row) {
      res.status(404).json({ error: 'Run card not found', code: 'RUN_CARD_NOT_FOUND' });
      return;
    }
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, 'run-card get failed');
    res.status(500).json({ error: 'Failed to fetch run card', code: 'RUN_CARD_GET_ERROR' });
  }
});

router.post('/run-cards', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { incident_type, label, priority, flags, min_units, backup_units, requires_supervisor, caution_text, auto_link_premise } = req.body ?? {};
    if (!incident_type || !label) {
      res.status(400).json({ error: 'incident_type and label are required', code: 'INCIDENT_TYPE_AND_LABEL_REQUIRED' });
      return;
    }
    const flagsJson = JSON.stringify(Array.isArray(flags) ? flags : []);
    const r = db.prepare(`
      INSERT INTO dispatch_run_cards
        (incident_type, label, priority, flags, min_units, backup_units, requires_supervisor, caution_text, auto_link_premise)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(incident_type, label, priority ?? null, flagsJson,
           min_units ?? 1, backup_units ?? 0,
           requires_supervisor ? 1 : 0, caution_text ?? null,
           auto_link_premise == null ? 1 : (auto_link_premise ? 1 : 0));
    auditLog(req, 'CREATE', 'dispatch_run_card', Number(r.lastInsertRowid), null, { incident_type, label });
    res.json({ success: true, id: r.lastInsertRowid });
  } catch (err: any) {
    if (String(err?.message ?? '').includes('UNIQUE')) {
      res.status(409).json({ error: 'A run card for this incident_type already exists', code: 'RUN_CARD_DUPLICATE' });
      return;
    }
    logger.error({ err }, 'run-card create failed');
    res.status(500).json({ error: 'Failed to create run card', code: 'RUN_CARD_CREATE_ERROR' });
  }
});

router.put('/run-cards/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(paramStr(req.params.id));
    if (!id) {
      res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' });
      return;
    }
    const existing = db.prepare('SELECT * FROM dispatch_run_cards WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Run card not found', code: 'RUN_CARD_NOT_FOUND' });
      return;
    }
    const { label, priority, flags, min_units, backup_units, requires_supervisor, caution_text, auto_link_premise } = req.body ?? {};
    const flagsJson = flags == null ? undefined : JSON.stringify(Array.isArray(flags) ? flags : []);
    db.prepare(`
      UPDATE dispatch_run_cards SET
        label              = COALESCE(?, label),
        priority           = COALESCE(?, priority),
        flags              = COALESCE(?, flags),
        min_units          = COALESCE(?, min_units),
        backup_units       = COALESCE(?, backup_units),
        requires_supervisor= COALESCE(?, requires_supervisor),
        caution_text       = COALESCE(?, caution_text),
        auto_link_premise  = COALESCE(?, auto_link_premise),
        updated_at         = datetime('now','localtime')
      WHERE id = ?
    `).run(
      label ?? null, priority ?? null, flagsJson ?? null,
      min_units ?? null, backup_units ?? null,
      requires_supervisor == null ? null : (requires_supervisor ? 1 : 0),
      caution_text ?? null,
      auto_link_premise == null ? null : (auto_link_premise ? 1 : 0),
      id,
    );
    auditLog(req, 'UPDATE', 'dispatch_run_card', id, existing, req.body);
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, 'run-card update failed');
    res.status(500).json({ error: 'Failed to update run card', code: 'RUN_CARD_UPDATE_ERROR' });
  }
});

router.delete('/run-cards/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(paramStr(req.params.id));
    const existing = db.prepare('SELECT * FROM dispatch_run_cards WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Run card not found', code: 'RUN_CARD_NOT_FOUND' });
      return;
    }
    db.prepare('DELETE FROM dispatch_run_cards WHERE id = ?').run(id);
    auditLog(req, 'DELETE', 'dispatch_run_card', id, existing, null);
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, 'run-card delete failed');
    res.status(500).json({ error: 'Failed to delete run card', code: 'RUN_CARD_DELETE_ERROR' });
  }
});

export default router;
