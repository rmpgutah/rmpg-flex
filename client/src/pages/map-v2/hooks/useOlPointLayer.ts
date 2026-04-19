import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Style from 'ol/style/Style';
import CircleStyle from 'ol/style/Circle';
import StrokeStyle from 'ol/style/Stroke';
import FillStyle from 'ol/style/Fill';
import { fromLonLat } from 'ol/proj';
import { apiFetch } from '../../../hooks/useApi';
import { devWarn } from '../../../utils/devLog';

export interface OlPointLayerOptions<T> {
  /** Whether the layer is visible (cheap toggle, no refetch) */
  visible: boolean;
  /** API endpoint to fetch from */
  url: string;
  /** Z-index (default 85: above tactical, below live unit/call markers) */
  zIndex?: number;
  /** Marker fill color (hex with optional alpha) */
  color: string;
  /** Marker radius in px (default 5) */
  radius?: number;
  /** Stable feature kind tag set on each feature for click handlers */
  kind: string;
  /** Map a row to (lat, lng) — return null to skip */
  extractCoords: (row: T) => { lat: number; lng: number } | null;
  /** Optional log tag for debug warnings */
  debugTag?: string;
}

/**
 * Generic point-marker overlay for /map-v2.
 *
 * Pattern shared by FI, incident reports, patrol checkpoints, fleet
 * vehicles, etc — fetch a list endpoint, render Point features with a
 * solid color circle, toggle visibility cheaply, refetch when params
 * change. Saves writing the same scaffolding 8 times.
 *
 * Each rendered feature carries kind + payload props so the existing
 * useOlLiveMarkers click handler (or any future popup wiring) can
 * surface details on click.
 */
export function useOlPointLayer<T>(map: OlMap | null, opts: OlPointLayerOptions<T>): void {
  const layerRef = useRef<VectorLayer<Feature<Geometry>> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);

  const baseStyle = new Style({
    image: new CircleStyle({
      radius: opts.radius ?? 5,
      fill: new FillStyle({ color: opts.color }),
      stroke: new StrokeStyle({ color: '#0a0a0a', width: 1 }),
    }),
  });

  // Mount once
  useEffect(() => {
    if (!map || layerRef.current) return;
    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      style: baseStyle,
      visible: opts.visible,
      zIndex: opts.zIndex ?? 85,
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

  // Visibility toggle
  useEffect(() => {
    if (layerRef.current) layerRef.current.setVisible(opts.visible);
  }, [opts.visible]);

  // Fetch when visible (and on URL change)
  useEffect(() => {
    if (!opts.visible || !sourceRef.current) return;
    let cancelled = false;
    apiFetch<T[]>(opts.url)
      .then((data) => {
        if (cancelled || !sourceRef.current) return;
        const rows = Array.isArray(data) ? data : [];
        const feats: Feature<Geometry>[] = [];
        for (const r of rows) {
          const coords = opts.extractCoords(r);
          if (!coords) continue;
          if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) continue;
          const f = new Feature({ geometry: new Point(fromLonLat([coords.lng, coords.lat])) });
          f.set('kind', opts.kind);
          f.set('payload', r);
          feats.push(f);
        }
        sourceRef.current.clear();
        sourceRef.current.addFeatures(feats);
      })
      .catch((err) => devWarn(`[map-v2] ${opts.debugTag || opts.url} fetch failed:`, err));
    return () => { cancelled = true; };
  }, [opts.visible, opts.url]);
}
