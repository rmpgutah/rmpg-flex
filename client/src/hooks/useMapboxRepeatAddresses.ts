// Repeat Address Overlay — properties with recurring calls for service
// Fetches /api/dispatch/repeat-addresses and renders as proportional circles.
// Critical for identifying hot properties, chronic locations, and resource drains.
import { useCallback, useState, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import { buildDetailPopupHtml } from '../pages/map/utils/mapMarkers';
import { formatDateTime } from '../utils/dateUtils';

// Matches the real shape returned by GET /dispatch/repeat-addresses
// (src/routes/dispatch/aggregates.ts) — a rounded lat/lng cluster, not a
// single address record, so there's no incident_types/first_call breakdown.
interface RepeatAddress {
  address: string;
  latitude: number;
  longitude: number;
  count: number;
  last_call_at: string;
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
  const [error, setError] = useState<string | null>(null);
  const visibleRef = useRef(false);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const clearFromMap = useCallback(() => {
    if (!map) return;
    visibleRef.current = false;
    popupRef.current?.remove();
    popupRef.current = null;
    try {
      safeRemoveLayer(map, LABEL_LAYER_ID);
      safeRemoveLayer(map, CIRCLE_LAYER_ID);
      safeRemoveSource(map, SOURCE_ID);
    } catch { /* ignore */ }
  }, [map]);

  const renderOnMap = useCallback((addrs: RepeatAddress[], m: mapboxgl.Map) => {
    clearFromMap();
    visibleRef.current = true;

    const maxCount = Math.max(1, ...addrs.map((a) => a.count));
    const features: GeoJSON.Feature[] = addrs.map((a) => ({
      type: 'Feature',
      properties: {
        address: a.address,
        call_count: a.count,
        last_call_at: a.last_call_at,
        radius: 4 + (a.count / maxCount) * 16,
      },
      geometry: { type: 'Point', coordinates: [a.longitude, a.latitude] },
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
        'circle-color': '#c3ccd6',
        'circle-opacity': 0.45,
        'circle-stroke-color': '#c3ccd6',
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

    m.on('click', CIRCLE_LAYER_ID, (e) => {
      const f = e.features?.[0];
      if (!f || f.geometry.type !== 'Point') return;
      const p = f.properties || {};
      popupRef.current?.remove();
      popupRef.current = new mapboxgl.Popup({ offset: 10, closeButton: true, className: 'mapbox-popup-dark' })
        .setLngLat(f.geometry.coordinates as [number, number])
        .setHTML(buildDetailPopupHtml(String(p.address || 'Repeat Address'), [
          ['Calls', p.call_count],
          ['Last Call', p.last_call_at ? formatDateTime(p.last_call_at) : null],
        ]))
        .addTo(m);
    });
    m.on('mouseenter', CIRCLE_LAYER_ID, () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', CIRCLE_LAYER_ID, () => { m.getCanvas().style.cursor = ''; });
  }, [clearFromMap]);

  const fetchRepeats = useCallback(async (options: RepeatOptions = {}) => {
    if (!map) return;
    const { days = 30, minCount = 3, limit = 200 } = options;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        days: String(days), min_count: String(minCount), limit: String(limit),
      });
      const data = await apiFetch<{ addresses: RepeatAddress[]; total: number }>(
        `/dispatch/repeat-addresses?${params}`
      );
      const addrs = data?.addresses || [];
      setAddresses(addrs);
      whenStyleReady(map, () => { renderOnMap(addrs, map); });
    } catch (err) {
      console.warn('[useMapboxRepeatAddresses] fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load repeat addresses');
    } finally {
      setLoading(false);
    }
  }, [map, renderOnMap]);

  return { addresses, loading, error, fetchRepeats, clear: clearFromMap };
}
