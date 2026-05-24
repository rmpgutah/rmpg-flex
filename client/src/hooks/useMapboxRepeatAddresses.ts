// Repeat Address Overlay — properties with recurring calls for service
// Fetches /api/dispatch/repeat-addresses and renders as proportional circles.
// Critical for identifying hot properties, chronic locations, and resource drains.
import { useCallback, useState, useRef } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';

interface RepeatAddress {
  location_address: string;
  lat: number;
  lng: number;
  call_count: number;
  incident_types: string;
  last_call: string;
  first_call: string;
}

const SOURCE_ID = 'rmpg-repeat-addrs-source';
const CIRCLE_LAYER_ID = 'rmpg-repeat-addrs-circle';
const LABEL_LAYER_ID = 'rmpg-repeat-addrs-label';

export interface RepeatOptions {
  days?: number;
  minCount?: number;
  limit?: number;
}

export function useMapboxRepeatAddresses(map: mapboxgl.Map | null) {
  const [addresses, setAddresses] = useState<RepeatAddress[]>([]);
  const [loading, setLoading] = useState(false);
  const visibleRef = useRef(false);

  const clearFromMap = useCallback(() => {
    if (!map) return;
    visibleRef.current = false;
    try {
      if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
      if (map.getLayer(CIRCLE_LAYER_ID)) map.removeLayer(CIRCLE_LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    } catch { /* ignore */ }
  }, [map]);

  const renderOnMap = useCallback((addrs: RepeatAddress[], m: mapboxgl.Map) => {
    clearFromMap();
    visibleRef.current = true;

    const maxCount = Math.max(1, ...addrs.map((a) => a.call_count));
    const features: GeoJSON.Feature[] = addrs.map((a) => ({
      type: 'Feature',
      properties: {
        address: a.location_address,
        call_count: a.call_count,
        incident_types: a.incident_types,
        last_call: a.last_call,
        radius: 4 + (a.call_count / maxCount) * 16,
      },
      geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
    }));

    m.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    // Proportional circles — size by call count
    m.addLayer({
      id: CIRCLE_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-color': '#d4a017',
        'circle-opacity': 0.45,
        'circle-stroke-color': '#d4a017',
        'circle-stroke-width': 1.5,
        'circle-stroke-opacity': 0.8,
      },
    });

    // Count label
    m.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      minzoom: 12,
      layout: {
        'text-field': ['to-string', ['get', 'call_count']],
        'text-size': 9,
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#0a0a0a',
        'text-halo-width': 1.5,
      },
    });
  }, [clearFromMap]);

  const fetchRepeats = useCallback(async (options: RepeatOptions = {}) => {
    if (!map) return;
    const { days = 30, minCount = 3, limit = 200 } = options;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        days: String(days), min_count: String(minCount), limit: String(limit),
      });
      const data = await apiFetch<{ addresses: RepeatAddress[]; total: number }>(
        `/dispatch/repeat-addresses?${params}`
      );
      const addrs = data?.addresses || [];
      setAddresses(addrs);
      if (map.loaded()) renderOnMap(addrs, map);
    } catch (err) {
      console.warn('[useMapboxRepeatAddresses] fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [map, renderOnMap]);

  return { addresses, loading, fetchRepeats, clear: clearFromMap };
}
