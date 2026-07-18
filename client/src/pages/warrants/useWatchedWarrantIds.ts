// Tracks the current user's watched warrant ids (a subset of
// intel_watchlist filtered to entity_type='warrant') for the
// WarrantsListTab "Watch"/"Unwatch" menu item and the "My Watched
// Warrants" filter chip. Best-effort UI state — a failed fetch just
// leaves the set empty rather than surfacing an error, since this only
// affects a menu label and a filter, not core warrant data.
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';

interface WatchlistRow {
  entity_type: string;
  entity_id: number;
}

export function useWatchedWarrantIds(): { watchedIds: Set<number>; refresh: () => Promise<void> } {
  const [watchedIds, setWatchedIds] = useState<Set<number>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const rows = await apiFetch<WatchlistRow[]>('/intel/watchlist');
      setWatchedIds(new Set(
        (rows || [])
          .filter((r) => r.entity_type === 'warrant')
          .map((r) => r.entity_id),
      ));
    } catch {
      setWatchedIds(new Set());
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { watchedIds, refresh };
}
