import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';

interface LatLng {
  lat: number;
  lng: number;
}

interface RallyPoint extends LatLng {
  label: string;
}

interface EntryPoint extends LatLng {
  label: string;
  number: number;
}

type CrowdDensity = 'Low (<50)' | 'Medium (50-200)' | 'High (200+)';

interface UseMapTacticalReturn {
  rallyPoint: RallyPoint | null;
  setRallyPoint: (lat: number, lng: number, label: string) => void;
  clearRallyPoint: () => void;
  showCommandRings: (lat: number, lng: number) => void;
  clearCommandRings: () => void;
  showK9Radius: (lat: number, lng: number) => void;
  clearK9Radius: () => void;
  showHospitals: () => void;
  showFireStations: () => void;
  hideEmergencyServices: () => void;
  entryPoints: EntryPoint[];
  addEntryPoint: (lat: number, lng: number, label: string) => void;
  clearEntryPoints: () => void;
  estimateCrowdDensity: (lat: number, lng: number) => CrowdDensity;
  loading: boolean;
}

const HOSPITALS: { name: string; lat: number; lng: number }[] = [
  { name: 'University of Utah Hospital', lat: 40.7714, lng: -111.838 },
  { name: 'Intermountain Medical Center', lat: 40.6602, lng: -111.8914 },
  { name: "Primary Children's Hospital", lat: 40.771, lng: -111.8375 },
];

const FIRE_STATIONS: { name: string; lat: number; lng: number }[] = [
  { name: 'SLC Fire Station 1', lat: 40.7588, lng: -111.8866 },
  { name: 'SLC Fire Station 2', lat: 40.7703, lng: -111.8725 },
  { name: 'SLC Fire Station 3', lat: 40.7467, lng: -111.9009 },
  { name: 'SLC Fire Station 5', lat: 40.7376, lng: -111.8775 },
  { name: 'SLC Fire Station 7', lat: 40.7274, lng: -111.8553 },
  { name: 'SLC Fire Station 9', lat: 40.7154, lng: -111.8631 },
];

const VENUE_ZONES: { lat: number; lng: number; radius: number; name: string; peakHours: number[] }[] = [
  { lat: 40.7683, lng: -111.9011, radius: 300, name: 'Vivint Arena', peakHours: [18, 19, 20, 21, 22] },
  { lat: 40.7512, lng: -111.8775, radius: 200, name: 'Gateway Mall', peakHours: [11, 12, 13, 14, 15, 16, 17, 18, 19] },
  { lat: 40.7608, lng: -111.891, radius: 150, name: 'Temple Square', peakHours: [10, 11, 12, 13, 14, 15, 16] },
  { lat: 40.7625, lng: -111.876, radius: 250, name: 'Downtown Bar District', peakHours: [20, 21, 22, 23, 0, 1] },
  { lat: 40.7713, lng: -111.8542, radius: 500, name: 'University of Utah', peakHours: [9, 10, 11, 12, 13, 14, 15] },
];

const COMMAND_RING_SOURCE = 'tactical-command-ring-source';
const COMMAND_RING_LAYER = 'tactical-command-ring-layer';
const K9_SOURCE = 'tactical-k9-source';
const K9_LAYER = 'tactical-k9-layer';

function circleToPolygon(center: [number, number], radiusM: number, segments = 64): [number, number][] {
  const coords: [number, number][] = [];
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center[1] * Math.PI / 180);
  const dLat = radiusM / metersPerDegLat;
  const dLng = radiusM / metersPerDegLng;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    coords.push([center[0] + dLng * Math.cos(angle), center[1] + dLat * Math.sin(angle)]);
  }
  return coords;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useMapTactical(
  map: mapboxgl.Map | null,
): UseMapTacticalReturn {
  const [rallyPoint, setRallyPointState] = useState<RallyPoint | null>(null);
  const [entryPoints, setEntryPoints] = useState<EntryPoint[]>([]);
  const loading = false;

  const rallyMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const hospitalMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const fireMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const entryMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const entryCounterRef = useRef(0);

  useEffect(() => {
    return () => {
      if (rallyMarkerRef.current) rallyMarkerRef.current.remove();
      hospitalMarkersRef.current.forEach((m) => m.remove());
      fireMarkersRef.current.forEach((m) => m.remove());
      entryMarkersRef.current.forEach((m) => m.remove());
      if (map) {
        try {
          if (map.getLayer(COMMAND_RING_LAYER)) map.removeLayer(COMMAND_RING_LAYER);
          if (map.getSource(COMMAND_RING_SOURCE)) map.removeSource(COMMAND_RING_SOURCE);
          if (map.getLayer(K9_LAYER)) map.removeLayer(K9_LAYER);
          if (map.getSource(K9_SOURCE)) map.removeSource(K9_SOURCE);
        } catch { /* ignore */ }
      }
    };
  }, [map]);

  const setRallyPoint = useCallback(
    (lat: number, lng: number, label: string) => {
      if (!map) return;
      if (rallyMarkerRef.current) rallyMarkerRef.current.remove();

      const el = document.createElement('div');
      el.style.cssText = `
        width: 28px; height: 28px;
        background: #d4a017;
        border: 3px solid #fbbf24;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #050505;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
      `;
      el.textContent = '\u2605';
      el.title = `Rally: ${label}`;

      rallyMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map);
      setRallyPointState({ lat, lng, label });
    },
    [map],
  );

  const clearRallyPoint = useCallback(() => {
    if (rallyMarkerRef.current) rallyMarkerRef.current.remove();
    rallyMarkerRef.current = null;
    setRallyPointState(null);
  }, []);

  const showCommandRings = useCallback(
    (lat: number, lng: number) => {
      if (!map) return;
      try {
        if (map.getLayer(COMMAND_RING_LAYER)) map.removeLayer(COMMAND_RING_LAYER);
        if (map.getSource(COMMAND_RING_SOURCE)) map.removeSource(COMMAND_RING_SOURCE);
      } catch { /* ignore */ }

      const rings = [
        { radius: 100, color: '#ef4444' },
        { radius: 300, color: '#f59e0b' },
        { radius: 500, color: '#888888' },
      ];

      const features: GeoJSON.Feature[] = rings.map((ring) => ({
        type: 'Feature',
        properties: { color: ring.color },
        geometry: { type: 'Polygon', coordinates: [circleToPolygon([lng, lat], ring.radius)] },
      }));

      map.addSource(COMMAND_RING_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: COMMAND_RING_LAYER,
        type: 'fill',
        source: COMMAND_RING_SOURCE,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.08,
          'fill-outline-color': ['get', 'color'],
        },
      });
    },
    [map],
  );

  const clearCommandRings = useCallback(() => {
    if (map) {
      try {
        if (map.getLayer(COMMAND_RING_LAYER)) map.removeLayer(COMMAND_RING_LAYER);
        if (map.getSource(COMMAND_RING_SOURCE)) map.removeSource(COMMAND_RING_SOURCE);
      } catch { /* ignore */ }
    }
  }, [map]);

  const showK9Radius = useCallback(
    (lat: number, lng: number) => {
      if (!map) return;
      try {
        if (map.getLayer(K9_LAYER)) map.removeLayer(K9_LAYER);
        if (map.getSource(K9_SOURCE)) map.removeSource(K9_SOURCE);
      } catch { /* ignore */ }

      const poly = circleToPolygon([lng, lat], 800);
      map.addSource(K9_SOURCE, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [poly] },
          }],
        },
      });
      map.addLayer({
        id: K9_LAYER,
        type: 'fill',
        source: K9_SOURCE,
        paint: {
          'fill-color': '#22c55e',
          'fill-opacity': 0.06,
          'fill-outline-color': '#22c55e',
        },
      });
    },
    [map],
  );

  const clearK9Radius = useCallback(() => {
    if (map) {
      try {
        if (map.getLayer(K9_LAYER)) map.removeLayer(K9_LAYER);
        if (map.getSource(K9_SOURCE)) map.removeSource(K9_SOURCE);
      } catch { /* ignore */ }
    }
  }, [map]);

  const showHospitals = useCallback(() => {
    if (!map) return;
    if (hospitalMarkersRef.current.length > 0) return;
    for (const h of HOSPITALS) {
      const el = document.createElement('div');
      el.style.cssText = `
        width: 20px; height: 20px;
        background: #888888;
        border: 1px solid #666666;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
      `;
      el.textContent = '+';
      el.title = h.name;
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([h.lng, h.lat])
        .addTo(map);
      hospitalMarkersRef.current.push(marker);
    }
  }, [map]);

  const showFireStations = useCallback(() => {
    if (!map) return;
    if (fireMarkersRef.current.length > 0) return;
    for (const fs of FIRE_STATIONS) {
      const el = document.createElement('div');
      el.style.cssText = `
        width: 20px; height: 20px;
        background: #ef4444;
        border: 1px solid #b91c1c;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-size: 11px;
        cursor: pointer;
      `;
      el.textContent = '\uD83D\uDD25';
      el.title = fs.name;
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([fs.lng, fs.lat])
        .addTo(map);
      fireMarkersRef.current.push(marker);
    }
  }, [map]);

  const hideEmergencyServices = useCallback(() => {
    hospitalMarkersRef.current.forEach((m) => m.remove());
    hospitalMarkersRef.current = [];
    fireMarkersRef.current.forEach((m) => m.remove());
    fireMarkersRef.current = [];
  }, []);

  const addEntryPoint = useCallback(
    (lat: number, lng: number, label: string) => {
      if (!map) return;
      entryCounterRef.current += 1;
      const num = entryCounterRef.current;

      const el = document.createElement('div');
      el.style.cssText = `
        width: 24px; height: 24px;
        background: #8b5cf6;
        border: 2px solid #a78bfa;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-size: 11px;
        font-weight: bold;
        cursor: pointer;
      `;
      el.textContent = String(num);
      el.title = `Entry ${num}: ${label}`;

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map);
      entryMarkersRef.current.push(marker);
      setEntryPoints((prev) => [...prev, { lat, lng, label, number: num }]);
    },
    [map],
  );

  const clearEntryPoints = useCallback(() => {
    entryMarkersRef.current.forEach((m) => m.remove());
    entryMarkersRef.current = [];
    entryCounterRef.current = 0;
    setEntryPoints([]);
  }, []);

  const estimateCrowdDensity = useCallback(
    (lat: number, lng: number): CrowdDensity => {
      const now = new Date();
      const hour = now.getHours();
      const dayOfWeek = now.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      for (const venue of VENUE_ZONES) {
        const dist = haversineMeters(lat, lng, venue.lat, venue.lng);
        if (dist <= venue.radius) {
          const isPeakHour = venue.peakHours.includes(hour);
          if (isPeakHour || isWeekend) return 'High (200+)';
          return 'Medium (50-200)';
        }
      }

      if (lat >= 40.745 && lat <= 40.775 && lng >= -111.91 && lng <= -111.86) {
        if (hour >= 7 && hour <= 18) return 'Medium (50-200)';
        return 'Low (<50)';
      }

      return 'Low (<50)';
    },
    [],
  );

  return {
    rallyPoint,
    setRallyPoint,
    clearRallyPoint,
    showCommandRings,
    clearCommandRings,
    showK9Radius,
    clearK9Radius,
    showHospitals,
    showFireStations,
    hideEmergencyServices,
    entryPoints,
    addEntryPoint,
    clearEntryPoints,
    estimateCrowdDensity,
    loading,
  };
}