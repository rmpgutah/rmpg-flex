import { useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { MapStyleId } from '../utils/mapConstants';

export interface UseMapCoreOptions {
  preferredEngine: 'mapbox' | 'maplibre';
  mapStyle: MapStyleId;
  retryNonce: number;
}

export interface UseMapCoreResult {
  mapContainerRef: React.RefObject<HTMLDivElement | null>;
  mapRef: React.MutableRefObject<mapboxgl.Map | null>;
  mapLoaded: boolean;
  loading: boolean;
  mapError: string | null;
}

export function useMapCore(_options: UseMapCoreOptions): UseMapCoreResult {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded] = useState(false);
  const [loading] = useState(true);
  const [mapError] = useState<string | null>(null);

  return { mapContainerRef, mapRef, mapLoaded, loading, mapError };
}
