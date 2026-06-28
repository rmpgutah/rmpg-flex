/**
 * Notification sound alerts — voiced from the Spillman Flex / Motorola
 * console library in dispatchTones.ts (sampled WAV assets with synth
 * fallback) so notifications speak the same CAD vocabulary as dispatch:
 *   critical → three-cycle emergency warble
 *   high     → P25 three-pip attention getter
 *   normal   → MDT acknowledge pip
 * Keeps its own enable toggle (rmpg_notification_sounds), independent
 * of the dispatch master toggle the library checks internally.
 *
 * v1056: Per-user storage scoping — the legacy key was shared across
 * every operator that logged into a given MDT (shared-device leak). The
 * new key `rmpg_notification_sounds_<user-id>` is consulted first, and
 * the legacy key is the fallback so existing operators don't have their
 * "off" pref silently flipped back to "on". The per-user key is owned
 * by the user-profile modal's sound switch.
 */
import { playSound } from './dispatchTones';

const LEGACY_KEY = 'rmpg_notification_sounds';

function readCurrentUserId(): string | null {
  try {
    // AuthContext mirrors `user` to localStorage as `rmpg_cached_user`
    // on login (see client/src/context/AuthContext.tsx CACHED_USER_KEY).
    const raw = localStorage.getItem('rmpg_cached_user');
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u?.id != null ? String(u.id) : null;
  } catch {
    return null;
  }
}

function keyForUser(): string {
  const id = readCurrentUserId();
  return id ? `${LEGACY_KEY}_${id}` : LEGACY_KEY;
}

export function isNotificationSoundEnabled(): boolean {
  // Per-user override wins. Falls back to the legacy global key so an
  // operator's existing "off" pref isn't forgotten on first login after
  // the per-user rollout.
  const scopedKey = keyForUser();
  const scoped = localStorage.getItem(scopedKey);
  if (scoped !== null) return scoped !== 'false';
  return localStorage.getItem(LEGACY_KEY) !== 'false';
}

export function setNotificationSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(keyForUser(), String(enabled));
  } catch {
    // localStorage quota / private-mode — silent.
  }
}

export function playNotificationTone(priority?: string): void {
  if (!isNotificationSoundEnabled()) return;
  try {
    if (priority === 'critical') playSound('emergency_three');
    else if (priority === 'high') playSound('alert');
    else playSound('info');
  } catch { /* audio is a nicety */ }
}
