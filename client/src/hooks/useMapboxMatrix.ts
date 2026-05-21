// Nearest Unit Dispatch — Matrix API for closest-unit calculation
// Computes drive-time ETAs from multiple units to multiple calls (or vice versa).
// Returns ranked unit→call pairings. Renders the best route on the map.
import { useRef, useCallback, useState } from 'react';
import { getMatrix, type MatrixResult } from '../utils/mapboxServices';

export interface UnitEta {
  unitId: number;
  callSign: string;
  callId: number;
  callNumber: string;
  etaSeconds: number;
  etaText: string;
  distanceMeters: number;
  distanceText: string;
}

export interface MatrixResults {
  etas: UnitEta[];
  loading: boolean;
  sourceCoords: [number, number][];
  destCoords: [number, number][];
}

export function useMapboxMatrix(map: mapboxgl.Map | null) {
  const [results, setResults] = useState<MatrixResults>({
    etas: [], loading: false, sourceCoords: [], destCoords: [],
  });
  const routeSourceRef = useRef<string | null>(null);

  const clearRoutes = useCallback(() => {
    if (!map) return;
    if (routeSourceRef.current) {
      try {
        if (map.getLayer('rmpg-matrix-route')) map.removeLayer('rmpg-matrix-route');
        if (map.getSource(routeSourceRef.current)) map.removeSource(routeSourceRef.current);
      } catch { /* ignore */ }
    }
    routeSourceRef.current = null;
  }, [map]);

  // Compute ETAs from multiple units to a single call location
  // units: [{ id, callSign, lat, lng }, ...], call: { id, callNumber, lat, lng }
  const computeUnitEtas = useCallback(async (
    units: { id: number; callSign: string; lat: number; lng: number }[],
    call: { id: number; callNumber: string; lat: number; lng: number },
    profile: 'driving' | 'driving-traffic' = 'driving',
    highlightBest = true,
  ) => {
    if (!map || units.length === 0) return;
    setResults((prev) => ({ ...prev, loading: true }));

    // Coordinates: sources (all units) first, then destination (call) last
    const sourceCoords: [number, number][] = units.map((u) => [u.lng, u.lat]);
    const destCoords: [number, number][] = [[call.lng, call.lat]];
    const allCoords: [number, number][] = [...sourceCoords, [call.lng, call.lat]];

    try {
      const raw = await getMatrix(allCoords, profile, {
        sources: units.map((_, i) => i),
        destinations: [units.length], // last coord = call
      });

      const dr = raw.durations?.[0] || [];
      const dst = raw.distances?.[0] || [];

      const etas: UnitEta[] = units
        .map((u, i) => ({
          unitId: u.id,
          callSign: u.callSign,
          callId: call.id,
          callNumber: call.callNumber,
          etaSeconds: Math.round(dr[i] || 0),
          etaText: formatEta(dr[i]),
          distanceMeters: Math.round(dst[i] || 0),
          distanceText: formatDistance(dst[i]),
        }))
        .filter((e) => e.etaSeconds > 0)
        .sort((a, b) => a.etaSeconds - b.etaSeconds);

      setResults({ etas, loading: false, sourceCoords, destCoords });

      // Highlight best route on map
      if (highlightBest && etas.length > 0) {
        clearRoutes();
        const best = etas[0];
        const bestUnit = units.find((u) => u.id === best.unitId);
        if (bestUnit) {
          const coordStr = `${bestUnit.lng},${bestUnit.lat};${call.lng},${call.lat}`;
          // We render the route from the Directions API for visual polish
          try {
            const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordStr}?geometries=geojson&overview=full&access_token=${await getMapboxTokenFromEnv()}`;
            const res = await fetch(url);
            const data = await res.json();
            const geom = data.routes?.[0]?.geometry;
            if (geom) {
              const srcId = 'rmpg-matrix-route';
              routeSourceRef.current = srcId;
              map.addSource(srcId, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: geom } });
              map.addLayer({
                id: 'rmpg-matrix-route',
                type: 'line',
                source: srcId,
                paint: {
                  'line-color': '#d4a017',
                  'line-width': 3,
                  'line-opacity': 0.85,
                },
              });
            }
          } catch { /* route rendering is non-critical */ }
        }
      }
    } catch (err) {
      console.warn('[useMapboxMatrix] failed:', err);
      setResults((prev) => ({ ...prev, loading: false }));
    }
  }, [map, clearRoutes]);

  return { results, computeUnitEtas, clearRoutes };
}

function formatEta(seconds: number): string {
  if (!seconds || seconds <= 0) return 'N/A';
  const m = Math.round(seconds / 60);
  return m < 1 ? '< 1 min' : `${m} min`;
}

function formatDistance(meters: number): string {
  if (!meters || meters <= 0) return 'N/A';
  if (meters < 1600) return `${Math.round(meters)} m`;
  return `${(meters * 0.000621371).toFixed(1)} mi`;
}

async function getMapboxTokenFromEnv(): Promise<string> {
  // For use in hooks where we need direct Mapbox API access (route rendering)
  const cached = (await import('../utils/mapboxApiKey')).getCachedMapboxAccessToken();
  if (cached) return cached;
  return (await import('../utils/mapboxApiKey')).getMapboxAccessToken();
}
