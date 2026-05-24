import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { escapeHtml } from '../../../utils/sanitize';

export interface PredictedHotspot {
  latitude: number;
  longitude: number;
  score: number;
  incident_count: number;
  top_types: string;
  weapons_count: number;
  dv_count: number;
}

interface UseMapPredictionsReturn {
  hotspots: PredictedHotspot[];
  loading: boolean;
}

export function useMapPredictions(
  map: mapboxgl.Map | null,
  enabled: boolean,
  shift?: 'day' | 'swing' | 'night',
): UseMapPredictionsReturn {
  const [hotspots, setHotspots] = useState<PredictedHotspot[]>([]);
  const [loading, setLoading] = useState(false);

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const sourceId = 'predictions';

  useEffect(() => {
    if (!enabled) {
      setHotspots([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const qs = shift ? `?shift=${shift}` : '';
    apiFetch<{ hotspots: PredictedHotspot[]; shift: string; total: number } | PredictedHotspot[]>(`/dispatch/heatmap/predictions${qs}`)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data?.hotspots || []);
        setHotspots(list);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[Predictions] Fetch error:', err);
        setHotspots([]);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [enabled, shift]);

  useEffect(() => {
    if (!map) return;

    if (map.getLayer(sourceId)) map.removeLayer(sourceId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    if (!enabled || hotspots.length === 0) return;

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });
    }

    const features = hotspots
      .filter((hs) => hs.latitude != null && hs.longitude != null && isFinite(hs.latitude) && isFinite(hs.longitude))
      .map((hs) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [hs.longitude, hs.latitude] as [number, number] },
        properties: {
          score: hs.score,
          incident_count: hs.incident_count,
          top_types: hs.top_types,
          weapons_count: hs.weapons_count,
          dv_count: hs.dv_count,
          isHigh: hs.score > 50,
        },
      }));

    if (features.length === 0) return;

    map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
      id: sourceId,
      type: 'circle',
      source: sourceId,
      paint: {
        'circle-color': ['case', ['get', 'isHigh'], '#dc2626', '#f59e0b'],
        'circle-radius': [
          'interpolate', ['linear'], ['get', 'score'],
          0, 15,
          50, 25,
          100, 40,
        ],
        'circle-opacity': [
          'interpolate', ['linear'], ['get', 'score'],
          0, 0.08,
          100, 0.28,
        ],
        'circle-stroke-color': ['case', ['get', 'isHigh'], '#dc2626', '#f59e0b'],
        'circle-stroke-width': 2,
        'circle-stroke-opacity': [
          'interpolate', ['linear'], ['get', 'score'],
          0, 0.3,
          100, 0.8,
        ],
      },
    });

    map.on('click', sourceId, (e) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;
      const p = feature.properties;
      const normalizedScore = Math.min(100, Math.max(0, p.score as number));
      const color = p.isHigh ? '#dc2626' : '#f59e0b';
      const html = `
        <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222">
          <div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}">Predicted Hotspot</div>
          <table style="width:100%;font-size:11px;border-collapse:collapse">
            <tr><td style="color:#888888;padding:1px 6px 1px 0">Confidence</td><td style="font-weight:bold;color:#fff">${Math.round(normalizedScore)}%</td></tr>
            <tr><td style="color:#888888;padding:1px 6px 1px 0">Raw Score</td><td style="color:#9ca3af">${p.score}</td></tr>
            <tr><td style="color:#888888;padding:1px 6px 1px 0">Incidents</td><td style="color:#e0e0e0">${p.incident_count}</td></tr>
            <tr><td style="color:#888888;padding:1px 6px 1px 0">Top Types</td><td style="color:#e0e0e0">${p.top_types ? escapeHtml(p.top_types as string) : '\u2014'}</td></tr>
            <tr><td style="color:#888888;padding:1px 6px 1px 0">Weapons</td><td style="color:#ef4444">${p.weapons_count}</td></tr>
            <tr><td style="color:#888888;padding:1px 6px 1px 0">DV</td><td style="color:#f59e0b">${p.dv_count}</td></tr>
          </table>
        </div>
      `;
      if (popupRef.current) {
        popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
      }
      map.panTo(e.lngLat);
      const currentZoom = map.getZoom();
      if (currentZoom != null && currentZoom < 14) {
        map.setZoom(14);
      }
    });

    return () => {
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, enabled, hotspots]);

  useEffect(() => {
    return () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, []);

  return { hotspots, loading };
}
