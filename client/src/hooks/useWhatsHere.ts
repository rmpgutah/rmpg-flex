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
import { toDisplayLabel } from '../utils/formatters';

interface PremiseIntel {
  callCount: number;
  incidentCount: number;
  calls?: { incident_type?: string; call_number?: string; created_at?: string }[];
  incidents?: { incident_type?: string; incident_number?: string; created_at?: string }[];
}

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

      // Render: geography + nearest address (statewide DB) + premise intel
      // (recent calls/incidents near the point — cross-system map<->dispatch).
      const render = (
        addr: string | null,
        dist: number | null,
        premise: PremiseIntel | null,
        loading: boolean,
      ) => {
        const rows = [...baseRows];
        if (addr) rows.push({ label: 'Nearest Addr', value: dist != null ? `${addr} (${dist} m)` : addr });
        else if (loading) rows.push({ label: 'Nearest Addr', value: '…' });
        let html = `<div style="font-family:'Courier New',monospace;color:#d4d4d4;font-size:11px;min-width:200px;">`;
        html += `<div style="font-weight:bold;font-size:11px;color:#d4a017;margin-bottom:4px;border-bottom:1px solid #444;padding-bottom:3px;letter-spacing:0.5px;">WHAT'S HERE</div>`;
        if (rows.length === 0) {
          html += `<div style="color:#888;font-size:10px;">No geography at this point.</div>`;
        } else {
          for (const r of rows) {
            const dot = r.color ? `<span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${r.color};margin-right:4px;vertical-align:middle;"></span>` : '';
            html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">${esc(r.label)}:</span> ${dot}<span style="color:#ddd;">${esc(r.value)}</span></div>`;
          }
        }
        // Premise intelligence band.
        if (premise && (premise.callCount > 0 || premise.incidentCount > 0)) {
          html += `<div style="margin-top:6px;padding-top:4px;border-top:1px solid #2a2a2a;">`;
          html += `<div style="font-size:8px;color:#888;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Premise History (≈275m)</div>`;
          html += `<div style="font-size:10px;color:#e8b84b;font-weight:bold;">${premise.callCount} prior call${premise.callCount === 1 ? '' : 's'} · ${premise.incidentCount} incident${premise.incidentCount === 1 ? '' : 's'}</div>`;
          const last = premise.calls?.[0];
          if (last) {
            const when = last.created_at ? String(last.created_at).slice(0, 10) : '';
            const lastType = last.incident_type ? toDisplayLabel(String(last.incident_type)) : String(last.call_number || '');
            html += `<div style="font-size:9px;color:#aaa;margin-top:2px;">Last: ${esc(lastType)}${when ? ' · ' + esc(when) : ''}</div>`;
          }
          html += `</div>`;
        } else if (loading) {
          html += `<div style="margin-top:6px;padding-top:4px;border-top:1px solid #2a2a2a;font-size:9px;color:#666;">Checking premise history…</div>`;
        }
        html += `<div style="margin-top:5px;padding-top:3px;border-top:1px solid #2a2a2a;font-size:8px;color:#666;">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`;
        html += `</div>`;
        pop.setLngLat(e.lngLat).setHTML(html).addTo(map);
      };

      const myId = ++seqRef.current;
      render(null, null, null, true);
      Promise.allSettled([
        apiFetch<{ results: { full_add: string; city: string; distance_m?: number }[] }>(`/geo/address-nearest?lat=${lat}&lng=${lng}`),
        apiFetch<PremiseIntel>(`/dispatch/geography/premise-intel?lat=${lat}&lng=${lng}`),
      ]).then(([addrRes, premRes]) => {
        if (myId !== seqRef.current) return; // a newer click superseded this
        const r = addrRes.status === 'fulfilled' ? addrRes.value?.results?.[0] : undefined;
        const premise = premRes.status === 'fulfilled' ? premRes.value : null;
        render(r ? `${r.full_add}${r.city ? ', ' + r.city : ''}` : null, r?.distance_m ?? null, premise, false);
      });
    };
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, [map]);
}
