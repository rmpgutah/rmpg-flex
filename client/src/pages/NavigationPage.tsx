// ============================================================
// RMPG Flex — Navigation / Drive Screen
// ============================================================
// A full-screen in-vehicle GPS + navigation view (the "MY GPS" HUD promoted to
// its own page). A follow-me Mapbox map (night/drive style, pitched, recenters
// and rotates to the device heading) underneath large movement instruments:
//   • Speedometer (mph) + heading compass rose with cardinal
//   • Live position / accuracy / fix-source (GPS·WiFi·IP) / link / last-sync
//   • Session travel stats (distance, duration, max speed)
//   • Turn-by-turn directions to the unit's assigned call (via useMapRouting):
//     next-maneuver banner with directional arrow, distance to the turn, live
//     remaining ETA + distance, progress bar, congestion + off-route alerts.
//
// All GPS state comes from useGpsTracking; all routing math from useMapRouting.
// EVERYTHING degrades: if Mapbox can't load, the instruments still render over a
// dark backdrop, so the screen is never blank in a moving vehicle.
// ============================================================

import { useRef, useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Navigation2, Satellite, Wifi, Globe, X, AlertTriangle, MapPin, Gauge,
  CornerUpLeft, CornerUpRight, ArrowUp, ArrowUpLeft, ArrowUpRight,
  Flag, Merge, RotateCw, RotateCcw, Clock, Box, Crosshair, type LucideIcon,
} from 'lucide-react';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { useMapRouting } from '../hooks/useMapRouting';
import { useMap3D } from './map/hooks/useMap3D';
import { mapboxgl, initMapbox, MAPBOX_STYLE_NIGHT } from '../utils/mapboxLoader';
import { getMapboxAccessToken } from '../utils/mapboxApiKey';
import { apiFetch } from '../hooks/useApi';
import { compassCardinal } from '../utils/locationImagery';

// ─── Helpers ────────────────────────────────────────────────

function maneuverIcon(type: string, modifier?: string): LucideIcon {
  if (type === 'arrive') return Flag;
  if (type === 'depart') return Navigation2;
  if (type === 'merge') return Merge;
  if (type === 'roundabout' || type === 'rotary') return RotateCw;
  const m = (modifier || '').toLowerCase();
  if (m.includes('uturn')) return RotateCcw;
  if (m === 'left' || m === 'sharp left') return CornerUpLeft;
  if (m === 'right' || m === 'sharp right') return CornerUpRight;
  if (m === 'slight left') return ArrowUpLeft;
  if (m === 'slight right') return ArrowUpRight;
  return ArrowUp;
}

/** Pick the maneuver the unit is currently approaching from route progress. */
function pickCurrentStep(steps: { instruction: string; distanceMeters: number; distanceText: string; maneuverType: string; modifier?: string }[] | undefined, fraction: number, totalMeters: number) {
  if (!steps || steps.length === 0) return null;
  const doneMeters = Math.max(0, Math.min(1, fraction)) * totalMeters;
  let acc = 0;
  for (let i = 0; i < steps.length; i++) {
    acc += steps[i].distanceMeters;
    if (acc >= doneMeters) return steps[i];
  }
  return steps[steps.length - 1];
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

const SOURCE_META: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  gps: { icon: Satellite, color: '#22c55e', label: 'GPS' },
  wifi: { icon: Wifi, color: '#d4a017', label: 'WiFi' },
  ip: { icon: Globe, color: '#ef4444', label: 'IP' },
  unknown: { icon: Globe, color: '#666', label: '—' },
};

const PRIO_COLOR: Record<string, string> = { P1: '#ef4444', P2: '#f59e0b', P3: '#d4a017', P4: '#888888' };

export default function NavigationPage() {
  const navigate = useNavigate();
  const gps = useGpsTracking({ capture: true });

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const { activeRoute, routeProgress, offRoute, showRoute, updateOrigin } = useMapRouting({
    map: mapReady ? mapInstanceRef.current : null,
  });

  // ── 3D corner inset ("chase-cam" perspective map) ──
  const insetContainerRef = useRef<HTMLDivElement | null>(null);
  const insetMapRef = useRef<any>(null);
  const insetMarkerRef = useRef<any>(null);
  const [insetReady, setInsetReady] = useState(false);

  // 3D terrain + sky + extruded buildings on BOTH the main drive map and the
  // corner inset (reuses the map page's 3D hook). The main view becomes a true
  // pitched 3D scene; the inset is a tighter, steeper chase view of the block.
  useMap3D({ map: mapReady ? mapInstanceRef.current : null, enabled: true, mapLoaded: mapReady, isLight: false });
  useMap3D({ map: insetReady ? insetMapRef.current : null, enabled: true, mapLoaded: insetReady, isLight: false });

  // Movement accumulators (session distance / duration / max speed).
  const startRef = useRef<number | null>(null);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const distanceRef = useRef(0);
  const [maxMph, setMaxMph] = useState(0);
  const speedHistRef = useRef<number[]>([]); // rolling mph samples for the sparkline
  const [, force] = useState(0);

  const dir = gps.headingSmoothed ?? gps.course ?? gps.heading;
  const mph = gps.speed != null ? Math.round(gps.speed * 2.237) : null;
  const hasFix = gps.latitude != null && gps.longitude != null;
  const src = SOURCE_META[gps.positionSource] || SOURCE_META.unknown;

  // ── One-time Mapbox init (defensive — degrade to instruments-only) ──
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getMapboxAccessToken();
        if (cancelled) return;
        if (!token) { setMapError('Mapbox token unavailable'); return; }
        initMapbox(token);
        const map = new mapboxgl.Map({
          container: mapContainerRef.current!,
          style: MAPBOX_STYLE_NIGHT,
          center: [gps.longitude ?? -111.891, gps.latitude ?? 40.7608],
          zoom: 16.5,
          pitch: 55,
          bearing: 0,
          attributionControl: false,
          interactive: true,
        });
        map.on('load', () => {
          if (cancelled) { map.remove(); return; }
          mapInstanceRef.current = map;
          markerRef.current = new mapboxgl.Marker({ color: '#d4a017' })
            .setLngLat([gps.longitude ?? -111.891, gps.latitude ?? 40.7608])
            .addTo(map);
          setMapReady(true);
        });
        map.on('error', () => { /* tile/style hiccups are non-fatal */ });
      } catch (e) {
        if (!cancelled) setMapError((e as Error)?.message || 'Map failed to initialize');
      }
    })();
    return () => {
      cancelled = true;
      const m = mapInstanceRef.current;
      if (m) { try { m.remove(); } catch { /* already gone */ } mapInstanceRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Corner 3D inset: a small, non-interactive steep-pitch chase map. Created
  // lazily once the main map is up AND we have a fix, so two GL contexts don't
  // spin up at once on an in-vehicle Toughbook. Degrades silently — the main
  // view + instruments are unaffected if it can't init. ──
  useEffect(() => {
    if (!mapReady || !insetContainerRef.current || insetMapRef.current) return;
    if (gps.latitude == null || gps.longitude == null) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getMapboxAccessToken();
        if (cancelled || !token) return;
        const m = new mapboxgl.Map({
          container: insetContainerRef.current!,
          style: MAPBOX_STYLE_NIGHT,
          center: [gps.longitude!, gps.latitude!],
          zoom: 17.4, pitch: 70, bearing: dir ?? 0,
          attributionControl: false, interactive: false,
        });
        m.on('load', () => {
          if (cancelled) { m.remove(); return; }
          insetMapRef.current = m;
          insetMarkerRef.current = new mapboxgl.Marker({ color: '#d4a017' })
            .setLngLat([gps.longitude!, gps.latitude!]).addTo(m);
          setInsetReady(true);
        });
        m.on('error', () => { /* tile/style hiccups are non-fatal */ });
      } catch { /* inset is optional */ }
    })();
    return () => {
      cancelled = true;
      const m = insetMapRef.current;
      if (m) { try { m.remove(); } catch { /* gone */ } insetMapRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, gps.latitude != null]);

  // ── Follow the device: recenter + rotate to heading, update marker + route ──
  useEffect(() => {
    if (gps.latitude == null || gps.longitude == null) return;
    // Movement accumulators.
    if (startRef.current == null) startRef.current = Date.now();
    const prev = lastPosRef.current;
    if (prev) {
      const d = haversineMeters(prev.lat, prev.lng, gps.latitude, gps.longitude);
      if (d > 1 && d < 5000) distanceRef.current += d; // ignore jitter + teleports
    }
    lastPosRef.current = { lat: gps.latitude, lng: gps.longitude };
    if (mph != null && mph > maxMph) setMaxMph(mph);
    // Feed the rolling speed sparkline (last ~60 samples).
    if (mph != null) { const h = speedHistRef.current; h.push(mph); if (h.length > 60) h.shift(); }

    const map = mapInstanceRef.current;
    if (map && mapReady) {
      markerRef.current?.setLngLat([gps.longitude, gps.latitude]);
      map.easeTo({
        center: [gps.longitude, gps.latitude],
        bearing: dir ?? map.getBearing(),
        duration: 800,
        essential: true,
      });
      // Recompute route progress / off-route from the live position.
      updateOrigin(gps.latitude, gps.longitude);
    }
    // Mirror onto the corner chase inset (steeper + tighter, snappier follow).
    const inset = insetMapRef.current;
    if (inset && insetReady) {
      insetMarkerRef.current?.setLngLat([gps.longitude, gps.latitude]);
      inset.easeTo({
        center: [gps.longitude, gps.latitude],
        bearing: dir ?? inset.getBearing(),
        duration: 600,
        essential: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps.latitude, gps.longitude, dir, mapReady, insetReady]);

  // ── Auto-route to the unit's assigned call, once the map is ready ──
  const routedCallRef = useRef<number | null>(null);
  useEffect(() => {
    if (!mapReady || gps.latitude == null || gps.longitude == null) return;
    let cancelled = false;
    (async () => {
      try {
        const unit = await apiFetch<{ id: number; call_sign: string; current_call_id: number | null } | null>('/dispatch/gps/my-unit').catch(() => null);
        if (cancelled || !unit?.current_call_id) return;
        if (routedCallRef.current === unit.current_call_id) return; // already routed
        const call = await apiFetch<{ call_number: string; latitude: number | null; longitude: number | null }>(`/dispatch/calls/${unit.current_call_id}`).catch(() => null);
        if (cancelled || !call || call.latitude == null || call.longitude == null) return;
        routedCallRef.current = unit.current_call_id;
        await showRoute(unit.call_sign, call.call_number, gps.latitude!, gps.longitude!, call.latitude, call.longitude);
      } catch { /* best-effort — drive screen still follows GPS without a route */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // Tick once a second so session-duration + the clock re-render even when parked.
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // Nearby active calls — situational awareness while driving. Ranks the active
  // board by straight-line distance from the live position; refreshes every 20s.
  const [nearbyCalls, setNearbyCalls] = useState<{ call_number: string; incident_type: string; priority: string; distMi: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (gps.latitude == null || gps.longitude == null) return;
      try {
        const res = await apiFetch<any>('/dispatch/calls?limit=100');
        const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        const near = rows
          .filter((c: any) => c.latitude != null && c.longitude != null)
          .map((c: any) => ({
            call_number: c.call_number || '', incident_type: c.incident_type || 'call', priority: c.priority || 'P3',
            distMi: haversineMeters(gps.latitude!, gps.longitude!, Number(c.latitude), Number(c.longitude)) / 1609.34,
          }))
          .sort((a: { distMi: number }, b: { distMi: number }) => a.distMi - b.distMi)
          .slice(0, 3);
        if (!cancelled) setNearbyCalls(near);
      } catch { /* best-effort — situational extra, never blocks the drive view */ }
    };
    run();
    const iv = setInterval(run, 20000);
    return () => { cancelled = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps.latitude != null]);

  const sessionMs = startRef.current ? Date.now() - startRef.current : 0;
  const distanceMi = distanceRef.current / 1609.34;
  const avgMph = sessionMs > 60000 ? distanceMi / (sessionMs / 3600000) : 0;
  const clock = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const spark = speedHistRef.current;
  const sparkMax = Math.max(60, maxMph, ...spark);

  const step = useMemo(
    () => pickCurrentStep(activeRoute?.steps, routeProgress?.fraction ?? 0, activeRoute?.distanceMeters ?? 0),
    [activeRoute, routeProgress],
  );
  const StepIcon = step ? maneuverIcon(step.maneuverType, step.modifier) : ArrowUp;

  // Upcoming maneuvers (the next few after the current one) + a wall-clock
  // arrival estimate, for a richer directions panel.
  const { upcomingSteps, arrivalClock } = useMemo(() => {
    const steps = activeRoute?.steps ?? [];
    const doneMeters = Math.max(0, Math.min(1, routeProgress?.fraction ?? 0)) * (activeRoute?.distanceMeters ?? 0);
    let acc = 0, idx = 0;
    for (let i = 0; i < steps.length; i++) { acc += steps[i].distanceMeters; idx = i; if (acc >= doneMeters) break; }
    const upcoming = steps.slice(idx + 1, idx + 4);
    // Arrival = now + remaining ETA, parsed loosely from the formatted string
    // ("Xh Ym" / "X min" / "M:SS").
    const etaStr = routeProgress?.remainingEta ?? activeRoute?.eta ?? '';
    let mins = 0;
    const hM = etaStr.match(/(\d+)\s*h/); const mM = etaStr.match(/(\d+)\s*m(?:in)?/);
    if (hM) mins += parseInt(hM[1], 10) * 60;
    if (mM) mins += parseInt(mM[1], 10);
    if (!hM && !mM) { const cM = etaStr.match(/^(\d+):(\d{2})$/); if (cM) mins = parseInt(cM[1], 10) + (parseInt(cM[2], 10) >= 30 ? 1 : 0); }
    const arrivalClock = mins > 0 ? new Date(Date.now() + mins * 60000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;
    return { upcomingSteps: upcoming, arrivalClock };
  }, [activeRoute, routeProgress]);

  return (
    <div className="relative w-full h-full bg-surface-deep overflow-hidden" style={{ minHeight: 0 }}>
      {/* Map (or dark backdrop on failure) */}
      <div ref={mapContainerRef} className="absolute inset-0" />
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center text-rmpg-600 text-xs">
          Map unavailable ({mapError}) — instruments live below
        </div>
      )}

      {/* Header bar */}
      <div className="absolute top-0 inset-x-0 flex items-center gap-2 px-3 py-2 bg-surface-deep/85 backdrop-blur-md border-b border-rmpg-700 z-20">
        <Navigation2 className="w-4 h-4 text-brand-400" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-rmpg-100 flex-1">Navigation</span>
        <span className="font-mono text-[11px] text-rmpg-300 tabular-nums">{clock}</span>
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase" style={{ color: src.color }}>
          <src.icon className="w-3.5 h-3.5" /> {src.label}
        </span>
        {gps.connectionType && gps.connectionType !== 'unknown' && (
          <span className="text-[9px] uppercase text-rmpg-500">{gps.connectionType}</span>
        )}
        <button
          onClick={() => navigate('/map')}
          className="toolbar-btn flex items-center gap-1 text-[10px] uppercase text-rmpg-300 hover:text-white"
          title="Back to map"
          aria-label="Back to map"
        >
          <X className="w-4 h-4" /> Close
        </button>
      </div>

      {/* Turn-by-turn banner (top) */}
      {activeRoute && step && (
        <div className="absolute top-12 inset-x-2 z-20 panel-beveled bg-surface-deep/92 backdrop-blur-md border border-rmpg-600 shadow-xl" style={{ borderRadius: 2 }}>
          <div className="flex items-center gap-3 px-3 py-2">
            <StepIcon className="w-9 h-9 text-brand-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-rmpg-100 text-[15px] font-semibold leading-tight truncate" title={step.instruction}>{step.instruction}</div>
              <div className="text-[10px] text-rmpg-500 uppercase">to {activeRoute.callNumber}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono font-bold text-brand-300 text-[17px] leading-none">{routeProgress ? routeProgress.remainingEta : activeRoute.eta}</div>
              <div className="font-mono text-[10px] text-rmpg-400">{routeProgress ? routeProgress.remainingDistance : activeRoute.distance}</div>
              {arrivalClock && (
                <div className="font-mono text-[9px] text-rmpg-500 flex items-center justify-end gap-0.5">
                  <Clock className="w-2.5 h-2.5" />{arrivalClock}
                </div>
              )}
            </div>
          </div>
          {routeProgress && (
            <div className="h-1 bg-rmpg-800 overflow-hidden">
              <div className="h-full bg-brand-500" style={{ width: `${Math.round(Math.min(1, Math.max(0, routeProgress.fraction)) * 100)}%`, transition: 'width 0.4s ease-out' }} />
            </div>
          )}
          {offRoute && (
            <div className="flex items-center gap-1 px-3 py-1 text-[10px] font-bold uppercase text-red-400 animate-pulse border-t border-rmpg-800">
              <AlertTriangle className="w-3 h-3" /> Off route — recalculating
            </div>
          )}
          {/* Upcoming maneuvers (the next few turns) */}
          {upcomingSteps.length > 0 && (
            <div className="border-t border-rmpg-800">
              {upcomingSteps.map((s, i) => {
                const Icon = maneuverIcon(s.maneuverType, s.modifier);
                return (
                  <div key={i} className={`flex items-center gap-2 px-3 py-1 ${i > 0 ? 'border-t border-rmpg-800/50' : ''}`}>
                    <Icon className="w-3.5 h-3.5 text-rmpg-400 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-[10px] text-rmpg-300" title={s.instruction}>{s.instruction}</span>
                    <span className="text-[8px] font-mono text-rmpg-500 shrink-0">{s.distanceText}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3D chase-cam inset (corner) — a steep-pitch, tighter 3D view of the
          block ahead, mirroring the device position + heading. */}
      <div className="absolute z-20" style={{ top: 96, right: 8, width: 196, height: 148 }}>
        <div className="relative w-full h-full panel-beveled border border-rmpg-600 overflow-hidden shadow-xl" style={{ borderRadius: 2 }}>
          <div ref={insetContainerRef} className="absolute inset-0" />
          <div className="absolute top-1 left-1 flex items-center gap-1 px-1 py-0.5 bg-surface-deep/80 backdrop-blur-sm" style={{ borderRadius: 2 }}>
            <Box className="w-3 h-3 text-brand-400" />
            <span className="text-[8px] font-bold uppercase tracking-wider text-rmpg-200">3D</span>
          </div>
          {!insetReady && (
            <div className="absolute inset-0 flex items-center justify-center text-[9px] text-rmpg-600">
              <Crosshair className="w-3 h-3 mr-1 animate-pulse" /> 3D view…
            </div>
          )}
        </div>
      </div>
      {!activeRoute && (
        <div className="absolute top-12 inset-x-2 z-20 panel-beveled bg-surface-deep/85 backdrop-blur-md border border-rmpg-700 px-3 py-1.5 text-[10px] uppercase text-rmpg-500 flex items-center gap-2" style={{ borderRadius: 2 }}>
          <MapPin className="w-3.5 h-3.5" /> No active route — following GPS
        </div>
      )}

      {/* Nearby active calls — ranked by straight-line distance from the unit. */}
      {nearbyCalls.length > 0 && (
        <div className="absolute z-20" style={{ top: 96, left: 8, width: 190 }}>
          <div className="panel-beveled bg-surface-deep/90 backdrop-blur-md border border-rmpg-600 shadow-xl" style={{ borderRadius: 2 }}>
            <div className="flex items-center gap-1 px-2 py-1 border-b border-rmpg-700">
              <MapPin className="w-3 h-3 text-brand-400" />
              <span className="text-[9px] font-bold uppercase tracking-wider text-rmpg-200 flex-1">Nearby Calls</span>
              <span className="text-[9px] font-mono text-rmpg-500">{nearbyCalls.length}</span>
            </div>
            {nearbyCalls.map((c, i) => (
              <div key={i} className={`flex items-center gap-1.5 px-2 py-1 ${i > 0 ? 'border-t border-rmpg-800/50' : ''}`}>
                <span className="text-[8px] font-bold px-1 py-0.5 shrink-0" style={{ background: PRIO_COLOR[c.priority] || '#666', color: '#0a0a0a', borderRadius: 2 }}>{c.priority}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-rmpg-100 font-mono truncate">{c.call_number || '—'}</div>
                  <div className="text-[8px] text-rmpg-500 truncate">{c.incident_type.replace(/_/g, ' ')}</div>
                </div>
                <span className="text-[10px] font-mono text-brand-300 shrink-0">{c.distMi.toFixed(1)}mi</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Instrument cluster (bottom) */}
      <div className="absolute bottom-0 inset-x-0 z-20 bg-surface-deep/88 backdrop-blur-md border-t border-rmpg-700">
        <div className="flex items-stretch gap-3 px-3 py-2">
          {/* Speedometer */}
          <div className="flex flex-col items-center justify-center shrink-0" style={{ width: 92 }}>
            <div className="flex items-baseline gap-1">
              <span className="font-mono font-bold text-brand-300" style={{ fontSize: 40, lineHeight: 1 }}>{hasFix && mph != null ? mph : '--'}</span>
            </div>
            <span className="text-[9px] uppercase tracking-widest text-rmpg-500 flex items-center gap-1"><Gauge className="w-3 h-3" /> mph</span>
            {/* Rolling speed sparkline */}
            {spark.length > 1 && (
              <svg viewBox={`0 0 ${spark.length - 1} 18`} preserveAspectRatio="none" className="mt-1" style={{ width: 88, height: 16 }} aria-hidden="true">
                <polyline
                  points={spark.map((v, i) => `${i},${18 - Math.min(18, (v / sparkMax) * 18)}`).join(' ')}
                  fill="none" stroke="#d4a017" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
          </div>

          {/* Compass */}
          <div className="relative shrink-0 self-center" style={{ width: 72, height: 72 }} title="Heading">
            <div className="absolute inset-0 rounded-full border-2 border-rmpg-600" />
            <span className="absolute top-0 left-1/2 -translate-x-1/2 text-[8px] text-rmpg-500">N</span>
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[8px] text-rmpg-700">S</span>
            <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[8px] text-rmpg-700">W</span>
            <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[8px] text-rmpg-700">E</span>
            <Navigation2
              className="absolute inset-0 m-auto w-9 h-9 text-brand-400"
              style={{ transform: `rotate(${dir ?? 0}deg)`, transition: 'transform 0.3s ease-out' }}
              fill={dir != null ? '#d4a017' : 'none'}
            />
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-brand-300 bg-surface-deep px-1">
              {dir != null ? `${Math.round(dir)}° ${compassCardinal(dir)}` : '—'}
            </span>
          </div>

          {/* Live readouts + session stats */}
          <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] self-center">
            <div><span className="text-rmpg-500 text-[9px] uppercase">Acc </span><span className="text-rmpg-200">{gps.accuracy != null ? `${Math.round(gps.accuracy)} m` : '—'}</span></div>
            <div><span className="text-rmpg-500 text-[9px] uppercase">Max </span><span className="text-rmpg-200">{maxMph} mph</span></div>
            <div><span className="text-rmpg-500 text-[9px] uppercase">Avg </span><span className="text-rmpg-200">{Math.round(avgMph)} mph</span></div>
            <div><span className="text-rmpg-500 text-[9px] uppercase">Dist </span><span className="text-rmpg-200">{distanceMi.toFixed(2)} mi</span></div>
            <div><span className="text-rmpg-500 text-[9px] uppercase">Time </span><span className="text-rmpg-200">{fmtDuration(sessionMs)}</span></div>
            <div className="col-span-2 text-[9px] text-rmpg-500 truncate">
              {hasFix ? `${gps.latitude!.toFixed(6)}, ${gps.longitude!.toFixed(6)}` : 'Acquiring fix…'}
              {gps.unitCallSign ? ` · ${gps.unitCallSign}` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
