import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import Polygon from 'ol/geom/Polygon';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import { fromLonLat } from 'ol/proj';
import { apiFetch } from '../../../hooks/useApi';
import { devWarn } from '../../../utils/devLog';

interface Geofence {
  id: number;
  name: string;
  zone_type?: string;
  polygon_coords?: string; // JSON: [{lat, lng}, ...]
  color?: string;
  is_active?: number;
  alert_on_enter?: number;
  alert_on_exit?: number;
}

const ZONE_TYPE_COLORS: Record<string, string> = {
  general: '#888888',
  high_priority: '#ef4444',
  caution: '#f59e0b',
  restricted: '#a855f7',
  patrol: '#22c55e',
  school: '#06b6d4',
  hospital: '#ec4899',
  trespass: '#fb923c',
};

function parsePolygonCoords(coordStr: string | undefined): { lat: number; lng: number }[] {
  if (!coordStr) return [];
  try {
    const parsed = JSON.parse(coordStr);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((p: any) => p?.lat != null && p?.lng != null)
        .map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    }
  } catch {
    // Fallback: "lat,lng;lat,lng;..." format
    return coordStr.split(';').map((pair) => {
      const [lat, lng] = pair.split(',').map(Number);
      return { lat, lng };
    }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }
  return [];
}

/**
 * Persisted geofence polygons (read-only) for /map-v2.
 *
 * Fetches /api/map/geofences (active only by default) and renders each
 * geofence as a Polygon, colored by zone_type with the geofence's own
 * color as fallback. Click → popup with geofence name + zone type +
 * alert flags (kind='geofence' registered in useOlFeaturePopup).
 *
 * Read-only this PR — drawing/editing/deleting geofences ports later.
 * z=15 (above beats at 10, below tactical circles at 60).
 */
export function useOlGeofences(map: OlMap | null, opts: { visible: boolean }): void {
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);

  useEffect(() => {
    if (!map || layerRef.current) return;
    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      visible: opts.visible,
      zIndex: 15,
    });
    layerRef.current = layer;
    map.addLayer(layer);
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      sourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    if (layerRef.current) layerRef.current.setVisible(opts.visible);
  }, [opts.visible]);

  useEffect(() => {
    if (!opts.visible || !sourceRef.current) return;
    let cancelled = false;
    apiFetch<Geofence[]>('/map/geofences')
      .then((data) => {
        if (cancelled || !sourceRef.current) return;
        const fences = Array.isArray(data) ? data : [];
        const feats: Feature<Geometry>[] = [];
        for (const fence of fences) {
          const path = parsePolygonCoords(fence.polygon_coords);
          if (path.length < 3) continue;
          const ringLonLat = path.map((p) => fromLonLat([p.lng, p.lat]));
          // Close the ring if not already
          const first = ringLonLat[0];
          const last = ringLonLat[ringLonLat.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            ringLonLat.push(first);
          }
          const color = ZONE_TYPE_COLORS[fence.zone_type?.toLowerCase() || 'general']
            || fence.color
            || '#888888';
          const f = new Feature({ geometry: new Polygon([ringLonLat]) });
          f.setStyle(new Style({
            stroke: new Stroke({ color, width: 1.5 }),
            fill: new Fill({ color: `${color}22` }),
          }));
          f.setId(`geofence:${fence.id}`);
          f.set('kind', 'geofence');
          f.set('payload', fence);
          feats.push(f);
        }
        sourceRef.current.clear();
        sourceRef.current.addFeatures(feats);
      })
      .catch((err) => devWarn('[map-v2] geofences fetch failed:', err));
    return () => { cancelled = true; };
  }, [opts.visible]);
}
