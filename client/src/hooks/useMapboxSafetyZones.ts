// Safety Zone Overlay — risk-weighted call clusters as safety zones
// Fetches heatmap with mode=risk and renders as colored zone polygons.
// Clusters nearby risk points into convex hull zones for tactical awareness.
import { useCallback, useState, useRef, useEffect } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';

interface RiskPoint {
  latitude: number;
  longitude: number;
  count: number;
  risk_weight: number;
  weapons_count: number;
  dv_count: number;
  injuries_count: number;
}

interface SafetyZone {
  latitude: number;
  longitude: number;
  risk_level: 'low' | 'moderate' | 'high' | 'critical';
  risk_weight: number;
  weapons_count: number;
  dv_count: number;
  injuries_count: number;
  radius: number; // meters
}

const CIRCLE_SOURCE_ID = 'rmpg-safety-zones-source';
const CIRCLE_LAYER_ID = 'rmpg-safety-zones-circle';
const LABEL_LAYER_ID = 'rmpg-safety-zones-label';

const RISK_COLORS: Record<string, { fill: string; stroke: string; opacity: number }> = {
  critical: { fill: 'rgba(200,30,30,0.35)', stroke: '#c81e1e', opacity: 0.9 },
  high: { fill: 'rgba(240,130,40,0.3)', stroke: '#f08228', opacity: 0.8 },
  moderate: { fill: 'rgba(240,200,50,0.25)', stroke: '#f0c832', opacity: 0.7 },
  low: { fill: 'rgba(100,200,100,0.2)', stroke: '#64c864', opacity: 0.5 },
};

function clusterRiskPoints(points: RiskPoint[], clusterRadius = 0.005): SafetyZone[] {
  const zones: SafetyZone[] = [];
  const used = new Set<number>();

  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    const p = points[i];
    let totalWeight = p.risk_weight;
    let totalWeapons = p.weapons_count;
    let totalDv = p.dv_count;
    let totalInjuries = p.injuries_count;
    let count = 1;
    used.add(i);

    // Find nearby points within cluster radius
    for (let j = i + 1; j < points.length; j++) {
      if (used.has(j)) continue;
      const q = points[j];
      const d = Math.sqrt((p.latitude - q.latitude) ** 2 + (p.longitude - q.longitude) ** 2);
      if (d <= clusterRadius) {
        totalWeight += q.risk_weight;
        totalWeapons += q.weapons_count;
        totalDv += q.dv_count;
        totalInjuries += q.injuries_count;
        count++;
        used.add(j);
      }
    }

    let level: SafetyZone['risk_level'] = 'low';
    if (totalWeight >= 30) level = 'critical';
    else if (totalWeight >= 15) level = 'high';
    else if (totalWeight >= 5) level = 'moderate';

    // Radius proportional to risk weight
    const radius = 200 + Math.min(totalWeight * 50, 2000);

    zones.push({
      latitude: p.latitude,
      longitude: p.longitude,
      risk_level: level,
      risk_weight: totalWeight,
      weapons_count: totalWeapons,
      dv_count: totalDv,
      injuries_count: totalInjuries,
      radius,
    });
  }

  return zones.sort((a, b) => b.risk_weight - a.risk_weight);
}

export function useMapboxSafetyZones(map: mapboxgl.Map | null) {
  const [zones, setZones] = useState<SafetyZone[]>([]);
  const [loading, setLoading] = useState(false);
  const visibleRef = useRef(false);

  useEffect(() => {
    return () => {
      if (!map) return;
      try {
        [CIRCLE_LAYER_ID, LABEL_LAYER_ID].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
        if (map.getSource(CIRCLE_SOURCE_ID)) map.removeSource(CIRCLE_SOURCE_ID);
      } catch { /* ignore */ }
    };
  }, [map]);

  const clearFromMap = useCallback(() => {
    if (!map) return;
    visibleRef.current = false;
    try { if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID); } catch { /* */ }
    try { if (map.getLayer(CIRCLE_LAYER_ID)) map.removeLayer(CIRCLE_LAYER_ID); } catch { /* */ }
  }, [map]);

  const renderOnMap = useCallback((safetyZones: SafetyZone[], m: mapboxgl.Map) => {
    clearFromMap();
    visibleRef.current = true;

    const features: GeoJSON.Feature[] = safetyZones.map((z) => ({
      type: 'Feature',
      properties: {
        risk_level: z.risk_level,
        risk_weight: z.risk_weight,
        weapons: z.weapons_count,
        dv: z.dv_count,
        injuries: z.injuries_count,
        radius: z.radius,
      },
      geometry: { type: 'Point', coordinates: [z.longitude, z.latitude] },
    }));

    m.addSource(CIRCLE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    m.addLayer({
      id: CIRCLE_LAYER_ID,
      type: 'circle',
      source: CIRCLE_SOURCE_ID,
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-radius-scale': 1,
        'circle-color': [
          'match', ['get', 'risk_level'],
          'critical', '#c81e1e',
          'high', '#f08228',
          'moderate', '#f0c832',
          '#64c864',
        ],
        'circle-opacity': [
          'match', ['get', 'risk_level'],
          'critical', 0.35,
          'high', 0.3,
          'moderate', 0.25,
          0.2,
        ],
        'circle-stroke-color': [
          'match', ['get', 'risk_level'],
          'critical', '#c81e1e',
          'high', '#f08228',
          'moderate', '#f0c832',
          '#64c864',
        ],
        'circle-stroke-width': 1.5,
        'circle-stroke-opacity': 0.8,
      },
    });

    // Risk level labels (only critical and high at zoom 12+)
    m.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: CIRCLE_SOURCE_ID,
      minzoom: 11,
      filter: ['in', ['get', 'risk_level'], 'literal', ['critical', 'high']],
      layout: {
        'text-field': ['get', 'risk_level'],
        'text-size': 9,
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
        'text-transform': 'uppercase',
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': ['match', ['get', 'risk_level'], 'critical', '#c81e1e', '#f08228'],
        'text-halo-width': 2,
      },
    });
  }, [clearFromMap]);

  const fetchSafetyZones = useCallback(async (days = 30) => {
    if (!map) return;
    setLoading(true);
    try {
      const data = await apiFetch<RiskPoint[]>(`/dispatch/heatmap?days=${days}&mode=risk`);
      const points = Array.isArray(data) ? data : [];
      const clustered = clusterRiskPoints(points);
      setZones(clustered);
      if (map.loaded()) renderOnMap(clustered, map);
    } catch (err) {
      console.warn('[useMapboxSafetyZones] fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [map, renderOnMap]);

  return { zones, loading, fetchSafetyZones, clear: clearFromMap };
}
