import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import Point from 'ol/geom/Point';
import HeatmapLayer from 'ol/layer/Heatmap';
import VectorSource from 'ol/source/Vector';
import { fromLonLat } from 'ol/proj';
import { apiFetch } from '../../../hooks/useApi';
import { devWarn } from '../../../utils/devLog';

export type HeatmapMode = 'all' | 'risk' | 'type';

export interface OlHeatmapOptions {
  visible: boolean;
  days?: number;          // default 30
  mode?: HeatmapMode;     // default 'all'
  typeFilter?: string;    // only used when mode === 'type'
  /** Heat radius in px (OL default 8 — increase for sparse dispatch areas) */
  radius?: number;
  /** Blur radius in px (OL default 15) */
  blur?: number;
}

interface HeatmapPoint {
  lat?: number; latitude?: number;
  lng?: number; longitude?: number;
  weight?: number; intensity?: number;
}

/**
 * Call-density heatmap on /map-v2.
 *
 * Fetches /dispatch/heatmap with days+mode+type params, builds OL Point
 * features with normalized weights, and feeds them into ol/layer/Heatmap.
 *
 * Visibility toggles via setVisible() — no refetch when only `visible`
 * changes. Refetches when days/mode/typeFilter change OR when first
 * becoming visible (initial fetch is gated on visible to avoid pulling
 * potentially-large datasets when the user hasn't asked for them).
 */
export function useOlHeatmap(map: OlMap | null, opts: OlHeatmapOptions): void {
  const layerRef = useRef<HeatmapLayer<Feature<Geometry>> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const days = opts.days ?? 30;
  const mode = opts.mode ?? 'all';

  // Mount once
  useEffect(() => {
    if (!map || layerRef.current) return;
    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new HeatmapLayer({
      source,
      radius: opts.radius ?? 12,
      blur: opts.blur ?? 18,
      visible: opts.visible,
      zIndex: 70, // above beats (10) + drawing (50), below markers (100)
      weight: (feature) => {
        const w = feature.get('weight');
        return typeof w === 'number' ? Math.max(0, Math.min(1, w)) : 0.5;
      },
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

  // Visibility toggle (cheap)
  useEffect(() => {
    if (layerRef.current) layerRef.current.setVisible(opts.visible);
  }, [opts.visible]);

  // Refetch when params change AND layer is visible. Skipped when invisible
  // so we don't pull data the user can't see.
  useEffect(() => {
    if (!opts.visible) return;
    const source = sourceRef.current;
    if (!source) return;

    let cancelled = false;
    let url = `/dispatch/heatmap?days=${days}&mode=${mode}`;
    if (mode === 'type' && opts.typeFilter) {
      url += `&type=${encodeURIComponent(opts.typeFilter)}`;
    }
    apiFetch<HeatmapPoint[]>(url)
      .then((points) => {
        if (cancelled || !sourceRef.current) return;
        const feats: Feature<Point>[] = [];
        let maxWeight = 0;
        for (const p of (points || [])) {
          const lat = p.lat ?? p.latitude;
          const lng = p.lng ?? p.longitude;
          const w = p.weight ?? p.intensity ?? 1;
          if (typeof lat !== 'number' || typeof lng !== 'number') continue;
          if (w > maxWeight) maxWeight = w;
          const f = new Feature({ geometry: new Point(fromLonLat([lng, lat])) });
          f.set('weight', w);
          feats.push(f);
        }
        // Normalize weights to 0..1 range so the heatmap colormap stretches
        // across the data instead of clipping at the high end.
        if (maxWeight > 0 && maxWeight !== 1) {
          for (const f of feats) {
            const w = f.get('weight') as number;
            f.set('weight', w / maxWeight);
          }
        }
        sourceRef.current.clear();
        sourceRef.current.addFeatures(feats);
      })
      .catch((err) => devWarn('[map-v2] heatmap fetch failed:', err));

    return () => { cancelled = true; };
  }, [opts.visible, days, mode, opts.typeFilter]);
}
