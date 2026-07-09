// ============================================================
// RMPG Flex — Drive-Mode HUD · instrument components
// ============================================================
// Self-contained presentational pieces for the NavigationPage instrument footer
// and lower-HUD controls. Drive-lane only — defines its own props/types and does
// NOT import from other lanes' new files. Pure-black Spillman tokens, gold
// accent, 2px radius, monospace data, ZERO blue.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import {
  Download, Volume2, VolumeX, Crosshair, Plus, Minus, Box, ChevronDown, ChevronUp,
  Navigation2, CornerUpLeft, CornerUpRight, ArrowUp, ArrowUpLeft, ArrowUpRight,
  Flag, Merge, RotateCw, RotateCcw, Square, type LucideIcon,
} from 'lucide-react';
import {
  type SpeedUnit, speedInUnit, speedSuffix, speedColor, speedBands, formatHeading,
} from './hudUnits';
import { GAUGE_R, GAUGE_CIRC, GAUGE_SWEEP, gaugeTick } from './gaugeGeometry';

const prefersReducedMotion = (): boolean => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

// ── #29/#33/#48/#51/#52/#57/#59/#65/#69 — enhanced SpeedGauge ──────────────────
// Speedometer with: posted-limit MUTCD badge, over-limit tint/flash, glance-size
// digit toggle, band legend, EMA needle smoothing, heading arrow, unit-aware
// suffix, redline tick, and over-limit cumulative-time counter.
const maneuverIconFor = (type: string, modifier?: string): LucideIcon => {
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
};

export function HudSpeedGauge({
  mph, unit, limitMph, buffer, heading, max = 120, onOverLimitTone, night,
}: {
  mph: number | null;
  unit: SpeedUnit;
  limitMph: number | null;
  buffer: number;
  heading: number | null;
  max?: number;
  onOverLimitTone?: () => void;
  night?: boolean;
}) {
  // #51 — EMA smoothing on incoming mph so the needle/number don't flicker.
  const emaRef = useRef<number | null>(null);
  const [smoothed, setSmoothed] = useState<number | null>(null);
  useEffect(() => {
    if (mph == null) { emaRef.current = null; setSmoothed(null); return; }
    const prev = emaRef.current;
    const next = prev == null ? mph : prev + 0.4 * (mph - prev);
    emaRef.current = next;
    setSmoothed(next);
  }, [mph]);

  // #33 — glance-size oversized digits toggle (tap/long-press).
  const [glance, setGlance] = useState(false);

  // #52 — cumulative seconds over the posted limit this session.
  const overSecRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const [overSec, setOverSec] = useState(0);
  // #69 — flash ring when 10+ over.
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);
  const over10ArmedRef = useRef(false);

  const displayVal = smoothed != null ? Math.round(smoothed) : (mph != null ? Math.round(mph) : null);
  const over = limitMph != null && displayVal != null && displayVal - limitMph > 5;
  const over10 = limitMph != null && displayVal != null && displayVal - limitMph >= 10;

  useEffect(() => {
    const now = Date.now();
    if (over && lastTickRef.current != null) {
      overSecRef.current += (now - lastTickRef.current) / 1000;
      setOverSec(Math.floor(overSecRef.current));
    }
    lastTickRef.current = now;
  }, [over, displayVal]);

  useEffect(() => {
    if (over10 && !over10ArmedRef.current) {
      over10ArmedRef.current = true;
      setFlash(true);
      onOverLimitTone?.();
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(false), 900);
    } else if (!over10) {
      over10ArmedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over10]);
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  const maxU = speedInUnit(max, unit);
  const v = displayVal != null ? Math.max(0, Math.min(maxU, speedInUnit(displayVal, unit))) : 0;
  const track = GAUGE_CIRC * GAUGE_SWEEP;
  const filled = track * (maxU > 0 ? v / maxU : 0);
  const baseColor = speedColor(displayVal);
  // #29 — pulse red when >5 over regardless of band.
  const ringColor = over ? '#ef4444' : baseColor;

  const bands = speedBands(unit);
  const card = formatHeading(heading);
  const redline = limitMph != null ? gaugeTick(speedInUnit(limitMph + buffer, unit), maxU) : null;

  const numColor = night ? (over ? '#ef4444' : '#f0d28a') : ringColor;

  return (
    <div className="flex flex-col items-center">
      <div
        className={`relative shrink-0 cursor-pointer ${over ? 'animate-pulse' : ''}`}
        style={{ width: glance ? 150 : 116, height: glance ? 150 : 116 }}
        onClick={() => setGlance((g) => !g)}
        title={glance ? 'Tap to shrink' : 'Tap for glance-size digits'}
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0" style={{ transform: 'rotate(129deg)' }} aria-hidden="true">
          <circle cx="50" cy="50" r={GAUGE_R} fill="none" stroke="#1c1c1c" strokeWidth="7" strokeDasharray={`${track} ${GAUGE_CIRC}`} strokeLinecap="round" />
          <circle cx="50" cy="50" r={GAUGE_R} fill="none" stroke={ringColor} strokeWidth="7" strokeDasharray={`${filled} ${GAUGE_CIRC}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.4s ease-out, stroke 0.4s' }} />
          {/* #65 — redline tick at posted limit + buffer */}
          {redline && (
            <line x1={redline.x1} y1={redline.y1} x2={redline.x2} y2={redline.y2} stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          )}
          {/* #69 — flash ring on 10+ over */}
          {flash && (
            <circle cx="50" cy="50" r={GAUGE_R} fill="none" stroke="#ef4444" strokeWidth="9" strokeDasharray={`${track} ${GAUGE_CIRC}`} strokeLinecap="round" strokeOpacity="0.85">
              <animate attributeName="stroke-opacity" values="0.9;0.2;0.9" dur="0.3s" repeatCount="3" />
            </circle>
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {/* #57 — heading arrow glyph on the tile, rotated to course */}
          {heading != null && (
            <Navigation2
              className="text-brand-500"
              style={{ width: glance ? 14 : 10, height: glance ? 14 : 10, transform: `rotate(${heading}deg)`, opacity: 0.7, marginBottom: 1 }}
              aria-hidden="true"
            />
          )}
          <span className="font-mono font-bold leading-none tabular-nums" style={{ fontSize: glance ? 62 : 34, color: numColor }}>
            {displayVal != null ? Math.round(speedInUnit(displayVal, unit)) : '--'}
          </span>
          {/* #59 — unit suffix sourced from prefs */}
          <span className={`uppercase tracking-widest text-rmpg-500 ${glance ? 'text-[12px]' : 'text-[8px]'}`}>{speedSuffix(unit)}</span>
        </div>
        {/* #29 — MUTCD posted-limit badge beside the gauge */}
        {limitMph != null && (
          <div
            className="absolute -right-1 -top-1 flex flex-col items-center leading-none"
            style={{ background: '#ffffff', color: '#000', border: '1px solid #000', borderRadius: 2, padding: '2px 4px', minWidth: 24 }}
            title="Posted speed limit"
          >
            <span className="text-[5px] font-bold uppercase">Limit</span>
            <span className="text-[14px] font-extrabold tabular-nums">{limitMph}</span>
            {/* #52 — cumulative over-limit time counter */}
            {overSec > 0 && (
              <span className="text-[5px] font-mono" style={{ color: '#b91c1c' }} title="Time over limit this session">
                {Math.floor(overSec / 60)}:{String(overSec % 60).padStart(2, '0')}
              </span>
            )}
          </div>
        )}
      </div>
      {/* #48 — band legend chip beneath the gauge */}
      <div className="flex items-center gap-1 mt-0.5 text-[6px] font-mono" aria-hidden="true">
        <span className="flex items-center gap-0.5"><i className="inline-block w-1.5 h-1.5" style={{ background: '#22c55e', borderRadius: 1 }} />{'<'}{bands.ok}</span>
        <span className="flex items-center gap-0.5"><i className="inline-block w-1.5 h-1.5" style={{ background: '#f59e0b', borderRadius: 1 }} />{bands.ok}-{bands.warn}</span>
        <span className="flex items-center gap-0.5"><i className="inline-block w-1.5 h-1.5" style={{ background: '#ef4444', borderRadius: 1 }} />{'>'}{bands.warn}</span>
      </div>
      {heading != null && <span className="text-[7px] font-mono text-rmpg-500 mt-0.5">{card}</span>}
    </div>
  );
}

// ── #34/#43/#44 — refined dual-needle compass ──────────────────────────────────
export function HudCompass({
  heading, destBearing, orientation, size = 84,
}: {
  heading: number | null; destBearing: number | null; orientation: 'north-up' | 'heading-up'; size?: number;
}) {
  const c = size / 2;
  const R = c - 6;
  const ticks: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
  for (let deg = 0; deg < 360; deg += 15) {
    const major = deg % 45 === 0;
    const a = ((deg - 90) * Math.PI) / 180;
    const outer = R;
    const inner = R - (major ? 7 : 3.5);
    ticks.push({
      x1: c + outer * Math.cos(a), y1: c + outer * Math.sin(a),
      x2: c + inner * Math.cos(a), y2: c + inner * Math.sin(a), major,
    });
  }
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title="Heading + bearing to destination">
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" aria-hidden="true">
        <circle cx={c} cy={c} r={R} fill="none" stroke="#3a3a3a" strokeWidth="1.5" />
        {/* #43 — cardinal/inter-cardinal tick refinement */}
        {ticks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.major ? '#d4a017' : '#444'} strokeWidth={t.major ? 1.2 : 0.8} />
        ))}
        {/* fixed lubber line at top */}
        <line x1={c} y1={2} x2={c} y2={10} stroke="#d4a017" strokeWidth="1.6" />
        {/* #44 — bearing-to-destination gold needle */}
        {destBearing != null && (
          <g style={{ transform: `rotate(${destBearing}deg)`, transformOrigin: `${c}px ${c}px`, transition: 'transform 0.4s ease-out' }}>
            <line x1={c} y1={c} x2={c} y2={c - R + 4} stroke="#d4a017" strokeWidth="1.4" strokeDasharray="2 2" strokeOpacity="0.85" />
            <circle cx={c} cy={c - R + 6} r="2" fill="#d4a017" />
          </g>
        )}
      </svg>
      <span className="absolute top-0 left-1/2 -translate-x-1/2 text-[8px] text-rmpg-500">N</span>
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[8px] text-rmpg-700">S</span>
      <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[8px] text-rmpg-700">W</span>
      <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[8px] text-rmpg-700">E</span>
      <Navigation2
        className="absolute inset-0 m-auto w-8 h-8 text-brand-400"
        style={{ transform: `rotate(${heading ?? 0}deg)`, transition: 'transform 0.3s ease-out', filter: heading != null ? 'drop-shadow(0 0 4px rgba(212,160,23,0.5))' : 'none' }}
        fill={heading != null ? '#d4a017' : 'none'}
      />
      {/* #34 — N-UP / H-UP orientation label */}
      <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[7px] font-bold text-brand-300 bg-surface-deep px-1" style={{ borderRadius: 2 }}>
        {orientation === 'heading-up' ? 'H-UP' : 'N-UP'}
      </span>
    </div>
  );
}

// ── #67 — cyclable StatTile ────────────────────────────────────────────────────
export interface CyclableMetric { key: string; label: string; value: string; accent?: string; dim?: boolean }

export function HudStatTile({
  metrics, initialIndex = 0, night,
}: { metrics: CyclableMetric[]; initialIndex?: number; night?: boolean }) {
  const [idx, setIdx] = useState(initialIndex);
  const pressTimer = useRef<number | null>(null);
  const cycle = () => setIdx((i) => (i + 1) % metrics.length);
  const m = metrics[Math.min(idx, metrics.length - 1)] || metrics[0];
  if (!m) return null;
  const cyclable = metrics.length > 1;
  const startPress = () => {
    if (!cyclable) return;
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(cycle, 450);
  };
  const endPress = () => { if (pressTimer.current) { window.clearTimeout(pressTimer.current); pressTimer.current = null; } };
  return (
    <div
      className={`relative border px-2 py-1 min-w-0 overflow-hidden ${cyclable ? 'cursor-pointer' : ''} ${night ? 'border-rmpg-700' : 'border-rmpg-800'}`}
      style={{ borderRadius: 2, background: night ? 'rgba(8,8,8,0.85)' : 'rgba(20,20,20,0.6)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }}
      onMouseDown={startPress} onMouseUp={endPress} onMouseLeave={endPress}
      onTouchStart={startPress} onTouchEnd={endPress}
      onContextMenu={(e) => { if (cyclable) { e.preventDefault(); cycle(); } }}
      title={cyclable ? 'Long-press to cycle metric' : undefined}
    >
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, #d4a01733 40%, #d4a01755 60%, transparent)' }} />
      <div className={`text-[8px] uppercase tracking-wider leading-none truncate ${night ? 'text-rmpg-500' : 'text-rmpg-600'}`}>{m.label}</div>
      <div
        className={`font-mono ${night ? 'font-extrabold' : 'font-bold'} text-[13px] leading-tight mt-0.5 truncate tabular-nums`}
        style={{ color: m.accent || (m.dim ? '#6b6b6b' : (night ? '#e8e8e8' : '#d4d4d4')) }}
      >
        {m.value}
      </div>
    </div>
  );
}

// ── #40 — GPS fix-quality pill ──────────────────────────────────────────────────
export function HudQualityPill({ accuracy }: { accuracy: number | null }) {
  const a = accuracy;
  const { color, label } = a == null
    ? { color: 'var(--rmpg-500)', label: 'NO FIX' }
    : a < 10 ? { color: '#22c55e', label: 'GOOD' }
      : a < 30 ? { color: '#f59e0b', label: 'FAIR' }
        : { color: '#ef4444', label: 'POOR' };
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold uppercase font-mono" style={{ border: `1px solid ${color}`, color, borderRadius: 2 }} title="GPS fix quality">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label}{a != null ? ` ${Math.round(a)}m` : ''}
    </span>
  );
}

/** One lane's guidance state at a maneuver — mirrors RouteStepLane's shape (this
 *  file intentionally defines its own types rather than importing from
 *  useMapRouting.ts, per this lane's "no cross-lane imports" convention). */
interface HudLane {
  valid: boolean;
  active: boolean;
  indications: string[];
}

// ── #41/#42 — next-maneuver mini-icon + progress micro-bar ───────────────────────
export function HudNextManeuver({
  maneuverType, modifier, instruction, distanceToTurnMeters, stepDistanceMeters, lanes,
}: {
  maneuverType: string | null; modifier?: string; instruction?: string;
  distanceToTurnMeters: number | null; stepDistanceMeters: number | null;
  lanes?: HudLane[];
}) {
  if (!maneuverType) return null;
  const Icon = maneuverIconFor(maneuverType, modifier);
  const dt = distanceToTurnMeters;
  const dText = dt == null ? '' : dt < 160 ? `${Math.round(dt * 3.28084)} ft` : `${(dt / 1609.34).toFixed(1)} mi`;
  // fill grows as we approach (remaining shrinks against the step length)
  const frac = (dt != null && stepDistanceMeters && stepDistanceMeters > 0)
    ? Math.max(0, Math.min(1, 1 - dt / stepDistanceMeters)) : 0;
  return (
    <div className="flex flex-col gap-0.5 px-1.5 py-1 border border-rmpg-800" style={{ borderRadius: 2, background: 'rgba(20,20,20,0.6)' }} title={instruction || 'Next maneuver'}>
      <div className="flex items-center gap-1.5">
        <Icon className="w-4 h-4 text-brand-300 shrink-0" />
        <div className="min-w-0">
          <div className="text-[8px] uppercase tracking-wider text-rmpg-600 leading-none">Next</div>
          <div className="font-mono font-bold text-[12px] text-brand-200 leading-none mt-0.5">{dText || '—'}</div>
        </div>
      </div>
      {/* #42 — distance-to-turn micro-bar */}
      <div className="h-1 bg-rmpg-800 overflow-hidden" style={{ borderRadius: 2 }}>
        <div className="h-full" style={{ width: `${Math.round(frac * 100)}%`, background: '#d4a017', transition: 'width 0.4s ease-out' }} />
      </div>
      {lanes && lanes.length > 0 && (
        <div data-testid="lane-strip" className="flex items-center gap-1 mt-0.5">
          {lanes.map((lane, i) => (
            <ArrowUp
              key={i}
              data-testid="lane-icon"
              data-lane-valid={lane.valid}
              data-lane-active={lane.active}
              aria-hidden="true"
              className="w-3 h-3"
              style={{
                color: lane.valid ? '#d4a017' : 'var(--rmpg-700)',
                transform: laneRotation(lane.indications),
                ...(lane.active ? { filter: 'drop-shadow(0 0 2px #d4a017)' } : {}),
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Rough rotation for a lane's primary indication — good enough for a small icon strip.
 * Priority: hard turns > straight > slight turns. A lane valid for both "straight" and a
 * slight variant renders upright, not tilted, so officers don't read a mandatory-turn cue
 * where none exists. */
function laneRotation(indications: string[]): string {
  if (indications.includes('left')) return 'rotate(-45deg)';
  if (indications.includes('right')) return 'rotate(45deg)';
  if (indications.includes('straight')) return 'rotate(0deg)';
  if (indications.includes('slight left')) return 'rotate(-22deg)';
  if (indications.includes('slight right')) return 'rotate(22deg)';
  return 'rotate(0deg)';
}

// ── #30/#58 — track export cluster ────────────────────────────────────────────
export function HudExportCluster({
  pointCount, onGpx, onCsv,
}: { pointCount: number; onGpx: () => void; onCsv: () => void }) {
  const disabled = pointCount < 2;
  const reason = disabled ? 'Need more track points' : `Export ${pointCount} track points`;
  return (
    <div className="flex items-center gap-1">
      {(['GPX', 'CSV'] as const).map((fmt) => (
        <button
          key={fmt}
          type="button"
          onClick={() => { if (disabled) return; fmt === 'GPX' ? onGpx() : onCsv(); }}
          aria-disabled={disabled}
          aria-label={disabled ? `${fmt} export — ${reason}` : `Export track as ${fmt}`}
          title={reason}
          className="flex items-center gap-0.5 px-1.5 py-1 text-[8px] font-bold uppercase font-mono border"
          style={{
            borderRadius: 2,
            borderColor: disabled ? '#2e2e2e' : '#3a3a3a',
            color: disabled ? '#555' : '#d4a017',
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: 'rgba(20,20,20,0.6)',
          }}
        >
          <Download className="w-3 h-3" /> {fmt}
        </button>
      ))}
    </div>
  );
}

// ── #32 — driving-score chip ────────────────────────────────────────────────────
export function HudDrivingScore({
  peakLong, peakLat, hardBrakes, hardAccels,
}: { peakLong: number; peakLat: number; hardBrakes: number; hardAccels: number }) {
  const events = hardBrakes + hardAccels;
  const color = events >= 6 ? '#ef4444' : events >= 2 ? '#f59e0b' : '#22c55e';
  return (
    <div className="flex flex-col px-1.5 py-1 border border-rmpg-800" style={{ borderRadius: 2, background: 'rgba(20,20,20,0.6)' }} title="Driving score — peak g + hard events">
      <div className="text-[7px] uppercase tracking-wider text-rmpg-600 leading-none">Drive</div>
      <div className="flex items-center gap-1.5 mt-0.5 font-mono text-[9px] tabular-nums">
        <span className="text-rmpg-300">pk {Math.max(peakLong, peakLat).toFixed(2)}g</span>
        <span style={{ color }}>HB {hardBrakes}</span>
        <span style={{ color }}>HA {hardAccels}</span>
      </div>
    </div>
  );
}

// ── #45/#66 — collapse toggle + condensed single-line summary ───────────────────
export function HudCollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? 'Expand instrument dashboard' : 'Collapse instrument dashboard'}
      title={collapsed ? 'Expand dashboard' : 'Collapse dashboard'}
      className="flex items-center justify-center px-1.5 py-1 border border-rmpg-700 text-rmpg-300 hover:text-rmpg-100"
      style={{ borderRadius: 2, background: 'rgba(20,20,20,0.7)' }}
    >
      {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
    </button>
  );
}

export function HudSummaryLine({
  unit, street, headingTxt, speedTxt, etaTxt,
}: { unit: string | null; street: string | null; headingTxt: string; speedTxt: string; etaTxt: string | null }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] text-rmpg-200 overflow-hidden">
      {unit && <span className="text-brand-300 font-bold shrink-0">{unit}</span>}
      {street && <span className="truncate">{street}</span>}
      <span className="ml-auto shrink-0 text-brand-200 font-bold">{speedTxt}</span>
      <span className="shrink-0 text-rmpg-400">{headingTxt}</span>
      {etaTxt && <span className="shrink-0 text-rmpg-400">ETA {etaTxt}</span>}
    </div>
  );
}

// ── #46 — mute-tones quick toggle ─────────────────────────────────────────────
export function HudMuteToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={muted ? 'Unmute HUD alert tones' : 'Mute HUD alert tones'}
      title={muted ? 'Tones muted — tap to unmute' : 'Tones on — tap to mute'}
      className="flex items-center justify-center px-1.5 py-1 border"
      style={{ borderRadius: 2, borderColor: muted ? '#3a1f1f' : '#3a3a3a', color: muted ? '#ef4444' : '#d4a017', background: 'rgba(20,20,20,0.7)' }}
    >
      {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
    </button>
  );
}

// ── #47/#62/#63 — lower-HUD control cluster (recenter / zoom / tilt) ─────────────
export function HudMapControls({
  followActive, onRecenter, onZoomIn, onZoomOut, pitched, onTogglePitch,
}: {
  followActive: boolean; onRecenter: () => void;
  onZoomIn: () => void; onZoomOut: () => void;
  pitched: boolean; onTogglePitch: () => void;
}) {
  const btn = "flex items-center justify-center w-8 h-8 border";
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={onRecenter} aria-label="Recenter / follow me" title={followActive ? 'Following — recenter' : 'Re-enable follow-me'}
        className={btn} style={{ borderRadius: 2, borderColor: followActive ? '#d4a017' : '#3a3a3a', color: followActive ? '#d4a017' : 'var(--rmpg-400)', background: followActive ? 'rgba(212,160,23,0.12)' : 'rgba(20,20,20,0.7)' }}>
        <Crosshair className="w-4 h-4" />
      </button>
      <button type="button" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in"
        className={btn} style={{ borderRadius: 2, borderColor: '#3a3a3a', color: 'var(--rmpg-400)', background: 'rgba(20,20,20,0.7)' }}>
        <Plus className="w-4 h-4" />
      </button>
      <button type="button" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out"
        className={btn} style={{ borderRadius: 2, borderColor: '#3a3a3a', color: 'var(--rmpg-400)', background: 'rgba(20,20,20,0.7)' }}>
        <Minus className="w-4 h-4" />
      </button>
      <button type="button" onClick={onTogglePitch} aria-label={pitched ? 'Switch to 2D' : 'Switch to 3D'} title={pitched ? '3D — tap for 2D' : '2D — tap for 3D'}
        className={btn} style={{ borderRadius: 2, borderColor: pitched ? '#d4a017' : '#3a3a3a', color: pitched ? '#d4a017' : 'var(--rmpg-400)', background: pitched ? 'rgba(212,160,23,0.12)' : 'rgba(20,20,20,0.7)' }}>
        <Box className="w-4 h-4" />
        <span className="text-[7px] font-bold ml-0.5">{pitched ? '3D' : '2D'}</span>
      </button>
    </div>
  );
}

// ── #61 — pulse-on-new-fix source chip ───────────────────────────────────────
export function HudSourceChip({ label, color, fixTick }: { label: string; color: string; fixTick: number }) {
  const [pulse, setPulse] = useState(false);
  const reduced = prefersReducedMotion();
  useEffect(() => {
    if (reduced) return;
    setPulse(true);
    const t = window.setTimeout(() => setPulse(false), 320);
    return () => window.clearTimeout(t);
  }, [fixTick, reduced]);
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold uppercase font-mono" style={{ border: `1px solid ${color}66`, color, borderRadius: 2 }} title="GPS source — pulses on each new fix">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color, transition: 'transform 0.3s ease-out', transform: pulse ? 'scale(1.9)' : 'scale(1)' }} />
      {label}
    </span>
  );
}

// ── #64 — destination-reached confirmation banner ───────────────────────────────
export function HudArrivedBanner({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 shadow-2xl" style={{ background: 'rgba(8,8,8,0.96)', border: '1px solid #22c55e', borderRadius: 2, boxShadow: '0 0 16px rgba(34,197,94,0.4)' }}>
      <Flag className="w-4 h-4 shrink-0" style={{ color: '#22c55e' }} />
      <span className="text-[12px] font-bold uppercase tracking-wide" style={{ color: '#22c55e' }}>Arrived — {label}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss arrival" title="Dismiss" className="ml-2 text-rmpg-400 hover:text-rmpg-100 text-[11px] font-bold">✕</button>
    </div>
  );
}

// ── #9 — device health badge (low battery / degraded GPS) ───────────────────────
const GPS_DEGRADED_M = 500;
const BATTERY_LOW_PCT = 20;

export function HudDeviceHealthBadge({
  batteryLevel, batteryCharging, gpsAccuracy,
}: { batteryLevel: number | null; batteryCharging: boolean; gpsAccuracy: number | null }) {
  const lowBattery = batteryLevel != null && batteryLevel < BATTERY_LOW_PCT && !batteryCharging;
  const gpsDegraded = gpsAccuracy != null && gpsAccuracy > GPS_DEGRADED_M;
  if (!lowBattery && !gpsDegraded) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {lowBattery && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold uppercase font-mono" style={{ border: '1px solid #ef4444', color: '#ef4444', borderRadius: 2 }} title="Device battery low">
          Low battery {batteryLevel}%
        </span>
      )}
      {gpsDegraded && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold uppercase font-mono" style={{ border: '1px solid #f59e0b', color: '#f59e0b', borderRadius: 2 }} title="GPS fix accuracy degraded">
          GPS degraded ±{Math.round(gpsAccuracy!)}m
        </span>
      )}
    </div>
  );
}

// ── #70 — parked badge ──────────────────────────────────────────────────────────
export function HudParkedBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold uppercase font-mono text-rmpg-400" style={{ border: '1px solid #3a3a3a', borderRadius: 2, background: 'rgba(20,20,20,0.7)' }} title="Vehicle stationary">
      <Square className="w-2 h-2" fill="currentColor" aria-hidden="true" />Parked
    </span>
  );
}
