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

import { useRef, useState, useEffect, useMemo, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Navigation2, Satellite, Wifi, Globe, X, AlertTriangle, MapPin, Gauge,
  CornerUpLeft, CornerUpRight, ArrowUp, ArrowUpLeft, ArrowUpRight,
  Flag, Merge, RotateCw, RotateCcw, Clock, Box, Crosshair, Maximize, Minimize,
  Flame, Search, Bell, BellOff, ShieldAlert, type LucideIcon,
} from 'lucide-react';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { useMapRouting } from '../hooks/useMapRouting';
import { navigateTo } from '../utils/organicMapsNav';
import { playTone } from '../utils/dispatchTones';
import { useMap3D } from './map/hooks/useMap3D';
import { mapboxgl, initMapbox, MAPBOX_STYLE_DARK } from '../utils/mapboxLoader';
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

interface CrimePoint { id: string; source: 'slc' | 'local'; category: string; label: string; date: string | null; lat: number; lng: number }

// Map color for a crime point. SLC public data is colored by crime class; our
// own CFS is green so the two sources read apart. (No blue — house style.)
function crimeColor(p: CrimePoint): string {
  if (p.source === 'local') return '#22c55e';
  const cat = (p.category || '').toLowerCase();
  if (cat.includes('person')) return '#ef4444';
  if (cat.includes('property')) return '#f59e0b';
  if (cat.includes('society')) return '#a855f7';
  return '#d4a017';
}

// Initial great-circle bearing (deg, 0=N) from A to B.
function bearingTo(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// ── Route corridor hazard scan (routing-aware situational awareness) ──
// A hazard the unit is about to drive INTO — an active call or a crime hot-spot
// that snaps onto the planned route ahead of the unit's current progress.
interface CorridorHazard {
  kind: 'call' | 'crime';
  label: string;
  sub: string;
  /** Distance ahead along the route to the hazard, miles. */
  aheadMi: number;
  color: string;
  lat: number;
  lng: number;
  /** 1 = caution, 2 = elevated, 3 = critical — drives sort + map halo size. */
  severity: number;
}

// Tuning knobs for the corridor scan. These are deliberately conservative — a
// tight corridor + a high cluster threshold keep the panel signal, not noise.
const CORRIDOR_HAZARD_M = 70;        // off-route slack: still "on the path"
const CORRIDOR_LOOKAHEAD_M = 8047;   // scan up to ~5 mi down the route
const CORRIDOR_MIN_AHEAD_M = 40;     // ignore hazards we're effectively on top of
const CRIME_CLUSTER_BIN_M = 160;     // along-route bin width for crime clustering
const CRIME_CLUSTER_MIN = 4;         // incidents in one bin to flag a hot segment

/** Axis-aligned lat/lng bounds of a route polyline ([lng,lat][]) — a cheap
 *  prefilter so we only snap crime points that could plausibly be in-corridor. */
function routeBBox(coords: [number, number][]): { w: number; s: number; e: number; n: number } {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < w) w = lng; if (lng > e) e = lng;
    if (lat < s) s = lat; if (lat > n) n = lat;
  }
  return { w, s, e, n };
}

/**
 * Urgency score for a corridor hazard — HIGHER floats to the top of the panel
 * and is what the operator sees first while driving.
 *
 * This is the one piece of domain judgment in the corridor scan, so it lives in
 * its own function: tune it to match how your officers actually prioritize.
 * The default weights severity heavily (a P1 call ahead matters even at range)
 * and decays linearly with distance so an imminent hazard edges out a distant
 * one of equal severity.
 */
function scoreCorridorHazard(h: CorridorHazard): number {
  return h.severity * 100 - h.aheadMi * 10;
}

// ── Advanced instruments ─────────────────────────────────────────────────────
// Ring speed gauge: a 3/4 dasharray ring (rotated so the gap sits at the bottom)
// + a centered readout, color-ramped green→amber→red by speed band.
function SpeedGauge({ mph, max = 120 }: { mph: number | null; max?: number }) {
  const v = mph != null ? Math.max(0, Math.min(max, mph)) : 0;
  const R = 42, C = 2 * Math.PI * R, sweep = 0.72;
  const track = C * sweep;
  const filled = track * (v / max);
  const color = v > 80 ? '#ef4444' : v > 55 ? '#f59e0b' : '#22c55e';
  return (
    <div className="relative shrink-0" style={{ width: 116, height: 116 }} title="Speed">
      <svg viewBox="0 0 100 100" className="absolute inset-0" style={{ transform: 'rotate(129deg)' }} aria-hidden="true">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#1c1c1c" strokeWidth="7" strokeDasharray={`${track} ${C}`} strokeLinecap="round" />
        <circle cx="50" cy="50" r={R} fill="none" stroke={color} strokeWidth="7" strokeDasharray={`${filled} ${C}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.4s ease-out, stroke 0.4s' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono font-bold leading-none" style={{ fontSize: 34, color }}>{mph != null ? mph : '--'}</span>
        <span className="text-[8px] uppercase tracking-widest text-rmpg-500">mph</span>
      </div>
    </div>
  );
}

// HUD heading tape: a horizontal compass strip centered on the live heading,
// ticks every 15° (cardinals gold-labeled) with a fixed center pointer.
function HeadingTape({ heading }: { heading: number | null }) {
  if (heading == null) return null;
  const h = ((heading % 360) + 360) % 360;
  const ticks: ReactElement[] = [];
  for (let off = -75; off <= 75; off += 15) {
    const deg = (((h + off) % 360) + 360) % 360;
    const x = 50 + (off / 75) * 50;
    const major = deg % 90 === 0;
    const card = ['N', 'E', 'S', 'W'][deg / 90] || '';
    ticks.push(
      <div key={off} className="absolute top-0 flex flex-col items-center" style={{ left: `${x}%`, transform: 'translateX(-50%)' }}>
        <div style={{ height: major ? 8 : 4, width: 1, background: major ? '#d4a017' : '#555' }} />
        {major ? <span className="text-[8px] font-bold text-brand-300 leading-none mt-0.5">{card}</span>
          : deg % 30 === 0 ? <span className="text-[7px] text-rmpg-500 leading-none mt-0.5">{deg}</span> : null}
      </div>,
    );
  }
  return (
    <div className="relative h-5 w-full overflow-hidden">
      {ticks}
      <div className="absolute left-1/2 top-0 -translate-x-1/2" style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '6px solid #d4a017' }} />
    </div>
  );
}

// Longitudinal G-force bar (brake ← center → accel), color-ramped by magnitude.
function GForceMeter({ g }: { g: number }) {
  const clamped = Math.max(-1, Math.min(1, g));
  const pct = ((clamped + 1) / 2) * 100;
  const color = Math.abs(g) > 0.4 ? '#ef4444' : Math.abs(g) > 0.2 ? '#f59e0b' : '#22c55e';
  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-[7px] uppercase text-rmpg-600">
        <span>brake</span>
        <span className="font-mono" style={{ color }}>{g >= 0 ? '+' : ''}{g.toFixed(2)} g</span>
        <span>accel</span>
      </div>
      <div className="relative h-1.5 bg-rmpg-800 overflow-hidden" style={{ borderRadius: 2 }}>
        <div className="absolute top-0 bottom-0" style={{ left: '50%', width: 1, background: '#444' }} />
        <div className="absolute top-0 bottom-0" style={{ left: `${Math.min(50, pct)}%`, width: `${Math.abs(pct - 50)}%`, background: color, transition: 'all 0.3s ease-out' }} />
      </div>
    </div>
  );
}

// A single bordered instrument readout cell — a tiny gold-tracked label over a
// bold mono value, with a thin gold top-rail. Turns the stat grid into a real
// instrument panel instead of bare text floating in black.
function StatTile({ label, value, accent, dim }: { label: string; value: string; accent?: string; dim?: boolean }) {
  return (
    <div
      className="relative bg-surface-raised/60 border border-rmpg-800 px-2 py-1 min-w-0 overflow-hidden"
      style={{ borderRadius: 2, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }}
    >
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, #d4a01733 40%, #d4a01755 60%, transparent)' }} />
      <div className="text-[8px] uppercase tracking-wider text-rmpg-600 leading-none truncate">{label}</div>
      <div
        className="font-mono font-bold text-[13px] leading-tight mt-0.5 truncate tabular-nums"
        style={{ color: accent || (dim ? '#6b6b6b' : '#d4d4d4') }}
      >
        {value}
      </div>
    </div>
  );
}

// Tactical color for a unit's status (friendly contacts on the scope/board).
function statusColor(s: string): string {
  if (s === 'available') return '#22c55e';
  if (s === 'onscene') return '#ef4444';
  if (s === 'enroute' || s === 'dispatched') return '#f59e0b';
  if (s === 'busy') return '#8b5cf6';
  return '#888888';
}

interface ScopeContact { kind: 'call' | 'unit'; bearing: number; distMi: number; color: string; threat?: boolean; label: string }

// ── Tactical proximity scope (PPI radar) ──
// North-up situational-awareness scope: concentric range rings, cardinal ticks,
// the unit at center with a live heading wedge, and nearby calls (diamonds) +
// units (dots) plotted bearing-true and range-scaled. The core "what's around
// me, and where" instrument — turns the screen from nav app into a tactical SA
// display.
function TacticalScope({ heading, contacts, maxRangeMi, size = 134 }: {
  heading: number | null; contacts: ScopeContact[]; maxRangeMi: number; size?: number;
}) {
  const cc = size / 2;
  const R = cc - 11;
  const rings = [1 / 3, 2 / 3, 1];
  const polar = (bearingDeg: number, rad: number) => {
    const a = (bearingDeg - 90) * Math.PI / 180; // 0°=N=up, clockwise
    return { x: cc + rad * Math.cos(a), y: cc + rad * Math.sin(a) };
  };
  const head = heading != null ? polar(heading, R) : null;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title="Proximity scope — nearby calls & units">
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" aria-hidden="true">
        <circle cx={cc} cy={cc} r={R} fill="rgba(34,197,94,0.035)" />
        {rings.map((f, i) => (
          <circle key={i} cx={cc} cy={cc} r={R * f} fill="none" stroke={i === rings.length - 1 ? '#2e2e2e' : '#1c1c1c'} strokeWidth="1" />
        ))}
        <line x1={cc} y1={cc - R} x2={cc} y2={cc + R} stroke="#161616" strokeWidth="1" />
        <line x1={cc - R} y1={cc} x2={cc + R} y2={cc} stroke="#161616" strokeWidth="1" />
        {head && (
          <line x1={cc} y1={cc} x2={head.x} y2={head.y} stroke="#d4a017" strokeWidth="1.5" strokeOpacity="0.65" />
        )}
        {contacts.map((ct, i) => {
          const r = Math.min(1, ct.distMi / maxRangeMi) * R;
          const { x, y } = polar(ct.bearing, r);
          if (ct.kind === 'call') {
            return (
              <rect key={i} x={x - 2.7} y={y - 2.7} width="5.4" height="5.4" transform={`rotate(45 ${x} ${y})`} fill={ct.color} stroke="#0a0a0a" strokeWidth="0.6">
                {ct.threat && <animate attributeName="opacity" values="1;0.25;1" dur="1.1s" repeatCount="indefinite" />}
              </rect>
            );
          }
          return <circle key={i} cx={x} cy={y} r="2.6" fill={ct.color} stroke="#0a0a0a" strokeWidth="0.6" />;
        })}
        <circle cx={cc} cy={cc} r="2.6" fill="#d4a017" stroke="#0a0a0a" strokeWidth="0.9" />
      </svg>
      <span className="absolute top-0 left-1/2 -translate-x-1/2 text-[7px] font-bold text-rmpg-500">N</span>
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[7px] text-rmpg-700">S</span>
      <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[7px] text-rmpg-700">W</span>
      <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[7px] text-rmpg-700">E</span>
      <span className="absolute bottom-0.5 right-0.5 text-[7px] font-mono text-rmpg-600">{maxRangeMi}mi</span>
    </div>
  );
}

// One tactical contact row — a heading-relative bearing arrow (points where the
// contact is relative to where the unit is FACING), id/subtitle, range + bearing.
function ContactRow({ id, sub, color, bearing, distMi, heading, threat }: {
  id: string; sub: string; color: string; bearing: number; distMi: number; heading: number | null; threat?: boolean;
}) {
  const rel = heading != null ? ((bearing - heading) % 360 + 360) % 360 : bearing;
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 ${threat ? 'bg-red-500/10' : ''}`}>
      <svg width="13" height="13" viewBox="0 0 12 12" className="shrink-0" style={{ transform: `rotate(${rel}deg)`, transition: 'transform 0.4s ease-out' }} aria-hidden="true">
        <path d="M6 1 L9.5 10.5 L6 8 L2.5 10.5 Z" fill={color} />
      </svg>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-mono text-rmpg-100 truncate leading-tight">{id}</div>
        <div className="text-[8px] text-rmpg-500 truncate leading-tight">{sub}</div>
      </div>
      <div className="text-right shrink-0 leading-tight">
        <div className="text-[10px] font-mono text-brand-300">{distMi.toFixed(1)}mi</div>
        <div className="text-[8px] font-mono text-rmpg-600">{String(Math.round(bearing)).padStart(3, '0')}°</div>
      </div>
    </div>
  );
}

export default function NavigationPage() {
  const navigate = useNavigate();
  const gps = useGpsTracking({ capture: true });

  // ── Native full-screen (kiosk) toggle ──
  // The page already renders edge-to-edge (no app toolbar — it's a standalone
  // route outside <Layout>). This goes one step further into the browser/OS
  // Fullscreen API so an in-vehicle Toughbook can run it true full-screen. The
  // listener keeps the icon in sync with ESC-to-exit. Best-effort: request
  // Fullscreen rejects without a user gesture or in some embedded webviews.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      rootRef.current?.requestFullscreen?.().catch(() => { /* gesture/permission denied */ });
    } else {
      document.exitFullscreen?.().catch(() => { /* already exited */ });
    }
  };

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const { activeRoute, routeProgress, offRoute, showRoute, clearRoute, updateOrigin } = useMapRouting({
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
  const accelRef = useRef<{ mph: number; t: number } | null>(null);
  const [gForce, setGForce] = useState(0);
  const destCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const [nearbyUnits, setNearbyUnits] = useState<{ call_sign: string; status: string; lat: number; lng: number }[]>([]);
  const [crimeOn, setCrimeOn] = useState(true);
  const [crimeIncidents, setCrimeIncidents] = useState<CrimePoint[]>([]);
  const [currentStreet, setCurrentStreet] = useState<string | null>(null);
  const geoRef = useRef<{ lat: number; lng: number; t: number } | null>(null);
  // Destination search (address/place → route there).
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ lat: number; lng: number; label: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [destLabel, setDestLabel] = useState<string | null>(null);
  // Route corridor hazard scan results. #1001 shipped the CorridorHazard type,
  // tuning constants, scoreCorridorHazard(), and the "Ahead on route" panel UI
  // (~line 1100) but NOT the scan that populates these — they were referenced
  // undeclared (tsc red + a runtime ReferenceError that crashed the whole page
  // on render). Inert for now so the panel stays hidden (length 0) until the
  // scan lands. TODO(#1001): compute from activeRoute + crimeIncidents +
  // nearbyUnits via routeBBox()/scoreCorridorHazard()/CORRIDOR_* and set
  // corridorCritical to the count of severity===3 hazards.
  const corridorHazards: CorridorHazard[] = [];
  const corridorCritical = 0;
  // Proximity alert tones + transient warning banner (Motorola dispatch tones).
  const [alertsOn, setAlertsOn] = useState(true);
  const [navAlert, setNavAlert] = useState<{ text: string; color: string } | null>(null);
  const alertedCallsRef = useRef<Set<string>>(new Set());
  const crimeHotRef = useRef(false);
  const approachFiredRef = useRef<string | null>(null);
  const alertTimerRef = useRef<number | null>(null);
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
          style: MAPBOX_STYLE_DARK,
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
          // Push dark-v11 toward a pure-black tactical base — black land/background
          // and near-black water — so streets + the crime overlay pop. Defensive:
          // layer ids vary by style version, so guard every set.
          try {
            for (const ly of (map.getStyle()?.layers || [])) {
              if (ly.type === 'background') map.setPaintProperty(ly.id, 'background-color', '#000000');
              else if (/water/i.test(ly.id) && ly.type === 'fill') map.setPaintProperty(ly.id, 'fill-color', '#04070d');
              else if (/(^|[-_])(land|landcover|landuse)/i.test(ly.id) && ly.type === 'fill') map.setPaintProperty(ly.id, 'fill-color', '#050505');
            }
          } catch { /* style recolor is cosmetic — never block the map */ }
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
          style: MAPBOX_STYLE_DARK,
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
    // Longitudinal G-force from the speed delta (mph/s → g; 1 g ≈ 21.94 mph/s).
    if (mph != null) {
      const now = Date.now(); const prev = accelRef.current;
      if (prev && now > prev.t) setGForce(((mph - prev.mph) / ((now - prev.t) / 1000)) / 21.94);
      accelRef.current = { mph, t: now };
    }

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
        destCoordsRef.current = { lat: call.latitude, lng: call.longitude };
        await showRoute(unit.call_sign, call.call_number, gps.latitude!, gps.longitude!, call.latitude, call.longitude);
      } catch { /* best-effort — drive screen still follows GPS without a route */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // ── Destination search (address / place → route there) ──
  // Debounced geocode against the Utah-biased server search; results carry
  // coords so selecting one routes immediately.
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (q.length < 3) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch<{ results?: any[] }>(`/geocode/search?q=${encodeURIComponent(q)}&limit=6`);
        if (cancelled) return;
        const rows = (res?.results || [])
          .map((r: any) => ({
            lat: Number(r.lat), lng: Number(r.lon),
            label: String(r.display_name || '').split(',').slice(0, 2).join(',').trim() || 'Result',
          }))
          .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
        setSearchResults(rows);
      } catch { if (!cancelled) setSearchResults([]); }
      finally { if (!cancelled) setSearching(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [searchQuery, searchOpen]);

  const routeToDestination = async (lat: number, lng: number, label: string) => {
    destCoordsRef.current = { lat, lng };
    routedCallRef.current = -1; // claim the route so the assigned-call auto-route can't clobber it
    setDestLabel(label);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    if (gps.latitude != null && gps.longitude != null) {
      await showRoute('NAV', label, gps.latitude, gps.longitude, lat, lng).catch(() => {});
    }
  };
  const clearDestination = () => {
    clearRoute();
    destCoordsRef.current = null;
    setDestLabel(null);
    routedCallRef.current = null;
  };
  const openExternalNav = () => {
    const d = destCoordsRef.current;
    if (d) navigateTo(d.lat, d.lng, destLabel || activeRoute?.callNumber || 'Destination').catch(() => {});
  };

  // Tick once a second so session-duration + the clock re-render even when parked.
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // Nearby active calls — situational awareness while driving. Ranks the active
  // board by straight-line distance from the live position; refreshes every 20s.
  const [nearbyCalls, setNearbyCalls] = useState<{ call_number: string; incident_type: string; priority: string; lat: number; lng: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const mlat = gps.latitude, mlng = gps.longitude;
      if (mlat == null || mlng == null) return;
      try {
        const res = await apiFetch<any>('/dispatch/calls?limit=100');
        const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        // Store coords (not a frozen distance) and keep the nearest 8 — the scope
        // recomputes range + bearing live from the moving unit each render.
        const near = rows
          .filter((c: any) => c.latitude != null && c.longitude != null)
          .map((c: any) => ({
            call_number: c.call_number || '', incident_type: c.incident_type || 'call', priority: c.priority || 'P3',
            lat: Number(c.latitude), lng: Number(c.longitude),
          }))
          .sort((a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
            haversineMeters(mlat, mlng, a.lat, a.lng) - haversineMeters(mlat, mlng, b.lat, b.lng))
          .slice(0, 8);
        if (!cancelled) setNearbyCalls(near);
      } catch { /* best-effort — situational extra, never blocks the drive view */ }
    };
    run();
    const iv = setInterval(run, 20000);
    return () => { cancelled = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps.latitude != null]);

  // Nearby on-duty units — fellow officers ranked by distance from the unit.
  // Excludes the operator's OWN unit (by id AND call sign) so it doesn't show
  // up as a contact at 0.0mi on top of itself.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const mlat = gps.latitude, mlng = gps.longitude;
      if (mlat == null || mlng == null) return;
      try {
        const res = await apiFetch<any>('/dispatch/units');
        const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        const near = rows
          .filter((u: any) =>
            u.latitude != null && u.longitude != null &&
            (gps.unitId == null || Number(u.id) !== gps.unitId) &&
            (!gps.unitCallSign || u.call_sign !== gps.unitCallSign))
          .map((u: any) => ({
            call_sign: u.call_sign || '?', status: u.status || 'unknown',
            lat: Number(u.latitude), lng: Number(u.longitude),
          }))
          .sort((a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
            haversineMeters(mlat, mlng, a.lat, a.lng) - haversineMeters(mlat, mlng, b.lat, b.lng))
          .slice(0, 6);
        if (!cancelled) setNearbyUnits(near);
      } catch { /* best-effort */ }
    };
    run();
    const iv = setInterval(run, 20000);
    return () => { cancelled = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps.latitude != null]);

  // ── Crime data layers ──
  // Fetch BOTH sources (SLC public crime proxy + our own recent CFS), merge,
  // refresh every 10 min. Best-effort: a failed source just yields fewer points.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const [slc, local] = await Promise.all([
          apiFetch<{ incidents?: CrimePoint[] }>('/crime/slc?days=60&limit=1500').catch(() => null),
          apiFetch<{ incidents?: CrimePoint[] }>('/crime/local?days=60&limit=1000').catch(() => null),
        ]);
        if (cancelled) return;
        setCrimeIncidents([...(slc?.incidents || []), ...(local?.incidents || [])]);
      } catch { /* best-effort — crime overlay is supplemental */ }
    };
    run();
    const iv = setInterval(run, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Render the crime layer onto the drive map: a density heatmap under colored
  // incident dots, from one GeoJSON source. Adds the source/layers once, then
  // setData on refresh; visibility follows the toggle. Best-effort (style may be
  // mid-reload). The map is torn down on unmount, so no explicit layer cleanup.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    const SRC = 'rmpg-crime';
    const fc = {
      type: 'FeatureCollection',
      features: crimeIncidents.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { color: crimeColor(p) },
      })),
    };
    try {
      const existing = map.getSource(SRC);
      if (existing) {
        existing.setData(fc);
      } else {
        map.addSource(SRC, { type: 'geojson', data: fc });
        map.addLayer({
          id: 'rmpg-crime-heat', type: 'heatmap', source: SRC,
          paint: {
            'heatmap-weight': 0.55,
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 16, 1.1],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 12, 16, 28],
            'heatmap-opacity': 0.45,
            'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
              0, 'rgba(0,0,0,0)', 0.3, 'rgba(212,160,23,0.35)', 0.6, 'rgba(245,158,11,0.6)', 1, 'rgba(239,68,68,0.9)'],
          },
        });
        map.addLayer({
          id: 'rmpg-crime-pts', type: 'circle', source: SRC,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.4, 17, 5],
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.85,
            'circle-stroke-width': 0.5,
            'circle-stroke-color': '#0a0a0a',
          },
        });
      }
      const vis = crimeOn ? 'visible' : 'none';
      if (map.getLayer('rmpg-crime-heat')) map.setLayoutProperty('rmpg-crime-heat', 'visibility', vis);
      if (map.getLayer('rmpg-crime-pts')) map.setLayoutProperty('rmpg-crime-pts', 'visibility', vis);
    } catch { /* style mid-reload — next data tick re-applies */ }
  }, [crimeIncidents, crimeOn, mapReady]);

  const crimeCounts = useMemo(() => {
    let slc = 0, local = 0;
    for (const p of crimeIncidents) { if (p.source === 'local') local++; else slc++; }
    return { slc, local, total: crimeIncidents.length };
  }, [crimeIncidents]);

  // Crime incidents within ~½ mile of the unit — a live "how hot is here" field
  // (and the basis for the high-crime-area alert in the next phase).
  const crimeNearby = useMemo(() => {
    if (gps.latitude == null || gps.longitude == null) return 0;
    let n = 0;
    for (const p of crimeIncidents) { if (haversineMeters(gps.latitude, gps.longitude, p.lat, p.lng) <= 805) n++; }
    return n;
  }, [crimeIncidents, gps.latitude, gps.longitude]);

  // ── Reverse-geocode the current position → street label ("more data fields") ──
  // Throttled: only re-lookup after ~40m of movement or 20s, since the server
  // KV-caches reverse lookups anyway. Best-effort; failures leave the last label.
  useEffect(() => {
    if (gps.latitude == null || gps.longitude == null) return;
    const lat = gps.latitude, lng = gps.longitude;
    const prev = geoRef.current, now = Date.now();
    const moved = prev ? haversineMeters(prev.lat, prev.lng, lat, lng) : Infinity;
    if (prev && moved < 40 && now - prev.t < 20000) return;
    geoRef.current = { lat, lng, t: now };
    let cancelled = false;
    apiFetch<{ address: string | null }>(`/geocode/reverse?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`)
      .then((r) => { if (!cancelled) setCurrentStreet(r?.address || null); })
      .catch(() => { /* keep last known street */ });
    return () => { cancelled = true; };
  }, [gps.latitude, gps.longitude]);

  const sessionMs = startRef.current ? Date.now() - startRef.current : 0;
  const distanceMi = distanceRef.current / 1609.34;
  const avgMph = sessionMs > 60000 ? distanceMi / (sessionMs / 3600000) : 0;
  const clock = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const spark = speedHistRef.current;
  const sparkMax = Math.max(60, maxMph, ...spark);
  const course = gps.course ?? null;
  const destBearing = (destCoordsRef.current && gps.latitude != null && gps.longitude != null)
    ? bearingTo(gps.latitude, gps.longitude, destCoordsRef.current.lat, destCoordsRef.current.lng) : null;
  const destCrowMi = (destCoordsRef.current && gps.latitude != null && gps.longitude != null)
    ? haversineMeters(gps.latitude, gps.longitude, destCoordsRef.current.lat, destCoordsRef.current.lng) / 1609.34 : null;

  // ── Live tactical contacts ──
  // The unit SET refreshes every 20s; each contact's range + bearing recompute
  // from the CURRENT position every render so the scope/board stay live as the
  // unit moves. Sorted nearest-first.
  const myLat = gps.latitude, myLng = gps.longitude;
  const callContacts = useMemo(() => {
    if (myLat == null || myLng == null) return [];
    return nearbyCalls
      .map((c) => ({ ...c, distMi: haversineMeters(myLat, myLng, c.lat, c.lng) / 1609.34, bearing: bearingTo(myLat, myLng, c.lat, c.lng) }))
      .sort((a, b) => a.distMi - b.distMi);
  }, [nearbyCalls, myLat, myLng]);
  const unitContacts = useMemo(() => {
    if (myLat == null || myLng == null) return [];
    return nearbyUnits
      .map((u) => ({ ...u, distMi: haversineMeters(myLat, myLng, u.lat, u.lng) / 1609.34, bearing: bearingTo(myLat, myLng, u.lat, u.lng) }))
      .sort((a, b) => a.distMi - b.distMi);
  }, [nearbyUnits, myLat, myLng]);
  // Scope outer ring auto-ranges to the farthest contact, clamped to a 2–10mi band.
  const scopeMaxMi = useMemo(() => {
    const far = Math.max(0, ...callContacts.map((c) => c.distMi), ...unitContacts.map((u) => u.distMi));
    return Math.min(10, Math.max(2, Math.ceil(far || 2)));
  }, [callContacts, unitContacts]);
  const scopeContacts: ScopeContact[] = [
    ...callContacts.map((c) => ({ kind: 'call' as const, bearing: c.bearing, distMi: c.distMi, color: PRIO_COLOR[c.priority] || '#888888', threat: c.priority === 'P1' || c.priority === 'P2', label: c.call_number })),
    ...unitContacts.map((u) => ({ kind: 'unit' as const, bearing: u.bearing, distMi: u.distMi, color: statusColor(u.status), label: u.call_sign })),
  ];
  const threatCount = callContacts.filter((c) => c.priority === 'P1' || c.priority === 'P2').length;

  // ── Proximity alert tones (Motorola dispatch tones) ──
  // Plays an authentic Motorola tone (dispatchTones.ts) + flashes a transient
  // warning banner. Respects the page Alerts toggle AND the global sound mute.
  const fireAlert = (tone: Parameters<typeof playTone>[0], text: string, color: string) => {
    if (!alertsOn) return;
    playTone(tone);
    setNavAlert({ text, color });
    if (alertTimerRef.current) window.clearTimeout(alertTimerRef.current);
    alertTimerRef.current = window.setTimeout(() => setNavAlert(null), 6000);
  };

  // 1) Nearby high-priority calls — P1/P2 within 1mi. Fires once per call as it
  //    enters the ring (re-arms when it leaves). P1 → Priority-1 warble, P2 → Hi-Lo.
  useEffect(() => {
    if (!alertsOn) return;
    const seen = alertedCallsRef.current;
    const within = new Set<string>();
    for (const c of callContacts) {
      if ((c.priority === 'P1' || c.priority === 'P2') && c.distMi <= 1.0 && c.call_number) {
        within.add(c.call_number);
        if (!seen.has(c.call_number)) {
          seen.add(c.call_number);
          fireAlert(c.priority === 'P1' ? 'p1_alert' : 'warning',
            `${c.priority} ${c.incident_type.replace(/_/g, ' ')} · ${c.distMi.toFixed(1)}mi ${String(Math.round(c.bearing)).padStart(3, '0')}°`,
            '#ef4444');
        }
      }
    }
    for (const id of Array.from(seen)) if (!within.has(id)) seen.delete(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callContacts, alertsOn]);

  // 2) High-crime-area entry — crossing into ≥8 incidents within ½mi (P25 3-pip).
  //    Hysteresis (re-arm below 5) so it doesn't chatter at the boundary.
  useEffect(() => {
    if (!alertsOn) return;
    if (!crimeHotRef.current && crimeNearby >= 8) {
      crimeHotRef.current = true;
      fireAlert('alert', `High-crime area · ${crimeNearby} within ½mi (60d)`, '#f59e0b');
    } else if (crimeHotRef.current && crimeNearby < 5) {
      crimeHotRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crimeNearby, alertsOn]);

  // 3) Approaching the routed destination — within ~800 ft, once per destination
  //    (dispatch bell). Re-arms when the destination changes or clears.
  useEffect(() => {
    if (!alertsOn) return;
    const d = destCoordsRef.current;
    if (destCrowMi == null || !d) { approachFiredRef.current = null; return; }
    const key = `${d.lat.toFixed(4)},${d.lng.toFixed(4)}`;
    if (approachFiredRef.current !== key && destCrowMi <= 0.15) {
      approachFiredRef.current = key;
      fireAlert('dispatch_bell', `Approaching ${destLabel || activeRoute?.callNumber || 'destination'} · ${Math.round(destCrowMi * 5280)} ft`, '#22c55e');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destCrowMi, alertsOn]);

  useEffect(() => () => { if (alertTimerRef.current) window.clearTimeout(alertTimerRef.current); }, []);

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
    <div ref={rootRef} className="fixed inset-0 bg-surface-deep overflow-hidden">
      {/* Map (or dark backdrop on failure) */}
      <div ref={mapContainerRef} className="absolute inset-0" />
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center text-rmpg-600 text-xs">
          Map unavailable ({mapError}) — instruments live below
        </div>
      )}

      {/* Tactical viewport framing — corner brackets (non-interactive) for a
          command-display feel; sized to clear the header and dashboard. */}
      <div className="absolute z-10 pointer-events-none" style={{ top: 44, bottom: 190, left: 6, right: 6 }}>
        <div className="absolute top-0 left-0 border-t-2 border-l-2 border-brand-500/40" style={{ width: 16, height: 16 }} />
        <div className="absolute top-0 right-0 border-t-2 border-r-2 border-brand-500/40" style={{ width: 16, height: 16 }} />
        <div className="absolute bottom-0 left-0 border-b-2 border-l-2 border-brand-500/40" style={{ width: 16, height: 16 }} />
        <div className="absolute bottom-0 right-0 border-b-2 border-r-2 border-brand-500/40" style={{ width: 16, height: 16 }} />
      </div>

      {/* Header bar */}
      <div
        className="absolute top-0 inset-x-0 flex items-center gap-2 px-3 py-2 backdrop-blur-md border-b border-rmpg-800 z-20"
        style={{ background: 'linear-gradient(180deg, rgba(10,10,10,0.92) 0%, rgba(10,10,10,0.78) 100%)' }}
      >
        <div className="absolute bottom-0 inset-x-0 h-px pointer-events-none" style={{ background: 'linear-gradient(90deg, transparent 5%, rgba(212,160,23,0.4) 30%, #d4a017 50%, rgba(212,160,23,0.4) 70%, transparent 95%)' }} />
        <Navigation2 className="w-4 h-4 text-brand-400" style={{ filter: 'drop-shadow(0 0 3px rgba(212,160,23,0.5))' }} />
        <span className="text-[11px] font-bold uppercase tracking-widest text-rmpg-100 flex-1">Navigation</span>
        <span className="font-mono text-[11px] text-rmpg-300 tabular-nums">{clock}</span>
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase" style={{ color: src.color }}>
          <src.icon className="w-3.5 h-3.5" /> {src.label}
        </span>
        {gps.connectionType && gps.connectionType !== 'unknown' && (
          <span className="text-[9px] uppercase text-rmpg-500">{gps.connectionType}</span>
        )}
        <button
          onClick={() => setAlertsOn((v) => !v)}
          className="toolbar-btn flex items-center justify-center"
          style={{ color: alertsOn ? '#d4a017' : '#666' }}
          title={alertsOn ? 'Proximity alert tones ON' : 'Proximity alert tones OFF'}
          aria-label={alertsOn ? 'Mute proximity alerts' : 'Unmute proximity alerts'}
        >
          {alertsOn ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
        </button>
        <button
          onClick={() => setSearchOpen((v) => !v)}
          className="toolbar-btn flex items-center justify-center"
          style={{ color: searchOpen ? '#d4a017' : '#a0a0a0' }}
          title="Search destination"
          aria-label="Search destination"
        >
          <Search className="w-4 h-4" />
        </button>
        <button
          onClick={() => setCrimeOn((v) => !v)}
          className="toolbar-btn flex items-center gap-1 text-[10px] uppercase"
          style={{ color: crimeOn ? '#f59e0b' : '#666' }}
          title={crimeOn ? 'Hide crime layer' : 'Show crime layer (SLC + RMPG)'}
          aria-label={crimeOn ? 'Hide crime layer' : 'Show crime layer'}
        >
          <Flame className="w-4 h-4" /> Crime
        </button>
        <button
          onClick={toggleFullscreen}
          className="toolbar-btn flex items-center justify-center text-rmpg-300 hover:text-white"
          title={isFullscreen ? 'Exit full screen' : 'Full screen'}
          aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
        >
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </button>
        <button
          onClick={() => navigate('/map')}
          className="toolbar-btn flex items-center gap-1 text-[10px] uppercase text-rmpg-300 hover:text-white"
          title="Back to map"
          aria-label="Back to map"
        >
          <X className="w-4 h-4" /> Close
        </button>
      </div>

      {/* Transient proximity-alert banner — flashes as the Motorola tone fires */}
      {navAlert && (
        <div
          className="absolute z-40 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 shadow-2xl animate-pulse"
          style={{ top: 46, background: 'rgba(8,8,8,0.96)', border: `1px solid ${navAlert.color}`, borderRadius: 2, maxWidth: '76%', boxShadow: `0 0 16px ${navAlert.color}66` }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: navAlert.color }} />
          <span className="text-[12px] font-bold uppercase tracking-wide truncate" style={{ color: navAlert.color }}>{navAlert.text}</span>
        </div>
      )}

      {/* Destination search panel */}
      {searchOpen && (
        <div className="absolute z-30 panel-beveled bg-surface-deep/95 backdrop-blur-md border border-rmpg-600 shadow-2xl" style={{ top: 40, left: 8, right: 8, borderRadius: 2 }}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-700">
            <Search className="w-4 h-4 text-brand-400 shrink-0" />
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search address or place…"
              className="flex-1 bg-transparent outline-none text-[13px] text-rmpg-100 placeholder:text-rmpg-600"
            />
            {searching && <span className="text-[9px] text-rmpg-500 shrink-0">…</span>}
            <button onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchResults([]); }} className="text-rmpg-500 hover:text-white shrink-0" aria-label="Close search">
              <X className="w-4 h-4" />
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="max-h-64 overflow-y-auto scrollbar-dark">
              {searchResults.map((r, i) => (
                <button
                  key={i}
                  onClick={() => routeToDestination(r.lat, r.lng, r.label)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-raised/60 border-t border-rmpg-800/60"
                >
                  <MapPin className="w-3.5 h-3.5 text-rmpg-500 shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-[12px] text-rmpg-200">{r.label}</span>
                  <span className="text-[9px] font-mono font-bold text-brand-300 shrink-0">ROUTE</span>
                </button>
              ))}
            </div>
          )}
          {searchQuery.trim().length >= 3 && !searching && searchResults.length === 0 && (
            <div className="px-3 py-2 text-[10px] text-rmpg-500">No matches in Utah.</div>
          )}
        </div>
      )}

      {/* Turn-by-turn banner (top) */}
      {activeRoute && step && (
        <div className="absolute top-12 inset-x-2 z-20 panel-beveled bg-surface-deep/92 backdrop-blur-md border border-rmpg-600 shadow-xl" style={{ borderRadius: 2 }}>
          <div className="flex items-center gap-3 px-3 py-2">
            <StepIcon className="w-9 h-9 text-brand-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-rmpg-100 text-[15px] font-semibold leading-tight truncate" title={step.instruction}>{step.instruction}</div>
              <div className="text-[10px] text-rmpg-500 uppercase truncate">to {destLabel || activeRoute.callNumber}</div>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <button onClick={openExternalNav} title="Open in external navigation" aria-label="Open in external navigation"
                className="p-1 border border-rmpg-700 text-rmpg-300 hover:text-white hover:border-brand-500" style={{ borderRadius: 2 }}>
                <Navigation2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={clearDestination} title="Clear route" aria-label="Clear route"
                className="p-1 border border-rmpg-700 text-rmpg-300 hover:text-red-400 hover:border-red-500" style={{ borderRadius: 2 }}>
                <X className="w-3.5 h-3.5" />
              </button>
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
          {/* Route corridor hazards — what's ON THE PATH ahead */}
          {corridorHazards.length > 0 && (
            <div className="border-t" style={{ borderColor: corridorCritical > 0 ? 'rgba(239,68,68,0.4)' : 'rgba(245,158,11,0.35)' }}>
              <div className="flex items-center gap-1.5 px-3 py-1" style={{ background: corridorCritical > 0 ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.08)' }}>
                <ShieldAlert className={`w-3.5 h-3.5 shrink-0 ${corridorCritical > 0 ? 'animate-pulse' : ''}`} style={{ color: corridorCritical > 0 ? '#ef4444' : '#f59e0b' }} />
                <span className="text-[9px] font-bold uppercase tracking-widest flex-1" style={{ color: corridorCritical > 0 ? '#fca5a5' : '#fcd34d' }}>Ahead on route</span>
                <span className="text-[9px] font-mono text-rmpg-400">{corridorHazards.length}</span>
              </div>
              {corridorHazards.slice(0, 4).map((h, i) => (
                <div key={i} className={`flex items-center gap-2 px-3 py-1 ${i > 0 ? 'border-t border-rmpg-800/40' : ''}`}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: h.color, boxShadow: h.severity >= 3 ? `0 0 5px ${h.color}` : 'none' }} />
                  <span className="text-[10px] font-mono shrink-0" style={{ color: h.color }}>{h.label}</span>
                  <span className="flex-1 min-w-0 truncate text-[9px] text-rmpg-500">{h.sub}</span>
                  <span className="text-[10px] font-mono font-bold text-brand-300 shrink-0">{h.aheadMi < 0.1 ? `${Math.round(h.aheadMi * 5280)} ft` : `${h.aheadMi.toFixed(1)} mi`}</span>
                </div>
              ))}
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

      {/* Crime layer legend (top-right, under the 3D inset) */}
      {crimeOn && crimeCounts.total > 0 && (
        <div className="absolute z-20 panel-beveled bg-surface-deep/90 backdrop-blur-md border border-rmpg-600 shadow-xl" style={{ top: 252, right: 8, width: 152, borderRadius: 2 }}>
          <div className="flex items-center gap-1 px-2 py-1 border-b border-rmpg-700">
            <Flame className="w-3 h-3" style={{ color: '#f59e0b' }} />
            <span className="text-[9px] font-bold uppercase tracking-wider text-rmpg-200 flex-1">Crime · 60d</span>
            <span className="text-[9px] font-mono text-rmpg-500">{crimeCounts.total}</span>
          </div>
          <div className="px-2 py-1 space-y-0.5">
            {([['#ef4444', 'Person (SLC)'], ['#f59e0b', 'Property (SLC)'], ['#a855f7', 'Society (SLC)'], ['#22c55e', `RMPG CFS (${crimeCounts.local})`]] as const).map(([col, lbl]) => (
              <div key={lbl} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col }} />
                <span className="text-[9px] text-rmpg-300 truncate">{lbl}</span>
              </div>
            ))}
            <div className="text-[8px] text-rmpg-600 pt-0.5">SLCPD public · {crimeCounts.slc} pts</div>
            <div className="flex items-center gap-1 pt-0.5 border-t border-rmpg-800/60 mt-0.5">
              <span className="text-[8px] uppercase tracking-wider text-rmpg-600 flex-1">Within ½mi</span>
              <span className="text-[10px] font-mono font-bold" style={{ color: crimeNearby >= 8 ? '#ef4444' : crimeNearby >= 3 ? '#f59e0b' : '#22c55e' }}>{crimeNearby}</span>
            </div>
          </div>
        </div>
      )}
      {!activeRoute && (
        <div className="absolute top-12 inset-x-2 z-20 panel-beveled bg-surface-deep/85 backdrop-blur-md border border-rmpg-700 px-3 py-1.5 flex items-center gap-2" style={{ borderRadius: 2 }}>
          <MapPin className="w-3.5 h-3.5 text-rmpg-500 shrink-0" />
          <span className="text-[10px] uppercase text-rmpg-500 shrink-0">Following GPS</span>
          {currentStreet && <span className="text-[11px] text-rmpg-200 truncate">· {currentStreet}</span>}
        </div>
      )}

      {/* ── Tactical CONTACTS board (top-left) ──
          Live SA: nearby calls + units with heading-relative bearing arrows
          (point where the contact is vs where the unit is facing), threat
          coloring, and a pulsing P1/P2 threat tally. */}
      {(callContacts.length > 0 || unitContacts.length > 0) && (
        <div className="absolute z-20" style={{ top: 96, left: 8, width: 200 }}>
          <div className="panel-beveled bg-surface-deep/92 backdrop-blur-md border border-rmpg-600 shadow-xl overflow-hidden" style={{ borderRadius: 2 }}>
            <div className="relative flex items-center gap-1.5 px-2 py-1 border-b border-rmpg-700">
              <div className="absolute bottom-0 inset-x-0 h-px" style={{ background: 'linear-gradient(90deg, rgba(212,160,23,0.5), transparent)' }} />
              <Crosshair className="w-3 h-3 text-brand-400" />
              <span className="text-[9px] font-bold uppercase tracking-widest text-rmpg-100 flex-1">Contacts</span>
              {threatCount > 0 && (
                <span className="flex items-center gap-0.5 text-[8px] font-bold px-1 py-0.5 text-red-300 animate-pulse" style={{ background: 'rgba(239,68,68,0.18)', borderRadius: 2 }}>
                  <AlertTriangle className="w-2.5 h-2.5" /> {threatCount}
                </span>
              )}
            </div>
            {callContacts.length > 0 && (
              <>
                <div className="flex items-center gap-1 px-2 pt-1 pb-0.5">
                  <span className="text-[8px] font-bold uppercase tracking-wider text-rmpg-500 flex-1">Calls</span>
                  <span className="text-[8px] font-mono text-rmpg-600">{callContacts.length}</span>
                </div>
                {callContacts.slice(0, 4).map((c, i) => (
                  <ContactRow key={`c${i}`} id={`${c.priority} · ${c.call_number || '—'}`} sub={c.incident_type.replace(/_/g, ' ')} color={PRIO_COLOR[c.priority] || '#888888'} bearing={c.bearing} distMi={c.distMi} heading={dir} threat={c.priority === 'P1' || c.priority === 'P2'} />
                ))}
              </>
            )}
            {unitContacts.length > 0 && (
              <>
                <div className="flex items-center gap-1 px-2 pt-1 pb-0.5 border-t border-rmpg-800/60">
                  <span className="text-[8px] font-bold uppercase tracking-wider text-rmpg-500 flex-1">Units</span>
                  <span className="text-[8px] font-mono text-rmpg-600">{unitContacts.length}</span>
                </div>
                {unitContacts.slice(0, 3).map((u, i) => (
                  <ContactRow key={`u${i}`} id={u.call_sign} sub={u.status.replace(/_/g, ' ')} color={statusColor(u.status)} bearing={u.bearing} distMi={u.distMi} heading={dir} />
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Advanced instrument dashboard (bottom) ── */}
      <div className="absolute bottom-0 inset-x-0 z-20">
        {/* Gold accent riser — lifts the instrument panel off the map */}
        <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent 5%, rgba(212,160,23,0.4) 28%, #d4a017 50%, rgba(212,160,23,0.4) 72%, transparent 95%)' }} />
        <div
          className="backdrop-blur-md border-t border-rmpg-800/80"
          style={{ background: 'linear-gradient(180deg, rgba(10,10,10,0.80) 0%, rgba(8,8,8,0.96) 60%)' }}
        >
          {/* HUD heading tape */}
          <div className="px-3 pt-1.5 pb-1 border-b border-rmpg-800/70">
            <HeadingTape heading={dir} />
          </div>
          <div className="flex items-stretch px-2 py-2">
            {/* Bay 1 — ring speed gauge */}
            <div className="flex items-center justify-center px-1">
              <SpeedGauge mph={hasFix ? mph : null} />
            </div>
            <div className="w-px self-stretch my-1 bg-gradient-to-b from-transparent via-rmpg-700 to-transparent" />

            {/* Bay 2 — dual-needle compass: heading (gold) + bearing to call (red) */}
            <div className="flex items-center justify-center px-3">
              <div className="relative shrink-0" style={{ width: 84, height: 84 }} title="Heading + bearing to call">
                <div className="absolute inset-0 rounded-full border-2 border-rmpg-600" style={{ boxShadow: 'inset 0 0 12px rgba(0,0,0,0.65)' }} />
                <span className="absolute top-0 left-1/2 -translate-x-1/2 text-[8px] text-rmpg-500">N</span>
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[8px] text-rmpg-700">S</span>
                <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[8px] text-rmpg-700">W</span>
                <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[8px] text-rmpg-700">E</span>
                {destBearing != null && (
                  <div className="absolute inset-0 flex items-start justify-center" style={{ transform: `rotate(${destBearing}deg)`, transition: 'transform 0.4s ease-out' }} title="Bearing to assigned call">
                    <div style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderBottom: '13px solid #ef4444', marginTop: 5 }} />
                  </div>
                )}
                <Navigation2
                  className="absolute inset-0 m-auto w-9 h-9 text-brand-400"
                  style={{ transform: `rotate(${dir ?? 0}deg)`, transition: 'transform 0.3s ease-out', filter: dir != null ? 'drop-shadow(0 0 4px rgba(212,160,23,0.5))' : 'none' }}
                  fill={dir != null ? '#d4a017' : 'none'}
                />
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-brand-300 bg-surface-deep px-1" style={{ borderRadius: 2 }}>
                  {dir != null ? `${Math.round(dir)}° ${compassCardinal(dir)}` : '—'}
                </span>
              </div>
            </div>
            <div className="w-px self-stretch my-1 bg-gradient-to-b from-transparent via-rmpg-700 to-transparent" />

            {/* Bay 3 — tactical proximity scope (situational awareness) */}
            <div className="flex flex-col items-center justify-center px-2">
              <div className="text-[7px] uppercase tracking-widest text-rmpg-600 mb-1 flex items-center gap-1">
                <Crosshair className="w-2.5 h-2.5 text-brand-500" /> Proximity
              </div>
              <TacticalScope heading={dir} contacts={scopeContacts} maxRangeMi={scopeMaxMi} />
            </div>
            <div className="w-px self-stretch my-1 bg-gradient-to-b from-transparent via-rmpg-700 to-transparent" />

            {/* Bay 4 — speed area-chart + G-force */}
            <div className="flex flex-col justify-center gap-1.5 px-3" style={{ width: 150 }}>
              <div>
                <div className="text-[7px] uppercase tracking-wider text-rmpg-600 mb-0.5 flex items-center gap-1"><Gauge className="w-2.5 h-2.5" /> Speed · 60s</div>
                {spark.length > 1 ? (
                  <svg viewBox={`0 0 ${spark.length - 1} 24`} preserveAspectRatio="none" style={{ width: 150, height: 30 }} aria-hidden="true">
                    <polyline points={`0,24 ${spark.map((v, i) => `${i},${24 - Math.min(24, (v / sparkMax) * 24)}`).join(' ')} ${spark.length - 1},24`} fill="#d4a01722" stroke="none" />
                    <polyline points={spark.map((v, i) => `${i},${24 - Math.min(24, (v / sparkMax) * 24)}`).join(' ')} fill="none" stroke="#d4a017" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  </svg>
                ) : <div className="flex items-center text-[8px] text-rmpg-700" style={{ height: 30 }}>awaiting speed…</div>}
              </div>
              <GForceMeter g={gForce} />
            </div>
            <div className="w-px self-stretch my-1 bg-gradient-to-b from-transparent via-rmpg-700 to-transparent" />

            {/* Bay 4 — live readouts + session stats as instrument tiles */}
            <div className="flex-1 min-w-0 self-center pl-3 pr-1">
              <div className="grid grid-cols-3 gap-1.5">
                <StatTile label="Accuracy" value={gps.accuracy != null ? `${Math.round(gps.accuracy)} m` : '—'} dim={gps.accuracy == null} />
                <StatTile label="Max" value={`${maxMph} mph`} />
                <StatTile label="Avg" value={`${Math.round(avgMph)} mph`} />
                <StatTile label="Course" value={course != null ? `${Math.round(course)}°` : '—'} dim={course == null} />
                <StatTile label="Distance" value={`${distanceMi.toFixed(2)} mi`} />
                <StatTile label="Session" value={fmtDuration(sessionMs)} />
                <StatTile label="Bearing" value={destBearing != null ? `${Math.round(destBearing)}°` : '—'} accent={destBearing != null ? '#ef4444' : undefined} dim={destBearing == null} />
                <StatTile label="To Call" value={destCrowMi != null ? `${destCrowMi.toFixed(1)} mi` : '—'} dim={destCrowMi == null} />
                <StatTile label="Source" value={src.label} accent={src.color} />
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[9px] font-mono">
                <MapPin className="w-2.5 h-2.5 text-brand-500 shrink-0" />
                <span className="truncate text-rmpg-300">{currentStreet || (hasFix ? 'Locating street…' : 'Acquiring fix…')}</span>
                <span className="shrink-0 text-rmpg-600">{hasFix ? `${gps.latitude!.toFixed(5)}, ${gps.longitude!.toFixed(5)}` : ''}</span>
                {gps.unitCallSign && <span className="ml-auto shrink-0 text-brand-300 font-bold">UNIT {gps.unitCallSign}</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
