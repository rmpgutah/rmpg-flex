import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

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

const SOURCE_ID = 'map-heatmap-timelapse-source';
const LAYER_ID = 'map-heatmap-timelapse-layer';

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

function renderHeatmapLayer(
  map: mapboxgl.Map,
  points: { latitude: number; longitude: number; count: number; risk_weight?: number }[],
  mode: 'all' | 'risk',
) {
  if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

  if (!points || points.length === 0) return;

  const features = points
    .filter((p) => p.latitude != null && p.longitude != null)
    .map((point) => ({
      type: 'Feature' as const,
      properties: { weight: mode === 'risk' ? (point.risk_weight || point.count || 1) : (point.count || 1) },
      geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] },
    }));

  if (features.length === 0) return;

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features },
  });

  map.addLayer({
    id: LAYER_ID,
    type: 'heatmap',
    source: SOURCE_ID,
    paint: {
      'heatmap-weight': ['get', 'weight'],
      'heatmap-intensity': 0.8,
      'heatmap-radius': 30,
      'heatmap-opacity': 0.7,
      'heatmap-color': mode === 'risk'
        ? [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, 'rgba(255,165,0,0.3)',
            0.4, 'rgba(255,100,0,0.5)',
            0.6, 'rgba(255,50,0,0.7)',
            0.8, 'rgba(255,0,0,0.85)',
            1, 'rgba(200,0,0,1)',
          ]
        : [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, 'rgba(0,128,255,0.2)',
            0.4, 'rgba(0,200,100,0.4)',
            0.6, 'rgba(200,200,0,0.6)',
            0.8, 'rgba(255,140,0,0.8)',
            1, 'rgba(255,50,0,0.95)',
          ],
    },
  });
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
        if (!cancelled) {
          setSlices(data || []);
          setCurrentIndex(0);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[useMapHeatmapTimelapse] Timelapse data fetch failed:', err);
          setSlices([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [enabled, days, mode]);

  useEffect(() => {
    if (!map) return;

    if (!enabled || slices.length === 0) {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      return;
    }

    const slice = slices[currentIndex];
    if (!slice || !slice.points || slice.points.length === 0) {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      return;
    }

    renderHeatmapLayer(map, slice.points, mode);
  }, [map, enabled, slices, currentIndex, mode]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

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

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, speed, slices.length]);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (map && map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map && map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    }
  }, [enabled, map]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (map) {
        try {
          if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
          if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
        } catch { /* ignore */ }
      }
    };
  }, [map]);

  const currentLabel = slices.length > 0 && slices[currentIndex]
    ? formatSliceLabel(slices[currentIndex], days)
    : '';

  return {
    isPlaying,
    setIsPlaying,
    speed,
    setSpeed,
    currentIndex,
    setCurrentIndex,
    totalSlices: slices.length,
    currentLabel,
    loading,
  };
}