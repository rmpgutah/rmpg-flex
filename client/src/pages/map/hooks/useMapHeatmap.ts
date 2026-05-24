import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

const MAX_HEATMAP_POINTS = 10000;

interface UseMapHeatmapParams {
  mapInstanceRef: React.MutableRefObject<mapboxgl.Map | null>;
  mapLoaded: boolean;
}

export function useMapHeatmap({ mapInstanceRef, mapLoaded }: UseMapHeatmapParams) {
  const heatmapSourceId = 'heatmap-data';

  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapData, setHeatmapData] = useState<any[]>([]);
  const [heatmapDays, setHeatmapDays] = useState(30);
  const [heatmapMode, setHeatmapMode] = useState<'all' | 'risk' | 'type'>('all');
  const [heatmapTypeFilter, setHeatmapTypeFilter] = useState('');
  const [heatmapTypes, setHeatmapTypes] = useState<{ incident_type: string; count: number }[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

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

  useEffect(() => {
    if (!showHeatmap) return;
    let cancelled = false;
    apiFetch<{ incident_type: string; count: number }[]>('/dispatch/heatmap/types')
      .then((data) => { if (!cancelled) setHeatmapTypes(data || []); })
      .catch((err) => { if (!cancelled) console.warn('[MapPage] fetch heatmap types failed:', err); });
    return () => { cancelled = true; };
  }, [showHeatmap]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    if (!showHeatmap || heatmapData.length === 0) {
      if (map.getLayer('heatmap-layer')) map.removeLayer('heatmap-layer');
      if (map.getSource(heatmapSourceId)) map.removeSource(heatmapSourceId);
      return;
    }

    const validPoints = heatmapData
      .filter((p: any) => p.latitude != null && p.longitude != null && isFinite(p.latitude) && isFinite(p.longitude))
      .slice(0, MAX_HEATMAP_POINTS);

    const features = validPoints.map((point: any) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] as [number, number] },
      properties: { weight: heatmapMode === 'risk' ? (point.risk_weight || point.count || 1) : (point.count || 1) },
    }));

    const gradient = heatmapMode === 'risk'
      ? [
          'rgba(0,0,0,0)',
          'rgba(255,165,0,0.3)',
          'rgba(255,100,0,0.5)',
          'rgba(255,50,0,0.7)',
          'rgba(255,0,0,0.85)',
          'rgba(200,0,0,1)',
        ]
      : [
          'rgba(0,0,0,0)',
          'rgba(0,128,255,0.2)',
          'rgba(0,200,100,0.4)',
          'rgba(200,200,0,0.6)',
          'rgba(255,140,0,0.8)',
          'rgba(255,50,0,0.95)',
        ];

    if (map.getSource(heatmapSourceId)) {
      (map.getSource(heatmapSourceId) as mapboxgl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features,
      });
    } else {
      map.addSource(heatmapSourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });
      map.addLayer({
        id: 'heatmap-layer',
        type: 'heatmap',
        source: heatmapSourceId,
        maxzoom: 15,
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-intensity': 0.8,
          'heatmap-radius': 30,
          'heatmap-opacity': 0.7,
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, gradient[0],
            0.2, gradient[1],
            0.4, gradient[2],
            0.6, gradient[3],
            0.8, gradient[4],
            1, gradient[5],
          ],
        },
      });
    }

    return () => {
      if (map.getLayer('heatmap-layer')) map.removeLayer('heatmap-layer');
      if (map.getSource(heatmapSourceId)) map.removeSource(heatmapSourceId);
    };
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
