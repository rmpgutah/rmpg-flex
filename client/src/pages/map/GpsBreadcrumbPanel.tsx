import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  History,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Search,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
  MapPin,
  Gauge,
  Navigation2,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { localToday } from '../../utils/dateUtils';
import { escapeHtml } from '../../utils/sanitize';

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
  map: google.maps.Map | null;
  mapLoaded: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

// ============================================================
// Constants
// ============================================================

const TRAIL_COLOR = '#f59e0b'; // amber for history trail (distinct from live cyan trails)

const speedToColor = (mps: number | null): string => {
  if (mps == null || mps < 0.5) return '#6b7280';
  const mph = mps * 2.237;
  if (mph < 15) return '#22c55e';
  if (mph < 35) return '#eab308';
  if (mph < 55) return '#f97316';
  return '#ef4444';
};

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
  const polyLinesRef = useRef<google.maps.Polyline[]>([]);
  const dotMarkersRef = useRef<google.maps.Circle[]>([]);
  const arrowMarkersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const playbackMarkerRef = useRef<google.maps.Marker | null>(null);
  const playbackAnimRef = useRef<number | null>(null);

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
    polyLinesRef.current.forEach((l) => l.setMap(null));
    polyLinesRef.current = [];
    dotMarkersRef.current.forEach((m) => m.setMap(null));
    dotMarkersRef.current = [];
    arrowMarkersRef.current.forEach((a) => a.setMap(null));
    arrowMarkersRef.current = [];
    if (playbackMarkerRef.current) {
      playbackMarkerRef.current.setMap(null);
      playbackMarkerRef.current = null;
    }
  }, []);

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
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    const pts = trailData.points;
    if (pts.length === 0) return;

    // Draw segment polylines with speed-based coloring
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const freshness = (i + 1) / pts.length;
      const opacity = 0.3 + freshness * 0.6;

      const seg = new google.maps.Polyline({
        path: [{ lat: p1.lat, lng: p1.lng }, { lat: p2.lat, lng: p2.lng }],
        geodesic: true,
        strokeColor: speedToColor(p1.speed),
        strokeOpacity: opacity,
        strokeWeight: 4,
        map,
      });
      polyLinesRef.current.push(seg);
    }

    // Directional arrows every 8th point
    pts.forEach((pt, ptIdx) => {
      if (ptIdx % 8 !== 4 || pt.heading == null) return;
      const arrow = new google.maps.Marker({
        position: { lat: pt.lat, lng: pt.lng },
        map,
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 3,
          rotation: pt.heading,
          fillColor: TRAIL_COLOR,
          fillOpacity: 0.7,
          strokeColor: '#fff',
          strokeWeight: 0.5,
          strokeOpacity: 0.6,
        },
        clickable: false,
        zIndex: 1,
      });
      arrowMarkersRef.current.push(arrow);
    });

    // Dot markers at each point
    pts.forEach((pt, ptIdx) => {
      const isFirst = ptIdx === 0;
      const isLast = ptIdx === pts.length - 1;

      const dot = new google.maps.Circle({
        center: { lat: pt.lat, lng: pt.lng },
        radius: isFirst || isLast ? 8 : 3,
        fillColor: isFirst ? '#22c55e' : isLast ? '#ef4444' : speedToColor(pt.speed),
        fillOpacity: isFirst || isLast ? 1 : 0.5,
        strokeColor: '#fff',
        strokeWeight: isFirst || isLast ? 2 : 0.5,
        strokeOpacity: 0.8,
        map,
        clickable: true,
        zIndex: ptIdx + 10,
      });

      dot.addListener('click', () => {
        const time = new Date(pt.time).toLocaleString();
        const locationRow = pt.road_name
          ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Road</td><td style="color:#e0e0e0">${escapeHtml(pt.road_name)}${pt.intersection ? ` @ ${escapeHtml(pt.intersection)}` : ''}</td></tr>`
          : '';
        const html = `
          <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:220px;line-height:1.6;background:#0a0e14;padding:10px 12px;border-radius:6px;border:1px solid #1e2a3a">
            <div style="font-weight:bold;font-size:13px;margin-bottom:4px;color:${TRAIL_COLOR}">
              ${escapeHtml(trailData.call_sign)} \u2014 ${escapeHtml(trailData.officer_name || 'Unknown')}
            </div>
            <div style="color:#8899aa;font-size:10px;margin-bottom:4px">${escapeHtml(trailData.badge_number || '')} \u2022 Historical Playback</div>
            ${pt.road_name ? `<div style="color:#fbbf24;font-weight:bold;font-size:12px;margin-bottom:4px;padding:2px 0;border-bottom:1px solid #1e2a3a">${escapeHtml(pt.road_name)}</div>` : ''}
            <div style="font-size:18px;font-weight:900;color:${speedToColor(pt.speed)};margin-bottom:4px">${formatSpeedMph(pt.speed)}</div>
            <table style="width:100%;font-size:11px;border-collapse:collapse">
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Time</td><td style="font-weight:bold;color:#fff">${time}</td></tr>
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Status</td><td style="font-weight:bold;color:${statusToColor(pt.status)}">${STATUS_LABELS[pt.status] || pt.status}</td></tr>
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Speed</td><td style="color:${speedToColor(pt.speed)};font-weight:bold">${formatSpeedMph(pt.speed)}</td></tr>
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Heading</td><td style="color:#e0e0e0">${formatHeadingDir(pt.heading)}</td></tr>
              ${locationRow}
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Accuracy</td><td style="color:#e0e0e0">${pt.accuracy != null ? `\u00b1${Math.round(pt.accuracy)}m` : '\u2014'}</td></tr>
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Position</td><td style="font-size:10px;color:#e0e0e0">${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}</td></tr>
              ${pt.call_number ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Call</td><td style="font-weight:bold;color:#4fc3f7">${escapeHtml(pt.call_number)} \u2014 ${escapeHtml(pt.call_type || '')}</td></tr>` : ''}
            </table>
          </div>
        `;
        infoWindowRef.current?.setContent(html);
        infoWindowRef.current?.setPosition({ lat: pt.lat, lng: pt.lng });
        infoWindowRef.current?.open(map);
      });

      dotMarkersRef.current.push(dot);
    });

    // Fit map to trail bounds
    const bounds = new google.maps.LatLngBounds();
    pts.forEach((pt) => bounds.extend({ lat: pt.lat, lng: pt.lng }));
    map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 360 });
  }, [map, clearMapObjects]);

  // ── Playback animation ──
  useEffect(() => {
    if (!map || !mapLoaded || !isPlaying || !trail || trail.points.length === 0) return;

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
        title: `${trail.call_sign} \u2014 History Playback`,
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
  }, [isPlaying, playbackSpeed, mapLoaded, map, trail]);


  if (!isOpen) {
    return (
      <button
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

  const currentPt = trail?.points[playbackIdx];
  const totalPts = trail?.points.length || 0;

  return (
    <div
      className="absolute top-[70px] left-2 z-[500] panel-beveled bg-surface-raised w-[300px] flex flex-col"
      style={{ borderRadius: 2, maxHeight: 'calc(100vh - 180px)' }}
    >
      {/* Header */}
      <div className="panel-title-bar flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <History className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[11px] font-mono font-bold text-white tracking-wide">GPS HISTORY</span>
        </div>
        <button onClick={onToggle} className="p-0.5 hover:bg-white/10 rounded-sm transition-colors">
          <X className="w-3.5 h-3.5 text-rmpg-400" />
        </button>
      </div>

      <div className="p-2.5 space-y-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 240px)' }}>
        {/* Unit selector */}
        <div className="space-y-1">
          <label className="text-[9px] font-mono font-bold text-brand-gold-400 uppercase tracking-wider">Unit / Officer</label>
          <select
            value={selectedUnit ?? ''}
            onChange={(e) => setSelectedUnit(e.target.value ? Number(e.target.value) : null)}
            className="w-full input-dark text-[11px] font-mono px-2 py-1.5"
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
              className="w-full input-dark text-[10px] font-mono px-1.5 py-1"
              style={{ borderRadius: 2 }}
            />
          </div>
          <div className="space-y-0.5">
            <label className="text-[8px] font-mono font-bold text-brand-gold-400 uppercase">From Time</label>
            <input
              type="time"
              value={timeFrom}
              onChange={(e) => setTimeFrom(e.target.value)}
              className="w-full input-dark text-[10px] font-mono px-1.5 py-1"
              style={{ borderRadius: 2 }}
            />
          </div>
          <div className="space-y-0.5">
            <label className="text-[8px] font-mono font-bold text-brand-gold-400 uppercase">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full input-dark text-[10px] font-mono px-1.5 py-1"
              style={{ borderRadius: 2 }}
            />
          </div>
          <div className="space-y-0.5">
            <label className="text-[8px] font-mono font-bold text-brand-gold-400 uppercase">To Time</label>
            <input
              type="time"
              value={timeTo}
              onChange={(e) => setTimeTo(e.target.value)}
              className="w-full input-dark text-[10px] font-mono px-1.5 py-1"
              style={{ borderRadius: 2 }}
            />
          </div>
        </div>

        {/* Load button */}
        <button
          onClick={loadTrail}
          disabled={loading || selectedUnit == null}
          className="w-full btn-primary flex items-center justify-center gap-1.5 text-[11px] font-mono font-bold py-1.5 disabled:opacity-40"
          style={{ borderRadius: 2 }}
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
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
                <span className="text-[9px] font-mono text-rmpg-400">{trail.points.length.toLocaleString()} points</span>
              </div>
              {trail.officer_name && (
                <div className="text-[10px] font-mono text-rmpg-300">{trail.officer_name} {trail.badge_number ? `(${trail.badge_number})` : ''}</div>
              )}
              {trail.points.length > 0 && (
                <div className="text-[9px] font-mono text-rmpg-500">
                  {new Date(trail.points[0].time).toLocaleString()} &rarr; {new Date(trail.points[trail.points.length - 1].time).toLocaleString()}
                </div>
              )}
            </div>

            {/* Speed legend */}
            <div className="flex items-center gap-1.5 px-1">
              <Gauge className="w-2.5 h-2.5 text-rmpg-400" />
              {[
                ['#6b7280', 'Stop'],
                ['#22c55e', '<15'],
                ['#eab308', '15-35'],
                ['#f97316', '35-55'],
                ['#ef4444', '55+'],
              ].map(([color, label]) => (
                <span key={label} className="flex items-center gap-0.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                  <span className="text-[7px] text-rmpg-400 font-mono">{label}</span>
                </span>
              ))}
              <span className="text-[7px] text-rmpg-500 font-mono">mph</span>
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

            {/* Playback controls */}
            <div className="panel-inset bg-surface-deep px-2 py-2 space-y-1.5">
              <div className="text-[8px] font-mono font-bold text-brand-gold-400 uppercase tracking-wider mb-1">Playback</div>

              {/* Progress bar */}
              <div className="relative w-full h-1.5 bg-rmpg-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-100"
                  style={{ width: `${totalPts > 0 ? ((playbackIdx + 1) / totalPts) * 100 : 0}%` }}
                />
              </div>

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
                  } else if (pt && map && !playbackMarkerRef.current) {
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
                    });
                  }
                }}
                className="w-full h-1 accent-amber-500"
                style={{ margin: 0 }}
              />

              {/* Controls row */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setPlaybackIdx(0);
                    if (trail.points[0] && playbackMarkerRef.current) {
                      playbackMarkerRef.current.setPosition({ lat: trail.points[0].lat, lng: trail.points[0].lng });
                    }
                  }}
                  className="p-1 rounded-sm hover:bg-rmpg-700/50 transition-colors"
                  title="Go to start"
                >
                  <SkipBack className="w-3 h-3 text-rmpg-300" />
                </button>

                <button
                  onClick={() => {
                    if (isPlaying) {
                      setIsPlaying(false);
                      if (playbackAnimRef.current) { clearTimeout(playbackAnimRef.current); playbackAnimRef.current = null; }
                    } else {
                      if (playbackIdx >= totalPts - 1) setPlaybackIdx(0);
                      setIsPlaying(true);
                    }
                  }}
                  className="p-1 rounded-sm hover:bg-rmpg-700/50 transition-colors"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <Play className="w-3.5 h-3.5 text-green-400" />
                  )}
                </button>

                <button
                  onClick={() => {
                    const lastIdx = totalPts - 1;
                    setPlaybackIdx(lastIdx);
                    setIsPlaying(false);
                    if (trail.points[lastIdx] && playbackMarkerRef.current) {
                      playbackMarkerRef.current.setPosition({ lat: trail.points[lastIdx].lat, lng: trail.points[lastIdx].lng });
                    }
                  }}
                  className="p-1 rounded-sm hover:bg-rmpg-700/50 transition-colors"
                  title="Go to end"
                >
                  <SkipForward className="w-3 h-3 text-rmpg-300" />
                </button>

                {/* Speed buttons */}
                <div className="flex items-center gap-0.5 ml-auto">
                  {[1, 2, 4, 8].map((s) => (
                    <button
                      key={s}
                      onClick={() => setPlaybackSpeed(s)}
                      className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                        playbackSpeed === s
                          ? 'bg-amber-900/50 text-amber-400 border border-amber-700/50'
                          : 'text-rmpg-500 hover:text-rmpg-300'
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
                    <span className="text-white font-bold">{new Date(currentPt.time).toLocaleString()}</span>
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
            <button
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
