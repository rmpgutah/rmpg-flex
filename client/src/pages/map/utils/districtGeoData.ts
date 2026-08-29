// ============================================================
// RMPG Flex — Shared district / boundary geo-data loader
// ============================================================
// Module-level cached loaders for the polygon datasets the advanced
// overlay features share (district hierarchy layers, the "What's Here"
// spatial query, and the activity choropleth). Each dataset is fetched +
// processed at most once per page load; callers await the same promise.
//
// `getTaggedBeats()` returns the 719 beat polygons with the full
// Area/Sector/Zone hierarchy + display colors baked onto each feature's
// properties (joined to /dispatch/geography/districts on
// city_code == zone_id, the key the rest of the map assumes).
// ============================================================

import { getZoneColor, getSectorColor } from '../../../utils/geographyLabels';
import { apiFetch } from '../../../hooks/useApi';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';

// The 29 county "<CITY>-UNINC" catch-all beats fully overlap the incorporated
// city beats, so a naive first-match PIP wrongly reports e.g. Midvale as "SLC
// Unincorporated". Mirror the server geofence rule (src/utils/geofence.ts):
// an incorporated city beat wins; the "-UNINC" catch-all is only a fallback.
export function isUnincorporatedBeat(props: any): boolean {
  return String(props?.beat_code || '').endsWith('-UNINC');
}

// Six towns share a city_code with a same-prefix sibling in beat.geojson
// (Midway/Millcreek both "MI2", etc.). The live DB resolves the clash by giving
// the SECOND town its own zone, coded "<city_code>-<county_nbr>". The geojson
// only carries the shared city_code, so we remap by the (unique) city NAME to
// the real DB zone_code those reparented beats live under. MUST stay in sync
// with src/utils/geofence.ts (the server geofence) — without this the client
// map would resolve a Midway click to Millcreek, exactly the bug the server
// already fixes. (See [[project-geography-geofence-pipeline]].)
const ZONE_CODE_BY_CITY: Record<string, string> = {
  Midway: 'MI2-26',     // Wasatch County
  Marysvale: 'MA2-16',  // Piute County
  Mona: 'MO2-12',       // Juab County
  Richfield: 'RI2-21',  // Sevier County
  Salina: 'SA2-21',     // Sevier County
  Cleveland: 'CL2-08',  // Emery County
};

// The geojson city for a county catch-all reads "Salt Lake Co. Unincorp.";
// the DB zone_name is the terse code form "SLC Unincorporated". Neither is
// great in a popup, so we compose a readable label.
//
// We prefer the geojson `city` over the DB sector_name on purpose: the geojson
// is the authoritative, per-polygon source of WHICH county a catch-all covers
// (it's the same file the server geofence ray-casts), whereas dispatch_zones
// can drift (e.g. the WSH zone was mis-filed under Washington County when the
// WSH polygon is actually Wasatch). The DB sector_name is the fallback for the
// rare polygon whose `city` is missing.
export function unincorporatedZoneName(props: any, sectorName?: string): string {
  const city = String(props?.city || '').trim();
  if (city) {
    const expanded = city
      .replace(/\bCo\.\s*Unincorp\.?/i, 'County Unincorporated')
      .replace(/\bUnincorp\.?$/i, 'Unincorporated')
      .trim();
    if (expanded) return expanded;
  }
  if (sectorName && sectorName.trim()) return `${sectorName.trim()} Unincorporated`;
  return 'Unincorporated';
}

/** Best beat feature at a point: incorporated city beat over the UNINC catch-all. */
export function findBeatAt(features: any[], lng: number, lat: number): any | null {
  if (!Array.isArray(features)) return null;
  const pt = { type: 'Point', coordinates: [lng, lat] } as any;
  let uninc: any = null;
  for (const f of features) {
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    try {
      if (booleanPointInPolygon(pt, f as any)) {
        if (!isUnincorporatedBeat(f.properties)) return f;
        if (!uninc) uninc = f;
      }
    } catch { /* skip malformed */ }
  }
  return uninc;
}

export const AREA_PALETTE = ['#c3ccd6', '#22c55e', '#ef4444', '#a855f7', '#f59e0b', '#14b8a6', '#ec4899', '#84cc16', '#fb923c', '#eab308'];

export function getAreaColor(code: string): string {
  if (!code) return AREA_PALETTE[0];
  let h = 0;
  for (let i = 0; i < code.length; i++) h = ((h << 5) - h + code.charCodeAt(i)) | 0;
  return AREA_PALETTE[Math.abs(h) % AREA_PALETTE.length];
}

export interface TaggedBeatProps {
  _zone: string; _zoneName: string; _zoneColor: string;
  _sector: string; _sectorName: string; _sectorColor: string;
  _area: string; _areaName: string; _areaColor: string;
  [k: string]: any;
}

let taggedBeatsPromise: Promise<any> | null = null;
let countyPromise: Promise<any> | null = null;
let muniPromise: Promise<any> | null = null;

export function getTaggedBeats(): Promise<any> {
  if (!taggedBeatsPromise) {
    taggedBeatsPromise = (async () => {
      const [beatJson, districts] = await Promise.all([
        fetch('/geojson/beat.geojson').then((r) => r.json()).catch(() => ({ features: [] })),
        apiFetch<any[]>('/dispatch/geography/districts').catch(() => [] as any[]),
      ]);
      // zone_code (== beat.city_code) -> section / area / zone naming.
      const zoneInfo = new Map<string, any>();
      for (const d of (districts || [])) {
        const z = d.zone_id != null ? String(d.zone_id) : '';
        if (!z || zoneInfo.has(z)) continue;
        zoneInfo.set(z, {
          sectorId: d.sector_id != null ? String(d.sector_id) : '',
          sectorName: d.sector_name || '',
          zoneName: d.zone_name || '',
          areaCode: d.area_code != null ? String(d.area_code) : '',
          areaName: d.area_name || '',
        });
      }
      const features = (beatJson.features || []).map((f: any) => {
        const p = f.properties || {};
        const cityCode = p.city_code != null ? String(p.city_code) : '';
        // Resolve the DB zone_code the way the server geofence does: honor the
        // reparented-town override (by city name) before falling back to the
        // raw geojson city_code. This is what splits Midway from Millcreek and
        // makes a click resolve to the correct zone instead of its sibling.
        const zoneCode = (p.city && ZONE_CODE_BY_CITY[String(p.city)]) || cityCode;
        const info = zoneInfo.get(zoneCode) || {};
        const uninc = isUnincorporatedBeat(p);
        // Group/color by the RESOLVED zone code so reparented towns and the
        // unincorporated catch-alls render (and aggregate in the choropleth) as
        // their own zone rather than collapsing into a same-coded neighbor.
        const zone = zoneCode || 'UNK';
        const sector = info.sectorId || 'UNASSIGNED';
        const area = info.areaCode || 'UNASSIGNED';
        const zoneName = uninc
          ? unincorporatedZoneName(p, info.sectorName)
          : (info.zoneName || p.city || cityCode || '—');
        return {
          ...f,
          properties: {
            ...p,
            _uninc: uninc,
            _zone: zone,
            _zoneName: zoneName,
            _zoneColor: getZoneColor(zone),
            _sector: sector,
            _sectorName: info.sectorName || (sector === 'UNASSIGNED' ? 'Unassigned' : sector),
            _sectorColor: getSectorColor(sector),
            _area: area,
            _areaName: info.areaName || (area === 'UNASSIGNED' ? 'Unassigned' : area),
            _areaColor: getAreaColor(area),
          },
        };
      });
      // Draw order: unincorporated "-UNINC" catch-alls first so the
      // incorporated city beats render ON TOP of them — otherwise the big
      // county catch-all fill washes over the cities it overlaps.
      features.sort((a: any, b: any) =>
        (isUnincorporatedBeat(a.properties) ? 0 : 1) - (isUnincorporatedBeat(b.properties) ? 0 : 1));
      return { type: 'FeatureCollection', features };
    })();
  }
  return taggedBeatsPromise;
}

export function getCountyFC(): Promise<any> {
  if (!countyPromise) {
    countyPromise = fetch('/geojson/county.geojson').then((r) => r.json()).catch(() => ({ type: 'FeatureCollection', features: [] }));
  }
  return countyPromise;
}

export function getMunicipalityFC(): Promise<any> {
  if (!muniPromise) {
    muniPromise = fetch('/geojson/municipality.geojson').then((r) => r.json()).catch(() => ({ type: 'FeatureCollection', features: [] }));
  }
  return muniPromise;
}
