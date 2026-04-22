import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import Circle from 'ol/geom/Circle';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Style from 'ol/style/Style';
import StrokeStyle from 'ol/style/Stroke';
import FillStyle from 'ol/style/Fill';
import { fromLonLat, getPointResolution } from 'ol/proj';
import { apiFetch } from '../../../hooks/useApi';
import { devWarn } from '../../../utils/devLog';

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Build an OL Circle geometry that appears as `radiusMeters` meters wide
 * regardless of view projection distortion. EPSG:3857 over-estimates
 * distances at higher latitudes; getPointResolution corrects for it.
 */
function metersCircle(centerLonLat: [number, number], radiusMeters: number): Circle {
  const center = fromLonLat(centerLonLat);
  const resolution = getPointResolution('EPSG:3857', 1, center);
  return new Circle(center, radiusMeters / resolution);
}

// ─── Safety zones (incident risk) ───────────────────────────

interface SafetyZone {
  latitude: number;
  longitude: number;
  risk_level: 'high' | 'moderate';
  weapons_count?: number;
  dv_count?: number;
  injuries_count?: number;
  total_flagged?: number;
}

const SAFETY_ZONE_RADIUS_M: Record<SafetyZone['risk_level'], number> = {
  high: 800,
  moderate: 400,
};
const SAFETY_ZONE_STYLE: Record<SafetyZone['risk_level'], Style> = {
  high: new Style({
    stroke: new StrokeStyle({ color: '#ef4444', width: 2 }),
    fill: new FillStyle({ color: '#ef444422' }),
  }),
  moderate: new Style({
    stroke: new StrokeStyle({ color: '#f59e0b', width: 1.5 }),
    fill: new FillStyle({ color: '#f59e0b1a' }),
  }),
};

export function useOlSafetyZones(
  map: OlMap | null,
  opts: { visible: boolean; days?: number },
): void {
  const layerRef = useRef<VectorLayer<Feature<Geometry>> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const days = opts.days ?? 90;

  useEffect(() => {
    if (!map || layerRef.current) return;
    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      visible: opts.visible,
      zIndex: 60, // above beats, below drawing
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
    apiFetch<{ zones: SafetyZone[] } | SafetyZone[]>(
      `/dispatch/heatmap/safety-zones?days=${days}`,
    )
      .then((data) => {
        if (cancelled || !sourceRef.current) return;
        const zones: SafetyZone[] = Array.isArray(data) ? data : (data?.zones || []);
        const feats: Feature<Geometry>[] = [];
        for (const z of zones) {
          if (typeof z.latitude !== 'number' || typeof z.longitude !== 'number') continue;
          const radius = SAFETY_ZONE_RADIUS_M[z.risk_level] || 400;
          const f = new Feature({ geometry: metersCircle([z.longitude, z.latitude], radius) });
          f.setStyle(SAFETY_ZONE_STYLE[z.risk_level] || SAFETY_ZONE_STYLE.moderate);
          f.set('risk', z.risk_level);
          f.set('flagged', z.total_flagged ?? 0);
          feats.push(f);
        }
        sourceRef.current.clear();
        sourceRef.current.addFeatures(feats);
      })
      .catch((err) => devWarn('[map-v2] safety zones fetch failed:', err));
    return () => { cancelled = true; };
  }, [opts.visible, days]);
}

// ─── Enforcement clusters ───────────────────────────────────

interface EnforcementCluster {
  lat: number;
  lng: number;
  total: number;
  top_statutes?: string;
}

const ENFORCEMENT_STYLE = (total: number): Style => {
  const intensity = Math.min(1, total / 50); // saturate at 50 cites
  const alpha = Math.floor(0x33 + intensity * 0x66).toString(16).padStart(2, '0');
  return new Style({
    stroke: new StrokeStyle({ color: '#a855f7', width: 1.5 }),
    fill: new FillStyle({ color: `#a855f7${alpha}` }),
  });
};

export function useOlEnforcementClusters(
  map: OlMap | null,
  opts: { visible: boolean; type?: string; days?: number },
): void {
  const layerRef = useRef<VectorLayer<Feature<Geometry>> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const type = opts.type ?? 'all';
  const days = opts.days ?? 30;

  useEffect(() => {
    if (!map || layerRef.current) return;
    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      visible: opts.visible,
      zIndex: 61,
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
    apiFetch<EnforcementCluster[]>(
      `/dispatch/heatmap/enforcement?type=${encodeURIComponent(type)}&days=${days}`,
    )
      .then((data) => {
        if (cancelled || !sourceRef.current) return;
        const clusters: EnforcementCluster[] = Array.isArray(data) ? data : [];
        const feats: Feature<Geometry>[] = [];
        for (const c of clusters) {
          if (typeof c.lat !== 'number' || typeof c.lng !== 'number') continue;
          // Radius proportional to count, 100m..600m
          const radius = Math.min(600, 100 + c.total * 8);
          const f = new Feature({ geometry: metersCircle([c.lng, c.lat], radius) });
          f.setStyle(ENFORCEMENT_STYLE(c.total));
          f.set('total', c.total);
          f.set('top_statutes', c.top_statutes || '');
          feats.push(f);
        }
        sourceRef.current.clear();
        sourceRef.current.addFeatures(feats);
      })
      .catch((err) => devWarn('[map-v2] enforcement clusters fetch failed:', err));
    return () => { cancelled = true; };
  }, [opts.visible, type, days]);
}
