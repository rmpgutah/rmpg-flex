import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { whenStyleReady } from '../utils/safeAddSource';

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

const GRADIENTS: Record<HeatmapColorScheme, [number, string][]> = {
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

const COMPARISON_GRADIENT: [number, string][] = [
  [0, 'rgba(0,0,0,0)'],
  [0.2, 'rgba(170,170,170,0.2)'],
  [0.4, 'rgba(140,140,140,0.35)'],
  [0.6, 'rgba(110,110,110,0.5)'],
  [0.8, 'rgba(85,85,85,0.7)'],
  [1, 'rgba(60,60,60,0.9)'],
];

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

  const fetchData = useCallback((hourOverride?: number) => {
    if (!options.enabled) return;

    const counter = ++fetchCounterRef.current;
    setLoading(true);

    const url = buildUrl(hourOverride);
    apiFetch<AdvancedHeatmapResponse>(url)
      .then((data) => {
        if (counter !== fetchCounterRef.current) return;
        const pts = data?.points || [];
        setPoints(pts);
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
        if (next === 0 && prev === 23) {
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

  useEffect(() => {
    if (!map) return;

    const sourceId = 'adv-heatmap';
    const layerId = 'adv-heatmap-layer';
    const compSourceId = 'adv-heatmap-comparison';
    const compLayerId = 'adv-heatmap-comparison-layer';
    const clusterSourceId = 'adv-heatmap-clusters';
    const clusterLayerId = 'adv-heatmap-clusters-layer';

    // Remove existing
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    if (map.getLayer(compLayerId)) map.removeLayer(compLayerId);
    if (map.getSource(compSourceId)) map.removeSource(compSourceId);
    if (map.getLayer(clusterLayerId)) map.removeLayer(clusterLayerId);
    if (map.getSource(clusterSourceId)) map.removeSource(clusterSourceId);

    if (!options.enabled || points.length === 0) return;

    const weightedData = points
      .filter((p) => p.lat != null && p.lng != null)
      .map((point) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] as [number, number] },
        properties: { weight: point.weight || 1 },
      }));

    if (weightedData.length === 0) return;

    const gradient = GRADIENTS[options.colorScheme] || GRADIENTS.heat;

    whenStyleReady(map, () => {
      map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: weightedData } });
      map.addLayer({
        id: layerId,
        type: 'heatmap',
        source: sourceId,
        maxzoom: 15,
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-intensity': 0.8,
          'heatmap-radius': options.radius,
          'heatmap-opacity': options.opacity / 100,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], ...gradient.flat()],
        },
      });

      if (options.mode === 'comparison' && comparisonPoints.length > 0) {
        const compData = comparisonPoints
          .filter((p) => p.lat != null && p.lng != null)
          .map((point) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] as [number, number] },
            properties: { weight: point.weight || 1 },
          }));

        if (compData.length > 0) {
          map.addSource(compSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: compData } });
          map.addLayer({
            id: compLayerId,
            type: 'heatmap',
            source: compSourceId,
            maxzoom: 15,
            paint: {
              'heatmap-weight': ['get', 'weight'],
              'heatmap-intensity': 0.8,
              'heatmap-radius': options.radius,
              'heatmap-opacity': (options.opacity / 100) * 0.7,
              'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], ...COMPARISON_GRADIENT.flat()],
            },
          });
        }
      }

      if (options.showClusters && clusters.length > 0) {
        const clusterFeatures = clusters.map((cluster) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [cluster.center.lng, cluster.center.lat] as [number, number] },
          properties: {
            count: cluster.count,
            avgRisk: cluster.avgRisk,
            radius: cluster.radius,
          },
        }));

        map.addSource(clusterSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: clusterFeatures } });
        map.addLayer({
          id: clusterLayerId,
          type: 'circle',
          source: clusterSourceId,
          paint: {
            'circle-color': [
              'case',
              ['>', ['get', 'avgRisk'], 5], '#ef4444',
              ['>', ['get', 'avgRisk'], 2], '#f59e0b',
              '#888888',
            ],
            'circle-radius': ['get', 'radius'],
            'circle-opacity': 0.08,
            'circle-stroke-color': [
              'case',
              ['>', ['get', 'avgRisk'], 5], '#ef4444',
              ['>', ['get', 'avgRisk'], 2], '#f59e0b',
              '#888888',
            ],
            'circle-stroke-width': 1.5,
            'circle-stroke-opacity': 0.5,
          },
        });
      }
    });

    return () => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      if (map.getLayer(compLayerId)) map.removeLayer(compLayerId);
      if (map.getSource(compSourceId)) map.removeSource(compSourceId);
      if (map.getLayer(clusterLayerId)) map.removeLayer(clusterLayerId);
      if (map.getSource(clusterSourceId)) map.removeSource(clusterSourceId);
    };
  }, [map, options.enabled, points, options.colorScheme, options.opacity, options.radius, options.mode, comparisonPoints, options.showClusters, clusters]);

  useEffect(() => {
    if (!options.enabled) {
      if (temporalIntervalRef.current) {
        clearInterval(temporalIntervalRef.current);
        temporalIntervalRef.current = null;
      }
    }
  }, [options.enabled]);

  useEffect(() => {
    return () => {
      if (temporalIntervalRef.current) clearInterval(temporalIntervalRef.current);
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
