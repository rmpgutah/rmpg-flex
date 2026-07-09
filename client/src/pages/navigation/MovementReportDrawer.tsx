// ============================================================
// MOVEMENT REPORT drawer — the "TRIP" overlay on the NAVIGATE screen.
// Deep, visual reporting of the vehicle's motion this session: speed
// profile, a g-force friction circle, moving/idle split, and a harsh-
// driving event log. All metrics come from buildMovementReport() (pure),
// which derives speed from position so it works on cellular too.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, X, Gauge, TimerReset, Octagon, TrendingUp, TrendingDown,
  CornerUpRight, AlertTriangle, Satellite, Route as RouteIcon,
  Play, Pause, Navigation2,
} from 'lucide-react';
import type { MovementReport, DrivingEvent } from './vehicleTelemetry';
import { replayIndexAt, replayDurationMs, type ReplayPoint } from './tripReplay';
import { parseTimestamp } from '../../utils/dateUtils';

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function fmtClock(t: number): string {
  try {
    return new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return '—';
  }
}

const EVENT_META: Record<DrivingEvent['kind'], { label: string; icon: typeof TrendingUp; color: string }> = {
  accel: { label: 'Hard accel', icon: TrendingUp, color: '#f59e0b' },
  brake: { label: 'Hard brake', icon: TrendingDown, color: '#ef4444' },
  corner: { label: 'Hard corner', icon: CornerUpRight, color: '#8b5cf6' },
};

const SOURCE_LABEL: Record<MovementReport['speedSource'], string> = {
  device: 'GPS speed', derived: 'Position-derived', mixed: 'GPS + derived', none: 'No data',
};

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="relative bg-surface-raised/50 border border-rmpg-800 px-2 py-1.5 overflow-hidden" style={{ borderRadius: 2 }}>
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, #d4a01744 50%, transparent)' }} />
      <div className="text-[8px] uppercase tracking-wider text-rmpg-600 leading-none truncate">{label}</div>
      <div className="font-mono font-bold text-[15px] leading-tight mt-0.5 tabular-nums truncate" style={{ color: accent || '#d4d4d4' }}>{value}</div>
      {sub && <div className="text-[8px] text-rmpg-600 leading-none truncate">{sub}</div>}
    </div>
  );
}

// ── Speed-over-session area chart ──
function SpeedProfile({ report }: { report: MovementReport }) {
  const { series, maxMph, avgMovingMph } = report;
  const W = 300, H = 84;
  const n = series.length;
  const scale = Math.max(40, maxMph, avgMovingMph);
  const path = useMemo(() => {
    if (n < 2) return { area: '', line: '' };
    const x = (i: number) => (i / (n - 1)) * W;
    const y = (mph: number) => H - Math.min(H, (mph / scale) * H);
    const pts = series.map((s, i) => `${x(i).toFixed(1)},${y(s.mph).toFixed(1)}`);
    return { area: `0,${H} ${pts.join(' ')} ${W},${H}`, line: pts.join(' ') };
  }, [series, n, scale]);

  const avgY = H - Math.min(H, (avgMovingMph / scale) * H);
  if (n < 2) {
    return <div className="flex items-center justify-center text-[10px] text-rmpg-600" style={{ height: H }}>Collecting motion…</div>;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H }} aria-hidden="true">
      <defs>
        <linearGradient id="spd-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d4a017" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#d4a017" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* avg guide */}
      {avgMovingMph > 0 && (
        <line x1="0" y1={avgY} x2={W} y2={avgY} stroke="#22c55e" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.7" />
      )}
      <polyline points={path.area} fill="url(#spd-fill)" stroke="none" />
      <polyline points={path.line} fill="none" stroke="#d4a017" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── G-force friction circle (longitudinal vs lateral load) ──
function FrictionCircle({ report, liveLongG, liveLatG }: { report: MovementReport; liveLongG: number; liveLatG: number }) {
  const size = 150, c = size / 2, R = c - 14; // 1.0 g = R
  const gToPx = (g: number) => Math.max(-1.2, Math.min(1.2, g)) * R;
  const dots = useMemo(
    () => report.series.filter((s) => Math.abs(s.longG) > 0.04 || Math.abs(s.latG) > 0.04),
    [report.series],
  );
  const ring = (g: number) => (g * R);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }} aria-hidden="true">
      {[0.25, 0.5, 0.75, 1.0].map((g) => (
        <circle key={g} cx={c} cy={c} r={ring(g)} fill="none" stroke={g === 1 ? 'var(--border-default)' : 'var(--border-subtle)'} strokeWidth="1" />
      ))}
      <line x1={c} y1={c - R} x2={c} y2={c + R} stroke="var(--border-subtle)" strokeWidth="1" />
      <line x1={c - R} y1={c} x2={c + R} y2={c} stroke="var(--border-subtle)" strokeWidth="1" />
      {/* history dots */}
      {dots.map((s, i) => {
        const mag = Math.min(1, Math.hypot(s.longG, s.latG));
        const col = mag > 0.55 ? '#ef4444' : mag > 0.35 ? '#f59e0b' : '#6b7280';
        return <circle key={i} cx={c + gToPx(s.latG)} cy={c - gToPx(s.longG)} r="1.4" fill={col} opacity="0.5" />;
      })}
      {/* live point */}
      <circle cx={c + gToPx(liveLatG)} cy={c - gToPx(liveLongG)} r="3.5" fill="#d4a017" stroke="#0a0a0a" strokeWidth="1" />
      <text x={c} y={11} textAnchor="middle" className="fill-rmpg-600" style={{ fontSize: 7, letterSpacing: 1 }}>ACCEL</text>
      <text x={c} y={size - 4} textAnchor="middle" className="fill-rmpg-600" style={{ fontSize: 7, letterSpacing: 1 }}>BRAKE</text>
      <text x={9} y={c - 3} textAnchor="start" className="fill-rmpg-700" style={{ fontSize: 7 }}>L</text>
      <text x={size - 9} y={c - 3} textAnchor="end" className="fill-rmpg-700" style={{ fontSize: 7 }}>R</text>
    </svg>
  );
}

const SPEED_MULTIPLIERS = [1, 2, 4, 8] as const;

function fmtReplayClock(iso: string): string {
  try {
    return parseTimestamp(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return '—';
  }
}

// ── Trip replay — scrub/play through the already-fetched breadcrumb track.
// TripReplayMap renders the polyline + moving marker (passive — camera is
// fixed to the trip's bounds on load, no follow/click-to-scrub); the numeric
// readout (lat/lng/speed/heading @ the replay index) stays below it. ──
function TripReplay({ points }: { points: ReplayPoint[] }) {
  const [playing, setPlaying] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [speedMultiplier, setSpeedMultiplier] = useState(4);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);

  const durationMs = useMemo(() => replayDurationMs(points), [points]);
  const replayIdx = replayIndexAt(points, elapsedMs, speedMultiplier);
  const current = points[replayIdx];

  useEffect(() => {
    if (!playing) {
      lastFrameRef.current = null;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = (now: number) => {
      if (lastFrameRef.current == null) lastFrameRef.current = now;
      const dt = now - lastFrameRef.current;
      lastFrameRef.current = now;
      setElapsedMs((prev) => {
        const next = prev + dt;
        if (next >= durationMs) {
          setPlaying(false);
          return durationMs;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      lastFrameRef.current = null;
    };
  }, [playing, durationMs]);

  if (points.length < 2 || durationMs <= 0) return null;

  return (
    <div>
      <div className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-rmpg-600 mb-1">
        <Navigation2 className="w-2.5 h-2.5 text-brand-500" /> Trip replay
        <span className="ml-auto font-mono text-rmpg-500">{current ? fmtReplayClock(current.time) : '—'}</span>
      </div>
      <TripReplayMap points={points} replayIdx={replayIdx} />
      <div className="bg-surface-sunken/60 border border-rmpg-800 px-2 py-1.5 space-y-1.5 mt-1.5" style={{ borderRadius: 2 }}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={playing ? 'Pause replay' : 'Play replay'}
            onClick={() => {
              if (!playing && elapsedMs >= durationMs) setElapsedMs(0);
              setPlaying((p) => !p);
            }}
            className="shrink-0 w-6 h-6 flex items-center justify-center bg-surface-raised/60 border border-rmpg-700 text-rmpg-200 hover:text-brand-400"
            style={{ borderRadius: 2 }}
          >
            {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          </button>
          <input
            type="range"
            min={0}
            max={durationMs}
            step={100}
            value={elapsedMs}
            onChange={(e) => {
              setPlaying(false);
              setElapsedMs(Number(e.target.value));
            }}
            aria-label="Replay position"
            className="flex-1 accent-brand-500"
          />
          <div className="flex items-center gap-0.5 shrink-0">
            {SPEED_MULTIPLIERS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSpeedMultiplier(m)}
                className={`px-1 py-0.5 text-[8px] font-mono border ${
                  m === speedMultiplier
                    ? 'border-brand-400 text-brand-400'
                    : 'border-rmpg-800 text-rmpg-500'
                }`}
                style={{ borderRadius: 2 }}
              >
                {m}x
              </button>
            ))}
          </div>
        </div>
        {current && (
          <div className="grid grid-cols-4 gap-1 text-[9px] font-mono text-rmpg-400">
            <span>{current.lat.toFixed(5)}</span>
            <span>{current.lng.toFixed(5)}</span>
            <span>{current.speed != null ? `${Math.round(current.speed)} mph` : '—'}</span>
            <span>{current.heading != null ? `${Math.round(current.heading)}°` : '—'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  report: MovementReport;
  liveMph: number | null;
  liveLongG: number;
  liveLatG: number;
  sessionMs: number;
  /** Cumulative session ascent (ft), sampled from the 3D terrain DEM. */
  climbFt?: number;
  /** Live ground elevation (ft) at the unit, or null until DEM tiles load. */
  elevFt?: number | null;
  /** Raw breadcrumb track for the "trip replay" scrubber, chronological. Optional —
   *  when omitted (or too short), the replay section simply doesn't render. */
  points?: ReplayPoint[];
  onClose: () => void;
}

export default function MovementReportDrawer({ report, liveMph, liveLongG, liveLatG, sessionMs, climbFt, elevFt, points, onClose }: Props) {
  const total = report.movingMs + report.idleMs;
  const movePct = total > 0 ? Math.round((report.movingMs / total) * 100) : 0;

  return (
    <div
      className="absolute z-30 panel-beveled bg-surface-deep/95 backdrop-blur-md border border-rmpg-600 shadow-2xl flex flex-col"
      style={{ top: 44, bottom: 8, right: 8, width: 360, maxWidth: 'calc(100vw - 16px)', borderRadius: 2 }}
    >
      {/* header */}
      <div className="relative flex items-center gap-2 px-3 py-2 border-b border-rmpg-700 shrink-0">
        <div className="absolute bottom-0 inset-x-0 h-px" style={{ background: 'linear-gradient(90deg, #d4a01766, transparent)' }} />
        <Activity className="w-4 h-4 text-brand-400" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-rmpg-100 flex-1">Movement Report</span>
        <span className="flex items-center gap-1 text-[8px] uppercase text-rmpg-500">
          <Satellite className="w-3 h-3" /> {SOURCE_LABEL[report.speedSource]}
        </span>
        <button onClick={onClose} className="text-rmpg-500 hover:text-rmpg-100" aria-label="Close movement report"><X className="w-4 h-4" /></button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark px-3 py-2.5 space-y-3">
        {/* live speed + session */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="font-mono font-bold leading-none tabular-nums" style={{ fontSize: 40, color: liveMph != null ? '#d4a017' : '#555' }}>
              {liveMph != null ? liveMph : '--'}
            </span>
            <span className="text-[8px] uppercase tracking-widest text-rmpg-500">mph · live</span>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-1.5">
            <Stat label="Session" value={fmtDur(sessionMs)} />
            <Stat label="Distance" value={`${report.totalMi.toFixed(2)} mi`} accent="#d4a017" />
            <Stat label="Climb" value={`${Math.round(climbFt ?? 0).toLocaleString()} ft`} accent={climbFt && climbFt > 0 ? '#22c55e' : undefined} />
            <Stat label="Elevation" value={elevFt != null ? `${Math.round(elevFt).toLocaleString()} ft` : '—'} />
          </div>
        </div>

        {/* trip replay */}
        {points && points.length >= 2 && <TripReplay points={points} />}

        {/* speed profile */}
        <div>
          <div className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-rmpg-600 mb-1">
            <Gauge className="w-2.5 h-2.5 text-brand-500" /> Speed profile · session
            <span className="ml-auto font-mono text-rmpg-500">max {report.maxMph} · avg {Math.round(report.avgMovingMph)}</span>
          </div>
          <div className="bg-surface-sunken/60 border border-rmpg-800 px-1 py-1" style={{ borderRadius: 2 }}>
            <SpeedProfile report={report} />
          </div>
        </div>

        {/* friction circle + g stats */}
        <div className="flex items-center gap-3">
          <div className="shrink-0 bg-surface-sunken/60 border border-rmpg-800" style={{ borderRadius: 2 }}>
            <FrictionCircle report={report} liveLongG={liveLongG} liveLatG={liveLatG} />
          </div>
          <div className="flex-1 grid grid-cols-1 gap-1.5">
            <Stat label="Peak accel" value={`${report.maxAccelG.toFixed(2)} g`} accent="#f59e0b" />
            <Stat label="Peak brake" value={`${report.maxBrakeG.toFixed(2)} g`} accent="#ef4444" />
            <Stat label="Peak cornering" value={`${report.maxLatG.toFixed(2)} g`} accent="#8b5cf6" />
          </div>
        </div>

        {/* moving vs idle */}
        <div>
          <div className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-rmpg-600 mb-1">
            <TimerReset className="w-2.5 h-2.5 text-brand-500" /> Moving vs idle
            <span className="ml-auto font-mono text-rmpg-500">{movePct}% moving</span>
          </div>
          <div className="flex h-2 overflow-hidden border border-rmpg-800" style={{ borderRadius: 2 }}>
            <div className="h-full" style={{ width: `${movePct}%`, background: '#22c55e' }} />
            <div className="h-full" style={{ width: `${100 - movePct}%`, background: 'var(--border-default)' }} />
          </div>
          <div className="flex items-center justify-between mt-1 text-[9px] font-mono">
            <span className="text-green-400">▶ {fmtDur(report.movingMs)} moving</span>
            <span className="flex items-center gap-1 text-rmpg-500"><Octagon className="w-2.5 h-2.5" /> {report.stops} stops</span>
            <span className="text-rmpg-500">⏸ {fmtDur(report.idleMs)} idle</span>
          </div>
        </div>

        {/* driving event log */}
        <div>
          <div className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-rmpg-600 mb-1">
            <AlertTriangle className="w-2.5 h-2.5 text-brand-500" /> Driving events
            <span className="ml-auto font-mono text-rmpg-500">{report.events.length}</span>
          </div>
          {report.events.length === 0 ? (
            <div className="text-[10px] text-rmpg-600 px-1 py-2 flex items-center gap-1">
              <RouteIcon className="w-3 h-3" /> Smooth driving — no harsh events logged.
            </div>
          ) : (
            <div className="space-y-0.5">
              {report.events.map((e, i) => {
                const meta = EVENT_META[e.kind];
                const Icon = meta.icon;
                return (
                  <div key={i} className="flex items-center gap-2 px-1.5 py-1 bg-surface-raised/40 border-l-2" style={{ borderRadius: 2, borderLeftColor: meta.color }}>
                    <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: meta.color }} />
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: meta.color }}>{meta.label}</span>
                    {/* severity pips */}
                    <span className="flex gap-0.5">
                      {[1, 2, 3].map((s) => (
                        <span key={s} className="w-1 h-1 rounded-full" style={{ background: s <= e.severity ? meta.color : '#333' }} />
                      ))}
                    </span>
                    <span className="ml-auto font-mono text-[9px] text-rmpg-400">{e.g.toFixed(2)} g</span>
                    <span className="font-mono text-[9px] text-rmpg-500">{e.mph} mph</span>
                    <span className="font-mono text-[8px] text-rmpg-600 tabular-nums">{fmtClock(e.t)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
