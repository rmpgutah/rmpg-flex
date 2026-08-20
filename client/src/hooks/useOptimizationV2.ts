import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  submitOptimizationJob,
  pollOptimizationJob,
  type SubmitParams,
  type OptimizationJobStatus,
  type V2Solution,
} from '../utils/mapboxOptimizationV2';

const POLL_INTERVAL_MS = 3_000;

export interface UseOptimizationV2 {
  submit(params: SubmitParams): Promise<void>;
  status: OptimizationJobStatus;
  solution: V2Solution | null;
  elapsedMs: number;
  error: string | null;
  reset(): void;
}

export function useOptimizationV2(): UseOptimizationV2 {
  const [status, setStatus] = useState<OptimizationJobStatus>('idle');
  const [solution, setSolution] = useState<V2Solution | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const jobIdRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startMsRef = useRef<number>(0);
  const mountedRef = useRef(true);

  const clearPolling = useCallback(() => {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearPolling();
    jobIdRef.current = null;
    setStatus('idle');
    setSolution(null);
    setElapsedMs(0);
    setError(null);
  }, [clearPolling]);

  // Clear interval and mark unmounted on cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPolling();
    };
  }, [clearPolling]);

  const startPolling = useCallback((jobId: string) => {
    startMsRef.current = Date.now();

    intervalRef.current = setInterval(async () => {
      if (!mountedRef.current) return;
      setElapsedMs(Date.now() - startMsRef.current);
      try {
        const result = await pollOptimizationJob(jobId);
        if (!mountedRef.current) return;
        if (result.status === 'complete') {
          clearPolling();
          setSolution(result.solution ?? null);
          setStatus('complete');
        } else if (result.status === 'error') {
          clearPolling();
          setError(result.error ?? 'Unknown error');
          setStatus('error');
        } else {
          setStatus(result.status);
        }
      } catch {
        // Transient network error — keep polling
      }
    }, POLL_INTERVAL_MS);
  }, [clearPolling]);

  const submit = useCallback(async (params: SubmitParams) => {
    reset();
    setStatus('pending');
    try {
      const resp = await submitOptimizationJob(params);
      if (resp.skipped || !resp.job_id) {
        setError(resp.code ?? 'not_configured');
        setStatus('error');
        return;
      }
      jobIdRef.current = resp.job_id;
      setStatus('processing');
      startPolling(resp.job_id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Submit failed');
      setStatus('error');
    }
  }, [reset, startPolling]);

  // Memoize the returned object so callers get a stable reference between
  // renders. Without this, every render creates a new object — any useCallback
  // that lists the whole object in its deps (e.g. handleOptimizeAssignments in
  // DispatchPage) is recreated every render, and any child component with that
  // callback in a useEffect dep re-runs the effect every render.
  return useMemo(
    () => ({ submit, status, solution, elapsedMs, error, reset }),
    [submit, status, solution, elapsedMs, error, reset],
  );
}
