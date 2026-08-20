const PINNED_APPS_KEY = 'rmpg_desktop_pinned_apps';
const POSITION_KEY = 'rmpg_desktop_taskbar_position';
const SIZE_KEY = 'rmpg_desktop_taskbar_size';
const AUTOHIDE_KEY = 'rmpg_desktop_taskbar_autohide';

export function getPinnedApps(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_APPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function savePinnedApps(paths: string[]): void {
  try {
    localStorage.setItem(PINNED_APPS_KEY, JSON.stringify(paths));
  } catch { /* silent — sessionless devices just always see the default */ }
}

export function pinApp(path: string): void {
  const current = getPinnedApps();
  if (current.includes(path)) return;
  savePinnedApps([...current, path]);
}

export function unpinApp(path: string): void {
  savePinnedApps(getPinnedApps().filter(p => p !== path));
}

export function isAppPinned(path: string): boolean {
  return getPinnedApps().includes(path);
}

export type TaskbarPosition = 'bottom' | 'top';

export function getTaskbarPosition(): TaskbarPosition {
  try {
    return localStorage.getItem(POSITION_KEY) === 'top' ? 'top' : 'bottom';
  } catch {
    return 'bottom';
  }
}

export function setTaskbarPosition(position: TaskbarPosition): void {
  try {
    localStorage.setItem(POSITION_KEY, position);
  } catch { /* silent */ }
}

export type TaskbarSize = 'small' | 'large';

export function getTaskbarSize(): TaskbarSize {
  try {
    return localStorage.getItem(SIZE_KEY) === 'large' ? 'large' : 'small';
  } catch {
    return 'small';
  }
}

export function setTaskbarSize(size: TaskbarSize): void {
  try {
    localStorage.setItem(SIZE_KEY, size);
  } catch { /* silent */ }
}

export function isTaskbarAutoHideEnabled(): boolean {
  try {
    return localStorage.getItem(AUTOHIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setTaskbarAutoHide(enabled: boolean): void {
  try {
    localStorage.setItem(AUTOHIDE_KEY, enabled ? '1' : '0');
  } catch { /* silent */ }
}
