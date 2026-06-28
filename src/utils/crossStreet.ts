// ============================================================
// RMPG Flex — Cross-Street Derivation (Worker side)
// ============================================================
// MIRROR of the pure logic in client/src/utils/crossStreet.ts. The browser
// derives cross streets via Mapbox Tilequery using the public token; the Serve
// Intake commit runs on the Worker with no browser, so we replicate it here
// using the server-side MAPBOX_ACCESS_TOKEN secret. Keep the matching logic
// (normalizeStreet / isSameStreet / WORD_CANON) in sync with the client copy.
//
// Best-effort throughout: any failure (no token, network error, bad response)
// returns '' so a cross-street miss never blocks an intake commit.

import type { Bindings } from '../types';

interface NearbyRoad { name: string; distance: number; }

export function normalizeStreet(s: string): string {
  return s.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
}

const WORD_CANON: Record<string, string> = {
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
  street: 'st', avenue: 'ave', drive: 'dr', road: 'rd', lane: 'ln',
  boulevard: 'blvd', court: 'ct', place: 'pl', circle: 'cir', square: 'sq',
  parkway: 'pkwy', highway: 'hwy', terrace: 'ter', trail: 'trl',
};

function streetTokens(name: string, stripHouseNumber: boolean): Set<string> {
  let cleaned = normalizeStreet(name);
  if (stripHouseNumber) cleaned = cleaned.replace(/^\d+\s+/, '');
  const toks = cleaned.split(' ').filter(Boolean).map((t) => WORD_CANON[t] ?? t);
  return new Set(toks);
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

export function isSameStreet(roadName: string, primaryStreet: string): boolean {
  const road = streetTokens(roadName, false);
  const primary = streetTokens(primaryStreet, true);
  return isSubset(road, primary) || isSubset(primary, road);
}

async function fetchNearbyRoads(
  env: Bindings, lng: number, lat: number, radiusMeters = 60,
): Promise<NearbyRoad[]> {
  const token = (env as { MAPBOX_ACCESS_TOKEN?: string }).MAPBOX_ACCESS_TOKEN;
  if (!token || !Number.isFinite(lng) || !Number.isFinite(lat)) return [];

  const url =
    `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/` +
    `${lng},${lat}.json?radius=${radiusMeters}&limit=50&dedupe=false&layers=road&access_token=${token}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as { features?: Array<{ properties?: { name?: string; tilequery?: { distance?: number } } }> };
    const features = data.features || [];

    const nearestByName = new Map<string, number>();
    for (const f of features) {
      const name = String(f.properties?.name || '').trim();
      const dist = f.properties?.tilequery?.distance;
      if (!name || typeof dist !== 'number') continue;
      const prev = nearestByName.get(name);
      if (prev == null || dist < prev) nearestByName.set(name, dist);
    }

    return Array.from(nearestByName, ([name, distance]) => ({ name, distance }))
      .sort((a, b) => a.distance - b.distance);
  } catch {
    return [];
  }
}

/**
 * Resolve the nearest cross street for a point, excluding the address's own
 * street. Returns '' on any miss. The caller should time-box this (it hits
 * Mapbox over the network) so a slow Tilequery can't stall the commit.
 */
export async function deriveCrossStreetFromCoords(
  env: Bindings, lng: number, lat: number, primaryStreet: string,
): Promise<string> {
  const roads = await fetchNearbyRoads(env, lng, lat);
  const crosses = roads.filter((r) => !isSameStreet(r.name, primaryStreet));
  return crosses[0]?.name || '';
}
