// ============================================================
// RMPG Flex — useMapHeatmapAdvanced Hook
// Enhanced heatmap with multi-type filtering, color schemes,
// adjustable radius/opacity, cluster overlays, comparison mode,
// temporal animation, and floating stats panel.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

export type HeatmapAdvancedMode = 'density' | 'risk' | 'temporal' | 'comparison';
export type HeatmapColorScheme = 'heat' | 'risk' | 'blue' | 'green' | 'purple';
export type HeatmapResolution = 'fine' | 'medium' | 'coarse';

export interface HeatmapAdvancedOptions {
  enabled: boolean;
  days: number;
  mode: HeatmapAdvancedMode;
  types: string[];
  hourRange: [number, number];
  dayFilter: number[];
  resolution: HeatmapResolution;
  colorScheme: HeatmapColorScheme;
  opacity: number;       // 10-100
  radius: number;        // 10-50 px
  showClusters: boolean;
  comparisonDays: number;
}

export interface HeatmapCluster {
  center: { lat: number; lng: number };
  radius: number;
  count: number;
  avgRisk: number;
}

export interface HeatmapStats {
  total: number;
  topTypes: { type: string; count: number }[];
  peakHour: number | null;
  peakDay: string | null;
}

export interface HeatmapAdvancedPoint {
  lat: number;
  lng: number;
  weight: number;
  count: number;
  types: string;
  riskScore: number;
}

interface AdvancedHeatmapResponse {
  points: HeatmapAdvancedPoint[];
  comparisonPoints?: HeatmapAdvancedPoint[];
  clusters: HeatmapCluster[];
  stats: HeatmapStats;
}

export interface UseMapHeatmapAdvancedReturn {
  loading: boolean;
  stats: HeatmapStats | null;
  clusters: HeatmapCluster[];
  pointCount: number;
  comparisonPointCount: number;
  refreshHeatmap: () => void;
  // Temporal animation state
  temporalHour: number;
  setTemporalHour: (h: number) => void;
  temporalPlaying: boolean;
  setTemporalPlaying: (v: boolean) => void;
  temporalSpeed: 1 | 2 | 4;
  setTemporalSpeed: (v: 1 | 2 | 4) => void;
}

// ─── Color Scheme Gradients ────────────────────────────────

const GRADIENTS: Record<HeatmapColorScheme, string[]> = {
  heat: [
    'rgba(0,0,0,0)',
    'rgba(0,128,255,0.25)',
    'rgba(0,200,100,0.4)',
    'rgba(200,200,0,0.6)',
    'rgba(255,140,0,0.8)',
    'rgba(255,50,0,0.95)',
  ],
  risk: [
    'rgba(0,0,0,0)',
    'rgba(76,175,80,0.25)',
    'rgba(255,235,59,0.4)',
    'rgba(255,152,0,0.6)',
    'rgba(244,67,54,0.8)',
    'rgba(183,28,28,1)',
  ],
  blue: [
    'rgba(0,0,0,0)',
    'rgba(173,216,230,0.2)',
    'rgba(100,149,237,0.4)',
    'rgba(65,105,225,0.6)',
    'rgba(0,0,205,0.8)',
    'rgba(0,0,139,1)',
  ],
  green: [
    'rgba(0,0,0,0)',
    'rgba(144,238,144,0.2)',
    'rgba(60,179,113,0.4)',
    'rgba(34,139,34,0.6)',
    'rgba(0,100,0,0.8)',
    'rgba(0,60,0,1)',
  ],
  purple: [
    'rgba(0,0,0,0)',
    'rgba(216,191,216,0.2)',
    'rgba(186,85,211,0.4)',
    'rgba(148,103,189,0.6)',
    'rgba(106,13,173,0.8)',
    'rgba(75,0,130,1)',
  ],
};

// Comparison mode uses cool tones for previous period
const COMPARISON_GRADIENT = [
  'rgba(0,0,0,0)',
  'rgba(100,149,237,0.2)',
  'rgba(70,130,230,0.35)',
  'rgba(30,100,220,0.5)',
  'rgba(0,70,200,0.7)',
  'rgba(0,40,160,0.9)',
];

// ─── Hook ───────────────────────────────────────────────────

export function useMapHeatmapAdvanced(
  map: google.maps.Map | null,
  options: HeatmapAdvancedOptions,
): UseMapHeatmapAdvancedReturn {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<HeatmapStats | null>(null);
  const [clusters, setClusters] = useState<HeatmapCluster[]>([]);
  const [points, setPoints] = useState<HeatmapAdvancedPoint[]>([]);
  const [comparisonPoints, setComparisonPoints] = useState<HeatmapAdvancedPoint[]>([]);

  // Temporal animation state
  const [temporalHour, setTemporalHour] = useState(0);
  const [temporalPlaying, setTemporalPlaying] = useState(false);
  const [temporalSpeed, setTemporalSpeed] = useState<1 | 2 | 4>(1);

  // Refs for map objects
  const heatmapLayerRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);
  const comparisonLayerRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);
  const clusterMarkersRef = useRef<google.maps.Circle[]>([]);
  const clusterLabelsRef = useRef<google.maps.Marker[]>([]);
  const temporalIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchCounterRef = useRef(0);

  // ── Build query URL ─────────────────────────────────────

  const buildUrl = useCallback((hourOverride?: number) => {
    const p = new URLSearchParams();
    p.set('days', String(options.days));
    p.set('mode', options.mode);
    p.set('resolution', options.resolution);

    if (options.types.length > 0) {
      p.set('types', options.types.join(','));
    }
    if (options.hourRange[0] !== 0 || options.hourRange[1] !== 23) {
      p.set('hourStart', String(options.hourRange[0]));
      p.set('hourEnd', String(options.hourRange[1]));
    }
    if (options.dayFilter.length > 0 && options.dayFilter.length < 7) {
      p.set('dayFilter', options.dayFilter.join(','));
    }
    if (options.mode === 'comparison') {
      p.set('comparisonDays', String(options.comparisonDays));
    }
    if (options.mode === 'temporal' && hourOverride !== undefined) {
      p.set('temporalHour', String(hourOverride));
    }
    return `/dispatch/heatmap/advanced?${p.toString()}`;
  }, [options]);

  // ── Fetch data ──────────────────────────────────────────

  const fetchData = useCallback((hourOverride?: number) => {
    if (!options.enabled) return;

    const counter = ++fetchCounterRef.current;
    setLoading(true);

    const url = buildUrl(hourOverride);
    apiFetch<AdvancedHeatmapResponse>(url)
      .then((data) => {
        if (counter !== fetchCounterRef.current) return;
        setPoints(data?.points || []);
        setComparisonPoints(data?.comparisonPoints || []);
        setClusters(data?.clusters || []);
        setStats(data?.stats || null);
        setLoading(false);
      })
      .catch(() => {
        if (counter !== fetchCounterRef.current) return;
        setPoints([]);
        setComparisonPoints([]);
        setClusters([]);
        setStats(null);
        setLoading(false);
      });
  }, [options.enabled, buildUrl]);

  // ── Main data fetch (non-temporal or initial) ───────────

  useEffect(() => {
    if (!options.enabled) {
      setPoints([]);
      setComparisonPoints([]);
      setClusters([]);
      setStats(null);
      return;
    }

    if (options.mode === 'temporal') {
      fetchData(temporalHour);
    } else {
      fetchData();
    }
    // fetchData captures buildUrl which captures all options — include it
    // so that switching modes/filters triggers a fresh fetch with the correct URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData, options.enabled, options.mode, temporalHour]);

  // ── Temporal auto-advance ───────────────────────────────

  useEffect(() => {
    if (temporalIntervalRef.current) {
      clearInterval(temporalIntervalRef.current);
      temporalIntervalRef.current = null;
    }

    if (!temporalPlaying || options.mode !== 'temporal' || !options.enabled) return;

    const delayMs = 2000 / temporalSpeed;

    temporalIntervalRef.current = setInterval(() => {
      setTemporalHour((prev) => {
        const next = (prev + 1) % 24;
        if (next === 0 && prev === 23) {
          // Completed full cycle
          setTemporalPlaying(false);
        }
        return next;
      });
    }, delayMs);

    return () => {
      if (temporalIntervalRef.current) {
        clearInterval(temporalIntervalRef.current);
        temporalIntervalRef.current = null;
      }
    };
  }, [temporalPlaying, temporalSpeed, options.mode, options.enabled]);

  // ── Render primary heatmap layer ────────────────────────

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    // Remove existing primary layer
    if (heatmapLayerRef.current) {
      heatmapLayerRef.current.setMap(null);
      heatmapLayerRef.current = null;
    }

    if (!options.enabled || points.length === 0) return;

    const weightedData = points
      .filter((p) => p.lat != null && p.lng != null)
      .map((point) => ({
        location: new google.maps.LatLng(point.lat, point.lng),
        weight: point.weight || 1,
      }));

    if (weightedData.length === 0) return;

    const gradient = GRADIENTS[options.colorScheme] || GRADIENTS.heat;

    const heatmap = new google.maps.visualization.HeatmapLayer({
      data: weightedData,
      map,
      radius: options.radius,
      opacity: options.opacity / 100,
      gradient,
      dissipating: true,
    });

    heatmapLayerRef.current = heatmap;

    return () => {
      if (heatmapLayerRef.current) {
        heatmapLayerRef.current.setMap(null);
        heatmapLayerRef.current = null;
      }
    };
  }, [map, options.enabled, points, options.colorScheme, options.opacity, options.radius]);

  // ── Render comparison heatmap layer ─────────────────────

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    if (comparisonLayerRef.current) {
      comparisonLayerRef.current.setMap(null);
      comparisonLayerRef.current = null;
    }

    if (!options.enabled || options.mode !== 'comparison' || comparisonPoints.length === 0) return;

    const weightedData = comparisonPoints
      .filter((p) => p.lat != null && p.lng != null)
      .map((point) => ({
        location: new google.maps.LatLng(point.lat, point.lng),
        weight: point.weight || 1,
      }));

    if (weightedData.length === 0) return;

    const heatmap = new google.maps.visualization.HeatmapLayer({
      data: weightedData,
      map,
      radius: options.radius,
      opacity: (options.opacity / 100) * 0.7, // slightly dimmer
      gradient: COMPARISON_GRADIENT,
      dissipating: true,
    });

    comparisonLayerRef.current = heatmap;

    return () => {
      if (comparisonLayerRef.current) {
        comparisonLayerRef.current.setMap(null);
        comparisonLayerRef.current = null;
      }
    };
  }, [map, options.enabled, options.mode, comparisonPoints, options.opacity, options.radius]);

  // ── Render cluster overlays ─────────────────────────────

  useEffect(() => {
    // Clear existing cluster markers
    clusterMarkersRef.current.forEach((c) => c.setMap(null));
    clusterMarkersRef.current = [];
    clusterLabelsRef.current.forEach((m) => m.setMap(null));
    clusterLabelsRef.current = [];

    if (!map || !options.enabled || !options.showClusters || clusters.length === 0) return;

    clusters.forEach((cluster) => {
      // Draw circle
      const circle = new google.maps.Circle({
        center: cluster.center,
        radius: cluster.radius,
        map,
        fillColor: cluster.avgRisk > 5 ? '#ef4444' : cluster.avgRisk > 2 ? '#f59e0b' : '#3b82f6',
        fillOpacity: 0.08,
        strokeColor: cluster.avgRisk > 5 ? '#ef4444' : cluster.avgRisk > 2 ? '#f59e0b' : '#3b82f6',
        strokeOpacity: 0.5,
        strokeWeight: 1.5,
        clickable: false,
        zIndex: 10,
      });
      clusterMarkersRef.current.push(circle);

      // Add label marker
      const label = new google.maps.Marker({
        position: cluster.center,
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 0, // invisible icon
        },
        label: {
          text: `${cluster.count}`,
          color: '#ffffff',
          fontSize: '10px',
          fontWeight: 'bold',
          fontFamily: 'JetBrains Mono, monospace',
        },
        clickable: false,
        zIndex: 11,
      });
      clusterLabelsRef.current.push(label);
    });

    return () => {
      clusterMarkersRef.current.forEach((c) => c.setMap(null));
      clusterMarkersRef.current = [];
      clusterLabelsRef.current.forEach((m) => m.setMap(null));
      clusterLabelsRef.current = [];
    };
  }, [map, options.enabled, options.showClusters, clusters]);

  // ── Cleanup on unmount / disable ────────────────────────

  useEffect(() => {
    if (!options.enabled) {
      if (temporalIntervalRef.current) {
        clearInterval(temporalIntervalRef.current);
        temporalIntervalRef.current = null;
      }
      if (heatmapLayerRef.current) {
        heatmapLayerRef.current.setMap(null);
        heatmapLayerRef.current = null;
      }
      if (comparisonLayerRef.current) {
        comparisonLayerRef.current.setMap(null);
        comparisonLayerRef.current = null;
      }
      clusterMarkersRef.current.forEach((c) => c.setMap(null));
      clusterMarkersRef.current = [];
      clusterLabelsRef.current.forEach((m) => m.setMap(null));
      clusterLabelsRef.current = [];
    }
  }, [options.enabled]);

  useEffect(() => {
    return () => {
      if (temporalIntervalRef.current) clearInterval(temporalIntervalRef.current);
      if (heatmapLayerRef.current) {
        heatmapLayerRef.current.setMap(null);
        heatmapLayerRef.current = null;
      }
      if (comparisonLayerRef.current) {
        comparisonLayerRef.current.setMap(null);
        comparisonLayerRef.current = null;
      }
      clusterMarkersRef.current.forEach((c) => c.setMap(null));
      clusterLabelsRef.current.forEach((m) => m.setMap(null));
    };
  }, []);

  return {
    loading,
    stats,
    clusters,
    pointCount: points.length,
    comparisonPointCount: comparisonPoints.length,
    refreshHeatmap: () => fetchData(options.mode === 'temporal' ? temporalHour : undefined),
    temporalHour,
    setTemporalHour,
    temporalPlaying,
    setTemporalPlaying,
    temporalSpeed,
    setTemporalSpeed,
  };
}
