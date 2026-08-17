// Preferences for the time-based dynamic wallpaper feature.
// Day wallpaper activates at 06:00 local time; night at 20:00.

const KEY_ENABLED = 'rmpg_dynamic_wallpaper_enabled';
const KEY_DAY = 'rmpg_dynamic_wallpaper_day';
const KEY_NIGHT = 'rmpg_dynamic_wallpaper_night';
const DAY_HOUR = 6;
const NIGHT_HOUR = 20;

export function isDynamicWallpaperEnabled(): boolean {
  try { return localStorage.getItem(KEY_ENABLED) === '1'; } catch { return false; }
}

export function setDynamicWallpaperEnabled(on: boolean): void {
  try { on ? localStorage.setItem(KEY_ENABLED, '1') : localStorage.removeItem(KEY_ENABLED); } catch { /* quota */ }
}

export function getDynamicWallpaperDayId(): string {
  try { return localStorage.getItem(KEY_DAY) ?? ''; } catch { return ''; }
}

export function setDynamicWallpaperDayId(id: string): void {
  try { localStorage.setItem(KEY_DAY, id); } catch { /* quota */ }
}

export function getDynamicWallpaperNightId(): string {
  try { return localStorage.getItem(KEY_NIGHT) ?? ''; } catch { return ''; }
}

export function setDynamicWallpaperNightId(id: string): void {
  try { localStorage.setItem(KEY_NIGHT, id); } catch { /* quota */ }
}

/** Returns 'day' or 'night' based on current local hour. */
export function getCurrentTimeSlot(): 'day' | 'night' {
  const h = new Date().getHours();
  return h >= DAY_HOUR && h < NIGHT_HOUR ? 'day' : 'night';
}
