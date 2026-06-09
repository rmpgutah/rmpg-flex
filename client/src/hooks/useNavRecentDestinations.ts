// ============================================================
// useNavRecentDestinations — reactive recents + favorites for Drive Mode
//
// Wraps a self-contained localStorage-backed destination store as React
// state so panels re-render when recents/favorites change. There is no
// shared navDestinations util in the tree yet, so this hook OWNS the store
// (keys 'rmpg-nav-recents' / 'rmpg-nav-favorites') and the dedupe + cap
// rules. SSR-safe; every storage access is guarded.
//
//   • recents are capped at 12, most-recent-first, deduped by lat/lng
//   • favorites are unbounded and toggle independently of recents
// ============================================================

import { useCallback, useState } from 'react';

const LS_RECENTS = 'rmpg-nav-recents';
const LS_FAVORITES = 'rmpg-nav-favorites';
const RECENTS_CAP = 12;

export interface NavDestination {
  /** Stable key derived from coordinates. */
  id: string;
  label: string;
  lat: number;
  lng: number;
  /** Epoch ms of the most recent visit (recents only). */
  lastAt?: number;
}

export interface UseNavRecentDestinationsResult {
  recents: NavDestination[];
  favorites: NavDestination[];
  addRecent: (d: Omit<NavDestination, 'id' | 'lastAt'>) => void;
  toggleFavorite: (d: Omit<NavDestination, 'id' | 'lastAt'>) => void;
  removeFavorite: (id: string) => void;
  isFavorite: (latOrId: number | string, lng?: number) => boolean;
}

function destId(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function isDest(x: unknown): x is NavDestination {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as any).lat === 'number' &&
    typeof (x as any).lng === 'number' &&
    typeof (x as any).label === 'string'
  );
}

function load(key: string): NavDestination[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isDest)
      .map((d) => ({ ...d, id: d.id || destId(d.lat, d.lng) }));
  } catch {
    return [];
  }
}

function save(key: string, list: NavDestination[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function useNavRecentDestinations(): UseNavRecentDestinationsResult {
  const [recents, setRecents] = useState<NavDestination[]>(() => load(LS_RECENTS));
  const [favorites, setFavorites] = useState<NavDestination[]>(() => load(LS_FAVORITES));

  const addRecent = useCallback((d: Omit<NavDestination, 'id' | 'lastAt'>) => {
    if (typeof d?.lat !== 'number' || typeof d?.lng !== 'number') return;
    const id = destId(d.lat, d.lng);
    const entry: NavDestination = { id, label: d.label, lat: d.lat, lng: d.lng, lastAt: Date.now() };
    setRecents((prev) => {
      const deduped = prev.filter((r) => r.id !== id);
      const next = [entry, ...deduped].slice(0, RECENTS_CAP);
      save(LS_RECENTS, next);
      return next;
    });
  }, []);

  const toggleFavorite = useCallback((d: Omit<NavDestination, 'id' | 'lastAt'>) => {
    if (typeof d?.lat !== 'number' || typeof d?.lng !== 'number') return;
    const id = destId(d.lat, d.lng);
    setFavorites((prev) => {
      const exists = prev.some((f) => f.id === id);
      const next = exists
        ? prev.filter((f) => f.id !== id)
        : [...prev, { id, label: d.label, lat: d.lat, lng: d.lng }];
      save(LS_FAVORITES, next);
      return next;
    });
  }, []);

  const removeFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.filter((f) => f.id !== id);
      save(LS_FAVORITES, next);
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (latOrId: number | string, lng?: number): boolean => {
      const id =
        typeof latOrId === 'string' ? latOrId : destId(latOrId, lng as number);
      return favorites.some((f) => f.id === id);
    },
    [favorites],
  );

  return { recents, favorites, addRecent, toggleFavorite, removeFavorite, isFavorite };
}

export default useNavRecentDestinations;
