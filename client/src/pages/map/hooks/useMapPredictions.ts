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

function circleToPolygon(center: [number, number], radiusM: number, segments = 32): [number, number][] {
  const [lng, lat] = center;
  const km = radiusM / 1000;
  const ret: [number, number][] = [];
  const distanceX = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const distanceY = km / 110.574;
  for (let i = 0; i < segments; i++) {
    const theta = (2 * Math.PI * i) / segments;
    const dx = distanceX * Math.cos(theta);
    const dy = distanceY * Math.sin(theta);
    ret.push([lng + dx, lat + dy]);
  }
  return ret;
}

function removeSourceAndLayer(map: mapboxgl.Map, layerId: string, sourceId: string) {
  try { if (map.getLayer(layerId)) map.removeLayer(layerId); if (map.getSource(sourceId)) map.removeSource(sourceId); } catch { /* ignore */ }
}

export function useMapPredictions(
  map: mapboxgl.Map | null,
  enabled: boolean,
  shift?: 'day' | 'swing' | 'night',
): UseMapPredictionsReturn {
  const [hotspots, setHotspots] = useState<PredictedHotspot[]>([]);
  const [loading, setLoading] = useState(false);

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const layerIdsRef = useRef<string[]>([]);
  const sourceIdsRef = useRef<string[]>([]);
  const pulseIntervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);

  function removeLayers() {
    if (!map) return;
    layerIdsRef.current.forEach((id) => { try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* ignore */ } });
    sourceIdsRef.current.forEach((id) => { try { if (map.getSource(id)) map.removeSource(id); } catch { /* ignore */ } });
    layerIdsRef.current = [];
    sourceIdsRef.current = [];
    pulseIntervalsRef.current.forEach((id) => clearInterval(id));
    pulseIntervalsRef.current = [];
    popupRef.current?.remove();
    popupRef.current = null;
  }

  useEffect(() => {
    if (!enabled) { setHotspots([]); return; }

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
    removeLayers();

    if (!map || !enabled || hotspots.length === 0) return;

    hotspots.forEach((hs, index) => {
      if (hs.latitude == null || hs.longitude == null) return;
      if (!isFinite(hs.latitude) || !isFinite(hs.longitude)) return;

      const isHigh = hs.score > 50;
      const color = isHigh ? '#dc2626' : '#f59e0b';
      const normalizedScore = Math.min(100, Math.max(0, hs.score));
      const fillOpacity = 0.08 + (normalizedScore / 100) * 0.2;
      const strokeOpacity = 0.3 + (normalizedScore / 100) * 0.5;
      const radius = Math.max(150, Math.min(400, 150 + hs.incident_count * 10));

      const sourceId = `prediction-source-${index}`;
      const layerId = `prediction-layer-${index}`;

      const poly = circleToPolygon([hs.longitude, hs.latitude], radius);
      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [poly] } }] },
      });
      map.addLayer({ id: layerId, type: 'fill', source: sourceId, paint: { 'fill-color': color, 'fill-opacity': fillOpacity, 'fill-outline-color': color } });

      layerIdsRef.current.push(layerId);
      sourceIdsRef.current.push(sourceId);

      if (isHigh && hs.score > 70) {
        let opacity = strokeOpacity;
        let dir = -1;
        const pulseInterval = setInterval(() => {
          opacity += dir * 0.04;
          if (opacity <= 0.2) { opacity = 0.2; dir = 1; }
          if (opacity >= 0.8) { opacity = 0.8; dir = -1; }
          if (map && map.getLayer(layerId)) {
            map.setPaintProperty(layerId, 'fill-opacity', opacity);
          }
        }, 600);
        pulseIntervalsRef.current.push(pulseInterval);
      }

      map.on('click', layerId, () => {
        const pctScore = `${Math.round(normalizedScore)}%`;
        const html = `
          <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222">
            <div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}">Predicted Hotspot</div>
            <table style="width:100%;font-size:11px;border-collapse:collapse">
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Confidence</td><td style="font-weight:bold;color:#fff">${pctScore}</td></tr>
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Raw Score</td><td style="color:#9ca3af">${hs.score}</td></tr>
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Incidents</td><td style="color:#e0e0e0">${hs.incident_count}</td></tr>
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Top Types</td><td style="color:#e0e0e0">${hs.top_types ? escapeHtml(hs.top_types) : '&mdash;'}</td></tr>
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Weapons</td><td style="color:#ef4444">${hs.weapons_count}</td></tr>
              <tr><td style="color:#888888;padding:1px 6px 1px 0">DV</td><td style="color:#f59e0b">${hs.dv_count}</td></tr>
            </table>
          </div>`;
        popupRef.current?.remove();
        popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '360px', offset: 15 })
          .setLngLat([hs.longitude, hs.latitude])
          .setHTML(html)
          .addTo(map);

        map.panTo([hs.longitude, hs.latitude]);
        const currentZoom = map.getZoom();
        if (currentZoom < 14) map.setZoom(14);
      });
    });

    return () => { removeLayers(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled, hotspots]);

  useEffect(() => {
    return () => {
      pulseIntervalsRef.current.forEach((id) => clearInterval(id));
      pulseIntervalsRef.current = [];
      if (map) {
        layerIdsRef.current.forEach((id) => { try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* ignore */ } });
        sourceIdsRef.current.forEach((id) => { try { if (map.getSource(id)) map.removeSource(id); } catch { /* ignore */ } });
      }
      layerIdsRef.current = [];
      sourceIdsRef.current = [];
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { hotspots, loading };
}