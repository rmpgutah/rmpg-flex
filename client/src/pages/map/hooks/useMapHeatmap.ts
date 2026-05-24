import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

const MAX_HEATMAP_POINTS = 10000;
const SOURCE_ID = 'map-heatmap-source';
const LAYER_ID = 'map-heatmap-layer';

interface UseMapHeatmapParams {
  mapInstanceRef: React.MutableRefObject<mapboxgl.Map | null>;
  mapLoaded: boolean;
}

export function useMapHeatmap({ mapInstanceRef, mapLoaded }: UseMapHeatmapParams) {
  const cleanupRef = useRef<(() => void) | null>(null);

  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapData, setHeatmapData] = useState<any[]>([]);
  const [heatmapDays, setHeatmapDays] = useState(30);
  const [heatmapMode, setHeatmapMode] = useState<'all' | 'risk' | 'type'>('all');
  const [heatmapTypeFilter, setHeatmapTypeFilter] = useState('');
  const [heatmapTypes, setHeatmapTypes] = useState<{ incident_type: string; count: number }[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  // Fetch heatmap data
  useEffect(() => {
    if (!showHeatmap) { setHeatmapData([]); return; }
    let cancelled = false;
    setHeatmapLoading(true);
    let url = `/dispatch/heatmap?days=${heatmapDays}&mode=${heatmapMode}`;
    if (heatmapMode === 'type' && heatmapTypeFilter) url += `&type=${encodeURIComponent(heatmapTypeFilter)}`;
    apiFetch<any[]>(url)
      .then((data) => { if (!cancelled) { setHeatmapData(data || []); setHeatmapLoading(false); } })
      .catch((err) => {
        if (!cancelled) {
          setHeatmapData([]);
          setHeatmapLoading(false);
          console.warn('[useMapHeatmap] Heatmap fetch failed:', err);
        }
      });
    return () => { cancelled = true; };
  }, [showHeatmap, heatmapDays, heatmapMode, heatmapTypeFilter]);

  // Fetch available incident types
  useEffect(() => {
    if (!showHeatmap) return;
    let cancelled = false;
    apiFetch<{ incident_type: string; count: number }[]>('/dispatch/heatmap/types')
      .then((data) => { if (!cancelled) setHeatmapTypes(data || []); })
      .catch((err) => { if (!cancelled) console.warn('[MapPage] fetch heatmap types failed:', err); });
    return () => { cancelled = true; };
  }, [showHeatmap]);

  // Render heatmap layer via Mapbox heatmap layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    // Cleanup previous layer
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }

    if (!showHeatmap || heatmapData.length === 0) {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      return;
    }

    try {
      const points = heatmapData
        .filter((p: any) => p.latitude != null && p.longitude != null && isFinite(p.latitude) && isFinite(p.longitude))
        .slice(0, MAX_HEATMAP_POINTS)
        .map((point: any) => ({
          type: 'Feature' as const,
          properties: {
            weight: heatmapMode === 'risk' ? (point.risk_weight || point.count || 1) : (point.count || 1),
          },
          geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] },
        }));

      if (points.length === 0) return;

      // Remove existing
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: points },
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
          'heatmap-color': heatmapMode === 'risk'
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

      cleanupRef.current = () => {
        try {
          if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
          if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
        } catch { /* ignore */ }
      };
    } catch (err) {
      console.warn('[useMapHeatmap] Error creating heatmap layer:', err);
    }

    return () => {
      if (cleanupRef.current) cleanupRef.current();
      cleanupRef.current = null;
    };
    // mapInstanceRef excluded — refs are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHeatmap, heatmapData, heatmapMode, mapLoaded]);

  return {
    showHeatmap,
    setShowHeatmap,
    heatmapData,
    heatmapDays,
    setHeatmapDays,
    heatmapMode,
    setHeatmapMode,
    heatmapTypeFilter,
    setHeatmapTypeFilter,
    heatmapTypes,
    heatmapLoading,
  };
}