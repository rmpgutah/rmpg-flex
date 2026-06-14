// ============================================================
// RMPG Flex — ClearPath dashcam ALPR (Phase C)
// ============================================================
// Reads the plate from the still image of an outside-camera dashcam event on
// Cloudflare Workers AI (free — no Roboflow credits), then wires it into intel:
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
import { queryFirst, execute } from './db';
import { screenVehicle } from './intelScreen';
import { ALPR_ACCEPT_CONFIDENCE } from './roboflowAlpr';
import { readPlateCloudflare } from './cloudflarePlate';
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

/** Event GPS, best-effort (location → first gps point). */
function eventLatLng(event: CpgMediaEvent): { lat: number | null; lng: number | null } {
  const first = event.mediaObject?.[0];
  const lat = first?.location?.lat ?? first?.gps?.[0]?.latitude ?? null;
  const lng = first?.location?.lng ?? first?.gps?.[0]?.longitude ?? null;
  return { lat, lng };
}

interface PlateAttrs { state?: string | null; make?: string | null; model?: string | null; color?: string | null; year?: number | null }

async function upsertVehicleByPlate(db: DB, plate: string, attrs: PlateAttrs): Promise<number | null> {
  try {
    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM vehicles_records WHERE UPPER(plate_number) = ? LIMIT 1', plate.toUpperCase());
    if (existing) {
      // Enrich only blank fields (COALESCE(NULLIF(...))) — never overwrite curated data.
      await execute(db, `UPDATE vehicles_records SET
          state = COALESCE(NULLIF(state,''), ?), make = COALESCE(NULLIF(make,''), ?),
          model = COALESCE(NULLIF(model,''), ?), color = COALESCE(NULLIF(color,''), ?),
          year = COALESCE(year, ?), updated_at = datetime('now') WHERE id = ?`,
        attrs.state ?? null, attrs.make ?? null, attrs.model ?? null, attrs.color ?? null, attrs.year ?? null, existing.id);
      return existing.id;
    }
    const r = await execute(db,
      `INSERT INTO vehicles_records (plate_number, state, make, model, color, year, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'Observed via ClearPath dashcam ALPR (Workers AI)', datetime('now'))`,
      plate, attrs.state ?? null, attrs.make ?? null, attrs.model ?? null, attrs.color ?? null, attrs.year ?? null);
    return Number(r.meta.last_row_id);
  } catch (err) { console.error('[cpg-alpr] vehicle upsert failed:', (err as Error)?.message); return null; }
}

// ── Main entry (called from the media-sync loop, best-effort) ─

export async function alprDashcamClip(
  env: Bindings, db: DB,
  args: { videoId: number; r2Key?: string; mapping: MappingRef; event: CpgMediaEvent },
): Promise<void> {
  const markVideo = async (status: string) => {
    try { await execute(db, 'UPDATE dashcam_videos SET alpr_status = ? WHERE id = ?', status, args.videoId); } catch { /* */ }
  };
  const imageUrl = pickAlprImageUrl(args.event);
  if (!imageUrl) { await markVideo('skipped'); return; }

  // Fetch the dashcam still (a small JPEG, not the mp4) and read the plate on
  // Workers AI — free, no Roboflow credits. The pre-signed S3 url needs no auth.
  // We ALSO persist the still to R2 so the capture stays viewable after the
  // pre-signed S3 url expires (~1h) — the capture gallery serves it from there.
  let read: Awaited<ReturnType<typeof readPlateCloudflare>> = null;
  let imageKey: string | null = null;
  try {
    const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) throw new Error(`still fetch ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const mediaType = resp.headers.get('content-type') || 'image/jpeg';
    imageKey = `alpr-captures/cpg/${args.mapping.cpg_device_id}/${args.event.eventTimestamp}.jpg`;
    try { await env.UPLOADS.put(imageKey, buf, { httpMetadata: { contentType: mediaType } }); }
    catch (e) { console.error('[cpg-alpr] still R2 put failed:', (e as Error)?.message); imageKey = null; }
    read = await readPlateCloudflare(env, bytes, mediaType);
  } catch (err) {
    console.error('[cpg-alpr] workers-ai read failed:', (err as Error)?.message);
    await markVideo('failed');
    return;
  }
  const plate = read?.plate ?? null;
  const confidence = read?.confidence ?? null;
  if (!plate) { await markVideo('done'); return; }

  const { lat, lng } = eventLatLng(args.event);
  const threshold = ALPR_ACCEPT_CONFIDENCE;
  const accepted = (confidence ?? 0) >= threshold;
  const deviceName = args.mapping.cpg_display_name || args.mapping.cpg_device_id;
  const locationText = args.event.address || `${deviceName} dashcam`;

  // Full policy: upsert a master vehicle record only on an accepted (≥0.85) read,
  // enriched with the make/model/color Workers AI returned in the same call.
  let vehicleId: number | null = null;
  if (accepted) vehicleId = await upsertVehicleByPlate(db, plate, {
    state: read?.state, make: read?.make, model: read?.model, color: read?.color, year: read?.year,
  });

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
  // image_key points at the R2-persisted still so the capture gallery can render
  // it (and overlay the plate) long after the pre-signed S3 url expires.
  try {
    await execute(db,
      `INSERT INTO alpr_captures (plate, state, make, model, color, year, confidence, plate_confidence,
         accepted, review_status, image_key, lat, lng, location_text, captured_by, capture_id, raw_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, datetime('now'))`,
      plate, read?.state ?? null, read?.make ?? null, read?.model ?? null, read?.color ?? null, read?.year ?? null,
      confidence, confidence, accepted ? 1 : 0, accepted ? 'accepted' : 'needs_review', imageKey,
      lat, lng, locationText,
      `cpg_dashcam:${args.mapping.cpg_device_id}:${args.event.eventTimestamp}`,
      JSON.stringify({
        source: 'dashcam', engine: 'workers-ai',
        device: args.mapping.cpg_device_id, deviceName, eventTimestamp: args.event.eventTimestamp,
        eventType: args.event.mediaObject?.[0]?.eventType || null,
        videoId: args.videoId, imageUrl,
      }));
  } catch { /* non-fatal — background path */ }

  await markVideo('done');
}
