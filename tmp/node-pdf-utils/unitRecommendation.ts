// ============================================================
// RMPG Flex — Smart Unit Recommendation
// Ranks available units by proximity to a call location using
// haversine distance, with ETA estimation. Mirrors Spillman
// Flex AVL-based automatic unit suggestion.
// ============================================================

import type { Unit } from '../types';

export interface RankedUnit {
  unit: Unit;
  distance: number;   // miles
  eta: number;        // estimated minutes
  rank: number;       // 1-based rank
  hasGps: boolean;    // whether distance is real or fallback
}

const EARTH_RADIUS_MILES = 3959;
const ROAD_FACTOR = 1.4;          // straight-line → road distance multiplier
const AVG_SPEED_MPH = 35;         // average response speed in urban areas

/**
 * Haversine distance between two lat/lng points in miles.
 */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return Infinity;
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

/**
 * Estimate minutes to scene based on straight-line distance.
 */
export function estimateETA(distanceMiles: number): number {
  if (!Number.isFinite(distanceMiles) || distanceMiles < 0) return 0;
  const roadDistance = distanceMiles * ROAD_FACTOR;
  return (roadDistance / AVG_SPEED_MPH) * 60; // minutes
}

/**
 * Rank available units by proximity to a call location.
 * Units without GPS coordinates are placed at the end.
 */
export function rankUnits(
  units: Unit[],
  callLat: number | null | undefined,
  callLng: number | null | undefined,
  excludeIds: string[] = []
): RankedUnit[] {
  // Filter to non-off-duty, non-excluded units
  const eligible = units.filter(
    u => u.status !== 'off_duty' && !excludeIds.includes(String(u.id))
  );

  if (!callLat || !callLng) {
    // No call location — return all eligible units without distance, available first
    return eligible
      .sort((a, b) => {
        if (a.status === 'available' && b.status !== 'available') return -1;
        if (a.status !== 'available' && b.status === 'available') return 1;
        return a.call_sign.localeCompare(b.call_sign);
      })
      .map((unit, i) => ({
        unit,
        distance: -1,
        eta: -1,
        rank: i + 1,
        hasGps: false,
      }));
  }

  // Calculate distance for each unit
  const withDistance = eligible.map(unit => {
    const hasGps = !!(unit.latitude && unit.longitude);
    const distance = hasGps
      ? haversineDistance(callLat, callLng, unit.latitude!, unit.longitude!)
      : 999;
    const eta = hasGps ? estimateETA(distance) : -1;
    return { unit, distance, eta, hasGps, rank: 0 };
  });

  // Sort: available units first, then by distance
  withDistance.sort((a, b) => {
    // Available units always rank higher than busy ones
    const aAvail = a.unit.status === 'available' ? 0 : 1;
    const bAvail = b.unit.status === 'available' ? 0 : 1;
    if (aAvail !== bAvail) return aAvail - bAvail;
    // Then by distance
    return a.distance - b.distance;
  });

  // Assign ranks
  return withDistance.map((item, i) => ({ ...item, rank: i + 1 }));
}
