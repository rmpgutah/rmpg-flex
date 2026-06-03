// ============================================================
// RMPG Flex — Audio Mode (DI-5)
// Client-side helpers for the per-unit silent-dispatch preference.
// Source of truth lives on the server (units.audio_mode); a
// localStorage mirror gives the voice-alert hook a zero-fetch
// gate so it never speaks while waiting on an HTTP round-trip.
// ============================================================
import { apiFetch } from '../hooks/useApi';

export type AudioMode = 'audible' | 'silent' | 'vibrate';
const LS_KEY = 'rmpg_unit_audio_mode';

export function getLocalAudioMode(): AudioMode {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === 'silent' || v === 'vibrate' || v === 'audible') return v;
  } catch { /* SSR or denied */ }
  return 'audible';
}

export function setLocalAudioMode(mode: AudioMode): void {
  try { localStorage.setItem(LS_KEY, mode); } catch { /* ignore */ }
  // Notify same-tab listeners (storage event only fires cross-tab)
  try {
    window.dispatchEvent(new CustomEvent('rmpg:audio-mode-changed', { detail: mode }));
  } catch { /* SSR */ }
}

/** Pull current user's unit audio mode from server, prime localStorage. */
export async function syncAudioModeFromServer(): Promise<AudioMode> {
  try {
    const r = await apiFetch<{ unit_id: number | null; audio_mode: AudioMode }>('/api/dispatch/units/mine/audio-mode');
    const mode: AudioMode = (r?.audio_mode === 'silent' || r?.audio_mode === 'vibrate') ? r.audio_mode : 'audible';
    setLocalAudioMode(mode);
    return mode;
  } catch {
    return getLocalAudioMode();
  }
}

/** PUT new mode to server AND mirror to localStorage. */
export async function persistAudioMode(unitId: string | number, mode: AudioMode): Promise<void> {
  await apiFetch(`/api/dispatch/units/${unitId}/audio-mode`, {
    method: 'PUT',
    body: JSON.stringify({ audio_mode: mode }),
  });
  setLocalAudioMode(mode);
}

/**
 * Fire-and-forget Web Vibration API tap. No-ops on browsers without support
 * (desktops). Called by the voice hook when mode is 'vibrate'.
 */
export function vibrateForSeverity(severity: 'minor' | 'moderate' | 'major'): void {
  try {
    const nav = navigator as unknown as { vibrate?: (p: number | number[]) => boolean };
    if (typeof nav.vibrate !== 'function') return;
    if (severity === 'major') nav.vibrate([200, 80, 200, 80, 400]);
    else if (severity === 'moderate') nav.vibrate([150, 80, 150]);
    else nav.vibrate(120);
  } catch { /* ignore */ }
}
