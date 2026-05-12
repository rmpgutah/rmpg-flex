// ============================================================
// RMPG Flex — useMapClustering Hook
// ============================================================
// Replaces Google Maps MarkerClusterer with native Mapbox GL
// cluster sources. Groups call and incident markers into
// expandable clusters that reveal individual items on zoom-in
// or click.
// ============================================================

import { useEffect, useCallback, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { devLog } from '../utils/devLog';

// ── Types ─────────────────────────────────────────────────

export interface ClusterablePoint {
  id: string;
  longitude: number;
  latitude: number;
  priority?: string;
  label?: string;
  color?: string;
}

export interface UseMapClusteringResult {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
  updatePoints: (points: ClusterablePoint[]) => void;
}

// ── Constants ─────────────────────────────────────────────

const CLUSTER_SOURCE = 'rmpg-clusters';
const CLUSTER_CIRCLE = 'rmpg-cluster-circle';
const CLUSTER_COUNT = 'rmpg-cluster-count';
const CLUSTER_UNCLUSTERED = 'rmpg-cluster-unclustered';

function pointsToGeoJSON(points: ClusterablePoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map(p => ({
      type: 'Feature' as const,
      properties: { id: p.id, priority: p.priority || '3', label: p.label || '', color: p.color || '#d4a017' },
      geometry: { type: 'Point' as const, coordinates: [p.longitude, p.latitude] },
    })),
  };
}

// ── Hook ──────────────────────────────────────────────────

export function useMapClustering(map: mapboxgl.Map | null, mapLoaded: boolean): UseMapClusteringResult {
  const [enabled, setEnabled] = useState(false);
  const [points, setPoints] = useState<ClusterablePoint[]>([]);

  // Add or remove cluster layers based on enabled state
  useEffect(() => {
    if (!map || !mapLoaded) return;

    if (!enabled) {
      // Remove cluster layers
      [CLUSTER_UNCLUSTERED, CLUSTER_COUNT, CLUSTER_CIRCLE].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(CLUSTER_SOURCE)) map.removeSource(CLUSTER_SOURCE);
      return;
    }

    // Add cluster source + layers
    if (!map.getSource(CLUSTER_SOURCE)) {
      map.addSource(CLUSTER_SOURCE, {
        type: 'geojson',
        data: pointsToGeoJSON(points),
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // Cluster circles with size based on point_count
      map.addLayer({
        id: CLUSTER_CIRCLE,
        type: 'circle',
        source: CLUSTER_SOURCE,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            '#d4a017', 10,   // gold for < 10
            '#f59e0b', 30,   // amber for < 30
            '#ef4444',       // red for >= 30
          ],
          'circle-radius': [
            'step', ['get', 'point_count'],
            18, 10,
            24, 30,
            32,
          ],
          'circle-opacity': 0.85,
          'circle-stroke-color': '#0a0a0a',
          'circle-stroke-width': 2,
        },
      });

      // Cluster count labels
      map.addLayer({
        id: CLUSTER_COUNT,
        type: 'symbol',
        source: CLUSTER_SOURCE,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 11,
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      });

      // Unclustered individual points
      map.addLayer({
        id: CLUSTER_UNCLUSTERED,
        type: 'circle',
        source: CLUSTER_SOURCE,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 6,
          'circle-stroke-color': '#0a0a0a',
          'circle-stroke-width': 1.5,
        },
      });

      devLog('[Clustering] Cluster layers added');
    }

    // Click to expand cluster
    const onClusterClick = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapGeoJSONFeature[] }) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [CLUSTER_CIRCLE] });
      if (!features.length) return;
      const clusterId = features[0].properties?.cluster_id;
      if (clusterId == null) return;
      (map.getSource(CLUSTER_SOURCE) as mapboxgl.GeoJSONSource).getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err || zoom == null) return;
        const coords = (features[0].geometry as GeoJSON.Point).coordinates as [number, number];
        map.easeTo({ center: coords, zoom: zoom + 1 });
      });
    };

    // Pointer cursor on clusters
    const onMouseEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onMouseLeave = () => { map.getCanvas().style.cursor = ''; };

    map.on('click', CLUSTER_CIRCLE, onClusterClick);
    map.on('mouseenter', CLUSTER_CIRCLE, onMouseEnter);
    map.on('mouseleave', CLUSTER_CIRCLE, onMouseLeave);

    return () => {
      map.off('click', CLUSTER_CIRCLE, onClusterClick);
      map.off('mouseenter', CLUSTER_CIRCLE, onMouseEnter);
      map.off('mouseleave', CLUSTER_CIRCLE, onMouseLeave);
    };
  }, [map, mapLoaded, enabled, points]);

  // Update data when points change
  useEffect(() => {
    if (!map || !mapLoaded || !enabled) return;
    const src = map.getSource(CLUSTER_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(pointsToGeoJSON(points));
  }, [map, mapLoaded, enabled, points]);

  const toggle = useCallback(() => setEnabled(v => !v), []);

  const updatePoints = useCallback((pts: ClusterablePoint[]) => {
    setPoints(pts);
  }, []);

  return { enabled, toggle, setEnabled, updatePoints };
}
