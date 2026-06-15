// ============================================================
// RMPG Flex — FlexCam footage-chunk ALPR
// ============================================================
// Runs the SAME plate-ALPR the event-clip path runs, but on a downloaded
// footage *chunk* sitting in R2 (env.UPLOADS) instead of a ClearPath media
// event's still image. Called best-effort by the capture orchestrator's
// poll/download loop for every downloaded outside-channel chunk; the caller
// wraps this in try/catch and stamps alpr_status itself.
//
// What it reuses from the event path (src/utils/clearpathAlpr.ts +
// src/routes/alpr.ts):
//   • runAlprVehicleCapture()  — the Roboflow "ALPR Vehicle Details Capture"
//     pipeline (the task's required engine here), parsing EVERY vehicle in the
//     frame via parseVehicles / ParsedAlpr.vehicles[].
//   • The exact plate-log persistence the event path uses, per vehicle:
//       1. screenVehicle(db, {plate})           → stolen / watchlist / owner-warrant
//       2. upsert vehicles_records by plate      → master record (enrich blanks)
//       3. INSERT vehicle_sightings              → feeds /intel/plate-log
//       4. INSERT notifications on a critical hit → officer-safety alert
//     This mirrors finalizeCapture() in alpr.ts (same tables, same 0.85 gate)
//     so a footage-derived sighting is indistinguishable from an on-scene one.
//
// What is NOT reused, and why:
//   • alprDashcamClip() is tightly bound to a dashcam_videos row (its markVideo
//     closure UPDATEs dashcam_videos.alpr_status) and to a live CpgMediaEvent
//     (pickAlprImageUrl/eventLatLng read event.mediaObject/address). A footage
//     chunk has neither — only an mp4 R2 key + deviceId — so calling it would
//     be wrong. We extract its persistence *shape* here instead of its body.
//   • It also reads a still IMAGE off the event; we deliberately use Roboflow
//     per the task, attributed to the device (no GPS/address available on a
//     chunk — left null, same as a sighting with no fix).
//
// ⚠️ DEFERRED (precise): a footage chunk is an mp4 VIDEO; runAlprVehicleCapture
// (like Workers-AI vision) expects a still IMAGE, and a Worker cannot decode a
// video frame (no ffmpeg/canvas). We send the chunk's bytes as a base64 image
// input: if the Roboflow workflow's own preprocessing can pull a frame it reads
// plates; if not, the parse simply yields 0 vehicles and this no-ops cleanly
// (best-effort — never throws). Per-frame extraction at sync time (e.g. an edge
// worker emitting JPEG keyframes, then ALPR'ing those) is the real fix and is
// left to a later task; wiring it here would be a guess about the frame source.
// ============================================================

import type { Bindings } from '../../types';
import { queryFirst, execute, columnExists } from '../db';
import { screenVehicle } from '../intelScreen';
import {
  runAlprVehicleCapture,
  ALPR_ACCEPT_CONFIDENCE,
  type AlprVehicle,
} from '../roboflowAlpr';
import { trustScore } from '../plateTrust';

type DB = D1Database;

const ROBOFLOW_TIMEOUT_MS = 60_000; // a chunk is larger than an on-scene still
// Roboflow rejects non-image payloads over a ceiling; skip obviously-too-big
// objects rather than burning a credit on a guaranteed failure.
const MAX_ALPR_BYTES = 8 * 1024 * 1024;

/** Base64-encode bytes without blowing the stack on large buffers. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Structured per-observation columns on vehicle_sightings added by migration
// 0115 (confidence + condition/damage). The cron-driven footage path never
// hits the on-scene route's ensureAlprSchema(), so reconcile the columns the
// sighting INSERT below depends on here too — otherwise, if 0115 never reached
// live D1 (deploy migration-apply is continue-on-error), the INSERT throws and
// is swallowed, silently dropping every footage-derived plate sighting.
// vehicle_sightings itself is owned by migration 0100 — never CREATE it here,
// only ADD the missing columns. Best-effort + idempotent (mirrors alpr.ts).
const SIGHTING_EXTRA_COLUMNS: Array<[string, string]> = [
  ['confidence', 'REAL'],
  ['condition', 'TEXT'], ['damage_observed', 'INTEGER'], ['damage_summary', 'TEXT'],
];

async function ensureSightingColumns(db: DB): Promise<void> {
  for (const [name, type] of SIGHTING_EXTRA_COLUMNS) {
    try {
      if (!(await columnExists(db, 'vehicle_sightings', name))) {
        await execute(db, `ALTER TABLE vehicle_sightings ADD COLUMN ${name} ${type}`);
      }
    } catch { /* table absent or lost a race — fine, best-effort */ }
  }
}

/** Upsert a vehicles_records row by plate (enrich blanks; create if new).
 *  Mirrors upsertVehicleRecord in routes/alpr.ts. Null for a plate-less read. */
async function upsertVehicleByPlate(db: DB, v: AlprVehicle): Promise<number | null> {
  if (!v.plate || v.plate.length < 2) return null;
  try {
    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM vehicles_records WHERE UPPER(plate_number) = ? LIMIT 1', v.plate.toUpperCase());
    if (existing) {
      await execute(db, `UPDATE vehicles_records SET
          make = COALESCE(NULLIF(make,''), ?), model = COALESCE(NULLIF(model,''), ?),
          color = COALESCE(NULLIF(color,''), ?), year = COALESCE(year, ?),
          state = COALESCE(NULLIF(state,''), ?), body_style = COALESCE(NULLIF(body_style,''), ?),
          plate_type = COALESCE(NULLIF(plate_type,''), ?), updated_at = datetime('now')
        WHERE id = ?`,
        v.make, v.model, v.color, v.year, v.state, v.vehicleType, v.plateType, existing.id);
      return existing.id;
    }
    const r = await execute(db,
      `INSERT INTO vehicles_records (plate_number, state, make, model, year, color, body_style, plate_type, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Observed via FlexCam footage ALPR (Roboflow)', datetime('now'))`,
      v.plate, v.state, v.make, v.model, v.year, v.color, v.vehicleType, v.plateType);
    return Number(r.meta.last_row_id);
  } catch (err) { console.error('[flexcam-alpr] vehicle upsert failed:', (err as Error)?.message); return null; }
}

/** Derive honest trust for one footage read. A footage chunk yields a single
 *  Roboflow read per vehicle, so trustScore hard-caps it below the accept gate
 *  (no corroboration). Never gate/store the raw model self-report. */
export function deriveFootageTrust(
  plate: string | null,
  modelPct: number | null | undefined,
): { trustScore: number; accepted: boolean } {
  const t = trustScore({ reads: plate ? [plate] : [], modelPct: modelPct ?? undefined });
  return { trustScore: t.trustScore, accepted: !!plate && t.trustScore >= ALPR_ACCEPT_CONFIDENCE }; // 0.85 gate baked in
}

/** Persist one detected vehicle the same way the event path does: screen
 *  (always — officer safety), upsert the master record on an accepted (≥0.85)
 *  read, and always log a sighting. Best-effort per step. */
async function persistVehicle(
  db: DB, v: AlprVehicle, deviceId: string | null, locationText: string,
): Promise<void> {
  const plate = v.plate;
  if (!plate) return;
  const { trustScore: derivedTrust, accepted } = deriveFootageTrust(plate, v.confidence);

  // Upsert the authoritative record only on an accepted read (same gate as the
  // on-scene scanner); a held read still logs a sighting + screens.
  let vehicleId: number | null = null;
  if (accepted) vehicleId = await upsertVehicleByPlate(db, v);

  // Always log a sighting (feeds /intel/plate-log). No GPS on a chunk → null.
  try {
    await execute(db,
      // sighted_by=0 = automated FlexCam ingest (column is NOT NULL)
      `INSERT INTO vehicle_sightings (plate, state, vehicle_id, location_text, lat, lng, notes, sighted_by, confidence)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, 0, ?)`,
      plate, v.state, vehicleId, locationText,
      `FlexCam footage ${deviceId ?? ''}`.trim() + (accepted ? '' : ' (unconfirmed <0.85)'),
      derivedTrust);
  } catch (err) { console.error('[flexcam-alpr] sighting insert failed:', (err as Error)?.message); }

  // Always screen (officer safety) — critical hits raise a notification.
  try {
    const screen = await screenVehicle(db, vehicleId ? { vehicleId } : { plate });
    const critical = screen.hits.filter((h) => h.severity === 'critical');
    if (critical.length) {
      await execute(db,
        `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
         VALUES ('intel_screen', 'high', ?, ?, 'vehicle', ?, NULL, 0, datetime('now'))`,
        `${accepted ? '' : 'UNCONFIRMED — verify plate: '}FLEXCAM PLATE HIT: ${plate}`,
        critical.map((h) => h.detail).join('; '), screen.vehicleId ?? vehicleId);
    }
  } catch (err) { console.error('[flexcam-alpr] screen failed:', (err as Error)?.message); }
}

/**
 * Run ALPR on a downloaded footage chunk's R2 object and persist every detected
 * vehicle's plate to the intel plate-log. Best-effort: never throws (the caller
 * stamps alpr_status). No-op (silent) when Roboflow isn't configured or the
 * object can't be read.
 */
export async function alprFootageChunk(
  env: Bindings, db: DB, chunkId: number, r2Key: string, deviceId: string | null,
): Promise<void> {
  const apiKey = env.ROBOFLOW_API_KEY;
  if (!apiKey) return; // Roboflow not configured — silent no-op (Workers-AI path is the event-clip default)

  // Pull the chunk object from R2. (Unlike the event still, this is the mp4 —
  // see the deferred-frame note in the header.)
  const obj = await env.UPLOADS.get(r2Key).catch(() => null);
  if (!obj) { console.warn('[flexcam-alpr] R2 object missing:', r2Key); return; }

  // A footage chunk is an mp4 VIDEO (content_type set to 'video/mp4' by the
  // capture orchestrator). runAlprVehicleCapture expects a still IMAGE, and a
  // Worker can't decode a video frame — so for a video/* object the Roboflow
  // run is guaranteed to read 0 vehicles while still burning a credit and up to
  // a 60s timeout per chunk. Skip the round-trip until a keyframe (image/jpeg)
  // source is wired; the persistence machinery below lights up automatically
  // once an image-typed chunk arrives. (See the deferred-frame note in header.)
  const contentType = obj.httpMetadata?.contentType ?? '';
  if (contentType && !contentType.startsWith('image/')) {
    console.info('[flexcam-alpr] footage ALPR inert for non-image chunk (pending keyframe extraction):', r2Key, contentType);
    return;
  }

  const bytes = new Uint8Array(await obj.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_ALPR_BYTES) {
    if (bytes.length > MAX_ALPR_BYTES) console.warn('[flexcam-alpr] chunk too large for ALPR, skipping:', r2Key, bytes.length);
    return;
  }

  let vehicles: AlprVehicle[] = [];
  try {
    const result = await runAlprVehicleCapture({
      image: { type: 'base64', value: toBase64(bytes) },
      // disable_rmpgutah_api: string-typed param — the workflow shouldn't POST
      // back to us; we persist here. capture_id keys the run to this chunk.
      parameters: { disable_rmpgutah_api: 'true', capture_id: `flexcam_chunk:${chunkId}` },
      apiKey,
      apiUrl: env.ROBOFLOW_API_URL,
      timeoutMs: ROBOFLOW_TIMEOUT_MS,
    });
    vehicles = result.vehicles;
  } catch (err) {
    // Typed RoboflowError subclasses (config/timeout/http/quota). Best-effort:
    // log and bail; the caller already wrapped this in try/catch.
    console.error('[flexcam-alpr] roboflow run failed:', (err as Error)?.message);
    return;
  }

  if (!vehicles.length) return; // no plate read from the chunk — nothing to log
  // NOTE: Phase 1 intentionally does not write an alpr_captures row for footage chunks (plates still land in vehicle_sightings / plate-log). Revisit if footage plates need to surface in the ALPR captures UI.

  // Reconcile the vehicle_sightings columns the persist path writes (migration
  // 0115's confidence + damage cols) before any INSERT — the cron path never
  // calls the on-scene route's ensureAlprSchema(), so this self-heals live D1
  // if 0115 never landed (otherwise the sighting INSERT silently throws). Done
  // once here, after we know there's at least one plate to persist.
  await ensureSightingColumns(db);

  const locationText = `FlexCam ${deviceId ?? ''}`.trim() || 'FlexCam footage';
  for (const v of vehicles) {
    await persistVehicle(db, v, deviceId, locationText);
  }
}
