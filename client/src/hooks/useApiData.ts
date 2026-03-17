import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';

interface UseApiDataResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

export function useApiData<T>(endpoint: string, options?: { immediate?: boolean }): UseApiDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AbortController ref — cancels in-flight fetch on unmount or endpoint change
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    // Abort any previous in-flight request for this endpoint
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    try {
      const result = await apiFetch<T>(endpoint, { signal: controller.signal });
      // Only update state if this request was not aborted
      if (!controller.signal.aborted) {
        setData(result);
      }
    } catch (err: any) {
      // Ignore abort errors (expected on unmount / endpoint change)
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Request failed');
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [endpoint]);

  useEffect(() => {
    if (options?.immediate !== false) {
      refetch();
    }
    // Cleanup: abort in-flight request when endpoint changes or component unmounts
    return () => {
      abortRef.current?.abort();
    };
  }, [refetch, options?.immediate]);

  return { data, isLoading, error, refetch, setData };
}

export default useApiData;
