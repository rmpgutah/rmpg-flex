import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { escapeHtml } from '../../../utils/sanitize';

// Unit colors for breadcrumb trails — cycle through distinct colors per unit
const TRAIL_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#c084fc'];

// Fix 15: cap trail points per unit to prevent performance issues
const MAX_TRAIL_POINTS_PER_UNIT = 500;

// Fix 18: minimum distance between trail points (meters) for deduplication
const MIN_TRAIL_POINT_DISTANCE_M = 1;

// Haversine distance in meters between two lat/lng points
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return Infinity;
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Speed-to-color mapping for breadcrumb speed mode (m/s → mph thresholds)
export const speedToColor = (mps: number | null): string => {
  if (mps == null || !Number.isFinite(mps) || mps < 0.5) return '#6b7280';
  const mph = mps * 2.237;
  if (mph < 15) return '#22c55e';
  if (mph < 35) return '#eab308';
  if (mph < 55) return '#f97316';
  return '#ef4444';
};

// Unit status to color for breadcrumb status mode
const statusToColor = (status: string): string => {
  switch (status) {
    case 'dispatched': return '#f59e0b';
    case 'enroute':    return '#3b82f6';
    case 'onscene':    return '#ef4444';
    case 'available':  return '#22c55e';
    case 'busy':       return '#8b5cf6';
    case 'off_duty':   return '#6b7280';
    default:           return '#5a6e80';
  }
};

interface UseMapBreadcrumbsParams {
  mapInstanceRef: React.MutableRefObject<google.maps.Map | null>;
  mapLoaded: boolean;
}

export function useMapBreadcrumbs({ mapInstanceRef, mapLoaded }: UseMapBreadcrumbsParams) {
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(true);
  const [breadcrumbHours, setBreadcrumbHours] = useState(8);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [breadcrumbColorMode, setBreadcrumbColorMode] = useState<'unit' | 'speed' | 'status'>('unit');
  const breadcrumbLinesRef = useRef<google.maps.Polyline[]>([]);
  const breadcrumbMarkersRef = useRef<google.maps.Circle[]>([]);
  const breadcrumbArrowsRef = useRef<google.maps.Marker[]>([]);
  const breadcrumbInfoRef = useRef<google.maps.InfoWindow | null>(null);

  // Trail playback state
  const [playbackTrails, setPlaybackTrails] = useState<{ unit_id: number; call_sign: string; officer_name: string; badge_number: string; points: { lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null; status: string; call_number: string | null; call_type: string | null; time: string; road_name: string | null; intersection: string | null }[] }[]>([]);
  const [playbackUnit, setPlaybackUnit] = useState<number | null>(null);
  const [playbackIdx, setPlaybackIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(2);
  const playbackMarkerRef = useRef<any>(null);
  const playbackAnimRef = useRef<number | null>(null);

  // Breadcrumb trails rendering
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    breadcrumbLinesRef.current.forEach((line) => line.setMap(null));
    breadcrumbLinesRef.current = [];
    breadcrumbMarkersRef.current.forEach((m) => m.setMap(null));
    breadcrumbMarkersRef.current = [];
    breadcrumbArrowsRef.current.forEach((a) => a.setMap(null));
    breadcrumbArrowsRef.current = [];

    if (!showBreadcrumbs) { setPlaybackTrails([]); return; }

    // apiFetch handles auth token automatically — no need for manual token check

    if (!breadcrumbInfoRef.current) {
      breadcrumbInfoRef.current = new google.maps.InfoWindow();
    }

    const formatSpeedMph = (mps: number | null) => mps == null ? '—' : `${(mps * 2.237).toFixed(0)} mph`;
    const formatHeadingDir = (deg: number | null) => {
      if (deg == null) return '—';
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      return dirs[Math.round(deg / 45) % 8] + ` (${Math.round(deg)}°)`;
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
      // Clear any pending retry to prevent cascading retries
      clearTimeout(retryTimeout);
      breadcrumbLinesRef.current.forEach((l) => l.setMap(null));
      breadcrumbLinesRef.current = [];
      breadcrumbMarkersRef.current.forEach((m) => m.setMap(null));
      breadcrumbMarkersRef.current = [];
      breadcrumbArrowsRef.current.forEach((a) => a.setMap(null));
      breadcrumbArrowsRef.current = [];

      try {
        const trails = await apiFetch<Trail[]>(`/dispatch/gps/trails?hours=${breadcrumbHours}`);
        if (!trails) return;
        setPlaybackTrails(trails);

        trails.forEach((trail, idx) => {
          if (trail.points.length === 0) return;

          // Fix 15: cap trail points per unit
          let points = trail.points.slice(0, MAX_TRAIL_POINTS_PER_UNIT);

          // Fix 16: validate trail point coordinates
          points = points.filter(pt => pt.lat != null && pt.lng != null && isFinite(pt.lat) && isFinite(pt.lng));

          // Fix 18: deduplicate trail points within 1m of each other
          const deduped: typeof points = [];
          for (const pt of points) {
            if (deduped.length === 0 || haversineMeters(deduped[deduped.length - 1].lat, deduped[deduped.length - 1].lng, pt.lat, pt.lng) >= MIN_TRAIL_POINT_DISTANCE_M) {
              deduped.push(pt);
            }
          }
          points = deduped;

          if (points.length === 0) return;

          const unitColor = TRAIL_COLORS[idx % TRAIL_COLORS.length];

          for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const freshness = (i + 1) / points.length;
            const opacity = 0.25 + freshness * 0.6;

            let segColor: string;
            if (breadcrumbColorMode === 'speed') {
              segColor = speedToColor(p1.speed);
            } else if (breadcrumbColorMode === 'status') {
              segColor = statusToColor(p1.status);
            } else {
              segColor = unitColor;
            }

            try { // Fix 17: try/catch around Polyline creation
              const seg = new google.maps.Polyline({
                path: [{ lat: p1.lat, lng: p1.lng }, { lat: p2.lat, lng: p2.lng }],
                geodesic: true,
                strokeColor: segColor,
                strokeOpacity: opacity,
                strokeWeight: 3,
                map,
              });
              breadcrumbLinesRef.current.push(seg);
            } catch (err) {
              console.warn('[useMapBreadcrumbs] Error creating polyline segment:', err);
            }
          }

          points.forEach((pt, ptIdx) => {
            if (ptIdx % 8 !== 4 || pt.heading == null) return;
            const freshness = (ptIdx + 1) / points.length;
            const arrow = new google.maps.Marker({
              position: { lat: pt.lat, lng: pt.lng },
              map,
              icon: {
                path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                scale: 2.5,
                rotation: pt.heading,
                fillColor: breadcrumbColorMode === 'speed' ? speedToColor(pt.speed) : unitColor,
                fillOpacity: 0.3 + freshness * 0.5,
                strokeColor: '#fff',
                strokeWeight: 0.5,
                strokeOpacity: 0.6,
              },
              clickable: false,
              zIndex: 1,
            });
            breadcrumbArrowsRef.current.push(arrow);
          });

          points.forEach((pt, ptIdx) => {
            const isLast = ptIdx === points.length - 1;
            let dotColor: string;
            if (breadcrumbColorMode === 'speed') dotColor = speedToColor(pt.speed);
            else if (breadcrumbColorMode === 'status') dotColor = statusToColor(pt.status);
            else dotColor = unitColor;

            let dot: google.maps.Circle;
            try { // Fix 17: try/catch around Circle creation
            dot = new google.maps.Circle({
              center: { lat: pt.lat, lng: pt.lng },
              radius: 4,
              fillColor: dotColor,
              fillOpacity: isLast ? 1 : 0.6,
              strokeColor: '#fff',
              strokeWeight: isLast ? 2 : 0.5,
              strokeOpacity: 0.8,
              map,
              clickable: true,
              zIndex: ptIdx,
            });
            } catch (err) {
              console.warn('[useMapBreadcrumbs] Error creating circle:', err);
              return;
            }

            dot.addListener('click', () => {
              const time = new Date(pt.time).toLocaleString();
              const locationRow = pt.road_name
                ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Road</td><td style="color:#e0e0e0">${pt.road_name}${pt.intersection ? ` @ ${pt.intersection}` : ''}</td></tr>`
                : '';
              const html = `
                <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:220px;line-height:1.6;background:#0a0e14;padding:10px 12px;border-radius:6px;border:1px solid #1e2a3a">
                  <div style="font-weight:bold;font-size:13px;margin-bottom:4px;color:${unitColor}">
                    ${escapeHtml(trail.call_sign)} — ${escapeHtml(trail.officer_name || 'Unknown')}
                  </div>
                  <div style="color:#8899aa;font-size:10px;margin-bottom:4px">${escapeHtml(trail.badge_number || '')}</div>
                  ${pt.road_name ? `<div style="color:#fbbf24;font-weight:bold;font-size:12px;margin-bottom:4px;padding:2px 0;border-bottom:1px solid #1e2a3a">${escapeHtml(pt.road_name)}</div>` : ''}
                  <div style="font-size:18px;font-weight:900;color:${speedToColor(pt.speed)};margin-bottom:4px">${formatSpeedMph(pt.speed)}</div>
                  <table style="width:100%;font-size:11px;border-collapse:collapse">
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Time</td><td style="font-weight:bold;color:#fff">${time}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Status</td><td style="font-weight:bold;color:${statusToColor(pt.status)}">${STATUS_LABELS[pt.status] || pt.status}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Speed</td><td style="color:${speedToColor(pt.speed)};font-weight:bold">${formatSpeedMph(pt.speed)}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Heading</td><td style="color:#e0e0e0">${formatHeadingDir(pt.heading)}</td></tr>
                    ${locationRow}
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Accuracy</td><td style="color:#e0e0e0">${pt.accuracy != null ? `±${Math.round(pt.accuracy)}m` : '—'}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Position</td><td style="font-size:10px;color:#e0e0e0">${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}</td></tr>
                    ${pt.call_number ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Call</td><td style="font-weight:bold;color:#4fc3f7">${escapeHtml(pt.call_number)} — ${escapeHtml(pt.call_type || '')}</td></tr>` : ''}
                  </table>
                </div>
              `;
              breadcrumbInfoRef.current?.setContent(html);
              breadcrumbInfoRef.current?.setPosition({ lat: pt.lat, lng: pt.lng });
              breadcrumbInfoRef.current?.open(map);
            });

            breadcrumbMarkersRef.current.push(dot);
          });
        });
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
      breadcrumbLinesRef.current.forEach((l) => l.setMap(null));
      breadcrumbLinesRef.current = [];
      breadcrumbMarkersRef.current.forEach((m) => m.setMap(null));
      breadcrumbMarkersRef.current = [];
      breadcrumbArrowsRef.current.forEach((a) => a.setMap(null));
      breadcrumbArrowsRef.current = [];
    };
  }, [showBreadcrumbs, breadcrumbHours, breadcrumbColorMode, mapLoaded, mapInstanceRef]);

  // Trail Playback Animation
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded || !isPlaying || playbackUnit == null) return;

    const trail = playbackTrails.find((t: any) => t.unit_id === playbackUnit);
    if (!trail || trail.points.length === 0) { setIsPlaying(false); return; }

    if (!playbackMarkerRef.current) {
      const pt = trail.points[playbackIdx] || trail.points[0];
      playbackMarkerRef.current = new google.maps.Marker({
        position: { lat: pt.lat, lng: pt.lng },
        map,
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 5,
          rotation: pt.heading || 0,
          fillColor: '#00ff88',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
        zIndex: 9999,
        title: `${trail.call_sign} — Playback`,
      });
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
        playbackMarkerRef.current.setPosition({ lat: pt.lat, lng: pt.lng });
        playbackMarkerRef.current.setIcon({
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 5,
          rotation: pt.heading || 0,
          fillColor: '#00ff88',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        });
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

  // Cleanup playback marker when playback unit changes or stops
  useEffect(() => {
    if (playbackUnit == null) {
      if (playbackMarkerRef.current) {
        playbackMarkerRef.current.setMap(null);
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
