import { createContext, useContext } from 'react';
import type mapboxgl from 'mapbox-gl';
import type { MapUnit, ActiveCall } from './utils/mapConstants';

export interface MapContextValue {
  map: mapboxgl.Map | null;
  units: MapUnit[];
  calls: ActiveCall[];
  beats: Array<{
    id: number;
    name: string;
    geojson?: unknown;
  }>;
}

const defaultValue: MapContextValue = {
  map: null,
  units: [],
  calls: [],
  beats: [],
};

export const MapContext = createContext<MapContextValue>(defaultValue);

export function useMapContext(): MapContextValue {
  return useContext(MapContext);
}
