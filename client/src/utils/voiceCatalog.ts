// ============================================================
// RMPG Flex — Dispatcher Voice Catalog
//
// Deepgram Aura-2 speakers (@cf/deepgram/aura-2-en) offered in the UI.
// These ids are what the Worker's /api/tts endpoint expects;
// resolveAura2Voice() in src/utils/aiDispatcher.ts validates against
// AURA2_EN_VOICES and coerces anything unknown to the default.
//
// ⚠️ Every id here MUST be a member of AURA2_EN_VOICES. Until 2026-07-31
// this catalog listed Microsoft Edge-TTS ids ('en-US-JennyNeural', …) left
// over from the pre-Aura server. None were valid Aura-2 speakers, so EVERY
// selection silently coerced to the default and the picker did nothing —
// including offering male voices that played female.
// voiceCatalog.test.ts now enforces the invariant.
//
// ⚠️ THIS IS THE SINGLE SOURCE OF TRUTH for selectable voices. Before
// 2026-07-31 there were three, none of which agreed:
//   • this catalog (14 Edge-TTS ids)             → SettingsPage
//   • a local array in VoicePersonaSettings.tsx  (a different 4)
//   • a hardcoded DEFAULT in useVoicePersona.ts  (written back to D1)
// The latter two now consume this module. Do not reintroduce a local list.
//
// Gender labels come from MEASURED median F0 (autocorrelation over a
// synthesized reference line, 2026-07-31), not from the name: 'athena'
// measures 145 Hz — male register — despite the classical association.
// 'selene' exists in Deepgram's wider roster but NOT in AURA2_EN_VOICES,
// so the Worker would reject it — do not add it.
//
// The persona voice id is stored in localStorage under 'rmpg-voice-persona'
// and read at speak-time, so changing it here is immediately effective.
// ============================================================

export interface VoiceOption {
  /** Aura-2 speaker name, e.g. 'harmonia'. Must be in AURA2_EN_VOICES. */
  id: string;
  /** Human-friendly display name. */
  label: string;
  /** From measured median F0 — drives the grouping in the picker. */
  gender: 'female' | 'male';
  /** Accent / locale tag for the secondary label. */
  accent: string;
  /** One-line character description shown under the name. */
  description: string;
}

export const VOICE_CATALOG: VoiceOption[] = [
  // ── Female register (measured F0 ≥ 165 Hz) ───────────────
  { id: 'harmonia',  label: 'Harmonia',  gender: 'female', accent: 'US', description: 'Fast, clear — default dispatcher (178 Hz)' },
  { id: 'hera',      label: 'Hera',      gender: 'female', accent: 'US', description: 'Brightest register (235 Hz)' },
  { id: 'ophelia',   label: 'Ophelia',   gender: 'female', accent: 'US', description: 'Bright, articulate (222 Hz)' },
  { id: 'minerva',   label: 'Minerva',   gender: 'female', accent: 'US', description: 'Clear, strong radio survival (216 Hz)' },
  { id: 'asteria',   label: 'Asteria',   gender: 'female', accent: 'US', description: 'Calm, professional, unhurried (211 Hz)' },
  { id: 'aurora',    label: 'Aurora',    gender: 'female', accent: 'US', description: 'Warm, quick (211 Hz)' },
  { id: 'luna',      label: 'Luna',      gender: 'female', accent: 'US', description: 'Even, measured (211 Hz)' },
  { id: 'juno',      label: 'Juno',      gender: 'female', accent: 'US', description: 'Steady, neutral (205 Hz)' },
  { id: 'thalia',    label: 'Thalia',    gender: 'female', accent: 'US', description: 'Conversational, brisk (200 Hz)' },
  { id: 'iris',      label: 'Iris',      gender: 'female', accent: 'US', description: 'Light, precise (195 Hz)' },
  { id: 'andromeda', label: 'Andromeda', gender: 'female', accent: 'US', description: 'Flattest affect measured — most monotone (186 Hz)' },
  { id: 'cora',      label: 'Cora',      gender: 'female', accent: 'US', description: 'Low female register, even (174 Hz)' },
  // ── Male register (measured F0 ≤ 155 Hz) ─────────────────
  { id: 'athena',    label: 'Athena',    gender: 'male',   accent: 'US', description: 'Mid-low register (145 Hz)' },
  { id: 'orion',     label: 'Orion',     gender: 'male',   accent: 'US', description: 'Authoritative, command presence' },
  { id: 'atlas',     label: 'Atlas',     gender: 'male',   accent: 'US', description: 'Deep, steady' },
  { id: 'zeus',      label: 'Zeus',      gender: 'male',   accent: 'US', description: 'Deepest, most weight (105 Hz)' },
];

/**
 * Default persona voice id — the confirmed Dispatch voice.
 * Must stay in sync with DISPATCH_VOICE in src/utils/aiDispatcher.ts.
 */
export const DEFAULT_VOICE_ID = 'harmonia';

/** Look up an option by id; falls back to the default voice. */
export function getVoiceOption(id: string | null | undefined): VoiceOption {
  return VOICE_CATALOG.find(v => v.id === id)
    ?? VOICE_CATALOG.find(v => v.id === DEFAULT_VOICE_ID)!;
}
