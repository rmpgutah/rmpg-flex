// ============================================================
// RMPG Flex — Radio / AI-Dispatcher Settings (org-wide, live)
// ============================================================
// One source of truth for every tunable knob in the radio subsystem.
// Persisted in `system_config` (category 'radio_settings', the live
// config_key/config_value/category schema — see src/routes/audit.ts for the
// same read/write shape), and read by VoiceHubDO + aiDispatcher on EACH
// dispatch so an admin change in Admin → Radio takes effect immediately,
// with no redeploy.
//
// DEFAULTS mirror the values that were hardcoded before this layer existed,
// so an empty `radio_settings` category reproduces today's behavior exactly —
// the settings layer is a no-op until someone changes a value.
// ============================================================

import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { query, execute } from './db';

export type RespondMode = 'all' | 'addressed';
export type HazeIntensity = 'clean' | 'light' | 'standard' | 'heavy';

export interface RadioSettings {
  // ── AI Dispatcher ──
  /** Master kill switch for the AI radio dispatcher. */
  ai_dispatcher_enabled: boolean;
  /** 'all' = answer every transmission; 'addressed' = only when called. */
  ai_respond_mode: RespondMode;
  /** Deepgram Aura-2 speaker (asteria/orion/zeus/perseus/athena/luna/hera). */
  ai_voice: string;
  /** Call-sign the dispatcher transmits under. */
  ai_dispatch_callsign: string;
  /** Extra operator directives appended to the built-in DISPATCH_POLICY. */
  ai_persona: string;
  /** LLM sampling temperature for the reasoning pass (0–1). */
  ai_temperature: number;
  /** Hard cap on spoken reply length (characters). */
  ai_max_reply_chars: number;

  // ── Recording & Transcription ──
  /** Store R2 audio for incoming transmissions (false = log row only). */
  auto_record: boolean;
  /** Backfill a Whisper transcript when the client didn't send one. */
  auto_transcribe: boolean;
  /** Auto-purge transmissions/recordings older than N days (0 = keep forever). */
  recording_retention_days: number;

  // ── Channel defaults & operator UX (consumed by the client) ──
  /** Channel id flagged as the operator default (mirrors radio_channels.is_default). */
  default_channel_id: number | null;
  /** Tab the operator console opens on (live/channels/recordings/stats/...). */
  default_operator_tab: string;
  /** Org default for desktop notifications (seeds a new device). */
  notif_enabled_default: boolean;
  /** Org default notification sound key. */
  notif_sound_default: string;
  /** Org default quiet-hours window (HH:MM, '' = none). */
  quiet_start_default: string;
  quiet_end_default: string;

  // ── Radio audio / P25 effect (rendered client-side) ──
  /** Strength of the P25 "radio haze" effect on TTS + clip playback. */
  haze_intensity: HazeIntensity;
  /** Receiver-path pink-noise bed level, 0–1. */
  noise_bed_level: number;
  /** Run dispatcher/alert speech through the radio-haze chain. */
  tts_over_radio: boolean;
}

export const RADIO_SETTING_DEFAULTS: RadioSettings = {
  ai_dispatcher_enabled: true,
  ai_respond_mode: 'all',
  ai_voice: 'asteria',
  ai_dispatch_callsign: 'DISPATCH',
  ai_persona: '',
  ai_temperature: 0.3,
  ai_max_reply_chars: 400,

  auto_record: true,
  auto_transcribe: true,
  recording_retention_days: 0,

  default_channel_id: null,
  default_operator_tab: 'live',
  notif_enabled_default: true,
  notif_sound_default: 'chime',
  quiet_start_default: '',
  quiet_end_default: '',

  haze_intensity: 'standard',
  noise_bed_level: 0.15,
  tts_over_radio: true,
};

const CATEGORY = 'radio_settings';

// ── Canonical option lists (single source of truth) ──────────
// The worker owns these. They are (1) the validation allow-lists below and
// (2) returned verbatim by GET /api/radio/settings as `options`, so the admin
// UI renders its dropdowns from the SAME list instead of a hardcoded copy —
// add a voice/tab here and it shows up in the UI and validates, in one edit.
export interface SettingOption { id: string; label: string }

export const RADIO_SETTING_OPTIONS = {
  ai_voice: [
    { id: 'asteria', label: 'Asteria — Female, calm (default)' },
    { id: 'luna', label: 'Luna — Female, warm' },
    { id: 'stella', label: 'Stella — Female, bright' },
    { id: 'athena', label: 'Athena — Female, mature' },
    { id: 'hera', label: 'Hera — Female, business' },
    { id: 'orion', label: 'Orion — Male, approachable' },
    { id: 'arcas', label: 'Arcas — Male, natural' },
    { id: 'perseus', label: 'Perseus — Male, confident' },
    { id: 'angus', label: 'Angus — Male, Irish' },
    { id: 'orpheus', label: 'Orpheus — Male, professional' },
    { id: 'helios', label: 'Helios — Male, news' },
    { id: 'zeus', label: 'Zeus — Male, deep' },
  ],
  ai_respond_mode: [
    { id: 'all', label: 'all' },
    { id: 'addressed', label: 'addressed' },
  ],
  default_operator_tab: [
    { id: 'live', label: 'live' },
    { id: 'channels', label: 'channels' },
    { id: 'recordings', label: 'recordings' },
    { id: 'stats', label: 'stats' },
    { id: 'references', label: 'references' },
    { id: 'settings', label: 'settings' },
  ],
  notif_sound_default: [
    { id: 'chime', label: 'chime' },
    { id: 'beep', label: 'beep' },
    { id: 'ping', label: 'ping' },
    { id: 'alert', label: 'alert' },
    { id: 'soft', label: 'soft' },
  ],
  haze_intensity: [
    { id: 'clean', label: 'clean' },
    { id: 'light', label: 'light' },
    { id: 'standard', label: 'standard' },
    { id: 'heavy', label: 'heavy' },
  ],
} as const satisfies Record<string, readonly SettingOption[]>;

// Allowed enum values, DERIVED from the options above — anything else falls
// back to the default on read AND is rejected on write, so the UI and worker
// can never desync on a typo.
const idsOf = (opts: readonly SettingOption[]) => opts.map((o) => o.id);
const RESPOND_MODES = idsOf(RADIO_SETTING_OPTIONS.ai_respond_mode) as RespondMode[];
const HAZE_LEVELS = idsOf(RADIO_SETTING_OPTIONS.haze_intensity) as HazeIntensity[];
const AURA_VOICES = idsOf(RADIO_SETTING_OPTIONS.ai_voice);
const OPERATOR_TABS = idsOf(RADIO_SETTING_OPTIONS.default_operator_tab);
const NOTIF_SOUNDS = idsOf(RADIO_SETTING_OPTIONS.notif_sound_default);

const clampNum = (n: number, lo: number, hi: number, fallback: number) =>
  Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : fallback;

// Coerce one stored string value (config_value is TEXT) onto the typed shape.
function coerce(key: keyof RadioSettings, raw: string): unknown {
  const def = RADIO_SETTING_DEFAULTS[key];
  switch (key) {
    case 'ai_dispatcher_enabled':
    case 'auto_record':
    case 'auto_transcribe':
    case 'notif_enabled_default':
    case 'tts_over_radio':
      return raw === 'true' || raw === '1';
    case 'ai_respond_mode':
      return (RESPOND_MODES as string[]).includes(raw) ? raw : def;
    case 'haze_intensity':
      return (HAZE_LEVELS as string[]).includes(raw) ? raw : def;
    case 'ai_voice':
      return AURA_VOICES.includes(raw) ? raw : def;
    case 'default_operator_tab':
      return OPERATOR_TABS.includes(raw) ? raw : def;
    case 'notif_sound_default':
      return NOTIF_SOUNDS.includes(raw) ? raw : def;
    case 'ai_temperature':
      return clampNum(Number(raw), 0, 1, def as number);
    case 'ai_max_reply_chars':
      return clampNum(Math.round(Number(raw)), 40, 1200, def as number);
    case 'recording_retention_days':
      return clampNum(Math.round(Number(raw)), 0, 3650, def as number);
    case 'noise_bed_level':
      return clampNum(Number(raw), 0, 1, def as number);
    case 'default_channel_id': {
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    }
    // Free-text string settings.
    case 'ai_dispatch_callsign':
      return raw.trim() ? raw.trim().slice(0, 32) : def;
    case 'ai_persona':
      return raw.slice(0, 4000);
    default:
      return raw;
  }
}

/**
 * Load the full, typed radio settings — DB rows merged over the defaults.
 * Best-effort: a missing table / bad row degrades to defaults (the radio
 * relay must never break because a setting couldn't be read).
 */
export async function getRadioSettings(db: D1Database): Promise<RadioSettings> {
  const out: RadioSettings = { ...RADIO_SETTING_DEFAULTS };
  try {
    const rows = await query<{ config_key: string; config_value: string | null }>(
      db,
      `SELECT config_key, config_value FROM system_config WHERE category = ?`,
      CATEGORY,
    );
    for (const r of rows) {
      const key = r.config_key as keyof RadioSettings;
      if (!(key in RADIO_SETTING_DEFAULTS) || r.config_value == null) continue;
      (out as unknown as Record<string, unknown>)[key] = coerce(key, String(r.config_value));
    }
  } catch (err) {
    console.warn('[radioSettings] read failed — using defaults:', (err as Error)?.message);
  }
  return out;
}

/**
 * Persist a partial settings patch. Validates + coerces each key through the
 * same path as reads, then DELETE+INSERTs the row (system_config has no clean
 * upsert — mirrors src/routes/audit.ts). Unknown keys are ignored. Returns the
 * fully-merged settings after the write so the caller can echo them back.
 */
export async function setRadioSettings(db: D1Database, patch: Record<string, unknown>): Promise<RadioSettings> {
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in RADIO_SETTING_DEFAULTS)) continue;
    // Normalize the incoming value to its stored string form via coerce().
    const coerced = coerce(key as keyof RadioSettings, value == null ? '' : String(value));
    const stored = coerced == null ? '' : String(coerced);
    await execute(db, `DELETE FROM system_config WHERE config_key = ? AND category = ?`, key, CATEGORY);
    await execute(
      db,
      `INSERT INTO system_config (config_key, config_value, category, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
      key, stored, CATEGORY, now, now,
    );
  }
  return getRadioSettings(db);
}

/**
 * Enforce the recording-retention setting: delete radio transmissions (and
 * their R2 audio) older than `retentionDays`. 0/absent = keep forever (no-op).
 * Batched so one cron tick can't run away. Called from the scheduled() cron.
 * Best-effort: an R2 delete miss never blocks the row delete.
 */
export async function purgeOldRecordings(
  db: D1Database,
  uploads: R2Bucket,
  retentionDays: number,
  batch = 500,
): Promise<{ deleted: number }> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return { deleted: 0 };
  const rows = await query<{ id: number }>(
    db,
    `SELECT id FROM radio_transmissions
     WHERE transmitted_at IS NOT NULL
       AND datetime(transmitted_at) < datetime('now', ?)
     ORDER BY id ASC LIMIT ?`,
    `-${Math.round(retentionDays)} days`, batch,
  ).catch(() => []);
  if (!rows.length) return { deleted: 0 };

  // Drop the R2 audio first (id→key map), then the rows.
  await Promise.allSettled(rows.map((r) => uploads.delete(`radio-audio/${r.id}.webm`)));
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  await execute(db, `DELETE FROM radio_transmissions WHERE id IN (${placeholders})`, ...ids);
  return { deleted: ids.length };
}
