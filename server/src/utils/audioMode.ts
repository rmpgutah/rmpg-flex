/**
 * Silent dispatch — per-unit audio mode helper.
 *
 * Each unit has an `audio_mode` column with one of:
 *   normal   — TTS announcements + alert tones
 *   silent   — no audio (no TTS, no tones); WebSocket + text only
 *   vibrate  — short alert tone only, no full TTS
 *
 * Per-unit (not per-user) intentionally: matches Spillman model where
 * the *vehicle's* preference carries across shift changes.
 */
import type Database from 'better-sqlite3';

export type AudioMode = 'normal' | 'silent' | 'vibrate';
const VALID: AudioMode[] = ['normal', 'silent', 'vibrate'];

export function isAudioMode(value: unknown): value is AudioMode {
  return typeof value === 'string' && VALID.includes(value as AudioMode);
}

export function getUnitAudioMode(db: Database.Database, unitId: number): AudioMode {
  try {
    const row = db.prepare('SELECT audio_mode FROM units WHERE id = ?').get(unitId) as { audio_mode: string | null } | undefined;
    return isAudioMode(row?.audio_mode) ? (row!.audio_mode as AudioMode) : 'normal';
  } catch {
    return 'normal';
  }
}

export function getUnitAudioModeByOfficer(db: Database.Database, officerId: number): AudioMode {
  try {
    const row = db.prepare('SELECT audio_mode FROM units WHERE officer_id = ? AND status != ?').get(officerId, 'off_duty') as { audio_mode: string | null } | undefined;
    return isAudioMode(row?.audio_mode) ? (row!.audio_mode as AudioMode) : 'normal';
  } catch {
    return 'normal';
  }
}

/**
 * Set a unit's audio mode. Throws if mode is invalid. Returns true on success.
 */
export function setUnitAudioMode(db: Database.Database, unitId: number, mode: AudioMode): boolean {
  if (!isAudioMode(mode)) throw new Error(`Invalid audio mode: ${mode}`);
  const r = db.prepare('UPDATE units SET audio_mode = ? WHERE id = ?').run(mode, unitId);
  return r.changes > 0;
}

/**
 * Should the dispatch voice line up an announcement for this officer's unit?
 * Returns false when the unit is in 'silent' mode (no TTS at all).
 * For 'vibrate' the caller can opt into a short cue instead of a full sentence.
 */
export function shouldAnnounceVoiceFor(db: Database.Database, officerId: number): boolean {
  return getUnitAudioModeByOfficer(db, officerId) !== 'silent';
}
