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
import { getTaggedBeats, getCountyFC, getMunicipalityFC, findBeatAt } from '../pages/map/utils/districtGeoData';
import { apiFetch } from './useApi';

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
  // Monotonic click id — guards against an older nearest-address response
  // resolving after a newer click and overwriting the newer popup.
  const seqRef = useRef(0);

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

      // Beat: prefer the incorporated city beat over the UNINC county catch-all.
      const beat = findBeatAt(dataRef.current.beats?.features || [], lng, lat);
      const county = findContaining(dataRef.current.county, lng, lat);
      const muni = findContaining(dataRef.current.muni, lng, lat);

      const bp = beat?.properties || {};
      const baseRows: { label: string; value: string; color?: string }[] = [];
      if (beat) {
        baseRows.push({ label: 'Area', value: bp._areaName || '—', color: bp._areaColor });
        baseRows.push({ label: 'Section', value: bp._sectionName || '—', color: bp._sectionColor });
        baseRows.push({ label: 'Zone', value: bp._zoneName || '—', color: bp._zoneColor });
        baseRows.push({ label: 'Beat', value: bp.beat_code || bp.beat_id || '—' });
      }
      if (county) baseRows.push({ label: 'County', value: county.properties?.NAME || '—' });
      if (muni) baseRows.push({ label: 'Municipality', value: muni.properties?.NAME || '—' });

      // Render with the nearest address resolved asynchronously from the
      // statewide address DB (/api/geo/address-nearest) — works everywhere,
      // independent of whether the address overlay is toggled on.
      const render = (addr: string | null, dist: number | null, loading: boolean) => {
        const rows = [...baseRows];
        if (addr) rows.push({ label: 'Nearest Addr', value: dist != null ? `${addr} (${dist} m)` : addr });
        else if (loading) rows.push({ label: 'Nearest Addr', value: '…' });
        let html = `<div style="font-family:'Courier New',monospace;color:#d4d4d4;font-size:11px;min-width:190px;">`;
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

      const myId = ++seqRef.current;
      render(null, null, true);
      apiFetch<{ results: { full_add: string; city: string; distance_m?: number }[] }>(`/geo/address-nearest?lat=${lat}&lng=${lng}`)
        .then((d) => {
          if (myId !== seqRef.current) return; // a newer click superseded this
          const r = d?.results?.[0];
          render(r ? `${r.full_add}${r.city ? ', ' + r.city : ''}` : null, r?.distance_m ?? null, false);
        })
        .catch(() => { if (myId === seqRef.current) render(null, null, false); });
    };
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, [map]);
}
