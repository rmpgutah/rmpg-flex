import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';

const router = Router();
router.use(authenticateToken);

const VALID_TERSENESS = new Set(['narrative', 'standard', 'terse']);

router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const row = db.prepare(
    'SELECT voice_persona, voice_rate, voice_pitch, voice_terseness, voice_brain_enabled FROM users WHERE id = ?'
  ).get(req.user!.userId);
  res.json(row ?? {});
});

router.put('/', (req: Request, res: Response) => {
  const { voice_persona, voice_rate, voice_pitch, voice_terseness, voice_brain_enabled } = req.body ?? {};
  if (voice_persona != null && (typeof voice_persona !== 'string' || voice_persona.length > 100)) {
    return res.status(400).json({ error: 'invalid voice_persona' });
  }
  if (voice_terseness != null && !VALID_TERSENESS.has(voice_terseness)) {
    return res.status(400).json({ error: 'invalid voice_terseness' });
  }
  if (voice_rate != null && (typeof voice_rate !== 'number' || voice_rate < 0.7 || voice_rate > 1.4)) {
    return res.status(400).json({ error: 'voice_rate out of range' });
  }
  if (voice_pitch != null && (typeof voice_pitch !== 'number' || voice_pitch < -20 || voice_pitch > 20)) {
    return res.status(400).json({ error: 'voice_pitch out of range' });
  }
  // voice_brain_enabled: only 0 or 1 accepted (SQLite INTEGER-as-boolean).
  // Accept booleans too for convenience; normalize to int for the UPDATE.
  let brainFlag: 0 | 1 | undefined;
  if (voice_brain_enabled !== undefined) {
    if (voice_brain_enabled === 0 || voice_brain_enabled === false) brainFlag = 0;
    else if (voice_brain_enabled === 1 || voice_brain_enabled === true) brainFlag = 1;
    else return res.status(400).json({ error: 'invalid voice_brain_enabled' });
  }

  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries({
    voice_persona,
    voice_rate,
    voice_pitch,
    voice_terseness,
    voice_brain_enabled: brainFlag,
  })) {
    if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
  }
  if (sets.length === 0) return res.json({ success: true });
  sets.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(req.user!.userId);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ success: true });
});

export default router;
