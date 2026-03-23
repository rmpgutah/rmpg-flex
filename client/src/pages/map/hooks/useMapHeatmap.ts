import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { formatIncidentType } from '../../../utils/caseNumbers';
import { useToast } from '../../../components/ToastProvider';

// Fix 12: cap heatmap points to prevent performance issues
const MAX_HEATMAP_POINTS = 10000;

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
  const [heatmapLoading, setHeatmapLoading] = useState(false); // Fix 45: loading indicator

  // Fetch heatmap data
  useEffect(() => {
    if (!showHeatmap) { setHeatmapData([]); return; }
    let cancelled = false;
    setHeatmapLoading(true); // Fix 45: loading indicator
    let url = `/dispatch/heatmap?days=${heatmapDays}&mode=${heatmapMode}`;
    if (heatmapMode === 'type' && heatmapTypeFilter) url += `&type=${encodeURIComponent(heatmapTypeFilter)}`;
    apiFetch<any[]>(url)
      .then((data) => { if (!cancelled) { setHeatmapData(data || []); setHeatmapLoading(false); } })
      .catch((err) => {
        if (!cancelled) {
          setHeatmapData([]);
          setHeatmapLoading(false);
          console.warn('[useMapHeatmap] Heatmap fetch failed:', err); // Fix 43: error logging
        }
      });
    return () => { cancelled = true; };
  }, [showHeatmap, heatmapDays, heatmapMode, heatmapTypeFilter]);

  // Fetch available incident types for heatmap type filter
  useEffect(() => {
    if (!showHeatmap) return;
    let cancelled = false;
    apiFetch<{ incident_type: string; count: number }[]>('/dispatch/heatmap/types')
      .then((data) => { if (!cancelled) setHeatmapTypes(data || []); })
      .catch((err) => { if (!cancelled) console.warn('[MapPage] fetch heatmap types failed:', err); });
    return () => { cancelled = true; };
  }, [showHeatmap]);

  // Render heatmap layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    // Fix 44: clear heatmap layer before creating new one (prevent stacking)
    if (heatmapLayerRef.current) {
      heatmapLayerRef.current.setMap(null);
      heatmapLayerRef.current = null;
    }

    if (!showHeatmap || heatmapData.length === 0) return;

    // Fix 9: guard for missing visualization library
    if (!google.maps.visualization?.HeatmapLayer) {
      console.warn('[useMapHeatmap] google.maps.visualization.HeatmapLayer not available');
      return;
    }

    try { // Fix 10: try/catch around heatmap creation
      const weightedData = heatmapData
        // Fix 11: validate data points have finite lat/lng
        .filter((p: any) => p.latitude != null && p.longitude != null && isFinite(p.latitude) && isFinite(p.longitude))
        // Fix 12: cap at MAX_HEATMAP_POINTS
        .slice(0, MAX_HEATMAP_POINTS)
        .map((point: any) => ({
          location: new google.maps.LatLng(point.latitude, point.longitude),
          weight: heatmapMode === 'risk' ? (point.risk_weight || point.count || 1) : (point.count || 1),
        }));

      // Fix 14: dark-theme compatible gradient colors
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
        dissipating: true, // Fix 13: ensure dissipating is always true
      });

      heatmapLayerRef.current = heatmap;
    } catch (err) {
      console.warn('[useMapHeatmap] Error creating heatmap layer:', err);
    }

    return () => {
      if (heatmapLayerRef.current) {
        heatmapLayerRef.current.setMap(null);
        heatmapLayerRef.current = null;
      }
    };
  // mapInstanceRef excluded from deps — refs are stable, including it is misleading
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
    heatmapLoading, // Fix 45: loading indicator
  };
}
