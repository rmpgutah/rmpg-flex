import { useEffect, useRef, useState, useCallback } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp } from '../../../utils/dateUtils';

interface GpsPosition { lat: number; lng: number; timestamp: string; speed?: number; heading?: number; }
interface UnitOption { unit_id: number; call_sign: string; officer_name?: string; badge_number?: string; }
interface Props { map: mapboxgl.Map; onClose: () => void; }

const SOURCE_TRAIL = 'replay-trail';
const SOURCE_MARKER = 'replay-marker';
const LAYER_TRAIL = 'replay-trail-layer';
const LAYER_MARKER = 'replay-marker-layer';
const SPEEDS = [1, 2, 5, 10];
const HOURS_OPTIONS = [4, 8, 12, 24];

function toIsoStr(d: Date) {
  // SQLite UTC datetime string
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

export default function GpsReplayTool({ map, onClose }: Props) {
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<number | null>(null);
  const [positions, setPositions] = useState<GpsPosition[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [autoFollow, setAutoFollow] = useState(true);
  const [hoursBack, setHoursBack] = useState(8);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const posRef = useRef<GpsPosition[]>([]);
  const autoFollowRef = useRef(autoFollow);

  useEffect(() => { posRef.current = positions; }, [positions]);
  useEffect(() => { autoFollowRef.current = autoFollow; }, [autoFollow]);

  // Load units with trail data on mount
  useEffect(() => {
    apiFetch<UnitOption[]>('/dispatch/gps/units-with-trails').then(setUnits).catch(() => {});
  }, []);

  // Setup map sources/layers
  const setupSources = useCallback(() => {
    if (!map.getSource(SOURCE_TRAIL)) {
      map.addSource(SOURCE_TRAIL, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: LAYER_TRAIL, type: 'line', source: SOURCE_TRAIL,
        paint: { 'line-color': '#d4a017', 'line-width': 2, 'line-opacity': 0.8 } });
    }
    if (!map.getSource(SOURCE_MARKER)) {
      map.addSource(SOURCE_MARKER, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: LAYER_MARKER, type: 'circle', source: SOURCE_MARKER,
        paint: { 'circle-radius': 8, 'circle-color': '#d4a017',
          'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
    }
  }, [map]);

  useEffect(() => {
    setupSources();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      [LAYER_TRAIL, LAYER_MARKER].forEach(l => { try { if (map.getLayer(l)) map.removeLayer(l); } catch {} });
      [SOURCE_TRAIL, SOURCE_MARKER].forEach(s => { try { if (map.getSource(s)) map.removeSource(s); } catch {} });
    };
  }, [map, setupSources]);

  const updateMapAt = useCallback((idx: number) => {
    const pts = posRef.current;
    if (!pts.length) return;
    const clamped = Math.min(idx, pts.length - 1);
    const trail = pts.slice(0, clamped + 1);
    const marker = pts[clamped];
    try {
      (map.getSource(SOURCE_TRAIL) as any)?.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'LineString',
          coordinates: trail.map(p => [p.lng, p.lat]) }, properties: {} }],
      });
      (map.getSource(SOURCE_MARKER) as any)?.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point',
          coordinates: [marker.lng, marker.lat] }, properties: {} }],
      });
      if (autoFollowRef.current) map.flyTo({ center: [marker.lng, marker.lat], speed: 0.5 });
    } catch {}
  }, [map]);

  const loadPositions = async (unitId: number, hours: number) => {
    try {
      const to = new Date();
      const from = new Date(to.getTime() - hours * 3600 * 1000);
      const data = await apiFetch<{ points: { latitude: number; longitude: number; recorded_at: string; speed?: number; heading?: number }[] }>(
        `/dispatch/gps/history?unit_id=${unitId}&from=${encodeURIComponent(toIsoStr(from))}&to=${encodeURIComponent(toIsoStr(to))}`
      );
      const pts: GpsPosition[] = (data?.points ?? []).map(p => ({
        lat: p.latitude, lng: p.longitude, timestamp: p.recorded_at, speed: p.speed, heading: p.heading,
      }));
      setPositions(pts);
      setCurrentIdx(0);
      setPlaying(false);
      if (intervalRef.current) clearInterval(intervalRef.current);
    } catch {
      setPositions([]);
    }
  };

  const play = () => {
    const pts = posRef.current;
    if (!pts.length) return;
    setPlaying(true);
    intervalRef.current = setInterval(() => {
      setCurrentIdx(prev => {
        const next = prev + 1;
        if (next >= posRef.current.length) {
          setPlaying(false);
          if (intervalRef.current) clearInterval(intervalRef.current);
          return prev;
        }
        updateMapAt(next);
        return next;
      });
    }, Math.max(50, 200 / speed));
  };

  const stop = () => {
    setPlaying(false);
    setCurrentIdx(0);
    updateMapAt(0);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  const fmtTime = (ts: string) => {
    try { return parseTimestamp(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); } catch { return ts; }
  };

  return (
    <div className="tactical-dark border border-surface-raised rounded p-3 w-56 text-xs space-y-2 shadow-lg">
      <div className="text-brand-400 font-bold uppercase tracking-wider text-[10px]">GPS Replay</div>
      <select value={selectedUnit ?? ''} onChange={e => {
        const id = Number(e.target.value);
        setSelectedUnit(id);
        if (id) loadPositions(id, hoursBack);
      }} className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-1 py-0.5 text-[10px]">
        <option value="">Select unit…</option>
        {units.map(u => (
          <option key={u.unit_id} value={u.unit_id}>
            {u.call_sign}{u.officer_name ? ` — ${u.officer_name}` : ''}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-1">
        <span className="text-rmpg-400 text-[10px]">Last</span>
        <select value={hoursBack} onChange={e => {
          const h = Number(e.target.value);
          setHoursBack(h);
          if (selectedUnit) loadPositions(selectedUnit, h);
        }} className="bg-surface-base border border-surface-raised text-rmpg-200 rounded px-1 py-0.5 text-[10px]">
          {HOURS_OPTIONS.map(h => <option key={h} value={h}>{h}h</option>)}
        </select>
        <select value={speed} onChange={e => setSpeed(Number(e.target.value))}
          className="ml-auto bg-surface-base border border-surface-raised text-rmpg-200 rounded px-1 py-0.5 text-[10px]">
          {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
        </select>
      </div>
      {positions.length > 0 && (
        <input type="range" min="0" max={positions.length - 1} value={currentIdx}
          onChange={e => { const n = Number(e.target.value); setCurrentIdx(n); updateMapAt(n); }}
          className="w-full" />
      )}
      {positions.length > 0 && (
        <div className="text-rmpg-300 text-[10px] text-center">
          {fmtTime(positions[Math.min(currentIdx, positions.length - 1)].timestamp)}
          {' '}({currentIdx + 1}/{positions.length})
        </div>
      )}
      {positions.length === 0 && selectedUnit && (
        <div className="text-rmpg-400 text-[10px] text-center py-1">No GPS data for selected unit</div>
      )}
      <label className="flex items-center gap-1 cursor-pointer">
        <input type="checkbox" checked={autoFollow} onChange={e => setAutoFollow(e.target.checked)} />
        <span className="text-rmpg-300 text-[10px]">Auto-follow</span>
      </label>
      <div className="flex gap-2">
        <button onClick={playing ? stop : play} disabled={!positions.length}
          className="flex-1 bg-brand-500 text-black font-bold py-1 rounded text-[10px] disabled:opacity-50">
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={stop}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Stop
        </button>
        <button onClick={onClose}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Done
        </button>
      </div>
    </div>
  );
}
