// ============================================================
// RMPG Flex — ClearPath dashcam ALPR (Phase C)
// ============================================================
// Runs the lean Roboflow plate workflow against the still image of an
// outside-camera dashcam event, then wires the read into the intel layer:
//   • always logs a vehicle_sightings row (feeds /intel/plate-log) with the
//     event's GPS + confidence,
//   • always screens the plate (stolen / watchlist) → critical-hit notification,
//   • upserts a vehicles_records master row when plate confidence ≥ 0.85
//     (the same acceptance gate as the manual advanced scanner), and links it.
//
// The dashcam still is a pre-signed https S3 URL, so Roboflow fetches it
// directly — we never pull the image (or the mp4) into the Worker.
// ============================================================

import type { Bindings } from '../types';
import { query, queryFirst, execute } from './db';
import { screenVehicle } from './intelScreen';
import { ALPR_ACCEPT_CONFIDENCE, type AlprDetection } from './roboflowAlpr';
import { runPlateFast } from './roboflowPlateFast';
import { type CpgMediaEvent, type CpgMediaObject } from './clearpathGps';

type DB = D1Database;

interface MappingRef { id: number; cpg_device_id: string; cpg_display_name: string | null; unit_id: number | null }

// ── Pure helpers (exported for tests) ────────────────────────

const isHttps = (u: unknown): u is string => typeof u === 'string' && /^https:\/\//i.test(u);
const isOutside = (mo: CpgMediaObject) => {
  const c = (mo.channel || 'outside').toLowerCase();
  return c !== 'inside' && c !== 'interior' && c !== 'cabin';
};

/** Best https still-image URL for the outside camera of an event:
 *  a full IMAGE object's accessUrl first, else any outside thumbnail. null if none. */
export function pickAlprImageUrl(event: CpgMediaEvent): string | null {
  const objs = event.mediaObject || [];
  const outsideImage = objs.find((mo) => isOutside(mo) && mo.type === 'IMAGE' && isHttps(mo.accessUrl));
  if (outsideImage && isHttps(outsideImage.accessUrl)) return outsideImage.accessUrl;
  const outsideThumb = objs.find((mo) => isOutside(mo) && isHttps(mo.thumbnailUrl));
  if (outsideThumb && isHttps(outsideThumb.thumbnailUrl)) return outsideThumb.thumbnailUrl;
  return null;
}

/** Highest detection confidence from the fast result, or null. */
export function plateConfidenceOf(predictions: AlprDetection[]): number | null {
  let best: number | null = null;
  for (const p of predictions) {
    const c = (p as { confidence?: number }).confidence;
    if (typeof c === 'number' && Number.isFinite(c) && (best == null || c > best)) best = c;
  }
  return best;
}

/** Event GPS, best-effort (location → first gps point). */
function eventLatLng(event: CpgMediaEvent): { lat: number | null; lng: number | null } {
  const first = event.mediaObject?.[0];
  const lat = first?.location?.lat ?? first?.gps?.[0]?.latitude ?? null;
  const lng = first?.location?.lng ?? first?.gps?.[0]?.longitude ?? null;
  return { lat, lng };
}

async function upsertVehicleByPlate(db: DB, plate: string, state: string | null): Promise<number | null> {
  try {
    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM vehicles_records WHERE UPPER(plate_number) = ? LIMIT 1', plate.toUpperCase());
    if (existing) {
      if (state) await execute(db, "UPDATE vehicles_records SET state = COALESCE(NULLIF(state,''), ?), updated_at = datetime('now') WHERE id = ?", state, existing.id);
      return existing.id;
    }
    const r = await execute(db,
      "INSERT INTO vehicles_records (plate_number, state, notes, updated_at) VALUES (?, ?, 'Observed via ClearPath dashcam ALPR', datetime('now'))",
      plate, state);
    return Number(r.meta.last_row_id);
  } catch (err) { console.error('[cpg-alpr] vehicle upsert failed:', (err as Error)?.message); return null; }
}

// ── Main entry (called from the media-sync loop, best-effort) ─

export async function alprDashcamClip(
  env: Bindings, db: DB,
  args: { videoId: number; r2Key?: string; mapping: MappingRef; event: CpgMediaEvent },
): Promise<void> {
  if (!env.ROBOFLOW_API_KEY) return;
  const imageUrl = pickAlprImageUrl(args.event);
  const markVideo = async (status: string) => {
    try { await execute(db, 'UPDATE dashcam_videos SET alpr_status = ? WHERE id = ?', status, args.videoId); } catch { /* */ }
  };
  if (!imageUrl) { await markVideo('skipped'); return; }

  let plate: string | null = null;
  let confidence: number | null = null;
  try {
    const res = await runPlateFast({
      image: { type: 'url', value: imageUrl },
      apiKey: env.ROBOFLOW_API_KEY,
      apiUrl: env.ROBOFLOW_API_URL,
      workflowId: env.ROBOFLOW_FAST_WORKFLOW_ID,
    });
    plate = res.plate;
    confidence = plateConfidenceOf(res.predictions);
  } catch (err) {
    console.error('[cpg-alpr] roboflow failed:', (err as Error)?.message);
    await markVideo('failed');
    return;
  }
  if (!plate) { await markVideo('done'); return; }

  const { lat, lng } = eventLatLng(args.event);
  const threshold = ALPR_ACCEPT_CONFIDENCE;
  const accepted = (confidence ?? 0) >= threshold;
  const deviceName = args.mapping.cpg_display_name || args.mapping.cpg_device_id;
  const locationText = args.event.address || `${deviceName} dashcam`;

  // Full policy: upsert a master vehicle record only on an accepted (≥0.85) read.
  let vehicleId: number | null = null;
  if (accepted) vehicleId = await upsertVehicleByPlate(db, plate, null);

  // Always log a sighting (feeds /intel/plate-log).
  try {
    await execute(db,
      `INSERT INTO vehicle_sightings (plate, state, vehicle_id, location_text, lat, lng, notes, sighted_by, confidence)
       VALUES (?, NULL, ?, ?, ?, ?, ?, NULL, ?)`,
      plate, vehicleId, locationText, lat, lng,
      `ClearPath dashcam ${deviceName}${args.event.address ? ` @ ${args.event.address}` : ''}${accepted ? '' : ' (unconfirmed <0.85)'}`,
      confidence);
  } catch (err) { console.error('[cpg-alpr] sighting insert failed:', (err as Error)?.message); }

  // Always screen (officer safety) — hits raise a notification.
  try {
    const screen = await screenVehicle(db, vehicleId ? { vehicleId } : { plate });
    const critical = screen.hits.filter((h) => h.severity === 'critical');
    if (critical.length) {
      const title = `${accepted ? '' : 'UNCONFIRMED — verify plate: '}DASHCAM PLATE HIT: ${plate}`;
      await execute(db,
        `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
         VALUES ('intel_screen', 'high', ?, ?, 'vehicle', ?, NULL, 0, datetime('now'))`,
        title, critical.map((h) => h.detail).join('; '), screen.vehicleId ?? vehicleId);
    }
  } catch (err) { console.error('[cpg-alpr] screen failed:', (err as Error)?.message); }

  // Capture-level row (best-effort; alpr_captures self-heals in the alpr route).
  try {
    await execute(db,
      `INSERT INTO alpr_captures (plate, state, confidence, plate_confidence, accepted, review_status,
         lat, lng, location_text, captured_by, capture_id, raw_json, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, datetime('now'))`,
      plate, confidence, confidence, accepted ? 1 : 0, accepted ? 'accepted' : 'needs_review',
      lat, lng, locationText,
      `cpg_dashcam:${args.mapping.cpg_device_id}:${args.event.eventTimestamp}`,
      JSON.stringify({ device: args.mapping.cpg_device_id, eventTimestamp: args.event.eventTimestamp, imageUrl }));
  } catch { /* non-fatal — background path */ }

  await markVideo('done');
}
