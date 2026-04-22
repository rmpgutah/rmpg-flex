// ============================================================
// RMPG Flex — useMapTactical Hook
// Advanced tactical features: rally points, perimeter rings,
// K9 radius, hospital/fire station markers, entry/exit points,
// and crowd density estimation.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';

// ─── Types ──────────────────────────────────────────────────

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

// ─── Static Data ────────────────────────────────────────────

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

// ─── Venue hotspots for crowd estimation ────────────────────

const VENUE_ZONES: { lat: number; lng: number; radius: number; name: string; peakHours: number[] }[] = [
  { lat: 40.7683, lng: -111.9011, radius: 300, name: 'Vivint Arena', peakHours: [18, 19, 20, 21, 22] },
  { lat: 40.7512, lng: -111.8775, radius: 200, name: 'Gateway Mall', peakHours: [11, 12, 13, 14, 15, 16, 17, 18, 19] },
  { lat: 40.7608, lng: -111.891, radius: 150, name: 'Temple Square', peakHours: [10, 11, 12, 13, 14, 15, 16] },
  { lat: 40.7625, lng: -111.876, radius: 250, name: 'Downtown Bar District', peakHours: [20, 21, 22, 23, 0, 1] },
  { lat: 40.7713, lng: -111.8542, radius: 500, name: 'University of Utah', peakHours: [9, 10, 11, 12, 13, 14, 15] },
];

// ─── Hook ───────────────────────────────────────────────────

export function useMapTactical(
  map: google.maps.Map | null,
): UseMapTacticalReturn {
  const [rallyPoint, setRallyPointState] = useState<RallyPoint | null>(null);
  const [entryPoints, setEntryPoints] = useState<EntryPoint[]>([]);
  // loading state reserved for future async operations (currently unused)
  const loading = false;

  // Refs for Google Maps objects
  const rallyMarkerRef = useRef<google.maps.Marker | null>(null);
  const commandRingsRef = useRef<google.maps.Circle[]>([]);
  const k9CircleRef = useRef<google.maps.Circle | null>(null);
  const hospitalMarkersRef = useRef<google.maps.Marker[]>([]);
  const fireMarkersRef = useRef<google.maps.Marker[]>([]);
  const entryMarkersRef = useRef<google.maps.Marker[]>([]);
  const entryCounterRef = useRef(0);

  // ── Cleanup on unmount ──────────────────────────────────

  useEffect(() => {
    return () => {
      if (rallyMarkerRef.current) {
        if (window.google?.maps?.event) google.maps.event.clearInstanceListeners(rallyMarkerRef.current);
        rallyMarkerRef.current.setMap(null);
      }
      commandRingsRef.current.forEach((c) => c.setMap(null));
      if (k9CircleRef.current) k9CircleRef.current.setMap(null);
      hospitalMarkersRef.current.forEach((m) => {
        if (window.google?.maps?.event) google.maps.event.clearInstanceListeners(m);
        m.setMap(null);
      });
      fireMarkersRef.current.forEach((m) => {
        if (window.google?.maps?.event) google.maps.event.clearInstanceListeners(m);
        m.setMap(null);
      });
      entryMarkersRef.current.forEach((m) => {
        if (window.google?.maps?.event) google.maps.event.clearInstanceListeners(m);
        m.setMap(null);
      });
    };
  }, []);

  // ── Rally Point ─────────────────────────────────────────

  const setRallyPoint = useCallback(
    (lat: number, lng: number, label: string) => {
      if (!map || !window.google?.maps) return;

      rallyMarkerRef.current?.setMap(null);

      const marker = new google.maps.Marker({
        position: { lat, lng },
        map,
        title: `Rally: ${label}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 14,
          fillColor: '#d4a017',
          fillOpacity: 1,
          strokeColor: '#fbbf24',
          strokeWeight: 3,
        },
        label: {
          text: '\u2605',
          color: '#050505',
          fontSize: '14px',
          fontWeight: 'bold',
        },
        zIndex: 9999,
      });

      rallyMarkerRef.current = marker;
      setRallyPointState({ lat, lng, label });
    },
    [map],
  );

  const clearRallyPoint = useCallback(() => {
    rallyMarkerRef.current?.setMap(null);
    rallyMarkerRef.current = null;
    setRallyPointState(null);
  }, []);

  // ── Command Rings (Inner/Outer/Staging perimeters) ──────

  const showCommandRings = useCallback(
    (lat: number, lng: number) => {
      if (!map || !window.google?.maps) return;

      // Clear existing
      commandRingsRef.current.forEach((c) => c.setMap(null));
      commandRingsRef.current = [];

      const rings: { radius: number; color: string; label: string }[] = [
        { radius: 100, color: '#ef4444', label: 'Inner Perimeter' },
        { radius: 300, color: '#f59e0b', label: 'Outer Perimeter' },
        { radius: 500, color: '#888888', label: 'Staging Area' },
      ];

      for (const ring of rings) {
        const circle = new google.maps.Circle({
          center: { lat, lng },
          radius: ring.radius,
          map,
          fillColor: ring.color,
          fillOpacity: 0.08,
          strokeColor: ring.color,
          strokeOpacity: 0.7,
          strokeWeight: 2,
          zIndex: 100,
        });
        commandRingsRef.current.push(circle);
      }
    },
    [map],
  );

  const clearCommandRings = useCallback(() => {
    commandRingsRef.current.forEach((c) => c.setMap(null));
    commandRingsRef.current = [];
  }, []);

  // ── K9 Deployment Radius ────────────────────────────────

  const showK9Radius = useCallback(
    (lat: number, lng: number) => {
      if (!map || !window.google?.maps) return;

      k9CircleRef.current?.setMap(null);

      k9CircleRef.current = new google.maps.Circle({
        center: { lat, lng },
        radius: 800,
        map,
        fillColor: '#22c55e',
        fillOpacity: 0.06,
        strokeColor: '#22c55e',
        strokeOpacity: 0.6,
        strokeWeight: 2,
        zIndex: 90,
      });
    },
    [map],
  );

  const clearK9Radius = useCallback(() => {
    k9CircleRef.current?.setMap(null);
    k9CircleRef.current = null;
  }, []);

  // ── Hospital Markers ────────────────────────────────────

  const showHospitals = useCallback(() => {
    if (!map || !window.google?.maps) return;

    // Don't re-create if already showing
    if (hospitalMarkersRef.current.length > 0) return;

    for (const h of HOSPITALS) {
      const marker = new google.maps.Marker({
        position: { lat: h.lat, lng: h.lng },
        map,
        title: h.name,
        icon: {
          path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z',
          fillColor: '#888888',
          fillOpacity: 0.9,
          strokeColor: '#666666',
          strokeWeight: 1,
          scale: 1.4,
          anchor: new google.maps.Point(12, 22),
        },
        label: {
          text: '+',
          color: '#ffffff',
          fontSize: '11px',
          fontWeight: 'bold',
        },
        zIndex: 500,
      });
      hospitalMarkersRef.current.push(marker);
    }
  }, [map]);

  // ── Fire Station Markers ────────────────────────────────

  const showFireStations = useCallback(() => {
    if (!map || !window.google?.maps) return;

    if (fireMarkersRef.current.length > 0) return;

    for (const fs of FIRE_STATIONS) {
      const marker = new google.maps.Marker({
        position: { lat: fs.lat, lng: fs.lng },
        map,
        title: fs.name,
        icon: {
          path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z',
          fillColor: '#ef4444',
          fillOpacity: 0.9,
          strokeColor: '#b91c1c',
          strokeWeight: 1,
          scale: 1.4,
          anchor: new google.maps.Point(12, 22),
        },
        label: {
          text: '\uD83D\uDD25',
          color: '#ffffff',
          fontSize: '9px',
        },
        zIndex: 500,
      });
      fireMarkersRef.current.push(marker);
    }
  }, [map]);

  // ── Hide emergency service markers ──────────────────────

  const hideEmergencyServices = useCallback(() => {
    hospitalMarkersRef.current.forEach((m) => m.setMap(null));
    hospitalMarkersRef.current = [];
    fireMarkersRef.current.forEach((m) => m.setMap(null));
    fireMarkersRef.current = [];
  }, []);

  // ── Entry/Exit Points ───────────────────────────────────

  const addEntryPoint = useCallback(
    (lat: number, lng: number, label: string) => {
      if (!map || !window.google?.maps) return;

      entryCounterRef.current += 1;
      const num = entryCounterRef.current;

      const marker = new google.maps.Marker({
        position: { lat, lng },
        map,
        title: `Entry ${num}: ${label}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: '#8b5cf6',
          fillOpacity: 0.9,
          strokeColor: '#a78bfa',
          strokeWeight: 2,
        },
        label: {
          text: String(num),
          color: '#ffffff',
          fontSize: '10px',
          fontWeight: 'bold',
        },
        zIndex: 800,
      });

      entryMarkersRef.current.push(marker);
      setEntryPoints((prev) => [...prev, { lat, lng, label, number: num }]);
    },
    [map],
  );

  const clearEntryPoints = useCallback(() => {
    entryMarkersRef.current.forEach((m) => m.setMap(null));
    entryMarkersRef.current = [];
    entryCounterRef.current = 0;
    setEntryPoints([]);
  }, []);

  // ── Crowd Density Estimation ────────────────────────────

  const estimateCrowdDensity = useCallback(
    (lat: number, lng: number): CrowdDensity => {
      const now = new Date();
      const hour = now.getHours();
      const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      for (const venue of VENUE_ZONES) {
        const dist = haversineMeters(lat, lng, venue.lat, venue.lng);
        if (dist <= venue.radius) {
          const isPeakHour = venue.peakHours.includes(hour);
          if (isPeakHour || isWeekend) return 'High (200+)';
          return 'Medium (50-200)';
        }
      }

      // Downtown SLC general area
      if (
        lat >= 40.745 &&
        lat <= 40.775 &&
        lng >= -111.91 &&
        lng <= -111.86
      ) {
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

// ─── Utility ────────────────────────────────────────────────

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
