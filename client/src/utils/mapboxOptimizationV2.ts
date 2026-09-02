import { apiFetch } from '../hooks/useApi';

// ─── Solution types (mirrors src/utils/mapboxOptimizationV2.ts) ──────────────

export interface V2Stop {
  type: 'start' | 'service' | 'pickup' | 'dropoff' | 'break' | 'end';
  location: string;
  eta: string;
  odometer?: number;
  wait?: number;
  duration?: number;
  services?: string[];
}

export interface V2Route {
  vehicle: string;
  stops: V2Stop[];
}

export interface V2Solution {
  dropped: { services: string[]; shipments: string[] };
  routes: V2Route[];
}

// ─── Submit param shapes ─────────────────────────────────────────────────────

export interface ServeRunSubmitParams {
  job_type: 'serve_run';
  serve_queue_ids: number[];
  officer_unit_id?: number;
  shift_start: string; // ISO 8601
  shift_end: string;
  ref_id?: number | null;
  origin?: { lat: number; lng: number } | null;
  circular?: boolean;
}

export interface PatrolBeatSubmitParams {
  job_type: 'patrol_beat';
  beat_ids: number[];
  unit_ids: number[];
  shift_start: string;
  shift_end: string;
}

export interface DispatchSubmitParams {
  job_type: 'multi_unit_dispatch';
  call_ids: number[];
  unit_ids: number[];
}

export type SubmitParams = ServeRunSubmitParams | PatrolBeatSubmitParams | DispatchSubmitParams;

// ─── Response shapes ─────────────────────────────────────────────────────────

export type OptimizationJobStatus = 'idle' | 'pending' | 'processing' | 'complete' | 'error';

export interface SubmitResponse {
  job_id: string;
  status: string;
  // notConfigured shape
  skipped?: boolean;
  ok?: boolean;
  code?: string;
}

export interface JobPollResult {
  job_id: string;
  status: OptimizationJobStatus;
  solution?: V2Solution;
  error?: string;
  skipped?: boolean;
  avg_mpg?: number | null;
}

// ─── API wrappers ─────────────────────────────────────────────────────────────

export async function submitOptimizationJob(params: SubmitParams): Promise<SubmitResponse> {
  return apiFetch<SubmitResponse>('/mapbox/optimization-v2/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function pollOptimizationJob(jobId: string): Promise<JobPollResult> {
  return apiFetch<JobPollResult>(`/mapbox/optimization-v2/${encodeURIComponent(jobId)}`);
}

export interface ServeV2Result {
  orderedJobIds: number[];
  etaByJobId: Map<number, string>;
  droppedJobIds: number[];
  avgMpg?: number | null;
}

const V2_POLL_MS = 1_500;
const V2_MAX_POLLS = 40;

function jobIdFromV2Stop(s: V2Stop): number | null {
  for (const raw of [s.services?.[0], s.location]) {
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Extract visit order + ETAs from a Mapbox Optimization V2 solution. */
export function parseServeV2Solution(solution: V2Solution): ServeV2Result | null {
  const route = solution.routes?.[0];
  const serviceStops = (route?.stops ?? []).filter((s) => s.type === 'service');
  const orderedJobIds: number[] = [];
  const etaByJobId = new Map<number, string>();
  for (const s of serviceStops) {
    const id = jobIdFromV2Stop(s);
    if (id == null) continue;
    orderedJobIds.push(id);
    if (s.eta) etaByJobId.set(id, s.eta);
  }
  const droppedJobIds = (solution.dropped?.services ?? [])
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (orderedJobIds.length === 0) return null;
  return { orderedJobIds, etaByJobId, droppedJobIds };
}

export function v2EtasToArrivalMs(etaByJobId: Map<number, string>): Map<number, number> {
  const arrivals = new Map<number, number>();
  for (const [id, iso] of etaByJobId) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) arrivals.set(id, ms);
  }
  return arrivals;
}

/** Submit a serve_run Optimization V2 job and wait for the solution. */
export async function runServeOptimizationV2(params: Omit<ServeRunSubmitParams, 'job_type'>): Promise<ServeV2Result | null> {
  let submitRes: SubmitResponse;
  try {
    submitRes = await submitOptimizationJob({ job_type: 'serve_run', ...params });
  } catch {
    return null;
  }
  if (!submitRes || submitRes.skipped || submitRes.ok === false || !submitRes.job_id) return null;

  for (let i = 0; i < V2_MAX_POLLS; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, V2_POLL_MS));
    let poll: JobPollResult;
    try {
      poll = await pollOptimizationJob(submitRes.job_id);
    } catch {
      continue;
    }
    if (poll.status === 'error') return null;
    if (poll.status === 'complete' && poll.solution) {
      const result = parseServeV2Solution(poll.solution);
      if (result) result.avgMpg = poll.avg_mpg;
      return result;
    }
  }
  return null;
}
