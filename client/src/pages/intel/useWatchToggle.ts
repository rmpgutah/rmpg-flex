// Optimistic watchlist add/remove, reusable across search cards + dossier panel.
import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../../hooks/useApi';

export function useWatchToggle(entityType: string, entityId: number, initial: boolean) {
  const [watched, setWatched] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setWatched(initial), [initial, entityType, entityId]);

  const toggle = useCallback(async () => {
    if (busy) return;
    const next = !watched;
    setWatched(next); setBusy(true);
    try {
      if (next) {
        await apiFetch('/intel/watchlist', {
          method: 'POST',
          body: JSON.stringify({ entity_type: entityType, entity_id: entityId, reason: 'flagged from intel' }),
        });
      } else {
        await apiFetch(`/intel/watchlist/${entityType}/${entityId}`, { method: 'DELETE' });
      }
    } catch {
      setWatched(!next); // rollback
    } finally {
      setBusy(false);
    }
  }, [busy, watched, entityType, entityId]);

  return { watched, busy, toggle };
}
