// ============================================================
// RMPG Flex — Push-To-Talk (PTT) Preferences
//
// Per-browser settings for the global radio PTT hotkey driven by
// <PttController> (mounted in Layout, so it works on every page).
//
//   rmpg-ptt-enabled  → '0' | '1'   (default on)
//   rmpg-ptt-key      → KeyboardEvent.code, e.g. 'Backquote', 'Space'
//   rmpg-ptt-channel  → radio channel id to transmit on (number)
//
// When no PTT channel is set we fall back to the radio console's
// pinned channel ('radio_pinned_channel') so the two stay in sync,
// and finally to null (the controller auto-picks the first active
// channel). Every transmission is recorded server-side by VoiceHubDO.
// ============================================================

import { emitSettingsChange } from './settingsBus';

export interface PttPreferences {
  enabled: boolean;
  /** KeyboardEvent.code to hold for talk. Default '`' (Backquote). */
  keyCode: string;
  /** Channel id to transmit on, or null = auto (first active). */
  channelId: number | null;
}

const LS = {
  enabled: 'rmpg-ptt-enabled',
  keyCode: 'rmpg-ptt-key',
  channelId: 'rmpg-ptt-channel',
};

const PINNED_CHANNEL_KEY = 'radio_pinned_channel';

export const DEFAULT_PTT_KEY = 'Backquote';

/** Fired on the window whenever prefs change, so a live controller can react. */
export const PTT_PREFS_EVENT = 'rmpg-ptt-prefs-changed';

export function getPttPrefs(): PttPreferences {
  let enabled = true;
  let keyCode = DEFAULT_PTT_KEY;
  let channelId: number | null = null;
  try {
    enabled = localStorage.getItem(LS.enabled) !== '0';
    keyCode = localStorage.getItem(LS.keyCode) || DEFAULT_PTT_KEY;
    const raw = localStorage.getItem(LS.channelId) ?? localStorage.getItem(PINNED_CHANNEL_KEY);
    const n = raw == null ? NaN : parseInt(raw, 10);
    channelId = Number.isFinite(n) ? n : null;
  } catch { /* localStorage unavailable */ }
  return { enabled, keyCode, channelId };
}

export function setPttPrefs(patch: Partial<PttPreferences>): void {
  try {
    if (patch.enabled !== undefined) localStorage.setItem(LS.enabled, patch.enabled ? '1' : '0');
    if (patch.keyCode !== undefined) localStorage.setItem(LS.keyCode, patch.keyCode);
    if (patch.channelId !== undefined) {
      if (patch.channelId == null) localStorage.removeItem(LS.channelId);
      else localStorage.setItem(LS.channelId, String(patch.channelId));
    }
  } catch { /* quota / unavailable */ }
  // Notify any live controller in this tab (storage event only fires cross-tab).
  try { window.dispatchEvent(new Event(PTT_PREFS_EVENT)); } catch { /* SSR */ }
  emitSettingsChange('ptt');
}

/** Human-readable label for a KeyboardEvent.code (for the Settings UI). */
export function keyCodeLabel(code: string): string {
  if (!code) return 'Unset';
  if (code === 'Backquote') return '` (Backtick)';
  if (code === 'Space') return 'Space';
  if (code.startsWith('Key')) return code.slice(3);        // KeyV → V
  if (code.startsWith('Digit')) return code.slice(5);      // Digit1 → 1
  if (code.startsWith('Arrow')) return code.slice(5) + ' Arrow';
  if (code === 'ControlRight') return 'Right Ctrl';
  if (code === 'ControlLeft') return 'Left Ctrl';
  if (code === 'ShiftRight') return 'Right Shift';
  if (code === 'ShiftLeft') return 'Left Shift';
  return code;
}
