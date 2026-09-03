import { useCallback, useMemo, useState } from 'react';

const STORAGE_KEY = 'rmpg_map_layer_favorites';

function loadIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch { /* quota */ }
}

export function useLayerFavorites() {
  const [ids, setIds] = useState<string[]>(loadIds);

  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      saveIds(next);
      return next;
    });
  }, []);

  const set = useMemo(() => new Set(ids), [ids]);
  return { ids, toggle, set };
}
