// ============================================================
// RMPG Flex — Weather Radar Control
// ============================================================
// On-map control panel for the RainViewer precipitation overlay. Mounted only while
// the Weather layer is active. Gives the operator the three things a bare
// on/off toggle can't: WHEN the frame on screen was observed, motion (is the
// cell moving toward the call?), and how hard the overlay is washing out the
// basemap underneath.
// ============================================================

import { useMemo } from 'react';
import { Pause, Play, Radio, RefreshCw, AlertTriangle } from 'lucide-react';
import IconButton from '../../../components/IconButton';
import type { UseMapWeatherRadarResult } from '../../../hooks/useMapWeatherRadar';
import { RADAR_LEGEND } from '../../../hooks/useMapWeatherRadar';

interface Props {
  radar: UseMapWeatherRadarResult;
}

const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Denver',
});

function formatFrameTime(unixSeconds: number | undefined): string {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) return '--:--';
  return TIME_FMT.format(new Date(unixSeconds * 1000));
}

/** "12 min ago" / "now" — relative age of the displayed frame. */
function relativeAge(unixSeconds: number | undefined, nowMs: number): string {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) return '';
  const deltaMin = Math.round((nowMs - unixSeconds * 1000) / 60000);
  if (deltaMin === 0) return 'now';
  // Negative delta = a nowcast frame, i.e. a time that hasn't happened yet.
  if (deltaMin < 0) return `+${Math.abs(deltaMin)} min`;
  return `${deltaMin} min ago`;
}

export default function WeatherRadarControl({ radar }: Props) {
  const { frames, frameIndex, activeFrame, playing, live, error, loading } = radar;

  // Frame timestamps only change when a poll lands, so deriving "now" once per
  // render (rather than on a ticking interval) is enough and keeps this panel
  // from forcing a re-render every second on top of the map.
  const nowMs = Date.now();

  const isForecast = activeFrame?.kind === 'nowcast';
  const observedCount = useMemo(
    () => frames.filter((f) => f.kind !== 'nowcast').length,
    [frames],
  );

  return (
    <div
      className="absolute bottom-24 right-4 z-40 bg-surface-raised/95 border border-border-default backdrop-blur-sm px-3 py-2 w-[248px]"
      style={{ borderRadius: 2 }}
      data-testid="weather-radar-control"
    >
      {/* Header — frame time + live/forecast state */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Radio className="w-3 h-3 text-brand-gold-500 shrink-0" aria-hidden="true" />
          <span
            className="text-[9px] font-semibold tracking-wide"
            style={{ color: 'var(--panel-header-color)' }}
          >
            RADAR
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono">
          {error ? (
            <span className="flex items-center gap-1 text-[color:var(--sev-critical)]">
              <AlertTriangle className="w-3 h-3" aria-hidden="true" /> feed down
            </span>
          ) : loading && frames.length === 0 ? (
            <span className="flex items-center gap-1 text-fg-muted">
              <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" /> loading
            </span>
          ) : (
            <>
              <span className="text-rmpg-200">{formatFrameTime(activeFrame?.time)}</span>
              <span className="text-fg-muted">
                {relativeAge(activeFrame?.time, nowMs)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Forecast / live badge — a nowcast frame is a prediction, and an
          operator making a scene decision must never mistake it for an
          observation. */}
      <div className="flex items-center gap-1.5 mb-1.5 text-[9px] font-mono">
        {isForecast ? (
          <span className="px-1 py-[1px] border border-[color:var(--sev-warn)] text-[color:var(--sev-warn)]">
            FORECAST
          </span>
        ) : (
          <span className="px-1 py-[1px] border border-border-default text-fg-muted">
            OBSERVED
          </span>
        )}
        {!live && (
          <button
            type="button"
            onClick={radar.resumeLive}
            className="px-1 py-[1px] border border-border-default text-fg-secondary hover:text-rmpg-100"
          >
            back to live
          </button>
        )}
        <span className="ml-auto text-fg-muted">
          {frames.length > 0 ? `${frameIndex + 1}/${frames.length}` : '—'}
        </span>
      </div>

      {/* Timeline scrubber + playback */}
      <div className="flex items-center gap-2">
        <IconButton
          aria-label={playing ? 'Pause radar animation' : 'Play radar animation'}
          onClick={radar.togglePlay}
          disabled={frames.length < 2}
          className="text-fg-secondary hover:text-rmpg-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </IconButton>
        <input
          type="range"
          min={0}
          max={Math.max(frames.length - 1, 0)}
          step={1}
          value={frames.length ? frameIndex : 0}
          disabled={frames.length < 2}
          onChange={(e) => radar.setFrameIndex(Number(e.target.value))}
          aria-label="Radar frame timeline"
          className="flex-1 h-1 accent-[color:var(--accent-silver-400)] disabled:opacity-40"
        />
      </div>

      {/* Observed vs forecast split marker, so the scrubber's right-hand tail
          is legibly "the future" rather than just more frames. */}
      {frames.length > observedCount && observedCount > 0 && (
        <div className="flex text-[8px] font-mono text-fg-muted mt-0.5" aria-hidden="true">
          <span style={{ flex: observedCount }}>past</span>
          <span
            className="text-right text-[color:var(--sev-warn)]"
            style={{ flex: frames.length - observedCount }}
          >
            nowcast
          </span>
        </div>
      )}

      {/* Opacity */}
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[9px] font-mono text-fg-muted w-10">OPACITY</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={radar.opacity}
          onChange={(e) => radar.setOpacity(Number(e.target.value))}
          aria-label="Radar overlay opacity"
          className="flex-1 h-1 accent-[color:var(--accent-silver-400)]"
        />
        <span className="text-[9px] font-mono text-fg-secondary w-7 text-right">
          {Math.round(radar.opacity * 100)}%
        </span>
      </div>

      {/* Intensity legend */}
      <div className="flex items-center gap-1 mt-2 pt-1.5 border-t border-border-subtle">
        {RADAR_LEGEND.map((entry) => (
          <div key={entry.label} className="flex-1 min-w-0">
            <div className="h-1.5" style={{ background: entry.color }} aria-hidden="true" />
            <div className="text-[7px] font-mono text-fg-muted truncate mt-0.5">
              {entry.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
