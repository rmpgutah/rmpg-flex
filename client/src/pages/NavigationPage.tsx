// ============================================================
// RMPG Flex — Navigation / Drive Screen
// ============================================================
// A full-screen in-vehicle GPS + navigation view (the "MY GPS" HUD promoted to
// its own page). A follow-me Mapbox map (night/drive style, pitched, recenters
// and rotates to the device heading) underneath large movement instruments:
//   • Speedometer (mph) + heading compass rose with cardinal
//   • Live position / accuracy / fix-source (GPS·WiFi·IP) / link / last-sync
//   • Session travel stats (distance, duration, max speed)
//   • Turn-by-turn directions to the unit's assigned call: next-maneuver
//     banner with directional arrow, distance to the turn, live remaining
//     ETA + distance, progress bar, congestion + off-route alerts.
//
// All GPS state comes from useGpsTracking. Routing math lives in the APP-WIDE
// guidance engine (NavTripContext → useNavGuidanceEngine) so navigation keeps
// calculating while the officer is on Dispatch/Records/etc — this page only
// renders the engine's state and paints its route on the local map.
// EVERYTHING degrades: if Mapbox can't load, the instruments still render over a
// dark backdrop, so the screen is never blank in a moving vehicle.
// ============================================================

import { useRef, useState, useEffect, useLayoutEffect, useMemo, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Navigation2, Satellite, Wifi, Globe, X, AlertTriangle, MapPin, Gauge,
  CornerUpLeft, CornerUpRight, ArrowUp, ArrowUpLeft, ArrowUpRight,
  Flag, Merge, RotateCw, RotateCcw, Clock, Box, Crosshair, Maximize, Minimize,
  Flame, Search, Bell, BellOff, ShieldAlert, Footprints, Car, Building2, Activity, History,
  Route as RouteIcon, Grid3X3, type LucideIcon,
} from 'lucide-react';
import MovementReportDrawer from './navigation/MovementReportDrawer';
import CallHistoryDrawer from './navigation/CallHistoryDrawer';
import TripsDrawer from './navigation/TripsDrawer';
// ── Drive-Mode HUD lane (self-contained, drive lane only) ──
import {
  HudSpeedGauge, HudCompass, HudStatTile, HudQualityPill, HudNextManeuver,
  HudExportCluster, HudDrivingScore, HudCollapseToggle, HudSummaryLine,
  HudMuteToggle, HudMapControls, HudSourceChip, HudArrivedBanner, HudParkedBadge,
} from './navigation/hud/HudInstruments';
import { useSpeedLimit } from './navigation/hud/useSpeedLimit';
import { gpxExport, navCsvExport } from './navigation/hud/trackExport';
import { playNavTone } from './navigation/hud/navTone';
import {
  type SpeedUnit, loadSpeedUnit, saveSpeedUnit, formatSpeed, formatHeading,
  formatDistanceLong, formatDistanceMi, formatDuration as hudFormatDuration,
  etaToMinutes, arrivalClockFrom, formatCountdown, truncateLabel,
} from './navigation/hud/hudUnits';
import { buildMovementReport } from './navigation/vehicleTelemetry';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { snapToRoute } from '../hooks/useMapRouting';
import { buildCongestionGradient, CONGESTION_COLOR } from '../hooks/useNavGuidanceEngine';
import { useNavTrip } from '../context/NavTripContext';
import { whenStyleReady } from './map/utils/safeAddSource';
import { playTone } from '../utils/dispatchTones';
import { useMap3D } from './map/hooks/useMap3D';
import { mapboxgl, initMapbox, MAPBOX_STYLE_DARK } from '../utils/mapboxLoader';
import { installWebglContextRecovery, type MapCamera } from '../utils/webglRecovery';
import { getMapboxAccessToken } from '../utils/mapboxApiKey';
import { apiFetch } from '../hooks/useApi';
import { useIsMobile } from '../hooks/useIsMobile';
import { compassCardinal } from '../utils/locationImagery';
import { getSourceSafe, hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import ModuleDirectoryPage from './ModuleDirectoryPage';

// ─── Helpers ────────────────────────────────────────────────

/** Drive ⇆ Modules segmented toggle. Reflects the active mode (the old
 *  version hardcoded Drive as active) and is rendered in BOTH views so the
 *  Modules screen can always switch back to the follow-me Drive map. */
function NavViewToggle({ mode, onMode }: { mode: 'drive' | 'modules'; onMode: (m: 'drive' | 'modules') => void }) {
  const btn = (active: boolean) =>
    `text-[8px] font-bold uppercase px-1.5 py-0.5 transition-colors ${active ? 'text-brand-400' : 'text-rmpg-500 hover:text-rmpg-300'}`;
  const box = (active: boolean) => ({
    border: active ? '1px solid rgba(212,160,23,0.5)' : '1px solid transparent',
    background: active ? 'rgba(212,160,23,0.12)' : 'transparent',
    borderRadius: 2,
  });
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" onClick={() => onMode('drive')} aria-pressed={mode === 'drive'} className={btn(mode === 'drive')} style={box(mode === 'drive')}>
        <Navigation2 className="w-2.5 h-2.5 inline-block -mt-0.5 mr-0.5" />Drive
      </button>
      <button type="button" onClick={() => onMode('modules')} aria-pressed={mode === 'modules'} className={btn(mode === 'modules')} style={box(mode === 'modules')}>
        <Grid3X3 className="w-2.5 h-2.5 inline-block -mt-0.5 mr-0.5" />Modules
      </button>
    </div>
  );
}

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

interface CrimePoint { id: string; source: 'slc' | 'local' | 'ccm' | 'crash'; category: string; label: string; date: string | null; lat: number; lng: number; area?: string | null; ref?: string | null; division?: string | null; agency?: string | null; kind?: 'crime' | 'crash' | 'cfs'; severity?: number | null }

// Map color for a crime point — colored by crime CLASS so the token's hue tells
// the officer the threat type at a glance. Our own CFS is green so it reads apart
// from agency crime. Multi-agency (ccm) data is bucketed server-side into the
// same Person/Property/Society classes, so it colors identically. (No blue.)
function crimeColor(p: CrimePoint): string {
  if (p.source === 'local') return '#22c55e';
  const cat = (p.category || '').toLowerCase();
  if (cat.includes('person')) return '#ef4444';
  if (cat.includes('property')) return '#f59e0b';
  if (cat.includes('society')) return '#a855f7';
  return '#d4a017';
}

// Trim verbose agency names for the narrow panel ("… Police Department" → "PD",
// "… Department of Public Safety" → "DPS"). Keeps the city, drops the boilerplate.
function shortAgency(name: string): string {
  return (name || '')
    .replace(/\bPolice Department\b/i, 'PD')
    .replace(/\bDept of Public Safety\b/i, 'DPS')
    .replace(/\bDepartment of Public Safety\b/i, 'DPS')
    .replace(/\bSheriff'?s Office\b/i, 'SO')
    .replace(/\bUniv(ersity)? of Utah\b/i, 'U of U')
    .trim();
}

// Crash token color by SLC severity (0 = property-damage-only → up). Crashes
// render as hollow rings (separate layer) so they never blur into crime dots.
function crashColor(severity: number | null | undefined): string {
  const s = Number(severity);
  if (Number.isFinite(s) && s >= 3) return '#ef4444'; // serious / injury
  if (Number.isFinite(s) && s >= 1) return '#f59e0b'; // minor injury
  return '#e5e7eb';                                    // property damage only
}

// Coarse class bucket for the Salt Lake County overview rollup.
type CrimeClass = 'person' | 'property' | 'society' | 'cfs' | 'other';
function crimeClass(p: CrimePoint): CrimeClass {
  if (p.source === 'local') return 'cfs';
  const cat = (p.category || '').toLowerCase();
  if (cat.includes('person')) return 'person';
  if (cat.includes('property')) return 'property';
  if (cat.includes('society')) return 'society';
  return 'other';
}
const CLASS_META: Record<CrimeClass, { label: string; color: string }> = {
  person: { label: 'Person', color: '#ef4444' },
  property: { label: 'Property', color: '#f59e0b' },
  society: { label: 'Society', color: '#a855f7' },
  cfs: { label: 'RMPG CFS', color: '#22c55e' },
  other: { label: 'Other', color: '#d4a017' },
};

// Escape agency/DB-sourced strings before injecting into popup HTML.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => (
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;'
  ));
}

// Crime lookback window — wider than the original 60d for a fuller county
// overview. Both sources honor `days`; SLC is capped at 2000 records upstream.
const CRIME_WINDOW_DAYS = 90;
// Multi-agency (LexisNexis) window — the upstream caps at 500/tile and is freshest
// over a tight window, so 30d keeps it dense and current across all agencies.
const CRIME_REGIONAL_DAYS = 30;
// Crash window — the public crash dataset lags ~2-3 months, so a wide window is
// what surfaces chronic crash hot-spots (dangerous intersections) for driving.
const CRASH_WINDOW_DAYS = 365;

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
  kind: 'call' | 'crime' | 'crash';
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
const CRASH_CLUSTER_MIN = 5;         // crashes in one bin to flag a dangerous stretch

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

// Live 2-axis G-force ball — longitudinal load (accel ↑ / brake ↓) plotted
// against lateral/cornering load (left ↔ right) on a friction circle, with a
// dim gold session peak-hold ring. The most information-dense driving-dynamics
// instrument on the panel: one glance shows how hard the vehicle is loaded AND
// in which direction, right now — and the peak ring shows the worst of the run.
function GForceBall({ longG, latG, peak, size = 66 }: {
  longG: number; latG: number; peak: { accel: number; brake: number; lat: number }; size?: number;
}) {
  const c = size / 2, R = c - 9; // 1.0 g = R
  const toPx = (g: number) => Math.max(-1.15, Math.min(1.15, g)) * R;
  const mag = Math.hypot(longG, latG);
  const col = mag > 0.55 ? '#ef4444' : mag > 0.32 ? '#f59e0b' : '#22c55e';
  const peakMag = Math.min(1.15, Math.hypot(Math.max(peak.accel, peak.brake), peak.lat));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title="Live G-force — longitudinal vs lateral load · gold ring = session peak">
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" aria-hidden="true">
        {[0.5, 1.0].map((g) => (
          <circle key={g} cx={c} cy={c} r={g * R} fill="none" stroke={g === 1 ? '#2e2e2e' : '#1a1a1a'} strokeWidth="1" />
        ))}
        <line x1={c} y1={c - R} x2={c} y2={c + R} stroke="#181818" strokeWidth="1" />
        <line x1={c - R} y1={c} x2={c + R} y2={c} stroke="#181818" strokeWidth="1" />
        {peakMag > 0.05 && (
          <circle cx={c} cy={c} r={peakMag * R} fill="none" stroke="#d4a017" strokeOpacity="0.42" strokeWidth="1" strokeDasharray="2 2" />
        )}
        {/* live load vector + dot */}
        <line x1={c} y1={c} x2={c + toPx(latG)} y2={c - toPx(longG)} stroke={col} strokeWidth="1.25" strokeOpacity="0.55" />
        <circle cx={c + toPx(latG)} cy={c - toPx(longG)} r="3.2" fill={col} stroke="#0a0a0a" strokeWidth="1" style={{ transition: 'cx 0.25s ease-out, cy 0.25s ease-out' }} />
      </svg>
      <span className="absolute top-0 left-1/2 -translate-x-1/2 text-[6px] text-rmpg-600">A</span>
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[6px] text-rmpg-600">B</span>
      <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[6px] text-rmpg-700">L</span>
      <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[6px] text-rmpg-700">R</span>
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
  const isMobile = useIsMobile();
  const gps = useGpsTracking({ capture: true });
  const [viewMode, setViewMode] = useState<'drive' | 'modules'>('drive');

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

  // ── App-wide guidance engine (NavTripContext) ──
  // The route/ETA/progress/reroute CALCULATIONS live in the always-mounted
  // NavTripProvider, so navigation keeps running while the officer is on
  // Dispatch, Records, or any other page — opening/closing this HUD neither
  // starts nor resets it. This page only renders the engine's state and
  // paints the route line on its own map (the effects just below).
  const navCtx = useNavTrip();
  const guidance = navCtx?.guidance ?? null;
  const activeRoute = guidance?.activeRoute ?? null;
  const routeProgress = guidance?.routeProgress ?? null;
  const routeGeom = guidance?.routeGeom ?? null;
  const routeRender = guidance?.routeRender ?? null;
  const offRoute = guidance?.offRoute ?? false;

  // Draw / clear the engine's route on the drive map. Re-runs when the engine
  // produces a new route (including reroutes while this page was unmounted)
  // and when the map rebuilds after WebGL context recovery (mapReady cycles).
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    const removeRouteLayers = () => {
      try {
        safeRemoveLayer(map, 'rmpg-route-traveled');
        safeRemoveLayer(map, 'rmpg-route-layer');
        safeRemoveSource(map, 'rmpg-route-source');
      } catch { /* map/style torn down */ }
    };
    if (!routeRender) {
      removeRouteLayers();
      return;
    }
    const gradient = buildCongestionGradient(routeRender.cum, routeRender.totalMeters, routeRender.congestion);
    whenStyleReady(map, () => {
      try {
        removeRouteLayers();
        map.addSource('rmpg-route-source', {
          type: 'geojson',
          lineMetrics: true, // required for line-gradient
          data: { type: 'Feature', properties: {}, geometry: routeRender.geometry },
        });
        // Traveled-portion underlay (dimmed) — trimmed by the progress effect.
        map.addLayer({
          id: 'rmpg-route-traveled',
          type: 'line',
          source: 'rmpg-route-source',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#3a3a3a', 'line-width': 7, 'line-opacity': 0.5, 'line-gradient': ['step', ['line-progress'], '#3a3a3a', 0.0001, 'rgba(0,0,0,0)'] },
        });
        map.addLayer({
          id: 'rmpg-route-layer',
          type: 'line',
          source: 'rmpg-route-source',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            ...(gradient ? { 'line-gradient': gradient } : { 'line-color': CONGESTION_COLOR.unknown }),
            'line-width': 5,
            'line-opacity': 0.9,
          },
        });
      } catch { /* style race — banner/HUD still render from engine state */ }
    });
    return removeRouteLayers;
  }, [routeRender, mapReady]);

  // Trim the traveled (dimmed) portion of the line as the engine's progress
  // advances — including progress made while this page was unmounted.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !routeProgress) return;
    if (!hasLayer(map, 'rmpg-route-traveled')) return;
    try {
      map.setPaintProperty('rmpg-route-traveled', 'line-gradient', [
        'step', ['line-progress'],
        'rgba(58,58,58,0.55)', Math.max(routeProgress.fraction, 0.0001), 'rgba(0,0,0,0)',
      ]);
    } catch { /* style not ready */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProgress?.fraction, mapReady, routeRender]);

  // ── 3D corner inset ("chase-cam" perspective map) ──
  const insetContainerRef = useRef<HTMLDivElement | null>(null);
  const insetMapRef = useRef<any>(null);
  const insetMarkerRef = useRef<any>(null);
  const [insetReady, setInsetReady] = useState(false);

  // WebGL context-loss recovery for both maps. In-vehicle Toughbooks run two GL
  // contexts (main drive map + 3D inset) for a whole shift, so a GPU reclaim is
  // likely; each map rebuilds itself in place at its captured view.
  const [navRecoverNonce, setNavRecoverNonce] = useState(0);
  const [insetRecoverNonce, setInsetRecoverNonce] = useState(0);
  const navRecoverCamRef = useRef<MapCamera | null>(null);
  const navRecoveryCleanupRef = useRef<(() => void) | null>(null);
  const insetRecoveryCleanupRef = useRef<(() => void) | null>(null);

  // 3D terrain + sky + extruded buildings on BOTH the main drive map and the
  // corner inset (reuses the map page's 3D hook). The main view becomes a true
  // pitched 3D scene; the inset is a tighter, steeper chase view of the block.
  useMap3D({ map: mapReady ? mapInstanceRef.current : null, enabled: true, mapLoaded: mapReady, isLight: false });
  useMap3D({ map: insetReady ? insetMapRef.current : null, enabled: true, mapLoaded: insetReady, isLight: false });

  // Movement accumulators (session distance / duration / max speed).
  const startRef = useRef<number | null>(null);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastPosTimeRef = useRef<number | null>(null); // for position-derived speed
  const distanceRef = useRef(0);
  const [maxMph, setMaxMph] = useState(0);
  const speedHistRef = useRef<number[]>([]); // rolling mph samples for the sparkline
  const accelRef = useRef<{ mph: number; t: number } | null>(null);
  const [gForce, setGForce] = useState(0);
  // Live lateral (cornering) G + a session peak-hold envelope for the G-ball.
  const [latGLive, setLatGLive] = useState(0);
  const peakGRef = useRef({ accel: 0, brake: 0, lat: 0 });
  const headingForLatRef = useRef<{ dir: number; t: number } | null>(null);
  // Terrain-derived instruments (fed by the 3D DEM): live ground elevation +
  // cumulative session ascent. Null until DEM tiles load near the unit.
  const [elevFt, setElevFt] = useState<number | null>(null);
  const [climbFt, setClimbFt] = useState(0);
  const climbRef = useRef(0);
  const climbBaseRef = useRef<number | null>(null); // hysteresis reference for total-ascent
  // Speed derived from position when the device reports none (cellular/WiFi
  // positioning has no speed-over-ground). Keeps the gauges live everywhere.
  const [derivedMph, setDerivedMph] = useState<number | null>(null);
  const [tripOpen, setTripOpen] = useState(false); // MOVEMENT REPORT drawer (live session)
  const [tripsOpen, setTripsOpen] = useState(false); // TRIPS chain drawer (per-trip reports)
  const [logOpen, setLogOpen] = useState(false);   // CALL HISTORY drawer
  const destCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const myPosRef = useRef<{ lat: number; lng: number } | null>(null); // live pos for raw map handlers
  const crimePopupRef = useRef<any>(null);                            // single open crime "DB visual"
  const [nearbyUnits, setNearbyUnits] = useState<{ call_sign: string; status: string; lat: number; lng: number }[]>([]);
  const [crimeOn, setCrimeOn] = useState(true);
  const [crimeIncidents, setCrimeIncidents] = useState<CrimePoint[]>([]);
  const [regionalAgencies, setRegionalAgencies] = useState<string[]>([]); // county agencies in the merged feed
  const [crashOn, setCrashOn] = useState(true);          // SLC traffic-crash overlay (travel awareness)
  const [crashes, setCrashes] = useState<CrimePoint[]>([]);
  const crashPopupRef = useRef<any>(null);               // single open crash record card
  const crashHotRef = useRef(false);                     // hysteresis for the crash-area alert
  const [trailOn, setTrailOn] = useState(true); // patrol breadcrumb trail (own GPS track)
  // Live turn-banner height — the side panels flow below it so they never
  // collide with a banner that grew (destination line + ETA + steps + hazards).
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const [bannerH, setBannerH] = useState(0);
  const [currentStreet, setCurrentStreet] = useState<string | null>(null);
  const geoRef = useRef<{ lat: number; lng: number; t: number } | null>(null);
  // Destination search (address/place → route there).
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ lat: number; lng: number; label: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [destLabel, setDestLabel] = useState<string | null>(null);
  // Proximity alert tones + transient warning banner (Motorola dispatch tones).
  const [alertsOn, setAlertsOn] = useState(true);
  const [navAlert, setNavAlert] = useState<{ text: string; color: string } | null>(null);
  const alertedCallsRef = useRef<Set<string>>(new Set());
  const crimeHotRef = useRef(false);
  const approachFiredRef = useRef<string | null>(null);
  const alertTimerRef = useRef<number | null>(null);
  const [, force] = useState(0);

  // ── Drive-Mode HUD state (drive lane) ──
  const [speedUnit, setSpeedUnit] = useState<SpeedUnit>(() => loadSpeedUnit());
  const cycleSpeedUnit = () => setSpeedUnit((u) => { const next: SpeedUnit = u === 'mph' ? 'kmh' : 'mph'; saveSpeedUnit(next); return next; });
  const [footerCollapsed, setFooterCollapsed] = useState(false); // #45
  const [hudMuted, setHudMuted] = useState(false);               // #46 transient mute
  const [followActive, setFollowActive] = useState(true);        // #47 follow-me camera
  const followActiveRef = useRef(true);
  useEffect(() => { followActiveRef.current = followActive; }, [followActive]);
  const [pitched, setPitched] = useState(true);                  // #63 2D/3D
  const [mapOrientation] = useState<'north-up' | 'heading-up'>('heading-up'); // #34 (map rotates to heading)
  // #32/#53 — hard-event counters + transient G-ball flash.
  const hardBrakesRef = useRef(0);
  const hardAccelsRef = useRef(0);
  const [, forceEvents] = useState(0);
  const [gFlash, setGFlash] = useState<null | 'brake' | 'accel'>(null);
  const gFlashTimer = useRef<number | null>(null);
  const lastGSignRef = useRef(0);
  // #54 — distance-since-last-stop leg accumulator.
  const legDistRef = useRef(0);
  const stationarySinceRef = useRef<number | null>(null);
  // #64 — arrived banner transient state.
  const [arrivedLabel, setArrivedLabel] = useState<string | null>(null);
  const arrivedFiredRef = useRef<string | null>(null);

  const dir = gps.headingSmoothed ?? gps.course ?? gps.heading;
  const mph = gps.speed != null ? Math.round(gps.speed * 2.237) : null;
  // Shown on the gauges: device speed when available, else position-derived.
  const displayMph = mph ?? derivedMph;
  const hasFix = gps.latitude != null && gps.longitude != null;
  const src = SOURCE_META[gps.positionSource] || SOURCE_META.unknown;
  // #29/#52/#65/#69 — posted speed limit near the live fix (best-effort, drive lane).
  const { limitMph, buffer: limitBuffer } = useSpeedLimit(gps.latitude, gps.longitude);
  // #46 — effective tone gate: prefs.alertsOn AND not transiently muted.
  const tonesOn = alertsOn && !hudMuted;

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
        // A WebGL-loss rebuild reopens at the captured view; otherwise start at
        // the current fix (the follow effect re-centers within ~1s regardless).
        const rc = navRecoverCamRef.current;
        navRecoverCamRef.current = null;
        const map = new mapboxgl.Map({
          container: mapContainerRef.current!,
          style: MAPBOX_STYLE_DARK,
          center: rc ? rc.center : [gps.longitude ?? -111.891, gps.latitude ?? 40.7608],
          zoom: rc ? rc.zoom : 16.5,
          pitch: rc ? rc.pitch : 55,
          bearing: rc ? rc.bearing : 0,
          attributionControl: false,
          interactive: true,
        });
        map.on('load', () => {
          if (cancelled) { map.remove(); return; }
          mapInstanceRef.current = map;
          // Rebuild this map in place if the GPU drops its context.
          navRecoveryCleanupRef.current = installWebglContextRecovery(map, {
            label: 'NavigationPage.main',
            onRebuild: (camera) => {
              navRecoverCamRef.current = camera;
              if (navRecoveryCleanupRef.current) { navRecoveryCleanupRef.current(); navRecoveryCleanupRef.current = null; }
              try { markerRef.current?.remove(); } catch { /* gone */ }
              markerRef.current = null;
              if (mapInstanceRef.current) { try { mapInstanceRef.current.remove(); } catch { /* gone */ } mapInstanceRef.current = null; }
              setMapReady(false);
              setNavRecoverNonce((n) => n + 1);
            },
          });
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
      if (navRecoveryCleanupRef.current) { navRecoveryCleanupRef.current(); navRecoveryCleanupRef.current = null; }
      const m = mapInstanceRef.current;
      if (m) { try { m.remove(); } catch { /* already gone */ } mapInstanceRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRecoverNonce]);

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
          // Rebuild the inset if its GPU context drops (it follows GPS, so it
          // re-centers on the next fix — no camera capture needed).
          insetRecoveryCleanupRef.current = installWebglContextRecovery(m, {
            label: 'NavigationPage.inset',
            onRebuild: () => {
              if (insetRecoveryCleanupRef.current) { insetRecoveryCleanupRef.current(); insetRecoveryCleanupRef.current = null; }
              try { insetMarkerRef.current?.remove(); } catch { /* gone */ }
              insetMarkerRef.current = null;
              if (insetMapRef.current) { try { insetMapRef.current.remove(); } catch { /* gone */ } insetMapRef.current = null; }
              setInsetReady(false);
              setInsetRecoverNonce((n) => n + 1);
            },
          });
          insetMarkerRef.current = new mapboxgl.Marker({ color: '#d4a017' })
            .setLngLat([gps.longitude!, gps.latitude!]).addTo(m);
          setInsetReady(true);
        });
        m.on('error', () => { /* tile/style hiccups are non-fatal */ });
      } catch { /* inset is optional */ }
    })();
    return () => {
      cancelled = true;
      if (insetRecoveryCleanupRef.current) { insetRecoveryCleanupRef.current(); insetRecoveryCleanupRef.current = null; }
      const m = insetMapRef.current;
      if (m) { try { m.remove(); } catch { /* gone */ } insetMapRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, gps.latitude != null, insetRecoverNonce]);

  // ── Follow the device: recenter + rotate to heading, update marker + route ──
  useEffect(() => {
    if (gps.latitude == null || gps.longitude == null) return;
    // Movement accumulators.
    if (startRef.current == null) startRef.current = Date.now();
    const now = Date.now();
    const prev = lastPosRef.current;
    // Effective speed: device value when present, else derived from how far we
    // moved since the last fix (cellular/WiFi positioning reports no speed, so
    // the gauges would otherwise sit at "awaiting speed" in most vehicles).
    let effMph = mph;
    if (prev) {
      const d = haversineMeters(prev.lat, prev.lng, gps.latitude, gps.longitude);
      if (d > 1 && d < 5000) { distanceRef.current += d; legDistRef.current += d; } // ignore jitter + teleports (#54 leg accrues with total)
      if (effMph == null && lastPosTimeRef.current != null) {
        const dt = (now - lastPosTimeRef.current) / 1000;
        if (dt > 0.4) { let v = (d / dt) * 2.237; if (v > 120) v = 0; effMph = Math.round(v); }
      }
    }
    lastPosRef.current = { lat: gps.latitude, lng: gps.longitude };
    lastPosTimeRef.current = now;
    myPosRef.current = { lat: gps.latitude, lng: gps.longitude }; // for raw map click handlers
    setDerivedMph(mph == null ? effMph : null); // surface the derived value only when the device gives none
    if (effMph != null && effMph > maxMph) setMaxMph(effMph);
    // Feed the rolling speed sparkline (last ~60 samples).
    if (effMph != null) { const h = speedHistRef.current; h.push(effMph); if (h.length > 60) h.shift(); }
    // Longitudinal G-force from the speed delta (mph/s → g; 1 g ≈ 21.94 mph/s).
    if (effMph != null) {
      const p2 = accelRef.current;
      if (p2 && now > p2.t) {
        const g = ((effMph - p2.mph) / ((now - p2.t) / 1000)) / 21.94;
        setGForce(g);
        if (g > 0) peakGRef.current.accel = Math.max(peakGRef.current.accel, g);
        else if (g < 0) peakGRef.current.brake = Math.max(peakGRef.current.brake, -g);
        // #32/#53 — hard-brake / hard-accel events (threshold 0.35 g), edge-
        // triggered so one event counts once, with a transient amber G-ball flash.
        const HARD = 0.35;
        if (g <= -HARD && lastGSignRef.current > -HARD) {
          hardBrakesRef.current += 1; forceEvents((n) => n + 1);
          setGFlash('brake');
          if (gFlashTimer.current) window.clearTimeout(gFlashTimer.current);
          gFlashTimer.current = window.setTimeout(() => setGFlash(null), 600);
        } else if (g >= HARD && lastGSignRef.current < HARD) {
          hardAccelsRef.current += 1; forceEvents((n) => n + 1);
          setGFlash('accel');
          if (gFlashTimer.current) window.clearTimeout(gFlashTimer.current);
          gFlashTimer.current = window.setTimeout(() => setGFlash(null), 600);
        }
        lastGSignRef.current = g;
      }
      accelRef.current = { mph: effMph, t: now };
    }
    // #54 — reset the leg odometer after >3s stationary (speed ~0).
    if (effMph != null && effMph <= 1) {
      if (stationarySinceRef.current == null) stationarySinceRef.current = now;
      else if (now - stationarySinceRef.current > 3000) legDistRef.current = 0;
    } else if (effMph != null && effMph > 2) {
      stationarySinceRef.current = null;
    }
    // Live lateral (cornering) G from turn-rate × speed — mirrors the TRIP
    // report's math but live, so the bottom-bar G-ball shows cornering load
    // without opening the drawer. Course-over-ground heading is steadier than
    // device heading and the >8 mph gate kills standstill heading jitter.
    if (dir != null && effMph != null && effMph > 8) {
      const hp = headingForLatRef.current;
      if (hp && now > hp.t) {
        let dd = (dir - hp.dir) % 360; if (dd > 180) dd -= 360; if (dd < -180) dd += 360;
        const dts = (now - hp.t) / 1000;
        if (dts > 0.05 && dts < 10) {
          const omega = (dd / dts) * Math.PI / 180;     // rad/s, signed (+right / −left)
          let lg = (omega * (effMph / 2.237)) / 9.80665; // ω·v / g
          if (!Number.isFinite(lg) || Math.abs(lg) > 2) lg = 0; // clamp GPS noise
          setLatGLive(lg);
          peakGRef.current.lat = Math.max(peakGRef.current.lat, Math.abs(lg));
        }
      }
      headingForLatRef.current = { dir, t: now };
    } else if (effMph != null && effMph <= 8) {
      setLatGLive(0);
      if (dir != null) headingForLatRef.current = { dir, t: now };
    }

    const map = mapInstanceRef.current;
    if (map && mapReady) {
      markerRef.current?.setLngLat([gps.longitude, gps.latitude]);
      // #47 — only recenter when follow-me is active; the marker still tracks so
      // the unit stays visible after the operator pans the map away.
      if (followActiveRef.current) {
        map.easeTo({
          center: [gps.longitude, gps.latitude],
          bearing: dir ?? map.getBearing(),
          duration: 800,
          essential: true,
        });
      }
      // Route progress / off-route recompute now happens app-wide in
      // NavTripProvider (guidance.updateOrigin fed by the provider's GPS),
      // so no per-page origin push is needed here.
      // Terrain-derived instruments: sample TRUE ground elevation from the 3D
      // DEM (exaggerated:false → real meters, not the 1.15× visual lift) and
      // accumulate session ascent with a 1.5 ft deadband so DEM noise / minor
      // dips don't inflate the climb total.
      const elM = map.queryTerrainElevation([gps.longitude, gps.latitude], { exaggerated: false });
      if (elM != null && Number.isFinite(elM)) {
        const ft = elM * 3.28084;
        setElevFt(ft);
        const base = climbBaseRef.current;
        if (base == null) climbBaseRef.current = ft;
        else if (ft > base + 1.5) { climbRef.current += ft - base; setClimbFt(climbRef.current); climbBaseRef.current = ft; }
        else if (ft < base) climbBaseRef.current = ft; // descending → lower the trough for the next climb
      }
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

  // ── #47 — disable follow-me when the operator drags the map ──
  // A user pan should pin the view where they put it; the recenter button (or a
  // route refit) re-arms follow. Listener bound once the map is up.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    const onDragStart = () => setFollowActive(false);
    map.on('dragstart', onDragStart);
    return () => { try { map.off('dragstart', onDragStart); } catch { /* map gone */ } };
  }, [mapReady]);

  // ── #47/#62/#63 — lower-HUD map control handlers (drive lane) ──
  const recenterMap = () => {
    setFollowActive(true);
    const map = mapInstanceRef.current;
    if (map && gps.latitude != null && gps.longitude != null) {
      map.easeTo({ center: [gps.longitude, gps.latitude], bearing: dir ?? map.getBearing(), duration: 500, essential: true });
    }
  };
  const zoomMap = (delta: number) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    try { map.easeTo({ zoom: Math.max(3, Math.min(20, map.getZoom() + delta)), duration: 250 }); } catch { /* no map */ }
  };
  const togglePitch = () => {
    const map = mapInstanceRef.current;
    setPitched((p) => {
      const next = !p;
      if (map) { try { map.easeTo({ pitch: next ? 55 : 0, duration: 400 }); } catch { /* no map */ } }
      return next;
    });
  };

  // ── Re-adopt an in-flight route on mount ──
  // The guidance engine outlives this page: if the officer routed somewhere,
  // switched to Dispatch/Records, and came back, the destination is still
  // active in NavTripContext. Seed the page-local refs (arrival alerts,
  // destination label) from it and CLAIM the route so the assigned-call
  // auto-route below can't clobber it. Runs once, before the auto-route
  // effect (declaration order = mount execution order).
  const routedCallRef = useRef<number | null>(null);
  useEffect(() => {
    const dest = guidance?.getDestination();
    if (!dest) return;
    destCoordsRef.current = { lat: dest.lat, lng: dest.lng };
    setDestLabel(dest.label ?? (dest.callNumber !== dest.unitCallSign ? dest.callNumber : null));
    routedCallRef.current = -1; // claim — an engine route is already active
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-route to the unit's assigned call, once the map is ready ──
  useEffect(() => {
    if (!mapReady || gps.latitude == null || gps.longitude == null) return;
    // Guidance already active (re-adopted above, or started elsewhere) —
    // never clobber a live route with the assigned-call auto-route.
    if (guidance?.getDestination()) return;
    let cancelled = false;
    (async () => {
      try {
        // The /dispatch/gps/my-unit read can be shadowed by the edge stub
        // returning a hollow {unit:null} (HTTP 200) — a TRUTHY object whose
        // .current_call_id is undefined. Unwrap a possible {unit} wrapper and
        // require a real numeric id before trusting the payload (mirrors the
        // pickUnit guard in useGpsTracking.ts).
        const resp = await apiFetch<any>('/dispatch/gps/my-unit').catch(() => null);
        const unit = resp && typeof resp === 'object' ? ('unit' in resp ? resp.unit : resp) : null;
        if (cancelled || !unit || typeof unit.id !== 'number' || !unit.current_call_id) return;
        if (routedCallRef.current === unit.current_call_id) return; // already routed
        if (guidance?.getDestination()) return; // raced a manual route — keep it
        const call = await apiFetch<{ call_number: string; latitude: number | null; longitude: number | null }>(`/dispatch/calls/${unit.current_call_id}`).catch(() => null);
        if (cancelled || !call || call.latitude == null || call.longitude == null) return;
        routedCallRef.current = unit.current_call_id;
        destCoordsRef.current = { lat: call.latitude, lng: call.longitude };
        await guidance?.startGuidance(unit.call_sign, call.call_number, gps.latitude!, gps.longitude!, call.latitude, call.longitude);
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
      await guidance?.startGuidance('NAV', label, gps.latitude, gps.longitude, lat, lng, label)?.catch(() => {});
    }
  };
  const clearDestination = () => {
    guidance?.stopGuidance();
    destCoordsRef.current = null;
    setDestLabel(null);
    routedCallRef.current = null;
  };
  const refitRoute = () => {
    const geom = routeGeom;
    if (!geom?.coords?.length || !mapInstanceRef.current) return;
    const coords = geom.coords;
    const bounds = coords.reduce(
      (b, [lng, lat]) => { b[0][0] = Math.min(b[0][0], lng); b[0][1] = Math.min(b[0][1], lat); b[1][0] = Math.max(b[1][0], lng); b[1][1] = Math.max(b[1][1], lat); return b; },
      [[Infinity, Infinity], [-Infinity, -Infinity]] as [[number, number], [number, number]],
    );
    mapInstanceRef.current.fitBounds(bounds, { padding: 60, maxZoom: 16 });
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

  // ── Crime + crash data layers ──
  // Fetch ALL county sources and merge for a full Salt Lake County picture:
  //   • /crime/slc      — Salt Lake City PD (its own ArcGIS feed)
  //   • /crime/regional — every OTHER county agency (West Valley, Sandy, Murray,
  //                       Unified PD, U of U DPS, …) via LexisNexis aggregation
  //   • /crime/local    — our own dispatched CFS
  //   • /crime/crashes  — SLC traffic crashes (kept on its own layer, travel-aware)
  // Refresh every 10 min. Best-effort: any failed source just yields fewer points
  // (each is KV-cached server-side, so this is cheap to poll).
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const [slc, regional, local, crash] = await Promise.all([
          apiFetch<{ incidents?: CrimePoint[] }>(`/crime/slc?days=${CRIME_WINDOW_DAYS}&limit=2000`).catch(() => null),
          apiFetch<{ incidents?: CrimePoint[]; agencies?: string[] }>(`/crime/regional?days=${CRIME_REGIONAL_DAYS}`).catch(() => null),
          apiFetch<{ incidents?: CrimePoint[] }>(`/crime/local?days=${CRIME_WINDOW_DAYS}&limit=2000`).catch(() => null),
          apiFetch<{ incidents?: CrimePoint[] }>(`/crime/crashes?days=${CRASH_WINDOW_DAYS}&limit=2500`).catch(() => null),
        ]);
        if (cancelled) return;
        setCrimeIncidents([...(slc?.incidents || []), ...(regional?.incidents || []), ...(local?.incidents || [])]);
        setRegionalAgencies(regional?.agencies || []);
        setCrashes(crash?.incidents || []);
      } catch { /* best-effort — crime/crash overlays are supplemental */ }
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
        // Carry the whole record so the click popup ("DB visual") can read it
        // straight off the feature — no second lookup, no stale React closure.
        properties: {
          color: crimeColor(p),
          source: p.source, category: p.category || '', label: p.label || '',
          date: p.date || '', area: p.area || '', ref: p.ref || '', division: p.division || '',
          agency: p.agency || '', lat: p.lat, lng: p.lng,
        },
      })),
    };
    try {
      const existing = getSourceSafe<any>(map, SRC);
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
      if (hasLayer(map, 'rmpg-crime-heat')) map.setLayoutProperty('rmpg-crime-heat', 'visibility', vis);
      if (hasLayer(map, 'rmpg-crime-pts')) map.setLayoutProperty('rmpg-crime-pts', 'visibility', vis);
    } catch { /* style mid-reload — next data tick re-applies */ }
  }, [crimeIncidents, crimeOn, mapReady]);

  // ── Traffic-crash layer (travel awareness) ──
  // Crashes render as hollow rings (not solid dots) so they're instantly
  // distinct from crime tokens, with the ring colored by severity. One GeoJSON
  // source, added once then setData on refresh; visibility follows the toggle.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    const SRC = 'rmpg-crash';
    const fc = {
      type: 'FeatureCollection',
      features: crashes.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: {
          scolor: crashColor(p.severity),
          source: p.source, category: p.category || 'Crash', label: p.label || 'Crash',
          date: p.date || '', area: p.area || '', ref: p.ref || '', severity: p.severity ?? '',
          lat: p.lat, lng: p.lng,
        },
      })),
    };
    try {
      const existing = getSourceSafe<any>(map, SRC);
      if (existing) {
        (existing as any).setData(fc);
      } else {
        map.addSource(SRC, { type: 'geojson', data: fc });
        map.addLayer({
          id: 'rmpg-crash-pts', type: 'circle', source: SRC,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.6, 17, 6],
            'circle-color': 'rgba(0,0,0,0)',           // hollow center → reads as a ring
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 17, 1.8],
            'circle-stroke-color': ['get', 'scolor'],
            'circle-opacity': 1,
          },
        });
      }
      const vis = crashOn ? 'visible' : 'none';
      if (hasLayer(map, 'rmpg-crash-pts')) map.setLayoutProperty('rmpg-crash-pts', 'visibility', vis);
    } catch { /* style mid-reload — next data tick re-applies */ }
  }, [crashes, crashOn, mapReady]);

  // ── Click a crime/CFS point → "DB visual" record card (Mapbox popup) ──
  // Registered ONCE on the layer id (Mapbox tolerates binding before the layer
  // exists). The whole record rides on the feature properties, so the handler
  // reads it straight off the click — no second fetch, no stale React closure.
  // Distance/bearing from the unit use myPosRef (the live position).
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    const LAYER = 'rmpg-crime-pts';

    const onClick = (e: any) => {
      const f = e?.features?.[0];
      if (!f) return;
      const pr = f.properties || {};
      const lng = Number(pr.lng), lat = Number(pr.lat);
      const isLocal = pr.source === 'local';
      const isCcm = pr.source === 'ccm';
      const accent = String(pr.color || '#d4a017');
      // Source attribution: our CFS, SLC city, or a named county agency (ccm).
      const srcTag = isLocal ? 'RMPG CFS · county'
        : isCcm ? `${pr.agency || 'County agency'} · county`
        : 'SLCPD · city';
      const me = myPosRef.current;
      let relHtml = '';
      if (me && Number.isFinite(lat) && Number.isFinite(lng)) {
        const mi = haversineMeters(me.lat, me.lng, lat, lng) / 1609.34;
        const brg = bearingTo(me.lat, me.lng, lat, lng);
        relHtml = `<div class="rmpg-pop-rel">${mi.toFixed(2)} mi · ${String(Math.round(brg)).padStart(3, '0')}° ${compassCardinal(brg)} from unit</div>`;
      }
      const row = (k: string, v: string | null | undefined) =>
        v ? `<div class="rmpg-pop-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(String(v))}</b></div>` : '';
      const html =
        `<div class="rmpg-pop" style="--accent:${escapeHtml(accent)}">` +
          `<div class="rmpg-pop-head"><span class="rmpg-pop-dot"></span>` +
            `<span class="rmpg-pop-title">${escapeHtml(String(pr.label || 'Incident'))}</span></div>` +
          `<div class="rmpg-pop-tag">${escapeHtml(srcTag)} · ${escapeHtml(String(pr.category || ''))}</div>` +
          row('Ref', pr.ref) +
          row(isLocal ? 'Priority' : 'Class', pr.category) +
          (isCcm ? row('Agency', pr.agency) : '') +
          row('When', pr.date) +
          (!isCcm ? row('Area', pr.area) : '') +
          (!isLocal && !isCcm && pr.division && pr.division !== pr.area ? row('Division', pr.division) : '') +
          (Number.isFinite(lat) && Number.isFinite(lng) ? row('Coords', `${lat.toFixed(5)}, ${lng.toFixed(5)}`) : '') +
          relHtml +
        `</div>`;

      try { crimePopupRef.current?.remove(); } catch { /* none open */ }
      // closeOnClick:false — we replace the prior popup ourselves, so the
      // map-level close can't race the layer-level open on an adjacent point.
      crimePopupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '260px', className: 'rmpg-crime-popup', offset: 10 })
        .setLngLat([Number.isFinite(lng) ? lng : e.lngLat.lng, Number.isFinite(lat) ? lat : e.lngLat.lat])
        .setHTML(html)
        .addTo(map);
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };

    map.on('click', LAYER, onClick);
    map.on('mouseenter', LAYER, onEnter);
    map.on('mouseleave', LAYER, onLeave);
    return () => {
      try {
        map.off('click', LAYER, onClick);
        map.off('mouseenter', LAYER, onEnter);
        map.off('mouseleave', LAYER, onLeave);
      } catch { /* map gone */ }
    };
  }, [mapReady]);

  // ── Click a crash ring → crash record card (separate popup ref from crime) ──
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    const LAYER = 'rmpg-crash-pts';

    const onClick = (e: any) => {
      const f = e?.features?.[0];
      if (!f) return;
      const pr = f.properties || {};
      const lng = Number(pr.lng), lat = Number(pr.lat);
      const accent = String(pr.scolor || '#e5e7eb');
      const me = myPosRef.current;
      let relHtml = '';
      if (me && Number.isFinite(lat) && Number.isFinite(lng)) {
        const mi = haversineMeters(me.lat, me.lng, lat, lng) / 1609.34;
        const brg = bearingTo(me.lat, me.lng, lat, lng);
        relHtml = `<div class="rmpg-pop-rel">${mi.toFixed(2)} mi · ${String(Math.round(brg)).padStart(3, '0')}° ${compassCardinal(brg)} from unit</div>`;
      }
      const sevNum = Number(pr.severity);
      const sevTxt = Number.isFinite(sevNum) ? (sevNum >= 3 ? `Serious (${sevNum})` : sevNum >= 1 ? `Injury (${sevNum})` : 'Property damage') : null;
      const row = (k: string, v: string | null | undefined) =>
        v ? `<div class="rmpg-pop-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(String(v))}</b></div>` : '';
      const html =
        `<div class="rmpg-pop" style="--accent:${escapeHtml(accent)}">` +
          `<div class="rmpg-pop-head"><span class="rmpg-pop-dot"></span>` +
            `<span class="rmpg-pop-title">${escapeHtml(String(pr.label || 'Crash'))}</span></div>` +
          `<div class="rmpg-pop-tag">SLC traffic crash · history</div>` +
          row('Case', pr.ref) +
          row('Severity', sevTxt) +
          row('When', pr.date ? String(pr.date).slice(0, 10) : '') +
          row('Location', pr.area) +
          (Number.isFinite(lat) && Number.isFinite(lng) ? row('Coords', `${lat.toFixed(5)}, ${lng.toFixed(5)}`) : '') +
          relHtml +
        `</div>`;

      try { crashPopupRef.current?.remove(); } catch { /* none open */ }
      crashPopupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '260px', className: 'rmpg-crime-popup', offset: 10 })
        .setLngLat([Number.isFinite(lng) ? lng : e.lngLat.lng, Number.isFinite(lat) ? lat : e.lngLat.lat])
        .setHTML(html)
        .addTo(map);
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };

    map.on('click', LAYER, onClick);
    map.on('mouseenter', LAYER, onEnter);
    map.on('mouseleave', LAYER, onLeave);
    return () => {
      try {
        map.off('click', LAYER, onClick);
        map.off('mouseenter', LAYER, onEnter);
        map.off('mouseleave', LAYER, onLeave);
      } catch { /* map gone */ }
    };
  }, [mapReady]);

  // ── Patrol breadcrumb trail (own GPS track, age-faded) — restored from #1001 ──
  // Draw the unit's captured session track as ONE line whose color fades
  // oldest→newest. `line-gradient` keyed on `line-progress` does the fade on the
  // GPU (one layer, not N markers) — needs `lineMetrics: true`. Driven by
  // `capturedCount`, which ticks on every accepted fix. Best-effort like crime.
  const trailPtsCount = gps.capturedCount;
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    const SRC = 'rmpg-trail';
    const pts = gps.getCapturedTrack();
    const coords = pts.map((p) => [p.lng, p.lat] as [number, number]);
    // A LineString needs ≥2 vertices; below that, feed an empty collection so the
    // layer simply renders nothing rather than emitting invalid geometry.
    const data: any = coords.length >= 2
      ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
      : { type: 'FeatureCollection', features: [] };
    try {
      const existing = getSourceSafe<any>(map, SRC);
      if (existing) {
        existing.setData(data);
      } else {
        map.addSource(SRC, { type: 'geojson', lineMetrics: true, data });
        map.addLayer({
          id: 'rmpg-trail-line', type: 'line', source: SRC,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 17, 4.5],
            // Oldest end transparent → recent end bright gold (the "comet tail").
            'line-gradient': ['interpolate', ['linear'], ['line-progress'],
              0, 'rgba(212,160,23,0.0)',
              0.55, 'rgba(212,160,23,0.30)',
              0.9, 'rgba(212,160,23,0.75)',
              1, 'rgba(255,209,102,0.95)'],
          },
        });
      }
      if (hasLayer(map, 'rmpg-trail-line')) {
        map.setLayoutProperty('rmpg-trail-line', 'visibility', trailOn ? 'visible' : 'none');
      }
    } catch { /* style mid-reload — next fix re-applies */ }
    // gps.getCapturedTrack is a stable useCallback; trailPtsCount is the live trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trailPtsCount, trailOn, mapReady]);

  const crimeCounts = useMemo(() => {
    let slc = 0, ccm = 0, local = 0;
    for (const p of crimeIncidents) {
      if (p.source === 'local') local++;
      else if (p.source === 'ccm') ccm++;
      else slc++;
    }
    return { slc, ccm, local, total: crimeIncidents.length };
  }, [crimeIncidents]);

  // Crime incidents within ~½ mile of the unit — a live "how hot is here" field
  // (and the basis for the high-crime-area alert).
  const crimeNearby = useMemo(() => {
    if (gps.latitude == null || gps.longitude == null) return 0;
    let n = 0;
    for (const p of crimeIncidents) { if (haversineMeters(gps.latitude, gps.longitude, p.lat, p.lng) <= 805) n++; }
    return n;
  }, [crimeIncidents, gps.latitude, gps.longitude]);

  // Crashes within ~½ mile — drives the crash-area alert + the panel readout.
  const crashNearby = useMemo(() => {
    if (gps.latitude == null || gps.longitude == null) return 0;
    let n = 0;
    for (const p of crashes) { if (haversineMeters(gps.latitude, gps.longitude, p.lat, p.lng) <= 805) n++; }
    return n;
  }, [crashes, gps.latitude, gps.longitude]);

  // ── Salt Lake County crime overview rollup ──
  // Class breakdown + busiest agencies + busiest city neighborhoods, computed
  // from the merged dataset already in memory. Areas come only from SLC (city)
  // data; agency counts come from the multi-agency (ccm) feed — the panel labels
  // each scope honestly so nothing is implied beyond what the data supports.
  const crimeOverview = useMemo(() => {
    const byClass: Record<CrimeClass, number> = { person: 0, property: 0, society: 0, cfs: 0, other: 0 };
    const areaCount = new Map<string, number>();
    const agencyCount = new Map<string, number>();
    for (const p of crimeIncidents) {
      byClass[crimeClass(p)]++;
      const a = (p.area || '').trim();
      if (a && p.source === 'slc') areaCount.set(a, (areaCount.get(a) || 0) + 1);
      const ag = (p.agency || '').trim();
      if (ag && p.source === 'ccm') agencyCount.set(ag, (agencyCount.get(ag) || 0) + 1);
    }
    const topAreas = [...areaCount.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
    const topAgencies = [...agencyCount.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
    const maxClass = Math.max(1, byClass.person, byClass.property, byClass.society, byClass.cfs);
    return { byClass, topAreas, topAgencies, maxClass };
  }, [crimeIncidents]);

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
    apiFetch<{ address: string | null }>(`/geocode/reverse?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`)
      .then((r) => { setCurrentStreet(r?.address || null); })
      .catch(() => { /* keep last known street */ });
  }, [gps.latitude, gps.longitude]);

  const sessionMs = startRef.current ? Date.now() - startRef.current : 0;
  const distanceMi = distanceRef.current / 1609.34;
  const avgMph = sessionMs > 60000 ? distanceMi / (sessionMs / 3600000) : 0;
  const clock = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const spark = speedHistRef.current;
  const sparkMax = Math.max(60, maxMph, ...spark);
  const course = gps.course ?? null;
  // Rich movement telemetry for the TRIP drawer — built from the captured GPS
  // track (so it works without device speed). Rebuilt only while the drawer is
  // open, retriggered as fixes accrue (capturedCount ticks ~1/sec).
  const movementReport = useMemo(
    () => (tripOpen ? buildMovementReport(gps.getCapturedTrack()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tripOpen, gps.capturedCount],
  );
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

  // ── Route corridor hazard scan (#1001) ──
  // What the unit is about to drive INTO: active calls + crime hot-spots that
  // snap onto the planned route AHEAD of the unit's current progress. #1001
  // shipped the CorridorHazard type, tuning constants, scoreCorridorHazard(),
  // and the "Ahead on route" panel UI but never wired the scan — done here over
  // routeGeom + nearbyCalls + crimeIncidents (empty → panel hidden, no route).
  const corridorHazards = useMemo<CorridorHazard[]>(() => {
    const geom = routeGeom;
    if (!geom || geom.coords.length < 2 || myLat == null || myLng == null) return [];
    const { coords, cum } = geom;

    // The unit's own distance along the route — only hazards ahead of this count.
    const myAlong = snapToRoute(coords, cum, myLat, myLng).distAlong;

    // Coarse bbox prefilter (generous pad) so the precise snap only runs on
    // points that could plausibly be in-corridor; snapToRoute does the exact
    // off-route + along-route test.
    const bb = routeBBox(coords);
    const pad = 0.0015; // ~165 m — comfortably covers the 70 m corridor either axis
    const nearBox = (lat: number, lng: number) =>
      lat >= bb.s - pad && lat <= bb.n + pad && lng >= bb.w - pad && lng <= bb.e + pad;

    // On the path (within corridor width) AND ahead of us, up to the lookahead
    // (not one we're already on top of). Returns meters-ahead, or null.
    const aheadIfInCorridor = (offM: number, along: number): number | null => {
      if (offM > CORRIDOR_HAZARD_M) return null;
      const ahead = along - myAlong;
      if (ahead < CORRIDOR_MIN_AHEAD_M || ahead > CORRIDOR_LOOKAHEAD_M) return null;
      return ahead;
    };

    const hazards: CorridorHazard[] = [];

    // 1) Active calls ahead — each is its own hazard, severity by priority.
    for (const call of nearbyCalls) {
      if (!nearBox(call.lat, call.lng)) continue;
      const { offRouteMeters, distAlong } = snapToRoute(coords, cum, call.lat, call.lng);
      const ahead = aheadIfInCorridor(offRouteMeters, distAlong);
      if (ahead == null) continue;
      const p = (call.priority || '').toUpperCase();
      const severity = p === 'P1' ? 3 : p === 'P2' ? 2 : 1;
      hazards.push({
        kind: 'call',
        label: p || 'CALL',
        sub: [call.incident_type, call.call_number].filter(Boolean).join(' · '),
        aheadMi: ahead / 1609.34,
        color: severity >= 3 ? '#ef4444' : severity === 2 ? '#f59e0b' : '#fbbf24',
        lat: call.lat, lng: call.lng,
        severity,
      });
    }

    // 2) Crime hot-segments — bin in-corridor crimes by along-route distance and
    // flag a bin only when it clusters (>= CRIME_CLUSTER_MIN). A lone incident is
    // noise; a tight cluster is a hot stretch worth the heads-up.
    const bins = new Map<number, { count: number; along: number; lat: number; lng: number; label: string }>();
    for (const c of crimeIncidents) {
      if (!nearBox(c.lat, c.lng)) continue;
      const { offRouteMeters, distAlong } = snapToRoute(coords, cum, c.lat, c.lng);
      if (aheadIfInCorridor(offRouteMeters, distAlong) == null) continue;
      const key = Math.floor(distAlong / CRIME_CLUSTER_BIN_M);
      const cur = bins.get(key);
      if (cur) cur.count += 1;
      else bins.set(key, { count: 1, along: distAlong, lat: c.lat, lng: c.lng, label: c.label || c.category });
    }
    for (const b of bins.values()) {
      if (b.count < CRIME_CLUSTER_MIN) continue;
      const severity = b.count >= CRIME_CLUSTER_MIN * 2 ? 3 : 2;
      hazards.push({
        kind: 'crime',
        label: 'CRIME',
        sub: `${b.count} incidents · ${b.label}`,
        aheadMi: (b.along - myAlong) / 1609.34,
        color: severity >= 3 ? '#ef4444' : '#f59e0b',
        lat: b.lat, lng: b.lng,
        severity,
      });
    }

    // 3) Crash hot-segments — same binning over the crash layer. A stretch of road
    // with repeated collisions ahead is a TRAVEL hazard worth a heads-up, distinct
    // from crime. A serious crash in the bin bumps severity.
    const crashBins = new Map<number, { count: number; along: number; lat: number; lng: number; serious: boolean }>();
    for (const c of crashes) {
      if (!nearBox(c.lat, c.lng)) continue;
      const { offRouteMeters, distAlong } = snapToRoute(coords, cum, c.lat, c.lng);
      if (aheadIfInCorridor(offRouteMeters, distAlong) == null) continue;
      const key = Math.floor(distAlong / CRIME_CLUSTER_BIN_M);
      const cur = crashBins.get(key);
      const serious = Number(c.severity) >= 3;
      if (cur) { cur.count += 1; cur.serious = cur.serious || serious; }
      else crashBins.set(key, { count: 1, along: distAlong, lat: c.lat, lng: c.lng, serious });
    }
    for (const b of crashBins.values()) {
      if (b.count < CRASH_CLUSTER_MIN) continue;
      const severity = b.serious || b.count >= CRASH_CLUSTER_MIN * 2 ? 3 : 2;
      hazards.push({
        kind: 'crash',
        label: 'CRASH',
        sub: `${b.count} crashes · accident-prone`,
        aheadMi: (b.along - myAlong) / 1609.34,
        color: severity >= 3 ? '#ef4444' : '#f59e0b',
        lat: b.lat, lng: b.lng,
        severity,
      });
    }

    // Highest urgency first — the panel shows the top 4.
    return hazards.sort((a, b) => scoreCorridorHazard(b) - scoreCorridorHazard(a));
  }, [routeGeom, nearbyCalls, crimeIncidents, crashes, myLat, myLng]);
  const corridorCritical = corridorHazards.filter((h) => h.severity >= 3).length;
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

  // ── Map halo for corridor hazards (restored from #1001) ──
  // Ring each on-route hazard with a colored halo so it's obvious on the map,
  // not just in the panel. Two circle layers: a soft fill halo + a crisp ring
  // (circle-opacity 0 + a stroke). Severity scales the radius. Best-effort.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    const SRC = 'rmpg-corridor';
    const fc = {
      type: 'FeatureCollection',
      features: corridorHazards.map((h) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [h.lng, h.lat] },
        properties: { color: h.color, r: 8 + h.severity * 4 },
      })),
    };
    try {
      const existing = getSourceSafe<any>(map, SRC);
      if (existing) {
        existing.setData(fc);
      } else {
        map.addSource(SRC, { type: 'geojson', data: fc });
        map.addLayer({
          id: 'rmpg-corridor-halo', type: 'circle', source: SRC,
          paint: {
            'circle-radius': ['+', ['get', 'r'], 9],
            'circle-color': ['get', 'color'], 'circle-opacity': 0.14, 'circle-blur': 0.6,
          },
        });
        map.addLayer({
          id: 'rmpg-corridor-ring', type: 'circle', source: SRC,
          paint: {
            'circle-radius': ['get', 'r'],
            'circle-color': ['get', 'color'], 'circle-opacity': 0,
            'circle-stroke-width': 2, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-opacity': 0.95,
          },
        });
      }
    } catch { /* style mid-reload — next scan re-applies */ }
  }, [corridorHazards, mapReady]);

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

  // 2b) Crash-prone area — entering ½mi with ≥10 historical crashes (accident
  //     cluster). Hysteresis re-arms below 6. A softer "warning" tone than crime.
  useEffect(() => {
    if (!alertsOn || !crashOn) return;
    if (!crashHotRef.current && crashNearby >= 10) {
      crashHotRef.current = true;
      fireAlert('warning', `Accident-prone area · ${crashNearby} crashes within ½mi`, '#e5e7eb');
    } else if (crashHotRef.current && crashNearby < 6) {
      crashHotRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crashNearby, alertsOn, crashOn]);

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
  useEffect(() => () => { if (gFlashTimer.current) window.clearTimeout(gFlashTimer.current); }, []);

  // #64 — destination-reached confirmation banner. Crosses the same ~800 ft
  // approach threshold but shows a dismissible "Arrived" card (not just a tone),
  // once per destination. Re-arms when the destination changes or clears.
  useEffect(() => {
    const d = destCoordsRef.current;
    if (destCrowMi == null || !d) { arrivedFiredRef.current = null; return; }
    const key = `${d.lat.toFixed(4)},${d.lng.toFixed(4)}`;
    if (arrivedFiredRef.current !== key && destCrowMi <= 0.15) {
      arrivedFiredRef.current = key;
      setArrivedLabel(destLabel || activeRoute?.callNumber || 'destination');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destCrowMi]);

  const step = useMemo(
    () => pickCurrentStep(activeRoute?.steps, routeProgress?.fraction ?? 0, activeRoute?.distanceMeters ?? 0),
    [activeRoute, routeProgress],
  );
  const StepIcon = step ? maneuverIcon(step.maneuverType, step.modifier) : ArrowUp;

  // ── Drive-Mode HUD derived values (drive lane) ──
  // Distance remaining to the NEXT maneuver point (#41/#42): how far into the
  // current step we are vs the step's own length, derived from route progress.
  const distanceToTurnMeters = useMemo(() => {
    const steps = activeRoute?.steps;
    if (!steps || steps.length === 0) return null;
    const total = activeRoute?.distanceMeters ?? 0;
    const done = Math.max(0, Math.min(1, routeProgress?.fraction ?? 0)) * total;
    let acc = 0;
    for (let i = 0; i < steps.length; i++) {
      acc += steps[i].distanceMeters;
      if (acc >= done) return Math.max(0, acc - done);
    }
    return null;
  }, [activeRoute, routeProgress]);
  // #70 — parked: speed ~0 for >5s (dims non-essential tiles, shows badge).
  const parkedSinceRef = useRef<number | null>(null);
  const liveMph = hasFix ? displayMph : null;
  if (liveMph != null && liveMph <= 1) { if (parkedSinceRef.current == null) parkedSinceRef.current = Date.now(); }
  else if (liveMph != null && liveMph > 2) parkedSinceRef.current = null;
  const parked = parkedSinceRef.current != null && Date.now() - parkedSinceRef.current > 5000;
  // #49 — ETA mirror (countdown + arrival clock) from route progress.
  const etaMins = etaToMinutes(routeProgress?.remainingEta ?? activeRoute?.eta ?? '');
  const etaArrival = arrivalClockFrom(etaMins);
  const etaCountdown = etaMins > 0 ? formatCountdown(etaMins) : null;
  // #55/#56 — resolved day/night theme + brightness (drive lane reads prefs.brightness
  // via the alert/brightness model; here we derive night from the local hour as a
  // self-contained fallback so the footer dims without depending on other lanes).
  const nightTheme = useMemo(() => { const h = new Date().getHours(); return h >= 19 || h < 6; }, []);

  // Measure the live turn-banner height so the corner panels can flow below it.
  // ResizeObserver catches every content change (added steps, off-route row,
  // corridor hazards); we re-attach when the banner mounts/unmounts.
  //
  // useLayoutEffect (not useEffect): this must measure + commit sideTop BEFORE
  // the browser paints. As a passive effect it was deferred behind the heavy
  // Mapbox/3D-inset render on this screen, so the first frame of a new route
  // painted the tall banner on top of the corner panels (sideTop still at the
  // 96 fallback) until the effect finally ran. Measuring pre-paint closes that
  // window. SPA-only (no SSR), so there's no hydration concern.
  //
  // Always read el.offsetHeight (border-box) — both on attach AND inside the
  // observer. ResizeObserver's contentRect is the *content box*, which excludes
  // the 1px .panel-beveled border, so it under-reported the banner by ~2px and
  // quietly ate into the 8px clearance gap below.
  const bannerShown = !!(activeRoute && step);
  useLayoutEffect(() => {
    const el = bannerRef.current;
    if (!bannerShown || !el) { setBannerH(0); return; }
    setBannerH(el.offsetHeight);
    const ro = new ResizeObserver(() => setBannerH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [bannerShown]);

  // Corner panels (contacts / 3D inset / crime overview) drop below the banner's
  // real bottom (top-12 = 48px + measured height + 8px gap); else the default 96.
  const sideTop = bannerShown && bannerH ? Math.round(48 + bannerH + 8) : 96;

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

  return viewMode === 'modules' ? (
    <div className="tactical-dark fixed inset-0 bg-surface-deep overflow-hidden" style={{ zIndex: 40 }}>
      {/* Drive/Modules toggle stays available here so the MODULES view is never
          a one-way trip — tap Drive to return to the follow-me map. */}
      <div
        className="absolute top-0 inset-x-0 flex items-center gap-2 px-3 py-2 backdrop-blur-md border-b border-rmpg-800 z-30"
        style={{ background: 'linear-gradient(180deg, rgba(10,10,10,0.92) 0%, rgba(10,10,10,0.78) 100%)', paddingTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}
      >
        <Navigation2 className="w-4 h-4 text-brand-400" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-rmpg-100">Navigation</span>
        <div className="ml-2"><NavViewToggle mode={viewMode} onMode={setViewMode} /></div>
      </div>
      <div className="absolute inset-x-0 bottom-0 overflow-y-auto" style={{ top: 'calc(44px + env(safe-area-inset-top, 0px))' }}>
        <ModuleDirectoryPage />
      </div>
    </div>
  ) : (
    <div ref={rootRef} className="tactical-dark fixed inset-0 bg-surface-deep overflow-hidden">
      {/* Map (or dark backdrop on failure) */}
      <div ref={mapContainerRef} className="absolute inset-0" />
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center text-rmpg-600 text-xs">
          Map unavailable ({mapError}) — instruments live below
        </div>
      )}

      {/* Tactical viewport framing — corner brackets (non-interactive) for a
          command-display feel; sized to clear the header and dashboard. */}
      <div className="absolute z-10 pointer-events-none" style={{ top: 'calc(44px + env(safe-area-inset-top, 0px))', bottom: 190, left: 6, right: 6 }}>
        <div className="absolute top-0 left-0 border-t-2 border-l-2 border-brand-500/40" style={{ width: 16, height: 16 }} />
        <div className="absolute top-0 right-0 border-t-2 border-r-2 border-brand-500/40" style={{ width: 16, height: 16 }} />
        <div className="absolute bottom-0 left-0 border-b-2 border-l-2 border-brand-500/40" style={{ width: 16, height: 16 }} />
        <div className="absolute bottom-0 right-0 border-b-2 border-r-2 border-brand-500/40" style={{ width: 16, height: 16 }} />
      </div>

      {/* Header bar — on mobile the long tool row scrolls horizontally instead
          of squashing, so every control stays a real tap target in-vehicle. */}
      <div
        className={`absolute top-0 inset-x-0 flex items-center gap-2 px-3 py-2 backdrop-blur-md border-b border-rmpg-800 z-20 tab-scroll ${isMobile ? 'overflow-x-auto whitespace-nowrap [&>*]:shrink-0' : ''}`}
        style={{ background: 'linear-gradient(180deg, rgba(10,10,10,0.92) 0%, rgba(10,10,10,0.78) 100%)', paddingTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}
      >
        <div className="absolute bottom-0 inset-x-0 h-px pointer-events-none" style={{ background: 'linear-gradient(90deg, transparent 5%, rgba(212,160,23,0.4) 30%, #d4a017 50%, rgba(212,160,23,0.4) 70%, transparent 95%)' }} />
        <Navigation2 className="w-4 h-4 text-brand-400" style={{ filter: 'drop-shadow(0 0 3px rgba(212,160,23,0.5))' }} />
        <span className="text-[11px] font-bold uppercase tracking-widest text-rmpg-100">Navigation</span>
        <div className="ml-2"><NavViewToggle mode={viewMode} onMode={setViewMode} /></div>
        <span className="flex-1" />
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
          onClick={() => setCrashOn((v) => !v)}
          className="toolbar-btn flex items-center gap-1 text-[10px] uppercase"
          style={{ color: crashOn ? '#e5e7eb' : '#666' }}
          title={crashOn ? 'Hide traffic-crash layer' : 'Show SLC traffic crashes (travel hazards)'}
          aria-label={crashOn ? 'Hide traffic crashes' : 'Show traffic crashes'}
        >
          <Car className="w-4 h-4" /> Traffic
        </button>
        <button
          onClick={() => setTrailOn((v) => !v)}
          className="toolbar-btn flex items-center justify-center"
          style={{ color: trailOn ? '#d4a017' : '#666' }}
          title={trailOn ? `Hide patrol trail (${trailPtsCount} pts)` : 'Show patrol breadcrumb trail'}
          aria-label={trailOn ? 'Hide patrol trail' : 'Show patrol trail'}
        >
          <Footprints className="w-4 h-4" />
        </button>
        <button
          onClick={() => { setTripOpen((v) => !v); if (!tripOpen) { setLogOpen(false); setTripsOpen(false); } }}
          className="toolbar-btn flex items-center gap-1 text-[10px] uppercase"
          style={{ color: tripOpen ? '#d4a017' : '#666' }}
          title="Movement report (speed, g-force, driving events)"
          aria-label="Toggle movement report"
        >
          <Activity className="w-4 h-4" /> Trip
        </button>
        <button
          onClick={() => { setTripsOpen((v) => !v); if (!tripsOpen) { setTripOpen(false); setLogOpen(false); } }}
          className="toolbar-btn flex items-center gap-1 text-[10px] uppercase"
          style={{ color: tripsOpen ? '#d4a017' : '#666' }}
          title="Trip chain — per-trip movement reports for this unit"
          aria-label="Toggle trips drawer"
        >
          <RouteIcon className="w-4 h-4" /> Trips
        </button>
        <button
          onClick={() => { setLogOpen((v) => !v); if (!logOpen) { setTripOpen(false); setTripsOpen(false); } }}
          className="toolbar-btn flex items-center gap-1 text-[10px] uppercase"
          style={{ color: logOpen ? '#d4a017' : '#666' }}
          title="Call history log for this unit"
          aria-label="Toggle call history log"
        >
          <History className="w-4 h-4" /> Log
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
        <div ref={bannerRef} className="absolute inset-x-2 z-20 panel-beveled bg-surface-deep/92 backdrop-blur-md border border-rmpg-600 shadow-xl" style={{ borderRadius: 2, top: 'calc(48px + env(safe-area-inset-top, 0px))' }}>
          <div className="flex items-center gap-3 px-3 py-2">
            <StepIcon className="w-9 h-9 text-brand-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-rmpg-100 text-[15px] font-semibold leading-tight truncate" title={step.instruction}>{step.instruction}</div>
              <div className="text-[10px] text-rmpg-500 uppercase truncate">to {destLabel || activeRoute.callNumber}</div>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <button onClick={refitRoute} title="Fit route on map" aria-label="Fit route on map"
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
          block ahead, mirroring the device position + heading. Hidden on mobile:
          it eats too much of a narrow in-vehicle screen (and GPU) — the main
          follow-me map already covers the block ahead. */}
      {!isMobile && (
      <div className="absolute z-20" style={{ top: `calc(${sideTop}px + env(safe-area-inset-top, 0px))`, right: 8, width: 196, height: 148 }}>
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
      )}

      {/* Salt Lake County crime OVERVIEW (top-right, under the 3D inset). On
          mobile the 3D inset is hidden, so this slots up to the panel top and
          narrows to leave the follow-me map readable between the side panels. */}
      {crimeOn && crimeCounts.total > 0 && (
        <div
          className="absolute z-20 panel-beveled bg-surface-deep/92 backdrop-blur-md border border-rmpg-600 shadow-xl"
          style={{ top: `calc(${isMobile ? sideTop : sideTop + 156}px + env(safe-area-inset-top, 0px))`, right: 8, width: isMobile ? 150 : 190, maxWidth: '44vw', borderRadius: 2 }}
        >
          <div className="relative flex items-center gap-1 px-2 py-1 border-b border-rmpg-700">
            <div className="absolute bottom-0 inset-x-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(212,160,23,0.5))' }} />
            <Flame className="w-3 h-3" style={{ color: '#f59e0b' }} />
            <span className="text-[9px] font-bold uppercase tracking-widest text-rmpg-100 flex-1">SL County · Crime</span>
            <span className="text-[9px] font-mono text-brand-300">{crimeCounts.total}</span>
          </div>
          <div className="px-2 py-1.5 space-y-1.5">
            {/* Class breakdown bars */}
            <div className="space-y-1">
              {(['person', 'property', 'society', 'cfs'] as CrimeClass[]).map((k) => {
                const n = crimeOverview.byClass[k];
                const meta = CLASS_META[k];
                return (
                  <div key={k} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.color }} />
                    <span className="text-[9px] text-rmpg-300 w-12 shrink-0 truncate">{meta.label}</span>
                    <div className="flex-1 h-1.5 bg-rmpg-800 overflow-hidden" style={{ borderRadius: 2 }}>
                      <div className="h-full" style={{ width: `${Math.round((n / crimeOverview.maxClass) * 100)}%`, background: meta.color, transition: 'width 0.4s ease-out' }} />
                    </div>
                    <span className="text-[9px] font-mono text-rmpg-400 w-6 text-right shrink-0">{n}</span>
                  </div>
                );
              })}
            </div>
            {/* Reporting agencies (multi-agency county feed) */}
            {crimeOverview.topAgencies.length > 0 && (
              <div className="pt-1 border-t border-rmpg-800/60">
                <div className="flex items-center gap-1 mb-0.5">
                  <Building2 className="w-2.5 h-2.5 text-rmpg-600 shrink-0" />
                  <span className="text-[8px] uppercase tracking-wider text-rmpg-600 flex-1">Agencies · county</span>
                  <span className="text-[8px] font-mono text-rmpg-600">{regionalAgencies.length}</span>
                </div>
                {crimeOverview.topAgencies.map(([name, n]) => (
                  <div key={name} className="flex items-center gap-1.5">
                    <span className="flex-1 min-w-0 truncate text-[9px] text-rmpg-300" title={name}>{shortAgency(name)}</span>
                    <span className="text-[9px] font-mono text-rmpg-500 shrink-0">{n}</span>
                  </div>
                ))}
              </div>
            )}
            {/* Busiest city neighborhoods */}
            {crimeOverview.topAreas.length > 0 && (
              <div className="pt-1 border-t border-rmpg-800/60">
                <div className="text-[8px] uppercase tracking-wider text-rmpg-600 mb-0.5">Top areas · city</div>
                {crimeOverview.topAreas.map(([name, n]) => (
                  <div key={name} className="flex items-center gap-1.5">
                    <MapPin className="w-2.5 h-2.5 text-rmpg-600 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-[9px] text-rmpg-300" title={name}>{name}</span>
                    <span className="text-[9px] font-mono text-rmpg-500 shrink-0">{n}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1 pt-1 border-t border-rmpg-800/60">
              <span className="text-[8px] uppercase tracking-wider text-rmpg-600 flex-1">Crime ½mi</span>
              <span className="text-[10px] font-mono font-bold" style={{ color: crimeNearby >= 8 ? '#ef4444' : crimeNearby >= 3 ? '#f59e0b' : '#22c55e' }}>{crimeNearby}</span>
            </div>
            {crashOn && crashes.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0 border" style={{ borderColor: '#e5e7eb', background: 'transparent' }} />
                <span className="text-[8px] uppercase tracking-wider text-rmpg-600 flex-1">Crashes ½mi</span>
                <span className="text-[10px] font-mono font-bold" style={{ color: crashNearby >= 10 ? '#ef4444' : crashNearby >= 4 ? '#f59e0b' : '#888' }}>{crashNearby}</span>
              </div>
            )}
            <div className="text-[8px] text-rmpg-600 leading-tight">
              SLC city · {crimeCounts.slc} · agencies · {crimeCounts.ccm} · CFS · {crimeCounts.local}
            </div>
            {crashOn && crashes.length > 0 && (
              <div className="text-[8px] text-rmpg-600 leading-tight">Crashes · {crashes.length} · 1yr history</div>
            )}
            <div className="text-[8px] text-rmpg-700 leading-tight">Tap any point for the record</div>
          </div>
        </div>
      )}
      {!activeRoute && (
        <div className="absolute inset-x-2 z-20 panel-beveled bg-surface-deep/85 backdrop-blur-md border border-rmpg-700 px-3 py-1.5 flex items-center gap-2" style={{ borderRadius: 2, top: 'calc(48px + env(safe-area-inset-top, 0px))' }}>
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
        <div className="absolute z-20" style={{ top: `calc(${sideTop}px + env(safe-area-inset-top, 0px))`, left: 8, width: isMobile ? 150 : 200, maxWidth: '44vw' }}>
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

      {/* ── MOVEMENT REPORT drawer (right) ── */}
      {tripOpen && movementReport && (
        <MovementReportDrawer
          report={movementReport}
          liveMph={hasFix ? displayMph : null}
          liveLongG={gForce}
          liveLatG={latGLive}
          sessionMs={sessionMs}
          climbFt={climbFt}
          elevFt={elevFt}
          onClose={() => setTripOpen(false)}
        />
      )}

      {/* ── TRIPS drawer (right) — trip chain + per-trip Movement Report ── */}
      <TripsDrawer unitId={gps.unitId ?? undefined} open={tripsOpen} onClose={() => setTripsOpen(false)} />

      {/* ── CALL HISTORY drawer (left) ── */}
      {logOpen && (
        <CallHistoryDrawer
          unitId={gps.unitId}
          unitCallSign={gps.unitCallSign}
          myLat={gps.latitude}
          myLng={gps.longitude}
          onRouteToCall={(lat, lng, label) => { routeToDestination(lat, lng, label); setLogOpen(false); }}
          onClose={() => setLogOpen(false)}
        />
      )}

      {/* ── #64 — Destination-reached confirmation (lower HUD overlay) ── */}
      {arrivedLabel && (
        <div className="absolute z-40 left-1/2 -translate-x-1/2" style={{ bottom: 210 }}>
          <HudArrivedBanner label={arrivedLabel} onDismiss={() => setArrivedLabel(null)} />
        </div>
      )}

      {/* ── Advanced instrument dashboard (bottom) ── */}
      {/* #68 — safe-area inset padding so controls clear rugged-tablet bezels. */}
      <div className="absolute bottom-0 inset-x-0 z-20" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
        {/* Gold accent riser — lifts the instrument panel off the map */}
        <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent 5%, rgba(212,160,23,0.4) 28%, #d4a017 50%, rgba(212,160,23,0.4) 72%, transparent 95%)' }} />
        <div
          className="backdrop-blur-md border-t border-rmpg-800/80"
          style={{ background: nightTheme
            ? 'linear-gradient(180deg, rgba(6,6,6,0.86) 0%, rgba(4,4,4,0.98) 60%)'
            : 'linear-gradient(180deg, rgba(10,10,10,0.80) 0%, rgba(8,8,8,0.96) 60%)' }}
        >
          {/* ── #45/#46/#47/#62/#63/#40/#61/#70/#30 — HUD control bar ── */}
          <div className="flex items-center gap-2 px-3 py-1 border-b border-rmpg-800/70 overflow-x-auto tab-scroll">
            <HudCollapseToggle collapsed={footerCollapsed} onToggle={() => setFooterCollapsed((v) => !v)} />
            <HudMapControls
              followActive={followActive} onRecenter={recenterMap}
              onZoomIn={() => zoomMap(1)} onZoomOut={() => zoomMap(-1)}
              pitched={pitched} onTogglePitch={togglePitch}
            />
            <HudMuteToggle muted={hudMuted} onToggle={() => setHudMuted((v) => !v)} />
            <span className="w-px self-stretch bg-rmpg-800 mx-0.5" />
            <HudQualityPill accuracy={gps.accuracy ?? null} />
            <HudSourceChip label={src.label} color={src.color} fixTick={trailPtsCount} />
            {parked && <HudParkedBadge />}
            <span className="flex-1" />
            <HudExportCluster pointCount={trailPtsCount} onGpx={() => gpxExport(gps.getCapturedTrack())} onCsv={() => navCsvExport(gps.getCapturedTrack())} />
          </div>

          {/* #45/#66 — collapsed single-line summary (speed · heading · ETA) */}
          {footerCollapsed ? (
            <HudSummaryLine
              unit={gps.unitCallSign ? `UNIT ${gps.unitCallSign}` : null}
              street={currentStreet}
              headingTxt={formatHeading(dir)}
              speedTxt={formatSpeed(liveMph, speedUnit)}
              etaTxt={etaCountdown}
            />
          ) : (
          <>
          {/* HUD heading tape */}
          <div className="px-3 pt-1.5 pb-1 border-b border-rmpg-800/70">
            <HeadingTape heading={dir} />
          </div>
          <div className={`flex items-stretch px-2 py-2 tab-scroll ${isMobile ? 'overflow-x-auto' : ''}`}>
            {/* Bay 1 — ring speed gauge (#29/#33/#48/#51/#52/#57/#59/#65/#69) */}
            <div className="flex flex-col items-center justify-center px-1">
              <HudSpeedGauge
                mph={hasFix ? displayMph : null}
                unit={speedUnit}
                limitMph={limitMph}
                buffer={limitBuffer}
                heading={dir}
                night={nightTheme}
                onOverLimitTone={() => playNavTone(tonesOn, 4000, 990)}
              />
              <button
                type="button"
                onClick={cycleSpeedUnit}
                aria-label="Toggle speed units"
                title="Toggle mph / km·h"
                className="mt-0.5 text-[7px] font-bold uppercase tracking-wider text-rmpg-500 hover:text-brand-300 border border-rmpg-800 px-1.5 py-0.5"
                style={{ borderRadius: 2 }}
              >
                {speedUnit === 'mph' ? 'MPH' : 'KM/H'}
              </button>
            </div>
            <div className="w-px self-stretch my-1 bg-gradient-to-b from-transparent via-rmpg-700 to-transparent" />

            {/* Bay 2 — refined dual-needle compass (#34/#43/#44) */}
            <div className="flex items-center justify-center px-3">
              <HudCompass heading={dir} destBearing={destBearing} orientation={mapOrientation} />
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

            {/* Bay 4 — speed area-chart + live 2-axis G-force ball */}
            <div className="flex flex-col justify-center gap-1.5 px-3" style={{ width: 186 }}>
              <div>
                <div className="text-[7px] uppercase tracking-wider text-rmpg-600 mb-0.5 flex items-center gap-1"><Gauge className="w-2.5 h-2.5" /> Speed · 60s</div>
                {spark.length > 1 ? (
                  <svg viewBox={`0 0 ${spark.length - 1} 24`} preserveAspectRatio="none" style={{ width: 162, height: 28 }} aria-hidden="true">
                    <polyline points={`0,24 ${spark.map((v, i) => `${i},${24 - Math.min(24, (v / sparkMax) * 24)}`).join(' ')} ${spark.length - 1},24`} fill="#d4a01722" stroke="none" />
                    <polyline points={spark.map((v, i) => `${i},${24 - Math.min(24, (v / sparkMax) * 24)}`).join(' ')} fill="none" stroke="#d4a017" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  </svg>
                ) : <div className="flex items-center text-[8px] text-rmpg-700" style={{ height: 28 }}>awaiting speed…</div>}
              </div>
              <div className="flex items-center gap-2">
                {/* #53 — hard-brake/hard-accel transient amber flash on the G-ball */}
                <div className="relative" style={{ width: 66, height: 66 }}>
                  <GForceBall longG={gForce} latG={latGLive} peak={peakGRef.current} />
                  {gFlash && (
                    <div className="absolute inset-0 pointer-events-none rounded-full" style={{ boxShadow: 'inset 0 0 0 3px #f59e0b, 0 0 10px #f59e0b88', borderRadius: '9999px', animation: 'none' }} aria-hidden="true" />
                  )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <div className="leading-none">
                    <div className="flex items-center justify-between text-[7px] uppercase tracking-wider text-rmpg-600">
                      <span>Long</span><span className="font-mono text-rmpg-500">pk {Math.max(peakGRef.current.accel, peakGRef.current.brake).toFixed(2)}</span>
                    </div>
                    <div className="font-mono font-bold text-[13px] tabular-nums" style={{ color: Math.abs(gForce) > 0.4 ? '#ef4444' : Math.abs(gForce) > 0.2 ? '#f59e0b' : '#22c55e' }}>
                      {gForce >= 0 ? '+' : '−'}{Math.abs(gForce).toFixed(2)}<span className="text-[8px] text-rmpg-600 ml-0.5">g</span>
                    </div>
                  </div>
                  <div className="leading-none">
                    <div className="flex items-center justify-between text-[7px] uppercase tracking-wider text-rmpg-600">
                      <span>Lat</span><span className="font-mono text-rmpg-500">pk {peakGRef.current.lat.toFixed(2)}</span>
                    </div>
                    <div className="font-mono font-bold text-[13px] tabular-nums" style={{ color: Math.abs(latGLive) > 0.4 ? '#ef4444' : Math.abs(latGLive) > 0.2 ? '#f59e0b' : '#22c55e' }}>
                      {Math.abs(latGLive) < 0.02 ? '·' : latGLive >= 0 ? 'R' : 'L'} {Math.abs(latGLive).toFixed(2)}<span className="text-[8px] text-rmpg-600 ml-0.5">g</span>
                    </div>
                  </div>
                </div>
              </div>
              {/* #32 — driving-score chip + #41/#42 — next-maneuver mini + micro-bar */}
              <div className="flex items-stretch gap-1.5">
                <HudDrivingScore
                  peakLong={Math.max(peakGRef.current.accel, peakGRef.current.brake)}
                  peakLat={peakGRef.current.lat}
                  hardBrakes={hardBrakesRef.current}
                  hardAccels={hardAccelsRef.current}
                />
                {step && (
                  <HudNextManeuver
                    maneuverType={step.maneuverType}
                    modifier={step.modifier}
                    instruction={step.instruction}
                    distanceToTurnMeters={distanceToTurnMeters}
                    stepDistanceMeters={step.distanceMeters}
                  />
                )}
              </div>
            </div>
            <div className="w-px self-stretch my-1 bg-gradient-to-b from-transparent via-rmpg-700 to-transparent" />

            {/* Bay 5 — live readouts + session stats as instrument tiles
                 (#35/#36/#37/#38/#39/#49/#55/#56/#60/#67/#70). On mobile the bay
                 row scrolls, so pin a min width here to keep the stat grid legible
                 instead of letting flex-1 collapse it to nothing. */}
            <div className="flex-1 min-w-0 self-center pl-3 pr-1" style={isMobile ? { minWidth: 300 } : undefined}>
              {/* #50 — prominent current-street readout tile + #31 dual-distance */}
              <div className="mb-1.5 flex items-stretch gap-1.5">
                <div
                  className={`flex-1 min-w-0 border px-2 py-1 ${nightTheme ? 'border-rmpg-700' : 'border-rmpg-800'}`}
                  style={{ borderRadius: 2, background: nightTheme ? 'rgba(8,8,8,0.85)' : 'rgba(20,20,20,0.6)' }}
                  title={currentStreet || undefined}
                >
                  <div className={`text-[8px] uppercase tracking-wider leading-none ${nightTheme ? 'text-rmpg-500' : 'text-rmpg-600'}`}>Street</div>
                  <div className={`font-bold text-[15px] leading-tight mt-0.5 truncate ${nightTheme ? 'text-rmpg-50' : 'text-rmpg-100'}`}>
                    {truncateLabel(currentStreet, 30) || (hasFix ? 'Locating…' : 'Acquiring fix…')}
                  </div>
                </div>
                {/* #31 — routed-remaining | crow-flies dual distance */}
                {(routeProgress || destCrowMi != null) && (
                  <div className="shrink-0 border border-rmpg-800 px-2 py-1" style={{ borderRadius: 2, background: 'rgba(20,20,20,0.6)' }} title="Routed remaining | straight-line">
                    <div className="text-[8px] uppercase tracking-wider text-rmpg-600 leading-none">Dist rt | crow</div>
                    <div className="font-mono font-bold text-[13px] leading-tight mt-0.5 tabular-nums text-brand-200">
                      {routeProgress ? formatDistanceLong(routeProgress.remainingMeters, speedUnit) : '—'}
                      <span className="text-rmpg-600 mx-1">|</span>
                      {destCrowMi != null ? formatDistanceMi(destCrowMi, speedUnit) : '—'}
                    </div>
                  </div>
                )}
              </div>
              <div
                className="grid gap-1.5"
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))', opacity: parked ? 0.5 : 1, transition: 'opacity 0.4s' }}
              >
                {/* #67 — first tile cycles avg / max / elapsed / distance on long-press */}
                <HudStatTile night={nightTheme} metrics={[
                  { key: 'avg', label: 'Avg', value: formatSpeed(avgMph, speedUnit) },
                  { key: 'max', label: 'Max', value: formatSpeed(maxMph, speedUnit) },
                  { key: 'elapsed', label: 'Session', value: hudFormatDuration(sessionMs) },
                  { key: 'distance', label: 'Distance', value: formatDistanceLong(distanceRef.current, speedUnit) },
                ]} />
                {/* #35 — current speed */}
                <HudStatTile night={nightTheme} metrics={[{ key: 'cur', label: 'Speed', value: formatSpeed(liveMph, speedUnit), accent: liveMph != null && liveMph > 55 ? '#f59e0b' : undefined }]} />
                {/* #36 — max-speed-this-session */}
                <HudStatTile night={nightTheme} metrics={[{ key: 'maxs', label: 'Max', value: formatSpeed(maxMph, speedUnit) }]} />
                {/* #37 — elapsed session timer */}
                <HudStatTile night={nightTheme} metrics={[{ key: 'elapsed', label: 'Elapsed', value: hudFormatDuration(sessionMs) }]} />
                {/* #38 — total session distance (unit-aware) */}
                <HudStatTile night={nightTheme} metrics={[{ key: 'dist', label: 'Distance', value: formatDistanceLong(distanceRef.current, speedUnit) }]} />
                {/* #54 — distance-since-last-stop leg */}
                <HudStatTile night={nightTheme} metrics={[{ key: 'leg', label: 'Leg', value: formatDistanceLong(legDistRef.current, speedUnit) }]} />
                {/* #39 — heading cardinal + degrees */}
                <HudStatTile night={nightTheme} metrics={[{ key: 'hdg', label: 'Heading', value: formatHeading(dir), dim: dir == null }]} />
                {/* #49 — ETA mirror (arrival clock + countdown) */}
                <HudStatTile night={nightTheme} metrics={[{ key: 'eta', label: 'ETA', value: etaArrival ? `${etaArrival} · ${etaCountdown}` : '—', accent: etaArrival ? '#22c55e' : undefined, dim: !etaArrival }]} />
                <HudStatTile night={nightTheme} metrics={[{ key: 'acc', label: 'Accuracy', value: gps.accuracy != null ? `${Math.round(gps.accuracy)} m` : '—', dim: gps.accuracy == null }]} />
                <HudStatTile night={nightTheme} metrics={[{ key: 'elev', label: 'Elev', value: elevFt != null ? `${Math.round(elevFt).toLocaleString()} ft` : '—', dim: elevFt == null }]} />
                <HudStatTile night={nightTheme} metrics={[{ key: 'climb', label: 'Climb', value: `${Math.round(climbFt).toLocaleString()} ft`, accent: climbFt > 0 ? '#22c55e' : undefined, dim: climbFt === 0 }]} />
                <HudStatTile night={nightTheme} metrics={[{ key: 'brg', label: 'Bearing', value: destBearing != null ? `${Math.round(destBearing)}°` : '—', accent: destBearing != null ? '#ef4444' : undefined, dim: destBearing == null }]} />
                <HudStatTile night={nightTheme} metrics={[{ key: 'src', label: 'Source', value: src.label, accent: src.color }]} />
              </div>
              <div className={`mt-1.5 flex items-center gap-2 text-[9px] font-mono ${nightTheme ? 'font-bold' : ''}`}>
                <MapPin className="w-2.5 h-2.5 text-brand-500 shrink-0" />
                <span className={`truncate ${nightTheme ? 'text-rmpg-200' : 'text-rmpg-300'}`}>{currentStreet || (hasFix ? 'Locating street…' : 'Acquiring fix…')}</span>
                <span className="shrink-0 text-rmpg-600">{hasFix ? `${gps.latitude!.toFixed(5)}, ${gps.longitude!.toFixed(5)}` : ''}</span>
                {gps.unitCallSign && <span className="ml-auto shrink-0 text-brand-300 font-bold">UNIT {gps.unitCallSign}</span>}
              </div>
            </div>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
