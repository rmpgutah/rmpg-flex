// Session-scoped (not synced to the server, unlike desktop_layout_json) —
// see docs/superpowers/specs/2026-07-20-desktop-window-management-polish-design.md
// Section G for why: remembering "where I last put the Records window" is a
// convenience for the current browser tab, not account state worth a
// cross-device round trip.
const STORAGE_KEY = 'rmpg_desktop_window_positions';

export interface SavedWindowPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadAll(): Record<string, SavedWindowPosition> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getSavedPosition(path: string): SavedWindowPosition | null {
  return loadAll()[path] ?? null;
}

export function saveWindowPosition(path: string, position: SavedWindowPosition): void {
  try {
    const all = loadAll();
    all[path] = position;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* silent — position just won't be remembered this session */ }
}
