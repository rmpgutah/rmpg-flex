// ============================================================
// RMPG Flex — Navigation Recents & Favorites Store
// localStorage-backed destination memory for the nav surfaces.
//   'rmpg-nav-recents'   — capped FIFO (newest first), max 12
//   'rmpg-nav-favorites' — unbounded starred destinations
// Dedup is by coordinates rounded to ~11 m (5 decimal places).
// All localStorage access is guarded; the module degrades to an
// in-process no-op if storage is unavailable. Pure / no React.
// ============================================================

export interface NavDestination {
  label: string;
  lat: number;
  lng: number;
  /** epoch ms when added; set automatically. */
  ts?: number;
}

const RECENTS_KEY = 'rmpg-nav-recents';
const FAVORITES_KEY = 'rmpg-nav-favorites';
const RECENTS_CAP = 12;
const COORD_PRECISION = 5; // decimal places ≈ 1.1 m

/** Rounded coordinate signature for dedup. */
function coordKey(lat: number, lng: number): string {
  const r = (n: number) => Number(n).toFixed(COORD_PRECISION);
  return `${r(lat)},${r(lng)}`;
}

function read(key: string): NavDestination[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is NavDestination =>
        d &&
        typeof d.lat === 'number' &&
        typeof d.lng === 'number' &&
        typeof d.label === 'string',
    );
  } catch {
    return [];
  }
}

function write(key: string, list: NavDestination[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* quota / unavailable — best effort */
  }
}

/** Add (or bump to front) a recent destination, capped at 12, deduped by coords. */
export function addRecent(dest: { label: string; lat: number; lng: number }): NavDestination[] {
  if (!Number.isFinite(dest.lat) || !Number.isFinite(dest.lng)) return getRecents();
  const key = coordKey(dest.lat, dest.lng);
  const entry: NavDestination = { ...dest, ts: Date.now() };
  const existing = read(RECENTS_KEY).filter(d => coordKey(d.lat, d.lng) !== key);
  const next = [entry, ...existing].slice(0, RECENTS_CAP);
  write(RECENTS_KEY, next);
  return next;
}

export function getRecents(): NavDestination[] {
  return read(RECENTS_KEY);
}

export function getFavorites(): NavDestination[] {
  return read(FAVORITES_KEY);
}

export function isFavorite(lat: number, lng: number): boolean {
  const key = coordKey(lat, lng);
  return read(FAVORITES_KEY).some(d => coordKey(d.lat, d.lng) === key);
}

/** Toggle a destination's favorite state. Returns the new favorites list. */
export function toggleFavorite(dest: { label: string; lat: number; lng: number }): NavDestination[] {
  if (!Number.isFinite(dest.lat) || !Number.isFinite(dest.lng)) return getFavorites();
  const key = coordKey(dest.lat, dest.lng);
  const list = read(FAVORITES_KEY);
  const without = list.filter(d => coordKey(d.lat, d.lng) !== key);
  let next: NavDestination[];
  if (without.length !== list.length) {
    // was present → remove
    next = without;
  } else {
    next = [{ ...dest, ts: Date.now() }, ...without];
  }
  write(FAVORITES_KEY, next);
  return next;
}

/** Remove a favorite by coordinates. Returns the new favorites list. */
export function removeFavorite(lat: number, lng: number): NavDestination[] {
  const key = coordKey(lat, lng);
  const next = read(FAVORITES_KEY).filter(d => coordKey(d.lat, d.lng) !== key);
  write(FAVORITES_KEY, next);
  return next;
}
