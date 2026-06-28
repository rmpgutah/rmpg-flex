// ============================================================
// RMPG Flex — Settings Sync (cross-device + org defaults)
//
// Persists the user's preference blob to the server so it follows them
// across devices/logins, and pulls org-wide defaults an admin has
// published. Precedence: org defaults < user blob < local edits.
//
//   GET  /api/settings        → { org, user }
//   PUT  /api/settings/user   → this user's blob
//   PUT  /api/settings/org    → org defaults (admin)
//
// Works alongside settingsBus: a pull live-applies via the bus; a local
// change debounce-pushes to the server. The applyingRemote guard stops
// pull→apply→push from looping.
// ============================================================

import { apiFetch } from '../hooks/useApi';
import { emitSettingsChange, subscribeSettings } from './settingsBus';

// Every localStorage key that represents a synced preference.
const SETTINGS_KEYS: string[] = [
  // voice
  'rmpg-voice-persona', 'rmpg-voice-rate', 'rmpg-voice-pitch', 'rmpg-voice-terseness',
  'rmpg-voice-brain-enabled', 'rmpg-voice-engine', 'rmpg-voice-spillman',
  'rmpg-voice-alerts', 'rmpg-alert-min-tier', 'rmpg-sound',
  'rmpg-voice-ev-new-call', 'rmpg-voice-ev-panic', 'rmpg-voice-ev-bolo', 'rmpg-voice-ev-status',
  // tones
  'rmpg-tone-map',
  // map
  'rmpg_map_style', 'rmpg_map_layers', 'rmpg_map_prefs',
  // ptt
  'rmpg-ptt-enabled', 'rmpg-ptt-key', 'rmpg-ptt-channel',
];

type Blob = Record<string, string>;

let applyingRemote = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/** Snapshot the synced keys currently in localStorage. */
export function collectLocalSettings(): Blob {
  const blob: Blob = {};
  for (const k of SETTINGS_KEYS) {
    try {
      const v = localStorage.getItem(k);
      if (v != null) blob[k] = v;
    } catch { /* unavailable */ }
  }
  return blob;
}

/** Write a blob into localStorage (raw — does NOT emit), for known keys only. */
function writeBlob(blob: Blob): void {
  for (const k of SETTINGS_KEYS) {
    const v = blob[k];
    if (typeof v === 'string') {
      try { localStorage.setItem(k, v); } catch { /* quota */ }
    }
  }
}

/** Apply a remote blob and live-apply it, without triggering a push. */
function applyRemote(blob: Blob): void {
  if (Object.keys(blob).length === 0) return;
  applyingRemote = true;
  writeBlob(blob);
  emitSettingsChange('all');                 // live-apply across the app
  setTimeout(() => { applyingRemote = false; }, 0); // release after this tick
}

/** Pull org + user blobs and apply (org defaults < user). */
export async function pullSettings(): Promise<void> {
  try {
    const res = await apiFetch<{ org?: Blob; user?: Blob }>('/settings');
    const merged: Blob = { ...(res?.org ?? {}), ...(res?.user ?? {}) };
    applyRemote(merged);
  } catch { /* offline / endpoint absent — keep local prefs */ }
}

/** Push the current local blob to the user's server record (debounced). */
function schedulePush(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    apiFetch('/settings/user', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectLocalSettings()),
    }).catch(() => { /* best-effort */ });
  }, 800);
}

/**
 * Start syncing: pull once, then push (debounced) on every local change.
 * Idempotent — safe to call on every Layout mount.
 */
export function initSettingsSync(): () => void {
  if (started) return () => {};
  started = true;

  void pullSettings();

  const unsub = subscribeSettings(() => {
    if (applyingRemote) return; // server-origin change — don't echo it back
    schedulePush();
  });

  return () => {
    started = false;
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    unsub();
  };
}

/** Admin: publish the current local settings as the org-wide default. */
export async function saveAsOrgDefault(): Promise<boolean> {
  try {
    await apiFetch('/settings/org', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectLocalSettings()),
    });
    return true;
  } catch {
    return false;
  }
}
