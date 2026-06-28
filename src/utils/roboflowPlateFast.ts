// ============================================================
// RMPG Flex — Fast plate-only Roboflow client
// ============================================================
// A lean sibling of roboflowAlpr.ts for the FAST scan path: a workflow
// that only detects the plate, crops it, and OCRs it (no Gemini vehicle
// attributes, no visualization, no vision-events). Returns the plate text
// + detections in ~1s so the officer isn't blocked. Vehicle attributes are
// enriched afterward by the heavy workflow (see src/routes/alpr.ts).
//
// Deployed workflow: workspace rmpg-utah, slug `rmpg-flex-plate-fast`
//   (created 2026-06-14; detect → crop → glm_ocr).
// ============================================================

import {
  buildAlprRequest, unwrapOutputs, asDetections, cleanPlate, firstOcrString,
  ROBOFLOW_SERVERLESS_BASE, ROBOFLOW_WORKSPACE, isQuotaResponse,
  RoboflowError, RoboflowConfigError, RoboflowTimeoutError, RoboflowHttpError, RoboflowQuotaError,
  type RoboflowImageInput, type AlprDetection,
} from './roboflowAlpr';

// Deployed slug of the lean plate-only workflow. Override at runtime with the
// ROBOFLOW_FAST_WORKFLOW_ID Worker var.
export const ROBOFLOW_FAST_WORKFLOW_ID = 'rmpg-flex-plate-fast';

const FAST_TIMEOUT_MS = 12_000;   // fail fast — never hang the shutter
const FAST_RETRIES = 1;

export interface FastPlateResult {
  plate: string | null;
  state: string | null;     // best-effort; usually filled by enrichment
  predictions: AlprDetection[];
}

export interface RunFastOptions {
  image: RoboflowImageInput;
  apiKey: string;
  apiUrl?: string;
  workflowId?: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function fastRunUrl(opts?: { apiUrl?: string; workflowId?: string }): string {
  let base = opts?.apiUrl || ROBOFLOW_SERVERLESS_BASE;
  while (base.endsWith('/')) base = base.slice(0, -1);
  const wf = opts?.workflowId || ROBOFLOW_FAST_WORKFLOW_ID;
  return `${base}/${ROBOFLOW_WORKSPACE}/workflows/${wf}`;
}

/** Pure: pull the plate text + detections out of the fast workflow response. */
export function parseFastPlate(json: unknown): FastPlateResult {
  const entry = unwrapOutputs(json)[0] ?? {};
  const plateRaw = firstOcrString((entry as Record<string, unknown>).license_plate_text);
  const predictions: AlprDetection[] = [];
  for (const [name, value] of Object.entries(entry as Record<string, unknown>)) {
    const dets = asDetections(name, value);
    if (dets.length) predictions.push(...dets);
  }
  return { plate: plateRaw ? cleanPlate(plateRaw) : null, state: null, predictions };
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const retriable = (s: number) => s === 429 || (s >= 500 && s <= 599);

/** Run the lean plate-only workflow against a single image. Typed errors. */
export async function runPlateFast(opts: RunFastOptions): Promise<FastPlateResult> {
  // Reuse the validated request builder; point it at the fast workflow.
  const { body } = buildAlprRequest({
    image: opts.image, apiKey: opts.apiKey, apiUrl: opts.apiUrl,
    workflowId: opts.workflowId || ROBOFLOW_FAST_WORKFLOW_ID,
  });
  const url = fastRunUrl(opts);
  const fetchImpl = opts.fetchImpl || fetch;
  const sleep = opts.sleep || realSleep;
  const timeoutMs = opts.timeoutMs ?? FAST_TIMEOUT_MS;
  const maxAttempts = (opts.retries ?? FAST_RETRIES) + 1;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        if (isQuotaResponse(res.status, detail)) throw new RoboflowQuotaError(detail.slice(0, 300));
        if (retriable(res.status) && attempt < maxAttempts - 1) {
          lastErr = new RoboflowHttpError(`Roboflow HTTP ${res.status}`, res.status, detail.slice(0, 300));
          continue;
        }
        throw new RoboflowHttpError(`Fast plate run failed (HTTP ${res.status})`, res.status, detail.slice(0, 300));
      }
      return parseFastPlate(await res.json());
    } catch (err) {
      if (err instanceof RoboflowQuotaError) throw err;
      if (err instanceof RoboflowHttpError && !retriable(err.status ?? 0)) throw err;
      if (err instanceof RoboflowConfigError) throw err;
      const aborted = (err as { name?: string })?.name === 'AbortError';
      lastErr = aborted ? new RoboflowTimeoutError(`Fast plate run timed out after ${timeoutMs}ms`) : err;
      if (attempt >= maxAttempts - 1) break;
    } finally { clearTimeout(timer); }
  }
  if (lastErr instanceof RoboflowError) throw lastErr;
  throw new RoboflowError('Fast plate run failed', { detail: lastErr });
}
