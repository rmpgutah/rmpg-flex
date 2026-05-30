// ============================================================
// RMPG Flex — District resolver (Worker)
//
// Turns a beat (chosen in a dropdown / GPS-identify) into the full
// Sector → Zone → Beat hierarchy, with the human-readable names the call
// list renders. Single source of truth shared by:
//   • GET /dispatch/geography/districts/identify  (coords → district)
//   • POST /dispatch/calls                        (backfill on create)
//
// Field shapes match the /districts dropdown contract exactly so a resolved
// district is interchangeable with a manually-picked one:
//   sector_id = dispatch_sectors.id       (numeric)
//   zone_id   = dispatch_zones.zone_code  (string)
//   beat_id   = dispatch_beats.beat_code  (string)
//
// Natural key is (zone_code, beat_code), which is unique across all 719 beats.
// For the 7 same-city_code town pairs (Millcreek/Midway, Clawson/Cleveland,
// Santaquin/Salina) the second town's beat_code carries a "-2" suffix in the
// DB; the geofence only yields the base code, so we widen the match to
// `beat_code IN (base, base||'-2')` and break the tie by city name.
// ============================================================

import type { Bindings } from '../types';
import { getDb, queryFirst } from './db';
import { identifyBeat } from './geofence';

export interface ResolvedDistrict {
  sector_id: number | null;
  sector_name: string | null;
  zone_id: string | null;
  zone_name: string | null;
  beat_id: string | null;
  beat_name: string | null;
  beat_descriptor: string | null;
  dispatch_code: string | null;
  // Combined Spillman-style "zone-beat" display token, e.g. "SLA-B1".
  zone_beat: string | null;
}

interface JoinRow {
  sector_id: number;
  sector_name: string | null;
  zone_id: string | null;
  zone_name: string | null;
  beat_id: string;
  beat_name: string | null;
  beat_descriptor: string | null;
  dispatch_code: string | null;
}

// Match on (zone_code, beat_code) — widened to the "-2" sibling — and prefer
// the row whose beat_name starts with the supplied city when a pair collides.
const RESOLVE_SQL = `
  SELECT
    ds.id          AS sector_id,
    ds.sector_name AS sector_name,
    dz.zone_code   AS zone_id,
    dz.zone_name   AS zone_name,
    db.beat_code   AS beat_id,
    db.beat_name   AS beat_name,
    db.beat_descriptor AS beat_descriptor,
    db.dispatch_code   AS dispatch_code
  FROM dispatch_beats db
  JOIN dispatch_zones dz   ON dz.id = db.zone_id
  JOIN dispatch_sectors ds ON ds.id = dz.sector_id
  WHERE dz.zone_code = ?
    AND (db.beat_code = ? OR db.beat_code = ? || '-2')
  ORDER BY
    CASE WHEN ? <> '' AND db.beat_name LIKE ? || '%' THEN 0 ELSE 1 END,
    db.beat_code
  LIMIT 1
`;

function toDistrict(row: JoinRow): ResolvedDistrict {
  // Prefer the explicit dispatch code as the zone_beat token; fall back to the
  // beat code so the field is never blank when a beat is known.
  const zone_beat = row.dispatch_code || row.beat_id || null;
  return {
    sector_id: row.sector_id,
    sector_name: row.sector_name,
    zone_id: row.zone_id,
    zone_name: row.zone_name,
    beat_id: row.beat_id,
    beat_name: row.beat_name,
    beat_descriptor: row.beat_descriptor,
    dispatch_code: row.dispatch_code,
    zone_beat,
  };
}

/** Resolve the full hierarchy for a (zone_code, beat_code) pair, or null. */
async function resolveRow(
  env: Bindings,
  zoneCode: string,
  beatCode: string,
  city: string,
): Promise<ResolvedDistrict | null> {
  const row = await queryFirst<JoinRow>(
    getDb(env),
    RESOLVE_SQL,
    zoneCode, beatCode, beatCode, city, city,
  );
  return row ? toDistrict(row) : null;
}

/**
 * Resolve a district from an explicit (zoneCode, beatCode) if supplied, else
 * from coordinates via the R2 geofence. Returns null when nothing matches
 * (point in no beat, or an unknown pair). Best-effort: callers must tolerate
 * null.
 */
export async function resolveDistrict(
  env: Bindings,
  opts: {
    zoneCode?: string | null;
    beatCode?: string | null;
    city?: string | null;
    lat?: number | null;
    lng?: number | null;
  },
): Promise<ResolvedDistrict | null> {
  // 1) Authoritative path: the caller already chose a beat (dropdown or a
  //    prior identify). Trust it and just hydrate the names.
  const zoneCode = opts.zoneCode?.trim();
  const beatCode = opts.beatCode?.trim();
  if (zoneCode && beatCode) {
    const byKey = await resolveRow(env, zoneCode, beatCode, opts.city?.trim() ?? '');
    if (byKey) return byKey;
    // fall through to coords if the pair didn't resolve
  }

  // 2) Geometric path: derive the beat from the point.
  if (
    typeof opts.lat === 'number' && Number.isFinite(opts.lat) &&
    typeof opts.lng === 'number' && Number.isFinite(opts.lng)
  ) {
    const hit = await identifyBeat(env, opts.lat, opts.lng);
    if (hit) return resolveRow(env, hit.zone_code, hit.beat_code, hit.city);
  }

  return null;
}
