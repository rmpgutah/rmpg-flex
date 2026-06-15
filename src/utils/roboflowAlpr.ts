// ============================================================
// RMPG Flex — Roboflow "ALPR Vehicle Details Capture" client
// ============================================================
// Thin, Worker-safe client for the Roboflow serverless Workflow
//   "ALPR Vehicle Details Capture"
//   workspace : rmpg-utah
//   workflow  : alpr-vehicle-details-capture-1781360579827
//   run (POST): https://serverless.roboflow.com/rmpg-utah/workflows/<id>
//
// Design notes
// ────────────
// • This module is **Worker-safe**: no `node:*` imports, no filesystem.
//   The Worker route persists image outputs to R2; the vitest smoke test
//   writes them to a tmp dir. Neither lives here.
// • Parsing is **schema-agnostic**. The Roboflow HTTP response envelope
//   ({ outputs: [ {<output_name>: value} ] }, one entry per image) is
//   stable and documented, but this *specific* workflow's output NAMES
//   are defined by its `outputs[]` block and are only knowable from a
//   real `workflows_get` / `workflows_run`. So `parseAlprResponse`
//   classifies each value BY SHAPE (base64 image / detection set / record /
//   scalar) so unknown outputs are never lost.
//   GROUNDED 2026-06-13 via `workflows_get`: the workflow declares 50 inputs
//   + 73 outputs. `normalizeCapture` reads the real shapes — the OCR output
//   `license_plate_text`, the structured `vehicle_details` dict (make / model /
//   color_primary / year_range / license_plate_state_or_region / vehicle_type),
//   plate confidence from `enhanced_alpr_record.vehicles[].field_confidence`,
//   and the top-level `risk_score` / `review_*` / `watchlist_hit` scalars —
//   with key-heuristic fallbacks if outputs change. (`workflows_run` couldn't
//   be captured live: the 73-output response — several base64 images —
//   overflows the MCP serializer; the declared `output_structure` is the
//   authoritative shape.)
//
// Reference (Roboflow inference docs, grounded via Context7 2026-06-13):
//   request : { api_key, inputs: { image:{type:'url'|'base64',value}, <param>:value } }
//   response: { outputs: [ { <name>: <value>, ... } ] }   // 1 entry / image
//   image outputs are serialized to base64; sv.Detections → "inference"
//   format ({ predictions:[{x,y,width,height,confidence,class,...}] }).
// ============================================================

export const ROBOFLOW_WORKSPACE = 'rmpg-utah';
export const ROBOFLOW_WORKFLOW_ID = 'alpr-vehicle-details-capture-1781360579827';
export const ROBOFLOW_SERVERLESS_BASE = 'https://serverless.roboflow.com';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 500;

// ── Typed errors ─────────────────────────────────────────────
// Callers can `instanceof`-discriminate to map failures to HTTP codes.

export class RoboflowError extends Error {
  readonly status?: number;
  readonly detail?: unknown;
  constructor(message: string, opts?: { status?: number; detail?: unknown }) {
    super(message);
    this.name = 'RoboflowError';
    this.status = opts?.status;
    this.detail = opts?.detail;
  }
}
/** Bad/missing inputs (no api key, non-https url, empty image). Not retried. */
export class RoboflowConfigError extends RoboflowError {
  constructor(message: string, detail?: unknown) {
    super(message, { detail });
    this.name = 'RoboflowConfigError';
  }
}
/** Request exceeded the timeout (all attempts). */
export class RoboflowTimeoutError extends RoboflowError {
  constructor(message: string) {
    super(message);
    this.name = 'RoboflowTimeoutError';
  }
}
/** Roboflow returned a non-2xx response. `status` carries the HTTP code. */
export class RoboflowHttpError extends RoboflowError {
  constructor(message: string, status: number, detail?: unknown) {
    super(message, { status, detail });
    this.name = 'RoboflowHttpError';
  }
}
/** Roboflow refused the run because the workspace is out of serverless credits
 *  (HTTP 402 credit_cap_exceeded). Not retried — retrying just re-hits the cap.
 *  Fix is operational: raise the credit cap / add billing in the Roboflow
 *  workspace, NOT a code or prompt change. */
export class RoboflowQuotaError extends RoboflowError {
  constructor(detail?: unknown) {
    super('Roboflow workspace is out of serverless credits — raise the credit cap or add billing at app.roboflow.com/settings/plan', { status: 402, detail });
    this.name = 'RoboflowQuotaError';
  }
}

/** True when a non-2xx Roboflow response is a credit/quota exhaustion (402 or a
 *  body that names the credit cap), so callers can fail fast with a clear message. */
export function isQuotaResponse(status: number, detail?: string): boolean {
  return status === 402 || /credit_cap_exceeded|ran out of credits|cannot currently spend credits/i.test(detail || '');
}

// ── Input / output types ─────────────────────────────────────

export type RoboflowImageInput =
  | { type: 'url'; value: string }
  | { type: 'base64'; value: string };

/**
 * Workflow parameters. The "ALPR Vehicle Details Capture" workflow
 * declares ~45 parameters (case_id, gps_*, watchlist_*, geofence_*,
 * alert_*, research_*, thresholds, rmpgutah_api_*, …). They are passed
 * through verbatim under `inputs`, so this stays an open record rather
 * than a brittle hand-maintained mirror of the Roboflow definition.
 */
export type AlprParameters = Record<string, string | number | boolean | null | undefined>;

export interface RunAlprOptions {
  image: RoboflowImageInput;
  parameters?: AlprParameters;
  apiKey: string;
  /** Base origin; defaults to the Roboflow serverless host. */
  apiUrl?: string;
  workspaceName?: string;
  workflowId?: string;
  timeoutMs?: number;
  retries?: number;
  /** Injectable for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable backoff sleeper for tests; defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/** A single object-detection prediction with polygon `points` stripped. */
export interface AlprDetection {
  outputName: string;
  class?: string;
  classId?: number;
  confidence?: number;
  /** Bounding box in the output's own coordinate system. */
  bbox?: { x: number; y: number; width: number; height: number };
  detectionId?: string;
}

/** A base64 image output (visualization/crop). Heavy — persist then drop. */
export interface AlprImageOutput {
  outputName: string;
  mimeType: string;
  ext: string;
  /** Raw base64 (no data: prefix). Never log this. */
  base64: string;
  /** Decoded byte length, for quick size logging without touching bytes. */
  bytes: number;
}

/** Normalized, small, loggable summary derived from scalar outputs. */
export interface AlprCapture {
  plate: string | null;
  state: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  vehicleType: string | null;
  confidence: number | null;
  /** Capture-level condition/damage summary (from the first vehicle). */
  condition: string | null;
  damageObserved: boolean | null;
  damageSummary: string | null;
  riskScore: number | null;
  reviewStatus: string | null;
  /** True iff any alert-ish scalar/flag came back truthy. */
  alerted: boolean;
  /** Every scalar output, keyed by its real output name. Nothing lost. */
  rawScalars: Record<string, string | number | boolean>;
}

/** A single area of visible damage on a vehicle. */
export interface AlprDamageArea {
  /** Panel/region, e.g. "front-bumper", "driver-door", "hood". */
  panel: string | null;
  /** Damage type, e.g. "dent", "scratch", "crack", "missing-part", "scuff". */
  type: string | null;
  /** "minor" | "moderate" | "severe" (free text, normalized lower-case). */
  severity: string | null;
}

/** Per-field confidence (0–1) from a vehicle's `field_confidence` map. Used by
 *  the 0.85 acceptance gate: identity fields gate what's written to the record;
 *  descriptive fields (condition/damage) gate the verified/unverified label. */
export interface AlprFieldConfidence {
  plate?: number | null;
  make?: number | null;
  model?: number | null;
  year?: number | null;
  color?: number | null;
  condition?: number | null;
  damage?: number | null;
}

/** One detected vehicle (from `enhanced_alpr_record.vehicles[]`). A single
 *  photo can contain several — the route creates/links a record per plate. */
export interface AlprVehicle {
  plate: string | null;
  state: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  vehicleType: string | null;
  plateType: string | null;
  /** Plate-read confidence (0–1) from the vehicle's field_confidence map. */
  confidence: number | null;
  // ── Advanced scanner: condition + damage (descriptive observations) ──
  /** Overall condition: clean | minor | moderate | heavy | salvage (or null). */
  condition: string | null;
  /** Whether any visible damage was reported. */
  damageObserved: boolean | null;
  /** One-line human summary of visible damage (or null). */
  damageSummary: string | null;
  /** Structured per-area damage. */
  damageAreas: AlprDamageArea[];
  /** Visible aftermarket parts / decals / commercial markings (or null). */
  aftermarket: string | null;
  /** Per-field confidence map (0–1) for the acceptance gate. */
  confidences: AlprFieldConfidence;
}

export interface ParsedAlpr {
  capture: AlprCapture;
  /** All vehicles detected in the image (deduped by plate). */
  vehicles: AlprVehicle[];
  detections: AlprDetection[];
  /** Image outputs (base64). Persist to R2/disk, then discard. */
  images: AlprImageOutput[];
  /** Object-valued outputs (e.g. vehicle_details, enhanced_alpr_record),
   *  kept so structured detail isn't lost. Long JSON-string outputs and
   *  the LLM report are excluded from `capture.rawScalars` to stay small. */
  records: Record<string, Record<string, unknown>>;
  /** The real top-level output names seen in the response entry. */
  outputKeys: string[];
}

export interface AlprResult extends ParsedAlpr {
  /** Number of image entries returned (1 per input image). */
  imageEntries: number;
}

// ── Request building (pure) ──────────────────────────────────

export function alprRunUrl(opts?: { apiUrl?: string; workspaceName?: string; workflowId?: string }): string {
  const base = (opts?.apiUrl || ROBOFLOW_SERVERLESS_BASE).replace(/\/+$/, '');
  const ws = opts?.workspaceName || ROBOFLOW_WORKSPACE;
  const wf = opts?.workflowId || ROBOFLOW_WORKFLOW_ID;
  return `${base}/${ws}/workflows/${wf}`;
}

/** Strip a `data:<mime>;base64,` prefix if present. */
export function stripDataUri(b64: string): string {
  const m = /^data:[^;]+;base64,(.*)$/s.exec(b64);
  return m ? m[1] : b64;
}

export interface BuiltAlprRequest {
  url: string;
  body: { api_key: string; inputs: Record<string, unknown> };
}

/**
 * Build the POST url + body. Validates eagerly (throws RoboflowConfigError)
 * so callers fail fast with a clear typed error instead of a Roboflow 4xx.
 */
export function buildAlprRequest(opts: RunAlprOptions): BuiltAlprRequest {
  if (!opts.apiKey || !opts.apiKey.trim()) {
    throw new RoboflowConfigError('Missing Roboflow API key (ROBOFLOW_API_KEY).');
  }
  const img = opts.image;
  if (!img || !img.value || !String(img.value).trim()) {
    throw new RoboflowConfigError('Missing image input (url or base64).');
  }
  let imageInput: RoboflowImageInput;
  if (img.type === 'url') {
    // Roboflow rejects plain http:// — require https.
    if (!/^https:\/\//i.test(img.value)) {
      throw new RoboflowConfigError('Image url must be https:// (Roboflow rejects http).');
    }
    imageInput = { type: 'url', value: img.value };
  } else {
    imageInput = { type: 'base64', value: stripDataUri(img.value) };
  }

  // Drop undefined/null params so we don't send dead keys; pass the rest
  // through with their caller-provided types (the workflow declares a mix
  // of string/number/boolean parameters).
  const inputs: Record<string, unknown> = { image: imageInput };
  for (const [k, v] of Object.entries(opts.parameters || {})) {
    if (v === undefined || v === null) continue;
    inputs[k] = v;
  }
  return { url: alprRunUrl(opts), body: { api_key: opts.apiKey, inputs } };
}

// ── Response parsing (pure, schema-agnostic) ─────────────────

/**
 * Tolerantly unwrap the response into the per-image entry array.
 * Handles `{ outputs: [...] }` (raw HTTP), a bare top-level array
 * (SDK-unwrapped), and `{ result: [...] }` defensively.
 */
export function unwrapOutputs(json: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(json)) return json as Array<Record<string, unknown>>;
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    const candidate = obj.outputs ?? obj.result ?? obj.results;
    if (Array.isArray(candidate)) return candidate as Array<Record<string, unknown>>;
    // Some single-image runs may return the entry object directly.
    if (candidate && typeof candidate === 'object') return [candidate as Record<string, unknown>];
  }
  return [];
}

const IMG_MAGIC: Array<{ prefix: string; mimeType: string; ext: string }> = [
  { prefix: '/9j/', mimeType: 'image/jpeg', ext: 'jpg' },
  { prefix: 'iVBORw0KGgo', mimeType: 'image/png', ext: 'png' },
  { prefix: 'R0lGOD', mimeType: 'image/gif', ext: 'gif' },
  { prefix: 'UklGR', mimeType: 'image/webp', ext: 'webp' },
];

/** base64 byte length without allocating the decoded buffer. */
function base64Bytes(b64: string): number {
  const len = b64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (b64.endsWith('==')) padding = 2;
  else if (b64.endsWith('=')) padding = 1;
  return Math.floor((len * 3) / 4) - padding;
}

/**
 * Detect a base64 image output. Roboflow serializes images to base64
 * over HTTP; depending on serializer version the value is either a bare
 * base64 string or a `{ type:'base64'|'image', value:'<b64>' }` wrapper.
 * Returns null for non-image values.
 */
export function asImageOutput(outputName: string, value: unknown): AlprImageOutput | null {
  let b64: string | null = null;
  if (typeof value === 'string') {
    b64 = stripDataUri(value);
  } else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const t = typeof o.type === 'string' ? (o.type as string).toLowerCase() : '';
    const v = o.value;
    if ((t === 'base64' || t === 'image' || t === 'image_base64') && typeof v === 'string') {
      b64 = stripDataUri(v);
    }
  }
  if (!b64) return null;
  const magic = IMG_MAGIC.find((m) => b64!.startsWith(m.prefix));
  if (!magic) return null; // not a recognizable image; treat as scalar/other
  return { outputName, mimeType: magic.mimeType, ext: magic.ext, base64: b64, bytes: base64Bytes(b64) };
}

/** Pull detections out of an "inference"-format object or array of predictions. */
export function asDetections(outputName: string, value: unknown): AlprDetection[] {
  // Gather candidate prediction objects. A detection model returns an
  // "inference" object `{ predictions:[…] }`; when it runs over a LIST of crops
  // (e.g. `license_model` over each car crop) it returns an ARRAY of such
  // objects (one per crop). Recursively flatten both, plus a bare predictions
  // array — so per-crop plate boxes aren't silently dropped.
  const preds: unknown[] = [];
  const collect = (v: unknown): void => {
    if (Array.isArray(v)) { for (const el of v) collect(el); return; }
    if (v && typeof v === 'object') {
      const inner = (v as Record<string, unknown>).predictions;
      if (Array.isArray(inner)) preds.push(...inner);
      else preds.push(v); // a bare prediction object
    }
  };
  collect(value);
  if (!preds.length) return [];
  const out: AlprDetection[] = [];
  for (const raw of preds) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    // Skip if it doesn't look like a detection (avoids classification dicts).
    const hasBox = ['x', 'y', 'width', 'height'].every((k) => typeof p[k] === 'number');
    const hasClass = typeof p.class === 'string' || typeof p.confidence === 'number';
    if (!hasBox && !hasClass) continue;
    out.push({
      outputName,
      class: typeof p.class === 'string' ? p.class : undefined,
      classId: typeof p.class_id === 'number' ? p.class_id : undefined,
      confidence: typeof p.confidence === 'number' ? p.confidence : undefined,
      bbox: hasBox
        ? { x: p.x as number, y: p.y as number, width: p.width as number, height: p.height as number }
        : undefined,
      detectionId: typeof p.detection_id === 'string' ? p.detection_id : undefined,
      // NOTE: segmentation `points` are intentionally NOT carried — they
      // bloat the payload and we never use polygons downstream.
    });
  }
  return out;
}

// Real workflow output names (from `workflows_get`, grounded 2026-06-13).
// The parser still degrades gracefully to key heuristics (KEY below) if the
// workflow's outputs ever change.
export const ALPR_OUTPUT = {
  plateText: 'license_plate_text',     // GLM-OCR parsed text (string)
  vehicleDetails: 'vehicle_details',   // structured dict (make/model/color_primary/year_range/…)
  alprRecord: 'enhanced_alpr_record',  // { vehicles:[{field_confidence,…}], summary, … }
  riskScore: 'risk_score',
  reviewRequired: 'review_required',
  reviewLane: 'review_lane',
  watchlistHit: 'watchlist_hit',
  alertRequired: 'alert_required',
} as const;

// Keep rawScalars small — skip the LLM report (claude_investigation_report)
// and the large `*_json` blobs, which would bloat every stored capture.
const MAX_SCALAR_LEN = 600;

// Fallback key heuristics — only consulted when the named outputs are absent.
const KEY = {
  plate: /plate|tag|registration|licen[cs]e|\blp\b|\bvrm\b/i,
  state: /state|region|province|jurisdiction|territory/i,
  color: /colou?r/i,
  // Lane/disposition-specific: must NOT match unrelated review_notes /
  // review_reason / generic *_status scalars (e.g. processing_status), which the
  // broad /review|status/ previously grabbed as a bogus reviewStatus.
  review: /review_lane|review_status|disposition/i,
};

export function cleanPlate(v: string): string {
  return v.toUpperCase().replace(/[\s-]/g, '').trim();
}

/**
 * Pull JSON-object text out of a string that may be wrapped in a markdown
 * code fence and/or surrounded by prose. Roboflow's `open_ai@v4` block returns
 * its structured-answering output as a STRING fenced in ```json … ``` (NOT a
 * parsed object) — so the raw value looks like "```json\n{ … }\n```". This
 * strips the fence and, if needed, slices to the outermost `{ … }`.
 */
export function unfenceJson(s: string): string {
  let t = s.trim();
  // ```json … ```  or  ``` … ```  (tolerate any/no language tag).
  const fence = /^```[a-zA-Z0-9]*\s*([\s\S]*?)\s*```$/.exec(t);
  if (fence) t = fence[1].trim();
  // Still wrapped in prose? Slice to the outermost object — but leave a JSON
  // array intact (slicing to `{…}` would corrupt a fenced `[…]`, e.g. the
  // per-crop vehicle_details list or damage_areas).
  if (!t.startsWith('{') && !t.startsWith('[')) {
    // Slice to whichever bracket type appears FIRST so a prose-wrapped array
    // (e.g. "Result: [ {…} ]") isn't corrupted by always slicing to `{…}`,
    // which would drop the array brackets and yield `[]` on parse.
    const fb = t.indexOf('{');
    const fa = t.indexOf('[');
    if (fa !== -1 && (fb === -1 || fa < fb)) {
      const lb = t.lastIndexOf(']');
      if (lb > fa) t = t.slice(fa, lb + 1);
    } else if (fb !== -1) {
      const lb = t.lastIndexOf('}');
      if (lb > fb) t = t.slice(fb, lb + 1);
    }
  }
  return t;
}

/**
 * Coerce a value to a plain record. Handles three shapes:
 *  • an already-parsed dict,
 *  • a bare JSON-object string (`{…}`),
 *  • the markdown-fenced JSON string the `open_ai@v4` block emits for
 *    structured-answering outputs (```json … ```) — the real wire shape of
 *    `vehicle_details` / `enhanced_alpr_record`.
 * Without the unfence step the LLM outputs parse as `null`, which is why
 * every capture produced 0 vehicles / a null plate.
 */
function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string' && v.trim()) {
    const t = unfenceJson(v);
    if (t.startsWith('{')) {
      try { const p = JSON.parse(t); if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>; }
      catch { /* not JSON */ }
    }
  }
  return null;
}
function asStr(v: unknown): string | null { return typeof v === 'string' && v.trim() ? v.trim() : null; }
function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function asBool(v: unknown): boolean {
  return v === true || v === 1 || (typeof v === 'string' && /^(1|true|yes|hit|match)$/i.test(v.trim()));
}
function yearFrom(v: unknown): number | null {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '';
  const m = /\b(?:19|20)\d{2}\b/.exec(s);
  return m ? Number(m[0]) : null;
}
/**
 * Normalize a per-field confidence to the [0,1] band the trust/0.85 gate
 * expects. The workflow is LLM-driven and ships sibling scores on a 0–100 scale
 * (e.g. `risk_score:12`, `data_quality_score:88`), so `field_confidence.plate`
 * could plausibly arrive as a percentage (e.g. 93). A raw 93 would defeat the
 * `>= 0.85` gate (accepting everything) and get persisted where 0–1 is assumed.
 * Treat any value > 1 as a percentage, then clamp into [0,1]. (The live scale
 * was never captured — only the declared 0–1 shape is fixtured — so this is a
 * defensive guard, not a confirmed conversion.)
 */
function normalizeConfidence(v: unknown): number | null {
  const n = asNum(v);
  if (n == null) return null;
  const scaled = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, scaled));
}

/** Default acceptance threshold: a read is "accepted" only at ≥85% confidence
 *  (the [0.85,1.0] band). Overridable per call (e.g. from an env var). */
export const ALPR_ACCEPT_CONFIDENCE = 0.85;

/**
 * The 85% acceptance gate, as a pure helper. Returns `value` when its
 * confidence meets the threshold, else `null`. A missing/unknown confidence is
 * treated as below the gate (fail-closed — never assert an unscored read).
 */
export function acceptByConfidence<T>(value: T, conf: number | null | undefined, threshold = ALPR_ACCEPT_CONFIDENCE): T | null {
  if (value == null) return null;
  if (typeof conf !== 'number' || !Number.isFinite(conf)) return null;
  return conf >= threshold ? value : null;
}
function firstStringByKey(entry: Record<string, unknown>, re: RegExp): string | null {
  for (const [k, v] of Object.entries(entry)) {
    if (re.test(k) && typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Map a workflow output entry to a normalized AlprCapture, reading the real
 * output shapes: `license_plate_text` (OCR), the structured `vehicle_details`
 * dict (make/model/color_primary/year_range/license_plate_state_or_region/…),
 * per-field confidence from `enhanced_alpr_record.vehicles[0].field_confidence`,
 * and the top-level risk/review/watchlist scalars. Falls back to key
 * heuristics when a named output is missing. Top-level scalars are preserved
 * (length-capped) in `rawScalars` so nothing useful is silently dropped.
 */
export function normalizeCapture(entry: Record<string, unknown>): AlprCapture {
  const record = asRecord(entry[ALPR_OUTPUT.alprRecord]) ?? {};

  // First vehicle from the full-image `enhanced_alpr_record` — the fallback
  // detail source when per-crop `vehicle_details` is absent/empty. This is the
  // COMMON real-world case: the car detector finds no crop (close/odd angle)
  // so OCR + vehicle_details come back empty, yet the full-image LLM still
  // identifies the vehicle. Without this fallback the capture-level summary
  // (plate/make/…) reads null even though per-vehicle records get created.
  const vehicles = (record as { vehicles?: unknown }).vehicles;
  const firstVeh =
    Array.isArray(vehicles) && vehicles[0] && typeof vehicles[0] === 'object'
      ? (vehicles[0] as Record<string, unknown>)
      : null;
  const vd = asRecord(entry[ALPR_OUTPUT.vehicleDetails]) ?? firstVeh ?? {};

  const rawScalars: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (typeof v === 'number' || typeof v === 'boolean') rawScalars[k] = v;
    else if (typeof v === 'string' && v.length <= MAX_SCALAR_LEN) rawScalars[k] = v;
  }

  // Plate confidence lives in the per-vehicle field_confidence map.
  let confidence: number | null = null;
  if (firstVeh) {
    const fc = (firstVeh as { field_confidence?: unknown }).field_confidence;
    if (fc && typeof fc === 'object') confidence = normalizeConfidence((fc as Record<string, unknown>).plate);
  }

  const plateRaw =
    asStr(entry[ALPR_OUTPUT.plateText]) ??
    asStr(vd.license_plate_text) ??
    asStr(firstVeh?.license_plate_text) ??
    firstStringByKey(entry, KEY.plate);
  const reviewRequired = asBool(entry[ALPR_OUTPUT.reviewRequired]);

  // Condition/damage summary — prefer the structured vehicle (vd → firstVeh).
  const dmgRaw = vd.damage_observed ?? firstVeh?.damage_observed;
  const damageObserved =
    typeof dmgRaw === 'boolean' ? dmgRaw : dmgRaw == null ? null : asBool(dmgRaw);

  return {
    plate: plateRaw ? cleanPlate(plateRaw) : null,
    state: asStr(vd.license_plate_state_or_region) ?? firstStringByKey(entry, KEY.state),
    make: asStr(vd.make),
    model: asStr(vd.model),
    color: asStr(vd.color_primary) ?? asStr(vd.color_secondary) ?? firstStringByKey(entry, KEY.color),
    year: yearFrom(vd.year_range) ?? yearFrom(entry.year),
    vehicleType: asStr(vd.vehicle_type) ?? asStr(vd.plate_type),
    confidence,
    condition: asStr(vd.overall_condition) ?? asStr(vd.condition) ?? asStr(firstVeh?.overall_condition),
    damageObserved,
    damageSummary: asStr(vd.damage_summary) ?? asStr(firstVeh?.damage_summary),
    riskScore: asNum(entry[ALPR_OUTPUT.riskScore]),
    reviewStatus: asStr(entry[ALPR_OUTPUT.reviewLane]) ?? (reviewRequired ? 'review_required' : null) ?? firstStringByKey(entry, KEY.review),
    alerted: asBool(entry[ALPR_OUTPUT.watchlistHit]) || asBool(entry[ALPR_OUTPUT.alertRequired]),
    rawScalars,
  };
}

/** Parse the per-field confidence map off a vehicle record. */
function fieldConfidences(v: Record<string, unknown>): AlprFieldConfidence {
  const fc = asRecord(v.field_confidence) ?? {};
  return {
    plate: normalizeConfidence(fc.plate),
    make: normalizeConfidence(fc.make),
    model: normalizeConfidence(fc.model),
    year: normalizeConfidence(fc.year),
    color: normalizeConfidence(fc.color),
    condition: normalizeConfidence(fc.condition),
    damage: normalizeConfidence(fc.damage),
  };
}

/** Parse `damage_areas` — tolerates a list of dicts, a list of strings, or a
 *  fenced/JSON-string of either (same defensive shape-handling as the rest). */
export function parseDamageAreas(v: unknown): AlprDamageArea[] {
  const out: AlprDamageArea[] = [];
  let list: unknown[] = [];
  if (Array.isArray(v)) list = v;
  else if (typeof v === 'string' && v.trim()) {
    const t = unfenceJson(v);
    if (t.startsWith('[')) { try { const a = JSON.parse(t); if (Array.isArray(a)) list = a; } catch { /* not JSON */ } }
  }
  for (const el of list) {
    const r = asRecord(el);
    if (r) {
      const area: AlprDamageArea = {
        panel: asStr(r.panel) ?? asStr(r.area) ?? asStr(r.location),
        type: asStr(r.type) ?? asStr(r.damage_type),
        severity: asStr(r.severity)?.toLowerCase() ?? null,
      };
      if (area.panel || area.type || area.severity) out.push(area);
    } else {
      const s = asStr(el);
      if (s) out.push({ panel: s, type: null, severity: null });
    }
  }
  return out;
}

/** Map one vehicle record (from enhanced_alpr_record.vehicles[] or the single
 *  vehicle_details dict) to a normalized AlprVehicle. */
function vehicleFromRecord(v: Record<string, unknown>): AlprVehicle {
  const confidences = fieldConfidences(v);
  const plate = asStr(v.license_plate_text);
  const damageAreas = parseDamageAreas(v.damage_areas);
  const damageObservedRaw = v.damage_observed;
  const damageObserved =
    typeof damageObservedRaw === 'boolean' ? damageObservedRaw
    : damageObservedRaw == null ? (damageAreas.length > 0 ? true : null)
    : asBool(damageObservedRaw);
  return {
    plate: plate ? cleanPlate(plate) : null,
    state: asStr(v.license_plate_state_or_region),
    make: asStr(v.make),
    model: asStr(v.model),
    color: asStr(v.color_primary) ?? asStr(v.color_secondary),
    year: yearFrom(v.year_range),
    vehicleType: asStr(v.vehicle_type),
    plateType: asStr(v.plate_type),
    confidence: confidences.plate ?? null,
    condition: asStr(v.overall_condition) ?? asStr(v.condition),
    damageObserved,
    damageSummary: asStr(v.damage_summary),
    damageAreas,
    aftermarket: asStr(v.aftermarket_or_markings) ?? asStr(v.distinctive_features),
    confidences,
  };
}

/**
 * Coerce a value into a list of record-dicts. Handles a single dict, a
 * JSON/fenced-JSON string (object OR array), and an array whose elements are
 * any of those. The `open_ai@v4` block run over a LIST of crops returns an
 * ARRAY of fenced ```json strings (one per crop) — this flattens it to clean
 * dicts so each per-crop vehicle read is recovered.
 */
function asRecordList(v: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const push = (x: unknown): void => { const r = asRecord(x); if (r) out.push(r); };
  if (Array.isArray(v)) {
    for (const el of v) push(el);
  } else if (typeof v === 'string' && v.trim()) {
    const t = unfenceJson(v);
    if (t.startsWith('[')) {
      try { const arr = JSON.parse(t); if (Array.isArray(arr)) for (const el of arr) push(el); }
      catch { /* not a JSON array */ }
    } else push(v);
  } else {
    push(v);
  }
  return out;
}

/** First non-empty string anywhere in a (possibly nested) OCR output —
 *  `license_plate_text` comes back nested, e.g. `[["34 T 6511"]]`. */
export function firstOcrString(v: unknown): string | null {
  if (typeof v === 'string') return asStr(v);
  if (Array.isArray(v)) { for (const el of v) { const s = firstOcrString(el); if (s) return s; } }
  return null;
}

/** Every non-empty string in a (possibly nested) OCR output. `license_plate_text`
 *  is `license_predictions`-shaped — one nested entry per crop in a multi-vehicle
 *  frame, e.g. `[["AAA111"],["BBB222"]]`. `firstOcrString` keeps only the first,
 *  silently dropping later plates in the bare-OCR fallback; this collects all. */
export function allOcrStrings(v: unknown): string[] {
  const out: string[] = [];
  const walk = (x: unknown): void => {
    if (typeof x === 'string') { const s = asStr(x); if (s) out.push(s); }
    else if (Array.isArray(x)) for (const el of x) walk(el);
  };
  walk(v);
  return out;
}

/**
 * Extract every detected vehicle. Prefers the full-image
 * `enhanced_alpr_record.vehicles[]` (the LLM enumerates EVERY vehicle in the
 * frame — the authoritative count). Falls back to the per-crop `vehicle_details`
 * (one dict per car crop, returned as an array of fenced ```json strings), then
 * to a bare `license_plate_text` OCR string. Deduped by plate (a photo may list
 * the same plate from multiple crops), keeping the highest-confidence read.
 */
export function parseVehicles(entry: Record<string, unknown>): AlprVehicle[] {
  let raw: AlprVehicle[] = [];
  const record = asRecord(entry[ALPR_OUTPUT.alprRecord]);
  const list = record && Array.isArray((record as { vehicles?: unknown }).vehicles)
    ? (record as { vehicles: unknown[] }).vehicles : null;
  if (list && list.length) {
    raw = list.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object').map(vehicleFromRecord);
  } else {
    // Per-crop vehicle_details: an array of fenced ```json dicts (one per car
    // crop) → one vehicle each. `asRecordList` unwraps the real array shape.
    const vds = asRecordList(entry[ALPR_OUTPUT.vehicleDetails]);
    if (vds.length) {
      raw = vds.map(vehicleFromRecord);
    } else {
      // One plate-only vehicle per distinct OCR string — a multi-vehicle frame
      // returns one OCR entry per crop, so reading only the first dropped the
      // rest. Exact duplicates collapse in the dedupe-by-plate pass below.
      const plates = allOcrStrings(entry[ALPR_OUTPUT.plateText]);
      raw = plates.map((p) => ({ plate: cleanPlate(p), state: null, make: null, model: null, color: null, year: null, vehicleType: null, plateType: null, confidence: null, condition: null, damageObserved: null, damageSummary: null, damageAreas: [], aftermarket: null, confidences: {} }));
    }
  }
  // Drop empty entries (no plate AND no descriptive attributes).
  raw = raw.filter((v) => v.plate || v.make || v.model || v.color || v.vehicleType);
  // Dedupe by plate, keeping the highest-confidence read; null-plate entries
  // are kept as-is (distinct unidentified vehicles).
  const byPlate = new Map<string, AlprVehicle>();
  const noPlate: AlprVehicle[] = [];
  for (const v of raw) {
    if (!v.plate) { noPlate.push(v); continue; }
    const prev = byPlate.get(v.plate);
    if (!prev || (v.confidence ?? 0) > (prev.confidence ?? 0)) byPlate.set(v.plate, v);
  }
  return [...byPlate.values(), ...noPlate];
}

/**
 * Parse a Roboflow ALPR workflow response (raw JSON) into a normalized,
 * shape-classified result. Reads only the first image entry (this
 * integration submits one image per call).
 */
export function parseAlprResponse(json: unknown): ParsedAlpr {
  const entries = unwrapOutputs(json);
  const entry = entries[0] ?? {};
  const outputKeys = Object.keys(entry);

  const detections: AlprDetection[] = [];
  const images: AlprImageOutput[] = [];
  const records: Record<string, Record<string, unknown>> = {};

  for (const [name, value] of Object.entries(entry)) {
    const img = asImageOutput(name, value);
    if (img) { images.push(img); continue; }
    const dets = asDetections(name, value);
    if (dets.length) { detections.push(...dets); continue; }
    // Record-valued outputs (vehicle_details, enhanced_alpr_record, …) are
    // kept so structured detail isn't lost — and persisted into the capture's
    // raw_json. `asRecord` unwraps the markdown-fenced JSON STRING the LLM
    // blocks emit, so the PARSED object (not the raw "```json…```" string) is
    // stored. Scalars are handled inside normalizeCapture (capped into
    // rawScalars).
    const rec = asRecord(value);
    if (rec) { records[name] = rec; continue; }
  }

  return { capture: normalizeCapture(entry), vehicles: parseVehicles(entry), detections, images, records, outputKeys };
}

// ── Network call ─────────────────────────────────────────────

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Run the "ALPR Vehicle Details Capture" workflow against a single image.
 *
 * - Times out each attempt via AbortController (`timeoutMs`).
 * - Retries network errors / 429 / 5xx with exponential backoff
 *   (`retries` extra attempts). 4xx (except 429) fail fast.
 * - Throws a typed RoboflowError subclass on failure.
 * - Returns parsed, schema-agnostic results. Image outputs are returned
 *   as base64 in `images` — the caller persists them (R2/disk) and must
 *   NOT log them.
 */
export async function runAlprVehicleCapture(opts: RunAlprOptions): Promise<AlprResult> {
  const { url, body } = buildAlprRequest(opts);
  const fetchImpl = opts.fetchImpl || fetch;
  const sleep = opts.sleep || realSleep;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = (opts.retries ?? DEFAULT_RETRIES) + 1;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(DEFAULT_BACKOFF_MS * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        if (isQuotaResponse(res.status, detail)) throw new RoboflowQuotaError(detail.slice(0, 300));
        if (isRetriableStatus(res.status) && attempt < maxAttempts - 1) {
          lastErr = new RoboflowHttpError(`Roboflow HTTP ${res.status}`, res.status, detail.slice(0, 500));
          continue;
        }
        throw new RoboflowHttpError(`Roboflow workflow run failed (HTTP ${res.status})`, res.status, detail.slice(0, 500));
      }
      const json = await res.json();
      const parsed = parseAlprResponse(json);
      return { ...parsed, imageEntries: unwrapOutputs(json).length };
    } catch (err) {
      if (err instanceof RoboflowQuotaError) throw err;
      if (err instanceof RoboflowHttpError && !isRetriableStatus(err.status ?? 0)) throw err;
      if (err instanceof RoboflowConfigError) throw err;
      const aborted = (err as { name?: string })?.name === 'AbortError';
      lastErr = aborted ? new RoboflowTimeoutError(`Roboflow run timed out after ${timeoutMs}ms`) : err;
      if (attempt >= maxAttempts - 1) break;
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastErr instanceof RoboflowError) throw lastErr;
  throw new RoboflowError('Roboflow workflow run failed', { detail: lastErr });
}
