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
import { queryFirst, execute, columnExists } from './db';
import { screenVehicle } from './intelScreen';
import { ALPR_ACCEPT_CONFIDENCE } from './roboflowAlpr';
import { trustScore } from './plateTrust';
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

/** Reject the model's non-plate answers ("NOTVISIBLE", "NONE", "UNKNOWN", …)
 *  and anything that isn't a plausible plate (2–8 alphanumerics). Returns the
 *  normalized plate or null. Pure, exported for tests. */
const NON_PLATE = new Set(['NOTVISIBLE', 'NONE', 'UNKNOWN', 'NA', 'NOPLATE', 'NOTAPLATE', 'NULL', 'BLURRY', 'OBSCURED', 'UNREADABLE']);
export function validatePlate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const norm = raw.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z0-9]{2,8}$/.test(norm)) return null;
  if (NON_PLATE.has(norm)) return null;
  return norm;
}

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

/** Reconcile the columns this background path writes, mirroring the alpr route's
 *  ensureAlprSchema. Migrations routinely fail to reach live D1 silently (deploy
 *  step is continue-on-error), so without this a missing column makes the
 *  vehicle_sightings / alpr_captures INSERTs throw — and they're caught + only
 *  logged, so the sighting (which feeds /intel/plate-log) or capture would be
 *  silently lost. We reconcile here rather than dropping columns so intel data is
 *  never discarded, matching the established pattern in src/routes/alpr.ts.
 *  (Cannot import the route's private ensureAlprSchema from a util without a
 *  route→util import inversion; the columns this path touches are inlined here.) */
const SIGHTING_EXTRA_COLUMNS: Array<[string, string]> = [['confidence', 'REAL']];
const CAPTURE_EXTRA_COLUMNS: Array<[string, string]> = [
  ['plate_confidence', 'REAL'], ['accepted', 'INTEGER'], ['review_status', 'TEXT'],
  ['image_key', 'TEXT'], ['capture_id', 'TEXT'], ['raw_json', 'TEXT'],
];
async function ensureAlprWriteSchema(db: DB): Promise<void> {
  for (const [name, type] of SIGHTING_EXTRA_COLUMNS) {
    if (!(await columnExists(db, 'vehicle_sightings', name))) {
      try { await execute(db, `ALTER TABLE vehicle_sightings ADD COLUMN ${name} ${type}`); }
      catch { /* lost a race or already present — fine */ }
    }
  }
  for (const [name, type] of CAPTURE_EXTRA_COLUMNS) {
    if (!(await columnExists(db, 'alpr_captures', name))) {
      try { await execute(db, `ALTER TABLE alpr_captures ADD COLUMN ${name} ${type}`); }
      catch { /* lost a race or already present — fine */ }
    }
  }
}

// ── Main entry (called from the media-sync loop, best-effort) ─

export async function alprDashcamClip(
  env: Bindings, db: DB,
  args: { videoId?: number; r2Key?: string; mapping: MappingRef; event: CpgMediaEvent },
): Promise<void> {
  // When called without a stored video (the lightweight still-only scan), there's
  // no dashcam_videos row to flag — markVideo becomes a no-op.
  const markVideo = async (status: string) => {
    if (args.videoId == null) return;
    try { await execute(db, 'UPDATE dashcam_videos SET alpr_status = ? WHERE id = ?', status, args.videoId); } catch { /* */ }
  };
  // Reconcile the columns the sighting + capture INSERTs below depend on, the
  // same way the alpr route does before its writes (best-effort, never fatal).
  try { await ensureAlprWriteSchema(db); } catch { /* best-effort */ }
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
  const plate = validatePlate(read?.plate);   // null for "NOTVISIBLE"/junk → recorded as a no-plate still
  const confidence = read?.confidence ?? null;
  const { lat, lng } = eventLatLng(args.event);
  // Gate the master-record upsert on DERIVED trust, not the model's self-reported
  // confidence (which plateTrust.ts distrusts). trustScore() hard-caps a single
  // read at 0.84, so no lone dashcam read can auto-upsert a vehicles_records
  // master row — matching the on-scene ASSERT_GATE behavior.
  const trust = plate ? trustScore({ reads: [plate], modelPct: confidence ?? undefined }) : null;
  const accepted = !!plate && !!trust && trust.trustScore >= ALPR_ACCEPT_CONFIDENCE;
  const deviceName = args.mapping.cpg_display_name || args.mapping.cpg_device_id;
  const locationText = args.event.address || `${deviceName} dashcam`;

  // Plate-dependent intel writes (vehicle record / sighting / screening) only run
  // when a plate was actually read; a no-plate still is still recorded below as a
  // gallery capture so the dashcam event is visible.
  let vehicleId: number | null = null;
  if (plate) {
    // Upsert a master vehicle record only on an accepted (≥0.85) read.
    if (accepted) vehicleId = await upsertVehicleByPlate(db, plate, {
      state: read?.state, make: read?.make, model: read?.model, color: read?.color, year: read?.year,
    });
    // Log a sighting (feeds /intel/plate-log).
    try {
      await execute(db,
        `INSERT INTO vehicle_sightings (plate, state, vehicle_id, location_text, lat, lng, notes, sighted_by, confidence)
         VALUES (?, NULL, ?, ?, ?, ?, ?, NULL, ?)`,
        plate, vehicleId, locationText, lat, lng,
        `ClearPath dashcam ${deviceName}${args.event.address ? ` @ ${args.event.address}` : ''}${accepted ? '' : ' (unconfirmed <0.85)'}`,
        confidence);
    } catch (err) { console.error('[cpg-alpr] sighting insert failed:', (err as Error)?.message); }
    // Screen (officer safety) — hits raise a notification.
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
  }

  // Capture-level row (best-effort; columns reconciled above via ensureAlprWriteSchema).
  // image_key points at the R2-persisted still so the capture gallery can render
  // it (and overlay the plate) long after the pre-signed S3 url expires.
  try {
    await execute(db,
      `INSERT INTO alpr_captures (plate, state, make, model, color, year, confidence, plate_confidence,
         accepted, review_status, image_key, lat, lng, location_text, captured_by, capture_id, raw_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, datetime('now'))`,
      plate, read?.state ?? null, read?.make ?? null, read?.model ?? null, read?.color ?? null, read?.year ?? null,
      confidence, confidence, accepted ? 1 : 0, !plate ? 'no_plate' : accepted ? 'accepted' : 'needs_review', imageKey,
      lat, lng, locationText,
      `cpg_dashcam:${args.mapping.cpg_device_id}:${args.event.eventTimestamp}`,
      JSON.stringify({
        source: 'dashcam', engine: 'workers-ai',
        device: args.mapping.cpg_device_id, deviceName, eventTimestamp: args.event.eventTimestamp,
        eventType: args.event.mediaObject?.[0]?.eventType || null,
        videoId: args.videoId, imageUrl,
      }));
  } catch (err) { console.error('[cpg-alpr] capture insert failed:', (err as Error)?.message); }

  await markVideo('done');
}
