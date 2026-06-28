// ============================================================
// useGeographyTree — single-shot fetcher for GET /geography/tree
// with 60-second in-memory cache (survives component remounts
// but not full page reloads).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './useApi';
import type { GeographyTree } from '../types/geography';

const CACHE_DURATION_MS = 60_000;

let cachedTree: GeographyTree | null = null;
let cachedAt = 0;

export function useGeographyTree() {
  const [tree, setTree] = useState<GeographyTree | null>(cachedTree);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTree = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && cachedTree && now - cachedAt < CACHE_DURATION_MS) {
      setTree(cachedTree);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<GeographyTree>('/dispatch/geography/tree');
      cachedTree = data;
      cachedAt = now;
      setTree(data);
    } catch (e) {
      setError((e as Error)?.message || 'Failed to load geography tree');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  const refetch = useCallback(() => fetchTree(true), [fetchTree]);

  return { tree, loading, error, refetch };
}
