export const FAVORITES_KEY = 'rmpg_nav_favorites';
export const RECENT_KEY = 'rmpg_nav_recent';

export function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

export function saveFavorites(favorites: Set<string>) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
  } catch { /* silent fallback */ }
}

export function loadRecent(): string[] {
  try {
    const raw = sessionStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function pushRecent(path: string) {
  try {
    const recent = loadRecent().filter(p => p !== path);
    recent.unshift(path);
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 10)));
  } catch { /* silent */ }
}
