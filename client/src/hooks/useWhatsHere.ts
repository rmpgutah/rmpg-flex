// ============================================================
// RMPG Flex — "What's Here" unified spatial query
// ============================================================
// When active, clicking anywhere on the map resolves the full geography
// stack at that point in one popup: Area › Sector › Zone › Beat (point-
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
import { classifyPtType, type PropertyType } from '../pages/map/utils/landTypes';
import { getAerialThumbUrl, getStreetPerspectiveUrl, findStreetImage, findNearestRoadBearing, warmImageryToken, compassCardinal, distanceAndBearing, type StreetImage } from '../utils/locationImagery';
import type { StreetViewTarget } from '../pages/map/components/StreetViewLightbox';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';

/** Live device position the popup uses for the nav-to-point readout. */
export interface WhatsHereGps { latitude: number | null; longitude: number | null; speed: number | null; }

// ETA model — the one genuinely tunable business choice in this readout. When
// the unit is moving we use its real ground speed; when stationary (just parked
// / clicked from the office) GPS speed is ~0, so we fall back to an assumed
// patrol cruise so the ETA stays meaningful rather than "∞". Surface-street
// patrol average ≈ 13.4 m/s (30 mph). Tune ASSUMED_PATROL_SPEED_MS to taste.
const ASSUMED_PATROL_SPEED_MS = 13.4;
function etaSeconds(distanceM: number, speedMs: number | null): number {
  const v = speedMs != null && speedMs > 2 ? speedMs : ASSUMED_PATROL_SPEED_MS;
  return distanceM / v;
}
function fmtEta(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1609.34).toFixed(1)} mi`;
}

interface PremiseIntel {
  callCount: number;
  incidentCount: number;
  calls?: { incident_type?: string; call_number?: string; created_at?: string }[];
  incidents?: { incident_type?: string; incident_number?: string; created_at?: string }[];
}

interface NearestAddr {
  full_add: string;
  city?: string;
  zip?: string | number;
  county?: string;
  distance_m?: number;
}

// The address-point vector layer id (useVectorTileLayers circleLayerId).
const ADDRESS_POINT_LAYER = 'vt-utah_addresses-circle';

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

interface Opts {
  map: mapboxgl.Map | null;
  popup: mapboxgl.Popup | null;
  active: boolean;
  /** Live device position — powers the nav-to-point (distance/bearing/ETA) row. */
  gps?: WhatsHereGps | null;
  /** Open the full interactive street-view lightbox for a clicked point. */
  onOpenStreetView?: (target: StreetViewTarget) => void;
}

export function useWhatsHere({ map, popup, active, gps, onOpenStreetView }: Opts) {
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  const popupRef = useRef(popup);
  useEffect(() => { popupRef.current = popup; }, [popup]);
  const onOpenRef = useRef(onOpenStreetView);
  useEffect(() => { onOpenRef.current = onOpenStreetView; }, [onOpenStreetView]);
  // Latest GPS read via ref so the click handler + nav patcher always see the
  // current fix without re-binding the map click listener on every GPS tick.
  const gpsRef = useRef<WhatsHereGps | null | undefined>(gps);
  useEffect(() => { gpsRef.current = gps; }, [gps]);
  // The point the popup is currently describing — drives the live nav readout
  // and the street-view lightbox target after the click resolves.
  const lastTargetRef = useRef<StreetViewTarget | null>(null);
  const dataRef = useRef<{ beats?: any; county?: any; muni?: any }>({});
  // Monotonic click id — guards against an older nearest-address response
  // resolving after a newer click and overwriting the newer popup.
  const seqRef = useRef(0);
  const streetAbortRef = useRef<AbortController | null>(null);

  // Warm the polygon datasets + imagery token the first time the tool is on.
  useEffect(() => {
    if (!active) return;
    getTaggedBeats().then((fc) => { dataRef.current.beats = fc; }).catch(() => {});
    getCountyFC().then((fc) => { dataRef.current.county = fc; }).catch(() => {});
    getMunicipalityFC().then((fc) => { dataRef.current.muni = fc; }).catch(() => {});
    warmImageryToken();
  }, [active]);

  // Patch the live nav-to-point row (distance · bearing · ETA) in the open
  // popup from the latest GPS fix, without re-rendering the whole popup. Returns
  // true if the row exists (popup open + has the nav block).
  const patchNav = (): boolean => {
    const pop = popupRef.current;
    const tgt = lastTargetRef.current;
    if (!pop || !tgt) return false;
    const root = pop.getElement?.();
    const distEl = root?.querySelector('#wh-nav-dist') as HTMLElement | null;
    if (!distEl) return false;
    const bearEl = root?.querySelector('#wh-nav-bear') as HTMLElement | null;
    const etaEl = root?.querySelector('#wh-nav-eta') as HTMLElement | null;
    const arrowEl = root?.querySelector('#wh-nav-arrow') as HTMLElement | null;
    const g = gpsRef.current;
    if (!g || g.latitude == null || g.longitude == null) {
      distEl.textContent = 'GPS off';
      if (bearEl) bearEl.textContent = '';
      if (etaEl) etaEl.textContent = '';
      return true;
    }
    const { distanceM, bearing } = distanceAndBearing(g.longitude, g.latitude, tgt.lng, tgt.lat);
    distEl.textContent = fmtDist(distanceM);
    if (bearEl) bearEl.textContent = `${compassCardinal(bearing)} ${Math.round(bearing)}°`;
    if (etaEl) etaEl.textContent = `ETA ${fmtEta(etaSeconds(distanceM, g.speed))}`;
    if (arrowEl) arrowEl.style.transform = `rotate(${bearing}deg)`;
    return true;
  };

  // Re-patch the nav row whenever a new fix arrives (≈1/s) while the popup is open.
  useEffect(() => { patchNav(); }, [gps?.latitude, gps?.longitude, gps?.speed]); // eslint-disable-line react-hooks/exhaustive-deps

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
        baseRows.push({ label: 'Sector', value: bp._sectorName || '—', color: bp._sectorColor });
        baseRows.push({ label: 'Zone', value: bp._zoneName || '—', color: bp._zoneColor });
        baseRows.push({ label: 'Beat', value: bp.beat_code || bp.beat_id || '—' });
      }
      if (county) baseRows.push({ label: 'County', value: county.properties?.NAME || '—' });
      if (muni) baseRows.push({ label: 'Municipality', value: muni.properties?.NAME || '—' });

      // Building/property type: best-effort read of the statewide address point
      // under the cursor. Only available when the Address Points layer is on and
      // rendered at this zoom — exactly when the operator wants structure detail.
      let ptType: PropertyType | null = null;
      try {
        if (hasLayer(map, ADDRESS_POINT_LAYER)) {
          const box: [mapboxgl.PointLike, mapboxgl.PointLike] = [
            [e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6],
          ];
          const feats = map.queryRenderedFeatures(box, { layers: [ADDRESS_POINT_LAYER] });
          const props = feats && feats[0] ? feats[0].properties : null;
          if (props && props.PtType != null) ptType = classifyPtType(props.PtType);
        }
      } catch { /* layer not ready */ }

      // The AERIAL is supporting top-down context (pure string construction, no
      // network). The PERSPECTIVE bearing is set per-render so it can be aimed
      // at the building once we know the street-photo's facing direction.
      const aerialUrl = getAerialThumbUrl(lng, lat, { zoom: 17, width: 248, height: 72 });

      // Render: visual (aerial + street-level) + geography + nearest address
      // (statewide DB) + premise intel (recent calls/incidents — map<->dispatch).
      const render = (
        nearest: NearestAddr | null,
        premise: PremiseIntel | null,
        street: StreetImage | null,
        loading: boolean,
        roadBearing?: number | null,
      ) => {
        const rows = [...baseRows];
        if (nearest) {
          const cityZip = [nearest.city, nearest.zip != null ? String(nearest.zip) : '']
            .filter((x) => x && String(x).trim()).join(' ');
          const distStr = nearest.distance_m != null ? ` (${nearest.distance_m} m)` : '';
          rows.push({ label: 'Nearest Addr', value: `${nearest.full_add}${distStr}` });
          if (cityZip) rows.push({ label: 'City / ZIP', value: cityZip });
        } else if (loading) {
          rows.push({ label: 'Nearest Addr', value: '…' });
        }

        // Aim the oblique perspective at the building: prefer the bearing FROM a
        // found street photo TO the address; else the nearest-road bearing
        // (Tilequery); else the default angle.
        const faceBearing = street?.bearingToAddress ?? roadBearing ?? undefined;
        const perspectiveUrl = getStreetPerspectiveUrl(lng, lat, {
          width: 248, height: 150,
          ...(faceBearing != null ? { bearing: faceBearing } : {}),
        });
        const facingLabel = faceBearing != null
          ? `FACING ${compassCardinal(faceBearing)} → ADDRESS`
          : '';

        const hasImg = !!(street?.thumbUrl || perspectiveUrl || aerialUrl);
        let html = `<div style="font-family:'Arial, sans-serif';color:#d4d4d4;font-size:11px;min-width:${hasImg ? 248 : 200}px;padding:9px 10px 8px;">`;
        html += `<div style="font-weight:bold;font-size:11px;color:#d4a017;margin-bottom:4px;border-bottom:1px solid #444;padding-bottom:3px;letter-spacing:0.5px;">WHAT'S HERE</div>`;

        // Visual band — a GROUND view always leads:
        //   • real Mapillary street photo if coverage exists (true ground level)
        //   • else the Mapbox oblique 3D perspective, aimed at the building front
        // followed by the small top-down aerial for context. The street/
        // perspective frame is a button that opens the interactive lightbox.
        if (hasImg) {
          const expandHint = `<div style="position:absolute;top:3px;right:3px;background:rgba(0 0 0 / 0.6);color:#d4a017;font-size:7px;font-weight:bold;letter-spacing:0.06em;padding:1px 4px;border-radius:2px;">⤢ EXPAND</div>`;
          if (street?.thumbUrl) {
            const ago = street.capturedAt ? new Date(street.capturedAt).toISOString().slice(0, 10) : '';
            const meta = [ago, street.distanceM != null ? `${street.distanceM}m` : ''].filter(Boolean).join(' · ');
            html += `<div data-rmpg-streetview="1" style="position:relative;margin-bottom:5px;cursor:pointer;"><img src="${esc(street.thumbUrl)}" alt="street-level" style="width:248px;height:150px;object-fit:cover;border-radius:2px;display:block;border:1px solid #333;" onerror="this.style.display='none';this.nextElementSibling.style.display='none'"/>${expandHint}`
              + `<div style="font-size:7px;color:#777;letter-spacing:0.06em;margin-top:1px;">STREET-LEVEL · MAPILLARY${meta ? ' · ' + esc(meta) : ''}</div></div>`;
          } else if (perspectiveUrl) {
            html += `<div data-rmpg-streetview="1" style="position:relative;margin-bottom:5px;cursor:pointer;"><img src="${esc(perspectiveUrl)}" alt="street perspective" style="width:248px;height:150px;object-fit:cover;border-radius:2px;display:block;border:1px solid #333;" onerror="this.style.display='none';this.nextElementSibling.style.display='none'"/>${expandHint}`
              + `<div style="font-size:7px;color:#777;letter-spacing:0.06em;margin-top:1px;">STREET VIEW · 3D PERSPECTIVE${facingLabel ? ' · ' + facingLabel : ''}${loading ? ' · CHECKING STREET PHOTO…' : ''}</div></div>`;
          }
          if (aerialUrl) {
            html += `<div style="margin-bottom:5px;"><img src="${esc(aerialUrl)}" alt="aerial" style="width:248px;height:72px;object-fit:cover;border-radius:2px;display:block;border:1px solid #333;" onerror="this.style.display='none';this.nextElementSibling.style.display='none'"/>`
              + `<div style="font-size:7px;color:#777;letter-spacing:0.06em;margin-top:1px;">AERIAL · SATELLITE</div></div>`;
          }
        }

        // Property/building type chip.
        if (ptType) {
          html += `<div style="margin-bottom:4px;"><span style="display:inline-block;font-size:8px;font-weight:bold;letter-spacing:0.4px;color:#0a0a0a;background:${ptType.color};border-radius:2px;padding:1px 5px;">${esc(ptType.code)} · ${esc(ptType.label).toUpperCase()}</span></div>`;
        }

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
        // Live NAV-TO-POINT band — distance · bearing · ETA from the operator's
        // moving device to this point. Spans are id'd so patchNav() updates them
        // ~1/s as new fixes arrive, without re-rendering the popup.
        html += `<div style="margin-top:6px;padding-top:4px;border-top:1px solid #2a2a2a;">`;
        html += `<div style="font-size:8px;color:#888;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;display:flex;align-items:center;gap:4px;">`
          + `<span id="wh-nav-arrow" style="display:inline-block;color:#d4a017;font-size:11px;line-height:1;transition:transform .3s ease;">↑</span> Nav to point</div>`;
        html += `<div style="font-size:11px;color:#e8b84b;font-weight:bold;font-family:'Arial, sans-serif';">`
          + `<span id="wh-nav-dist">…</span><span style="color:#666;"> · </span>`
          + `<span id="wh-nav-bear" style="color:#bbb;"></span><span style="color:#666;"> · </span>`
          + `<span id="wh-nav-eta" style="color:#9ad29a;"></span></div>`;
        html += `</div>`;

        html += `<div style="margin-top:5px;padding-top:3px;border-top:1px solid #2a2a2a;font-size:8px;color:#666;">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`;
        html += `</div>`;
        pop.setLngLat(e.lngLat).setHTML(html).addTo(map);

        // Record what the popup describes (for live nav + lightbox), then wire
        // the expand-to-street-view click. setHTML replaced the DOM, so the
        // listener is (re)attached every render.
        lastTargetRef.current = {
          lng, lat,
          label: nearest?.full_add,
          imageId: street?.id,
          bearingToAddress: faceBearing,
        };
        const root = pop.getElement?.();
        const svEl = root?.querySelector('[data-rmpg-streetview="1"]') as HTMLElement | null;
        if (svEl) {
          svEl.onclick = () => {
            if (lastTargetRef.current) onOpenRef.current?.(lastTargetRef.current);
          };
        }
        patchNav();
      };

      const myId = ++seqRef.current;
      render(null, null, null, true);
      apiFetch<{ results: { full_add: string; city: string; distance_m?: number }[] }>(`/geo/address-nearest?lat=${lat}&lng=${lng}`)
        .then((d) => {
          if (myId !== seqRef.current) return; // a newer click superseded this
          const r = d?.results?.[0];
          render(r, null, null, false);
        })
        .catch(() => { if (myId === seqRef.current) render(null, null, null, false); });
    };
    map.on('click', handler);
    return () => { map.off('click', handler); streetAbortRef.current?.abort(); };
  }, [map]);
}
