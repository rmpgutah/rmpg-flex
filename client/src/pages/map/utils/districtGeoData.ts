// ============================================================
// RMPG Flex — Shared district / boundary geo-data loader
// ============================================================
// Module-level cached loaders for the polygon datasets the advanced
// overlay features share (district hierarchy layers, the "What's Here"
// spatial query, and the activity choropleth). Each dataset is fetched +
// processed at most once per page load; callers await the same promise.
//
// `getTaggedBeats()` returns the 719 beat polygons with the full
// Area/Section/Zone hierarchy + display colors baked onto each feature's
// properties (joined to /dispatch/geography/districts on
// city_code == zone_id, the key the rest of the map assumes).
// ============================================================

import { getCityColor, getSectionColor } from '../../../hooks/useGeoJsonLayers';
import { apiFetch } from '../../../hooks/useApi';

export const AREA_PALETTE = ['#d4a017', '#22c55e', '#ef4444', '#a855f7', '#f59e0b', '#14b8a6', '#ec4899', '#84cc16', '#fb923c', '#eab308'];

export function getAreaColor(code: string): string {
  if (!code) return AREA_PALETTE[0];
  let h = 0;
  for (let i = 0; i < code.length; i++) h = ((h << 5) - h + code.charCodeAt(i)) | 0;
  return AREA_PALETTE[Math.abs(h) % AREA_PALETTE.length];
}

export interface TaggedBeatProps {
  _zone: string; _zoneName: string; _zoneColor: string;
  _section: string; _sectionName: string; _sectionColor: string;
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
        const city = p.city_code != null ? String(p.city_code) : '';
        const info = zoneInfo.get(city) || {};
        const zone = city || 'UNK';
        const section = info.sectorId || 'UNASSIGNED';
        const area = info.areaCode || 'UNASSIGNED';
        return {
          ...f,
          properties: {
            ...p,
            _zone: zone,
            _zoneName: info.zoneName || p.city || city,
            _zoneColor: getCityColor(zone),
            _section: section,
            _sectionName: info.sectorName || (section === 'UNASSIGNED' ? 'Unassigned' : section),
            _sectionColor: getSectionColor(section),
            _area: area,
            _areaName: info.areaName || (area === 'UNASSIGNED' ? 'Unassigned' : area),
            _areaColor: getAreaColor(area),
          },
        };
      });
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
