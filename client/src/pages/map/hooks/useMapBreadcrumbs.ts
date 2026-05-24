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

const STATUS_LABELS: Record<string, string> = {
  available: 'AVAILABLE', dispatched: 'DISPATCHED', enroute: 'ENROUTE',
  onscene: 'ON SCENE', busy: 'BUSY', off_duty: 'OFF DUTY',
};

const formatSpeedMph = (mps: number | null) => mps == null ? '—' : `${(mps * 2.237).toFixed(0)} mph`;
const formatHeadingDir = (deg: number | null) => {
  if (deg == null) return '—';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8] + ` (${Math.round(deg)}°)`;
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

const LINE_SOURCE_ID = 'breadcrumbs-line-source';
const LINE_LAYER_ID = 'breadcrumbs-line-layer';
const DOT_SOURCE_ID = 'breadcrumbs-dot-source';
const DOT_LAYER_ID = 'breadcrumbs-dot-layer';
const SPEED_ALERT_SOURCE_ID = 'breadcrumbs-speed-source';
const SPEED_ALERT_LAYER_ID = 'breadcrumbs-speed-layer';

interface UseMapBreadcrumbsParams {
  mapInstanceRef: React.MutableRefObject<mapboxgl.Map | null>;
  mapLoaded: boolean;
}

export function useMapBreadcrumbs({ mapInstanceRef, mapLoaded }: UseMapBreadcrumbsParams) {
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(true);
  const [breadcrumbHours, setBreadcrumbHours] = useState(8);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [breadcrumbColorMode, setBreadcrumbColorMode] = useState<'unit' | 'speed' | 'status'>('unit');
  const arrowMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const speedAlertMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const [playbackTrails, setPlaybackTrails] = useState<Trail[]>([]);
  const [playbackUnit, setPlaybackUnit] = useState<number | null>(null);
  const [playbackIdx, setPlaybackIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(2);
  const playbackMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const playbackAnimRef = useRef<number | null>(null);

  function removeLayers() {
    const map = mapInstanceRef.current;
    if (!map) return;
    try {
      if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
      if (map.getSource(LINE_SOURCE_ID)) map.removeSource(LINE_SOURCE_ID);
      if (map.getLayer(DOT_LAYER_ID)) map.removeLayer(DOT_LAYER_ID);
      if (map.getSource(DOT_SOURCE_ID)) map.removeSource(DOT_SOURCE_ID);
      if (map.getLayer(SPEED_ALERT_LAYER_ID)) map.removeLayer(SPEED_ALERT_LAYER_ID);
      if (map.getSource(SPEED_ALERT_SOURCE_ID)) map.removeSource(SPEED_ALERT_SOURCE_ID);
    } catch { /* ignore */ }
    arrowMarkersRef.current.forEach((m) => m.remove());
    arrowMarkersRef.current = [];
    speedAlertMarkersRef.current.forEach((m) => m.remove());
    speedAlertMarkersRef.current = [];
  }

  // Trail rendering
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    removeLayers();
    if (!showBreadcrumbs) { setPlaybackTrails([]); return; }

    let retryTimeout: ReturnType<typeof setTimeout>;
    let retryCount = 0;
    const MAX_RETRIES = 5;

    const fetchTrails = async () => {
      clearTimeout(retryTimeout);
      removeLayers();

      try {
        const trails = await apiFetch<Trail[]>(`/dispatch/gps/trails?hours=${breadcrumbHours}`);
        if (!trails) return;
        setPlaybackTrails(trails);

        const lineFeatures: GeoJSON.Feature[] = [];
        const dotFeatures: GeoJSON.Feature[] = [];
        const speedAlertFeatures: GeoJSON.Feature[] = [];
        const newArrowMarkers: mapboxgl.Marker[] = [];

        trails.forEach((trail, idx) => {
          if (trail.points.length === 0) return;
          let points = trail.points.slice(0, MAX_TRAIL_POINTS_PER_UNIT);
          points = points.filter(pt => pt.lat != null && pt.lng != null && isFinite(pt.lat) && isFinite(pt.lng));
          const deduped: TrailPoint[] = [];
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

          // Build line segments
          for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const freshness = (i + 1) / points.length;
            const opacity = (0.25 + freshness * 0.6) * zoomOpacityMultiplier;

            let segColor: string;
            if (breadcrumbColorMode === 'speed') segColor = speedToColor(p1.speed);
            else if (breadcrumbColorMode === 'status') segColor = statusToColor(p1.status);
            else segColor = unitColor;

            const weight = zoom < 12 ? 1 : breadcrumbColorMode === 'speed' ? speedToWeight(p1.speed) : 3;

            lineFeatures.push({
              type: 'Feature',
              properties: { color: segColor, opacity, weight, freshness },
              geometry: {
                type: 'LineString',
                coordinates: [[p1.lng, p1.lat], [points[i + 1].lng, points[i + 1].lat]],
              },
            });
          }

          // Build dot features
          points.forEach((pt, ptIdx) => {
            const isLast = ptIdx === points.length - 1;
            let dotColor: string;
            if (breadcrumbColorMode === 'speed') dotColor = speedToColor(pt.speed);
            else if (breadcrumbColorMode === 'status') dotColor = statusToColor(pt.status);
            else dotColor = unitColor;

            dotFeatures.push({
              type: 'Feature',
              properties: {
                color: dotColor,
                isLast,
                radius: isLast ? 5 : 3,
                opacity: isLast ? 1 : 0.6,
                strokeOpacity: isLast ? 0.8 : 0.5,
                trailIndex: idx,
                pointIndex: ptIdx,
                ...pt,
              },
              geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] },
            });
          });

          // Arrows
          const currentZoom = map.getZoom() || 12;
          const arrowInterval = currentZoom >= 15 ? 5 : currentZoom >= 12 ? 15 : 30;
          const arrowScale = currentZoom >= 15 ? 2 : currentZoom >= 12 ? 1.5 : 1;
          const baseOpacity = currentZoom >= 14 ? 0.8 : currentZoom >= 11 ? 0.5 : 0.3;
          const maxArrows = 80;
          let arrowCount = 0;

          points.forEach((pt, ptIdx) => {
            if (ptIdx % arrowInterval !== 2 || pt.heading == null) return;
            if (arrowCount >= maxArrows) return;
            arrowCount++;
            const freshness = (ptIdx + 1) / points.length;
            const arrowColor = breadcrumbColorMode === 'speed' ? speedToColor(pt.speed) : unitColor;
            const arrowOpacity = baseOpacity * (0.4 + freshness * 0.6);

            const el = document.createElement('div');
            el.style.cssText = `
              width: 0; height: 0;
              border-left: 4px solid transparent;
              border-right: 4px solid transparent;
              border-bottom: 8px solid ${arrowColor};
              opacity: ${arrowOpacity};
              transform: rotate(${pt.heading}deg);
              cursor: pointer;
            `;
            const m = new mapboxgl.Marker({ element: el, anchor: 'center' })
              .setLngLat([pt.lng, pt.lat])
              .addTo(map);
            newArrowMarkers.push(m);
          });

          // Speed alert features (80+ mph)
          points.forEach((pt) => {
            if (pt.speed != null && Number.isFinite(pt.speed) && pt.speed * MPS_TO_MPH >= 80) {
              speedAlertFeatures.push({
                type: 'Feature',
                properties: { speed: pt.speed },
                geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] },
              });
            }
          });
        });

        // Add line layer
        if (lineFeatures.length > 0) {
          map.addSource(LINE_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: lineFeatures } });
          map.addLayer({
            id: LINE_LAYER_ID,
            type: 'line',
            source: LINE_SOURCE_ID,
            paint: {
              'line-color': ['get', 'color'],
              'line-opacity': 0.6,
              'line-width': ['get', 'weight'],
            },
          });
        }

        // Add dot layer
        if (dotFeatures.length > 0) {
          map.addSource(DOT_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: dotFeatures } });
          map.addLayer({
            id: DOT_LAYER_ID,
            type: 'circle',
            source: DOT_SOURCE_ID,
            paint: {
              'circle-color': ['get', 'color'],
              'circle-radius': ['get', 'radius'],
              'circle-opacity': ['get', 'opacity'],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': ['case', ['get', 'isLast'], 2, 0.5],
              'circle-stroke-opacity': ['get', 'strokeOpacity'],
            },
          });

          // Dot click handler
          map.on('click', DOT_LAYER_ID, (e) => {
            if (!e.features || e.features.length === 0) return;
            const props = e.features[0].properties as any;
            const coords = (e.features[0].geometry as GeoJSON.Point).coordinates;
            if (!props || !coords) return;

            const trail = trails.find((t: any) => t.unit_id === props.trailIndex);
            const time = new Date(props.time).toLocaleString();
            const locationRow = props.road_name
              ? `<tr><td style="color:#888888;padding:1px 6px 1px 0">Road</td><td style="color:#e0e0e0">${escapeHtml(props.road_name)}${props.intersection ? ` @ ${escapeHtml(props.intersection)}` : ''}</td></tr>`
              : '';

            const dotColor = props.color || '#666666';

            const html = `
              <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:220px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:6px;border:1px solid #222222">
                <div style="font-weight:bold;font-size:13px;margin-bottom:4px;color:${dotColor}">
                  ${escapeHtml(trail?.call_sign || '')} — ${escapeHtml(trail?.officer_name || 'Unknown')}
                </div>
                <div style="color:#999999;font-size:10px;margin-bottom:4px">${escapeHtml(trail?.badge_number || '')}</div>
                ${props.road_name ? `<div style="color:#fbbf24;font-weight:bold;font-size:12px;margin-bottom:4px;padding:2px 0;border-bottom:1px solid #222222">${escapeHtml(props.road_name)}</div>` : ''}
                <div style="font-size:18px;font-weight:900;color:${speedToColor(props.speed)};margin-bottom:4px">${formatSpeedMph(props.speed)}</div>
                <table style="width:100%;font-size:11px;border-collapse:collapse">
                  <tr><td style="color:#888888;padding:1px 6px 1px 0">Time</td><td style="font-weight:bold;color:#fff">${time}</td></tr>
                  <tr><td style="color:#888888;padding:1px 6px 1px 0">Status</td><td style="font-weight:bold;color:${statusToColor(props.status)}">${STATUS_LABELS[props.status] || props.status}</td></tr>
                  <tr><td style="color:#888888;padding:1px 6px 1px 0">Speed</td><td style="color:${speedToColor(props.speed)};font-weight:bold">${formatSpeedMph(props.speed)}</td></tr>
                  <tr><td style="color:#888888;padding:1px 6px 1px 0">Heading</td><td style="color:#e0e0e0">${formatHeadingDir(props.heading)}</td></tr>
                  ${locationRow}
                  <tr><td style="color:#888888;padding:1px 6px 1px 0">Accuracy</td><td style="color:#e0e0e0">${props.accuracy != null ? `±${Math.round(props.accuracy)}m` : '—'}</td></tr>
                  <tr><td style="color:#888888;padding:1px 6px 1px 0">Position</td><td style="font-size:10px;color:#e0e0e0">${props.lat?.toFixed(6)}, ${props.lng?.toFixed(6)}</td></tr>
                  ${props.call_number ? `<tr><td style="color:#888888;padding:1px 6px 1px 0">Call</td><td style="font-weight:bold;color:#a0a0a0">${escapeHtml(props.call_number)} — ${escapeHtml(props.call_type || '')}</td></tr>` : ''}
                </table>
              </div>
            `;
            if (popupRef.current) popupRef.current.remove();
            popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '360px', offset: 15 })
              .setLngLat([coords[0], coords[1]])
              .setHTML(html)
              .addTo(map);
          });
        }

        // Add speed alert layer
        if (speedAlertFeatures.length > 0) {
          map.addSource(SPEED_ALERT_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: speedAlertFeatures } });
          map.addLayer({
            id: SPEED_ALERT_LAYER_ID,
            type: 'symbol',
            source: SPEED_ALERT_SOURCE_ID,
            layout: {
              'text-field': '!',
              'text-size': 14,
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            },
            paint: {
              'text-color': '#ffffff',
              'text-halo-color': '#dc2626',
              'text-halo-width': 2,
            },
          });
        }

        arrowMarkersRef.current = newArrowMarkers;
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
      removeLayers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBreadcrumbs, breadcrumbHours, breadcrumbColorMode, mapLoaded]);

  // Trail Playback Animation
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded || !isPlaying || playbackUnit == null) return;

    const trail = playbackTrails.find((t: any) => t.unit_id === playbackUnit);
    if (!trail || trail.points.length === 0) { setIsPlaying(false); return; }

    if (!playbackMarkerRef.current) {
      const pt = trail.points[playbackIdx] || trail.points[0];
      const el = document.createElement('div');
      el.style.cssText = `
        width: 0; height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-bottom: 12px solid #00ff88;
        filter: drop-shadow(0 0 4px rgba(0,255,136,0.8));
      `;
      playbackMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
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
        const el = playbackMarkerRef.current.getElement();
        el.style.transform = `rotate(${pt.heading || 0}deg)`;
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
    showBreadcrumbs, setShowBreadcrumbs,
    breadcrumbHours, setBreadcrumbHours,
    exportingPdf, setExportingPdf,
    breadcrumbColorMode, setBreadcrumbColorMode,
    playbackTrails,
    playbackUnit, setPlaybackUnit,
    playbackIdx, setPlaybackIdx,
    isPlaying, setIsPlaying,
    playbackSpeed, setPlaybackSpeed,
    playbackAnimRef,
    playbackMarkerRef,
  };
}