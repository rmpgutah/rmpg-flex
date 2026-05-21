// Coverage Gap Overlay — grid-based analysis showing areas with insufficient unit coverage
// Fetches unit positions and computes distance to nearest unit per grid cell.
// Highlights areas > 5 min / > 10 min response time. Critical for patrol planning.
import { useCallback, useState, useRef, useEffect } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';

interface GpsPoint {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
}

interface Unit {
  id: number;
  call_sign: string;
  latitude: number;
  longitude: number;
  status: string;
}

interface GapCell {
  lat: number;
  lng: number;
  nearest_unit_dist_km: number;
  nearest_unit: string;
  coverage_level: 'good' | 'fair' | 'poor' | 'none';
}

const SOURCE_ID = 'rmpg-coverage-gaps-source';
const FILL_LAYER_ID = 'rmpg-coverage-gaps-fill';

// Coverage thresholds (km → ~drive time at 40mph)
const COVERAGE_LEVELS: { maxKm: number; color: string; opacity: number; label: string }[] = [
  { maxKm: 1.0, color: 'rgba(100,210,100,0.15)', opacity: 0.3, label: 'Good (< 1 km)' },
  { maxKm: 3.0, color: 'rgba(255,200,50,0.15)', opacity: 0.35, label: 'Fair (1-3 km)' },
  { maxKm: 6.0, color: 'rgba(255,130,40,0.2)', opacity: 0.4, label: 'Poor (3-6 km)' },
  { maxKm: Infinity, color: 'rgba(240,60,60,0.25)', opacity: 0.5, label: 'Gap (> 6 km)' },
];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useMapboxCoverageGaps(map: mapboxgl.Map | null) {
  const [gaps, setGaps] = useState<GapCell[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ good: 0, fair: 0, poor: 0, gap: 0, total: 0 });
  const visibleRef = useRef(false);

  useEffect(() => {
    return () => {
      if (!map) return;
      try {
        if (map.getLayer(FILL_LAYER_ID)) map.removeLayer(FILL_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch { /* ignore */ }
    };
  }, [map]);

  const clearFromMap = useCallback(() => {
    if (!map) return;
    visibleRef.current = false;
    try { if (map.getLayer(FILL_LAYER_ID)) map.removeLayer(FILL_LAYER_ID); } catch { /* */ }
    try { if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID); } catch { /* */ }
  }, [map]);

  const computeCoverage = useCallback(async (
    bounds: { north: number; south: number; east: number; west: number },
    gridSize = 0.01, // ~1km per cell
  ) => {
    if (!map) return;
    setLoading(true);
    try {
      // Fetch active unit positions
      const units = await apiFetch<Unit[]>('/dispatch/units');
      const activeUnits = (Array.isArray(units) ? units : []).filter(
        (u) => u.latitude && u.longitude && Number.isFinite(u.latitude) && Number.isFinite(u.longitude)
      );

      // Generate grid cells
      const cells: GapCell[] = [];
      for (let lat = bounds.south; lat <= bounds.north; lat += gridSize) {
        for (let lng = bounds.west; lng <= bounds.east; lng += gridSize) {
          let minDist = Infinity;
          let nearestUnit = '';
          for (const u of activeUnits) {
            const d = haversineKm(lat, lng, u.latitude, u.longitude);
            if (d < minDist) {
              minDist = d;
              nearestUnit = u.call_sign;
            }
          }

          let level: GapCell['coverage_level'] = 'none';
          if (minDist <= 1) level = 'good';
          else if (minDist <= 3) level = 'fair';
          else if (minDist <= 6) level = 'poor';
          else level = 'none';

          cells.push({ lat, lng, nearest_unit_dist_km: Math.round(minDist * 100) / 100, nearest_unit: nearestUnit, coverage_level: level });
        }
      }

      setGaps(cells);
      const s = { good: 0, fair: 0, poor: 0, gap: 0, total: cells.length };
      cells.forEach((c) => { s[c.coverage_level]++; });
      setStats(s);

      // Render on map
      clearFromMap();
      visibleRef.current = true;

      const features: GeoJSON.Feature[] = cells.map((c) => ({
        type: 'Feature',
        properties: {
          level: c.coverage_level,
          dist_km: c.nearest_unit_dist_km,
          nearest: c.nearest_unit,
        },
        geometry: { type: 'Polygon', coordinates: [[
          [c.lng, c.lat],
          [c.lng + gridSize, c.lat],
          [c.lng + gridSize, c.lat + gridSize],
          [c.lng, c.lat + gridSize],
          [c.lng, c.lat],
        ]] },
      }));

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });

      map.addLayer({
        id: FILL_LAYER_ID,
        type: 'fill',
        source: SOURCE_ID,
        paint: {
          'fill-color': [
            'match', ['get', 'level'],
            'good', COVERAGE_LEVELS[0].color,
            'fair', COVERAGE_LEVELS[1].color,
            'poor', COVERAGE_LEVELS[2].color,
            COVERAGE_LEVELS[3].color,
          ],
          'fill-opacity': [
            'match', ['get', 'level'],
            'good', 0.3,
            'fair', 0.35,
            'poor', 0.45,
            0.55,
          ],
          'fill-outline-color': '#333333',
        },
      });
    } catch (err) {
      console.warn('[useMapboxCoverageGaps] compute failed:', err);
    } finally {
      setLoading(false);
    }
  }, [map, clearFromMap]);

  return { gaps, stats, loading, computeCoverage, clear: clearFromMap };
}
