import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';

interface UseApiDataOptions {
  /** Whether to fetch immediately on mount (default: true) */
  immediate?: boolean;
  /** Number of automatic retries on failure (default: 0) */
  retries?: number;
  /** Delay between retries in ms (default: 2000) */
  retryDelay?: number;
  /** Cache TTL in ms — skip refetch if data is fresher than this (default: 0 = no cache) */
  cacheTtl?: number;
}

interface UseApiDataResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  /** Re-fetch data from the endpoint */
  refetch: () => Promise<void>;
  /** Manually set data (e.g., for optimistic updates) */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
  /** Clear error state */
  clearError: () => void;
  /** True if data has been loaded at least once */
  hasLoaded: boolean;
  /** Timestamp of last successful fetch */
  lastFetchedAt: number | null;
}

export function useApiData<T>(endpoint: string, options?: UseApiDataOptions): UseApiDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  // AbortController ref — cancels in-flight fetch on unmount or endpoint change
  const abortRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);

  const maxRetries = options?.retries ?? 0;
  const retryDelay = options?.retryDelay ?? 2000;
  const cacheTtl = options?.cacheTtl ?? 0;

  const refetch = useCallback(async () => {
    // Skip if cache is still fresh
    if (cacheTtl > 0 && lastFetchedAt && Date.now() - lastFetchedAt < cacheTtl) {
      return;
    }

    // Abort any previous in-flight request for this endpoint
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    retryCountRef.current = 0;

    const attemptFetch = async (): Promise<void> => {
      try {
        const result = await apiFetch<T>(endpoint, { signal: controller.signal });
        // Only update state if this request was not aborted
        if (!controller.signal.aborted) {
          setData(result);
          setHasLoaded(true);
          setLastFetchedAt(Date.now());
          setIsLoading(false);
        }
      } catch (err) {
        // Ignore abort errors (expected on unmount / endpoint change)
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (controller.signal.aborted) return;

        // Retry logic
        if (retryCountRef.current < maxRetries) {
          retryCountRef.current++;
          await new Promise(r => setTimeout(r, retryDelay * retryCountRef.current));
          if (!controller.signal.aborted) {
            return attemptFetch();
          }
          return;
        }

        setError(err instanceof Error ? err.message : 'Request failed');
        setIsLoading(false);
      }
    };

    await attemptFetch();
  }, [endpoint, maxRetries, retryDelay, cacheTtl, lastFetchedAt]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    if (options?.immediate !== false) {
      refetch();
    }
    // Cleanup: abort in-flight request when endpoint changes or component unmounts
    return () => {
      abortRef.current?.abort();
    };
  }, [refetch, options?.immediate]);

  return { data, isLoading, error, refetch, setData, clearError, hasLoaded, lastFetchedAt };
}

export default useApiData;
