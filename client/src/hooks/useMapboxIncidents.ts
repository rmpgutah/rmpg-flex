// Incident Markers Overlay — display RMS incidents on the map
// Fetches from /api/incidents and renders as diamond markers with incident type icons.
import { useCallback, useState, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import { buildDetailPopupHtml } from '../pages/map/utils/mapMarkers';
import { formatIncidentType } from '../utils/caseNumbers';
import { formatEnumValue } from '../utils/formatters';

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
  const [error, setError] = useState<string | null>(null);
  const visibleRef = useRef(false);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const clearFromMap = useCallback(() => {
    if (!map) return;
    visibleRef.current = false;
    popupRef.current?.remove();
    popupRef.current = null;
    try {
      safeRemoveLayer(map, LAYER_ID + '-single');
      safeRemoveLayer(map, LAYER_ID + '-count');
      safeRemoveLayer(map, LAYER_ID);
      safeRemoveSource(map, SOURCE_ID);
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
        'circle-color': '#c3ccd6',
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

    // Clicking a cluster zooms in to break it apart; clicking a single
    // incident shows its details. Both need hover-cursor feedback so
    // operators know the layer is interactive.
    m.on('click', LAYER_ID, (e) => {
      const f = e.features?.[0];
      const clusterId = f?.properties?.cluster_id;
      if (clusterId == null) return;
      const source = m.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource;
      source.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err || !f || f.geometry.type !== 'Point') return;
        m.easeTo({ center: f.geometry.coordinates as [number, number], zoom: zoom ?? m.getZoom() + 1 });
      });
    });
    m.on('mouseenter', LAYER_ID, () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', LAYER_ID, () => { m.getCanvas().style.cursor = ''; });

    m.on('click', LAYER_ID + '-single', (e) => {
      const f = e.features?.[0];
      if (!f || f.geometry.type !== 'Point') return;
      const p = f.properties || {};
      popupRef.current?.remove();
      popupRef.current = new mapboxgl.Popup({ offset: 10, closeButton: true, className: 'mapbox-popup-dark' })
        .setLngLat(f.geometry.coordinates as [number, number])
        .setHTML(buildDetailPopupHtml(String(p.incident_number || 'Incident'), [
          ['Type', p.incident_type ? formatIncidentType(p.incident_type) : null],
          ['Priority', p.priority],
          ['Status', p.status ? formatEnumValue(p.status) : null],
          ['Address', p.address],
          ['Weapons', p.weapons ? 'Yes' : null],
          ['Domestic Violence', p.dv ? 'Yes' : null],
          ['Injuries', p.injuries ? 'Yes' : null],
        ]))
        .addTo(m);
    });
    m.on('mouseenter', LAYER_ID + '-single', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', LAYER_ID + '-single', () => { m.getCanvas().style.cursor = ''; });
  }, [clearFromMap]);

  const fetchIncidents = useCallback(async (limit = 2000) => {
    if (!map) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ data: Incident[]; pagination: unknown }>(`/incidents?limit=${limit}`);
      const incs = Array.isArray(data?.data) ? data.data : [];
      setIncidents(incs);
      whenStyleReady(map, () => { renderOnMap(incs, map); });
    } catch (err) {
      console.warn('[useMapboxIncidents] fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load incidents');
    } finally {
      setLoading(false);
    }
  }, [map, renderOnMap]);

  return { incidents, loading, error, fetchIncidents, clear: clearFromMap };
}
