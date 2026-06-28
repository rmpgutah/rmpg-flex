// ============================================================
// RMPG Flex — Dispatcher Voice Catalog
//
// Curated list of Microsoft Edge-TTS neural voices offered in the
// Settings UI. These IDs are what the server's /api/tts endpoint
// expects (see edgeTTS.ts -> getEdgeTTSPayload). The persona voice
// id is stored in localStorage under 'rmpg-voice-persona' and is
// read at speak-time, so changing it here is immediately effective.
//
// Keep this list curated, not exhaustive — these are the voices that
// sound clear over the simulated P25 radio chain. Voices that lose
// intelligibility after the 300–3400 Hz bandpass are excluded.
// ============================================================

export interface VoiceOption {
  /** Edge-TTS voice id, e.g. 'en-US-JennyNeural'. */
  id: string;
  /** Human-friendly display name. */
  label: string;
  /** 'female' | 'male' — drives the grouping in the picker. */
  gender: 'female' | 'male';
  /** Accent / locale tag for the secondary label. */
  accent: string;
  /** One-line character description shown under the name. */
  description: string;
}

export const VOICE_CATALOG: VoiceOption[] = [
  // ── US English — Female ──────────────────────────────────
  { id: 'en-US-JennyNeural',     label: 'Jenny',     gender: 'female', accent: 'US', description: 'Warm, clear — default dispatcher' },
  { id: 'en-US-AriaNeural',      label: 'Aria',      gender: 'female', accent: 'US', description: 'Crisp, professional newsroom tone' },
  { id: 'en-US-MichelleNeural',  label: 'Michelle',  gender: 'female', accent: 'US', description: 'Calm, measured, low urgency' },
  { id: 'en-US-SaraNeural',      label: 'Sara',      gender: 'female', accent: 'US', description: 'Bright, energetic, fast cadence' },
  { id: 'en-US-NancyNeural',     label: 'Nancy',     gender: 'female', accent: 'US', description: 'Mature, authoritative' },
  // ── US English — Male ────────────────────────────────────
  { id: 'en-US-GuyNeural',       label: 'Guy',       gender: 'male',   accent: 'US', description: 'Neutral, flat — classic CAD announcer' },
  { id: 'en-US-DavisNeural',     label: 'Davis',     gender: 'male',   accent: 'US', description: 'Deep, steady, reassuring' },
  { id: 'en-US-TonyNeural',      label: 'Tony',      gender: 'male',   accent: 'US', description: 'Sharp, clipped, tactical' },
  { id: 'en-US-JasonNeural',     label: 'Jason',     gender: 'male',   accent: 'US', description: 'Conversational, relaxed' },
  { id: 'en-US-EricNeural',      label: 'Eric',      gender: 'male',   accent: 'US', description: 'Authoritative, command presence' },
  // ── Other English accents ────────────────────────────────
  { id: 'en-GB-SoniaNeural',     label: 'Sonia',     gender: 'female', accent: 'UK', description: 'British, composed' },
  { id: 'en-GB-RyanNeural',      label: 'Ryan',      gender: 'male',   accent: 'UK', description: 'British, formal' },
  { id: 'en-AU-NatashaNeural',   label: 'Natasha',   gender: 'female', accent: 'AU', description: 'Australian, friendly' },
  { id: 'en-AU-WilliamNeural',   label: 'William',   gender: 'male',   accent: 'AU', description: 'Australian, even-keeled' },
];

/** Default persona voice id — must match useVoicePersona.ts DEFAULT. */
export const DEFAULT_VOICE_ID = 'en-US-JennyNeural';

/** Look up an option by id; falls back to the default voice. */
export function getVoiceOption(id: string | null | undefined): VoiceOption {
  return VOICE_CATALOG.find(v => v.id === id)
    ?? VOICE_CATALOG.find(v => v.id === DEFAULT_VOICE_ID)!;
}
