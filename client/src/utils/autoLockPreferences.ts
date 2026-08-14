// client/src/utils/autoLockPreferences.ts
// Auto-lock timer preference stored in minutes.
// Bridges to the existing seconds-based key (`rmpg_desktop_autolock_secs`)
// that `useIdleScreenSaver` already reads in DesktopPage.

const LOCK_SECS_KEY = 'rmpg_desktop_autolock_secs';

/**
 * Returns the configured auto-lock duration in minutes,
 * or null if set to "Never".
 */
export function getAutoLockMinutes(): number | null {
  try {
    const raw = localStorage.getItem(LOCK_SECS_KEY);
    if (raw === null) return null;
    const secs = parseInt(raw, 10);
    if (secs === 0) return null; // 0 = "Never" in FlexOSSettings
    return Math.round(secs / 60);
  } catch {
    return null;
  }
}

/**
 * Saves the auto-lock duration. Pass null to disable ("Never").
 * Writes the existing `rmpg_desktop_autolock_secs` key so the screensaver
 * hook in DesktopPage picks it up without any additional wiring.
 */
export function setAutoLockMinutes(minutes: number | null): void {
  try {
    if (minutes === null) {
      localStorage.setItem(LOCK_SECS_KEY, '0'); // 0 = Never
    } else {
      localStorage.setItem(LOCK_SECS_KEY, String(minutes * 60));
    }
  } catch { /* silent */ }
}
