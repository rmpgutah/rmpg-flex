import { useEffect, useMemo, useRef, useState } from 'react';
import { History, Calendar, Loader2, MapPin, AlertTriangle, Database, Filter } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { createMapboxMap, addMapboxTrail, removeMapboxTrail, injectMapboxStyles } from '../utils/mapboxLoader';
import { getMapboxToken } from '../utils/mapboxApiKey';

// Historical Traccar tracks viewer.
//
// Pulls positions from /api/traccar/historical/positions and renders them as
// a polyline + clickable markers on a Mapbox GL surface. Click a marker to
// open the inspector with all columns from that row (the full Traccar payload
// is preserved in raw_json — the inspector pretty-prints it).
//
// Uses the project's shared mapboxLoader so styling / offline-tile fallback
// matches the main /map surface. CLAUDE.md gotcha: do not introduce a parallel
// OpenLayers map surface — Mapbox is the primary provider.

interface Device {
  id: number;
  traccar_id: number;
  name: string | null;
  unique_id: string | null;
  vehicle_id: number | null;
  fleet_unit_number: string | null;
}

interface Position {
  id: number;
  traccar_id: number;
  traccar_device_id: number;
  vehicle_id: number | null;
  fix_time: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  speed: number | null;
  course: number | null;
  address: string | null;
  accuracy: number | null;
  attributes_json: string | null;
}

const KNOTS_TO_MPH = 1.15078;

// Speed-bucket gradient — cool→hot like dispatch fleet replays. Buckets are
// inclusive-upper (a point at 25 mph falls into the second bucket). The 999
// sentinel for the last bucket is "anything above 80 mph".
const SPEED_BUCKETS: { max: number; color: string; label: string }[] = [
  { max: 5,   color: '#3b82f6', label: '0–5'    },   // stationary / very slow — blue
  { max: 25,  color: '#06b6d4', label: '5–25'   },   // residential — cyan
  { max: 45,  color: '#10b981', label: '25–45'  },   // arterial — green
  { max: 65,  color: '#facc15', label: '45–65'  },   // highway — yellow
  { max: 80,  color: '#f97316', label: '65–80'  },   // fast — orange
  { max: 999, color: '#ef4444', label: '80+'    },   // pursuit speed — red
];

interface StopRun {
  lat: number;
  lng: number;
  fromIso: string;
  toIso: string;
  durationSec: number;
}

/** Detect runs where speed < minMph for ≥minSec. Centroid lat/lng is the run mean. */
function detectStops(pts: Position[], minMph: number, minSec: number): StopRun[] {
  const stops: StopRun[] = [];
  let runStart = -1;
  for (let i = 0; i <= pts.length; i++) {
    const inStop = i < pts.length && (pts[i].speed ?? 0) * KNOTS_TO_MPH < minMph;
    if (inStop && runStart < 0) runStart = i;
    if ((!inStop || i === pts.length) && runStart >= 0) {
      const endExclusive = i;
      const seg = pts.slice(runStart, endExclusive);
      const dur = seg.length >= 2
        ? (new Date(seg[seg.length - 1].fix_time).getTime() - new Date(seg[0].fix_time).getTime()) / 1000
        : 0;
      if (dur >= minSec) {
        const lat = seg.reduce((a, p) => a + p.latitude, 0) / seg.length;
        const lng = seg.reduce((a, p) => a + p.longitude, 0) / seg.length;
        stops.push({ lat, lng, fromIso: seg[0].fix_time, toIso: seg[seg.length - 1].fix_time, durationSec: dur });
      }
      runStart = -1;
    }
  }
  return stops;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${Math.round(sec % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function HistoricalTracksPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); return d.toISOString().slice(0, 16);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [selected, setSelected] = useState<Position | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  // Track IDs for speed-bucketed trail layers so we can remove them on redraw.
  const trailIdsRef = useRef<string[]>([]);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const stopMarkersRef = useRef<mapboxgl.Marker[]>([]);

  // Fetch device list once.
  useEffect(() => {
    apiFetch<Device[]>('/api/traccar/historical/devices').then(d => {
      setDevices(d);
      if (d.length > 0 && deviceId === null) setDeviceId(d[0].traccar_id);
    }).catch(err => setError(err instanceof Error ? err.message : 'Failed to load devices'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getMapboxToken();
        if (!token) { if (!cancelled) setError('Mapbox access token not configured'); return; }
        if (cancelled || !containerRef.current) return;
        injectMapboxStyles();
        mapboxgl.accessToken = token;
        const map = createMapboxMap({
          container: containerRef.current,
          center: [-111.89, 40.76],
          zoom: 11,
          accessToken: token,
        });
        mapRef.current = map;
        map.on('load', () => { if (!cancelled) setMapReady(true); });
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Map load failed');
      }
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  const loadTracks = async () => {
    if (!deviceId) { setError('Select a device first'); return; }
    setError(null); setLoading(true);
    try {
      const params = new URLSearchParams({
        deviceId: String(deviceId),
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        limit: '50000',
      });
      const data = await apiFetch<{ count: number; positions: Position[] }>(`/api/traccar/historical/positions?${params}`);
      setPositions(data.positions);
      setSelected(null);
      drawTracks(data.positions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally { setLoading(false); }
  };

  const drawTracks = (pts: Position[]) => {
    const map = mapRef.current; if (!map) return;
    // Clean up previous layers and markers
    trailIdsRef.current.forEach(id => removeMapboxTrail(map, id));
    trailIdsRef.current = [];
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    stopMarkersRef.current.forEach(m => m.remove());
    stopMarkersRef.current = [];

    if (pts.length === 0) return;

    // ── Speed-bucketed polyline rendering ──
    // Each segment (pair of consecutive points) is bucketed by start-point
    // speed. One trail per run of consecutive same-bucket segments.
    const buckets = SPEED_BUCKETS;
    const bucketFor = (mph: number) => {
      for (let i = 0; i < buckets.length; i++) if (mph <= buckets[i].max) return i;
      return buckets.length - 1;
    };

    let runStart = 0;
    let runBucket = bucketFor((pts[0].speed ?? 0) * KNOTS_TO_MPH);
    let runCounter = 0;
    const flushRun = (endIdx: number) => {
      const slice = pts.slice(runStart, endIdx + 1);
      if (slice.length < 2) return;
      const coords: [number, number][] = slice.map(p => [p.longitude, p.latitude]);
      const color = buckets[runBucket].color;
      const trailId = `ht-trail-${runCounter++}`;
      addMapboxTrail(map, trailId, coords, color, 4);
      trailIdsRef.current.push(trailId);
    };

    for (let i = 1; i < pts.length; i++) {
      const b = bucketFor((pts[i].speed ?? 0) * KNOTS_TO_MPH);
      if (b !== runBucket) {
        flushRun(i);
        runStart = i;
        runBucket = b;
      }
    }
    flushRun(pts.length - 1);

    // ── Direction-arrow overlay (symbol layer along the full path) ──
    const arrowSourceId = 'ht-arrow-source';
    const arrowLayerId = 'ht-arrow-layer';
    // Clean up previous arrow layer if it exists
    if (map.getLayer(arrowLayerId)) map.removeLayer(arrowLayerId);
    if (map.getSource(arrowSourceId)) map.removeSource(arrowSourceId);
    trailIdsRef.current.push(arrowSourceId); // track for cleanup (removeMapboxTrail handles both)

    const fullCoords: [number, number][] = pts.map(p => [p.longitude, p.latitude]);
    map.addSource(arrowSourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: fullCoords },
        properties: {},
      },
    });

    // Load a triangle arrow image for direction indicators
    if (!map.hasImage('ht-arrow')) {
      const size = 16;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#0a0a0a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(size / 2, 0);
        ctx.lineTo(size, size);
        ctx.lineTo(0, size);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        map.addImage('ht-arrow', { width: size, height: size, data: new Uint8Array(ctx.getImageData(0, 0, size, size).data) });
      }
    }

    map.addLayer({
      id: arrowLayerId,
      type: 'symbol',
      source: arrowSourceId,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 110,
        'icon-image': 'ht-arrow',
        'icon-size': 0.6,
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
      },
    });
    trailIdsRef.current.push(arrowLayerId);

    // ── Click-able point dots (down-sampled to ≤500) ──
    const stride = Math.max(1, Math.ceil(pts.length / 500));
    for (let i = 0; i < pts.length; i += stride) {
      const p = pts[i];
      const mph = (p.speed ?? 0) * KNOTS_TO_MPH;
      const color = buckets[bucketFor(mph)].color;
      const el = document.createElement('div');
      el.style.cssText = `width:6px;height:6px;border-radius:50%;background:${color};opacity:0.7;border:0.5px solid #000;cursor:pointer;`;
      el.title = `${fmtDate(p.fix_time)} • ${mph.toFixed(1)} mph`;
      const mk = new mapboxgl.Marker({ element: el })
        .setLngLat([p.longitude, p.latitude])
        .addTo(map);
      el.addEventListener('click', () => setSelected(p));
      markersRef.current.push(mk);
    }

    // ── Idle/stop detection (run of speed < 1 mph spanning ≥120s) ──
    const stops = detectStops(pts, /*minMph*/ 1, /*minSec*/ 120);
    stops.forEach((s, idx) => {
      const el = document.createElement('div');
      el.style.cssText = `
        width:18px;height:18px;border-radius:50%;
        background:#a855f7;opacity:0.85;border:2px solid #fff;
        display:flex;align-items:center;justify-content:center;
        font-size:10px;font-weight:700;color:#fff;cursor:pointer;
        font-family:system-ui,sans-serif;
      `;
      el.textContent = 'P';
      el.title = `Stop ${idx + 1} • ${formatDuration(s.durationSec)} • ${fmtDate(s.fromIso)} → ${fmtDate(s.toIso)}`;
      const mk = new mapboxgl.Marker({ element: el })
        .setLngLat([s.lng, s.lat])
        .addTo(map);
      stopMarkersRef.current.push(mk);
    });

    // ── Start (green flag) + End (red checkered) markers ──
    const start = pts[0];
    const end = pts[pts.length - 1];

    const makeEndpointMarker = (lat: number, lng: number, bgColor: string, label: string, title: string) => {
      const el = document.createElement('div');
      el.style.cssText = `
        width:22px;height:22px;border-radius:50%;
        background:${bgColor};border:2px solid #0a0a0a;
        display:flex;align-items:center;justify-content:center;
        font-size:11px;font-weight:700;color:#fff;cursor:pointer;
        font-family:system-ui,sans-serif;
        box-shadow:0 0 6px ${bgColor}80;
      `;
      el.textContent = label;
      el.title = title;
      return new mapboxgl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);
    };

    const startMk = makeEndpointMarker(start.latitude, start.longitude, '#22c55e', 'S', `Start • ${fmtDate(start.fix_time)}`);
    const endMk = makeEndpointMarker(end.latitude, end.longitude, '#ef4444', 'E', `End • ${fmtDate(end.fix_time)}`);
    markersRef.current.push(startMk, endMk);

    // ── Fit bounds with padding so legend doesn't overlap edge points ──
    const bounds = new mapboxgl.LngLatBounds();
    pts.forEach(p => bounds.extend([p.longitude, p.latitude]));
    map.fitBounds(bounds, { padding: 60 });
  };

  const stats = useMemo(() => {
    if (positions.length === 0) return null;
    const speedMph = positions.map(p => (p.speed ?? 0) * KNOTS_TO_MPH);
    return {
      count: positions.length,
      maxSpeed: Math.max(...speedMph),
      avgSpeed: speedMph.reduce((a, b) => a + b, 0) / speedMph.length,
      span: `${fmtDate(positions[0].fix_time)} → ${fmtDate(positions[positions.length - 1].fix_time)}`,
    };
  }, [positions]);

  const selectedAttrs = useMemo(() => {
    if (!selected?.attributes_json) return null;
    try { return JSON.parse(selected.attributes_json) as Record<string, unknown>; } catch { return null; }
  }, [selected]);

  return (
    <div className="p-3 space-y-3 h-[calc(100vh-140px)] flex flex-col min-h-[600px]">
      <PanelTitleBar title="HISTORICAL GPS TRACKS" icon={History} />

      <div className="bg-[#141414] border border-[#222] rounded-[2px] p-3 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-1"><Database className="w-3 h-3 inline mr-1" />Device</label>
          <select value={deviceId ?? ''} onChange={e => setDeviceId(parseInt(e.target.value, 10) || null)}
            className="bg-[#0a0a0a] border border-[#222] text-xs text-white px-2 py-1.5 rounded-sm focus:outline-none focus:border-[#d4a017] min-w-[200px]">
            <option value="">— select device —</option>
            {devices.map(d => (
              <option key={d.traccar_id} value={d.traccar_id}>
                {d.name || d.unique_id || `Device ${d.traccar_id}`}{d.fleet_unit_number ? ` → ${d.fleet_unit_number}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-1"><Calendar className="w-3 h-3 inline mr-1" />From</label>
          <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)}
            className="bg-[#0a0a0a] border border-[#222] text-xs text-white px-2 py-1.5 rounded-sm focus:outline-none focus:border-[#d4a017]" />
        </div>
        <div>
          <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-1"><Calendar className="w-3 h-3 inline mr-1" />To</label>
          <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)}
            className="bg-[#0a0a0a] border border-[#222] text-xs text-white px-2 py-1.5 rounded-sm focus:outline-none focus:border-[#d4a017]" />
        </div>
        <button type="button" onClick={loadTracks} disabled={loading || !deviceId || !mapReady} className="btn-primary inline-flex items-center gap-1 disabled:opacity-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />}
          Load tracks
        </button>
        {stats && (
          <div className="ml-auto text-[10px] text-rmpg-300 space-y-0.5">
            <div><span className="text-rmpg-500">Points:</span> <span className="font-mono">{stats.count.toLocaleString()}</span></div>
            <div><span className="text-rmpg-500">Max:</span> <span className="font-mono">{stats.maxSpeed.toFixed(1)} mph</span> · <span className="text-rmpg-500">Avg:</span> <span className="font-mono">{stats.avgSpeed.toFixed(1)} mph</span></div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-700/40 text-red-200 text-[11px] px-3 py-1.5 rounded-sm flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5" /> <div>{error}</div>
          <button type="button" onClick={() => setError(null)} className="ml-auto text-red-300 hover:text-white">×</button>
        </div>
      )}

      <div className="flex-1 flex gap-3 min-h-0">
        <div className="flex-1 bg-[#050505] border border-[#222] rounded-[2px] relative">
          <div ref={containerRef} className="absolute inset-0" />
          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center text-rmpg-500 text-xs">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading map…
            </div>
          )}
          {positions.length > 0 && <SpeedLegend />}
        </div>

        <div className="w-[300px] bg-[#0d0d0d] border border-[#222] rounded-[2px] p-3 overflow-y-auto">
          <div className="text-[9px] uppercase tracking-wider text-[#d4a017] font-semibold mb-2 flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Selected position
          </div>
          {!selected ? (
            <div className="text-[10px] text-rmpg-500 italic">Click any point on the map to inspect every column from that record.</div>
          ) : (
            <div className="space-y-2 text-[11px]">
              <Field label="Fix time" value={fmtDate(selected.fix_time)} />
              <Field label="Lat / Lng" value={`${selected.latitude.toFixed(6)}, ${selected.longitude.toFixed(6)}`} mono />
              <Field label="Altitude" value={selected.altitude != null ? `${selected.altitude.toFixed(1)} m` : '—'} mono />
              <Field label="Speed" value={selected.speed != null ? `${(selected.speed * KNOTS_TO_MPH).toFixed(1)} mph` : '—'} mono />
              <Field label="Course" value={selected.course != null ? `${selected.course.toFixed(0)}°` : '—'} mono />
              <Field label="Accuracy" value={selected.accuracy != null ? `${selected.accuracy.toFixed(1)} m` : '—'} mono />
              <Field label="Address" value={selected.address ?? '—'} />
              <Field label="Traccar ID" value={String(selected.traccar_id)} mono />
              <Field label="Device ID" value={String(selected.traccar_device_id)} mono />
              <Field label="Vehicle" value={selected.vehicle_id != null ? String(selected.vehicle_id) : 'unlinked'} mono />

              {selectedAttrs && Object.keys(selectedAttrs).length > 0 && (
                <div className="pt-2 border-t border-[#222]">
                  <div className="text-[9px] uppercase tracking-wider text-[#d4a017] mb-1">Attributes</div>
                  <div className="space-y-0.5">
                    {Object.entries(selectedAttrs).map(([k, v]) => (
                      <div key={k} className="flex items-start justify-between gap-2 text-[10px]">
                        <span className="text-rmpg-500 font-mono">{k}</span>
                        <span className="text-rmpg-200 text-right break-all max-w-[60%]">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-[9px] uppercase tracking-wider text-rmpg-500">{label}</span>
      <span className={`text-rmpg-200 text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function SpeedLegend() {
  return (
    <div className="absolute bottom-3 left-3 z-10 bg-[#0a0a0a]/90 border border-[#2b2b2b] rounded-[2px] px-3 py-2 backdrop-blur-sm shadow-lg">
      <div className="text-[9px] uppercase tracking-wider text-[#d4a017] font-semibold mb-1.5">Speed (mph)</div>
      <div className="flex items-center gap-1">
        {SPEED_BUCKETS.map(b => (
          <div key={b.label} className="flex flex-col items-center">
            <div className="w-7 h-2" style={{ backgroundColor: b.color }} />
            <span className="text-[8px] text-rmpg-400 mt-0.5 font-mono">{b.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 pt-1.5 border-t border-[#2b2b2b] flex items-center gap-3 text-[8px] text-rmpg-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#22c55e]" />Start</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#ef4444]" />End</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#a855f7]" />Stop ≥2m</span>
      </div>
    </div>
  );
}
