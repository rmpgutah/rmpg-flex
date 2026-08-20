export interface StartupWindow {
  path: string;
  title: string;
  width: number;
  height: number;
  enabled: boolean;
}

const STORAGE_KEY = 'rmpg_startup_windows';

const DEFAULT_STARTUP: StartupWindow[] = [
  { path: '/dispatch', title: 'Dispatch Console', width: 1200, height: 900, enabled: true },
];

export function getStartupWindows(): StartupWindow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STARTUP;
    const parsed = JSON.parse(raw) as StartupWindow[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_STARTUP;
  } catch {
    return DEFAULT_STARTUP;
  }
}

export function setStartupWindows(windows: StartupWindow[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(windows));
  } catch { /* silent fallback */ }
}
