import { useEffect, useRef } from 'react';
import type Map from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import TextStyle from 'ol/style/Text';
import { getSectionColor } from '../../../hooks/useGeoJsonLayers';
import { devWarn } from '../../../utils/devLog';

const BEAT_GEOJSON_URL = '/geojson/beat.geojson';

/** Heat color from active-call count (0..N+ → blue→amber→red) */
function heatColor(count: number): string {
  if (count >= 5) return '#ef4444'; // hot
  if (count >= 3) return '#f59e0b';
  if (count >= 1) return '#fbbf24';
  return '#888888'; // no calls
}

export interface OlBeatLayerOptions {
  visible?: boolean;
  /** When true, color beats by active-call count from beatActivity map */
  heatMode?: boolean;
  /** Map of beat_id (or beat_code) → active call count, from useOlBeatActivity */
  beatActivity?: Record<string, number>;
}

/**
 * Builds the per-beat style. When heatMode is on, color is driven by
 * the beat's active-call count and a label is appended above ~zoom 12;
 * otherwise falls back to per-sector classification colors.
 */
function makeStyleFn(heatMode: boolean, beatActivity?: Record<string, number>) {
  return function (feature: any, resolution: number): Style {
    const props = feature.getProperties() || {};
    if (heatMode && beatActivity) {
      const key = props.beat_id || props.beat_code;
      const count = (key && beatActivity[key]) || 0;
      const color = heatColor(count);
      const opacity = count > 0 ? '55' : '08';
      // OL resolution → zoom: lower resolution = higher zoom. < ~10 ~= zoom 13+
      const showLabel = resolution < 30 && count > 0;
      return new Style({
        stroke: new Stroke({ color, width: count > 0 ? 1.5 : 1 }),
        fill: new Fill({ color: `${color}${opacity}` }),
        text: showLabel
          ? new TextStyle({
              text: count > 0 ? `${count}` : '',
              font: '700 11px ui-monospace, monospace',
              fill: new Fill({ color }),
              stroke: new Stroke({ color: '#000000', width: 3 }),
            })
          : undefined,
      });
    }
    const cityCode = String(props.city_code || '');
    const district = String(props.district_letter || '');
    const sectionId = `${cityCode}${district}`;
    const color = getSectionColor(sectionId);
    // Beat code label visible at high zoom (resolution < ~5 = zoom 14+)
    const showLabel = resolution < 5;
    return new Style({
      stroke: new Stroke({ color, width: 1 }),
      fill: new Fill({ color: `${color}14` }),
      text: showLabel
        ? new TextStyle({
            text: String(props.beat_code || ''),
            font: '600 9px ui-monospace, monospace',
            fill: new Fill({ color }),
            stroke: new Stroke({ color: '#000000', width: 2 }),
          })
        : undefined,
    });
  };
}

export function useOlBeatLayer(map: Map | null, opts: OlBeatLayerOptions = {}): { ready: boolean } {
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const readyRef = useRef(false);
  const visible = opts.visible !== false;
  const heatMode = !!opts.heatMode;
  const beatActivity = opts.beatActivity;

  useEffect(() => {
    if (!map || layerRef.current) return;

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      style: makeStyleFn(heatMode, beatActivity) as any,
      visible,
      zIndex: 10,
    });
    layerRef.current = layer;
    map.addLayer(layer);

    let cancelled = false;
    fetch(BEAT_GEOJSON_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`beat.geojson HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        const features = new GeoJSON().readFeatures(json, {
          dataProjection: 'EPSG:4326',
          featureProjection: 'EPSG:3857',
        });
        source.addFeatures(features);
        readyRef.current = true;
      })
      .catch((err) => devWarn('[map-v2] beat.geojson failed:', err));

    return () => {
      cancelled = true;
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Visibility toggle
  useEffect(() => {
    if (layerRef.current) layerRef.current.setVisible(visible);
  }, [visible]);

  // Re-style when heat mode or activity counts change (no source rebuild)
  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.setStyle(makeStyleFn(heatMode, beatActivity) as any);
      layerRef.current.changed();
    }
  }, [heatMode, beatActivity]);

  return { ready: readyRef.current };
}
