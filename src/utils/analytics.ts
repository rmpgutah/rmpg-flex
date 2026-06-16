// ============================================================
// RMPG Flex — analytics lakehouse (R2 Data Catalog / Iceberg)
// ============================================================
// Best-effort fan-out of high-volume events to a Cloudflare Pipelines stream
// that lands them as Apache Iceberg tables in R2 Data Catalog, queryable with
// R2 SQL (see src/routes/analytics.ts).
//
// D1 stays the SOURCE OF TRUTH. This is a parallel, append-only copy for
// OLAP-style history (every plate read, forever) that D1 — capped at 10 GB and
// ~100 cols/SELECT — can't hold. The emit NEVER throws into the request path
// and NEVER blocks the response; a dropped event is recoverable from D1 via a
// batch backfill.
//
// The ANALYTICS pipeline binding + the R2 SQL config are OPTIONAL. Until the
// operator runs `wrangler pipelines setup` and wires them in, every emit is a
// silent no-op and every query route 503s — which is exactly what makes this
// safe to deploy before the pipeline exists.
//
// This file holds ONLY pure helpers + the emit shim (no D1, no env import) so
// it can be unit-tested in isolation — see tests/analytics.test.ts.
// ============================================================

/** A single analytics event. Keep it FLAT — each key becomes one Iceberg
 *  column, so values must be JSON-serialisable scalars and a given key must
 *  carry a consistent type across every event (mixed types break the schema). */
export interface AnalyticsEvent {
  /** Event family, e.g. 'alpr_read'. Drives the Pipelines SQL routing/table. */
  event_type: string;
  /** ISO-8601 UTC timestamp of when the event occurred (event time, not ingest time). */
  occurred_at: string;
  /** Numeric user id that produced the event, or null for unattended sources. */
  captured_by?: number | null;
  [key: string]: string | number | boolean | null | undefined;
}

/** Structural shim for the Cloudflare Pipelines binding. Typed locally so the
 *  Worker typecheck doesn't depend on the `cloudflare:pipelines` ambient types
 *  being present; at runtime the binding exposes exactly this `send`. */
export interface AnalyticsPipeline {
  send(records: AnalyticsEvent[]): Promise<void>;
}

/**
 * Fire-and-forget emit to the analytics stream (failure-strategy A).
 *
 * Uses `ctx.waitUntil` so the HTTP response returns immediately while the
 * runtime keeps the isolate alive until the send resolves. A failed send is
 * logged, never thrown — D1 stays authoritative and the batch ETL backfills any
 * gap. No-ops when the binding is unset or there is nothing to send.
 *
 * @param ctx     the Worker ExecutionContext (Hono: `c.executionCtx`)
 * @param stream  the Pipelines binding (Hono: `c.env.ANALYTICS`) — may be undefined
 * @param events  zero or more flat events to append
 */
export function emitAnalytics(
  ctx: ExecutionContext,
  stream: AnalyticsPipeline | undefined,
  events: AnalyticsEvent[],
): void {
  if (!stream || events.length === 0) return;
  ctx.waitUntil(
    stream.send(events).catch((err: unknown) => {
      console.error(
        '[analytics] emit failed:',
        err instanceof Error ? err.message : String(err),
      );
    }),
  );
}

// ── ALPR read → event mapping ────────────────────────────────

/** Capture-level context shared by every vehicle read in one frame. */
export interface AlprReadSource {
  /** alpr_captures row id, or null for sources with no capture row (edge). */
  captureRowId: number | null;
  callId: number | null;
  incidentId: number | null;
  lat: number | null;
  lng: number | null;
  locationText: string | null;
  /** Authenticated user id, or null for unattended sources (edge/Jetson). */
  userId: number | null;
  /** Where the read came from — drives downstream segmentation. */
  source: 'field' | 'edge';
}

/** The per-vehicle fields we lift into the warehouse. Mirrors the shape that
 *  finalizeCapture() returns in src/routes/alpr.ts, but tolerant of partials. */
export interface AlprReadVehicle {
  plate: string | null;
  canonical_plate?: string | null;
  state?: string | null;
  make?: string | null;
  model?: string | null;
  year?: string | number | null;
  color?: string | null;
  vehicle_type?: string | null;
  /** Derived trust (NOT the model self-report) — see plateTrust.ts. */
  trust_score?: number | null;
  confidence?: number | null;
  vehicle_record_id?: number | null;
  hits?: Array<{ severity?: string }>;
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}
function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Map one finalized ALPR vehicle read into a flat analytics event. Pure.
 *  Accepts the loosely-typed object that finalizeCapture() produces (or a typed
 *  {@link AlprReadVehicle}); every field is coerced defensively. */
export function alprReadEvent(
  src: AlprReadSource,
  v: AlprReadVehicle | Record<string, unknown>,
  occurredAt: string,
): AnalyticsEvent {
  const r = v as Record<string, unknown>;
  const hits = Array.isArray(r.hits) ? r.hits : [];
  const canonical = asStr(r.canonical_plate);
  const rawPlate = asStr(r.plate);
  return {
    event_type: 'alpr_read',
    occurred_at: occurredAt,
    captured_by: src.userId,
    source: src.source,
    capture_id: src.captureRowId,
    call_id: src.callId,
    incident_id: src.incidentId,
    // `plate` is the canonical (deduped) plate used for joins/search;
    // `raw_plate` preserves exactly what this read produced.
    plate: canonical || rawPlate,
    raw_plate: rawPlate,
    state: asStr(r.state),
    make: asStr(r.make),
    model: asStr(r.model),
    // Normalise year to a string ALWAYS (the workflow can emit a range like
    // "2018-2020") so the Iceberg column type stays consistent.
    year: r.year != null ? String(r.year) : null,
    color: asStr(r.color),
    vehicle_type: asStr(r.vehicle_type),
    trust: asNum(r.trust_score) ?? asNum(r.confidence),
    vehicle_record_id: asNum(r.vehicle_record_id),
    lat: src.lat,
    lng: src.lng,
    location_text: src.locationText,
    hit_count: hits.length,
    critical_hit: hits.some(
      (h) => !!h && typeof h === 'object' && (h as { severity?: unknown }).severity === 'critical',
    ),
  };
}

// ── R2 SQL helpers (pure; the fetch lives in src/routes/analytics.ts) ────────

/** Iceberg namespace + table the Pipelines sink must write to (and that R2 SQL
 *  reads from). The operator names these at `wrangler pipelines setup` time —
 *  keep them in sync there. */
export const ANALYTICS_NAMESPACE = 'default';
export const ALPR_TABLE = 'alpr_reads';

/** Split the warehouse id ("<account_id>_<bucket>") into its parts for the R2
 *  SQL HTTP endpoint. Account ids are hex (no `_`) and bucket names use hyphens
 *  (no `_`), so the FIRST underscore is the unambiguous separator. */
export function parseWarehouse(warehouse: string): { accountId: string; bucket: string } {
  const sep = warehouse.indexOf('_');
  if (sep <= 0 || sep >= warehouse.length - 1) {
    throw new Error(`malformed R2_ANALYTICS_WAREHOUSE (expected "<account_id>_<bucket>"): ${warehouse}`);
  }
  return { accountId: warehouse.slice(0, sep), bucket: warehouse.slice(sep + 1) };
}

/** Escape a value for use inside a single-quoted R2 SQL string literal by
 *  doubling embedded single quotes. Use ALONGSIDE input validation, not instead
 *  of it. */
export function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

function clampInt(v: number | undefined, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : dflt;
  return Math.min(max, Math.max(min, n));
}

/** "Everywhere this plate was seen since <sinceIso>", newest first. The plate is
 *  uppercased + quote-escaped; the route also validates it to alphanumerics. */
export function buildPlateHistorySql(opts: { plate: string; sinceIso: string; limit?: number }): string {
  const plate = escapeSqlLiteral(opts.plate.toUpperCase().trim());
  const since = escapeSqlLiteral(opts.sinceIso);
  const limit = clampInt(opts.limit, 1, 5000, 500);
  return [
    'SELECT occurred_at, plate, raw_plate, state, make, model, color, vehicle_type,',
    'lat, lng, location_text, source, trust, hit_count, critical_hit, capture_id, call_id',
    `FROM ${ANALYTICS_NAMESPACE}.${ALPR_TABLE}`,
    `WHERE plate = '${plate}' AND occurred_at >= '${since}'`,
    `ORDER BY occurred_at DESC LIMIT ${limit}`,
  ].join(' ');
}

/** Top plates by read volume since <sinceIso>, flagging any that ever hit. */
export function buildAlprSummarySql(opts: { sinceIso: string; limit?: number }): string {
  const since = escapeSqlLiteral(opts.sinceIso);
  const limit = clampInt(opts.limit, 1, 1000, 100);
  return [
    'SELECT plate, COUNT(*) AS reads, MAX(occurred_at) AS last_seen,',
    'MAX(critical_hit) AS ever_hit',
    `FROM ${ANALYTICS_NAMESPACE}.${ALPR_TABLE}`,
    `WHERE occurred_at >= '${since}'`,
    'GROUP BY plate ORDER BY reads DESC',
    `LIMIT ${limit}`,
  ].join(' ');
}

/** The R2 SQL HTTP response envelope shape isn't contractually fixed in the
 *  public beta, so pull the row array out tolerantly across known variants.
 *  Pure + tested so the live shape can be locked down by adding one case. */
export function extractRows(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (!json || typeof json !== 'object') return [];
  const j = json as Record<string, unknown>;
  const candidates: unknown[] = [
    j.rows,
    (j.result as Record<string, unknown> | undefined)?.rows,
    j.result,
    (j.data as Record<string, unknown> | undefined)?.rows,
    j.data,
    (j.result as Record<string, unknown> | undefined)?.records,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as Record<string, unknown>[];
  }
  return [];
}
