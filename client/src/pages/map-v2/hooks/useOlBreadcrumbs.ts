import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import CircleStyle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import { fromLonLat } from 'ol/proj';
import { apiFetch } from '../../../hooks/useApi';
import { devWarn } from '../../../utils/devLog';
import { UNIT_STATUS_HEX } from '../../../utils/statusColors';
import type { UnitStatus } from '../../../types';

export interface BreadcrumbPoint {
  lat: number;
  lng: number;
  /** m/s */
  speed?: number | null;
  heading?: number | null;
  status?: string | null;
  call_number?: string | null;
  call_type?: string | null;
  time?: string;
  road_name?: string | null;
  intersection?: string | null;
  /** Set on render so the popup builder can show the unit context */
  call_sign?: string;
  officer_name?: string;
}

interface Trail {
  unit_id: number;
  call_sign: string;
  officer_name?: string;
  points: BreadcrumbPoint[];
}

export type BreadcrumbColorMode = 'unit' | 'speed' | 'status';

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

/** Speed in m/s → color band. Mirrors the v1 useMapBreadcrumbs palette
 *  so dispatchers see familiar colors. */
function colorForSpeed(mps: number | null | undefined): string {
  if (mps == null || !Number.isFinite(mps)) return '#666666';
  const mph = mps * 2.237;
  if (mph < 5) return '#3b82f6';   // idle / walking
  if (mph < 25) return '#22c55e';  // urban driving
  if (mph < 50) return '#f59e0b';  // highway
  return '#ef4444';                 // pursuit / code-3
}

function colorForStatus(status: string | null | undefined): string {
  if (!status) return '#888888';
  return UNIT_STATUS_HEX[status as UnitStatus] || '#888888';
}

const MAX_POINTS_PER_TRAIL = 500;

/**
 * GPS breadcrumb trails for /map-v2.
 *
 * Each trail is rendered as N-1 short LineString segments (one per
 * point pair) so each segment can be individually colored by the
 * selected colorMode (unit / speed / status). At each breadcrumb
 * point we also drop a tiny clickable Point marker carrying full
 * point context (speed, heading, status, time, call) — the shared
 * useOlFeaturePopup picks them up and shows a detail card.
 *
 * z=40 (above beats, below drawing). Toggleable + colorMode via the
 * layers panel. Refetches when hours/visible change. Not subscribed
 * to live unit updates (this is a historical playback view).
 */
export function useOlBreadcrumbs(
  map: OlMap | null,
  opts: {
    visible: boolean;
    hours?: number;
    colorMode?: BreadcrumbColorMode;
  },
): void {
  const layerRef = useRef<VectorLayer<Feature<Geometry>> | null>(null);
  const pointLayerRef = useRef<VectorLayer<Feature<Geometry>> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const pointSourceRef = useRef<VectorSource | null>(null);
  const hours = opts.hours ?? 8;
  const colorMode: BreadcrumbColorMode = opts.colorMode ?? 'unit';

  useEffect(() => {
    if (!map || layerRef.current) return;
    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({ source, visible: opts.visible, zIndex: 40 });
    layerRef.current = layer;
    map.addLayer(layer);

    const pointSource = new VectorSource();
    pointSourceRef.current = pointSource;
    const pointLayer = new VectorLayer({ source: pointSource, visible: opts.visible, zIndex: 41 });
    pointLayerRef.current = pointLayer;
    map.addLayer(pointLayer);

    return () => {
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
      if (pointLayerRef.current) { map.removeLayer(pointLayerRef.current); pointLayerRef.current = null; }
      sourceRef.current = null;
      pointSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    if (layerRef.current) layerRef.current.setVisible(opts.visible);
    if (pointLayerRef.current) pointLayerRef.current.setVisible(opts.visible);
  }, [opts.visible]);

  useEffect(() => {
    if (!opts.visible || !sourceRef.current || !pointSourceRef.current) return;
    let cancelled = false;
    apiFetch<Trail[]>(`/dispatch/gps/trails?hours=${hours}`)
      .then((trails) => {
        if (cancelled || !sourceRef.current || !pointSourceRef.current) return;
        const segFeats: Feature<Geometry>[] = [];
        const pointFeats: Feature<Geometry>[] = [];
        for (const t of (trails || [])) {
          if (!Array.isArray(t.points) || t.points.length < 2) continue;
          const points = t.points.slice(0, MAX_POINTS_PER_TRAIL);
          const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
          if (valid.length < 2) continue;

          const unitColor = colorForUnit(t.call_sign);

          // Render N-1 short segments so each can be colored individually.
          for (let i = 1; i < valid.length; i++) {
            const a = valid[i - 1];
            const b = valid[i];
            const segColor =
              colorMode === 'speed' ? colorForSpeed(b.speed)
              : colorMode === 'status' ? colorForStatus(b.status)
              : unitColor;
            const seg = new Feature({
              geometry: new LineString([
                fromLonLat([a.lng, a.lat]),
                fromLonLat([b.lng, b.lat]),
              ]),
            });
            seg.setStyle(new Style({ stroke: new Stroke({ color: segColor, width: 2.5 }) }));
            segFeats.push(seg);
          }

          // One Point per breadcrumb for click-to-popup. Slightly small
          // so they don't drown the map; same color as the leading segment.
          for (const p of valid) {
            const c = colorMode === 'speed'
              ? colorForSpeed(p.speed)
              : colorMode === 'status'
                ? colorForStatus(p.status)
                : unitColor;
            const pt = new Feature({ geometry: new Point(fromLonLat([p.lng, p.lat])) });
            pt.setStyle(new Style({
              image: new CircleStyle({
                radius: 2.5,
                fill: new Fill({ color: c }),
                stroke: new Stroke({ color: '#0a0a0a', width: 0.5 }),
              }),
            }));
            pt.set('kind', 'breadcrumb');
            pt.set('payload', {
              ...p,
              call_sign: t.call_sign,
              officer_name: t.officer_name || '',
            } as BreadcrumbPoint);
            pointFeats.push(pt);
          }
        }
        sourceRef.current.clear();
        sourceRef.current.addFeatures(segFeats);
        pointSourceRef.current.clear();
        pointSourceRef.current.addFeatures(pointFeats);
      })
      .catch((err) => devWarn('[map-v2] breadcrumb trails fetch failed:', err));
    return () => { cancelled = true; };
  }, [opts.visible, hours, colorMode]);
}
