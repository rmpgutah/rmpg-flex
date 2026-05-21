import { useEffect, useRef, useState, useCallback } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import Point from 'ol/geom/Point';
import Circle from 'ol/geom/Circle';
import Geolocation from 'ol/Geolocation';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Style from 'ol/style/Style';
import CircleStyle from 'ol/style/Circle';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import { devWarn } from '../../../utils/devLog';

const DOT_STYLE = new Style({
  image: new CircleStyle({
    radius: 7,
    fill: new Fill({ color: '#3b82f6' }),
    stroke: new Stroke({ color: '#ffffff', width: 2 }),
  }),
});
const ACCURACY_STYLE = new Style({
  fill: new Fill({ color: '#3b82f622' }),
  stroke: new Stroke({ color: '#3b82f680', width: 1 }),
});

/**
 * "Find me" geolocation for /map-v2 — GPS position blue dot with
 * accuracy circle, plus a programmatic locate() that pans the view to
 * the latest fix.
 *
 * Uses ol/Geolocation which wraps the browser's HTML5 Geolocation API
 * and reprojects to the map's view automatically. Tracking stays on
 * once enabled so the dot follows the user's movement (useful for
 * dispatchers running V2 on a tablet inside a vehicle).
 *
 * Permission denial / no-fix conditions surface via locate()'s return
 * value — caller can show a toast or fallback message.
 */
export function useOlGeolocation(map: OlMap | null): {
  position: [number, number] | null;
  accuracy: number | null;
  enabled: boolean;
  locate: () => Promise<{ ok: boolean; reason?: string }>;
} {
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const geoRef = useRef<Geolocation | null>(null);
  const dotRef = useRef<Feature<Point> | null>(null);
  const accuracyRef = useRef<Feature<Circle> | null>(null);
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);

  // Mount the layer + features once
  useEffect(() => {
    if (!map || layerRef.current) return;
    const source = new VectorSource();
    sourceRef.current = source;

    const dot = new Feature(new Point([0, 0]));
    dot.setStyle(DOT_STYLE);
    dotRef.current = dot;
    const acc = new Feature(new Circle([0, 0], 0));
    acc.setStyle(ACCURACY_STYLE);
    accuracyRef.current = acc;
    // Don't add features until we have a real fix.

    const layer = new VectorLayer({ source, zIndex: 120 });
    layerRef.current = layer;
    map.addLayer(layer);

    const geo = new Geolocation({
      tracking: false,
      trackingOptions: { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
      projection: map.getView().getProjection(),
    });
    geoRef.current = geo;

    geo.on('change:position', () => {
      const pos = geo.getPosition();
      if (!pos) return;
      dot.setGeometry(new Point(pos));
      const acc2 = geo.getAccuracy();
      if (typeof acc2 === 'number') {
        accuracyRef.current?.setGeometry(new Circle(pos, acc2));
        setAccuracy(acc2);
      }
      // First fix: add features to source if not already present
      if (source.getFeatures().length === 0) {
        source.addFeatures([acc, dot]);
      }
      setPosition([pos[0], pos[1]]);
    });
    geo.on('error', (err: any) => {
      devWarn('[map-v2] geolocation error:', err?.message || err);
      setEnabled(false);
    });

    return () => {
      geo.setTracking(false);
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      sourceRef.current = null;
      geoRef.current = null;
      dotRef.current = null;
      accuracyRef.current = null;
    };
  }, [map]);

  const locate = useCallback(async (): Promise<{ ok: boolean; reason?: string }> => {
    if (!map || !geoRef.current) return { ok: false, reason: 'map-not-ready' };
    if (!('geolocation' in navigator)) return { ok: false, reason: 'unsupported' };

    geoRef.current.setTracking(true);
    setEnabled(true);

    // Wait up to 10s for the first fix.
    return new Promise((resolve) => {
      const startMs = Date.now();
      const tick = () => {
        const pos = geoRef.current?.getPosition();
        if (pos) {
          map.getView().animate({ center: pos, zoom: 15, duration: 400 });
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startMs > 10_000) {
          resolve({ ok: false, reason: 'timeout' });
          return;
        }
        setTimeout(tick, 200);
      };
      tick();
    });
  }, [map]);

  return { position, accuracy, enabled, locate };
}
