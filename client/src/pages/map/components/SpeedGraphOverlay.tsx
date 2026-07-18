import { useState, useEffect, useRef } from 'react';
import { X, Gauge } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp } from '../../../utils/dateUtils';

interface SpeedGraphOverlayProps {
  unitId: number;
  callSign: string;
  hours: number;
  onClose: () => void;
}

interface TrailResponse {
  unit_id: number;
  points: { lat: number; lng: number; speed: number | null; time: string }[];
}

const speedToColor = (mph: number): string => {
  if (mph < 3) return '#999999';
  if (mph < 25) return '#22c55e';
  if (mph < 35) return '#84cc16';
  if (mph < 45) return '#eab308';
  if (mph < 55) return '#f97316';
  if (mph < 75) return '#ef4444';
  return '#dc2626';
};

// Band thresholds for background stripes (mph)
const BANDS = [
  { min: 0, max: 25, color: '#22c55e' },
  { min: 25, max: 45, color: '#eab308' },
  { min: 45, max: 75, color: '#f97316' },
  { min: 75, max: 120, color: '#ef4444' },
];

const SVG_WIDTH = 280;
const SVG_HEIGHT = 100;
const PAD_LEFT = 4;
const PAD_RIGHT = 28;
const PAD_TOP = 4;
const PAD_BOTTOM = 14;
const PLOT_W = SVG_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_H = SVG_HEIGHT - PAD_TOP - PAD_BOTTOM;

export default function SpeedGraphOverlay({ unitId, callSign, hours, onClose }: SpeedGraphOverlayProps) {
  const [points, setPoints] = useState<{ mph: number; time: string }[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchTrail = async () => {
      try {
        const raw = await apiFetch<TrailResponse[]>(`/dispatch/gps/trails?hours=${hours}&unit_id=${unitId}`);
        if (cancelled) return;
        const trail = raw.find((t) => t.unit_id === unitId) ?? raw[0];
        const tail = (trail?.points ?? []).slice(-200);
        setPoints(tail.map((p) => ({ mph: p.speed ?? 0, time: p.time })));
      } catch (err) {
        console.warn('[SpeedGraph] fetch error:', err);
      }
    };

    fetchTrail();
    intervalRef.current = setInterval(fetchTrail, 15_000);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [unitId, hours]);

  if (points.length < 2) return null;

  const speeds = points.map((p) => p.mph);
  const maxSpeed = Math.max(...speeds, 1);
  const currentSpeed = speeds[speeds.length - 1];
  const currentColor = speedToColor(currentSpeed);

  // Y-axis caps at nearest 25 above max, minimum 50
  const yMax = Math.max(Math.ceil(maxSpeed / 25) * 25, 50);

  const toY = (mph: number) => PAD_TOP + PLOT_H - (Math.min(mph, yMax) / yMax) * PLOT_H;
  const toX = (i: number) => PAD_LEFT + (i / (points.length - 1)) * PLOT_W;

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.mph).toFixed(1)}`)
    .join(' ');

  const startTime = formatTime(points[0].time);
  const endTime = formatTime(points[points.length - 1].time);

  const gridLines = [25, 50, 75].filter((v) => v <= yMax);

  return (
    <div className="absolute bottom-14 right-2 z-40 w-[360px] bg-surface-raised/95 border border-rmpg-700 rounded-[2px] font-mono text-[11px] text-rmpg-200 select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-rmpg-700">
        <div className="flex items-center gap-1.5">
          <Gauge size={14} className="text-brand-gold-400" />
          <span className="text-brand-gold-400 font-semibold text-[11px]">{callSign}</span>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ color: currentColor }} className="font-bold text-lg leading-none">
            {Math.round(currentSpeed)}
          </span>
          <span className="text-rmpg-500 text-[9px] mr-1.5">mph</span>
          <button onClick={onClose} className="p-0.5 flex items-center" aria-label="Close speed graph">
            <X size={14} className="text-rmpg-500" />
          </button>
        </div>
      </div>

      {/* SVG Sparkline */}
      <div className="px-2 pt-1.5 pb-1">
        <svg width={SVG_WIDTH} height={SVG_HEIGHT} viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="block mx-auto">
          {BANDS.map((band) => {
            const bandTop = toY(Math.min(band.max, yMax));
            const bandBottom = toY(band.min);
            const h = bandBottom - bandTop;
            if (h <= 0) return null;
            return <rect key={band.min} x={PAD_LEFT} y={bandTop} width={PLOT_W} height={h} fill={band.color} opacity={0.08} />;
          })}

          {gridLines.map((v) => (
            <g key={v}>
              <line x1={PAD_LEFT} y1={toY(v)} x2={PAD_LEFT + PLOT_W} y2={toY(v)} stroke="#444444" strokeWidth={0.5} strokeDasharray="3,3" />
              <text x={PAD_LEFT + PLOT_W + 3} y={toY(v) + 3} fill="#666666" fontSize={8} fontFamily="monospace">{v}</text>
            </g>
          ))}

          <path d={pathD} fill="none" stroke={currentColor} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />

          <circle cx={toX(points.length - 1)} cy={toY(currentSpeed)} r={3} fill={currentColor} stroke="#ffffff" strokeWidth={1} />

          <text x={PAD_LEFT} y={SVG_HEIGHT - 1} fill="#666666" fontSize={8} fontFamily="monospace" textAnchor="start">{startTime}</text>
          <text x={PAD_LEFT + PLOT_W} y={SVG_HEIGHT - 1} fill="#666666" fontSize={8} fontFamily="monospace" textAnchor="end">{endTime}</text>
          <text x={SVG_WIDTH - 2} y={PAD_TOP + 8} fill="#666666" fontSize={8} fontFamily="monospace" textAnchor="end">max {Math.round(maxSpeed)}</text>
        </svg>
      </div>
    </div>
  );
}

/** Format a server timestamp (naive UTC or ISO) to HH:MM local time */
function formatTime(isoStr: string): string {
  try {
    const d = parseTimestamp(isoStr);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '--:--';
  }
}
