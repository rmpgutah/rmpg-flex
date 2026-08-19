// client/src/pages/serve/hooks/useServeRunOptimization.ts
// ─────────────────────────────────────────────────────────────────────────────
// Hook that submits queued serve jobs to Mapbox Optimization V2, polls for
// completion, and returns an ordered stop list with ETAs.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServeJob } from '../../../types';
import {
  submitOptimizationJob,
  pollOptimizationJob,
  type OptimizationJobStatus,
} from '../../../utils/mapboxOptimizationV2';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface OptimizedStop {
  jobId: number;
  eta: string;    // ISO 8601 timestamp
  wait: number;   // seconds the vehicle arrives early
}

export interface UseServeRunOptimizationResult {
  status: OptimizationJobStatus;
  elapsedMs: number;
  optimizedOrder: OptimizedStop[];
  droppedJobIds: number[];
  startOptimization: (
    jobs: ServeJob[],
    officerUnitId: number,
    shiftStart: string,
    shiftEnd: string,
    serveRouteId: number,
  ) => Promise<void>;
  reset: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 20; // 60s total timeout

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useServeRunOptimization(): UseServeRunOptimizationResult {
  const [status, setStatus] = useState<OptimizationJobStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [optimizedOrder, setOptimizedOrder] = useState<OptimizedStop[]>([]);
  const [droppedJobIds, setDroppedJobIds] = useState<number[]>([]);

  // Refs for cleanup
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTsRef = useRef<number | null>(null);
  const pollCountRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (intervalRef.current != null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const reset = useCallback(() => {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setStatus('idle');
    setElapsedMs(0);
    setOptimizedOrder([]);
    setDroppedJobIds([]);
    startTsRef.current = null;
    pollCountRef.current = 0;
  }, []);

  const startOptimization = useCallback(async (
    jobs: ServeJob[],
    officerUnitId: number,
    shiftStart: string,
    shiftEnd: string,
    serveRouteId: number,
  ): Promise<void> => {
    // Clear any previous run
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setOptimizedOrder([]);
    setDroppedJobIds([]);
    pollCountRef.current = 0;

    // Only jobs with coordinates can be routed
    const routableJobs = jobs.filter(
      (j) =>
        (j.status === 'pending' || j.status === 'in_progress' || j.status === 'attempted') &&
        j.recipient_lat != null &&
        j.recipient_lng != null,
    );

    if (routableJobs.length < 2) {
      // Not enough routable jobs — nothing to do
      return;
    }

    setStatus('pending');
    startTsRef.current = Date.now();

    let submitRes;
    try {
      submitRes = await submitOptimizationJob({
        job_type: 'serve_run',
        serve_queue_ids: routableJobs.map((j) => j.id),
        officer_unit_id: officerUnitId,
        shift_start: shiftStart,
        shift_end: shiftEnd,
        ref_id: serveRouteId,
      });
    } catch {
      if (mountedRef.current) setStatus('error');
      return;
    }

    // Backend not configured (503/not_configured) or skipped
    if (!submitRes || submitRes.skipped || submitRes.ok === false) {
      if (mountedRef.current) setStatus('error');
      return;
    }

    const jobId = submitRes.job_id;
    if (!jobId) {
      if (mountedRef.current) setStatus('error');
      return;
    }

    if (mountedRef.current) setStatus('processing');

    // ── Poll loop ──────────────────────────────────────────────────────────
    intervalRef.current = setInterval(async () => {
      if (!mountedRef.current) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        return;
      }

      pollCountRef.current += 1;
      if (startTsRef.current != null) {
        setElapsedMs(Date.now() - startTsRef.current);
      }

      // Timeout
      if (pollCountRef.current > MAX_POLLS) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        if (mountedRef.current) setStatus('error');
        return;
      }

      let poll;
      try {
        poll = await pollOptimizationJob(jobId);
      } catch {
        // transient failure — keep polling
        return;
      }

      if (!mountedRef.current) return;

      if (poll.status === 'error') {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        setStatus('error');
        return;
      }

      if (poll.status === 'complete' && poll.solution) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;

        // Parse ordered stops (service type only)
        const route = poll.solution.routes?.[0];
        const stops: OptimizedStop[] = (route?.stops ?? [])
          .filter((s) => s.type === 'service')
          .map((s) => ({
            jobId: Number(s.location),
            eta: s.eta,
            wait: s.wait ?? 0,
          }));

        // Parse dropped jobs
        const dropped = (poll.solution.dropped?.services ?? []).map(Number).filter((n) => !Number.isNaN(n));

        setOptimizedOrder(stops);
        setDroppedJobIds(dropped);
        setStatus('complete');
      }
      // Still pending/processing — keep polling
    }, POLL_INTERVAL_MS);
  }, []);

  return { status, elapsedMs, optimizedOrder, droppedJobIds, startOptimization, reset };
}
