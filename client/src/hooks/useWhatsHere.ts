// ============================================================
// RMPG Flex — "What's Here" unified spatial query
// ============================================================
// When active, clicking anywhere on the map resolves the full geography
// stack at that point in one popup: Area › Section › Zone › Beat (point-
// in-polygon against beat geometry), County, Municipality, plus the
// nearest statewide address point if that overlay is on. Turns every
// overlay into a single point-and-identify dispatch tool.
//
// Uses turf point-in-polygon against the loaded FeatureCollections (works
// regardless of which layers are toggled on), and queryRenderedFeatures
// for the address point (which is only available where that vector layer
// is actually drawn).
// ============================================================

import { useEffect, useRef } from 'react';
import { mapboxgl } from '../utils/mapboxLoader';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { getTaggedBeats, getCountyFC, getMunicipalityFC } from '../pages/map/utils/districtGeoData';

function findContaining(fc: any, lng: number, lat: number): any | null {
  if (!fc || !Array.isArray(fc.features)) return null;
  const pt = { type: 'Point', coordinates: [lng, lat] } as any;
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    try {
      if (booleanPointInPolygon(pt, f as any)) return f;
    } catch { /* skip malformed */ }
  }
  return null;
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface Opts { map: mapboxgl.Map | null; popup: mapboxgl.Popup | null; active: boolean; }

export function useWhatsHere({ map, popup, active }: Opts) {
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  const popupRef = useRef(popup);
  useEffect(() => { popupRef.current = popup; }, [popup]);
  const dataRef = useRef<{ beats?: any; county?: any; muni?: any }>({});

  // Warm the polygon datasets the first time the tool is switched on.
  useEffect(() => {
    if (!active) return;
    getTaggedBeats().then((fc) => { dataRef.current.beats = fc; }).catch(() => {});
    getCountyFC().then((fc) => { dataRef.current.county = fc; }).catch(() => {});
    getMunicipalityFC().then((fc) => { dataRef.current.muni = fc; }).catch(() => {});
  }, [active]);

  useEffect(() => {
    if (!map) return;
    const handler = (e: mapboxgl.MapMouseEvent) => {
      if (!activeRef.current) return;
      const pop = popupRef.current;
      if (!pop) return;
      const lng = e.lngLat.lng;
      const lat = e.lngLat.lat;

      const beat = findContaining(dataRef.current.beats, lng, lat);
      const county = findContaining(dataRef.current.county, lng, lat);
      const muni = findContaining(dataRef.current.muni, lng, lat);

      // Nearest address point — only resolvable where the statewide address
      // layer is actually rendered (z14+ with the layer on).
      let address: string | null = null;
      try {
        const box: [mapboxgl.PointLike, mapboxgl.PointLike] = [
          [e.point.x - 12, e.point.y - 12],
          [e.point.x + 12, e.point.y + 12],
        ];
        const feats = map.getLayer('vt-utah_addresses-circle')
          ? map.queryRenderedFeatures(box, { layers: ['vt-utah_addresses-circle'] })
          : [];
        if (feats && feats.length) {
          const fa = feats[0].properties?.FullAdd || feats[0].properties?.City;
          if (fa) address = String(fa);
        }
      } catch { /* address layer not present */ }

      const bp = beat?.properties || {};
      const rows: { label: string; value: string; color?: string }[] = [];
      if (beat) {
        rows.push({ label: 'Area', value: bp._areaName || '—', color: bp._areaColor });
        rows.push({ label: 'Section', value: bp._sectionName || '—', color: bp._sectionColor });
        rows.push({ label: 'Zone', value: bp._zoneName || '—', color: bp._zoneColor });
        rows.push({ label: 'Beat', value: bp.beat_code || bp.beat_id || '—' });
      }
      if (county) rows.push({ label: 'County', value: county.properties?.NAME || '—' });
      if (muni) rows.push({ label: 'Municipality', value: muni.properties?.NAME || '—' });
      if (address) rows.push({ label: 'Nearest Addr', value: address });

      let html = `<div style="font-family:'Courier New',monospace;color:#d4d4d4;font-size:11px;min-width:180px;">`;
      html += `<div style="font-weight:bold;font-size:11px;color:#d4a017;margin-bottom:4px;border-bottom:1px solid #444;padding-bottom:3px;letter-spacing:0.5px;">WHAT'S HERE</div>`;
      if (rows.length === 0) {
        html += `<div style="color:#888;font-size:10px;">No geography at this point.</div>`;
      } else {
        for (const r of rows) {
          const dot = r.color ? `<span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${r.color};margin-right:4px;vertical-align:middle;"></span>` : '';
          html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">${esc(r.label)}:</span> ${dot}<span style="color:#ddd;">${esc(r.value)}</span></div>`;
        }
      }
      html += `<div style="margin-top:5px;padding-top:3px;border-top:1px solid #2a2a2a;font-size:8px;color:#666;">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`;
      html += `</div>`;
      pop.setLngLat(e.lngLat).setHTML(html).addTo(map);
    };
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, [map]);
}
