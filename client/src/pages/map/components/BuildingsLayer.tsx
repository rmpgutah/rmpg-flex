import { useEffect, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { loadMapPref, saveMapPref } from '../../../utils/mapPreferences';

const LAYER_ID = 'rmpg-3d-buildings';

export function useBuildingsLayer(map: mapboxgl.Map | null) {
  const [enabled, setEnabled] = useState(() => Boolean(loadMapPref('buildings_3d')));

  useEffect(() => {
    if (!map) return;
    const addBuildings = () => {
      if (map.getLayer(LAYER_ID)) return;
      map.addLayer({
        id: LAYER_ID,
        source: 'composite',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 15,
        paint: {
          'fill-extrusion-color': '#0d2235',
          'fill-extrusion-height': ['coalesce', ['*', ['get', 'levels'], 3], 10],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.8,
        },
      });
    };
    const removeBuildings = () => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    };

    if (enabled) {
      if (map.isStyleLoaded()) addBuildings();
      else map.once('styledata', addBuildings);
    } else {
      removeBuildings();
    }
  }, [map, enabled]);

  const toggle = () => {
    setEnabled(prev => {
      saveMapPref('buildings_3d', !prev);
      return !prev;
    });
  };

  return { enabled, toggle };
}
