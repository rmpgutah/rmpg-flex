// Speed Violations Overlay — recent high-speed GPS events as clickable markers.
// Fetches /dispatch/gps/speed-violations. Clicking a marker opens the per-unit
// speed graph (SpeedGraphOverlay) via onSelectUnit.
import { useCallback, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { hasLayer, safeRemoveLayer, safeRemoveSource, upsertGeoJsonSource } from '../utils/mapboxSafeLayer';

export interface SpeedViolation {
  id: number;
  unit_id: number;
  officer_id: number | null;
  call_sign: string;
  officer_name: string;
  max_speed: number;
  avg_speed: number;
  latitude: number;
  longitude: number;
  timestamp: string;
  acknowledged: number;
  point_count: number;
}

const SOURCE_ID = 'rmpg-speed-violations-source';
const LAYER_ID = 'rmpg-speed-violations-layer';

function speedColor(mph: number): string {
  if (mph < 55) return '#eab308';
  if (mph < 75) return '#f97316';
  return '#ef4444';
}

export function useMapboxSpeedViolations(map: mapboxgl.Map | null) {
  const [violations, setViolations] = useState<SpeedViolation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSelectRef = useRef<((unitId: number, callSign: string) => void) | null>(null);

  const clear = useCallback(() => {
    if (!map) return;
    safeRemoveLayer(map, LAYER_ID);
    safeRemoveSource(map, SOURCE_ID);
  }, [map]);

  const renderOnMap = useCallback((data: SpeedViolation[], m: mapboxgl.Map) => {
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: data
        .filter((v) => v.latitude != null && v.longitude != null)
        .map((v) => ({
          type: 'Feature',
          properties: { id: v.id, unit_id: v.unit_id, call_sign: v.call_sign, max_speed: v.max_speed },
          geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
        })),
    };

    upsertGeoJsonSource(m, SOURCE_ID, geojson);
    if (hasLayer(m, LAYER_ID)) return;

    m.addLayer({
      id: LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': 6,
        'circle-color': ['step', ['get', 'max_speed'], '#eab308', 55, '#f97316', 75, '#ef4444'],
        'circle-opacity': 0.85,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });

    m.on('click', LAYER_ID, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const unitId = f.properties?.unit_id as number | undefined;
      const callSign = f.properties?.call_sign as string | undefined;
      if (unitId != null && onSelectRef.current) onSelectRef.current(unitId, callSign || `Unit ${unitId}`);
    });
    m.on('mouseenter', LAYER_ID, () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', LAYER_ID, () => { m.getCanvas().style.cursor = ''; });
  }, []);

  const fetchViolations = useCallback(async (hours = 4) => {
    if (!map) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<SpeedViolation[]>(`/dispatch/gps/speed-violations?hours=${hours}`);
      const list = Array.isArray(data) ? data : [];
      setViolations(list);
      renderOnMap(list, map);
    } catch (err) {
      console.warn('[useMapboxSpeedViolations] fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load speed violations');
    } finally {
      setLoading(false);
    }
  }, [map, renderOnMap]);

  const setOnSelectUnit = useCallback((fn: (unitId: number, callSign: string) => void) => {
    onSelectRef.current = fn;
  }, []);

  return { violations, loading, error, fetchViolations, clear, setOnSelectUnit, hasLayer: () => !!map && hasLayer(map, LAYER_ID) };
}
