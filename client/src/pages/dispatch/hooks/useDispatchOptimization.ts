import { useState, useCallback, useRef, useEffect } from 'react';
import {
  submitOptimizationJob,
  pollOptimizationJob,
  type OptimizationJobStatus,
  type V2Solution,
} from '../../../utils/mapboxOptimizationV2';
import type { AssignmentProposal } from '../components/AssignmentProposalModal';
export type { AssignmentProposal };

const POLL_INTERVAL_MS = 3_000;

export interface UseDispatchOptimizationResult {
  status: OptimizationJobStatus;
  elapsedMs: number;
  proposals: AssignmentProposal[];
  droppedServices: string[];
  accepted: Set<number>;
  showModal: boolean;
  applying: boolean;
  toggleAccepted: (callId: number) => void;
  acceptAll: () => void;
  startOptimization: (callIds: number[], unitIds: number[], extra?: {
    callDetails?: Map<number, { incidentNumber: string; address: string; priority: string }>;
    callAssignments?: Map<number, string[]>;
    unitsBySign?: Map<string, number>;
  }) => Promise<void>;
  applyProposals: (onAssign: (callId: number, unitId: number) => Promise<void>) => Promise<void>;
  closeModal: () => void;
  reset: () => void;
}

interface JobMeta {
  callIds: number[];
  unitCallSigns: Map<number, string>; // unitId → call_sign
}

/**
 * Build AssignmentProposal[] from a completed V2Solution.
 *
 * Each route.vehicle is a unit call_sign.  Each service stop's location is
 * "call-{id}".  We match back to a unit id via the unitCallSigns map that was
 * captured at submit time.
 */
function buildProposals(
  solution: V2Solution,
  meta: JobMeta,
  // calls keyed by id → current assigned_units (call signs or ids)
  callAssignments: Map<number, string[]>,
  // units keyed by call_sign → id
  unitsBySign: Map<string, number>,
): AssignmentProposal[] {
  const proposals: AssignmentProposal[] = [];

  for (const route of solution.routes) {
    const unitSign = route.vehicle;
    const unitId = unitsBySign.get(unitSign) ?? -1;

    for (const stop of route.stops) {
      if (stop.type !== 'service') continue;

      // location is "call-{id}"
      const match = stop.location.match(/^call-(\d+)$/);
      if (!match) continue;
      const callId = Number(match[1]);

      const currentAssignments = callAssignments.get(callId) ?? [];
      const currentAssignment = currentAssignments.length > 0 ? currentAssignments[0] : null;

      // "changed" if the suggested unit differs from whatever is currently assigned
      const changed =
        currentAssignment === null ||
        (currentAssignment !== unitSign && currentAssignment !== String(unitId));

      proposals.push({
        callId,
        incidentNumber: `${callId}`,
        address: '',
        priority: 'P3',
        suggestedUnit: unitSign,
        suggestedUnitId: unitId,
        currentAssignment,
        eta: stop.eta,
        changed,
      });
    }
  }

  return proposals;
}

export function useDispatchOptimization(): UseDispatchOptimizationResult {
  const [status, setStatus] = useState<OptimizationJobStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [proposals, setProposals] = useState<AssignmentProposal[]>([]);
  const [droppedServices, setDroppedServices] = useState<string[]>([]);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [applying, setApplying] = useState(false);

  const jobIdRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startMsRef = useRef<number>(0);
  const mountedRef = useRef(true);
  // Snapshot of call/unit context captured at submit time
  const metaRef = useRef<JobMeta | null>(null);
  const callContextRef = useRef<{
    callAssignments: Map<number, string[]>;
    unitsBySign: Map<string, number>;
    callDetails: Map<number, { incidentNumber: string; address: string; priority: string }>;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (intervalRef.current != null) clearInterval(intervalRef.current);
    };
  }, []);

  const clearPolling = useCallback(() => {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearPolling();
    jobIdRef.current = null;
    metaRef.current = null;
    callContextRef.current = null;
    setStatus('idle');
    setElapsedMs(0);
    setProposals([]);
    setDroppedServices([]);
    setAccepted(new Set());
    setShowModal(false);
    setApplying(false);
  }, [clearPolling]);

  const closeModal = useCallback(() => {
    setShowModal(false);
  }, []);

  const toggleAccepted = useCallback((callId: number) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(callId)) next.delete(callId);
      else next.add(callId);
      return next;
    });
  }, []);

  const acceptAll = useCallback(() => {
    setAccepted((prev) => {
      // toggling: if all changed are accepted already, deselect all; otherwise select all changed
      const changedIds = proposals.filter((p) => p.changed).map((p) => p.callId);
      const allAccepted = changedIds.every((id) => prev.has(id));
      return allAccepted ? new Set<number>() : new Set<number>(changedIds);
    });
  }, [proposals]);

  const onSolutionReady = useCallback((solution: V2Solution) => {
    const ctx = callContextRef.current;
    const meta = metaRef.current;
    if (!ctx || !meta) return;

    const raw = buildProposals(solution, meta, ctx.callAssignments, ctx.unitsBySign);

    // Enrich with call details from context
    const enriched = raw.map((p) => {
      const detail = ctx.callDetails.get(p.callId);
      return detail
        ? { ...p, incidentNumber: detail.incidentNumber, address: detail.address, priority: detail.priority }
        : p;
    });

    setProposals(enriched);
    setDroppedServices(solution.dropped.services);
    // Pre-accept all changed proposals
    setAccepted(new Set(enriched.filter((p) => p.changed).map((p) => p.callId)));
    setShowModal(true);
  }, []);

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
          setStatus('complete');
          if (result.solution) onSolutionReady(result.solution);
        } else if (result.status === 'error') {
          clearPolling();
          setStatus('error');
        } else {
          setStatus(result.status);
        }
      } catch {
        // transient — keep polling
      }
    }, POLL_INTERVAL_MS);
  }, [clearPolling, onSolutionReady]);

  /**
   * startOptimization — call from DispatchPage with enriched context.
   *
   * `callDetails` enriches the proposals with the call data we already have
   * locally; `unitsBySign` lets us translate a call_sign back to a unit id.
   */
  const startOptimization = useCallback(async (
    callIds: number[],
    unitIds: number[],
    extra?: {
      callDetails?: Map<number, { incidentNumber: string; address: string; priority: string }>;
      callAssignments?: Map<number, string[]>;
      unitsBySign?: Map<string, number>;
    },
  ) => {
    reset();
    setStatus('pending');

    metaRef.current = {
      callIds,
      unitCallSigns: new Map(),
    };
    callContextRef.current = {
      callAssignments: extra?.callAssignments ?? new Map(),
      unitsBySign: extra?.unitsBySign ?? new Map(),
      callDetails: extra?.callDetails ?? new Map(),
    };

    try {
      const resp = await submitOptimizationJob({
        job_type: 'multi_unit_dispatch',
        call_ids: callIds,
        unit_ids: unitIds,
      });
      if (!mountedRef.current) return;
      if (resp.skipped || !resp.job_id) {
        setStatus('error');
        return;
      }
      jobIdRef.current = resp.job_id;
      setStatus('processing');
      startPolling(resp.job_id);
    } catch {
      if (mountedRef.current) setStatus('error');
    }
  }, [reset, startPolling]);

  const applyProposals = useCallback(async (
    onAssign: (callId: number, unitId: number) => Promise<void>,
  ) => {
    setApplying(true);
    try {
      for (const p of proposals) {
        if (!accepted.has(p.callId)) continue;
        if (p.suggestedUnitId < 0) continue;
        await onAssign(p.callId, p.suggestedUnitId);
      }
    } finally {
      if (mountedRef.current) {
        setApplying(false);
        setShowModal(false);
      }
    }
  }, [proposals, accepted]);

  return {
    status,
    elapsedMs,
    proposals,
    droppedServices,
    accepted,
    showModal,
    applying,
    toggleAccepted,
    acceptAll,
    startOptimization,
    applyProposals,
    closeModal,
    reset,
  };
}
