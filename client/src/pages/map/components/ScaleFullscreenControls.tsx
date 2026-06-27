import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { saveMapPref } from '../../../utils/mapPreferences';

export function useScaleControl(map: mapboxgl.Map | null, enabled: boolean) {
  const ctrlRef = useRef<mapboxgl.ScaleControl | null>(null);
  useEffect(() => {
    if (!map) return;
    if (enabled && !ctrlRef.current) {
      const ctrl = new mapboxgl.ScaleControl({ unit: 'imperial' });
      map.addControl(ctrl, 'bottom-left');
      ctrlRef.current = ctrl;
      saveMapPref('scale_visible', true);
    } else if (!enabled && ctrlRef.current) {
      map.removeControl(ctrlRef.current);
      ctrlRef.current = null;
      saveMapPref('scale_visible', false);
    }
    return () => {
      if (ctrlRef.current) { map.removeControl(ctrlRef.current); ctrlRef.current = null; }
    };
  }, [map, enabled]);
}

export function useFullscreenControl(map: mapboxgl.Map | null, enabled: boolean) {
  const ctrlRef = useRef<mapboxgl.FullscreenControl | null>(null);
  useEffect(() => {
    if (!map) return;
    if (enabled && !ctrlRef.current) {
      const ctrl = new mapboxgl.FullscreenControl();
      map.addControl(ctrl, 'top-right');
      ctrlRef.current = ctrl;
      saveMapPref('fullscreen_visible', true);
    } else if (!enabled && ctrlRef.current) {
      map.removeControl(ctrlRef.current);
      ctrlRef.current = null;
      saveMapPref('fullscreen_visible', false);
    }
    return () => {
      if (ctrlRef.current) { map.removeControl(ctrlRef.current); ctrlRef.current = null; }
    };
  }, [map, enabled]);
}
