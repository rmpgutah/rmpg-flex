import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import CircleStyle from 'ol/style/Circle';
import { devWarn } from '../../../utils/devLog';

export interface OlGeoJsonLayerOptions {
  /** Public URL the GeoJSON is fetched from */
  url: string;
  /** Whether the layer is visible — toggling this is cheap (no refetch) */
  visible: boolean;
  /** Stroke color (hex) */
  stroke: string;
  /** Stroke width in px */
  strokeWidth?: number;
  /** Fill color with optional alpha (e.g. '#22c55e22') — only used for polygons */
  fill?: string;
  /** Z-index relative to other map layers (default 5: above tiles, below beats) */
  zIndex?: number;
  /** Point radius in px — only used when geometry is Point (e.g. places) */
  pointRadius?: number;
}

/**
 * Generic GeoJSON-backed VectorLayer for /map-v2.
 *
 * Fetches once on mount, parses with EPSG:4326 → EPSG:3857 reprojection,
 * caches the layer instance, and toggles visibility via setVisible() so
 * users can hide/show without paying the parse cost again.
 */
export function useOlGeoJsonLayer(map: OlMap | null, opts: OlGeoJsonLayerOptions): void {
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);

  useEffect(() => {
    if (!map || layerRef.current) return;

    const source = new VectorSource();
    const style = new Style({
      stroke: new Stroke({ color: opts.stroke, width: opts.strokeWidth ?? 1 }),
      fill: opts.fill ? new Fill({ color: opts.fill }) : undefined,
      image: new CircleStyle({
        radius: opts.pointRadius ?? 3,
        fill: new Fill({ color: opts.stroke }),
        stroke: new Stroke({ color: '#0a0a0a', width: 1 }),
      }),
    });
    const layer = new VectorLayer({
      source,
      style,
      visible: opts.visible,
      zIndex: opts.zIndex ?? 5,
    });
    layerRef.current = layer;
    map.addLayer(layer);

    let cancelled = false;
    fetch(opts.url)
      .then((r) => {
        if (!r.ok) throw new Error(`${opts.url} HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        const features = new GeoJSON().readFeatures(json, {
          dataProjection: 'EPSG:4326',
          featureProjection: 'EPSG:3857',
        });
        source.addFeatures(features);
      })
      .catch((err) => devWarn(`[map-v2] ${opts.url} failed:`, err));

    return () => {
      cancelled = true;
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
    // We intentionally don't include opts in deps — the layer is built once
    // and its visibility is controlled via setVisible() in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, opts.url]);

  // Cheap visibility toggle without rebuilding the layer.
  useEffect(() => {
    if (layerRef.current) layerRef.current.setVisible(opts.visible);
  }, [opts.visible]);
}
