// ============================================================
// RMPG Flex — Nearest posted speed limit from an OSM vector tile
// ============================================================
// Decodes one MVT tile and finds the closest way carrying cat='maxspeed'
// to a query coordinate. Used by GET /api/dispatch/geography/road-speed,
// which reads the tile out of the osm-traffic PMTiles archive in R2.
//
// This exists so RMPG stops asking overpass-api.de — a volunteer-run public
// service with a fair-use policy that excludes production traffic — for a
// fact already sitting in its own R2 bucket.
//
// NOTE ON THE DUPLICATED PARSER: /src (Worker) and /client/src (React) share
// no build or package.json, so this cannot import client/src/utils/speedLimit.
// parseMaxspeedMphServer is behaviourally identical and separately tested.
// ============================================================

import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { pointToSegmentMeters, tileExtentToLngLat } from './tileGeometry';

const KMH_TO_MPH = 0.621371;

export interface SpeedLimitHit {
  limitMph: number;
  roadName: string | null;
  distanceM: number;
}

/** Worker-side twin of client/src/utils/speedLimit.ts#parseMaxspeedMph. */
export function parseMaxspeedMphServer(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.round(raw);
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  const m = s.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (!Number.isFinite(val) || val <= 0) return null;
  if (s.includes('km') || s.includes('kph')) return Math.round(val * KMH_TO_MPH);
  return Math.round(val);
}

/**
 * Closest cat='maxspeed' way to (lng,lat) within one decoded tile, or null.
 *
 * Returns null rather than throwing on any decode failure: a corrupt or
 * unexpected tile must degrade to "limit unknown", never fault the request.
 * The caller compares hits across several tiles, so a per-tile null is normal.
 */
export function nearestMaxspeedInTile(
  tileData: Uint8Array,
  z: number, x: number, y: number,
  lng: number, lat: number,
  sourceLayer: string,
): SpeedLimitHit | null {
  let layer;
  try {
    const tile = new VectorTile(new PbfReader(tileData));
    layer = tile.layers[sourceLayer];
  } catch {
    return null;
  }
  if (!layer) return null;

  const extent = layer.extent || 4096;
  let best: SpeedLimitHit | null = null;

  for (let i = 0; i < layer.length; i++) {
    let feature;
    try {
      feature = layer.feature(i);
    } catch {
      continue; // one bad feature must not abandon the rest of the tile
    }

    const props = feature.properties || {};
    // One shared source per archive holds every category; filter to ours.
    if (props.cat !== 'maxspeed') continue;

    // The archive's rule for cat='maxspeed' is "any way carrying a maxspeed
    // tag" — and OSM railways carry maxspeed tags too (e.g. Union Pacific's
    // "Salt Lake Subdivision" / "UP Lynndyl Subdivision" through downtown SLC,
    // tagged maxspeed="30 mph" / "40 mph" with no `highway` property at all).
    // Those are train speed limits, not posted road limits. Because this
    // lookup takes the geometrically NEAREST maxspeed way within a 60 m
    // radius, a rail corridor running parallel to (or crossing) a street can
    // beat the actual road and get its train speed reported as the road's
    // limit — a wrong number on a patrol vehicle's speed HUD, which is worse
    // than the null this feature is supposed to degrade to. Do not remove
    // this check "to simplify" — every real road feature carries `highway`.
    const highway = props.highway;
    if (typeof highway !== 'string' || highway.trim() === '') continue;

    const limitMph = parseMaxspeedMphServer(props.maxspeed);
    // Real OSM carries non-numeric maxspeed values ("signals", "walk"). Those
    // are not a posted limit and must not be reported as one.
    if (limitMph == null) continue;

    let rings;
    try {
      rings = feature.loadGeometry();
    } catch {
      continue;
    }

    for (const ring of rings) {
      for (let k = 0; k + 1 < ring.length; k++) {
        const a = tileExtentToLngLat(x, y, z, ring[k].x, ring[k].y, extent);
        const b = tileExtentToLngLat(x, y, z, ring[k + 1].x, ring[k + 1].y, extent);
        const d = pointToSegmentMeters(lng, lat, a.lng, a.lat, b.lng, b.lat);
        if (best == null || d < best.distanceM) {
          const name = props.name;
          best = {
            limitMph,
            roadName: typeof name === 'string' && name.trim() !== '' ? name : null,
            distanceM: d,
          };
        }
      }
    }
  }

  return best;
}
