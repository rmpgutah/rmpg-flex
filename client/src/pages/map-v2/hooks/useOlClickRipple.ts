import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Style from 'ol/style/Style';
import CircleStyle from 'ol/style/Circle';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';

/**
 * Subtle Google-Maps-style click ripple on /map-v2.
 *
 * On every map click that isn't on a feature, render an expanding
 * ring at the click coordinate that fades out over 600ms. Helps
 * dispatchers see exactly where they clicked, especially on touch
 * devices where the cursor isn't visible.
 *
 * Skipped when clicking ON a feature (to avoid masking the popup).
 */
export function useOlClickRipple(map: OlMap | null): void {
  const layerRef = useRef<VectorLayer<Feature<Geometry>> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);

  useEffect(() => {
    if (!map || layerRef.current) return;
    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({ source, zIndex: 130 });
    layerRef.current = layer;
    map.addLayer(layer);

    const onClick = (evt: any) => {
      const onFeature = map.forEachFeatureAtPixel(evt.pixel, (f) => f.get('kind'), { hitTolerance: 4 });
      if (onFeature) return;
      const f = new Feature({ geometry: new Point(evt.coordinate) });
      source.addFeature(f);
      const start = Date.now();
      const tick = () => {
        const elapsed = Date.now() - start;
        const progress = elapsed / 600;
        if (progress >= 1) {
          source.removeFeature(f);
          return;
        }
        const radius = 8 + progress * 24;
        const opacity = (1 - progress) * 0.6;
        const a = Math.round(opacity * 255).toString(16).padStart(2, '0');
        f.setStyle(new Style({
          image: new CircleStyle({
            radius,
            fill: new Fill({ color: `#d4a017${Math.round(opacity * 0x33).toString(16).padStart(2, '0')}` }),
            stroke: new Stroke({ color: `#d4a017${a}`, width: 2 }),
          }),
        }));
        requestAnimationFrame(tick);
      };
      tick();
    };
    map.on('click', onClick);

    return () => {
      map.un('click', onClick);
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      sourceRef.current = null;
    };
  }, [map]);
}
