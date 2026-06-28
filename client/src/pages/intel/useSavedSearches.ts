// Saved searches + recent history for the search bar dropdowns.
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';

export interface SavedSearch { id: number; name: string; query_text: string; created_at: string }
export interface RecentSearch { query_text: string; executed_at: string }

export function useSavedSearches() {
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [recent, setRecent] = useState<RecentSearch[]>([]);

  const reload = useCallback(() => {
    apiFetch<SavedSearch[]>('/intel/saved-searches').then((r) => setSaved(Array.isArray(r) ? r : [])).catch(() => setSaved([]));
    apiFetch<RecentSearch[]>('/intel/search-history').then((r) => setRecent(Array.isArray(r) ? r : [])).catch(() => setRecent([]));
  }, []);
  useEffect(reload, [reload]);

  const save = useCallback(async (name: string, query_text: string) => {
    await apiFetch('/intel/saved-searches', { method: 'POST', body: JSON.stringify({ name, query_text }) }).catch(console.error);
    reload();
  }, [reload]);

  const remove = useCallback(async (id: number) => {
    await apiFetch(`/intel/saved-searches/${id}`, { method: 'DELETE' }).catch(console.error);
    reload();
  }, [reload]);

  return { saved, recent, save, remove, reload };
}
