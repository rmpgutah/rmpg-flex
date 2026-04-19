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
import { getSectionColor } from '../../../hooks/useGeoJsonLayers';
import { devWarn } from '../../../utils/devLog';

const BEAT_GEOJSON_URL = '/geojson/beat.geojson';

function styleForBeat(feature: any): Style {
  const props = feature.getProperties() || {};
  // Synthesize sectionId as `<city_code><district_letter>` to match the
  // SECTION_COLORS palette in useGeoJsonLayers (e.g. "SL1", "DV2").
  const cityCode = String(props.city_code || '');
  const district = String(props.district_letter || '');
  const sectionId = `${cityCode}${district}`;
  const color = getSectionColor(sectionId);
  return new Style({
    stroke: new Stroke({ color, width: 1 }),
    fill: new Fill({ color: `${color}14` }), // 8% alpha
  });
}

export interface OlBeatLayerOptions {
  visible?: boolean;
}

export function useOlBeatLayer(map: Map | null, opts: OlBeatLayerOptions = {}): { ready: boolean } {
  const layerRef = useRef<VectorLayer<Feature<Geometry>> | null>(null);
  const readyRef = useRef(false);
  const visible = opts.visible !== false;

  useEffect(() => {
    if (!map || layerRef.current) return;

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      style: styleForBeat as any,
      visible,
      // Beats sit above tiles, below markers.
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
          // beat.geojson is in EPSG:4326; reproject to the map's view
          // projection (EPSG:3857) at parse time.
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

  // Cheap visibility toggle — no rebuild
  useEffect(() => {
    if (layerRef.current) layerRef.current.setVisible(visible);
  }, [visible]);

  return { ready: readyRef.current };
}
