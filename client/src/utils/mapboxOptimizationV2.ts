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
  officer_unit_id: number;
  shift_start: string; // ISO 8601
  shift_end: string;
  ref_id: number; // serve_routes.id
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
