/**
 * Per-unit audio mode endpoints.
 *
 * GET  /api/dispatch/units/mine/audio-mode   — current officer's unit
 * GET  /api/dispatch/units/:id/audio-mode    — specific unit (supervisor+)
 * PUT  /api/dispatch/units/mine/audio-mode   — officer changes own unit
 * PUT  /api/dispatch/units/:id/audio-mode    — supervisor overrides
 */
import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { auditLog } from '../../utils/auditLogger';
import { paramStr } from '../../utils/reqHelpers';
import { getUnitAudioMode, getUnitAudioModeByOfficer, setUnitAudioMode, isAudioMode } from '../../utils/audioMode';
import { broadcastUnitUpdate } from '../../utils/websocket';
import { logger } from '../../utils/logger';

const router = Router();

router.get('/units/mine/audio-mode', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: 'Auth required', code: 'AUTH_REQUIRED' }); return; }
    const mode = getUnitAudioModeByOfficer(getDb(), userId);
    res.json({ audio_mode: mode });
  } catch (err: any) {
    logger.error({ err }, 'audio-mode mine get failed');
    res.status(500).json({ error: 'Failed to fetch audio mode', code: 'AUDIO_MODE_GET_ERROR' });
  }
});

router.get('/units/:id/audio-mode', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const id = Number(paramStr(req.params.id));
    if (!id) { res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' }); return; }
    res.json({ unit_id: id, audio_mode: getUnitAudioMode(getDb(), id) });
  } catch (err: any) {
    logger.error({ err }, 'audio-mode get failed');
    res.status(500).json({ error: 'Failed to fetch audio mode', code: 'AUDIO_MODE_GET_ERROR' });
  }
});

router.put('/units/mine/audio-mode', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: 'Auth required', code: 'AUTH_REQUIRED' }); return; }
    const mode = req.body?.audio_mode;
    if (!isAudioMode(mode)) { res.status(400).json({ error: 'audio_mode must be normal|silent|vibrate', code: 'INVALID_AUDIO_MODE' }); return; }

    const db = getDb();
    const unit = db.prepare('SELECT id FROM units WHERE officer_id = ? AND status != ?').get(userId, 'off_duty') as { id: number } | undefined;
    if (!unit) { res.status(404).json({ error: 'No active unit for this officer', code: 'NO_ACTIVE_UNIT' }); return; }

    setUnitAudioMode(db, unit.id, mode);
    auditLog(req, 'UPDATE', 'unit', unit.id, null, { audio_mode: mode });
    broadcastUnitUpdate({ action: 'unit_audio_mode_changed', unit_id: unit.id, audio_mode: mode });
    res.json({ success: true, unit_id: unit.id, audio_mode: mode });
  } catch (err: any) {
    logger.error({ err }, 'audio-mode mine set failed');
    res.status(500).json({ error: 'Failed to set audio mode', code: 'AUDIO_MODE_SET_ERROR' });
  }
});

router.put('/units/:id/audio-mode', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const id = Number(paramStr(req.params.id));
    if (!id) { res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' }); return; }
    const mode = req.body?.audio_mode;
    if (!isAudioMode(mode)) { res.status(400).json({ error: 'audio_mode must be normal|silent|vibrate', code: 'INVALID_AUDIO_MODE' }); return; }
    const db = getDb();
    const changed = setUnitAudioMode(db, id, mode);
    if (!changed) { res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }); return; }
    auditLog(req, 'UPDATE', 'unit', id, null, { audio_mode: mode });
    broadcastUnitUpdate({ action: 'unit_audio_mode_changed', unit_id: id, audio_mode: mode });
    res.json({ success: true, unit_id: id, audio_mode: mode });
  } catch (err: any) {
    logger.error({ err }, 'audio-mode set failed');
    res.status(500).json({ error: 'Failed to set audio mode', code: 'AUDIO_MODE_SET_ERROR' });
  }
});

export default router;
