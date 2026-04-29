import { useEffect, useMemo, useRef, useState } from 'react';
import { History, Calendar, Loader2, MapPin, AlertTriangle, Database, Filter } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { loadGoogleMaps, DARK_MAP_STYLE, resolveGoogleMapsApiKey } from '../utils/googleMapsLoader';

// Historical Traccar tracks viewer.
//
// Pulls positions from /api/traccar/historical/positions and renders them as
// a polyline + clickable markers on a Google Maps surface. Click a marker to
// open the inspector with all columns from that row (the full Traccar payload
// is preserved in raw_json — the inspector pretty-prints it).
//
// Uses the project's shared googleMapsLoader so styling / offline-tile fallback
// matches the main /map surface. CLAUDE.md gotcha: do not introduce a parallel
// OpenLayers map surface — Google Maps is the single source.

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
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);

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
        const apiKey = await resolveGoogleMapsApiKey();
        if (!apiKey) { if (!cancelled) setError('Google Maps API key not configured'); return; }
        await loadGoogleMaps(apiKey);
        if (cancelled || !containerRef.current) return;
        const map = new google.maps.Map(containerRef.current, {
          center: { lat: 40.76, lng: -111.89 },
          zoom: 11,
          styles: DARK_MAP_STYLE,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        mapRef.current = map;
        setMapReady(true);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Map load failed');
      }
    })();
    return () => { cancelled = true; };
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
    polylineRef.current?.setMap(null);
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    if (pts.length === 0) return;

    const path = pts.map(p => ({ lat: p.latitude, lng: p.longitude }));
    polylineRef.current = new google.maps.Polyline({
      path,
      geodesic: false,
      strokeColor: '#d4a017',
      strokeOpacity: 0.8,
      strokeWeight: 3,
      map,
    });

    // Down-sample markers if more than 500 points to keep DOM/perf reasonable.
    const stride = Math.max(1, Math.ceil(pts.length / 500));
    for (let i = 0; i < pts.length; i += stride) {
      const p = pts[i];
      const mk = new google.maps.Marker({
        position: { lat: p.latitude, lng: p.longitude },
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 4,
          fillColor: i === 0 ? '#22c55e' : i >= pts.length - stride ? '#ef4444' : '#d4a017',
          fillOpacity: 0.95,
          strokeWeight: 1,
          strokeColor: '#000',
        },
        title: `${fmtDate(p.fix_time)} • ${p.speed != null ? `${(p.speed * KNOTS_TO_MPH).toFixed(1)} mph` : ''}`,
      });
      mk.addListener('click', () => setSelected(p));
      markersRef.current.push(mk);
    }

    // Fit bounds.
    const bounds = new google.maps.LatLngBounds();
    pts.forEach(p => bounds.extend({ lat: p.latitude, lng: p.longitude }));
    map.fitBounds(bounds);
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
