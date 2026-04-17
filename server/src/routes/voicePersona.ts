import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';

const router = Router();
router.use(authenticateToken);

const VALID_TERSENESS = new Set(['narrative', 'standard', 'terse']);

router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const row = db.prepare(
    'SELECT voice_persona, voice_rate, voice_pitch, voice_terseness FROM users WHERE id = ?'
  ).get(req.user!.userId);
  res.json(row ?? {});
});

router.put('/', (req: Request, res: Response) => {
  const { voice_persona, voice_rate, voice_pitch, voice_terseness } = req.body ?? {};
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
  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries({ voice_persona, voice_rate, voice_pitch, voice_terseness })) {
    if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
  }
  if (sets.length === 0) return res.json({ success: true });
  sets.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(req.user!.userId);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ success: true });
});

export default router;
