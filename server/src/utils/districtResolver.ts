/**
 * District Resolver — Shared S/Z/B Auto-Fill Utility
 *
 * Given latitude/longitude, identifies the Section, Zone, and Beat
 * using the geofence system and dispatch_districts lookup table.
 * Used by all record-creation routes that accept location data.
 */
import { identifyBeat } from './geofence';
import { getDb } from '../models/database';

export interface DistrictResult {
  section_id: string;
  zone_id: string;
  beat_id: string;
  zone_beat: string;
}

/**
 * Resolve S/Z/B from coordinates. Returns null if coordinates are
 * outside all beat zones or if geofence data is not configured.
 */
export function resolveDistrict(lat: number, lng: number): DistrictResult | null {
  try {
    const beat = identifyBeat(lat, lng);
    if (!beat) return null;

    const db = getDb();
    const district = db.prepare(
      'SELECT * FROM dispatch_districts WHERE zone_id = ? AND beat_id = ?'
    ).get(beat.city_code, beat.district_letter) as any;

    if (district) {
      return {
        section_id: district.section_id,
        zone_id: district.zone_name,
        beat_id: `${district.beat_name} — ${district.beat_descriptor}`,
        zone_beat: beat.beat_code,
      };
    }

    // Fallback to raw geofence data when no dispatch_districts row exists
    return {
      section_id: beat.district_letter,
      zone_id: `${beat.city} ${beat.district_letter}${beat.beat_number}`,
      beat_id: beat.beat_id,
      zone_beat: beat.beat_code,
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
  if (!record.section_id) record.section_id = district.section_id;
  if (!record.zone_id) record.zone_id = district.zone_id;
  if (!record.beat_id) record.beat_id = district.beat_id;
  if (!record.zone_beat) record.zone_beat = district.zone_beat;

  return true;
}
