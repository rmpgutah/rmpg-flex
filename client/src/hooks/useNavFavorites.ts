import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from './useApi';

export interface NavFavorite {
  id: number;
  user_id: number;
  label: string;
  lat: number;
  lng: number;
  address: string | null;
  is_staging?: number | null;
  created_at: string;
}

/**
 * Saved/favorite nav destinations — thin CRUD wrapper over
 * `GET/POST/DELETE /api/nav/favorites` (server route from Task 1).
 */
export function useNavFavorites() {
  const [favorites, setFavorites] = useState<NavFavorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    let cancelled = false;
    apiFetch<NavFavorite[]>('/nav/favorites')
      .then((data) => { if (!cancelled) setFavorites(data); })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          console.error(err);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => reload(), [reload]);

  const save = useCallback(async (label: string, lat: number, lng: number, address?: string) => {
    await apiFetch('/nav/favorites', {
      method: 'POST',
      body: JSON.stringify({ label, lat, lng, address }),
    }).catch(() => {});
    reload();
  }, [reload]);

  const remove = useCallback(async (id: number) => {
    // Optimistic removal — the DELETE route returns 403/404 on failure, but
    // a slow/offline delete shouldn't leave a stale favorite sitting in the list.
    setFavorites((prev) => prev.filter((f) => f.id !== id));
    await apiFetch(`/nav/favorites/${id}`, { method: 'DELETE' }).catch(() => {});
  }, []);

  return { favorites, loading, error, save, remove, reload };
}
