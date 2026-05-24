// Incident Markers Overlay — display RMS incidents on the map
// Fetches from /api/incidents and renders as diamond markers with incident type icons.
import { useCallback, useState, useRef } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';

interface Incident {
  id: number;
  incident_number: string;
  incident_type: string;
  priority: string;
  status: string;
  location_address: string;
  latitude: number;
  longitude: number;
  weapons_involved: number;
  domestic_violence: number;
  injuries_reported: number;
  created_at: string;
}

const SOURCE_ID = 'rmpg-incidents-source';
const LAYER_ID = 'rmpg-incidents-layer';

const INCIDENT_COLORS: Record<string, string> = {
  THEFT: '#64d264',
  BURGLARY: '#f0b428',
  ROBBERY: '#f07828',
  ASSAULT: '#f03c3c',
  SHOOTING: '#b71c1c',
  HOMICIDE: '#7f0000',
  'DOMESTIC VIOLENCE': '#ff69b4',
  TRAFFIC: '#448aff',
  DRUGS: '#9c27b0',
  VANDALISM: '#00bcd4',
  FRAUD: '#ff9800',
  DEFAULT: '#888888',
};

export function useMapboxIncidents(map: mapboxgl.Map | null) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(false);
  const visibleRef = useRef(false);

  const clearFromMap = useCallback(() => {
    if (!map) return;
    visibleRef.current = false;
    try {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    } catch { /* ignore */ }
  }, [map]);

  const renderOnMap = useCallback((incs: Incident[], m: mapboxgl.Map) => {
    clearFromMap();
    visibleRef.current = true;

    const features: GeoJSON.Feature[] = incs
      .filter((i) => i.latitude && i.longitude)
      .map((i) => ({
        type: 'Feature',
        properties: {
          incident_number: i.incident_number,
          incident_type: i.incident_type,
          priority: i.priority,
          status: i.status,
          address: i.location_address,
          weapons: i.weapons_involved,
          dv: i.domestic_violence,
          injuries: i.injuries_reported,
        },
        geometry: { type: 'Point', coordinates: [i.longitude, i.latitude] },
      }));

    m.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 40,
    });

    // Clustered circles
    m.addLayer({
      id: LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-radius': ['step', ['get', 'point_count'], 15, 10, 20, 30, 28],
        'circle-color': '#d4a017',
        'circle-opacity': 0.7,
        'circle-stroke-color': '#0a0a0a',
        'circle-stroke-width': 1.5,
      },
    });

    // Cluster count
    m.addLayer({
      id: LAYER_ID + '-count',
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-size': 11,
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
      },
      paint: {
        'text-color': '#ffffff',
      },
    });

    // Unclustered (single incident)
    m.addLayer({
      id: LAYER_ID + '-single',
      type: 'circle',
      source: SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': 4,
        'circle-color': [
          'match', ['get', 'incident_type'],
          ...Object.entries(INCIDENT_COLORS).flatMap(([k, v]) => [k, v]),
          INCIDENT_COLORS.DEFAULT,
        ],
        'circle-opacity': 0.7,
        'circle-stroke-color': '#0a0a0a',
        'circle-stroke-width': 1,
      },
    });
  }, [clearFromMap]);

  const fetchIncidents = useCallback(async (days = 30, limit = 2000) => {
    if (!map) return;
    setLoading(true);
    try {
      const data = await apiFetch<Incident[]>(`/incidents?days=${days}&limit=${limit}`);
      const incs = Array.isArray(data) ? data : [];
      setIncidents(incs);
      if (map.loaded()) renderOnMap(incs, map);
    } catch (err) {
      console.warn('[useMapboxIncidents] fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [map, renderOnMap]);

  return { incidents, loading, fetchIncidents, clear: clearFromMap };
}
