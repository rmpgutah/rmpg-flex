// ============================================================
// RMPG Flex — Live GPS + Navigation HUD
// ============================================================
// A full on-map readout of the operator's OWN device fix AND, when a route is
// active, turn-by-turn navigation to the assigned call. Two stacked sections:
//
//   1. POSITION — large rotating compass needle (smoothed heading), cardinal,
//      ground speed (mph), horizontal accuracy, lat/lng, fix source
//      (GPS / WiFi / IP — the at-a-glance "is my u-blox fix live?" check),
//      link type, last server sync, and unit call sign.
//   2. NAVIGATION — destination call, remaining ETA + distance (live), total
//      route, a progress bar, traffic/congestion badge, off-route alert, and a
//      scrollable turn-by-turn maneuver list with directional arrows.
//
// Plus the capture/export footer for the session track.
//
// Purely presentational: GPS math/state lives in useGpsTracking and all routing
// math (ETA, steps, progress, off-route) lives in useMapRouting. This component
// only renders them. The directional needle uses the SMOOTHED heading so it
// glides instead of snapping between noisy fixes.
// ============================================================

import {
  Navigation2, Satellite, Wifi, Globe, Download, Trash2, X, Crosshair,
  CornerUpLeft, CornerUpRight, ArrowUp, ArrowUpLeft, ArrowUpRight,
  Flag, Merge, RotateCw, RotateCcw, AlertTriangle, MapPin, Gauge, type LucideIcon,
} from 'lucide-react';
import { compassCardinal } from '../../../utils/locationImagery';
import type { RouteInfo, RouteProgress, CongestionLevel } from '../../../hooks/useMapRouting';

interface GpsHudData {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  headingSmoothed: number | null;
  heading: number | null;
  course: number | null;
  speed: number | null;
  positionSource: string;
  capturedCount: number;
  // Optional context — present on the useGpsTracking return; surfaced when available.
  connectionType?: string;
  lastSentAt?: string | null;
  unitCallSign?: string | null;
  isTracking?: boolean;
  error?: string | null;
}

/** Active-route nav data (from useMapRouting). Null/absent when no route is up. */
interface GpsHudNav {
  activeRoute: RouteInfo | null;
  routeProgress: RouteProgress | null;
  offRoute: boolean;
}

interface Props {
  gps: GpsHudData;
  /** Turn-by-turn / routing context. Omit or pass null when no route is active. */
  nav?: GpsHudNav | null;
  onExport: (format: 'csv' | 'geojson') => void;
  onClear: () => void;
  onClose: () => void;
}

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { icon: LucideIcon; color: string; label: string }> = {
    gps: { icon: Satellite, color: '#22c55e', label: 'GPS' },
    wifi: { icon: Wifi, color: '#d4a017', label: 'WiFi' },
    ip: { icon: Globe, color: '#ef4444', label: 'IP' },
    unknown: { icon: Globe, color: '#666', label: '—' },
  };
  const s = map[source] || map.unknown;
  const Icon = s.icon;
  return (
    <span className="flex items-center gap-1" style={{ color: s.color }} title={`Position source: ${s.label}`}>
      <Icon className="w-3 h-3" /> <span className="text-[9px] font-bold uppercase">{s.label}</span>
    </span>
  );
}

const CONGESTION: Record<CongestionLevel, { color: string; label: string }> = {
  low: { color: '#22c55e', label: 'CLEAR' },
  moderate: { color: '#d4a017', label: 'MODERATE' },
  heavy: { color: '#f97316', label: 'HEAVY' },
  severe: { color: '#ef4444', label: 'SEVERE' },
  unknown: { color: '#666', label: '—' },
};

/** Map a Mapbox maneuver to a directional arrow icon. */
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
  return ArrowUp; // straight / continue / new name
}

function syncAgo(iso?: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export default function GpsHud({ gps, nav, onExport, onClear, onClose }: Props) {
  // Prefer smoothed heading, then course-over-ground, then raw device heading.
  const dir = gps.headingSmoothed ?? gps.course ?? gps.heading;
  const mph = gps.speed != null ? Math.round(gps.speed * 2.237) : null;
  const hasFix = gps.latitude != null && gps.longitude != null;
  const route = nav?.activeRoute ?? null;
  const prog = nav?.routeProgress ?? null;
  const offRoute = !!nav?.offRoute;
  const sync = syncAgo(gps.lastSentAt);
  const pct = prog ? Math.round(Math.min(1, Math.max(0, prog.fraction)) * 100) : null;
  const cong = route ? (CONGESTION[route.worstCongestion] || CONGESTION.unknown) : null;

  return (
    <div
      className="panel-beveled bg-surface-deep/95 border border-rmpg-600 shadow-xl backdrop-blur-md"
      style={{ borderRadius: 2, width: 320 }}
      role="region"
      aria-label="Live GPS and navigation"
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-rmpg-700">
        <Crosshair className="w-3 h-3 text-brand-400" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-rmpg-200 flex-1">
          My GPS{route ? ' · NAV' : ''}
        </span>
        <SourceBadge source={gps.positionSource} />
        {gps.connectionType && gps.connectionType !== 'unknown' && (
          <span className="text-[8px] uppercase text-rmpg-500" title="Network link">{gps.connectionType}</span>
        )}
        <button onClick={onClose} className="toolbar-btn" title="Hide GPS HUD" aria-label="Hide GPS HUD" style={{ padding: '0 1px' }}>
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* ── Position section ── */}
      {!hasFix ? (
        <div className="px-3 py-3 text-[11px] text-rmpg-500 flex items-center gap-2">
          <Satellite className="w-4 h-4 animate-pulse" />
          {gps.error ? gps.error : 'Acquiring GPS fix…'}
        </div>
      ) : (
        <div className="p-2.5 flex items-center gap-3">
          {/* Large directional compass */}
          <div className="relative shrink-0" style={{ width: 64, height: 64 }} title="Heading">
            <div className="absolute inset-0 rounded-full border-2 border-rmpg-600" />
            {/* cardinal ticks */}
            <span className="absolute top-0 left-1/2 -translate-x-1/2 text-[7px] text-rmpg-500">N</span>
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[7px] text-rmpg-600">S</span>
            <Navigation2
              className="absolute inset-0 m-auto w-8 h-8 text-brand-400"
              style={{ transform: `rotate(${dir ?? 0}deg)`, transition: 'transform 0.3s ease-out' }}
              fill={dir != null ? '#d4a017' : 'none'}
            />
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-bold text-brand-300 bg-surface-deep px-1">
              {dir != null ? compassCardinal(dir) : '—'}
            </span>
          </div>
          {/* Readout grid */}
          <div className="flex-1 min-w-0 font-mono text-[11px] leading-snug text-rmpg-100">
            <div className="flex items-baseline gap-3">
              <div>
                <span className="text-rmpg-500 text-[9px] uppercase">HDG </span>
                <span className="text-brand-300 font-bold text-[13px]">{dir != null ? `${Math.round(dir)}°` : '—'}</span>
              </div>
              <div className="flex items-baseline gap-1">
                <Gauge className="w-3 h-3 text-rmpg-500 self-center" />
                <span className="font-bold text-[13px]">{mph != null ? mph : '—'}</span>
                <span className="text-rmpg-500 text-[9px]">mph</span>
              </div>
            </div>
            <div className="text-[10px] text-rmpg-300">
              <span className="text-rmpg-500">±</span> {gps.accuracy != null ? `${Math.round(gps.accuracy)} m` : '—'}
              {gps.unitCallSign && <span className="ml-2 text-rmpg-400">UNIT {gps.unitCallSign}</span>}
            </div>
            <div className="text-[9px] text-rmpg-500 truncate" title={`${gps.latitude}, ${gps.longitude}`}>
              {gps.latitude!.toFixed(6)}, {gps.longitude!.toFixed(6)}
            </div>
            {sync && <div className="text-[8px] text-rmpg-600">synced {sync}</div>}
          </div>
        </div>
      )}

      {/* ── Navigation section (only when a route is active) ── */}
      {route && (
        <div className="border-t border-rmpg-700">
          {/* Destination + remaining headline */}
          <div className="px-2.5 py-1.5 flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[9px] uppercase text-rmpg-500 leading-tight">To {route.callNumber}</div>
              <div className="font-mono text-[10px] text-rmpg-300 truncate">
                {route.unitCallSign} → {route.distance} · {route.eta}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-bold text-brand-300 text-[15px] leading-none font-mono">
                {prog ? prog.remainingEta : route.eta}
              </div>
              <div className="text-[9px] text-rmpg-400 font-mono">{prog ? prog.remainingDistance : route.distance}</div>
            </div>
          </div>

          {/* Progress bar */}
          {pct != null && (
            <div className="px-2.5 pb-1">
              <div className="h-1 bg-rmpg-800 overflow-hidden" style={{ borderRadius: 2 }}>
                <div className="h-full bg-brand-500" style={{ width: `${pct}%`, transition: 'width 0.4s ease-out' }} />
              </div>
            </div>
          )}

          {/* Status badges */}
          <div className="px-2.5 pb-1.5 flex items-center gap-2 flex-wrap">
            {cong && (
              <span className="flex items-center gap-1 text-[8px] font-bold uppercase" style={{ color: cong.color }} title="Worst congestion on route">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: cong.color }} /> {cong.label}
              </span>
            )}
            {route.trafficAware && <span className="text-[8px] uppercase text-rmpg-500">live traffic</span>}
            {offRoute && (
              <span className="flex items-center gap-1 text-[8px] font-bold uppercase text-red-400 animate-pulse" title="Unit has drifted off the route">
                <AlertTriangle className="w-2.5 h-2.5" /> OFF ROUTE
              </span>
            )}
          </div>

          {/* Turn-by-turn steps */}
          {route.steps.length > 0 && (
            <div className="border-t border-rmpg-800 max-h-32 overflow-y-auto">
              {route.steps.map((step, i) => {
                const Icon = maneuverIcon(step.maneuverType, step.modifier);
                const isNext = i === 0;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 px-2.5 py-1 ${isNext ? 'bg-rmpg-800/60' : ''} ${i > 0 ? 'border-t border-rmpg-800/50' : ''}`}
                  >
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${isNext ? 'text-brand-400' : 'text-rmpg-400'}`} />
                    <span className={`flex-1 min-w-0 truncate text-[10px] ${isNext ? 'text-rmpg-100 font-semibold' : 'text-rmpg-300'}`} title={step.instruction}>
                      {step.instruction}
                    </span>
                    <span className="text-[8px] font-mono text-rmpg-500 shrink-0">{step.distanceText}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Capture / export footer ── */}
      <div className="flex items-center gap-1 px-2 py-1 border-t border-rmpg-800">
        <span className="text-[8px] text-rmpg-500 flex-1">
          Track: <span className="text-rmpg-300 font-bold font-mono">{gps.capturedCount}</span> pts
        </span>
        <button
          onClick={() => onExport('csv')}
          disabled={gps.capturedCount === 0}
          className="flex items-center gap-0.5 px-1 py-0.5 text-[8px] font-bold uppercase text-rmpg-300 hover:text-white hover:bg-rmpg-700/60 disabled:opacity-30 transition-colors"
          style={{ borderRadius: 2 }}
          title="Export track as CSV"
        ><Download className="w-2.5 h-2.5" />CSV</button>
        <button
          onClick={() => onExport('geojson')}
          disabled={gps.capturedCount === 0}
          className="flex items-center gap-0.5 px-1 py-0.5 text-[8px] font-bold uppercase text-rmpg-300 hover:text-white hover:bg-rmpg-700/60 disabled:opacity-30 transition-colors"
          style={{ borderRadius: 2 }}
          title="Export track as GeoJSON"
        ><Download className="w-2.5 h-2.5" />GEO</button>
        <button
          onClick={onClear}
          disabled={gps.capturedCount === 0}
          className="px-1 py-0.5 text-rmpg-500 hover:text-red-400 disabled:opacity-30 transition-colors"
          title="Clear captured track"
          aria-label="Clear captured track"
        ><Trash2 className="w-2.5 h-2.5" /></button>
      </div>
    </div>
  );
}
