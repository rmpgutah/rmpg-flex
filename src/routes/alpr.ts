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
import { bytesToBase64 } from '../utils/anthropic';
import {
  runAlprVehicleCapture,
  RoboflowConfigError,
  RoboflowTimeoutError,
  RoboflowHttpError,
  type AlprParameters,
  type AlprImageOutput,
  type AlprVehicle,
} from '../utils/roboflowAlpr';
import { runPlateFast } from '../utils/roboflowPlateFast';

const alpr = new Hono<Env>();

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

/** Background enrichment: run the full attribute workflow on the stored image.
 *  The PRIMARY plate was already record/linked/sighted/screened/notified in the
 *  fast path — here we only fill its attributes. SECONDARY vehicles (additional
 *  plates the heavy workflow finds) get the FULL treatment so a multi-vehicle
 *  frame is never under-screened (a stolen second plate must still alert). Best
 *  effort — sets enrich_status to 'done' or 'failed', never throws. */
async function enrichCapture(
  env: Env['Bindings'],
  args: {
    captureRowId: number; imageKey: string; params: AlprParameters;
    primaryPlate: string | null; callId: number | null; incidentId: number | null;
    lat: number | null; lng: number | null; locationText: string | null; userId: number;
  },
): Promise<void> {
  const db = getDb(env);
  try {
    const obj = await env.UPLOADS.get(args.imageKey);
    if (!obj) throw new Error(`enrich: image ${args.imageKey} missing from R2`);
    const bytes = new Uint8Array(await obj.arrayBuffer());

    const result = await runAlprVehicleCapture({
      apiKey: env.ROBOFLOW_API_KEY!,
      apiUrl: env.ROBOFLOW_API_URL,
      image: { type: 'base64', value: bytesToBase64(bytes) },
      parameters: args.params,
    });

    for (const v of result.vehicles) {
      if (!v.plate || v.plate.length < 2) continue;
      const screen = await screenVehicle(db, { plate: v.plate });
      const up = await upsertVehicleRecord(db, v, screen.vehicleId);  // enriches blank fields
      const recordId = up?.id ?? screen.vehicleId ?? null;

      // Primary plate already fully handled in the fast path — attributes only.
      if (args.primaryPlate && v.plate === args.primaryPlate) continue;

      // Secondary vehicle: full link + sighting + screening + notify.
      if (recordId && args.callId != null) {
        try {
          await execute(db,
            `INSERT OR IGNORE INTO call_vehicles (call_id, vehicle_id, role, notes, added_by, added_at)
             VALUES (?, ?, 'observed', 'ALPR', ?, datetime('now'))`, args.callId, recordId, args.userId);
        } catch (err: any) { console.error('[alpr] enrich link failed:', err?.message); }
      }
      try {
        const note = `ALPR: ${[v.color, v.make, v.model, v.year].filter(Boolean).join(' ')}`.trim();
        await execute(db,
          `INSERT INTO vehicle_sightings (plate, state, vehicle_id, location_text, lat, lng, notes, sighted_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          v.plate, v.state, recordId, args.locationText, args.lat, args.lng,
          note === 'ALPR:' ? 'ALPR capture' : note, args.userId);
      } catch (err: any) { console.error('[alpr] enrich sighting failed:', err?.message); }
      const critical = screen.hits.filter((h) => h.severity === 'critical');
      if (critical.length) {
        try {
          await execute(db,
            `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
             VALUES ('intel_screen', 'high', ?, ?, 'vehicle', ?, ?, 0, datetime('now'))`,
            `PLATE HIT: ${v.plate}`, critical.map((h) => h.detail).join('; '), recordId, args.userId);
        } catch (err: any) { console.error('[alpr] enrich notify failed:', err?.message); }
      }
    }

    // Persist any annotated image (first image output).
    let annotatedKey: string | null = null;
    const annotated: AlprImageOutput | undefined = result.images[0];
    if (annotated) {
      annotatedKey = `${ALPR_PREFIX}${crypto.randomUUID()}-annot.${annotated.ext}`;
      await env.UPLOADS.put(annotatedKey, Uint8Array.from(atob(annotated.base64), (ch) => ch.charCodeAt(0)),
        { httpMetadata: { contentType: annotated.mimeType } });
    }

    const cap = result.capture;
    const rawJson = JSON.stringify({
      capture: cap, vehicles: result.vehicles, detections: result.detections,
      vehicle_details: result.records.vehicle_details ?? null,
      enhanced_alpr_record: result.records.enhanced_alpr_record ?? null,
    });
    await execute(db,
      `UPDATE alpr_captures SET make=COALESCE(NULLIF(make,''),?), model=COALESCE(NULLIF(model,''),?),
         color=COALESCE(NULLIF(color,''),?), year=COALESCE(year,?), state=COALESCE(NULLIF(state,''),?),
         vehicle_type=COALESCE(NULLIF(vehicle_type,''),?), risk_score=COALESCE(risk_score,?),
         review_status=COALESCE(NULLIF(review_status,''),?), raw_json=?,
         annotated_image_key=COALESCE(annotated_image_key,?), vehicle_count=?, enrich_status='done'
       WHERE id=?`,
      cap.make, cap.model, cap.color, cap.year, cap.state, cap.vehicleType, cap.riskScore,
      cap.reviewStatus, rawJson, annotatedKey, result.vehicles.length, args.captureRowId);
  } catch (err: any) {
    console.error('[alpr] enrich failed:', err?.message);
    try { await execute(db, `UPDATE alpr_captures SET enrich_status='failed' WHERE id=?`, args.captureRowId); }
    catch { /* swallow — background path */ }
  }
}

// ── Health: is the integration configured? ───────────────────
alpr.get('/health', operational, (c) => {
  return c.json({
    ok: true,
    configured: !!c.env.ROBOFLOW_API_KEY,
    workspace: 'rmpg-utah',
    workflow: 'alpr-vehicle-details-capture-1781360579827',
  });
});

// ── Capture: image → workflow → attach to call → vehicles ────
alpr.post('/capture', operational, async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;

  if (!c.env.ROBOFLOW_API_KEY) {
    return c.json({ error: 'ALPR not configured', hint: 'Set ROBOFLOW_API_KEY (wrangler secret put ROBOFLOW_API_KEY).' }, 503);
  }

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

  // ── FAST PATH: plate-only read (~1s) ──
  let fast;
  try {
    fast = await runPlateFast({
      apiKey: c.env.ROBOFLOW_API_KEY,
      apiUrl: c.env.ROBOFLOW_API_URL,
      workflowId: c.env.ROBOFLOW_FAST_WORKFLOW_ID,
      image: { type: 'base64', value: bytesToBase64(bytes) },
    });
  } catch (err) {
    if (err instanceof RoboflowConfigError) return c.json({ error: err.message }, 400);
    if (err instanceof RoboflowTimeoutError) return c.json({ error: err.message }, 504);
    if (err instanceof RoboflowHttpError) return c.json({ error: err.message, status: err.status }, 502);
    return c.json({ error: 'ALPR fast scan failed', detail: (err as Error)?.message }, 502);
  }

  // Screen + create/link the plate record now (safety-critical stays in the fast path).
  const vehicleResults: Array<Record<string, unknown>> = [];
  const allHits: Array<{ kind: string; severity: string; detail: string }> = [];
  const vehicleRecordIds: number[] = [];
  let firstSightingId: number | null = null;

  if (fast.plate) {
    const v: AlprVehicle = { plate: fast.plate, state: fast.state, make: null, model: null,
      color: null, year: null, vehicleType: null, plateType: null, confidence: null };
    const screen = await screenVehicle(db, { plate: fast.plate });
    const up = await upsertVehicleRecord(db, v, screen.vehicleId);
    const recordId = up?.id ?? screen.vehicleId ?? null;
    if (recordId) vehicleRecordIds.push(recordId);

    if (recordId && callId != null) {
      try {
        await execute(db,
          `INSERT OR IGNORE INTO call_vehicles (call_id, vehicle_id, role, notes, added_by, added_at)
           VALUES (?, ?, 'observed', 'ALPR', ?, datetime('now'))`, callId, recordId, userId);
      } catch (err: any) { console.error('[alpr] call_vehicles link failed:', err?.message); }
    }

    try {
      const sr = await execute(db,
        `INSERT INTO vehicle_sightings (plate, state, vehicle_id, location_text, lat, lng, notes, sighted_by)
         VALUES (?, ?, ?, ?, ?, ?, 'ALPR capture', ?)`,
        v.plate, v.state, recordId, locationText, lat, lng, userId);
      firstSightingId = Number(sr.meta.last_row_id);
    } catch (err: any) { console.error('[alpr] sighting insert failed:', err?.message); }

    const critical = screen.hits.filter((h) => h.severity === 'critical');
    if (critical.length) {
      try {
        await execute(db,
          `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
           VALUES ('intel_screen', 'high', ?, ?, 'vehicle', ?, ?, 0, datetime('now'))`,
          `PLATE HIT: ${v.plate}`, critical.map((h) => h.detail).join('; '), recordId, userId);
      } catch (err: any) { console.error('[alpr] notify failed:', err?.message); }
    }

    allHits.push(...screen.hits);
    vehicleResults.push({ plate: v.plate, state: v.state, make: null, model: null, year: null,
      color: null, vehicle_type: null, confidence: null, vehicle_record_id: recordId,
      vehicle_record_created: up?.created ?? false, sighting_id: firstSightingId, hits: screen.hits });
  }

  // Capture row with enrich_status='pending'.
  const ins = await execute(db,
    `INSERT INTO alpr_captures
       (sighting_id, capture_id, case_id, plate, state, make, model, color, year, vehicle_type,
        confidence, risk_score, review_status, alerted, image_key, annotated_image_key,
        output_keys, raw_json, lat, lng, location_text, captured_by,
        call_id, incident_id, field_photo_id, vehicle_count, vehicle_record_ids, enrich_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    firstSightingId, captureId, strOrNull(params.case_id), fast.plate, fast.state, null, null, null,
    null, null, null, null, null, allHits.some((h) => h.severity === 'critical') ? 1 : 0, imageKey, null,
    JSON.stringify([]), JSON.stringify({ fast: true, plate: fast.plate, detections: fast.predictions }),
    lat, lng, locationText, userId,
    callId, incidentId, fieldPhotoId, fast.plate ? 1 : 0, JSON.stringify(vehicleRecordIds));
  const captureRowId = Number(ins.meta.last_row_id);

  // Schedule background enrichment (full attribute workflow) — never blocks the response.
  // Pass the primary plate so enrich only fills its attributes (already screened),
  // and the context so SECONDARY vehicles get full link/sighting/screen/notify.
  c.executionCtx.waitUntil(enrichCapture(c.env, {
    captureRowId, imageKey, params, primaryPlate: fast.plate,
    callId, incidentId, lat, lng, locationText, userId,
  }));

  const hits = Array.from(new Map(allHits.map((h) => [h.detail, h])).values());
  return c.json({
    success: true,
    id: captureRowId,
    call_id: callId,
    incident_id: incidentId,
    field_photo_id: fieldPhotoId,
    vehicle_count: fast.plate ? 1 : 0,
    vehicles: vehicleResults,
    capture: { plate: fast.plate, state: fast.state, make: null, model: null, color: null,
      year: null, vehicleType: null, confidence: null, riskScore: null, reviewStatus: null, alerted: false },
    detections: fast.predictions,
    enrich_status: 'pending',
    hits,
    image_url: imageUrlFor(imageKey),
    annotated_image_url: null,
  });
});

// ── List recent captures ─────────────────────────────────────
alpr.get('/captures', operational, async (c) => {
  const db = getDb(c.env);
  const plate = (c.req.query('plate') || '').toUpperCase().replace(/[\s-]/g, '');
  const caseId = c.req.query('case_id') || '';
  const callId = c.req.query('call_id') || '';
  const limit = Math.min(Number(c.req.query('limit')) || 25, 100);
  try {
    let rows;
    if (plate) rows = await query<any>(db, `SELECT * FROM alpr_captures WHERE plate LIKE ? ORDER BY created_at DESC LIMIT ?`, `%${plate}%`, limit);
    else if (callId) rows = await query<any>(db, `SELECT * FROM alpr_captures WHERE call_id = ? ORDER BY created_at DESC LIMIT ?`, Number(callId), limit);
    else if (caseId) rows = await query<any>(db, `SELECT * FROM alpr_captures WHERE case_id = ? ORDER BY created_at DESC LIMIT ?`, caseId, limit);
    else rows = await query<any>(db, `SELECT * FROM alpr_captures ORDER BY created_at DESC LIMIT ?`, limit);
    return c.json(rows.map(shapeCapture));
  } catch (err: any) {
    return c.json({ error: err?.message, hint: 'migration 0108/0109 may not have reached live D1' }, 500);
  }
});

// ── Single capture ───────────────────────────────────────────
alpr.get('/capture/:id', operational, async (c) => {
  const db = getDb(c.env);
  const row = await queryFirst<any>(db, 'SELECT * FROM alpr_captures WHERE id = ?', Number(c.req.param('id')));
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(shapeCapture(row));
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
  return {
    ...row,
    alerted: row.alerted === 1 || row.alerted === true,
    enrich_status: row.enrich_status ?? null,
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
    },
    vehicles: Array.isArray(raw?.vehicles)
      ? raw.vehicles.map((v: any) => ({
          plate: v.plate ?? null, state: v.state ?? null, make: v.make ?? null, model: v.model ?? null,
          color: v.color ?? null, year: v.year ?? null, vehicle_type: v.vehicleType ?? v.vehicle_type ?? null,
          confidence: v.confidence ?? null,
        }))
      : [],
    image_url: imageUrlFor(row.image_key),
    annotated_image_url: imageUrlFor(row.annotated_image_key),
  };
}

export default alpr;
