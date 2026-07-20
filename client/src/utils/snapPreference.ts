// client/src/utils/snapPreference.ts
const STORAGE_KEY = 'rmpg_desktop_snap_enabled';

export function isSnapEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function setSnapEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch { /* silent — sessionless devices just always see the default */ }
}
