import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { escapeHtml } from '../../../utils/sanitize';

const TRAIL_COLORS = ['#22c55e', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#aaaaaa', '#c084fc'];

const MAX_TRAIL_POINTS_PER_UNIT = 2000;
const MIN_TRAIL_POINT_DISTANCE_M = 0.5;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return Infinity;
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const MPS_TO_MPH = 2.23694;

export const speedToColor = (speedMps: number | null): string => {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0.2) return '#666666';
  const mph = speedMps * MPS_TO_MPH;
  if (mph < 3)   return '#999999';
  if (mph < 10)  return '#22c55e';
  if (mph < 25)  return '#22c55e';
  if (mph < 35)  return '#84cc16';
  if (mph < 45)  return '#eab308';
  if (mph < 55)  return '#f97316';
  if (mph < 75)  return '#ef4444';
  return '#dc2626';
};

const speedToWeight = (speedMps: number | null): number => {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0.2) return 1;
  const mph = speedMps * MPS_TO_MPH;
  if (mph < 3)  return 2;
  if (mph < 35) return 3;
  if (mph < 75) return 4;
  return 5;
};

export const SPEED_LEGEND_BANDS = [
  { color: '#666666', label: 'Stationary', range: '0 mph' },
  { color: '#999999', label: 'Walking', range: '<3 mph' },
  { color: '#22c55e', label: 'Slow Drive', range: '3-10 mph' },
  { color: '#22c55e', label: 'Residential', range: '10-25 mph' },
  { color: '#84cc16', label: 'City Street', range: '25-35 mph' },
  { color: '#eab308', label: 'Arterial', range: '35-45 mph' },
  { color: '#f97316', label: 'Highway', range: '45-55 mph' },
  { color: '#ef4444', label: 'Freeway', range: '55-75 mph' },
  { color: '#dc2626', label: 'Pursuit', range: '75+ mph' },
];

const statusToColor = (status: string): string => {
  switch (status) {
    case 'dispatched': return '#f59e0b';
    case 'enroute':    return '#888888';
    case 'onscene':    return '#ef4444';
    case 'available':  return '#22c55e';
    case 'busy':       return '#8b5cf6';
    case 'off_duty':   return '#666666';
    default:           return '#666666';
  }
};

interface UseMapBreadcrumbsParams {
  mapInstanceRef: React.MutableRefObject<mapboxgl.Map | null>;
  mapLoaded: boolean;
}

export function useMapBreadcrumbs({ mapInstanceRef, mapLoaded }: UseMapBreadcrumbsParams) {
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(true);
  const [breadcrumbHours, setBreadcrumbHours] = useState(8);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [breadcrumbColorMode, setBreadcrumbColorMode] = useState<'unit' | 'speed' | 'status'>('unit');
  const breadcrumbSourceId = 'breadcrumbs';
  const breadcrumbArrowsSourceId = 'breadcrumb-arrows';
  const speedAlertSourceId = 'breadcrumb-speed-alerts';
  const breadcrumbPopupRef = useRef<mapboxgl.Popup | null>(null);

  const [playbackTrails, setPlaybackTrails] = useState<{ unit_id: number; call_sign: string; officer_name: string; badge_number: string; points: { lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null; status: string; call_number: string | null; call_type: string | null; time: string; road_name: string | null; intersection: string | null }[] }[]>([]);
  const [playbackUnit, setPlaybackUnit] = useState<number | null>(null);
  const [playbackIdx, setPlaybackIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(2);
  const playbackMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const playbackAnimRef = useRef<number | null>(null);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    if (!showBreadcrumbs) {
      setPlaybackTrails([]);
      if (map.getLayer(breadcrumbSourceId)) map.removeLayer(breadcrumbSourceId);
      if (map.getSource(breadcrumbSourceId)) map.removeSource(breadcrumbSourceId);
      if (map.getLayer(breadcrumbArrowsSourceId)) map.removeLayer(breadcrumbArrowsSourceId);
      if (map.getSource(breadcrumbArrowsSourceId)) map.removeSource(breadcrumbArrowsSourceId);
      if (map.getLayer(speedAlertSourceId)) map.removeLayer(speedAlertSourceId);
      if (map.getSource(speedAlertSourceId)) map.removeSource(speedAlertSourceId);
      return;
    }

    if (!breadcrumbPopupRef.current) {
      breadcrumbPopupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });
    }

    const formatSpeedMph = (mps: number | null) => mps == null ? '\u2014' : `${(mps * 2.237).toFixed(0)} mph`;
    const formatHeadingDir = (deg: number | null) => {
      if (deg == null) return '\u2014';
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      return dirs[Math.round(deg / 45) % 8] + ` (${Math.round(deg)}\u00b0)`;
    };
    const STATUS_LABELS: Record<string, string> = {
      available: 'AVAILABLE', dispatched: 'DISPATCHED', enroute: 'ENROUTE',
      onscene: 'ON SCENE', busy: 'BUSY', off_duty: 'OFF DUTY',
    };

    interface TrailPoint {
      lat: number; lng: number; accuracy: number | null; heading: number | null;
      speed: number | null; status: string; call_number: string | null;
      call_type: string | null; time: string;
      road_name: string | null; intersection: string | null;
    }
    interface Trail {
      unit_id: number; call_sign: string; officer_name: string;
      badge_number: string; points: TrailPoint[];
    }

    let retryTimeout: ReturnType<typeof setTimeout>;
    let retryCount = 0;
    const MAX_RETRIES = 5;

    const fetchTrails = async () => {
      clearTimeout(retryTimeout);

      if (map.getLayer(breadcrumbSourceId)) map.removeLayer(breadcrumbSourceId);
      if (map.getSource(breadcrumbSourceId)) map.removeSource(breadcrumbSourceId);
      if (map.getLayer(breadcrumbArrowsSourceId)) map.removeLayer(breadcrumbArrowsSourceId);
      if (map.getSource(breadcrumbArrowsSourceId)) map.removeSource(breadcrumbArrowsSourceId);
      if (map.getLayer(speedAlertSourceId)) map.removeLayer(speedAlertSourceId);
      if (map.getSource(speedAlertSourceId)) map.removeSource(speedAlertSourceId);

      try {
        const rawTrails = await apiFetch<Trail[]>(`/dispatch/gps/trails?hours=${breadcrumbHours}`);
        const trails = (Array.isArray(rawTrails) ? rawTrails : []).filter(t => Array.isArray(t?.points));
        if (trails.length === 0) return;
        setPlaybackTrails(trails);

        const lineFeatures: any[] = [];
        const arrowFeatures: any[] = [];
        const alertFeatures: any[] = [];

        trails.forEach((trail, idx) => {
          if (trail.points.length === 0) return;

          let points = trail.points.slice(0, MAX_TRAIL_POINTS_PER_UNIT);
          points = points.filter(pt => pt.lat != null && pt.lng != null && isFinite(pt.lat) && isFinite(pt.lng));

          const deduped: typeof points = [];
          for (const pt of points) {
            if (deduped.length === 0 || haversineMeters(deduped[deduped.length - 1].lat, deduped[deduped.length - 1].lng, pt.lat, pt.lng) >= MIN_TRAIL_POINT_DISTANCE_M) {
              deduped.push(pt);
            }
          }
          points = deduped;
          if (points.length === 0) return;

          const unitColor = TRAIL_COLORS[idx % TRAIL_COLORS.length];
          const zoom = map.getZoom() || 12;
          const zoomOpacityMultiplier = zoom >= 14 ? 1.0 : zoom >= 11 ? 0.7 : 0.4;

          const lineCoords: number[][] = [];
          const lineColors: string[] = [];
          const lineOpacities: number[] = [];
          const lineWidths: number[] = [];

          for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const freshness = (i + 1) / points.length;
            const opacity = (0.25 + freshness * 0.6) * zoomOpacityMultiplier;

            let segColor: string;
            if (breadcrumbColorMode === 'speed') {
              segColor = speedToColor(p1.speed);
            } else if (breadcrumbColorMode === 'status') {
              segColor = statusToColor(p1.status);
            } else {
              segColor = unitColor;
            }

            const weight = zoom < 12 ? 1 : breadcrumbColorMode === 'speed' ? speedToWeight(p1.speed) : 3;

            lineCoords.push([p1.lng, p1.lat]);
            lineColors.push(segColor);
            lineOpacities.push(opacity);
            lineWidths.push(weight);
          }
          if (points.length > 0) {
            const last = points[points.length - 1];
            lineCoords.push([last.lng, last.lat]);
          }

          if (lineCoords.length >= 2) {
            lineFeatures.push({
              type: 'Feature' as const,
              geometry: { type: 'LineString' as const, coordinates: lineCoords },
              properties: { colors: lineColors, opacities: lineOpacities, widths: lineWidths, unitColor },
            });
          }

          const arrowInterval = zoom >= 15 ? 5 : zoom >= 12 ? 15 : 30;
          const arrowScale = zoom >= 15 ? 2 : zoom >= 12 ? 1.5 : 1;
          const baseOpacity = zoom >= 14 ? 0.8 : zoom >= 11 ? 0.5 : 0.3;
          let arrowCount = 0;

          points.forEach((pt, ptIdx) => {
            if (ptIdx % arrowInterval !== 2 || pt.heading == null) return;
            if (arrowCount >= 80) return;
            arrowCount++;
            const freshness = (ptIdx + 1) / points.length;
            arrowFeatures.push({
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [pt.lng, pt.lat] },
              properties: {
                heading: pt.heading,
                color: breadcrumbColorMode === 'speed' ? speedToColor(pt.speed) : unitColor,
                opacity: baseOpacity * (0.4 + freshness * 0.6),
                scale: arrowScale,
              },
            });
          });

          points.forEach((pt, ptIdx) => {
            if (pt.speed != null && Number.isFinite(pt.speed) && pt.speed * MPS_TO_MPH >= 80) {
              alertFeatures.push({
                type: 'Feature' as const,
                geometry: { type: 'Point' as const, coordinates: [pt.lng, pt.lat] },
                properties: { speed: pt.speed, unitColor },
              });
            }
          });

          points.forEach((pt, ptIdx) => {
            const isLast = ptIdx === points.length - 1;
            let dotColor: string;
            if (breadcrumbColorMode === 'speed') dotColor = speedToColor(pt.speed);
            else if (breadcrumbColorMode === 'status') dotColor = statusToColor(pt.status);
            else dotColor = unitColor;

            map.on('click', (e) => {
              const features = map.queryRenderedFeatures(e.point, { layers: [`${breadcrumbSourceId}-dots`] });
              if (features.length > 0) {
                const time = new Date(pt.time).toLocaleString();
                const locationRow = pt.road_name
                  ? `<tr><td style="color:#888888;padding:1px 6px 1px 0">Road</td><td style="color:#e0e0e0">${pt.road_name}${pt.intersection ? ` @ ${pt.intersection}` : ''}</td></tr>`
                  : '';
                const html = `
                  <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:220px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:6px;border:1px solid #222222">
                    <div style="font-weight:bold;font-size:13px;margin-bottom:4px;color:${unitColor}">${escapeHtml(trail.call_sign)} \u2014 ${escapeHtml(trail.officer_name || 'Unknown')}</div>
                    <div style="color:#999999;font-size:10px;margin-bottom:4px">${escapeHtml(trail.badge_number || '')}</div>
                    ${pt.road_name ? `<div style="color:#fbbf24;font-weight:bold;font-size:12px;margin-bottom:4px;padding:2px 0;border-bottom:1px solid #222222">${escapeHtml(pt.road_name)}</div>` : ''}
                    <div style="font-size:18px;font-weight:900;color:${speedToColor(pt.speed)};margin-bottom:4px">${formatSpeedMph(pt.speed)}</div>
                    <table style="width:100%;font-size:11px;border-collapse:collapse">
                      <tr><td style="color:#888888;padding:1px 6px 1px 0">Time</td><td style="font-weight:bold;color:#fff">${time}</td></tr>
                      <tr><td style="color:#888888;padding:1px 6px 1px 0">Status</td><td style="font-weight:bold;color:${statusToColor(pt.status)}">${STATUS_LABELS[pt.status] || pt.status}</td></tr>
                      <tr><td style="color:#888888;padding:1px 6px 1px 0">Speed</td><td style="color:${speedToColor(pt.speed)};font-weight:bold">${formatSpeedMph(pt.speed)}</td></tr>
                      <tr><td style="color:#888888;padding:1px 6px 1px 0">Heading</td><td style="color:#e0e0e0">${formatHeadingDir(pt.heading)}</td></tr>
                      ${locationRow}
                      <tr><td style="color:#888888;padding:1px 6px 1px 0">Accuracy</td><td style="color:#e0e0e0">${pt.accuracy != null ? `\u00b1${Math.round(pt.accuracy)}m` : '\u2014'}</td></tr>
                      <tr><td style="color:#888888;padding:1px 6px 1px 0">Position</td><td style="font-size:10px;color:#e0e0e0">${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}</td></tr>
                      ${pt.call_number ? `<tr><td style="color:#888888;padding:1px 6px 1px 0">Call</td><td style="font-weight:bold;color:#a0a0a0">${escapeHtml(pt.call_number)} \u2014 ${escapeHtml(pt.call_type || '')}</td></tr>` : ''}
                    </table>
                  </div>
                `;
                if (breadcrumbPopupRef.current) {
                  breadcrumbPopupRef.current.setLngLat([pt.lng, pt.lat]).setHTML(html).addTo(map);
                }
              }
            });
          });
        });

        if (map.getSource(breadcrumbSourceId)) {
          (map.getSource(breadcrumbSourceId) as mapboxgl.GeoJSONSource).setData({
            type: 'FeatureCollection',
            features: lineFeatures,
          });
        } else {
          map.addSource(breadcrumbSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: lineFeatures } });
          map.addLayer({
            id: `${breadcrumbSourceId}-lines`,
            type: 'line',
            source: breadcrumbSourceId,
            paint: {
              'line-color': ['get', 'unitColor'],
              'line-width': 3,
              'line-opacity': 0.7,
            },
          });
        }

        if (arrowFeatures.length > 0) {
          if (map.getSource(breadcrumbArrowsSourceId)) {
            (map.getSource(breadcrumbArrowsSourceId) as mapboxgl.GeoJSONSource).setData({
              type: 'FeatureCollection',
              features: arrowFeatures,
            });
          } else {
            map.addSource(breadcrumbArrowsSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: arrowFeatures } });
            map.addLayer({
              id: `${breadcrumbArrowsSourceId}-circles`,
              type: 'circle',
              source: breadcrumbArrowsSourceId,
              paint: {
                'circle-color': ['get', 'color'],
                'circle-radius': ['get', 'scale'],
                'circle-opacity': ['get', 'opacity'],
              },
            });
          }
        }

        if (alertFeatures.length > 0) {
          if (map.getSource(speedAlertSourceId)) {
            (map.getSource(speedAlertSourceId) as mapboxgl.GeoJSONSource).setData({
              type: 'FeatureCollection',
              features: alertFeatures,
            });
          } else {
            map.addSource(speedAlertSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: alertFeatures } });
            map.addLayer({
              id: `${speedAlertSourceId}-circles`,
              type: 'circle',
              source: speedAlertSourceId,
              paint: {
                'circle-color': '#dc2626',
                'circle-radius': 6,
                'circle-stroke-color': '#fbbf24',
                'circle-stroke-width': 2,
              },
            });
          }
        }
      } catch (err) {
        console.warn('[useMapBreadcrumbs] Trail fetch failed:', err);
        if (retryCount < MAX_RETRIES) {
          const backoffMs = Math.min(5000 * Math.pow(2, retryCount), 60000);
          retryCount++;
          retryTimeout = setTimeout(fetchTrails, backoffMs);
        }
      }
    };

    fetchTrails();
    const interval = setInterval(fetchTrails, 15000);
    return () => {
      clearInterval(interval);
      clearTimeout(retryTimeout);
    };
  }, [showBreadcrumbs, breadcrumbHours, breadcrumbColorMode, mapLoaded, mapInstanceRef]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded || !isPlaying || playbackUnit == null) return;

    const trail = playbackTrails.find((t: any) => t.unit_id === playbackUnit);
    if (!trail || trail.points.length === 0) { setIsPlaying(false); return; }

    if (!playbackMarkerRef.current) {
      const pt = trail.points[playbackIdx] || trail.points[0];
      const el = document.createElement('div');
      el.style.cssText = 'width:16px;height:16px;background:#00ff88;border:2px solid #fff;border-radius:50%;';
      playbackMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([pt.lng, pt.lat])
        .addTo(map);
    }

    let currentIdx = playbackIdx;
    const step = () => {
      if (currentIdx >= trail.points.length) {
        setIsPlaying(false);
        setPlaybackIdx(trail.points.length - 1);
        return;
      }

      const pt = trail.points[currentIdx];
      if (playbackMarkerRef.current) {
        playbackMarkerRef.current.setLngLat([pt.lng, pt.lat]);
      }

      setPlaybackIdx(currentIdx);
      currentIdx++;

      const delay = 200 / playbackSpeed;
      playbackAnimRef.current = window.setTimeout(step, delay) as unknown as number;
    };

    step();

    return () => {
      if (playbackAnimRef.current != null) {
        clearTimeout(playbackAnimRef.current);
        playbackAnimRef.current = null;
      }
    };
  }, [isPlaying, playbackUnit, playbackSpeed, mapLoaded, mapInstanceRef, playbackTrails, playbackIdx]);

  useEffect(() => {
    if (playbackUnit == null) {
      if (playbackMarkerRef.current) {
        playbackMarkerRef.current.remove();
        playbackMarkerRef.current = null;
      }
    }
  }, [playbackUnit]);

  return {
    showBreadcrumbs,
    setShowBreadcrumbs,
    breadcrumbHours,
    setBreadcrumbHours,
    exportingPdf,
    setExportingPdf,
    breadcrumbColorMode,
    setBreadcrumbColorMode,
    playbackTrails,
    playbackUnit,
    setPlaybackUnit,
    playbackIdx,
    setPlaybackIdx,
    isPlaying,
    setIsPlaying,
    playbackSpeed,
    setPlaybackSpeed,
    playbackAnimRef,
    playbackMarkerRef,
  };
}
