// ============================================================
// RMPG Flex — Per-Alert-Type Sound Preferences
// ============================================================
// Layer over the existing global `rmpg-sound` mute toggle that
// lets dispatchers individually silence specific alert categories
// without losing the others. Stored as a JSON object in
// localStorage under `rmpg-alert-sound-prefs`.
//
//   {
//     "gps_gap_warning": true,    // play (default)
//     "gps_gap_critical": true,
//     "gps_recovered": true,
//     "pursuit_speed": true,
//     "speed_alert": true,
//     "beat_breach": false,       // muted — too noisy for this dispatcher
//     "panic": true,              // never recommend muting; UI should warn
//   }
//
// Behavior:
//   • Global mute (`rmpg-sound = 'false'`) wins over per-type prefs.
//   • Missing entries default to `true` (sound enabled) — adding a
//     new alert category doesn't require a migration.
//   • `panic` is intentionally honored if explicitly muted — but the
//     settings UI should display a confirmation prompt because muting
//     panic is generally an officer-safety risk.
// ============================================================

const STORAGE_KEY = 'rmpg-alert-sound-prefs';

export type AlertCategory =
  | 'gps_gap_warning'
  | 'gps_gap_critical'
  | 'gps_recovered'
  | 'pursuit_speed'
  | 'speed_alert'
  | 'beat_breach'
  | 'panic'
  | 'p1_call'
  | 'p2_call'
  // Spillman-style status / system tones
  | 'status_chirp'        // enroute / on-scene / cleared confirmations
  | 'all_call'            // broadcast attention tone
  | 'priority_preempt'    // higher-priority call interrupting current
  | 'unit_to_unit'        // direct unit-to-unit messages
  | 'login_logoff'        // session start/end chirps
  | 'roger_beep'          // courtesy tone at end of TTS
  | 'bonk';               // command-rejected error tone

interface AlertSoundPrefs {
  [category: string]: boolean;
}

function readPrefs(): AlertSoundPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as AlertSoundPrefs;
  } catch { /* corrupt prefs — treat as empty */ }
  return {};
}

function writePrefs(prefs: AlertSoundPrefs): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); }
  catch { /* quota or private mode — silently ignore */ }
}

/**
 * Should sound play for this alert category?
 * Honors global mute first, then per-category override.
 */
export function isAlertSoundEnabled(category: AlertCategory): boolean {
  // Global mute trumps all per-category settings.
  if (localStorage.getItem('rmpg-sound') === 'false') return false;
  const prefs = readPrefs();
  // Default-on: if the category has never been toggled, sound plays.
  return prefs[category] !== false;
}

export function setAlertSoundEnabled(category: AlertCategory, enabled: boolean): void {
  const prefs = readPrefs();
  prefs[category] = enabled;
  writePrefs(prefs);
  // Notify listeners (settings panel, status bar) via a custom event.
  try { window.dispatchEvent(new CustomEvent('alert-sound-prefs-changed', { detail: { category, enabled } })); }
  catch { /* CustomEvent not supported (very old browsers) — ignore */ }
}

export function getAllAlertPrefs(): Record<AlertCategory, boolean> {
  const prefs = readPrefs();
  const all: Record<AlertCategory, boolean> = {
    gps_gap_warning: true,
    gps_gap_critical: true,
    gps_recovered: true,
    pursuit_speed: true,
    speed_alert: true,
    beat_breach: true,
    panic: true,
    p1_call: true,
    p2_call: true,
    status_chirp: true,
    all_call: true,
    priority_preempt: true,
    unit_to_unit: true,
    login_logoff: true,
    roger_beep: true,
    bonk: true,
  };
  for (const k of Object.keys(all) as AlertCategory[]) {
    if (prefs[k] === false) all[k] = false;
  }
  return all;
}

/**
 * Subscribe to changes. Returns an unsubscribe function.
 * Useful for the settings panel to live-update its toggles when
 * prefs change in another tab.
 */
export function subscribeAlertPrefs(handler: (cat: AlertCategory, enabled: boolean) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.category) handler(detail.category, detail.enabled);
  };
  window.addEventListener('alert-sound-prefs-changed', listener);
  // Cross-tab sync via 'storage' event.
  const storageListener = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    // Replay the entire prefs map — caller can re-read getAllAlertPrefs.
    handler('panic' /* sentinel */, true);
  };
  window.addEventListener('storage', storageListener);
  return () => {
    window.removeEventListener('alert-sound-prefs-changed', listener);
    window.removeEventListener('storage', storageListener);
  };
}
