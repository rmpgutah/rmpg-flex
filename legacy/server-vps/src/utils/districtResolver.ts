/**
 * District Resolver — Shared S/Z/B Auto-Fill Utility
 *
 * Given latitude/longitude, identifies the Section, Zone, and Beat
 * using the geofence system and dispatch_districts lookup table.
 * Used by all record-creation routes that accept location data.
 *
 * Fallback chain:
 *   1. Exact polygon hit via identifyBeat()
 *   2. Nearest-beat centroid within 1.25 mi via findNearestBeat()
 *   3. null (no match)
 */
import { identifyBeat, findNearestBeat, BeatMatch } from './geofence';
import { getDb } from '../models/database';

export interface DistrictResult {
  sector_id: string;
  zone_id: string;
  beat_id: string;
  zone_beat: string;
  sector_name?: string;
  zone_name?: string;
  beat_name?: string;
  beat_descriptor?: string;
  exact: boolean;
}

/**
 * Resolve S/Z/B from coordinates. Returns null if coordinates are
 * outside all beat zones (and no nearby beat within 1.25 mi).
 */
export function resolveDistrict(lat: number, lng: number): DistrictResult | null {
  try {
    let beat: BeatMatch | null = identifyBeat(lat, lng);
    let exact = true;

    if (!beat) {
      const nearest = findNearestBeat(lat, lng);
      if (!nearest) return null;
      beat = nearest;
      exact = false;
    }

    const db = getDb();

    // Resolve from new geography tables (dispatch_beats → dispatch_zones → dispatch_sectors)
    const district = db.prepare(`
      SELECT db2.beat_code, db2.beat_name, db2.beat_descriptor,
             dz.zone_code, dz.zone_name,
             ds.sector_code, ds.sector_name
      FROM dispatch_beats db2
      JOIN dispatch_zones dz ON dz.id = db2.zone_id
      JOIN dispatch_sectors ds ON ds.id = dz.sector_id
      WHERE db2.beat_code = ?
      LIMIT 1
    `).get(beat.beat_code) as any;

    if (district) {
      return {
        sector_id: district.sector_code,
        zone_id: district.zone_code,
        beat_id: district.beat_code,
        zone_beat: beat.beat_code,
        sector_name: district.sector_name,
        zone_name: district.zone_name,
        beat_name: district.beat_name,
        beat_descriptor: district.beat_descriptor,
        exact,
      };
    }

    // No geography row — return raw geofence data
    return {
      sector_id: beat.district_letter,
      zone_id: beat.city_code,
      beat_id: beat.beat_code,
      zone_beat: beat.beat_code,
      exact,
    };
  } catch {
    // Geofence not configured or file missing — graceful degradation
    return null;
  }
}

/**
 * Auto-fill S/Z/B on any record that has latitude/longitude.
 * Mutates the record object with district data if coordinates resolve.
 * Returns true if S/Z/B was populated.
 */
export function autoFillDistrict(record: Record<string, any>): boolean {
  const lat = record.latitude;
  const lng = record.longitude;
  if (lat == null || lng == null) return false;

  const district = resolveDistrict(Number(lat), Number(lng));
  if (!district) return false;

  // Only fill if not already provided
  if (!record.sector_id) record.sector_id = district.sector_id;
  if (!record.zone_id) record.zone_id = district.zone_id;
  if (!record.beat_id) record.beat_id = district.beat_id;
  if (!record.zone_beat) record.zone_beat = district.zone_beat;
  if (!record.sector_name && district.sector_name) record.sector_name = district.sector_name;
  if (!record.zone_name && district.zone_name) record.zone_name = district.zone_name;
  if (!record.beat_name && district.beat_name) record.beat_name = district.beat_name;
  if (!record.beat_descriptor && district.beat_descriptor) record.beat_descriptor = district.beat_descriptor;

  return true;
}
