import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';

const VALID_TERSENESS = new Set(['narrative', 'standard', 'terse']);

export function mountVoicePersonaRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/voice-persona
  api.get('/', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const row = await db.prepare(
      'SELECT voice_persona, voice_rate, voice_pitch, voice_terseness, voice_brain_enabled FROM users WHERE id = ?'
    ).get(user.userId);
    return c.json(row ?? {});
  });

  // PUT /api/voice-persona
  api.put('/', async (c) => {
    const { voice_persona, voice_rate, voice_pitch, voice_terseness, voice_brain_enabled } = await c.req.json();
    if (voice_persona != null && (typeof voice_persona !== 'string' || voice_persona.length > 100)) {
      return c.json({ error: 'invalid voice_persona' }, 400);
    }
    if (voice_terseness != null && !VALID_TERSENESS.has(voice_terseness)) {
      return c.json({ error: 'invalid voice_terseness' }, 400);
    }
    if (voice_rate != null && (typeof voice_rate !== 'number' || voice_rate < 0.7 || voice_rate > 1.4)) {
      return c.json({ error: 'voice_rate out of range' }, 400);
    }
    if (voice_pitch != null && (typeof voice_pitch !== 'number' || voice_pitch < -20 || voice_pitch > 20)) {
      return c.json({ error: 'voice_pitch out of range' }, 400);
    }
    let brainFlag: 0 | 1 | undefined;
    if (voice_brain_enabled !== undefined) {
      if (voice_brain_enabled === 0 || voice_brain_enabled === false) brainFlag = 0;
      else if (voice_brain_enabled === 1 || voice_brain_enabled === true) brainFlag = 1;
      else return c.json({ error: 'invalid voice_brain_enabled' }, 400);
    }

    const db = new D1Db(c.env.DB);
    const user = c.get('user');
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
    if (sets.length === 0) return c.json({ success: true });
    sets.push('updated_at = CURRENT_TIMESTAMP');
    vals.push(user.userId);
    await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return c.json({ success: true });
  });

  app.route('/api/voice-persona', api);
}
