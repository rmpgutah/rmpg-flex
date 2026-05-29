import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  History, Play, Pause, SkipForward, SkipBack, Search, X, Loader2,
  ChevronDown, ChevronUp, MapPin, Gauge, Navigation2, AlertTriangle,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { localToday, safeDateTimeStr, parseTimestamp } from '../../utils/dateUtils';
import { escapeHtml } from '../../utils/sanitize';
import { mapboxgl } from '../../utils/mapboxLoader';
import { whenStyleReady } from './utils/safeAddSource';

// ============================================================
// Types
// ============================================================

interface TrailPoint {
  lat: number; lng: number;
  accuracy: number | null; heading: number | null;
  speed: number | null; status: string;
  call_number: string | null; call_type: string | null;
  time: string; road_name: string | null; intersection: string | null;
}

interface HistoryTrail {
  unit_id: number; call_sign: string;
  officer_name: string; badge_number: string;
  points: TrailPoint[]; total_raw: number;
}

interface UnitOption {
  unit_id: number; call_sign: string;
  officer_name: string; badge_number: string;
  earliest: string; latest: string; point_count: number;
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

const MPS_TO_MPH = 2.23694;

const speedToColor = (mps: number | null): string => {
  if (mps == null || mps < 0.2) return '#666666';
  const mph = mps * MPS_TO_MPH;
  if (mph < 3) return '#999999'; if (mph < 10) return '#22c55e';
  if (mph < 25) return '#22c55e'; if (mph < 35) return '#84cc16';
  if (mph < 45) return '#eab308'; if (mph < 55) return '#f97316';
  if (mph < 75) return '#ef4444'; return '#dc2626';
};

const statusToColor = (status: string): string => {
  switch (status) {
    case 'dispatched': return '#f59e0b'; case 'enroute': return '#888888';
    case 'onscene': return '#ef4444'; case 'available': return '#22c55e';
    case 'busy': return '#8b5cf6'; case 'off_duty': return '#666666';
    default: return '#666666';
  }
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

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = parseTimestamp(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export default function GpsBreadcrumbPanel({ map, mapLoaded, isOpen, onToggle }: Props) {
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState(() => localToday());
  const [dateTo, setDateTo] = useState(() => localToday());
  const [timeFrom, setTimeFrom] = useState('00:00');
  const [timeTo, setTimeTo] = useState('23:59');
  const [trail, setTrail] = useState<HistoryTrail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIdx, setPlaybackIdx] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(2);
  const playbackAnimRef = useRef<number | null>(null);

  // Map source/layer IDs for cleanup
  const sourceIdsRef = useRef<string[]>([]);
  const playbackMarkerRef = useRef<mapboxgl.Marker | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setUnitsLoading(true);
    apiFetch<UnitOption[]>('/dispatch/gps/units-with-trails')
      .then((data) => setUnits(data || []))
      .catch(() => setUnits([]))
      .finally(() => setUnitsLoading(false));
  }, [isOpen]);

  const clearMapObjects = useCallback(() => {
    if (!map) return;
    for (const id of sourceIdsRef.current) {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch {}
      try { if (map.getSource(id)) map.removeSource(id); } catch {}
    }
    sourceIdsRef.current = [];
    if (playbackMarkerRef.current) {
      playbackMarkerRef.current.remove();
      playbackMarkerRef.current = null;
    }
  }, [map]);

  useEffect(() => {
    if (!isOpen) {
      clearMapObjects();
      setTrail(null);
      setIsPlaying(false);
      setPlaybackIdx(0);
    }
    return () => clearMapObjects();
  }, [isOpen, clearMapObjects]);

  const renderTrailOnMap = useCallback((data: HistoryTrail) => {
    if (!map) return;
    clearMapObjects();

    const points = data.points;
    if (points.length === 0) return;

    // Build colored segments — each segment is a 2-point line with its own color
    const segmentsByColor: Map<string, [number, number][]> = new Map();
    for (let i = 0; i < points.length - 1; i++) {
      const color = speedToColor(points[i].speed);
      const coords: [number, number] = [points[i].lng, points[i].lat];
      if (!segmentsByColor.has(color)) segmentsByColor.set(color, []);
      segmentsByColor.get(color)!.push(coords);
    }
    // Add last point
    const lastPt = points[points.length - 1];
    const lastColor = speedToColor(lastPt.speed);
    if (!segmentsByColor.has(lastColor)) segmentsByColor.set(lastColor, []);
    segmentsByColor.get(lastColor)!.push([lastPt.lng, lastPt.lat]);

    let segIdx = 0;
    for (const [color, coords] of segmentsByColor) {
      const sourceId = `breadcrumb-line-${segIdx++}`;
      sourceIdsRef.current.push(sourceId);
      whenStyleReady(map, () => {
        map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
        });
        map.addLayer({
          id: sourceId,
          type: 'line',
          source: sourceId,
          paint: { 'line-color': color, 'line-width': 2, 'line-opacity': 0.9 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      });
    }

    // Direction arrows at intervals
    const arrowInterval = Math.max(1, Math.floor(points.length / 20));
    for (let i = 0; i < points.length; i += arrowInterval) {
      const pt = points[i];
      if (pt.heading == null) continue;
      const el = document.createElement('div');
      el.style.cssText = `width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:8px solid #f59e0b;transform:rotate(${pt.heading}deg);`;
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([pt.lng, pt.lat]).addTo(map);
      sourceIdsRef.current.push(`arrow-marker-${i}`);
    }

    // Fit bounds
    const bounds = new mapboxgl.LngLatBounds();
    points.forEach(p => bounds.extend([p.lng, p.lat]));
    map.fitBounds(bounds, { padding: 60 });
  }, [map, clearMapObjects]);

  const loadTrail = useCallback(async () => {
    if (selectedUnit == null || !map || !mapLoaded) return;
    setLoading(true); setError(null);
    setIsPlaying(false); setPlaybackIdx(0);
    clearMapObjects();

    const fromStr = `${dateFrom} ${timeFrom}:00`;
    const toStr = `${dateTo} ${timeTo}:59`;

    try {
      const data = await apiFetch<HistoryTrail>(
        `/dispatch/gps/history?unit_id=${selectedUnit}&from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}`
      );
      if (!data || !data.points || data.points.length === 0) {
        setError('No GPS data found for this unit in the selected time range.');
        setTrail(null); return;
      }
      setTrail(data);
      renderTrailOnMap(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load trail data');
      setTrail(null);
    } finally { setLoading(false); }
  }, [selectedUnit, dateFrom, dateTo, timeFrom, timeTo, map, mapLoaded, clearMapObjects, renderTrailOnMap]);

  const animatePlaybackStep = useCallback(() => {
    if (!trail || !map) { setIsPlaying(false); return; }
    const pts = trail.points;
    setPlaybackIdx(prev => {
      const next = prev + 1;
      if (next >= pts.length) { setIsPlaying(false); return prev; }

      const pt = pts[next];
      if (playbackMarkerRef.current) {
        playbackMarkerRef.current.setLngLat([pt.lng, pt.lat]);
      } else {
        const el = document.createElement('div');
        el.style.cssText = 'width:12px;height:12px;border-radius:50%;background:#f59e0b;border:2px solid #fff;box-shadow:0 0 8px rgba(245,158,11,0.5);';
        playbackMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([pt.lng, pt.lat]).addTo(map);
      }
      map.panTo([pt.lng, pt.lat]);
      return next;
    });
  }, [trail, map]);

  useEffect(() => {
    if (!isPlaying || !trail) return;
    const interval = 1000 / playbackSpeed;
    const id = setInterval(animatePlaybackStep, interval);
    return () => clearInterval(id);
  }, [isPlaying, playbackSpeed, trail, animatePlaybackStep]);

  const togglePlayback = () => {
    if (!trail) return;
    if (playbackIdx >= trail.points.length - 1) { setPlaybackIdx(0); setIsPlaying(true); return; }
    setIsPlaying(!isPlaying);
  };

  const stepPlayback = (dir: 1 | -1) => {
    if (!trail) return;
    setIsPlaying(false);
    setPlaybackIdx(prev => Math.max(0, Math.min(prev + dir, trail.points.length - 1)));
  };

  const currentPoint = trail?.points[playbackIdx] || null;

  return (
    <div style={{ position: 'absolute', right: 10, top: 10, zIndex: 10 }}>
      {!isOpen && (
        <button type="button" onClick={onToggle}
          className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-rmpg-300 rounded-sm"
          style={{ background: 'rgba(13,21,32,0.9)', border: '1px solid #2b2b2b' }}>
          <History className="w-3.5 h-3.5 text-amber-400" /> GPS History
        </button>
      )}
      {isOpen && (
        <div className="rounded-sm shadow-xl" style={{ width: 380, maxHeight: 'calc(100vh - 200px)', background: 'rgba(13,21,32,0.95)', border: '1px solid #2b2b2b' }}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#2b2b2b]">
            <div className="flex items-center gap-2">
              <History className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-bold text-[#d4a017] uppercase tracking-widest">GPS History</span>
            </div>
            <button type="button" onClick={onToggle} className="text-rmpg-400 hover:text-white"><X className="w-3.5 h-3.5" /></button>
          </div>

          {/* Unit selector + date range */}
          <div className="p-3 space-y-2 border-b border-[#2b2b2b] bg-[rgba(0,0,0,0.2)]">
            {unitsLoading ? (
              <div className="flex items-center gap-2 text-xs text-rmpg-400"><Loader2 className="w-3 h-3 animate-spin" /> Loading units...</div>
            ) : (
              <select
                value={selectedUnit || ''}
                onChange={e => setSelectedUnit(Number(e.target.value) || null)}
                className="w-full px-2 py-1.5 text-xs bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none"
              >
                <option value="">Select a unit...</option>
                {units.map(u => (
                  <option key={u.unit_id} value={u.unit_id}>
                    {u.call_sign} — {u.officer_name || 'Unknown'} ({u.point_count} points)
                  </option>
                ))}
              </select>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-rmpg-400 block mb-0.5">From</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full px-2 py-1 text-xs bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white" />
                <input type="time" value={timeFrom} onChange={e => setTimeFrom(e.target.value)} className="w-full px-2 py-1 text-xs bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white mt-1" />
              </div>
              <div>
                <label className="text-[9px] text-rmpg-400 block mb-0.5">To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full px-2 py-1 text-xs bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white" />
                <input type="time" value={timeTo} onChange={e => setTimeTo(e.target.value)} className="w-full px-2 py-1 text-xs bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white mt-1" />
              </div>
            </div>
            <button type="button" onClick={loadTrail} disabled={!selectedUnit || loading}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-bold rounded-[2px] bg-[#d4a017] text-black hover:bg-[#e8c44a] disabled:opacity-40 transition-colors">
              {loading ? <><Loader2 className="w-3 h-3 animate-spin" /> Loading...</> : <><Search className="w-3 h-3" /> Load Trail</>}
            </button>
          </div>

          {error && (
            <div className="px-3 py-2 bg-red-900/20 border-b border-red-700/30 text-red-300 text-[10px] flex items-center gap-2">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" /> {error}
            </div>
          )}

          {/* Playback controls */}
          {trail && (
            <div className="px-3 py-2 border-b border-[#2b2b2b] bg-[rgba(0,0,0,0.15)]">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => stepPlayback(-1)} className="text-rmpg-400 hover:text-white p-1"><SkipBack className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={togglePlayback} className="text-rmpg-400 hover:text-white p-1">
                  {isPlaying ? <Pause className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-amber-400" />}
                </button>
                <button type="button" onClick={() => stepPlayback(1)} className="text-rmpg-400 hover:text-white p-1"><SkipForward className="w-3.5 h-3.5" /></button>
                <span className="text-[10px] text-rmpg-300 font-mono ml-1">{playbackIdx + 1}/{trail.points.length}</span>
                <select value={playbackSpeed} onChange={e => setPlaybackSpeed(Number(e.target.value))}
                  className="ml-auto px-1.5 py-0.5 text-[10px] bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-rmpg-300">
                  <option value={1}>1x</option><option value={2}>2x</option><option value={5}>5x</option><option value={10}>10x</option>
                </select>
              </div>

              {/* Current point info */}
              {currentPoint && (
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                  <div><span className="text-rmpg-500">Time:</span> <span className="text-rmpg-200 font-mono">{safeDateTimeStr(currentPoint.time)}</span></div>
                  <div><span className="text-rmpg-500 flex items-center gap-1"><Gauge className="w-2.5 h-2.5" /> Speed:</span> <span className="text-rmpg-200 font-mono">{formatSpeedMph(currentPoint.speed)}</span></div>
                  <div><span className="text-rmpg-500 flex items-center gap-1"><Navigation2 className="w-2.5 h-2.5" /> Heading:</span> <span className="text-rmpg-200 font-mono">{formatHeadingDir(currentPoint.heading)}</span></div>
                  <div><span className="text-rmpg-500">Status:</span> <span style={{ color: statusToColor(currentPoint.status) }} className="font-mono uppercase">{currentPoint.status}</span></div>
                  {currentPoint.road_name && <div className="col-span-2"><span className="text-rmpg-500">Road:</span> <span className="text-rmpg-200">{currentPoint.road_name}{currentPoint.intersection ? ` @ ${currentPoint.intersection}` : ''}</span></div>}
                  {currentPoint.call_number && <div className="col-span-2"><span className="text-rmpg-500">Call:</span> <span className="text-amber-400 font-mono">#{currentPoint.call_number}</span> {currentPoint.call_type ? <span className="text-rmpg-300">- {currentPoint.call_type.replace(/_/g, ' ')}</span> : null}</div>}
                </div>
              )}
            </div>
          )}

          {/* Trail timeline scrubber */}
          {trail && trail.points.length > 0 && (
            <div className="px-3 py-2 border-b border-[#2b2b2b]">
              <div className="relative h-4 cursor-pointer" onClick={e => {
                const rect = (e.target as HTMLElement).getBoundingClientRect?.() || e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - (rect as DOMRect).left) / (rect as DOMRect).width;
                setPlaybackIdx(Math.floor(pct * (trail.points.length - 1)));
                setIsPlaying(false);
              }}>
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full h-1 bg-[#222222] rounded-full overflow-hidden">
                    <div style={{ width: `${(playbackIdx / Math.max(trail.points.length - 1, 1)) * 100}%`, height: '100%', background: '#f59e0b', borderRadius: 9999 }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Trail summary */}
          {trail && (
            <div className="p-3 text-[10px]">
              <div className="flex justify-between text-rmpg-400 mb-1">
                <span>{trail.call_sign} — {trail.officer_name}</span>
                <span className="text-rmpg-500">{trail.points.length} points</span>
              </div>
              <div className="text-rmpg-500">
                {safeDateTimeStr(trail.points[0]?.time || '')} → {safeDateTimeStr(trail.points[trail.points.length - 1]?.time || '')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
