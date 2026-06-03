import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { whenStyleReady } from '../utils/safeAddSource';

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

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useMapTactical(map: mapboxgl.Map | null): UseMapTacticalReturn {
  const [rallyPoint, setRallyPointState] = useState<RallyPoint | null>(null);
  const [entryPoints, setEntryPoints] = useState<EntryPoint[]>([]);
  const loading = false;

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const entryCounterRef = useRef(0);

  const rallySourceId = 'tactical-rally';
  const commandRingsSourceId = 'tactical-command-rings';
  const k9SourceId = 'tactical-k9';
  const hospitalSourceId = 'tactical-hospitals';
  const fireSourceId = 'tactical-fire';
  const entrySourceId = 'tactical-entry';

  const clearSource = useCallback((id: string) => {
    if (!map) return;
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }, [map]);

  useEffect(() => {
    return () => {
      [rallySourceId, commandRingsSourceId, k9SourceId, hospitalSourceId, fireSourceId, entrySourceId].forEach(id => {
        if (map?.getLayer(id)) map.removeLayer(id);
        if (map?.getSource(id)) map.removeSource(id);
      });
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    };
  }, [map]);

  const setRallyPoint = useCallback((lat: number, lng: number, label: string) => {
    if (!map) return;
    clearSource(rallySourceId);

    if (!popupRef.current) popupRef.current = new mapboxgl.Popup({ maxWidth: '200px', closeButton: true, closeOnClick: false });

    whenStyleReady(map, () => {
      map.addSource(rallySourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] }, properties: { label } }] },
      });
      map.addLayer({
        id: rallySourceId,
        type: 'circle',
        source: rallySourceId,
        paint: { 'circle-color': '#d4a017', 'circle-radius': 14, 'circle-stroke-color': '#fbbf24', 'circle-stroke-width': 3 },
      });

      map.on('click', rallySourceId, () => {
        const html = `<div style="font-family:monospace;font-size:11px;color:#e0e0e0;background:#050505;padding:8px 10px;border-radius:4px;border:1px solid #d4a01740"><div style="font-weight:bold;color:#d4a017">Rally Point</div><div style="font-size:9px;color:#9ca3af;margin-top:2px">${label}</div></div>`;
        if (popupRef.current) popupRef.current.setLngLat([lng, lat]).setHTML(html).addTo(map);
      });
    });

    setRallyPointState({ lat, lng, label });
  }, [map, clearSource]);

  const clearRallyPoint = useCallback(() => {
    clearSource(rallySourceId);
    setRallyPointState(null);
  }, [clearSource]);

  const showCommandRings = useCallback((lat: number, lng: number) => {
    if (!map) return;
    clearSource(commandRingsSourceId);

    const rings = [
      { radius: 100, color: '#ef4444', label: 'Inner Perimeter' },
      { radius: 300, color: '#f59e0b', label: 'Outer Perimeter' },
      { radius: 500, color: '#888888', label: 'Staging Area' },
    ];

    const features = rings.map(ring => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] },
      properties: { radius: ring.radius, color: ring.color, label: ring.label, opacity: 0.08, strokeOpacity: 0.7 },
    }));

    whenStyleReady(map, () => {
      map.addSource(commandRingsSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: commandRingsSourceId,
        type: 'circle',
        source: commandRingsSourceId,
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['get', 'radius'],
          'circle-opacity': ['get', 'opacity'],
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-opacity': ['get', 'strokeOpacity'],
        },
      });
    });
  }, [map, clearSource]);

  const clearCommandRings = useCallback(() => { clearSource(commandRingsSourceId); }, [clearSource]);

  const showK9Radius = useCallback((lat: number, lng: number) => {
    if (!map) return;
    clearSource(k9SourceId);

    whenStyleReady(map, () => {
      map.addSource(k9SourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] }, properties: {} }] },
      });
      map.addLayer({
        id: k9SourceId,
        type: 'circle',
        source: k9SourceId,
        paint: { 'circle-color': '#22c55e', 'circle-radius': 800, 'circle-opacity': 0.06, 'circle-stroke-color': '#22c55e', 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.6 },
      });
    });
  }, [map, clearSource]);

  const clearK9Radius = useCallback(() => { clearSource(k9SourceId); }, [clearSource]);

  const showHospitals = useCallback(() => {
    if (!map) return;
    clearSource(hospitalSourceId);

    const features = HOSPITALS.map(h => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [h.lng, h.lat] as [number, number] },
      properties: { name: h.name },
    }));

    if (!popupRef.current) popupRef.current = new mapboxgl.Popup({ maxWidth: '200px', closeButton: true, closeOnClick: false });

    whenStyleReady(map, () => {
      map.addSource(hospitalSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: hospitalSourceId,
        type: 'circle',
        source: hospitalSourceId,
        paint: { 'circle-color': '#888888', 'circle-radius': 8, 'circle-stroke-color': '#666666', 'circle-stroke-width': 1 },
      });

      map.on('click', hospitalSourceId, (e) => {
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;
        const html = `<div style="font-family:monospace;font-size:11px;color:#e0e0e0;background:#050505;padding:8px 10px;border-radius:4px;border:1px solid #88888840"><div style="font-weight:bold;color:#888888">Hospital</div><div style="font-size:9px;color:#9ca3af;margin-top:2px">${feature.properties.name}</div></div>`;
        if (popupRef.current) popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
    });
  }, [map, clearSource]);

  const showFireStations = useCallback(() => {
    if (!map) return;
    clearSource(fireSourceId);

    const features = FIRE_STATIONS.map(fs => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [fs.lng, fs.lat] as [number, number] },
      properties: { name: fs.name },
    }));

    if (!popupRef.current) popupRef.current = new mapboxgl.Popup({ maxWidth: '200px', closeButton: true, closeOnClick: false });

    whenStyleReady(map, () => {
      map.addSource(fireSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: fireSourceId,
        type: 'circle',
        source: fireSourceId,
        paint: { 'circle-color': '#ef4444', 'circle-radius': 8, 'circle-stroke-color': '#b91c1c', 'circle-stroke-width': 1 },
      });

      map.on('click', fireSourceId, (e) => {
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;
        const html = `<div style="font-family:monospace;font-size:11px;color:#e0e0e0;background:#050505;padding:8px 10px;border-radius:4px;border:1px solid #ef444440"><div style="font-weight:bold;color:#ef4444">Fire Station</div><div style="font-size:9px;color:#9ca3af;margin-top:2px">${feature.properties.name}</div></div>`;
        if (popupRef.current) popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
    });
  }, [map, clearSource]);

  const hideEmergencyServices = useCallback(() => {
    clearSource(hospitalSourceId);
    clearSource(fireSourceId);
  }, [clearSource]);

  const addEntryPoint = useCallback((lat: number, lng: number, label: string) => {
    if (!map) return;

    entryCounterRef.current += 1;
    const num = entryCounterRef.current;

    const source = map.getSource(entrySourceId) as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      const data = source._data as any;
      const features = data?.features || [];
      features.push({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] },
        properties: { label, number: num },
      });
      source.setData({ type: 'FeatureCollection', features });
    } else {
      whenStyleReady(map, () => {
        map.addSource(entrySourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] }, properties: { label, number: num } }] },
        });
        map.addLayer({
          id: entrySourceId,
          type: 'circle',
          source: entrySourceId,
          paint: { 'circle-color': '#8b5cf6', 'circle-radius': 12, 'circle-stroke-color': '#a78bfa', 'circle-stroke-width': 2 },
        });
      });
    }

    setEntryPoints(prev => [...prev, { lat, lng, label, number: num }]);
  }, [map]);

  const clearEntryPoints = useCallback(() => {
    clearSource(entrySourceId);
    entryCounterRef.current = 0;
    setEntryPoints([]);
  }, [clearSource]);

  const estimateCrowdDensity = useCallback((lat: number, lng: number): CrowdDensity => {
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
  }, []);

  return {
    rallyPoint, setRallyPoint, clearRallyPoint,
    showCommandRings, clearCommandRings,
    showK9Radius, clearK9Radius,
    showHospitals, showFireStations, hideEmergencyServices,
    entryPoints, addEntryPoint, clearEntryPoints,
    estimateCrowdDensity, loading,
  };
}
