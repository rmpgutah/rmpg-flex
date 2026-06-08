import { useState, useEffect, useRef } from 'react';
import { X, Gauge } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp } from '../../../utils/dateUtils';

interface SpeedGraphOverlayProps {
  unitId: number;
  callSign: string;
  hours: number;
  onClose: () => void;
  playbackIdx?: number;
}

interface TrailPoint {
  latitude: number;
  longitude: number;
  speed: number | null;
  recorded_at: string;
}

const MPS_TO_MPH = 2.23694;

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

export default function SpeedGraphOverlay({
  unitId,
  callSign,
  hours,
  onClose,
  playbackIdx,
}: SpeedGraphOverlayProps) {
  const [points, setPoints] = useState<{ mph: number; time: string }[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchTrail = async () => {
      try {
        const raw = await apiFetch<TrailPoint[]>(`/dispatch/gps/trail/${unitId}?hours=${hours}`);
        if (cancelled) return;

        // Take last 200 points
        const tail = raw.slice(-200);
        const mapped = tail.map((p) => ({
          mph: p.speed != null && Number.isFinite(p.speed) ? p.speed * MPS_TO_MPH : 0,
          time: p.recorded_at,
        }));
        setPoints(mapped);
      } catch (err) {
        console.error('[SpeedGraph] fetch error:', err);
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

  // Map speed to y coordinate (inverted: 0 at bottom)
  const toY = (mph: number) => PAD_TOP + PLOT_H - (Math.min(mph, yMax) / yMax) * PLOT_H;
  const toX = (i: number) => PAD_LEFT + (i / (points.length - 1)) * PLOT_W;

  // Build SVG path
  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.mph).toFixed(1)}`)
    .join(' ');

  // Time labels
  const startTime = formatTime(points[0].time);
  const endTime = formatTime(points[points.length - 1].time);

  // Grid lines at 25, 50, 75 mph (only those within yMax)
  const gridLines = [25, 50, 75].filter((v) => v <= yMax);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '3.5rem',
        right: '0.5rem',
        zIndex: 40,
        width: 360,
        background: '#0a0a0aee',
        border: '1px solid #222222',
        borderRadius: 2,
        padding: 0,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        color: '#cccccc',
        fontSize: 11,
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          borderBottom: '1px solid #222222',
          background: 'linear-gradient(180deg, #1a1a1a 0%, #242424 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Gauge size={14} color="#d4a017" />
          <span style={{ color: '#d4a017', fontWeight: 600, fontSize: 11 }}>{callSign}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: currentColor, fontWeight: 700, fontSize: 18, lineHeight: 1 }}>
            {Math.round(currentSpeed)}
          </span>
          <span style={{ color: '#666666', fontSize: 9, marginRight: 6 }}>mph</span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
            }}
            aria-label="Close speed graph"
          >
            <X size={14} color="#666666" />
          </button>
        </div>
      </div>

      {/* SVG Sparkline */}
      <div style={{ padding: '6px 8px 4px' }}>
        <svg
          width={SVG_WIDTH}
          height={SVG_HEIGHT}
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          style={{ display: 'block', margin: '0 auto' }}
        >
          {/* Band backgrounds */}
          {BANDS.map((band) => {
            const bandTop = toY(Math.min(band.max, yMax));
            const bandBottom = toY(band.min);
            const h = bandBottom - bandTop;
            if (h <= 0) return null;
            return (
              <rect
                key={band.min}
                x={PAD_LEFT}
                y={bandTop}
                width={PLOT_W}
                height={h}
                fill={band.color}
                opacity={0.08}
              />
            );
          })}

          {/* Grid lines */}
          {gridLines.map((v) => (
            <g key={v}>
              <line
                x1={PAD_LEFT}
                y1={toY(v)}
                x2={PAD_LEFT + PLOT_W}
                y2={toY(v)}
                stroke="#444444"
                strokeWidth={0.5}
                strokeDasharray="3,3"
              />
              <text
                x={PAD_LEFT + PLOT_W + 3}
                y={toY(v) + 3}
                fill="#555555"
                fontSize={8}
                fontFamily="monospace"
              >
                {v}
              </text>
            </g>
          ))}

          {/* Speed line */}
          <path
            d={pathD}
            fill="none"
            stroke={currentColor}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Playback cursor */}
          {playbackIdx != null && playbackIdx >= 0 && playbackIdx < points.length && (
            <line
              x1={toX(playbackIdx)}
              y1={PAD_TOP}
              x2={toX(playbackIdx)}
              y2={PAD_TOP + PLOT_H}
              stroke="#00ff88"
              strokeWidth={1}
              opacity={0.8}
            />
          )}

          {/* Current point (rightmost) */}
          <circle
            cx={toX(points.length - 1)}
            cy={toY(currentSpeed)}
            r={3}
            fill={currentColor}
            stroke="#ffffff"
            strokeWidth={1}
          />

          {/* Time labels */}
          <text
            x={PAD_LEFT}
            y={SVG_HEIGHT - 1}
            fill="#555555"
            fontSize={8}
            fontFamily="monospace"
            textAnchor="start"
          >
            {startTime}
          </text>
          <text
            x={PAD_LEFT + PLOT_W}
            y={SVG_HEIGHT - 1}
            fill="#555555"
            fontSize={8}
            fontFamily="monospace"
            textAnchor="end"
          >
            {endTime}
          </text>

          {/* Max speed label */}
          <text
            x={SVG_WIDTH - 2}
            y={PAD_TOP + 8}
            fill="#555555"
            fontSize={8}
            fontFamily="monospace"
            textAnchor="end"
          >
            max {Math.round(maxSpeed)}
          </text>
        </svg>
      </div>
    </div>
  );
}

/** Format ISO timestamp to HH:MM local time */
function formatTime(isoStr: string): string {
  try {
    const d = parseTimestamp(isoStr);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '--:--';
  }
}
