import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { whenStyleReady } from '../utils/safeAddSource';

interface TimelapseSlice {
  start: string;
  end: string;
  points: { latitude: number; longitude: number; count: number; risk_weight?: number }[];
}

interface UseMapHeatmapTimelapseReturn {
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  speed: 1 | 2 | 4;
  setSpeed: (v: 1 | 2 | 4) => void;
  currentIndex: number;
  setCurrentIndex: (v: number) => void;
  totalSlices: number;
  currentLabel: string;
  loading: boolean;
}

const RISK_GRADIENT = ['rgba(0,0,0,0)', 'rgba(255,165,0,0.3)', 'rgba(255,100,0,0.5)', 'rgba(255,50,0,0.7)', 'rgba(255,0,0,0.85)', 'rgba(200,0,0,1)'];
const ALL_GRADIENT = ['rgba(0,0,0,0)', 'rgba(0,128,255,0.2)', 'rgba(0,200,100,0.4)', 'rgba(200,200,0,0.6)', 'rgba(255,140,0,0.8)', 'rgba(255,50,0,0.95)'];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatSliceLabel(slice: TimelapseSlice, days: number): string {
  const d = new Date(slice.start);
  if (isNaN(d.getTime())) return slice.start;
  if (days <= 7) {
    const hours = d.getHours().toString().padStart(2, '0');
    return `${DAY_NAMES[d.getDay()]} ${hours}:00`;
  }
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

export function useMapHeatmapTimelapse(
  map: mapboxgl.Map | null,
  enabled: boolean,
  days: number,
  mode: 'all' | 'risk',
): UseMapHeatmapTimelapseReturn {
  const [slices, setSlices] = useState<TimelapseSlice[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [loading, setLoading] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sourceId = 'heatmap-timelapse';

  useEffect(() => {
    if (!enabled) {
      setSlices([]);
      setCurrentIndex(0);
      setIsPlaying(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    apiFetch<TimelapseSlice[]>(`/dispatch/heatmap/timelapse?days=${days}&mode=${mode}`)
      .then((data) => {
        if (!cancelled) { setSlices(data || []); setCurrentIndex(0); setLoading(false); }
      })
      .catch((err) => {
        if (!cancelled) { console.warn('[useMapHeatmapTimelapse] Timelapse data fetch failed:', err); setSlices([]); setLoading(false); }
      });

    return () => { cancelled = true; };
  }, [enabled, days, mode]);

  const renderSlice = useCallback((slice: TimelapseSlice) => {
    if (!map) return;

    if (map.getLayer(sourceId)) map.removeLayer(sourceId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    if (!slice || !Array.isArray(slice.points) || slice.points.length === 0) return;

    const features = slice.points
      .filter(p => p.latitude != null && p.longitude != null)
      .map(point => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] as [number, number] },
        properties: { weight: mode === 'risk' ? (point.risk_weight || point.count || 1) : (point.count || 1) },
      }));

    if (features.length === 0) return;

    whenStyleReady(map, () => {
      map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: sourceId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-color': mode === 'risk' ? RISK_GRADIENT[RISK_GRADIENT.length - 1] : ALL_GRADIENT[ALL_GRADIENT.length - 1],
          'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 1, 10, 5, 20, 10, 30, 20, 40],
          'circle-opacity': 0.7,
          'circle-stroke-width': 0,
        },
      });
    });
  }, [map, mode]);

  useEffect(() => {
    if (!map || !enabled || slices.length === 0) return;
    const slice = slices[currentIndex];
    if (!slice || !Array.isArray(slice.points) || slice.points.length === 0) return;
    renderSlice(slice);

    return () => {
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, enabled, slices, currentIndex, renderSlice]);

  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (!isPlaying || slices.length === 0) return;

    const delayMs = 1000 / speed;
    intervalRef.current = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= slices.length - 1) {
          queueMicrotask(() => setIsPlaying(false));
          return prev;
        }
        return prev + 1;
      });
    }, delayMs);

    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };
  }, [isPlaying, speed, slices.length]);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      if (map) {
        if (map.getLayer(sourceId)) map.removeLayer(sourceId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      }
    }
  }, [enabled, map]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (map) {
        if (map.getLayer(sourceId)) map.removeLayer(sourceId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      }
    };
  }, [map]);

  const currentLabel = slices.length > 0 && slices[currentIndex] ? formatSliceLabel(slices[currentIndex], days) : '';

  return { isPlaying, setIsPlaying, speed, setSpeed, currentIndex, setCurrentIndex, totalSlices: slices.length, currentLabel, loading };
}
