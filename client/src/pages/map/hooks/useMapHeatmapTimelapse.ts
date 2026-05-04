// ============================================================
// RMPG Flex — useMapHeatmapTimelapse Hook
// Time-lapse heatmap animation — animates through hourly/daily
// slices of incident data as a heatmap layer.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

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

// ─── Gradient configs (matches useMapHeatmap) ───────────────

const RISK_GRADIENT = [
  'rgba(0,0,0,0)',
  'rgba(255,165,0,0.3)',
  'rgba(255,100,0,0.5)',
  'rgba(255,50,0,0.7)',
  'rgba(255,0,0,0.85)',
  'rgba(200,0,0,1)',
];

const ALL_GRADIENT = [
  'rgba(0,0,0,0)',
  'rgba(0,128,255,0.2)',
  'rgba(0,200,100,0.4)',
  'rgba(200,200,0,0.6)',
  'rgba(255,140,0,0.8)',
  'rgba(255,50,0,0.95)',
];

// ─── Label formatting ───────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatSliceLabel(slice: TimelapseSlice, days: number): string {
  const d = new Date(slice.start);
  if (isNaN(d.getTime())) return slice.start;

  // For short ranges (<=7 days), show hourly format: "Mon 14:00"
  if (days <= 7) {
    const hours = d.getHours().toString().padStart(2, '0');
    return `${DAY_NAMES[d.getDay()]} ${hours}:00`;
  }

  // For longer ranges, show daily format: "Mar 15"
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapHeatmapTimelapse(
  map: google.maps.Map | null,
  enabled: boolean,
  days: number,
  mode: 'all' | 'risk',
): UseMapHeatmapTimelapseReturn {
  const [slices, setSlices] = useState<TimelapseSlice[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [loading, setLoading] = useState(false);

  const heatmapLayerRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch timelapse data ─────────────────────────────────

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

  // ── Render current slice as heatmap layer ────────────────

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    // Remove existing layer
    if (heatmapLayerRef.current) {
      heatmapLayerRef.current.setMap(null);
      heatmapLayerRef.current = null;
    }

    if (!enabled || slices.length === 0) return;

    const slice = slices[currentIndex];
    if (!slice || !slice.points || slice.points.length === 0) return;

    const weightedData = slice.points
      .filter((p) => p.latitude != null && p.longitude != null)
      .map((point) => ({
        location: new google.maps.LatLng(point.latitude, point.longitude),
        weight: mode === 'risk' ? (point.risk_weight || point.count || 1) : (point.count || 1),
      }));

    if (weightedData.length === 0) return;

    const heatmap = new google.maps.visualization.HeatmapLayer({
      data: weightedData,
      map,
      radius: 30,
      opacity: 0.7,
      gradient: mode === 'risk' ? RISK_GRADIENT : ALL_GRADIENT,
      dissipating: true,
    });

    heatmapLayerRef.current = heatmap;

    return () => {
      if (heatmapLayerRef.current) {
        heatmapLayerRef.current.setMap(null);
        heatmapLayerRef.current = null;
      }
    };
  }, [map, enabled, slices, currentIndex, mode]);

  // ── Playback animation ──────────────────────────────────

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
          // Move setIsPlaying outside the updater to avoid state update during render
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

  // ── Cleanup on unmount / disable ────────────────────────

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (heatmapLayerRef.current) {
        heatmapLayerRef.current.setMap(null);
        heatmapLayerRef.current = null;
      }
    }
  }, [enabled]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (heatmapLayerRef.current) {
        heatmapLayerRef.current.setMap(null);
        heatmapLayerRef.current = null;
      }
    };
  }, []);

  // ── Derived label ───────────────────────────────────────

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
