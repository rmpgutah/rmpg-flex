import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

export type HeatmapAdvancedMode = 'density' | 'risk' | 'temporal' | 'comparison';
export type HeatmapColorScheme = 'heat' | 'risk' | 'gold' | 'green' | 'purple';
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
  opacity: number;
  radius: number;
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
  temporalHour: number;
  setTemporalHour: (h: number) => void;
  temporalPlaying: boolean;
  setTemporalPlaying: (v: boolean) => void;
  temporalSpeed: 1 | 2 | 4;
  setTemporalSpeed: (v: 1 | 2 | 4) => void;
}

function getHeatmapColorExpr(scheme: HeatmapColorScheme): any[] {
  const gradients: Record<HeatmapColorScheme, [number, string][]> = {
    heat: [
      [0, 'rgba(0,0,0,0)'],
      [0.2, 'rgba(0,128,255,0.25)'],
      [0.4, 'rgba(0,200,100,0.4)'],
      [0.6, 'rgba(200,200,0,0.6)'],
      [0.8, 'rgba(255,140,0,0.8)'],
      [1, 'rgba(255,50,0,0.95)'],
    ],
    risk: [
      [0, 'rgba(0,0,0,0)'],
      [0.2, 'rgba(76,175,80,0.25)'],
      [0.4, 'rgba(255,235,59,0.4)'],
      [0.6, 'rgba(255,152,0,0.6)'],
      [0.8, 'rgba(244,67,54,0.8)'],
      [1, 'rgba(183,28,28,1)'],
    ],
    gold: [
      [0, 'rgba(0,0,0,0)'],
      [0.2, 'rgba(253,224,71,0.2)'],
      [0.4, 'rgba(250,204,21,0.4)'],
      [0.6, 'rgba(212,160,23,0.6)'],
      [0.8, 'rgba(180,130,15,0.8)'],
      [1, 'rgba(133,77,14,1)'],
    ],
    green: [
      [0, 'rgba(0,0,0,0)'],
      [0.2, 'rgba(144,238,144,0.2)'],
      [0.4, 'rgba(60,179,113,0.4)'],
      [0.6, 'rgba(34,139,34,0.6)'],
      [0.8, 'rgba(0,100,0,0.8)'],
      [1, 'rgba(0,60,0,1)'],
    ],
    purple: [
      [0, 'rgba(0,0,0,0)'],
      [0.2, 'rgba(216,191,216,0.2)'],
      [0.4, 'rgba(186,85,211,0.4)'],
      [0.6, 'rgba(148,103,189,0.6)'],
      [0.8, 'rgba(106,13,173,0.8)'],
      [1, 'rgba(75,0,130,1)'],
    ],
  };
  const stops = gradients[scheme] || gradients.heat;
  return ['interpolate', ['linear'], ['heatmap-density'], ...stops.flat()];
}

const COMPARISON_INTERPOLATE = [
  'interpolate', ['linear'], ['heatmap-density'],
  0, 'rgba(0,0,0,0)',
  0.2, 'rgba(170,170,170,0.2)',
  0.4, 'rgba(140,140,140,0.35)',
  0.6, 'rgba(110,110,110,0.5)',
  0.8, 'rgba(85,85,85,0.7)',
  1, 'rgba(60,60,60,0.9)',
];

function buildHeatmapGeoJSON(points: HeatmapAdvancedPoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points
      .filter((p) => p.lat != null && p.lng != null)
      .map((point) => ({
        type: 'Feature' as const,
        properties: { weight: point.weight || 1 },
        geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] },
      })),
  };
}

const PRIMARY_HEATMAP_SOURCE = 'advanced-heatmap-primary-source';
const PRIMARY_HEATMAP_LAYER = 'advanced-heatmap-primary-layer';
const COMP_HEATMAP_SOURCE = 'advanced-heatmap-comp-source';
const COMP_HEATMAP_LAYER = 'advanced-heatmap-comp-layer';
const CLUSTER_CIRCLE_SOURCE = 'advanced-heatmap-cluster-source';
const CLUSTER_CIRCLE_LAYER = 'advanced-heatmap-cluster-layer';

export function useMapHeatmapAdvanced(
  map: mapboxgl.Map | null,
  options: HeatmapAdvancedOptions,
): UseMapHeatmapAdvancedReturn {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<HeatmapStats | null>(null);
  const [clusters, setClusters] = useState<HeatmapCluster[]>([]);
  const [points, setPoints] = useState<HeatmapAdvancedPoint[]>([]);
  const [comparisonPoints, setComparisonPoints] = useState<HeatmapAdvancedPoint[]>([]);

  const [temporalHour, setTemporalHour] = useState(0);
  const [temporalPlaying, setTemporalPlaying] = useState(false);
  const [temporalSpeed, setTemporalSpeed] = useState<1 | 2 | 4>(1);

  const temporalIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchCounterRef = useRef(0);

  function removeHeatmapLayers(map: mapboxgl.Map, source: string, layer: string) {
    try {
      if (map.getLayer(layer)) map.removeLayer(layer);
      if (map.getSource(source)) map.removeSource(source);
    } catch { /* ignore */ }
  }

  function addHeatmapLayer(map: mapboxgl.Map, sourceId: string, layerId: string, data: GeoJSON.FeatureCollection, radius: number, opacity: number, colorExpr: any) {
    map.addSource(sourceId, { type: 'geojson', data });
    map.addLayer({
      id: layerId,
      type: 'heatmap',
      source: sourceId,
      paint: {
        'heatmap-weight': ['get', 'weight'],
        'heatmap-intensity': 0.8,
        'heatmap-radius': radius,
        'heatmap-opacity': opacity / 100,
        'heatmap-color': colorExpr,
      },
    });
  }

  const buildUrl = useCallback((hourOverride?: number) => {
    const p = new URLSearchParams();
    p.set('days', String(options.days));
    p.set('mode', options.mode);
    p.set('resolution', options.resolution);
    if (options.types.length > 0) p.set('types', options.types.join(','));
    if (options.hourRange[0] !== 0 || options.hourRange[1] !== 23) {
      p.set('hourStart', String(options.hourRange[0]));
      p.set('hourEnd', String(options.hourRange[1]));
    }
    if (options.dayFilter.length > 0 && options.dayFilter.length < 7) {
      p.set('dayFilter', options.dayFilter.join(','));
    }
    if (options.mode === 'comparison') p.set('comparisonDays', String(options.comparisonDays));
    if (options.mode === 'temporal' && hourOverride !== undefined) p.set('temporalHour', String(hourOverride));
    return `/dispatch/heatmap/advanced?${p.toString()}`;
  }, [options]);

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
      .catch((err) => {
        if (counter !== fetchCounterRef.current) return;
        console.error('[AdvancedHeatmap] Fetch error:', err);
        setPoints([]);
        setComparisonPoints([]);
        setClusters([]);
        setStats(null);
        setLoading(false);
      });
  }, [options.enabled, buildUrl]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData, options.enabled, options.mode, temporalHour]);

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
        if (next === 0 && prev === 23) setTemporalPlaying(false);
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

  // Primary heatmap layer
  useEffect(() => {
    if (!map) return;
    removeHeatmapLayers(map, PRIMARY_HEATMAP_SOURCE, PRIMARY_HEATMAP_LAYER);
    if (!options.enabled || points.length === 0) return;
    const data = buildHeatmapGeoJSON(points);
    if (data.features.length === 0) return;
    addHeatmapLayer(map, PRIMARY_HEATMAP_SOURCE, PRIMARY_HEATMAP_LAYER, data, options.radius, options.opacity, getHeatmapColorExpr(options.colorScheme));
    return () => removeHeatmapLayers(map, PRIMARY_HEATMAP_SOURCE, PRIMARY_HEATMAP_LAYER);
  }, [map, options.enabled, points, options.colorScheme, options.opacity, options.radius]);

  // Comparison heatmap layer
  useEffect(() => {
    if (!map) return;
    removeHeatmapLayers(map, COMP_HEATMAP_SOURCE, COMP_HEATMAP_LAYER);
    if (!options.enabled || options.mode !== 'comparison' || comparisonPoints.length === 0) return;
    const data = buildHeatmapGeoJSON(comparisonPoints);
    if (data.features.length === 0) return;
    addHeatmapLayer(map, COMP_HEATMAP_SOURCE, COMP_HEATMAP_LAYER, data, options.radius, (options.opacity / 100) * 0.7, COMPARISON_INTERPOLATE);
    return () => removeHeatmapLayers(map, COMP_HEATMAP_SOURCE, COMP_HEATMAP_LAYER);
  }, [map, options.enabled, options.mode, comparisonPoints, options.opacity, options.radius]);

  // Cluster circle layer
  useEffect(() => {
    if (!map) return;
    removeHeatmapLayers(map, CLUSTER_CIRCLE_SOURCE, CLUSTER_CIRCLE_LAYER);
    if (!options.enabled || !options.showClusters || clusters.length === 0) return;
    const features: GeoJSON.Feature[] = clusters.map((c) => ({
      type: 'Feature',
      properties: {
        count: c.count,
        avgRisk: c.avgRisk,
        color: c.avgRisk > 5 ? '#ef4444' : c.avgRisk > 2 ? '#f59e0b' : '#888888',
      },
      geometry: { type: 'Point', coordinates: [c.center.lng, c.center.lat] },
    }));
    map.addSource(CLUSTER_CIRCLE_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });
    map.addLayer({
      id: CLUSTER_CIRCLE_LAYER,
      type: 'circle',
      source: CLUSTER_CIRCLE_SOURCE,
      paint: {
        'circle-radius': ['sqrt', ['get', 'count']],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.15,
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': 1.5,
        'circle-stroke-opacity': 0.5,
      },
    });
    return () => removeHeatmapLayers(map, CLUSTER_CIRCLE_SOURCE, CLUSTER_CIRCLE_LAYER);
  }, [map, options.enabled, options.showClusters, clusters]);

  useEffect(() => {
    if (!options.enabled) {
      if (temporalIntervalRef.current) {
        clearInterval(temporalIntervalRef.current);
        temporalIntervalRef.current = null;
      }
      if (map) {
        removeHeatmapLayers(map, PRIMARY_HEATMAP_SOURCE, PRIMARY_HEATMAP_LAYER);
        removeHeatmapLayers(map, COMP_HEATMAP_SOURCE, COMP_HEATMAP_LAYER);
        removeHeatmapLayers(map, CLUSTER_CIRCLE_SOURCE, CLUSTER_CIRCLE_LAYER);
      }
    }
  }, [options.enabled, map]);

  useEffect(() => {
    return () => {
      if (temporalIntervalRef.current) clearInterval(temporalIntervalRef.current);
      if (map) {
        removeHeatmapLayers(map, PRIMARY_HEATMAP_SOURCE, PRIMARY_HEATMAP_LAYER);
        removeHeatmapLayers(map, COMP_HEATMAP_SOURCE, COMP_HEATMAP_LAYER);
        removeHeatmapLayers(map, CLUSTER_CIRCLE_SOURCE, CLUSTER_CIRCLE_LAYER);
      }
    };
  }, [map]);

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