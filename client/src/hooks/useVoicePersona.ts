import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './useApi';

export interface VoicePersona {
  voiceId: string;
  rate: number;
  pitch: number;
  terseness: 'narrative' | 'standard' | 'terse';
}

const LS = {
  voiceId:   'rmpg-voice-persona',
  rate:      'rmpg-voice-rate',
  pitch:     'rmpg-voice-pitch',
  terseness: 'rmpg-voice-terseness',
};

const DEFAULT: VoicePersona = {
  voiceId: 'en-US-JennyNeural',
  rate: 1.0,
  pitch: 0,
  terseness: 'standard',
};

function readLocal(): VoicePersona {
  return {
    voiceId:   localStorage.getItem(LS.voiceId)   ?? DEFAULT.voiceId,
    rate:      Number(localStorage.getItem(LS.rate)  ?? DEFAULT.rate),
    pitch:     Number(localStorage.getItem(LS.pitch) ?? DEFAULT.pitch),
    terseness: (localStorage.getItem(LS.terseness) as VoicePersona['terseness']) ?? DEFAULT.terseness,
  };
}

function writeLocal(p: Partial<VoicePersona>): void {
  if (p.voiceId   !== undefined) localStorage.setItem(LS.voiceId, p.voiceId);
  if (p.rate      !== undefined) localStorage.setItem(LS.rate, String(p.rate));
  if (p.pitch     !== undefined) localStorage.setItem(LS.pitch, String(p.pitch));
  if (p.terseness !== undefined) localStorage.setItem(LS.terseness, p.terseness);
}

export function useVoicePersona() {
  const [persona, setPersonaState] = useState<VoicePersona>(readLocal);

  // Server -> local sync on mount
  useEffect(() => {
    apiFetch<any>('/api/voice-persona')
      .then((row) => {
        if (!row) return;
        const next: VoicePersona = {
          voiceId:   row.voice_persona ?? DEFAULT.voiceId,
          rate:      row.voice_rate    ?? DEFAULT.rate,
          pitch:     row.voice_pitch   ?? DEFAULT.pitch,
          terseness: row.voice_terseness ?? DEFAULT.terseness,
        };
        writeLocal(next);
        setPersonaState(next);
      })
      .catch(() => {
        // Offline or transient error — keep localStorage values.
      });
  }, []);

  const setPersona = useCallback((patch: Partial<VoicePersona>) => {
    const next = { ...readLocal(), ...patch };
    writeLocal(patch);
    setPersonaState(next);

    const serverPatch: Record<string, unknown> = {};
    if (patch.voiceId   !== undefined) serverPatch.voice_persona   = patch.voiceId;
    if (patch.rate      !== undefined) serverPatch.voice_rate      = patch.rate;
    if (patch.pitch     !== undefined) serverPatch.voice_pitch     = patch.pitch;
    if (patch.terseness !== undefined) serverPatch.voice_terseness = patch.terseness;

    apiFetch('/api/voice-persona', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serverPatch),
    }).catch(() => { /* best-effort sync */ });
  }, []);

  return { persona, setPersona };
}
