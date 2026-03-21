import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { formatIncidentType } from '../../../utils/caseNumbers';

interface UseMapHeatmapParams {
  mapInstanceRef: React.MutableRefObject<google.maps.Map | null>;
  mapLoaded: boolean;
}

export function useMapHeatmap({ mapInstanceRef, mapLoaded }: UseMapHeatmapParams) {
  const heatmapLayerRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);

  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapData, setHeatmapData] = useState<any[]>([]);
  const [heatmapDays, setHeatmapDays] = useState(30);
  const [heatmapMode, setHeatmapMode] = useState<'all' | 'risk' | 'type'>('all');
  const [heatmapTypeFilter, setHeatmapTypeFilter] = useState('');
  const [heatmapTypes, setHeatmapTypes] = useState<{ incident_type: string; count: number }[]>([]);

  // Fetch heatmap data
  useEffect(() => {
    if (!showHeatmap) { setHeatmapData([]); return; }
    let cancelled = false;
    let url = `/dispatch/heatmap?days=${heatmapDays}&mode=${heatmapMode}`;
    if (heatmapMode === 'type' && heatmapTypeFilter) url += `&type=${encodeURIComponent(heatmapTypeFilter)}`;
    apiFetch<any[]>(url)
      .then((data) => { if (!cancelled) setHeatmapData(data || []); })
      .catch(() => { if (!cancelled) setHeatmapData([]); });
    return () => { cancelled = true; };
  }, [showHeatmap, heatmapDays, heatmapMode, heatmapTypeFilter]);

  // Fetch available incident types for heatmap type filter
  useEffect(() => {
    if (!showHeatmap) return;
    let cancelled = false;
    apiFetch<{ incident_type: string; count: number }[]>('/dispatch/heatmap/types')
      .then((data) => { if (!cancelled) setHeatmapTypes(data || []); })
      .catch((err) => { console.warn('[MapPage] fetch heatmap types failed:', err); });
    return () => { cancelled = true; };
  }, [showHeatmap]);

  // Render heatmap layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    if (heatmapLayerRef.current) {
      heatmapLayerRef.current.setMap(null);
      heatmapLayerRef.current = null;
    }

    if (!showHeatmap || heatmapData.length === 0) return;

    const weightedData = heatmapData
      .filter((p: any) => p.latitude != null && p.longitude != null)
      .map((point: any) => ({
        location: new google.maps.LatLng(point.latitude, point.longitude),
        weight: heatmapMode === 'risk' ? (point.risk_weight || point.count || 1) : (point.count || 1),
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

    const heatmap = new google.maps.visualization.HeatmapLayer({
      data: weightedData,
      map,
      radius: 30,
      opacity: 0.7,
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
  }, [showHeatmap, heatmapData, heatmapMode, mapLoaded, mapInstanceRef]);

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
  };
}
