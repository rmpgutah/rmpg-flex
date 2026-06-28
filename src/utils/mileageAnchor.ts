// ============================================================
// RMPG Flex — Mileage anchor lookup
// ============================================================
// One source of truth for the (officer, unit) → suggested mileage
// fallback chain used by BOTH the /patrol/mileage/suggest endpoint
// AND the trip engine's auto-stamp on patrol trip open/close.
// Fallback order: officer_unit → officer → unit. Each tier kicks in
// only when the more specific scope has no row in mileage_anchor.
// The returned current_mileage already reflects offset_miles.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst } from './db';

export function scopeKeyOfficerUnit(officerId: number, unitId: number): string {
  return `officer_unit:${officerId}:${unitId}`;
}
export function scopeKeyOfficer(officerId: number): string {
  return `officer:${officerId}`;
}
export function scopeKeyUnit(unitId: number): string {
  return `unit:${unitId}`;
}

export interface SuggestedMileage {
  suggested_mileage: number;
  source: 'officer_unit' | 'officer' | 'unit';
  scope_key: string;
  offset_miles: number;
  last_entry_at: string | null;
}

interface AnchorRow {
  current_mileage: number;
  offset_miles: number;
  last_entry_at: string | null;
}

/** Return the suggested starting mileage for (officerId, unitId), walking
 *  the three-tier fallback chain. Returns null when no anchor exists at
 *  any tier — callers decide whether to leave the new row blank or carry
 *  forward from the previous chain row. */
export async function getSuggestedMileage(
  db: D1Database,
  officerId: number | null | undefined,
  unitId: number | null | undefined,
): Promise<SuggestedMileage | null> {
  const oId = Number.isFinite(officerId as number) ? (officerId as number) : null;
  const uId = Number.isFinite(unitId as number) ? (unitId as number) : null;
  if (oId == null && uId == null) return null;

  if (oId != null && uId != null) {
    const row = await queryFirst<AnchorRow>(
      db,
      'SELECT current_mileage, offset_miles, last_entry_at FROM mileage_anchor WHERE scope_key = ?',
      scopeKeyOfficerUnit(oId, uId),
    );
    if (row) return {
      suggested_mileage: row.current_mileage,
      source: 'officer_unit',
      scope_key: scopeKeyOfficerUnit(oId, uId),
      offset_miles: row.offset_miles,
      last_entry_at: row.last_entry_at,
    };
  }

  if (oId != null) {
    const row = await queryFirst<AnchorRow>(
      db,
      'SELECT current_mileage, offset_miles, last_entry_at FROM mileage_anchor WHERE scope_key = ?',
      scopeKeyOfficer(oId),
    );
    if (row) return {
      suggested_mileage: row.current_mileage,
      source: 'officer',
      scope_key: scopeKeyOfficer(oId),
      offset_miles: row.offset_miles,
      last_entry_at: row.last_entry_at,
    };
  }

  if (uId != null) {
    const row = await queryFirst<AnchorRow>(
      db,
      'SELECT current_mileage, offset_miles, last_entry_at FROM mileage_anchor WHERE scope_key = ?',
      scopeKeyUnit(uId),
    );
    if (row) return {
      suggested_mileage: row.current_mileage,
      source: 'unit',
      scope_key: scopeKeyUnit(uId),
      offset_miles: row.offset_miles,
      last_entry_at: row.last_entry_at,
    };
  }

  return null;
}

const METERS_PER_MILE = 1609.34;

/** Upper bound on a single patrol-trip's GPS distance before we treat it
 *  as a sensor glitch and refuse to derive end_mileage from it. The
 *  longest a Salt Lake patrol unit drives in a single closed trip is
 *  ~60-65 mi (a round-trip to Wendover); anything over 75 mi is almost
 *  certainly a fix-jump or two trips fused by an idle-close miss. */
export const TRIP_DISTANCE_OUTLIER_MILES = 75;

/** Derive end_mileage from start_mileage + GPS distance, guarding the
 *  outlier case so a bad GPS trip can't poison the anchor for every
 *  subsequent patrol. Returns null when the result would be unsafe. */
export function deriveEndMileage(
  startMileage: number | null | undefined,
  distanceM: number | null | undefined,
): { endMileage: number; distanceMi: number } | null {
  if (startMileage == null || !Number.isFinite(startMileage)) return null;
  if (distanceM == null || !Number.isFinite(distanceM) || distanceM <= 0) return null;
  const distanceMi = distanceM / METERS_PER_MILE;
  if (distanceMi > TRIP_DISTANCE_OUTLIER_MILES) return null;
  return {
    endMileage: Math.round((startMileage + distanceMi) * 10) / 10,
    distanceMi,
  };
}
