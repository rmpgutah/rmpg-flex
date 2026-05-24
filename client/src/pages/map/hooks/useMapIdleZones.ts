import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';

interface TrailPoint {
  lat: number;
  lng: number;
  time: string;
  status?: string;
}

interface UnitTrail {
  unit_id: number | string;
  call_sign: string;
  points: TrailPoint[];
}

interface UseMapIdleZonesParams {
  mapInstanceRef: React.MutableRefObject<mapboxgl.Map | null>;
  trails: UnitTrail[];
  enabled: boolean;
  minIdleSec?: number;
  clusterRadiusM?: number;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return Infinity;
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface IdleZone {
  callSign: string;
  lat: number;
  lng: number;
  radiusM: number;
  durationSec: number;
  startTime: string;
  endTime: string;
}

function findIdleZones(trail: UnitTrail, minIdleSec: number, clusterRadiusM: number): IdleZone[] {
  const pts = trail.points || [];
  const zones: IdleZone[] = [];
  if (pts.length < 2) return zones;
  let i = 0;
  while (i < pts.length) {
    const anchor = pts[i];
    let j = i + 1;
    while (j < pts.length && haversineMeters(anchor.lat, anchor.lng, pts[j].lat, pts[j].lng) <= clusterRadiusM) j++;
    const startT = Date.parse(pts[i].time);
    const endT = Date.parse(pts[j - 1].time);
    const durationSec = Number.isFinite(startT) && Number.isFinite(endT) ? (endT - startT) / 1000 : 0;
    if (durationSec >= minIdleSec && j - 1 > i) {
      let sumLat = 0, sumLng = 0;
      for (let k = i; k < j; k++) { sumLat += pts[k].lat; sumLng += pts[k].lng; }
      const cLat = sumLat / (j - i);
      const cLng = sumLng / (j - i);
      let maxR = 0;
      for (let k = i; k < j; k++) maxR = Math.max(maxR, haversineMeters(cLat, cLng, pts[k].lat, pts[k].lng));
      zones.push({ callSign: trail.call_sign, lat: cLat, lng: cLng, radiusM: Math.max(20, Math.min(clusterRadiusM, maxR)), durationSec, startTime: pts[i].time, endTime: pts[j - 1].time });
      i = j;
    } else i++;
  }
  return zones;
}

const IDLE_SOURCE = 'idle-zones-source';
const IDLE_LAYER = 'idle-zones-layer';

function circleToPolygon(center: [number, number], radiusM: number, segments = 32): [number, number][] {
  const coords: [number, number][] = [];
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center[1] * Math.PI / 180);
  const dLat = radiusM / metersPerDegLat;
  const dLng = radiusM / metersPerDegLng;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    coords.push([center[0] + dLng * Math.cos(angle), center[1] + dLat * Math.sin(angle)]);
  }
  return coords;
}

function removeLayer(map: mapboxgl.Map) {
  try {
    if (map.getLayer(IDLE_LAYER)) map.removeLayer(IDLE_LAYER);
    if (map.getSource(IDLE_SOURCE)) map.removeSource(IDLE_SOURCE);
  } catch { /* ignore */ }
}

export function useMapIdleZones({
  mapInstanceRef,
  trails,
  enabled,
  minIdleSec = 600,
  clusterRadiusM = 50,
}: UseMapIdleZonesParams) {
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    removeLayer(map);
    if (!enabled || !trails || trails.length === 0) return;

    const features: GeoJSON.Feature[] = [];

    for (const trail of trails) {
      const zones = findIdleZones(trail, minIdleSec, clusterRadiusM);
      for (const z of zones) {
        const poly = circleToPolygon([z.lng, z.lat], z.radiusM);
        features.push({
          type: 'Feature',
          properties: { callSign: z.callSign, durationSec: z.durationSec, startTime: z.startTime, endTime: z.endTime },
          geometry: { type: 'Polygon', coordinates: [poly] },
        });
      }
    }

    if (features.length === 0) return;

    map.addSource(IDLE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
      id: IDLE_LAYER,
      type: 'fill',
      source: IDLE_SOURCE,
      paint: {
        'fill-color': '#f59e0b',
        'fill-opacity': 0.22,
        'fill-outline-color': '#f59e0b',
      },
    });

    map.on('click', IDLE_LAYER, (e) => {
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties;
      if (!props) return;
      const minutes = Math.round(props.durationSec / 60);
      new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '220px', offset: 15 })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#e5e7eb;background:#0c0c0c;padding:6px 10px;min-width:160px;">` +
          `<div style="color:#f59e0b;font-weight:900;letter-spacing:0.1em;margin-bottom:4px;">IDLE ZONE</div>` +
          `<div>${props.callSign}</div>` +
          `<div style="color:#9ca3af;">${minutes} min${minutes === 1 ? '' : 's'} stationary</div>` +
          `<div style="font-size:9px;color:#6b7280;margin-top:4px;">${new Date(props.startTime).toLocaleTimeString()} — ${new Date(props.endTime).toLocaleTimeString()}</div>` +
          `</div>`
        )
        .addTo(map);
    });

    return () => removeLayer(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, trails, minIdleSec, clusterRadiusM]);
}