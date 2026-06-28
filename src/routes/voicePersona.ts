// ============================================================
// Voice persona — per-user TTS voice preferences.
// Ported from legacy/server-vps/src/routes/voicePersona.ts (the Worker had
// only a stub returning {persona:null}). Reads/writes the voice_* columns on
// `users`; the client hook useVoicePersona.ts GETs/PUTs /api/voice-persona.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, queryFirst, execute } from '../utils/db';

const VALID_TERSENESS = new Set(['narrative', 'standard', 'terse']);

export interface VoicePrefs {
  voice_persona?: string;
  voice_rate?: number;
  voice_pitch?: number;
  voice_terseness?: string;
  voice_brain_enabled?: 0 | 1;
}

// Pure validator/normalizer — only returns the fields actually present, coerced
// to DB-safe values. Returns an error string on the first invalid field.
export function normalizeVoicePrefs(body: Record<string, unknown>): { error: string } | { values: VoicePrefs } {
  const out: VoicePrefs = {};
  const { voice_persona, voice_rate, voice_pitch, voice_terseness, voice_brain_enabled } = body ?? {};

  if (voice_persona != null) {
    if (typeof voice_persona !== 'string' || voice_persona.length > 100) return { error: 'invalid voice_persona' };
    out.voice_persona = voice_persona;
  }
  if (voice_terseness != null) {
    if (typeof voice_terseness !== 'string' || !VALID_TERSENESS.has(voice_terseness)) return { error: 'invalid voice_terseness' };
    out.voice_terseness = voice_terseness;
  }
  if (voice_rate != null) {
    if (typeof voice_rate !== 'number' || voice_rate < 0.7 || voice_rate > 1.4) return { error: 'voice_rate out of range' };
    out.voice_rate = voice_rate;
  }
  if (voice_pitch != null) {
    if (typeof voice_pitch !== 'number' || voice_pitch < -20 || voice_pitch > 20) return { error: 'voice_pitch out of range' };
    out.voice_pitch = voice_pitch;
  }
  if (voice_brain_enabled !== undefined) {
    if (voice_brain_enabled === 0 || voice_brain_enabled === false) out.voice_brain_enabled = 0;
    else if (voice_brain_enabled === 1 || voice_brain_enabled === true) out.voice_brain_enabled = 1;
    else return { error: 'invalid voice_brain_enabled' };
  }
  return { values: out };
}

const voicePersona = new Hono<Env>();

// GET / — current user's voice preferences.
voicePersona.get('/', async (c) => {
  try {
    const user = c.get('user') as { id: number } | undefined;
    if (!user?.id) return c.json({ error: 'Unauthenticated' }, 401);
    const db = getDb(c.env);
    const row = await queryFirst<Record<string, unknown>>(db,
      'SELECT voice_persona, voice_rate, voice_pitch, voice_terseness, voice_brain_enabled FROM users WHERE id = ?',
      user.id);
    return c.json(row ?? {});
  } catch (err) {
    console.error('GET /voice-persona failed:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// PUT / — update the provided voice preference fields.
voicePersona.put('/', async (c) => {
  try {
    const user = c.get('user') as { id: number } | undefined;
    if (!user?.id) return c.json({ error: 'Unauthenticated' }, 401);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const result = normalizeVoicePrefs(body);
    if ('error' in result) return c.json({ error: result.error }, 400);

    const entries = Object.entries(result.values);
    if (entries.length === 0) return c.json({ success: true });

    const sets = entries.map(([k]) => `${k} = ?`);
    const vals = entries.map(([, v]) => v);
    sets.push(`updated_at = datetime('now')`);
    vals.push(user.id);
    const db = getDb(c.env);
    await execute(db, `UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /voice-persona failed:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

export default voicePersona;
