// ============================================================
// RMPG Flex — ALPR Vehicle Details Capture (Roboflow) route
// ============================================================
// POST an on-scene image → run the Roboflow "ALPR Vehicle Details Capture"
// workflow → attach the photo to the call, extract EVERY vehicle, and
// create + link a vehicle record per plate.
//
// Flow (POST /api/alpr/capture):
//   1. Read the uploaded image (multipart `image`) + optional call_id /
//      incident_id + workflow parameters.
//   2. Store the original image to R2. When a call_id/incident_id is given it
//      lands under the `field-photos/` prefix AND gets a `field_photos` row,
//      so it appears automatically in that call's photo gallery.
//   3. Run the workflow (typed errors, timeout + retries). Image outputs come
//      back base64 — never logged.
//   4. For EVERY detected vehicle (enhanced_alpr_record.vehicles[]): upsert a
//      `vehicles_records` row by plate (create if new), link it to the call via
//      `call_vehicles`, log a `vehicle_sightings` row, and run the same
//      cross-hit screening (STOLEN / watchlist / owner-warrant) as a manual
//      sighting — firing a critical-hit notification when warranted.
//   5. Persist the capture-level `alpr_captures` row (call_id, field_photo_id,
//      vehicle_count, the created/linked vehicle ids, raw multi-vehicle JSON).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, columnExists } from '../utils/db';
import { putEncrypted, getDecrypted, FileEncryptionError } from '../utils/encryptedR2';
import { requireRole } from '../middleware/auth';
import { screenVehicle } from '../utils/intelScreen';
import { confirmReviewStatus, confirmWarning } from '../utils/alprReview';
import { normalizeCaptureEdit, describeEdit } from '../utils/alprEdit';
import { containsClause } from '../utils/searchText';
import { recordAudit } from '../utils/auditLog';
import { notConfigured } from '../utils/notConfigured';
import { verifyEdgeSignature } from '../utils/edgeHmac';
import { trustScore } from '../utils/plateTrust';
import { emitAnalytics, alprReadEvent } from '../utils/analytics';
import {
  ALPR_ACCEPT_CONFIDENCE,
  type AlprParameters,
  type AlprVehicle,
} from '../utils/roboflowAlpr';
import { readPlateCloudflare, type CloudflarePlateResult } from '../utils/cloudflarePlate';
import { enrichVehicleRecord } from '../utils/vehicleEnrichment/enrichChain';

import { log } from '../utils/logger';
const alpr = new Hono<Env>();

/** Acceptance threshold (0.85). Overridable via the ALPR_ACCEPT_CONFIDENCE env. */
function acceptThreshold(env: Env['Bindings']): number {
  const v = Number((env as Record<string, unknown>).ALPR_ACCEPT_CONFIDENCE);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : ALPR_ACCEPT_CONFIDENCE;
}

// Field-operational roles capture plates; client_viewer / contract_manager
// / human_resources are excluded (mirrors the intel.ts gate).
const operational = requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher');

const ALPR_PREFIX = 'alpr-captures/';
const FIELD_PHOTO_PREFIX = 'field-photos/'; // call-attached originals share the field_photos gallery

// Declared workflow parameters (from the workflow definition) we pass
// through when present. `image` is handled separately. The workflow declares
// every parameter as a string-typed WorkflowParameter (defaults are strings
// like 'true' / '0.75'), and downstream blocks compare against those strings —
// so we send STRING values for all of them, including the bool/number ones.
const STRING_PARAMS = new Set([
  'case_id', 'investigator_id', 'capture_id', 'capture_timestamp',
  'gps_latitude', 'gps_longitude', 'gps_accuracy_m', 'device_id', 'app_session_id',
  'capture_notes', 'watchlist_plates', 'watchlist_vehicle_keywords',
  'geofence_latitude', 'geofence_longitude', 'geofence_radius_m', 'geofence_alert_mode',
  'alert_webhook_url', 'client_id', 'assignment_id', 'subject_id', 'location_label',
  'street_address', 'capture_reason', 'image_original_filename', 'image_sha256',
  'upload_batch_id', 'privacy_classification', 'data_retention_policy', 'review_status',
  'operator_feedback', 'enhancement_mode', 'enhancement_strength', 'plate_enhancement_mode',
  'plate_enhancement_strength', 'research_webhook_url', 'research_scope', 'research_notes',
  'home_base_latitude', 'home_base_longitude', 'case_priority', 'jurisdiction',
  'rmpgutah_api_url', 'rmpgutah_api_token',
]);
const BOOL_PARAMS = new Set([
  'disable_alerts', 'alert_on_review_required', 'enable_plate_research', 'disable_rmpgutah_api',
]);
const NUM_PARAMS = new Set(['risk_score_threshold', 'plate_confidence_threshold']);

const ALPR_EXTRA_COLUMNS: Array<[string, string]> = [
  ['call_id', 'INTEGER'], ['incident_id', 'INTEGER'], ['field_photo_id', 'INTEGER'],
  ['vehicle_count', 'INTEGER'], ['vehicle_record_ids', 'TEXT'],
  ['enrich_status', 'TEXT'],
  // Advanced scanner: condition/damage + the 0.85 acceptance gate.
  ['condition', 'TEXT'], ['damage_observed', 'INTEGER'], ['damage_summary', 'TEXT'],
  ['plate_confidence', 'REAL'], ['accepted', 'INTEGER'],
  ['reviewed_by', 'INTEGER'], ['reviewed_at', 'TEXT'],
];

// Structured per-observation damage/condition on each sighting (migration 0115).
// Reconciled at runtime too, so the columns the enrich/accept writes target
// exist even if 0115 never reached live D1 (deploy apply is best-effort).
const SIGHTING_EXTRA_COLUMNS: Array<[string, string]> = [
  ['condition', 'TEXT'], ['damage_observed', 'INTEGER'], ['damage_summary', 'TEXT'],
  ['confidence', 'REAL'],
];

/** Create the table (with all columns) and reconcile any missing columns at
 *  runtime, so the route self-heals if migration 0108/0109 never reached D1.
 *  Returns whether the partial UNIQUE index on capture_id exists — the INSERT
 *  may only use `ON CONFLICT(capture_id)` when it does (SQLite throws otherwise). */
async function ensureAlprSchema(db: ReturnType<typeof getDb>): Promise<boolean> {
  await execute(db, `CREATE TABLE IF NOT EXISTS alpr_captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sighting_id INTEGER, capture_id TEXT, case_id TEXT,
    plate TEXT, state TEXT, make TEXT, model TEXT, color TEXT, year INTEGER,
    vehicle_type TEXT, confidence REAL, risk_score REAL, review_status TEXT,
    alerted INTEGER DEFAULT 0, image_key TEXT, annotated_image_key TEXT,
    output_keys TEXT, raw_json TEXT, lat REAL, lng REAL, location_text TEXT,
    captured_by INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')),
    call_id INTEGER, incident_id INTEGER, field_photo_id INTEGER,
    vehicle_count INTEGER, vehicle_record_ids TEXT
  )`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_alpr_plate ON alpr_captures(plate)`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_alpr_capture_id ON alpr_captures(capture_id)`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_alpr_call ON alpr_captures(call_id)`);
  // UNIQUE index on capture_id so the idempotent offline-replay insert can rely on
  // ON CONFLICT(capture_id) DO NOTHING — closes the concurrent-replay race that
  // check-then-insert leaves open. Partial index (WHERE capture_id IS NOT NULL) so
  // the many NULL capture_id rows (non-replay captures) don't collide. Best-effort:
  // if pre-existing duplicate capture_id rows on live block creation, swallow and
  // fall back to the check-then-insert path.
  try { await execute(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_alpr_capture_id_uniq ON alpr_captures(capture_id) WHERE capture_id IS NOT NULL`); }
  catch { /* legacy dupes block the unique index — check-then-insert still guards */ }
  // Whether the unique index actually landed. On live, pre-existing duplicate
  // capture_id rows make the CREATE above fail (and be swallowed), so the INSERT
  // must NOT emit ON CONFLICT(capture_id) — that would throw "does not match any
  // UNIQUE constraint" and break every capture. Detect the real state here.
  const uniqIdx = await queryFirst<{ name: string }>(db,
    `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_alpr_capture_id_uniq'`);
  const hasCaptureUniqueIndex = !!uniqIdx;
  for (const [name, type] of ALPR_EXTRA_COLUMNS) {
    if (!(await columnExists(db, 'alpr_captures', name))) {
      try { await execute(db, `ALTER TABLE alpr_captures ADD COLUMN ${name} ${type}`); }
      catch { /* lost a race or already present — fine */ }
    }
  }
  // vehicle_capture_photos: per-vehicle trust package + crop key store (migration 0118).
  // Created here so the route self-heals on fresh deploys before the migration lands.
  await execute(db, `CREATE TABLE IF NOT EXISTS vehicle_capture_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    capture_id INTEGER, vehicle_record_id INTEGER,
    canonical_plate TEXT, raw_reads_json TEXT, variants_json TEXT,
    read_count INTEGER DEFAULT 1, consensus_ratio REAL,
    trust_score REAL, trust_basis TEXT,
    full_r2_key TEXT, vehicle_r2_key TEXT, plate_r2_key TEXT,
    vehicle_bbox_json TEXT, plate_bbox_json TEXT, source_type TEXT,
    asserted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), created_by INTEGER
  )`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_vcp_capture ON vehicle_capture_photos(capture_id)`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_vcp_plate ON vehicle_capture_photos(canonical_plate)`);

  // field_photos is owned by fieldPhotos.ts — but the call-attached original from
  // /capture links the photo to the call gallery, so ensure the table exists here
  // too (mirrors fieldPhotos.ts ensureTable) rather than silently dropping the link.
  await execute(db, `CREATE TABLE IF NOT EXISTS field_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_id INTEGER NOT NULL,
    call_id INTEGER,
    incident_id INTEGER,
    r2_key TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    latitude REAL,
    longitude REAL,
    notes TEXT,
    taken_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  try { await execute(db, `ALTER TABLE field_photos ADD COLUMN incident_id INTEGER`); } catch { /* column exists */ }

  // vehicle_sightings is owned by migration 0100 — never CREATE it here, only
  // reconcile the structured-damage columns the enrich/accept paths write.
  for (const [name, type] of SIGHTING_EXTRA_COLUMNS) {
    try {
      if (!(await columnExists(db, 'vehicle_sightings', name))) {
        await execute(db, `ALTER TABLE vehicle_sightings ADD COLUMN ${name} ${type}`);
      }
    } catch { /* table absent or lost a race — fine, best-effort */ }
  }
  return hasCaptureUniqueIndex;
}

/** Build the upsert suffix for the alpr_captures INSERT. SQLite only accepts
 *  `ON CONFLICT(capture_id)` when a matching UNIQUE index exists, and a PARTIAL
 *  index requires its predicate (`WHERE capture_id IS NOT NULL`) to be repeated
 *  in the conflict target. When the index is absent (legacy dupes on live) or the
 *  capture has no capture_id, emit no clause and rely on check-then-insert. */
export function captureConflictClause(hasUniqueIndex: boolean, captureId: string | null): string {
  return hasUniqueIndex && captureId != null
    ? ' ON CONFLICT(capture_id) WHERE capture_id IS NOT NULL DO NOTHING'
    : '';
}

function extFrom(filename: string | undefined, contentType: string | undefined): string {
  const fromName = filename && /\.([a-z0-9]{2,5})$/i.exec(filename)?.[1];
  if (fromName) return fromName.toLowerCase();
  if (contentType?.includes('png')) return 'png';
  if (contentType?.includes('webp')) return 'webp';
  return 'jpg';
}

/** Collect declared parameters (string-valued) from a `parameters` JSON
 *  blob + form fields. Bool/number values are stringified to match the
 *  workflow's WorkflowParameter string types. */
function collectParameters(form: FormData): AlprParameters {
  const params: AlprParameters = {};
  const blob = form.get('parameters');
  if (typeof blob === 'string' && blob.trim()) {
    try {
      const parsed = JSON.parse(blob);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (v === null || v === undefined) continue;
          params[k] = typeof v === 'string' ? v : String(v); // 'true' / '0.75'
        }
      }
    } catch { /* ignore malformed blob; explicit fields below still apply */ }
  }
  for (const [k, v] of form.entries()) {
    if (typeof v !== 'string' || !v.trim()) continue;
    if (STRING_PARAMS.has(k)) params[k] = v;
    else if (BOOL_PARAMS.has(k)) params[k] = /^(1|true|yes)$/i.test(v.trim()) ? 'true' : 'false';
    else if (NUM_PARAMS.has(k) && Number.isFinite(Number(v))) params[k] = v.trim();
  }
  return params;
}

/** Upsert a vehicles_records row by plate. Enriches blank fields on an existing
 *  record; creates a new one otherwise. Returns null for a plate-less vehicle. */
async function upsertVehicleRecord(
  db: ReturnType<typeof getDb>, v: AlprVehicle, existingId: number | null,
): Promise<{ id: number; created: boolean; vin: string | null } | null> {
  if (!v.plate || v.plate.length < 2) return null;
  if (existingId) {
    try {
      await execute(db,
        `UPDATE vehicles_records SET
           make = COALESCE(NULLIF(make,''), ?), model = COALESCE(NULLIF(model,''), ?),
           color = COALESCE(NULLIF(color,''), ?), year = COALESCE(year, ?),
           state = COALESCE(NULLIF(state,''), ?), body_style = COALESCE(NULLIF(body_style,''), ?),
           plate_type = COALESCE(NULLIF(plate_type,''), ?), updated_at = datetime('now')
         WHERE id = ?`,
        v.make, v.model, v.color, v.year, v.state, v.vehicleType, v.plateType, existingId);
    } catch (err) { log.warn('[alpr] vehicle enrich failed:', { message: err instanceof Error ? err.message : String(err) }); }
    const existing = await queryFirst<{ vin: string | null }>(db, `SELECT vin FROM vehicles_records WHERE id = ?`, existingId);
    return { id: existingId, created: false, vin: existing?.vin ?? null };
  }
  const r = await execute(db,
    `INSERT INTO vehicles_records (plate_number, state, make, model, year, color, body_style, plate_type, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    v.plate, v.state, v.make, v.model, v.year, v.color, v.vehicleType, v.plateType, 'Created from ALPR capture');
  return { id: Number(r.meta.last_row_id), created: true, vin: null };
}

/** Map a Cloudflare Workers AI plate read into the AlprVehicle shape the record
 *  helpers expect. One vision call produced every field, so the single plate-read
 *  confidence is each field's acceptance confidence. */
function cfReadToVehicle(read: CloudflarePlateResult): AlprVehicle {
  const conf = read.confidence;
  return {
    plate: read.plate, state: read.state, make: read.make, model: read.model,
    color: read.color, year: read.year, vehicleType: read.bodyStyle, plateType: read.plateType,
    confidence: conf, condition: null, damageObserved: null, damageSummary: null,
    damageAreas: [], aftermarket: null,
    confidences: { plate: conf, make: conf, model: conf, year: conf, color: conf },
  };
}

interface FinalizeResult {
  hits: Array<{ kind: string; severity: string; detail: string }>;
  vehicles: Array<Record<string, unknown>>;
  recordIds: number[]; sightingId: number | null;
  accepted: boolean; plateConf: number | null;
}

/** Finalize a capture from a single Cloudflare plate read: screen the plate
 *  (always — officer safety), apply the 0.85 acceptance gate, and only on an
 *  accepted read create/enrich the authoritative vehicles_records + call link +
 *  sighting. Held (<0.85) reads create nothing as fact (POST /accept promotes).
 *  Stamps the alpr_captures row 'done'/'failed'; never throws. */
async function finalizeCapture(
  env: Env['Bindings'],
  db: ReturnType<typeof getDb>,
  args: {
    captureRowId: number; read: CloudflarePlateResult | null;
    callId: number | null; incidentId: number | null;
    lat: number | null; lng: number | null; locationText: string | null; userId: number | null;
    derivedTrust?: number;
  },
  executionCtx?: { waitUntil(p: Promise<unknown>): void },
): Promise<FinalizeResult> {
  const read = args.read;
  const plate = read?.plate ?? null;
  // Never trust the vision model's self-reported confidence directly (it emits
  // ~1.0 constantly — see clearpathAlpr.ts's captureTrust, which fixed the same
  // bug on the dashcam path). Prefer the caller's pre-computed derivedTrust
  // (the /capture route already derives it via trustScore for the alpr_captures
  // insert, so this reuses that single source of truth); fall back to deriving
  // it here via trustScore for any caller that doesn't pass one. A single read
  // is capped at 0.84 inside trustScore, so one capture alone can never clear
  // the default 0.85 accept gate.
  const plateConf = args.derivedTrust ?? (plate
    ? trustScore({ reads: [plate], modelPct: read?.confidence ?? undefined }).trustScore
    : null);
  const out: FinalizeResult = {
    hits: [], vehicles: [], recordIds: [], sightingId: null,
    accepted: false, plateConf,
  };
  const TH = acceptThreshold(env);
  const accepted = !!plate && (plateConf ?? 0) >= TH;
  out.accepted = accepted;

  try {
    if (!plate || !read) {
      await execute(db, `UPDATE alpr_captures SET enrich_status='done', accepted=0, review_status='no_plate', vehicle_count=0 WHERE id=?`, args.captureRowId);
      return out;
    }

    const screen = await screenVehicle(db, { plate });
    out.hits.push(...screen.hits);

    // ── BOLO ALPR match: check active vehicle BOLOs against captured plate ──
    try {
      const boloMatch = await queryFirst<{ id: number; bolo_number: string; description: string }>(
        db,
        // bolos has `type` (not bolo_type) and NO plate column — a plate can
        // only be matched against the free-text vehicle/general description.
        `SELECT id, bolo_number, description FROM bolos
          WHERE status = 'active' AND type = 'vehicle'
            AND (UPPER(vehicle_description) LIKE ? OR UPPER(description) LIKE ?)
          LIMIT 1`,
        `%${plate.toUpperCase()}%`, `%${plate.toUpperCase()}%`,
      );
      if (boloMatch) {
        out.hits.push({
          kind: 'bolo',
          severity: 'critical',
          detail: `ACTIVE BOLO MATCH: ${boloMatch.bolo_number} — ${boloMatch.description}`,
        });
        await execute(db,
          `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
           VALUES ('bolo_alpr_match', 'critical', ?, ?, 'bolo', ?, ?, 0, datetime('now'))`,
          `BOLO ALPR HIT: ${plate} matched BOLO ${boloMatch.bolo_number}`,
          `Vehicle plate ${plate} captured by ALPR matched active BOLO ${boloMatch.bolo_number}: ${boloMatch.description}`,
          boloMatch.id, args.userId,
        ).catch((err: unknown) => { log.error('[alpr] bolo notification insert failed', { plate, boloId: boloMatch.id }, err instanceof Error ? err : new Error(String(err))); });
      }
    } catch { /* best-effort */ }

    const critical = screen.hits.filter((h) => h.severity === 'critical');
    if (critical.length) {
      try {
        await execute(db,
          `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
           VALUES ('intel_screen', 'high', ?, ?, 'vehicle', ?, ?, 0, datetime('now'))`,
          `${accepted ? '' : 'UNCONFIRMED — verify plate: '}PLATE HIT: ${plate}`,
          critical.map((h) => h.detail).join('; '), screen.vehicleId, args.userId);
      } catch (err) { log.error('[alpr] notify failed', { plate }, err instanceof Error ? err : new Error(String(err))); }
    }

    let recordId: number | null = null;
    if (accepted) {
      const up = await upsertVehicleRecord(db, cfReadToVehicle(read), screen.vehicleId);
      recordId = up?.id ?? screen.vehicleId ?? null;
      if (recordId) out.recordIds.push(recordId);
      // Auto-trigger enrichment for newly created records.  Workers AI reads
      // never produce a VIN, so every new row from this path is VIN-less.
      // Fire-and-forget via waitUntil — never delays the response.
      if (up?.created && !up.vin && plate && executionCtx) {
        executionCtx.waitUntil(
          enrichVehicleRecord(plate, read.state ?? '', db, env, executionCtx as ExecutionContext)
            .catch((err: Error) => log.warn('auto-enrich failed', { plate, error: err instanceof Error ? err.message : String(err), stack: err?.stack })),
        );
      }
      if (recordId && args.callId != null) {
        try {
          await execute(db,
            `INSERT OR IGNORE INTO call_vehicles (call_id, vehicle_id, role, notes, added_by, added_at)
             VALUES (?, ?, 'observed', 'ALPR', ?, datetime('now'))`, args.callId, recordId, args.userId);
        } catch (err) { log.warn('[alpr] link failed:', { message: err instanceof Error ? err.message : String(err) }); }
      }
      try {
        const base = `ALPR: ${[read.color, read.make, read.model, read.year].filter(Boolean).join(' ')}`.trim();
        const note = base === 'ALPR:' ? 'ALPR capture (Workers AI)' : base;
        const sres = await execute(db,
          `INSERT INTO vehicle_sightings (plate, state, vehicle_id, location_text, lat, lng, notes, sighted_by, confidence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          plate, read.state, recordId, args.locationText, args.lat, args.lng, note, args.userId, out.plateConf);
        out.sightingId = Number(sres.meta.last_row_id);
      } catch (err) { log.warn('[alpr] sighting failed:', { message: err instanceof Error ? err.message : String(err) }); }
    }

    out.vehicles.push({
      plate, state: read.state,
      make: accepted ? read.make : null, model: accepted ? read.model : null,
      year: accepted ? read.year : null, color: accepted ? read.color : null,
      vehicle_type: accepted ? read.bodyStyle : null, confidence: out.plateConf,
      vehicle_record_id: recordId, vehicle_record_created: recordId != null,
      sighting_id: out.sightingId, hits: screen.hits,
    });

    await execute(db,
      // The initial INSERT (below, on capture) seeds both `confidence` and
      // `plate_confidence` with the raw vision-model self-report — correct
      // BOTH columns here to the derived value, not just plate_confidence,
      // or `confidence` is left stuck at the untrustworthy raw read forever.
      `UPDATE alpr_captures SET make=?, model=?, color=?, year=?, state=?, vehicle_type=?,
         confidence=?, plate_confidence=?, accepted=?, review_status=?, sighting_id=?, vehicle_record_ids=?,
         vehicle_count=1, enrich_status='done' WHERE id=?`,
      accepted ? read.make : null, accepted ? read.model : null, accepted ? read.color : null,
      accepted ? read.year : null, read.state, accepted ? read.bodyStyle : null,
      out.plateConf, out.plateConf, accepted ? 1 : 0, accepted ? 'accepted' : 'needs_review',
      out.sightingId, JSON.stringify(out.recordIds), args.captureRowId);
  } catch (err) {
    log.warn('[alpr] finalize failed:', { message: err instanceof Error ? err.message : String(err) });
    try { await execute(db, `UPDATE alpr_captures SET enrich_status='failed', accepted=0, review_status='needs_review' WHERE id=?`, args.captureRowId); } catch { /* */ }
  }
  return out;
}

/**
 * Persist a manually confirmed/verified vehicle from an ALPR capture.
 * Upserts the vehicle record, links to the call, logs a sighting, and
 * runs watchlist screening. Returns screening hits.
 */
async function persistConfirmedVehicle(
  db: ReturnType<typeof getDb>,
  row: any,
  v: AlprVehicle,
  userId: number,
  source: string,
): Promise<Array<{ kind: string; severity: string; detail: string }>> {
  const hits: Array<{ kind: string; severity: string; detail: string }> = [];
  try {
    const screen = await screenVehicle(db, { plate: v.plate ?? '' });
    hits.push(...screen.hits);
    const recordId = (await upsertVehicleRecord(db, v, screen.vehicleId))?.id ?? screen.vehicleId ?? null;
    const callId = row.call_id ?? null;
    if (recordId && callId != null) {
      try {
        await execute(db,
          `INSERT OR IGNORE INTO call_vehicles (call_id, vehicle_id, role, notes, added_by, added_at)
           VALUES (?, ?, 'observed', ?, ?, datetime('now'))`,
          callId, recordId, source, userId);
      } catch { /* best-effort */ }
    }
    if (v.plate) {
      try {
        await execute(db,
          `INSERT INTO vehicle_sightings (plate, state, vehicle_id, location_text, lat, lng, notes, sighted_by, confidence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          v.plate, v.state, recordId, row.location_text ?? null, row.latitude ?? null, row.longitude ?? null, source, userId, v.confidence);
      } catch { /* best-effort */ }
    }
  } catch (err) {
    log.warn('[alpr] persistConfirmedVehicle failed:', { message: err instanceof Error ? err.message : String(err) });
  }
  return hits;
}

// ── Health: is the integration configured? ───────────────────
alpr.get('/health', operational, (c) => {
  return c.json({
    ok: true,
    configured: true, // Workers AI is always available — no external key/credits
    engine: 'workers-ai',
    model: '@cf/meta/llama-3.2-11b-vision-instruct',
  });
});

// ── Capture: image → workflow → attach to call → vehicles ────
alpr.post('/capture', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;

  let form: FormData;
  try { form = await c.req.formData(); }
  catch { return c.json({ error: 'Expected multipart/form-data with an `image` file' }, 400); }

  const fileEntry = form.get('image') ?? form.get('file') ?? form.get('photo');
  const file = fileEntry && typeof fileEntry === 'object' && 'arrayBuffer' in (fileEntry as object)
    ? (fileEntry as File) : null;
  if (!file) return c.json({ error: 'Missing image (multipart field: image)' }, 400);

  const params = collectParameters(form);
  // Default: tell the workflow NOT to call back into our API — we persist
  // server-side here. String to match the workflow's WorkflowParameter type.
  if (params.disable_rmpgutah_api === undefined) params.disable_rmpgutah_api = 'true';

  const callId = num(form.get('call_id'));
  const incidentId = num(form.get('incident_id'));
  const lat = num(form.get('lat')) ?? num(params.gps_latitude);
  const lng = num(form.get('lng')) ?? num(params.gps_longitude);
  const locationText = strOrNull(params.location_label) ?? strOrNull(params.street_address);
  const attachToCall = callId != null || incidentId != null;

  const hasCaptureUniqueIndex = await ensureAlprSchema(db);

  // Idempotent offline-replay: a repeated capture_id returns the prior row.
  const captureId = typeof params.capture_id === 'string' ? params.capture_id : null;
  if (captureId) {
    const existing = await queryFirst<any>(db, 'SELECT * FROM alpr_captures WHERE capture_id = ?', captureId);
    if (existing) return c.json({ success: true, duplicate: true, ...shapeCapture(existing) });
  }

  // Original image → R2 (never log base64). Call-attached originals live under
  // the field-photos prefix so they show in the call's photo gallery.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = extFrom((file as any).name, file.type);
  const imageKey = `${attachToCall ? FIELD_PHOTO_PREFIX : ALPR_PREFIX}${crypto.randomUUID()}.${ext}`;
  const contentType = file.type || 'image/jpeg';
  // Best-effort R2 put: a storage failure must NOT 500 the whole capture. We still
  // run the read + persist the row (image_url just resolves to a missing object).
  let imageStored = true;
  try {
    await putEncrypted(c.env.UPLOADS, db, c.env, imageKey, bytes, { httpMetadata: { contentType } });
  } catch (err) {
    if (err instanceof FileEncryptionError) throw err; // misconfiguration -- fail loudly, not best-effort
    imageStored = false;
    log.warn('[alpr] R2 image put failed:', { message: err instanceof Error ? err.message : String(err) });
  }

  // Attach the photo to the call/incident via field_photos (best-effort).
  let fieldPhotoId: number | null = null;
  if (attachToCall && imageStored) {
    try {
      const fp = await execute(db,
        `INSERT INTO field_photos (officer_id, call_id, incident_id, r2_key, content_type, size_bytes, latitude, longitude, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId, callId, incidentId, imageKey, contentType, bytes.length, lat, lng, 'ALPR capture');
      fieldPhotoId = Number(fp.meta.last_row_id);
    } catch (err) { log.warn('[alpr] field_photos insert failed:', { message: err instanceof Error ? err.message : String(err) }); }
  }

  // ── Read the plate on Cloudflare Workers AI (free — no Roboflow credits) ──
  // One vision call returns plate + state + make/model/color + confidence, so the
  // old two-stage fast→enrich collapses into a single read. The photo is already
  // saved above, so a read failure never loses the capture.
  let read: CloudflarePlateResult | null = null;
  try {
    read = await readPlateCloudflare(c.env, bytes, contentType);
  } catch (err) {
    log.warn('[alpr] workers-ai read failed', { message: err instanceof Error ? err.message : String(err) });
  }
  const plate = read?.plate ?? null;

  // Derive trust from the vision model's read — a single read is capped at
  // 0.84 max regardless of the model's self-reported confidence, preventing
  // false-positive auto-accepts (see plateTrust.ts trustScore).
  const derivedTrust = plate && read?.confidence != null
    ? trustScore({ reads: [plate], modelPct: read.confidence }).trustScore
    : 0;

  // Capture row (plate known). finalizeCapture then screens + applies the
  // derived trust 0.85 gate + creates records, and stamps the row 'done'.
  const ins = await execute(db,
    `INSERT INTO alpr_captures
       (sighting_id, capture_id, case_id, plate, state, confidence, plate_confidence,
        review_status, image_key, raw_json, lat, lng, location_text, captured_by,
        call_id, incident_id, field_photo_id, vehicle_count, vehicle_record_ids, enrich_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    null, captureId, strOrNull(params.case_id), plate, read?.state ?? null,
    derivedTrust, derivedTrust, 'pending', imageKey,
    JSON.stringify({ engine: read?.model_id ?? 'workers-ai', plate, read }),
    lat, lng, locationText, userId,
    callId, incidentId, fieldPhotoId, plate ? 1 : 0, JSON.stringify([]));
  const captureRowId = Number(ins.meta.last_row_id);

  // Hono throws when accessing executionCtx outside a real worker fetch
  // (route-level tests drive this handler via app.request(), which has no
  // ExecutionContext). Degrade to undefined — finalizeCapture already
  // treats enrichment waitUntil as optional.
  let execCtx: { waitUntil(p: Promise<unknown>): void } | undefined;
  try { execCtx = c.executionCtx; } catch { /* no execution context in this runtime */ }
  const fin = await finalizeCapture(c.env, db, {
    captureRowId, read, callId, incidentId, lat, lng, locationText, userId,
    derivedTrust,
  }, execCtx);

  const hits = Array.from(new Map(fin.hits.map((h) => [h.detail, h])).values());
  const fieldPhotoLinked = fieldPhotoId !== null;
  return c.json({
    success: fin.accepted,
    status: fin.accepted ? 'accepted' : 'needs_review',
    image_stored: imageStored,
    field_photo_linked: fieldPhotoLinked,
    warnings: [
      ...(imageStored ? [] : ['Image upload failed — capture saved without a stored photo.']),
      ...(fieldPhotoLinked ? [] : ['Photo could not be attached to the call gallery.']),
    ],
    id: captureRowId,
    call_id: callId,
    incident_id: incidentId,
    field_photo_id: fieldPhotoId,
    vehicle_count: plate ? 1 : 0,
    vehicles: fin.vehicles,
    capture: {
      plate, state: read?.state ?? null,
      make: fin.accepted ? read?.make ?? null : null,
      model: fin.accepted ? read?.model ?? null : null,
      color: fin.accepted ? read?.color ?? null : null,
      year: fin.accepted ? read?.year ?? null : null,
      vehicleType: fin.accepted ? read?.bodyStyle ?? null : null,
      confidence: fin.plateConf, riskScore: null,
      reviewStatus: fin.accepted ? 'accepted' : (plate ? 'needs_review' : 'no_plate'),
      alerted: hits.some((h) => h.severity === 'critical'),
    },
    detections: [],
    enrich_status: 'done',
    accepted: plate ? fin.accepted : null,
    plate_confidence: fin.plateConf,
    condition: null,
    damage_observed: null,
    damage_summary: null,
    damage_areas: [],
    hits,
    image_url: imageUrlFor(imageKey),
    annotated_image_url: null,
    engine: read?.model_id ?? 'workers-ai',
  });
});

// ── List vehicle_capture_photos packages (honest trust layer) ─
// GET /packages?plate=&min_trust=  — newest-first, optional filters
alpr.get('/packages', operational, async (c) => {
  const db = getDb(c.env); await ensureAlprSchema(db);
  const plate = c.req.query('plate');
  const minTrust = c.req.query('min_trust');
  const where: string[] = []; const args: unknown[] = [];
  if (plate) { where.push('canonical_plate = ?'); args.push(plate); }
  if (minTrust) { where.push('trust_score >= ?'); args.push(Number(minTrust)); }
  const sql = `SELECT * FROM vehicle_capture_photos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`;
  const rows = await query(db, sql, ...args);
  return c.json({ packages: rows });
});

// ── List recent captures ─────────────────────────────────────
alpr.get('/captures', operational, async (c) => {
  const db = getDb(c.env);
  await ensureAlprSchema(db); // read path self-heals: cols may predate migration 0114 on live
  const plate = (c.req.query('plate') || '').toUpperCase().replace(/[\s-]/g, '');
  const caseId = c.req.query('case_id') || '';
  const callId = c.req.query('call_id') || '';
  const review = c.req.query('review');
  // Gallery filters (compose into one WHERE):
  const source = (c.req.query('source') || '').toLowerCase();   // dashcam | field | manual
  const accepted = c.req.query('accepted');                      // '1' | '0'
  const from = c.req.query('from');                              // ISO/SQL datetime lower bound
  const to = c.req.query('to');                                  // upper bound
  const gallery = c.req.query('gallery');                        // gallery mode → only rows with an image
  const limit = Math.min(Number(c.req.query('limit')) || 25, 200);
  try {
    let rows;
    // Review queue = only rows still awaiting review. Keying on review_status
    // (not accepted=0) is essential: a REJECTED row is also accepted=0 and would
    // otherwise reappear in the queue forever.
    if (review) rows = await query<any>(db, `SELECT * FROM alpr_captures WHERE review_status = 'needs_review' ORDER BY created_at DESC LIMIT ?`, limit);
    else if (callId) rows = await query<any>(db, `SELECT * FROM alpr_captures WHERE call_id = ? ORDER BY created_at DESC LIMIT ?`, Number(callId), limit);
    else if (caseId) rows = await query<any>(db, `SELECT * FROM alpr_captures WHERE case_id = ? ORDER BY created_at DESC LIMIT ?`, caseId, limit);
    else {
      const where: string[] = []; const params: any[] = [];
      if (plate) { const m = containsClause('plate'); where.push(m.sql); params.push(m.bind(plate)); }
      if (accepted === '1' || accepted === '0') { where.push('accepted = ?'); params.push(Number(accepted)); }
      if (from) { where.push('created_at >= ?'); params.push(from); }
      if (to) { where.push('created_at <= ?'); params.push(to); }
      if (gallery) where.push("(image_key IS NOT NULL OR annotated_image_key IS NOT NULL)");
      // source: dashcam captures carry a 'cpg_dashcam:' capture_id; field captures
      // are call/field-photo linked; manual = everything else.
      if (source === 'dashcam') where.push("capture_id LIKE 'cpg_dashcam:%'");
      else if (source === 'field') where.push("(call_id IS NOT NULL OR field_photo_id IS NOT NULL) AND COALESCE(capture_id,'') NOT LIKE 'cpg_dashcam:%'");
      else if (source === 'manual') where.push("call_id IS NULL AND field_photo_id IS NULL AND COALESCE(capture_id,'') NOT LIKE 'cpg_dashcam:%'");
      // Left-join the most-recent vehicle_capture_photos package per capture so
      // the gallery can render TrustBadge without losing event_type / alerted.
      const baseWhere = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const sql = `
        SELECT ac.*,
               pkg.trust_score    AS pkg_trust_score,
               pkg.trust_basis    AS pkg_trust_basis,
               pkg.read_count     AS pkg_read_count,
               pkg.canonical_plate AS pkg_canonical_plate,
               pkg.asserted       AS pkg_asserted
        FROM alpr_captures ac
        LEFT JOIN (
          SELECT vcp.*
          FROM vehicle_capture_photos vcp
          JOIN (
            SELECT capture_id, MAX(created_at) AS mx
            FROM vehicle_capture_photos
            GROUP BY capture_id
          ) latest ON vcp.capture_id = latest.capture_id AND vcp.created_at = latest.mx
        ) pkg ON pkg.capture_id = ac.id
        ${baseWhere}
        ORDER BY ac.created_at DESC LIMIT ?`;
      params.push(limit);
      rows = await query<any>(db, sql, ...params);
    }
    return c.json(rows.map(shapeCapture));
  } catch (err) {
    log.error('GET /captures failed', { src: 'src/routes/alpr.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : String(err), hint: 'migration 0108/0109 may not have reached live D1' }, 500);
  }
});

// ── Single capture ───────────────────────────────────────────
alpr.get('/capture/:id', operational, async (c) => {
  const db = getDb(c.env);
  await ensureAlprSchema(db); // read path self-heals: cols may predate migration 0114 on live
  const row = await queryFirst<any>(db, 'SELECT * FROM alpr_captures WHERE id = ?', Number(c.req.param('id')));
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(shapeCapture(row));
});

// ── Review queue: confirm a held (sub-85%) capture ───────────
// Promotes a held read after a human verifies it. Optionally corrects the
// plate; (re)links + screens the corrected vehicle. Records the reviewer.
alpr.post('/capture/:id/accept', operational, async (c) => {
  const db = getDb(c.env);
  await ensureAlprSchema(db);
  const id = Number(c.req.param('id'));
  const userId = Number(c.var.user?.id ?? 0);
  const row = await queryFirst<any>(db, 'SELECT * FROM alpr_captures WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);

  let body: any = {};
  try { body = await c.req.json(); } catch { /* no body is fine */ }
  // Optional plate correction — validate + bound it (don't screen/record junk).
  let corrected: string | null = null;
  if (typeof body.plate === 'string' && body.plate.trim()) {
    const norm = body.plate.toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-Z0-9]{2,10}$/.test(norm)) {
      return c.json({ error: 'Invalid corrected plate (expect 2–10 alphanumeric chars).' }, 400);
    }
    corrected = norm;
  }
  const plate = corrected || row.plate;

  // Now that a human has verified it, create/confirm the authoritative record +
  // link + sighting (held reads created none). If the plate was CORRECTED, the
  // original read's attributes belonged to the wrong plate — drop them; the new
  // plate's attributes will be re-enriched on its next clean scan.
  let hits: Array<{ kind: string; severity: string; detail: string }> = [];
  let persisted = true;
  if (plate) {
    try {
      const screen = await screenVehicle(db, { plate });
      hits = screen.hits;
      const v: AlprVehicle = {
        plate,
        state: corrected ? null : (row.state ?? null),
        make: corrected ? null : (row.make ?? null),
        model: corrected ? null : (row.model ?? null),
        color: corrected ? null : (row.color ?? null),
        year: corrected ? null : (row.year ?? null),
        vehicleType: corrected ? null : (row.vehicle_type ?? null),
        plateType: null, confidence: corrected ? null : (row.plate_confidence ?? null),
        condition: null, damageObserved: null, damageSummary: null, damageAreas: [],
        aftermarket: null, confidences: {},
      };
      const up = await upsertVehicleRecord(db, v, screen.vehicleId);
      const recordId = up?.id ?? screen.vehicleId ?? null;
      if (recordId && row.call_id != null) {
        await execute(db,
          `INSERT OR IGNORE INTO call_vehicles (call_id, vehicle_id, role, notes, added_by, added_at)
           VALUES (?, ?, 'observed', 'ALPR (confirmed)', ?, datetime('now'))`, row.call_id, recordId, userId);
      }
      // Carry the capture's damage/condition onto the confirmed sighting. On a
      // plate CORRECTION the original read's damage belonged to the wrong plate —
      // drop it (mirrors the attribute-drop above); confidence likewise.
      await execute(db,
        `INSERT INTO vehicle_sightings (plate, state, vehicle_id, location_text, lat, lng, notes, sighted_by, condition, damage_observed, damage_summary, confidence)
         VALUES (?, ?, ?, ?, ?, ?, 'ALPR (confirmed)', ?, ?, ?, ?, ?)`,
        plate, v.state, recordId, row.location_text ?? null, row.lat ?? null, row.lng ?? null, userId,
        corrected ? null : (row.condition ?? null),
        corrected ? null : (row.damage_observed ?? null),
        corrected ? null : (row.damage_summary ?? null),
        corrected ? null : (row.plate_confidence ?? null));
    } catch (err) {
      log.warn('[alpr] accept relink failed:', { message: err instanceof Error ? err.message : String(err) });
      persisted = false;
    }
  }

  await execute(db,
    `UPDATE alpr_captures SET accepted=1, review_status=?, plate=COALESCE(?, plate),
       reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`,
    confirmReviewStatus(persisted), corrected, userId, id);
  if (!persisted) {
    try {
      await recordAudit(c, { action: 'ALPR_ACCEPT_UNLINKED', entityType: 'alpr_capture', entityId: id, details: 'authoritative write failed', actorId: userId });
    } catch { /* best-effort */ }
  }
  const updated = await queryFirst<any>(db, 'SELECT * FROM alpr_captures WHERE id = ?', id);
  return c.json({ success: true, hits, ...(persisted ? {} : { warning: confirmWarning(false) }), ...shapeCapture(updated) });
});

// ── Review queue: reject a held capture (kept for audit) ─────
alpr.post('/capture/:id/reject', operational, async (c) => {
  const db = getDb(c.env);
  await ensureAlprSchema(db);
  const id = Number(c.req.param('id'));
  const userId = c.var.user?.id ?? null;
  const row = await queryFirst<any>(db, 'SELECT id FROM alpr_captures WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  await execute(db,
    `UPDATE alpr_captures SET accepted=0, review_status='rejected', reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`,
    userId, id);
  return c.json({ success: true });
});

// ── Advanced review: edit + (re-)verify a capture ────────────
// One endpoint for the full editor on BOTH surfaces (review queue + gallery).
// Persists any supplied field edits, then applies the action:
//   confirm → screen + (re)create authoritative record/link/sighting, accepted=1
//   reject  → review_status='rejected', accepted=0
//   save    → persist edits only, leave review_status untouched
// Operates on ANY status (re-edit/re-verify). Editing a row that was already
// confirmed/rejected requires `reason` and writes an audit_log entry.
alpr.post('/capture/:id/verify', operational, async (c) => {
  const db = getDb(c.env);
  await ensureAlprSchema(db);
  const id = Number(c.req.param('id'));
  const userId = c.var.user?.id ?? null;
  const row = await queryFirst<any>(db, 'SELECT * FROM alpr_captures WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);

  let body: any = {};
  try { body = await c.req.json(); } catch { /* empty body = no edits, default action */ }
  const action: 'confirm' | 'reject' | 'save' =
    body.action === 'reject' ? 'reject' : body.action === 'save' ? 'save' : 'confirm';

  // Normalize + validate the supplied edits (only present keys are touched).
  const maxYear = new Date().getFullYear() + 2;
  const { values, errors } = normalizeCaptureEdit(body, { maxYear });
  if (errors.length) return c.json({ error: errors[0].message, errors }, 400);

  // Re-editing an already-decided row is an audited "change function".
  const wasDecided = row.review_status === 'confirmed' || row.review_status === 'confirmed_unlinked' || row.review_status === 'rejected';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (wasDecided && !reason) {
    return c.json({ error: 'A reason is required to change an already-reviewed capture.' }, 400);
  }

  const plateChanged = values.plate != null && values.plate !== row.plate;

  // Apply field edits to the capture row first (the editor's source of truth).
  const sets: string[] = []; const params: any[] = [];
  for (const [col, val] of Object.entries(values)) { sets.push(`${col} = ?`); params.push(val); }
  if (sets.length) {
    await execute(db, `UPDATE alpr_captures SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
  }

  const plate: string | null = (values.plate ?? row.plate) ?? null;

  let hits: Array<{ kind: string; severity: string; detail: string }> = [];
  let verifyWarning: string | undefined;

  if (action === 'reject') {
    await execute(db,
      `UPDATE alpr_captures SET accepted=0, review_status='rejected', reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`,
      userId, id);
  } else if (action === 'confirm' && plate) {
    // (Re)create the authoritative record + link + sighting using the EFFECTIVE
    // (edited) attributes. A human-supplied attribute is trusted; on a plate
    // change with NO replacement attribute we drop the stale OCR value (it
    // belonged to the misread plate) — mirrors the original /accept rule.
    let persisted = true;
    try {
      const keep = (col: string, key: keyof typeof values) =>
        key in values ? (values as any)[key] : (plateChanged ? null : (row[col] ?? null));
      const v: AlprVehicle = {
        plate,
        state: keep('state', 'state'),
        make: keep('make', 'make'),
        model: keep('model', 'model'),
        color: keep('color', 'color'),
        year: keep('year', 'year'),
        vehicleType: keep('vehicle_type', 'vehicle_type'),
        plateType: null, confidence: plateChanged ? null : (row.plate_confidence ?? null),
        condition: keep('condition', 'condition'), damageObserved: null,
        damageSummary: keep('damage_summary', 'damage_summary'), damageAreas: [],
        aftermarket: null, confidences: {},
      };
      hits = await persistConfirmedVehicle(db, row, v, userId, 'ALPR (verified)');
    } catch (err) {
      log.warn('[alpr] verify relink failed:', { message: err instanceof Error ? err.message : String(err) });
      persisted = false;
    }
    await execute(db,
      `UPDATE alpr_captures SET accepted=1, review_status=?, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`,
      confirmReviewStatus(persisted), userId, id);
    if (!persisted) verifyWarning = confirmWarning(false);
  } else if (action === 'save') {
    await execute(db, `UPDATE alpr_captures SET reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`, userId, id);
  }

  // Audit EVERY verify so the per-capture history is a complete trail (the
  // `wasDecided` rows are the audited "change function"). Best-effort.
  try {
    const diff = describeEdit(row, values);
    const detail = [`${action}`, reason, diff].filter(Boolean).join(' — ');
    await recordAudit(c, { action: 'ALPR_VERIFY', entityType: 'alpr_capture', entityId: id, details: detail.slice(0, 500), actorId: userId });
  } catch (auditErr: any) { console.warn('[alpr] audit_log insert failed:', auditErr?.message); }

  const updated = await queryFirst<any>(db, 'SELECT * FROM alpr_captures WHERE id = ?', id);
  return c.json({ success: true, hits, ...(verifyWarning ? { warning: verifyWarning } : {}), ...shapeCapture(updated) });
});

// ── Bulk confirm/reject the review queue ─────────────────────
// Clears many low-confidence reads at once (no per-field edits — bulk accepts the
// AI's read as-is). Confirm screens + records each; reject marks each rejected.
// Returns per-id results + the union of critical hits so a STOLEN read in the
// batch is never silently swept.
alpr.post('/captures/bulk', operational, async (c) => {
  const db = getDb(c.env);
  await ensureAlprSchema(db);
  const userId = c.var.user?.id ?? null;
  let body: any = {};
  try { body = await c.req.json(); } catch { /* */ }
  const action: 'confirm' | 'reject' = body.action === 'reject' ? 'reject' : 'confirm';
  const ids: number[] = Array.isArray(body.ids)
    ? body.ids.map((x: any) => Number(x)).filter((n: number) => Number.isInteger(n)).slice(0, 200)
    : [];
  if (!ids.length) return c.json({ error: 'No capture ids supplied.' }, 400);

  const results: Array<{ id: number; ok: boolean; status: string }> = [];
  const allHits: Array<{ kind: string; severity: string; detail: string; plate: string }> = [];
  for (const id of ids) {
    try {
      const row = await queryFirst<any>(db, 'SELECT * FROM alpr_captures WHERE id = ?', id);
      if (!row) { results.push({ id, ok: false, status: 'not_found' }); continue; }
      if (action === 'reject') {
        await execute(db,
          `UPDATE alpr_captures SET accepted=0, review_status='rejected', reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`,
          userId, id);
        results.push({ id, ok: true, status: 'rejected' });
      } else if (row.plate) {
        const v: AlprVehicle = {
          plate: row.plate, state: row.state ?? null, make: row.make ?? null, model: row.model ?? null,
          color: row.color ?? null, year: row.year ?? null, vehicleType: row.vehicle_type ?? null,
          plateType: null, confidence: row.plate_confidence ?? null,
          condition: row.condition ?? null, damageObserved: null,
          damageSummary: row.damage_summary ?? null, damageAreas: [], aftermarket: null, confidences: {},
        };
        let persisted = true;
        let hits: Array<{ kind: string; severity: string; detail: string }> = [];
        try {
          hits = await persistConfirmedVehicle(db, row, v, userId, 'ALPR (bulk verified)');
        } catch (persistErr: any) {
          log.warn('[alpr] bulk persist failed', { id, message: persistErr?.message });
          persisted = false;
        }
        for (const h of hits.filter((x) => x.severity === 'critical')) allHits.push({ ...h, plate: row.plate });
        await execute(db,
          `UPDATE alpr_captures SET accepted=1, review_status=?, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`,
          confirmReviewStatus(persisted), userId, id);
        results.push({ id, ok: persisted, status: confirmReviewStatus(persisted) });
      } else {
        results.push({ id, ok: false, status: 'no_plate' });
      }
    } catch (err) {
      log.warn('[alpr] bulk item failed', { id, message: err instanceof Error ? err.message : String(err) });
      results.push({ id, ok: false, status: 'error' });
    }
  }
  // One audit row for the batch.
  try {
    const okCount = results.filter((r) => r.ok).length;
    await recordAudit(c, { action: 'ALPR_BULK_VERIFY', entityType: 'alpr_capture', entityId: 0, details: `${action} ${okCount}/${ids.length}`.slice(0, 500), actorId: userId });
  } catch { /* best-effort */ }
  return c.json({ success: true, action, results, hits: allHits });
});

// ── Per-capture verify/edit history (the audited "change function") ─
alpr.get('/capture/:id/history', operational, async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const rows = await query<any>(db,
    `SELECT al.id, al.user_id, al.action, al.details, al.created_at, u.full_name AS user_name
       FROM audit_log al LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'alpr_capture' AND al.entity_id = ?
      ORDER BY al.created_at DESC LIMIT 100`, id);
  return c.json(Array.isArray(rows) ? rows : []);
});

// ── Stream a stored image back from R2 (prefix-validated) ────
alpr.get('/image/*', operational, async (c) => {
  const key = c.req.path.replace(/^.*\/image\//, '');
  if (!key.startsWith(ALPR_PREFIX) || key.includes('..')) return c.json({ error: 'Invalid key' }, 400);
  const decrypted = await getDecrypted(c.env.UPLOADS, getDb(c.env), c.env, key);
  if (decrypted) {
    return new Response(decrypted.bytes, {
      headers: {
        'Content-Type': decrypted.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=86400',
      },
    });
  }
  // getDecrypted() returns null both for "object never existed" and for a
  // LEGACY object uploaded under alpr-captures/ before this feature shipped
  // (object exists, no file_encryption_keys row) -- mirrors the fallback in
  // fieldPhotos.ts's GET /file/*. Fall back to the raw R2 bytes rather than
  // 404ing every unattached ALPR capture already in production R2.
  const legacy = await c.env.UPLOADS.get(key);
  if (!legacy) return c.json({ error: 'Not found' }, 404);
  return new Response(legacy.body, {
    headers: {
      'Content-Type': legacy.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
    },
  });
});

// ── Crop upload: attach vehicle/plate crop images to a package row ───────────
// The capture handler returns photo_row_id per vehicle so the client can POST
// the crops it extracted client-side (or a server crop job can POST later).
alpr.post('/capture/:photoRowId/photos', operational, async (c) => {
  const db = getDb(c.env);
  await ensureAlprSchema(db);
  const id = Number(c.req.param('photoRowId'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid photoRowId' }, 400);

  let form: FormData;
  try { form = await c.req.formData(); }
  catch { return c.json({ error: 'Expected multipart/form-data' }, 400); }

  const out: Record<string, string> = {};
  for (const field of ['vehicle', 'plate'] as const) {
    const entry = form.get(field);
    const file = entry && typeof entry === 'object' && 'arrayBuffer' in (entry as object)
      ? (entry as File) : null;
    if (file) {
      const key = `alpr/vehicles/${id}/${field}.jpg`;
      await putEncrypted(c.env.UPLOADS, db, c.env, key, await file.arrayBuffer(), { httpMetadata: { contentType: 'image/jpeg' } });
      out[`${field}_r2_key`] = key;
    }
  }

  if (Object.keys(out).length === 0) return c.json({ error: 'No crop files provided (fields: vehicle, plate)' }, 400);

  await execute(db,
    `UPDATE vehicle_capture_photos SET vehicle_r2_key=COALESCE(?,vehicle_r2_key), plate_r2_key=COALESCE(?,plate_r2_key) WHERE id=?`,
    out.vehicle_r2_key ?? null, out.plate_r2_key ?? null, id);

  return c.json({ success: true, ...out });
});

// ── Vehicle dossier: all photo packages for a canonical plate ─────────────────
alpr.get('/vehicle/:plate/dossier', operational, async (c) => {
  const db = getDb(c.env);
  await ensureAlprSchema(db);
  const plate = (c.req.param('plate') ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (!plate || plate.length < 2) return c.json({ error: 'Invalid plate' }, 400);
  const rows = await query<Record<string, unknown>>(db,
    `SELECT * FROM vehicle_capture_photos WHERE canonical_plate = ? ORDER BY created_at DESC LIMIT 500`, plate);
  const vrRow = await db.prepare(
    `SELECT id FROM vehicles_records WHERE UPPER(TRIM(plate_number)) = UPPER(TRIM(?)) LIMIT 1`
  ).bind(plate).first<{ id: number }>();
  return c.json({ plate, packages: rows, vehicle_record_id: vrRow?.id ?? null });
});

// ── Edge device ingest: Jetson vision-LoRA structured ALPR record ────────────
// Edge device (Jetson vision-LoRA) posts a structured ALPR record. HMAC-verified,
// then routed through the same trust path as every other source (source_type='edge_lora').
alpr.post('/edge', async (c) => {
  const secret = c.env.ALPR_EDGE_SECRET;
  if (!secret) return notConfigured(c, 'alpr_edge_secret_unset', { error: 'edge ingest not configured' });
  const ts = Number(c.req.header('X-Edge-Timestamp'));
  const sig = c.req.header('X-Edge-Signature') ?? '';
  const body = await c.req.text();
  const nowSec = Math.floor(Date.now() / 1000);
  if (!ts || !(await verifyEdgeSignature({ secret, timestamp: ts, body, signature: sig, nowSec })))
    return c.json({ error: 'bad signature' }, 401);

  // Malformed body must 400, not throw an unhandled 500 — even post-HMAC.
  let rec: {
    plate?: string; state?: string; make?: string; model?: string; year?: string;
    color?: string; type?: string; plate_confidence?: number; device_id?: string;
    lat?: number; lng?: number; location_text?: string;
  };
  try {
    rec = JSON.parse(body);
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  if (!rec.plate) return c.json({ error: 'no plate' }, 400);

  const db = getDb(c.env); await ensureAlprSchema(db);
  const trust = trustScore({ reads: [rec.plate], modelPct: rec.plate_confidence });
  const PACKAGE_GATE = 0.80; const canonical = trust.canonical || rec.plate;

  // Screen UNCONDITIONALLY (officer safety) and WIRE the result into the same
  // hit/notification path the on-scene /capture flow uses — an edge read of a
  // stolen/watchlisted plate must fire a critical-hit notification, not be dropped.
  const screen = await screenVehicle(db, { plate: canonical });
  const hits = screen.hits;
  const critical = hits.filter((h) => h.severity === 'critical');
  if (critical.length) {
    try {
      await execute(db,
        `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
         VALUES ('intel_screen', 'high', ?, ?, 'vehicle', ?, NULL, 0, datetime('now'))`,
        `EDGE PLATE HIT: ${canonical}`,
        critical.map((h) => h.detail).join('; '), screen.vehicleId);
    } catch (err) { log.warn('[alpr] edge notify failed:', { message: err instanceof Error ? err.message : String(err) }); }
  }

  // Record the edge read as a vehicle_sighting so it lands in the same history as
  // every other source (no call_id on edge reads → no call_vehicles link).
  let sightingId: number | null = null;
  try {
    const note = `ALPR (edge)${[rec.color, rec.make, rec.model, rec.year].filter(Boolean).length ? ': ' + [rec.color, rec.make, rec.model, rec.year].filter(Boolean).join(' ') : ''}`;
    const sres = await execute(db,
      `INSERT INTO vehicle_sightings (plate, state, vehicle_id, location_text, lat, lng, notes, sighted_by, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      canonical, rec.state ?? null, screen.vehicleId,
      rec.location_text ?? null, num(rec.lat), num(rec.lng), note,
      trust.trustScore);
    sightingId = Number(sres.meta.last_row_id);
  } catch (err) { log.warn('[alpr] edge sighting failed:', { message: err instanceof Error ? err.message : String(err) }); }

  let photoRowId: number | null = null;
  if (trust.trustScore >= PACKAGE_GATE) {
    const r = await execute(db,
      `INSERT INTO vehicle_capture_photos
        (capture_id, canonical_plate, raw_reads_json, variants_json, read_count,
         consensus_ratio, trust_score, trust_basis, source_type, asserted, created_at)
       VALUES (NULL,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      canonical, JSON.stringify([rec.plate]), JSON.stringify(trust.variants), trust.readCount,
      trust.consensusRatio, trust.trustScore, trust.basis, 'edge_lora', 0);
    photoRowId = r.meta.last_row_id as number;
  }
  // Fan the edge read out to the analytics lakehouse (best-effort; no-op until
  // the ANALYTICS pipeline is provisioned). Edge reads are unattended → userId null.
  emitAnalytics(c, c.env.ANALYTICS, [alprReadEvent(
    {
      captureRowId: null, callId: null, incidentId: null,
      lat: num(rec.lat), lng: num(rec.lng), locationText: rec.location_text ?? null,
      userId: null, source: 'edge',
    },
    {
      plate: rec.plate ?? null, canonical_plate: canonical, state: rec.state ?? null,
      make: rec.make ?? null, model: rec.model ?? null, year: rec.year ?? null,
      color: rec.color ?? null, vehicle_type: rec.type ?? null,
      trust_score: trust.trustScore, vehicle_record_id: screen.vehicleId ?? null, hits,
    },
    new Date().toISOString(),
  )]);

  return c.json({ success: true, canonical_plate: canonical, trust_score: trust.trustScore,
                  trust_basis: trust.basis, photo_row_id: photoRowId,
                  sighting_id: sightingId, hits,
                  alerted: critical.length > 0 });
});

// ── Model registry: trained-adapter provenance per ALPR target ───────────────
const MODEL_REGISTRY_DDL = `CREATE TABLE IF NOT EXISTS model_registry (
  target TEXT PRIMARY KEY,
  adapter_version TEXT,
  base_model TEXT,
  holdout_metric REAL,
  beats_baseline INTEGER DEFAULT 0,
  promoted_at TEXT,
  notes TEXT
)`;

alpr.get('/models', operational, async (c) => {
  const db = getDb(c.env);
  await execute(db, MODEL_REGISTRY_DDL);
  const models = await query(db, `SELECT * FROM model_registry ORDER BY target LIMIT 200`);
  return c.json({ models });
});

alpr.put('/models/:target', operational, async (c) => {
  const db = getDb(c.env);
  const target = c.req.param('target');
  let b: Record<string, unknown>;
  try { b = await c.req.json() as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  await execute(db, MODEL_REGISTRY_DDL);
  await execute(db,
    `INSERT INTO model_registry (target, adapter_version, base_model, holdout_metric, beats_baseline, promoted_at, notes)
     VALUES (?,?,?,?,?,datetime('now'),?)
     ON CONFLICT(target) DO UPDATE SET adapter_version=excluded.adapter_version, base_model=excluded.base_model,
       holdout_metric=excluded.holdout_metric, beats_baseline=excluded.beats_baseline, promoted_at=excluded.promoted_at, notes=excluded.notes`,
    target,
    b.adapter_version ?? null,
    b.base_model ?? null,
    b.holdout_metric ?? null,
    b.beats_baseline ? 1 : 0,
    b.notes ?? null);
  return c.json({ success: true });
});

// ── helpers ──────────────────────────────────────────────────
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}
/** Call-attached originals are served via the field_photos route (matching
 *  prefix); everything else via this route's /image/*. */
function imageUrlFor(key: string | null): string | null {
  if (!key) return null;
  if (key.startsWith(FIELD_PHOTO_PREFIX)) return `/api/field-photos/file/${key}`;
  return `/api/alpr/image/${key}`;
}
/** Shape a DB row for the client: parse JSON columns, add image urls. */
function shapeCapture(row: any) {
  let raw: any = null, outputKeys: any = null, recordIds: any = null;
  try { raw = row.raw_json ? JSON.parse(row.raw_json) : null; } catch { /* keep null */ }
  try { outputKeys = row.output_keys ? JSON.parse(row.output_keys) : null; } catch { /* keep null */ }
  try { recordIds = row.vehicle_record_ids ? JSON.parse(row.vehicle_record_ids) : null; } catch { /* keep null */ }
  const toBool = (x: any) => (x == null ? null : x === 1 || x === true);
  // Prefer the vehicle whose plate matches the capture (the primary), so the
  // capture-level damage isn't taken from an arbitrary secondary vehicle.
  const rawVehicles = Array.isArray(raw?.vehicles) ? raw.vehicles : [];
  const primaryRaw = rawVehicles.find((v: any) => v && v.plate && v.plate === row.plate) ?? rawVehicles[0] ?? null;
  // Capture source for gallery filtering/badges.
  const captureId: string = typeof row.capture_id === 'string' ? row.capture_id : '';
  const source = raw?.source
    || (captureId.startsWith('cpg_dashcam:') ? 'dashcam'
      : (row.call_id != null || row.field_photo_id != null) ? 'field'
      : 'manual');
  // Detection geometry for the overlay (Roboflow path); empty for plate-only reads.
  const detections = Array.isArray(raw?.detections) ? raw.detections
    : Array.isArray(raw?.predictions) ? raw.predictions : [];
  return {
    ...row,
    source,
    engine: raw?.engine ?? null,
    event_type: raw?.eventType ?? null,
    device_name: raw?.deviceName ?? null,
    detections,
    alerted: row.alerted === 1 || row.alerted === true,
    enrich_status: row.enrich_status ?? null,
    // Advanced scanner: condition/damage + the 0.85 acceptance gate.
    accepted: toBool(row.accepted),
    plate_confidence: row.plate_confidence ?? null,
    condition: row.condition ?? null,
    damage_observed: toBool(row.damage_observed),
    damage_summary: row.damage_summary ?? null,
    damage_areas: Array.isArray(primaryRaw?.damageAreas) ? primaryRaw.damageAreas : [],
    raw,
    output_keys: outputKeys,
    vehicle_record_ids: recordIds,
    // Normalized views so the client enrich re-fetch can refresh either shape.
    capture: {
      plate: row.plate ?? null, state: row.state ?? null, make: row.make ?? null,
      model: row.model ?? null, color: row.color ?? null, year: row.year ?? null,
      vehicleType: row.vehicle_type ?? null, confidence: row.confidence ?? null,
      riskScore: row.risk_score ?? null, reviewStatus: row.review_status ?? null,
      alerted: row.alerted === 1 || row.alerted === true,
      condition: row.condition ?? null, damageObserved: toBool(row.damage_observed),
      damageSummary: row.damage_summary ?? null, accepted: toBool(row.accepted),
      plateConfidence: row.plate_confidence ?? null,
    },
    vehicles: Array.isArray(raw?.vehicles)
      ? raw.vehicles.map((v: any) => ({
          plate: v.plate ?? null, state: v.state ?? null, make: v.make ?? null, model: v.model ?? null,
          color: v.color ?? null, year: v.year ?? null, vehicle_type: v.vehicleType ?? v.vehicle_type ?? null,
          confidence: v.confidence ?? null,
          condition: v.condition ?? null, damage_observed: v.damageObserved ?? null,
          damage_summary: v.damageSummary ?? null,
          damage_areas: Array.isArray(v.damageAreas) ? v.damageAreas : [],
          aftermarket: v.aftermarket ?? null, confidences: v.confidences ?? {},
        }))
      : [],
    image_url: imageUrlFor(row.image_key),
    annotated_image_url: imageUrlFor(row.annotated_image_key),
    // Trust fields from the most-recent vehicle_capture_photos package (may be
    // null when no package exists yet — client renders UNVERIFIED badge).
    trust_score: row.pkg_trust_score ?? null,
    trust_basis: row.pkg_trust_basis ?? null,
    read_count: row.pkg_read_count ?? null,
    canonical_plate: row.pkg_canonical_plate ?? null,
  };
}

export default alpr;
