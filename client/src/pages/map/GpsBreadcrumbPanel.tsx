import { useState, useEffect, useRef, useCallback } from 'react';
import {
  History, Play, Pause, SkipForward, SkipBack, Search, X, Loader2, Gauge,
  AlertTriangle,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { localToday, safeDateTimeStr } from '../../utils/dateUtils';
import { escapeHtml } from '../../utils/sanitize';
import mapboxgl from 'mapbox-gl';

// ============================================================
// Types
// ============================================================

interface TrailPoint {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  status: string;
  call_number: string | null;
  call_type: string | null;
  time: string;
  road_name: string | null;
  intersection: string | null;
}

interface HistoryTrail {
  unit_id: number;
  call_sign: string;
  officer_name: string;
  badge_number: string;
  points: TrailPoint[];
  total_raw: number;
}

interface UnitOption {
  unit_id: number;
  call_sign: string;
  officer_name: string;
  badge_number: string;
  earliest: string;
  latest: string;
  point_count: number;
}

interface Props {
  map: mapboxgl.Map | null;
  mapLoaded: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

// ============================================================
// Constants
// ============================================================

const TRAIL_COLOR = '#f59e0b';

const MPS_TO_MPH = 2.23694;

const speedToColor = (speedMps: number | null): string => {
  if (speedMps == null || speedMps < 0.2) return '#666666';
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
  if (speedMps == null || speedMps < 0.2) return 1;
  const mph = speedMps * MPS_TO_MPH;
  if (mph < 3)  return 2;
  if (mph < 35) return 3;
  if (mph < 75) return 4;
  return 5;
};

const SPEED_LEGEND_BANDS = [
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

const formatSpeedMph = (mps: number | null) => mps == null ? '\u2014' : `${(mps * 2.237).toFixed(0)} mph`;
const formatHeadingDir = (deg: number | null) => {
  if (deg == null) return '\u2014';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8] + ` (${Math.round(deg)}\u00b0)`;
};

// ============================================================
// Component
// ============================================================

export default function GpsBreadcrumbPanel({ map, mapLoaded, isOpen, onToggle }: Props) {
  // Unit list
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);

  // Query state
  const [selectedUnit, setSelectedUnit] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState(() => localToday());
  const [dateTo, setDateTo] = useState(() => localToday());
  const [timeFrom, setTimeFrom] = useState('00:00');
  const [timeTo, setTimeTo] = useState('23:59');

  // Trail data
  const [trail, setTrail] = useState<HistoryTrail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIdx, setPlaybackIdx] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(2);

  // Map objects refs
  const sourceIdsRef = useRef<string[]>([]);
  const layerIdsRef = useRef<string[]>([]);
  const arrowMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const speedAlertMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const infoWindowRef = useRef<mapboxgl.Popup | null>(null);
  const playbackMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const playbackAnimRef = useRef<number | null>(null);
  const dotLayerIdRef = useRef<string | null>(null);
  const dotClickHandlerRef = useRef<((e: any) => void) | null>(null);
  const trailRenderIdRef = useRef(0);

  // ── Fetch available units on open ──
  useEffect(() => {
    if (!isOpen) return;
    setUnitsLoading(true);
    apiFetch<UnitOption[]>('/dispatch/gps/units-with-trails')
      .then((data) => setUnits(data || []))
      .catch(() => setUnits([]))
      .finally(() => setUnitsLoading(false));
  }, [isOpen]);

  // ── Clear map objects ──
  const clearMapObjects = useCallback(() => {
    if (dotLayerIdRef.current && dotClickHandlerRef.current && map) {
      map.off('click', dotLayerIdRef.current, dotClickHandlerRef.current);
    }
    dotLayerIdRef.current = null;
    dotClickHandlerRef.current = null;

    layerIdsRef.current.forEach((id) => {
      try { if (map?.getLayer(id)) map.removeLayer(id); } catch (e) { /* */ }
    });
    layerIdsRef.current = [];

    sourceIdsRef.current.forEach((id) => {
      try { if (map?.getSource(id)) map.removeSource(id); } catch (e) { /* */ }
    });
    sourceIdsRef.current = [];

    arrowMarkersRef.current.forEach((m) => m.remove());
    arrowMarkersRef.current = [];
    speedAlertMarkersRef.current.forEach((a) => a.remove());
    speedAlertMarkersRef.current = [];
    if (playbackMarkerRef.current) {
      playbackMarkerRef.current.remove();
      playbackMarkerRef.current = null;
    }
    if (infoWindowRef.current) {
      infoWindowRef.current.remove();
    }
  }, [map]);

  // ── Clean up on close/unmount ──
  useEffect(() => {
    if (!isOpen) {
      clearMapObjects();
      setTrail(null);
      setIsPlaying(false);
      setPlaybackIdx(0);
    }
    return () => clearMapObjects();
  }, [isOpen, clearMapObjects]);

  // ── Load trail ──
  const loadTrail = useCallback(async () => {
    if (selectedUnit == null || !map || !mapLoaded) return;

    setLoading(true);
    setError(null);
    setIsPlaying(false);
    setPlaybackIdx(0);
    clearMapObjects();

    const fromStr = `${dateFrom} ${timeFrom}:00`;
    const toStr = `${dateTo} ${timeTo}:59`;

    try {
      const data = await apiFetch<HistoryTrail>(
        `/dispatch/gps/history?unit_id=${selectedUnit}&from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}`
      );
      if (!data || !data.points || data.points.length === 0) {
        setError('No GPS data found for this unit in the selected time range.');
        setTrail(null);
        return;
      }
      setTrail(data);
      renderTrailOnMap(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load trail data');
      setTrail(null);
    } finally {
      setLoading(false);
    }
  }, [selectedUnit, dateFrom, dateTo, timeFrom, timeTo, map, mapLoaded, clearMapObjects]);

  // ── Render trail on map ──
  const renderTrailOnMap = useCallback((trailData: HistoryTrail) => {
    if (!map) return;
    clearMapObjects();

    if (!infoWindowRef.current) {
      infoWindowRef.current = new mapboxgl.Popup({
        closeButton: true,
        closeOnClick: false,
      });
    }

    const pts = trailData.points;
    if (pts.length === 0) return;

    trailRenderIdRef.current += 1;
    const renderId = trailRenderIdRef.current;
    const lineSourceId = `breadcrumb-line-${renderId}`;
    const lineLayerId = `breadcrumb-line-layer-${renderId}`;
    const dotSourceId = `breadcrumb-dots-${renderId}`;
    const dotLayerId = `breadcrumb-dots-layer-${renderId}`;

    // Build line features (one per segment, with speed properties for data-driven styling)
    const lineFeatures: any[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const freshness = (i + 1) / pts.length;
      const opacity = 0.3 + freshness * 0.6;

      lineFeatures.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[p1.lng, p1.lat], [p2.lng, p2.lat]] },
        properties: { color: speedToColor(p1.speed), opacity, width: speedToWeight(p1.speed) },
      });
    }

    // Add line source + layer
    map.addSource(lineSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: lineFeatures } });
    map.addLayer({
      id: lineLayerId, type: 'line', source: lineSourceId,
      paint: {
        'line-color': ['get', 'color'],
        'line-opacity': ['get', 'opacity'],
        'line-width': ['get', 'width'],
      },
    });

    // Build dot features (each point with all TrailPoint data in properties)
    const dotFeatures: any[] = [];
    pts.forEach((pt, ptIdx) => {
      const isFirst = ptIdx === 0;
      const isLast = ptIdx === pts.length - 1;
      dotFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] },
        properties: {
          lat: pt.lat, lng: pt.lng, accuracy: pt.accuracy, heading: pt.heading,
          speed: pt.speed, status: pt.status, call_number: pt.call_number,
          call_type: pt.call_type, time: pt.time, road_name: pt.road_name,
          intersection: pt.intersection,
          radius: isFirst || isLast ? 8 : 3,
          color: isFirst ? '#22c55e' : isLast ? '#ef4444' : speedToColor(pt.speed),
          pointOpacity: isFirst || isLast ? 1 : 0.5,
          strokeWidth: isFirst || isLast ? 2 : 0.5,
        },
      });
    });

    // Add dot source + circle layer
    map.addSource(dotSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: dotFeatures } });
    map.addLayer({
      id: dotLayerId, type: 'circle', source: dotSourceId,
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-color': ['get', 'color'],
        'circle-opacity': ['get', 'pointOpacity'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': ['get', 'strokeWidth'],
        'circle-stroke-opacity': 0.8,
      },
    });

    sourceIdsRef.current = [lineSourceId, dotSourceId];
    layerIdsRef.current = [lineLayerId, dotLayerId];
    dotLayerIdRef.current = dotLayerId;

    // Click handler for dots
    const clickHandler = (e: any) => {
      const features = e.features;
      if (!features || !features[0]) return;
      const props = features[0].properties;
      const time = new Date(props.time).toLocaleString();
      const locationRow = props.road_name
        ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Road</td><td style="color:#e0e0e0">${escapeHtml(props.road_name)}${props.intersection ? ` @ ${escapeHtml(props.intersection)}` : ''}</td></tr>`
        : '';
      const html = `
        <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:220px;line-height:1.6;background:#0d0d0d;padding:10px 12px;border-radius:6px;border:1px solid #282828">
          <div style="font-weight:bold;font-size:13px;margin-bottom:4px;color:${TRAIL_COLOR}">
            ${escapeHtml(trailData.call_sign)} \u2014 ${escapeHtml(trailData.officer_name || 'Unknown')}
          </div>
          <div style="color:#8899aa;font-size:10px;margin-bottom:4px">${escapeHtml(trailData.badge_number || '')} \u2022 Historical Playback</div>
          ${props.road_name ? `<div style="color:#fbbf24;font-weight:bold;font-size:12px;margin-bottom:4px;padding:2px 0;border-bottom:1px solid #282828">${escapeHtml(props.road_name)}</div>` : ''}
          <div style="font-size:18px;font-weight:900;color:${speedToColor(props.speed)};margin-bottom:4px">${formatSpeedMph(props.speed)}</div>
          <table style="width:100%;font-size:11px;border-collapse:collapse">
            <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Time</td><td style="font-weight:bold;color:#fff">${time}</td></tr>
            <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Status</td><td style="font-weight:bold;color:${statusToColor(props.status)}">${STATUS_LABELS[props.status] || props.status}</td></tr>
            <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Speed</td><td style="color:${speedToColor(props.speed)};font-weight:bold">${formatSpeedMph(props.speed)}</td></tr>
            <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Heading</td><td style="color:#e0e0e0">${formatHeadingDir(props.heading)}</td></tr>
            ${locationRow}
            <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Accuracy</td><td style="color:#e0e0e0">${props.accuracy != null ? `\u00b1${Math.round(props.accuracy)}m` : '\u2014'}</td></tr>
            <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Position</td><td style="font-size:10px;color:#e0e0e0">${Number(props.lat).toFixed(6)}, ${Number(props.lng).toFixed(6)}</td></tr>
            ${props.call_number ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Call</td><td style="font-weight:bold;color:#4fc3f7">${escapeHtml(props.call_number)} \u2014 ${escapeHtml(props.call_type || '')}</td></tr>` : ''}
          </table>
        </div>
      `;
      infoWindowRef.current?.remove();
      infoWindowRef.current?.setLngLat([Number(props.lng), Number(props.lat)]).setHTML(html).addTo(map);
    };
    map.on('click', dotLayerId, clickHandler);
    dotClickHandlerRef.current = clickHandler;

    // Directional arrows every 5th point
    pts.forEach((pt, ptIdx) => {
      if (ptIdx % 5 !== 2 || pt.heading == null) return;
      const el = document.createElement('div');
      el.style.pointerEvents = 'none';
      const inner = document.createElement('div');
      inner.style.transform = `rotate(${pt.heading}deg)`;
      inner.innerHTML = `<svg width="18" height="18" viewBox="-9 -9 18 18" style="display:block"><polygon points="0,-7 7,6 -7,6" fill="${TRAIL_COLOR}" fill-opacity="0.7" stroke="white" stroke-width="0.5" stroke-opacity="0.6"/></svg>`;
      el.appendChild(inner);
      el.style.zIndex = '1';
      arrowMarkersRef.current.push(
        new mapboxgl.Marker({ element: el }).setLngLat([pt.lng, pt.lat]).addTo(map)
      );
    });

    // Speed alert markers — exclamation at 80+ mph
    pts.forEach((pt) => {
      if (pt.speed != null && pt.speed * MPS_TO_MPH >= 80) {
        try {
          const el = document.createElement('div');
          el.title = `Speed Alert: ${(pt.speed * MPS_TO_MPH).toFixed(0)} mph`;
          el.innerHTML = `<svg width="24" height="24" viewBox="-12 -12 24 24" style="display:block"><polygon points="0,-10 10,8 -10,8" fill="#dc2626" fill-opacity="0.95" stroke="#fbbf24" stroke-width="2"/><text x="0" y="4" text-anchor="middle" fill="white" font-weight="900" font-size="11" font-family="sans-serif">!</text></svg>`;
          el.style.zIndex = '5000';
          speedAlertMarkersRef.current.push(
            new mapboxgl.Marker({ element: el }).setLngLat([pt.lng, pt.lat]).addTo(map)
          );
        } catch (err) {
          // ignore individual marker errors
        }
      }
    });

    // Fit map to trail bounds
    const bounds = new mapboxgl.LngLatBounds();
    pts.forEach((pt) => bounds.extend([pt.lng, pt.lat]));
    map.fitBounds(bounds, { padding: { top: 50, right: 50, bottom: 50, left: 360 } });
  }, [map, clearMapObjects]);

  // ── Playback animation ──
  useEffect(() => {
    if (!map || !mapLoaded || !isPlaying || !trail || trail.points.length === 0) return;

    if (!playbackMarkerRef.current) {
      const pt = trail.points[playbackIdx] || trail.points[0];
      const el = document.createElement('div');
      const inner = document.createElement('div');
      inner.style.transform = `rotate(${pt.heading || 0}deg)`;
      inner.innerHTML = '<svg width="28" height="28" viewBox="-14 -14 28 28" style="display:block"><polygon points="0,-12 12,10 -12,10" fill="#00ff88" stroke="white" stroke-width="2"/></svg>';
      el.appendChild(inner);
      el.style.zIndex = '9999';
      el.title = `${trail.call_sign} \u2014 History Playback`;
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
        const markerEl = playbackMarkerRef.current.getElement();
        const inner = markerEl.firstElementChild as HTMLElement | null;
        if (inner) inner.style.transform = `rotate(${pt.heading || 0}deg)`;
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
  }, [isPlaying, playbackSpeed, mapLoaded, map, trail]);


  const currentPt = trail?.points[playbackIdx];
  const totalPts = trail?.points.length || 0;

  // Set document title
  useEffect(() => { document.title = 'GPS Breadcrumb \u2014 RMPG Flex'; }, []);


  if (!isOpen) {
    return (
      <button type="button"
        onClick={onToggle}
        className="absolute top-[70px] left-2 z-[500] panel-beveled bg-surface-raised px-2 py-1.5 flex items-center gap-1.5 hover:bg-surface-base transition-colors"
        title="GPS History Playback"
        style={{ borderRadius: 2 }}
      >
        <History className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[10px] font-mono text-rmpg-200 font-bold">HISTORY</span>
      </button>
    );
  }

  return (
    <div
      className="absolute top-[70px] left-2 z-[500] panel-beveled bg-surface-raised w-[300px] flex flex-col transition-all duration-200"
      style={{ borderRadius: 2, maxHeight: 'calc(100dvh -180px)' }}
    >
      {/* Header */}
      <div className="panel-title-bar flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <History className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[11px] font-mono font-bold text-white tracking-wide">GPS HISTORY</span>
        </div>
        <button type="button" onClick={onToggle} className="p-0.5 hover:bg-white/10 rounded-sm transition-colors" aria-label="Close" title="Close">
          <X className="w-3.5 h-3.5 text-rmpg-400" />
        </button>
      </div>

      <div className="p-2.5 space-y-2 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b2b2b]" style={{ maxHeight: 'calc(100dvh -240px)' }}>
        {/* Unit selector */}
        <div className="space-y-1">
          <label className="text-[9px] font-mono font-bold text-brand-gold-400 uppercase tracking-wider">Unit / Officer</label>
          <select
            value={selectedUnit ?? ''}
            onChange={(e) => setSelectedUnit(e.target.value ? Number(e.target.value) : null)}
            aria-label="Select unit for trail playback"
            className="w-full input-dark text-[11px] font-mono px-2 py-1.5 min-h-[36px] bg-[#0c0c0c] border-[#2b2b2b] rounded-sm"
            style={{ borderRadius: 2 }}
          >
            <option value="">Select unit...</option>
            {unitsLoading && <option disabled>Loading...</option>}
            {units.map((u) => (
              <option key={u.unit_id} value={u.unit_id}>
                {u.call_sign} {u.officer_name ? `\u2014 ${u.officer_name}` : ''} ({u.point_count.toLocaleString()} pts)
              </option>
            ))}
          </select>
        </div>

        {/* Date range */}
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-0.5">
            <label className="text-[8px] font-mono font-bold text-brand-gold-400 uppercase">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full input-dark text-[10px] font-mono px-1.5 py-1 min-h-[36px]"
              style={{ borderRadius: 2 }}
            />
          </div>
          <div className="space-y-0.5">
            <label className="text-[8px] font-mono font-bold text-brand-gold-400 uppercase">From Time</label>
            <input
              type="time"
              value={timeFrom}
              onChange={(e) => setTimeFrom(e.target.value)}
              className="w-full input-dark text-[10px] font-mono px-1.5 py-1 min-h-[36px]"
              style={{ borderRadius: 2 }}
            />
          </div>
          <div className="space-y-0.5">
            <label className="text-[8px] font-mono font-bold text-brand-gold-400 uppercase">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full input-dark text-[10px] font-mono px-1.5 py-1 min-h-[36px]"
              style={{ borderRadius: 2 }}
            />
          </div>
          <div className="space-y-0.5">
            <label className="text-[8px] font-mono font-bold text-brand-gold-400 uppercase">To Time</label>
            <input
              type="time"
              value={timeTo}
              onChange={(e) => setTimeTo(e.target.value)}
              className="w-full input-dark text-[10px] font-mono px-1.5 py-1 min-h-[36px]"
              style={{ borderRadius: 2 }}
            />
          </div>
        </div>

        {/* Load button */}
        <button type="button"
          onClick={loadTrail}
          disabled={loading || selectedUnit == null}
          className="w-full btn-primary flex items-center justify-center gap-1.5 text-[11px] font-mono font-bold py-1.5 disabled:opacity-40"
          style={{ borderRadius: 2 }}
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" role="status" aria-label="Loading" />
          ) : (
            <Search className="w-3.5 h-3.5" />
          )}
          {loading ? 'Loading Trail...' : 'Load Trail'}
        </button>

        {/* Error */}
        {error && (
          <div className="text-[10px] font-mono text-red-400 bg-red-900/20 border border-red-800/30 px-2 py-1.5" style={{ borderRadius: 2 }}>
            {error}
          </div>
        )}

        {/* Trail info */}
        {trail && (
          <div className="space-y-2">
            {/* Summary bar */}
            <div className="panel-inset bg-surface-deep px-2 py-1.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-amber-400">{trail.call_sign}</span>
                <span className="text-[9px] font-mono text-rmpg-400 tabular-nums">{trail.points.length.toLocaleString()} points</span>
              </div>
              {trail.officer_name && (
                <div className="text-[10px] font-mono text-rmpg-300">{trail.officer_name} {trail.badge_number ? `(${trail.badge_number})` : ''}</div>
              )}
              {trail.points.length > 0 && (
                <div className="text-[9px] font-mono text-rmpg-500">
                  {safeDateTimeStr(trail.points[0]?.time)} &rarr; {safeDateTimeStr(trail.points[trail.points.length - 1]?.time)}
                </div>
              )}
            </div>

            {/* Speed legend — 8 bands */}
            <div className="panel-inset bg-surface-deep px-2 py-1.5 space-y-1">
              <div className="flex items-center gap-1 mb-0.5">
                <Gauge className="w-2.5 h-2.5 text-rmpg-400" />
                <span className="text-[8px] font-mono font-bold text-brand-gold-400 uppercase tracking-wider">Speed Legend</span>
              </div>
              <div className="grid grid-cols-3 gap-x-2 gap-y-0.5">
                {SPEED_LEGEND_BANDS.map((band) => (
                  <span key={band.label} className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: band.color }} />
                    <span className="text-[7px] text-rmpg-300 font-mono truncate" title={`${band.label}: ${band.range}`}>{band.range}</span>
                  </span>
                ))}
              </div>
              {/* Gradient strip */}
              <div className="mt-1">
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'linear-gradient(to right, #6b7280, #9ca3af, #888888, #22c55e, #84cc16, #eab308, #f97316, #ef4444, #dc2626)', boxShadow: '0 0 4px rgba(234,179,8,0.2)' }} />
                <div className="flex justify-between mt-0.5">
                  <span className="text-[6px] text-rmpg-500 font-mono tabular-nums">0</span>
                  <span className="text-[6px] text-rmpg-500 font-mono tabular-nums">10</span>
                  <span className="text-[6px] text-rmpg-500 font-mono tabular-nums">25</span>
                  <span className="text-[6px] text-rmpg-500 font-mono tabular-nums">45</span>
                  <span className="text-[6px] text-rmpg-500 font-mono tabular-nums">75+</span>
                </div>
              </div>
            </div>

            {/* Start/end legend */}
            <div className="flex items-center gap-3 px-1">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 border border-white/50" />
                <span className="text-[8px] text-rmpg-400 font-mono">Start</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 border border-white/50" />
                <span className="text-[8px] text-rmpg-400 font-mono">End</span>
              </span>
            </div>

            {/* Speed statistics */}
            {(() => {
              const pts = trail.points;
              const speeds = pts.filter(p => p.speed != null && p.speed >= 0).map(p => p.speed! * MPS_TO_MPH);
              const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
              const maxSpeedVal = speeds.length > 0 ? Math.max(...speeds) : 0;
              const maxSpeedPt = pts.find(p => p.speed != null && p.speed * MPS_TO_MPH >= maxSpeedVal - 0.01);
              const stationaryCount = pts.filter(p => p.speed == null || p.speed < 0.2).length;
              const movingCount = pts.length - stationaryCount;
              const intervalSec = 15;
              const stationaryMins = Math.round((stationaryCount * intervalSec) / 60);
              const movingMins = Math.round((movingCount * intervalSec) / 60);

              // Total distance (haversine sum in miles)
              let totalDistM = 0;
              for (let i = 0; i < pts.length - 1; i++) {
                const p1 = pts[i], p2 = pts[i + 1];
                const R = 6371000;
                const dLat = (p2.lat - p1.lat) * Math.PI / 180;
                const dLng = (p2.lng - p1.lng) * Math.PI / 180;
                const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
                totalDistM += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
              }
              const totalMiles = totalDistM / 1609.34;

              // Speed alert count
              const alertCount = pts.filter(p => p.speed != null && p.speed * MPS_TO_MPH >= 80).length;

              // Speed distribution (count per band)
              const bandThresholds = [0, 3, 10, 25, 35, 45, 55, 75, Infinity];
              const bandCounts = new Array(9).fill(0);
              for (const pt of pts) {
                const mph = pt.speed != null ? pt.speed * MPS_TO_MPH : -1;
                if (mph < 0 || (pt.speed != null && pt.speed < 0.2)) { bandCounts[0]++; continue; }
                for (let b = bandThresholds.length - 1; b >= 1; b--) {
                  if (mph >= bandThresholds[b - 1]) { bandCounts[b]++; break; }
                }
              }
              // For stationary, count those with speed < 0.2 m/s or null
              const maxBandCount = Math.max(...bandCounts, 1);

              return (
                <div className="panel-inset bg-surface-deep px-2 py-1.5 space-y-1">
                  <div className="text-[8px] font-mono font-bold text-brand-gold-400 uppercase tracking-wider">Speed Statistics</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-rmpg-500">Avg Speed:</span>
                      <span className="text-white font-bold">{avgSpeed.toFixed(1)} mph</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-rmpg-500">Max Speed:</span>
                      <span className="font-bold" style={{ color: speedToColor(maxSpeedPt?.speed ?? null) }}>{maxSpeedVal.toFixed(0)} mph</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-rmpg-500">Stationary:</span>
                      <span className="text-rmpg-300">{stationaryMins}m</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-rmpg-500">Moving:</span>
                      <span className="text-rmpg-300">{movingMins}m</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-rmpg-500">Distance:</span>
                      <span className="text-white font-bold">{totalMiles.toFixed(2)} mi</span>
                    </div>
                    {maxSpeedPt && (
                      <div className="flex justify-between">
                        <span className="text-rmpg-500">Max at:</span>
                        <span className="text-rmpg-300 text-[8px]">{new Date(maxSpeedPt.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                      </div>
                    )}
                  </div>
                  {alertCount > 0 && (
                    <div className="flex items-center gap-1 mt-1 px-1 py-0.5 bg-red-900/30 border border-red-800/40 rounded-sm">
                      <AlertTriangle className="w-3 h-3 text-red-400" />
                      <span className="text-[9px] font-mono font-bold text-red-400">{alertCount} Speed Alert{alertCount !== 1 ? 's' : ''} (80+ mph)</span>
                    </div>
                  )}
                  {/* Speed distribution mini bar chart */}
                  <div className="mt-1 space-y-0.5">
                    <div className="text-[7px] font-mono text-rmpg-500 uppercase">Distribution</div>
                    <div className="flex items-end gap-px h-4">
                      {SPEED_LEGEND_BANDS.map((band, i) => (
                        <div key={band.label} className="flex-1 flex flex-col items-center" title={`${band.label}: ${bandCounts[i]} pts`}>
                          <div
                            className="w-full rounded-t-sm"
                            style={{
                              background: band.color,
                              height: `${Math.max((bandCounts[i] / maxBandCount) * 16, 1)}px`,
                              opacity: bandCounts[i] > 0 ? 1 : 0.2,
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Playback controls */}
            <div className="panel-inset bg-surface-deep px-2 py-2 space-y-1.5">
              <div className="text-[8px] font-mono font-bold text-brand-gold-400 uppercase tracking-wider mb-1">Playback</div>

              {/* #47: Progress bar with glow and smoother animation */}
              <div className="relative w-full h-1.5 bg-rmpg-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#888888] to-[#a0a0a0] transition-all duration-150 ease-out"
                  style={{ width: `${totalPts > 0 ? ((playbackIdx + 1) / totalPts) * 100 : 0}%`, boxShadow: '0 0 6px rgba(160, 160, 160,0.4)' }}
                />
              </div>

              {/* Timeline time range labels */}
              {trail.points.length > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-[7px] font-mono text-rmpg-500">
                    {new Date(trail.points[0].time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                  </span>
                  <span className="text-[7px] font-mono text-rmpg-500">
                    {new Date(trail.points[trail.points.length - 1].time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                  </span>
                </div>
              )}

              {/* Scrub slider */}
              <input
                type="range"
                min={0}
                max={Math.max(totalPts - 1, 0)}
                value={playbackIdx}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setPlaybackIdx(idx);
                  setIsPlaying(false);
                  if (playbackAnimRef.current) { clearTimeout(playbackAnimRef.current); playbackAnimRef.current = null; }
                  const pt = trail.points[idx];
                  if (pt && playbackMarkerRef.current) {
                    playbackMarkerRef.current.setLngLat([pt.lng, pt.lat]);
                    const markerEl = playbackMarkerRef.current.getElement();
                    const inner = markerEl.firstElementChild as HTMLElement | null;
                    if (inner) inner.style.transform = `rotate(${pt.heading || 0}deg)`;
                  } else if (pt && map && !playbackMarkerRef.current) {
                    const el = document.createElement('div');
                    const inner = document.createElement('div');
                    inner.style.transform = `rotate(${pt.heading || 0}deg)`;
                    inner.innerHTML = '<svg width="28" height="28" viewBox="-14 -14 28 28" style="display:block"><polygon points="0,-12 12,10 -12,10" fill="#00ff88" stroke="white" stroke-width="2"/></svg>';
                    el.appendChild(inner);
                    el.style.zIndex = '9999';
                    playbackMarkerRef.current = new mapboxgl.Marker({ element: el })
                      .setLngLat([pt.lng, pt.lat])
                      .addTo(map);
                  }
                }}
                className="w-full h-1 accent-amber-500"
                style={{ margin: 0 }}
              />

              {/* Controls row */}
              <div className="flex items-center gap-1">
                <button type="button"
                  onClick={() => {
                    setPlaybackIdx(0);
                    if (trail.points[0] && playbackMarkerRef.current) {
                      playbackMarkerRef.current.setLngLat([trail.points[0].lng, trail.points[0].lat]);
                      const markerEl = playbackMarkerRef.current.getElement();
                      const inner = markerEl.firstElementChild as HTMLElement | null;
                      if (inner) inner.style.transform = `rotate(${trail.points[0].heading || 0}deg)`;
                    }
                  }}
                  className="p-1.5 rounded-sm hover:bg-[#181818] transition-colors duration-150 w-7 h-7 flex items-center justify-center"
                  title="Go to start"
                >
                  <SkipBack className="w-3 h-3 text-rmpg-300" />
                </button>

                <button type="button"
                  onClick={() => {
                    if (isPlaying) {
                      setIsPlaying(false);
                      if (playbackAnimRef.current) { clearTimeout(playbackAnimRef.current); playbackAnimRef.current = null; }
                    } else {
                      if (playbackIdx >= totalPts - 1) setPlaybackIdx(0);
                      setIsPlaying(true);
                    }
                  }}
                  className="p-1.5 rounded-sm hover:bg-[#181818] transition-colors duration-150 active:scale-[0.95] w-8 h-8 flex items-center justify-center"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <Play className="w-3.5 h-3.5 text-green-400" />
                  )}
                </button>

                <button type="button"
                  onClick={() => {
                    const lastIdx = totalPts - 1;
                    setPlaybackIdx(lastIdx);
                    setIsPlaying(false);
                    if (trail.points[lastIdx] && playbackMarkerRef.current) {
                      playbackMarkerRef.current.setLngLat([trail.points[lastIdx].lng, trail.points[lastIdx].lat]);
                      const markerEl = playbackMarkerRef.current.getElement();
                      const inner = markerEl.firstElementChild as HTMLElement | null;
                      if (inner) inner.style.transform = `rotate(${trail.points[lastIdx].heading || 0}deg)`;
                    }
                  }}
                  className="p-1.5 rounded-sm hover:bg-[#181818] transition-colors duration-150 w-7 h-7 flex items-center justify-center"
                  title="Go to end"
                >
                  <SkipForward className="w-3 h-3 text-rmpg-300" />
                </button>

                {/* Jump to end (now) */}
                <button type="button"
                  onClick={() => {
                    const lastIdx = totalPts - 1;
                    setPlaybackIdx(lastIdx);
                    setIsPlaying(false);
                    if (playbackAnimRef.current) { clearTimeout(playbackAnimRef.current); playbackAnimRef.current = null; }
                    if (trail.points[lastIdx] && playbackMarkerRef.current) {
                      playbackMarkerRef.current.setLngLat([trail.points[lastIdx].lng, trail.points[lastIdx].lat]);
                      const markerEl = playbackMarkerRef.current.getElement();
                      const inner = markerEl.firstElementChild as HTMLElement | null;
                      if (inner) inner.style.transform = `rotate(${trail.points[lastIdx].heading || 0}deg)`;
                    }
                    if (trail.points[lastIdx] && map) {
                      map.panTo([trail.points[lastIdx].lng, trail.points[lastIdx].lat]);
                    }
                  }}
                  className="px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors text-amber-400 hover:bg-amber-900/30 border border-amber-700/30"
                  title="Jump to latest point"
                >
                  NOW
                </button>

                {/* Speed buttons */}
                <div className="flex items-center gap-0.5 ml-auto">
                  {[0.5, 1, 2, 4, 8].map((s) => (
                    <button type="button"
                      key={s}
                      onClick={() => setPlaybackSpeed(s)}
                      className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                        playbackSpeed === s
                          ? 'bg-[#0c0c0c] text-amber-400 border border-[#2b2b2b]'
                          : 'text-rmpg-500 hover:text-rmpg-300 bg-[#0c0c0c]/50 border border-transparent'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>

              {/* Current point info */}
              {currentPt && (
                <div className="text-[9px] font-mono text-rmpg-300 space-y-0.5 pt-1 border-t border-rmpg-700/50">
                  <div className="flex justify-between">
                    <span className="text-rmpg-500">Time:</span>
                    <span className="text-white font-bold">{safeDateTimeStr(currentPt.time)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-rmpg-500">Speed:</span>
                    <span style={{ color: speedToColor(currentPt.speed) }} className="font-bold">{formatSpeedMph(currentPt.speed)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-rmpg-500">Heading:</span>
                    <span>{formatHeadingDir(currentPt.heading)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-rmpg-500">Status:</span>
                    <span style={{ color: statusToColor(currentPt.status) }} className="font-bold">{STATUS_LABELS[currentPt.status] || currentPt.status}</span>
                  </div>
                  {currentPt.road_name && (
                    <div className="flex justify-between">
                      <span className="text-rmpg-500">Road:</span>
                      <span className="text-amber-300 text-right">{currentPt.road_name}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-rmpg-500">Point:</span>
                    <span>{playbackIdx + 1} / {totalPts}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Clear button */}
            <button type="button"
              onClick={() => {
                clearMapObjects();
                setTrail(null);
                setIsPlaying(false);
                setPlaybackIdx(0);
              }}
              className="w-full btn-secondary flex items-center justify-center gap-1.5 text-[10px] font-mono py-1"
              style={{ borderRadius: 2 }}
            >
              <X className="w-3 h-3" />
              Clear Trail
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
