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
import { requireRole } from '../middleware/auth';
import { screenVehicle } from '../utils/intelScreen';
import {
  ALPR_ACCEPT_CONFIDENCE,
  type AlprParameters,
  type AlprVehicle,
} from '../utils/roboflowAlpr';
import { readPlateCloudflare, type CloudflarePlateResult } from '../utils/cloudflarePlate';

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
 *  runtime, so the route self-heals if migration 0108/0109 never reached D1. */
async function ensureAlprSchema(db: ReturnType<typeof getDb>) {
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
  for (const [name, type] of ALPR_EXTRA_COLUMNS) {
    if (!(await columnExists(db, 'alpr_captures', name))) {
      try { await execute(db, `ALTER TABLE alpr_captures ADD COLUMN ${name} ${type}`); }
      catch { /* lost a race or already present — fine */ }
    }
  }
  // vehicle_sightings is owned by migration 0100 — never CREATE it here, only
  // reconcile the structured-damage columns the enrich/accept paths write.
  for (const [name, type] of SIGHTING_EXTRA_COLUMNS) {
    try {
      if (!(await columnExists(db, 'vehicle_sightings', name))) {
        await execute(db, `ALTER TABLE vehicle_sightings ADD COLUMN ${name} ${type}`);
      }
    } catch { /* table absent or lost a race — fine, best-effort */ }
  }
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
): Promise<{ id: number; created: boolean } | null> {
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
    } catch (err: any) { console.error('[alpr] vehicle enrich failed:', err?.message); }
    return { id: existingId, created: false };
  }
  const r = await execute(db,
    `INSERT INTO vehicles_records (plate_number, state, make, model, year, color, body_style, plate_type, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    v.plate, v.state, v.make, v.model, v.year, v.color, v.vehicleType, v.plateType, 'Created from ALPR capture');
  return { id: Number(r.meta.last_row_id), created: true };
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
    lat: number | null; lng: number | null; locationText: string | null; userId: number;
  },
): Promise<FinalizeResult> {
  const read = args.read;
  const out: FinalizeResult = {
    hits: [], vehicles: [], recordIds: [], sightingId: null,
    accepted: false, plateConf: read?.confidence ?? null,
  };
  const plate = read?.plate ?? null;
  const TH = acceptThreshold(env);
  const accepted = !!plate && (out.plateConf ?? 0) >= TH;
  out.accepted = accepted;

  try {
    if (!plate || !read) {
      await execute(db, `UPDATE alpr_captures SET enrich_status='done', accepted=0, review_status='no_plate', vehicle_count=0 WHERE id=?`, args.captureRowId);
      return out;
    }

    const screen = await screenVehicle(db, { plate });
    out.hits.push(...screen.hits);
    const critical = screen.hits.filter((h) => h.severity === 'critical');
    if (critical.length) {
      try {
        await execute(db,
          `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
           VALUES ('intel_screen', 'high', ?, ?, 'vehicle', ?, ?, 0, datetime('now'))`,
          `${accepted ? '' : 'UNCONFIRMED — verify plate: '}PLATE HIT: ${plate}`,
          critical.map((h) => h.detail).join('; '), screen.vehicleId, args.userId);
      } catch (err: any) { console.error('[alpr] notify failed:', err?.message); }
    }

    let recordId: number | null = null;
    if (accepted) {
      const up = await upsertVehicleRecord(db, cfReadToVehicle(read), screen.vehicleId);
      recordId = up?.id ?? screen.vehicleId ?? null;
      if (recordId) out.recordIds.push(recordId);
      if (recordId && args.callId != null) {
        try {
          await execute(db,
            `INSERT OR IGNORE INTO call_vehicles (call_id, vehicle_id, role, notes, added_by, added_at)
             VALUES (?, ?, 'observed', 'ALPR', ?, datetime('now'))`, args.callId, recordId, args.userId);
        } catch (err: any) { console.error('[alpr] link failed:', err?.message); }
      }
      try {
        const base = `ALPR: ${[read.color, read.make, read.model, read.year].filter(Boolean).join(' ')}`.trim();
        const note = base === 'ALPR:' ? 'ALPR capture (Workers AI)' : base;
        const sres = await execute(db,
          `INSERT INTO vehicle_sightings (plate, state, vehicle_id, location_text, lat, lng, notes, sighted_by, confidence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          plate, read.state, recordId, args.locationText, args.lat, args.lng, note, args.userId, out.plateConf);
        out.sightingId = Number(sres.meta.last_row_id);
      } catch (err: any) { console.error('[alpr] sighting failed:', err?.message); }
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
      `UPDATE alpr_captures SET make=?, model=?, color=?, year=?, state=?, vehicle_type=?,
         plate_confidence=?, accepted=?, review_status=?, sighting_id=?, vehicle_record_ids=?,
         vehicle_count=1, enrich_status='done' WHERE id=?`,
      accepted ? read.make : null, accepted ? read.model : null, accepted ? read.color : null,
      accepted ? read.year : null, read.state, accepted ? read.bodyStyle : null,
      out.plateConf, accepted ? 1 : 0, accepted ? 'accepted' : 'needs_review',
      out.sightingId, JSON.stringify(out.recordIds), args.captureRowId);
  } catch (err: any) {
    console.error('[alpr] finalize failed:', err?.message);
    try { await execute(db, `UPDATE alpr_captures SET enrich_status='failed', accepted=0, review_status='needs_review' WHERE id=?`, args.captureRowId); } catch { /* */ }
  }
  return out;
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
  const userId = c.get('userId') as number;

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

  await ensureAlprSchema(db);

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
  await c.env.UPLOADS.put(imageKey, bytes, { httpMetadata: { contentType } });

  // Attach the photo to the call/incident via field_photos (best-effort).
  let fieldPhotoId: number | null = null;
  if (attachToCall) {
    try {
      const fp = await execute(db,
        `INSERT INTO field_photos (officer_id, call_id, incident_id, r2_key, content_type, size_bytes, latitude, longitude, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId, callId, incidentId, imageKey, contentType, bytes.length, lat, lng, 'ALPR capture');
      fieldPhotoId = Number(fp.meta.last_row_id);
    } catch (err: any) { console.error('[alpr] field_photos insert failed:', err?.message); }
  }

  // ── Read the plate on Cloudflare Workers AI (free — no Roboflow credits) ──
  // One vision call returns plate + state + make/model/color + confidence, so the
  // old two-stage fast→enrich collapses into a single read. The photo is already
  // saved above, so a read failure never loses the capture.
  let read: CloudflarePlateResult | null = null;
  try {
    read = await readPlateCloudflare(c.env, bytes, contentType);
  } catch (err) {
    console.error('[alpr] workers-ai read failed:', (err as Error)?.message);
  }
  const plate = read?.plate ?? null;

  // Capture row (plate known). finalizeCapture then screens + applies the 0.85
  // gate + creates records, and stamps the row 'done'.
  const ins = await execute(db,
    `INSERT INTO alpr_captures
       (sighting_id, capture_id, case_id, plate, state, confidence, plate_confidence,
        review_status, image_key, raw_json, lat, lng, location_text, captured_by,
        call_id, incident_id, field_photo_id, vehicle_count, vehicle_record_ids, enrich_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    null, captureId, strOrNull(params.case_id), plate, read?.state ?? null,
    read?.confidence ?? null, read?.confidence ?? null, 'pending', imageKey,
    JSON.stringify({ engine: read?.model_id ?? 'workers-ai', plate, read }),
    lat, lng, locationText, userId,
    callId, incidentId, fieldPhotoId, plate ? 1 : 0, JSON.stringify([]));
  const captureRowId = Number(ins.meta.last_row_id);

  const fin = await finalizeCapture(c.env, db, {
    captureRowId, read, callId, incidentId, lat, lng, locationText, userId,
  });

  const hits = Array.from(new Map(fin.hits.map((h) => [h.detail, h])).values());
  return c.json({
    success: true,
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
      if (plate) { where.push('plate LIKE ?'); params.push(`%${plate}%`); }
      if (accepted === '1' || accepted === '0') { where.push('accepted = ?'); params.push(Number(accepted)); }
      if (from) { where.push('created_at >= ?'); params.push(from); }
      if (to) { where.push('created_at <= ?'); params.push(to); }
      if (gallery) where.push("(image_key IS NOT NULL OR annotated_image_key IS NOT NULL)");
      // source: dashcam captures carry a 'cpg_dashcam:' capture_id; field captures
      // are call/field-photo linked; manual = everything else.
      if (source === 'dashcam') where.push("capture_id LIKE 'cpg_dashcam:%'");
      else if (source === 'field') where.push("(call_id IS NOT NULL OR field_photo_id IS NOT NULL) AND COALESCE(capture_id,'') NOT LIKE 'cpg_dashcam:%'");
      else if (source === 'manual') where.push("call_id IS NULL AND field_photo_id IS NULL AND COALESCE(capture_id,'') NOT LIKE 'cpg_dashcam:%'");
      const sql = `SELECT * FROM alpr_captures ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);
      rows = await query<any>(db, sql, ...params);
    }
    return c.json(rows.map(shapeCapture));
  } catch (err: any) {
    return c.json({ error: err?.message, hint: 'migration 0108/0109 may not have reached live D1' }, 500);
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
    } catch (err: any) { console.error('[alpr] accept relink failed:', err?.message); }
  }

  await execute(db,
    `UPDATE alpr_captures SET accepted=1, review_status='confirmed', plate=COALESCE(?, plate),
       reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`,
    corrected, userId, id);
  const updated = await queryFirst<any>(db, 'SELECT * FROM alpr_captures WHERE id = ?', id);
  return c.json({ success: true, hits, ...shapeCapture(updated) });
});

// ── Review queue: reject a held capture (kept for audit) ─────
alpr.post('/capture/:id/reject', operational, async (c) => {
  const db = getDb(c.env);
  await ensureAlprSchema(db);
  const id = Number(c.req.param('id'));
  const userId = Number(c.var.user?.id ?? 0);
  const row = await queryFirst<any>(db, 'SELECT id FROM alpr_captures WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  await execute(db,
    `UPDATE alpr_captures SET accepted=0, review_status='rejected', reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`,
    userId, id);
  return c.json({ success: true });
});

// ── Stream a stored image back from R2 (prefix-validated) ────
alpr.get('/image/*', operational, async (c) => {
  const key = c.req.path.replace(/^.*\/image\//, '');
  if (!key.startsWith(ALPR_PREFIX) || key.includes('..')) return c.json({ error: 'Invalid key' }, 400);
  const obj = await c.env.UPLOADS.get(key);
  if (!obj) return c.json({ error: 'Not found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
    },
  });
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
  };
}

export default alpr;
