import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import LineString from 'ol/geom/LineString';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import { fromLonLat } from 'ol/proj';
import { apiFetch } from '../../../hooks/useApi';
import { devWarn } from '../../../utils/devLog';

interface TrailPoint {
  lat: number;
  lng: number;
  time?: string;
}

interface Trail {
  unit_id: number;
  call_sign: string;
  officer_name?: string;
  points: TrailPoint[];
}

const TRAIL_COLORS = [
  '#22c55e', '#60a5fa', '#f59e0b', '#a855f7', '#ec4899',
  '#14b8a6', '#fb923c', '#8b5cf6', '#10b981', '#fbbf24',
  '#ef4444', '#06b6d4',
];

function colorForUnit(callSign: string): string {
  let hash = 0;
  for (let i = 0; i < callSign.length; i++) {
    hash = ((hash << 5) - hash + callSign.charCodeAt(i)) | 0;
  }
  return TRAIL_COLORS[Math.abs(hash) % TRAIL_COLORS.length];
}

const MAX_POINTS_PER_TRAIL = 500; // protect renderer from runaway trails

/**
 * GPS breadcrumb trails for /map-v2.
 *
 * Fetches /dispatch/gps/trails?hours=N and renders one LineString per
 * unit, colored deterministically from its call_sign. Trail polylines
 * sit at z=40 (above beats, below drawing). Toggleable via layers panel.
 *
 * Refetches when hours changes or on initial visibility. Deliberately
 * NOT subscribed to live unit updates — breadcrumbs are a historical
 * playback view; rapid refetches would obscure the value of looking at
 * a stable trail. Page reload or manual refetch suffices.
 */
export function useOlBreadcrumbs(
  map: OlMap | null,
  opts: { visible: boolean; hours?: number },
): void {
  const layerRef = useRef<VectorLayer<Feature<Geometry>> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const hours = opts.hours ?? 8;

  useEffect(() => {
    if (!map || layerRef.current) return;
    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      visible: opts.visible,
      zIndex: 40,
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
    apiFetch<Trail[]>(`/dispatch/gps/trails?hours=${hours}`)
      .then((trails) => {
        if (cancelled || !sourceRef.current) return;
        const feats: Feature<Geometry>[] = [];
        for (const t of (trails || [])) {
          if (!Array.isArray(t.points) || t.points.length < 2) continue;
          const points = t.points.slice(0, MAX_POINTS_PER_TRAIL);
          const coords = points
            .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
            .map((p) => fromLonLat([p.lng, p.lat]));
          if (coords.length < 2) continue;
          const color = colorForUnit(t.call_sign);
          const f = new Feature({ geometry: new LineString(coords) });
          f.setStyle(new Style({
            stroke: new Stroke({ color, width: 2 }),
          }));
          f.set('call_sign', t.call_sign);
          f.set('officer_name', t.officer_name || '');
          feats.push(f);
        }
        sourceRef.current.clear();
        sourceRef.current.addFeatures(feats);
      })
      .catch((err) => devWarn('[map-v2] breadcrumb trails fetch failed:', err));
    return () => { cancelled = true; };
  }, [opts.visible, hours]);
}
