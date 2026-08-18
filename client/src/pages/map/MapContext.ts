import { createContext, useContext } from 'react';
import type mapboxgl from 'mapbox-gl';

export interface MapContextValue {
  map: mapboxgl.Map | null;
  units: Array<{
    id: number;
    call_sign: string;
    status: string;
    latitude: number | null;
    longitude: number | null;
    current_call_type?: string | null;
    call_number?: string | null;
  }>;
  calls: Array<{
    call_number: string;
    latitude: number | null;
    longitude: number | null;
    priority?: number | null;
    incident_type?: string | null;
  }>;
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
