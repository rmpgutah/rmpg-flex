import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './useApi';
import { emitSettingsChange } from '../utils/settingsBus';
import { DEFAULT_VOICE_ID } from '../utils/voiceCatalog';

export interface VoicePersona {
  voiceId: string;
  rate: number;
  pitch: number;
  terseness: 'narrative' | 'standard' | 'terse';
  /** Dispatcher Brain master switch (Phase 2+). Default false. */
  brainEnabled: boolean;
}

const LS = {
  voiceId:      'rmpg-voice-persona',
  rate:         'rmpg-voice-rate',
  pitch:        'rmpg-voice-pitch',
  terseness:    'rmpg-voice-terseness',
  brainEnabled: 'rmpg-voice-brain-enabled',
};

const DEFAULT: VoicePersona = {
  // Sourced from voiceCatalog so there is ONE default, not three. This was
  // hardcoded to 'en-US-JennyNeural' — an Edge-TTS id the Aura-2 server
  // rejects — and this hook writes voiceId back to localStorage AND to
  // /api/voice-persona, so it kept re-seeding an invalid id even after the
  // catalog was corrected.
  voiceId: DEFAULT_VOICE_ID,
  rate: 1.0,
  pitch: 0,
  terseness: 'standard',
  brainEnabled: false,
};

const VALID_TERSENESS = new Set<string>(['narrative', 'standard', 'terse']);

function safeNumber(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readLocal(): VoicePersona {
  const t = localStorage.getItem(LS.terseness);
  const terseness = (t && VALID_TERSENESS.has(t))
    ? (t as VoicePersona['terseness'])
    : DEFAULT.terseness;

  return {
    voiceId:      localStorage.getItem(LS.voiceId) ?? DEFAULT.voiceId,
    rate:         safeNumber(localStorage.getItem(LS.rate),  DEFAULT.rate),
    pitch:        safeNumber(localStorage.getItem(LS.pitch), DEFAULT.pitch),
    terseness,
    brainEnabled: localStorage.getItem(LS.brainEnabled) === '1',
  };
}

function writeLocal(p: Partial<VoicePersona>): void {
  if (p.voiceId      !== undefined) localStorage.setItem(LS.voiceId, p.voiceId);
  if (p.rate         !== undefined) localStorage.setItem(LS.rate, String(p.rate));
  if (p.pitch        !== undefined) localStorage.setItem(LS.pitch, String(p.pitch));
  if (p.terseness    !== undefined) localStorage.setItem(LS.terseness, p.terseness);
  if (p.brainEnabled !== undefined) localStorage.setItem(LS.brainEnabled, p.brainEnabled ? '1' : '0');
}

interface VoicePersonaRow {
  voice_persona?: string;
  voice_rate?: number;
  voice_pitch?: number;
  voice_terseness?: string;
  voice_brain_enabled?: 0 | 1;
}

export function useVoicePersona() {
  const [persona, setPersonaState] = useState<VoicePersona>(readLocal);
  const userEditedRef = useRef(false);

  // Server -> local sync on mount. Ignored if the component has unmounted
  // or the user has already called setPersona() (user edits win).
  useEffect(() => {
    let cancelled = false;
    apiFetch<VoicePersonaRow>('/api/voice-persona')
      .then((row) => {
        if (cancelled || userEditedRef.current || !row) return;
        // Runtime guard: only apply fields that are actually present and typed
        // correctly. If the server renames or restructures fields, fall back to
        // defaults rather than silently applying undefined values.
        const voiceId = typeof row.voice_persona === 'string' && row.voice_persona
          ? row.voice_persona : DEFAULT.voiceId;
        const rate = typeof row.voice_rate === 'number' && Number.isFinite(row.voice_rate)
          ? row.voice_rate : DEFAULT.rate;
        const pitch = typeof row.voice_pitch === 'number' && Number.isFinite(row.voice_pitch)
          ? row.voice_pitch : DEFAULT.pitch;
        const terseness = typeof row.voice_terseness === 'string' && VALID_TERSENESS.has(row.voice_terseness)
          ? (row.voice_terseness as VoicePersona['terseness']) : DEFAULT.terseness;
        const next: VoicePersona = {
          voiceId,
          rate,
          pitch,
          terseness,
          brainEnabled: row.voice_brain_enabled === 1,
        };
        writeLocal(next);
        setPersonaState(next);
      })
      .catch(() => {
        // Offline or transient error — keep localStorage values.
      });
    return () => { cancelled = true; };
  }, []);

  const setPersona = useCallback((patch: Partial<VoicePersona>) => {
    userEditedRef.current = true;
    const next = { ...readLocal(), ...patch };
    writeLocal(patch);
    setPersonaState(next);
    emitSettingsChange('voice');

    const serverPatch: Record<string, unknown> = {};
    if (patch.voiceId      !== undefined) serverPatch.voice_persona       = patch.voiceId;
    if (patch.rate         !== undefined) serverPatch.voice_rate          = patch.rate;
    if (patch.pitch        !== undefined) serverPatch.voice_pitch         = patch.pitch;
    if (patch.terseness    !== undefined) serverPatch.voice_terseness     = patch.terseness;
    if (patch.brainEnabled !== undefined) serverPatch.voice_brain_enabled = patch.brainEnabled ? 1 : 0;

    apiFetch('/api/voice-persona', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serverPatch),
    }).catch(() => { /* best-effort sync */ });
  }, []);

  return { persona, setPersona };
}
