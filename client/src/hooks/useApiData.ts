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
  const mountedRef = useRef(true);

  // Track mount state for safe async setState
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await apiFetch<T>(endpoint);
      if (mountedRef.current) setData(result);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    if (options?.immediate !== false) {
      refetch();
    }
  }, [refetch, options?.immediate]);

  return { data, isLoading, error, refetch, setData };
}

export default useApiData;
