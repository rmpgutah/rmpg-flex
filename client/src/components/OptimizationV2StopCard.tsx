import { Clock, XCircle, Coffee } from 'lucide-react';
import { parseTimestamp } from '../utils/dateUtils';

interface Props {
  stopIndex: number;
  locationName: string;
  eta: string;
  wait?: number;
  duration?: number;
  priority?: string;
  isNext?: boolean;
  isDropped?: boolean;
  isBreak?: boolean;
  odometerMeters?: number;
  travelTimeSeconds?: number;
  timeWindowEarliest?: string;
  timeWindowLatest?: string;
  className?: string;
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-red-400',
  rush: 'bg-amber-400',
  normal: 'bg-blue-400',
  routine: 'bg-rmpg-500',
};

function formatEta(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      hour: 'numeric',
      minute: '2-digit',
    }).format(parseTimestamp(iso));
  } catch {
    return iso;
  }
}

export default function OptimizationV2StopCard({
  stopIndex,
  locationName,
  eta,
  wait,
  duration,
  priority,
  isNext = false,
  isDropped = false,
  isBreak = false,
  odometerMeters,
  travelTimeSeconds,
  timeWindowEarliest,
  timeWindowLatest,
  className = '',
}: Props) {
  const stepCircleClass = isDropped
    ? 'bg-red-900/50 text-red-400'
    : isBreak
      ? 'bg-amber-800/60 text-amber-200'
      : isNext
        ? 'bg-blue-600 text-white'
        : 'bg-surface-raised text-rmpg-100';

  const cardBorderClass = isDropped
    ? 'border-red-700/40 bg-red-900/10 opacity-60'
    : isBreak
      ? 'border-amber-700/30 bg-amber-900/10'
      : isNext
        ? 'border-blue-500/60 bg-blue-900/20'
        : 'border-rmpg-600/40 bg-surface-raised';

  const priorityDot = priority ? (PRIORITY_DOT[priority] ?? 'bg-rmpg-500') : null;
  const waitMinutes = wait != null && wait > 60 ? Math.round(wait / 60) : null;
  const durationMinutes = duration != null ? Math.round(duration / 60) : null;
  const odometerMiles = odometerMeters != null && odometerMeters > 0
    ? (odometerMeters / 1609.34).toFixed(1)
    : null;
  const travelMinutes = travelTimeSeconds != null && travelTimeSeconds > 0
    ? Math.round(travelTimeSeconds / 60)
    : null;

  // Time window satisfaction indicator
  let timeWindowStatus: 'on-time' | 'early' | 'late' | null = null;
  if (timeWindowEarliest && timeWindowLatest && eta && !isBreak && !isDropped) {
    const etaMs = Date.parse(eta);
    const earlyMs = Date.parse(timeWindowEarliest);
    const lateMs = Date.parse(timeWindowLatest);
    if (Number.isFinite(etaMs) && Number.isFinite(earlyMs) && Number.isFinite(lateMs)) {
      if (etaMs >= earlyMs && etaMs <= lateMs) timeWindowStatus = 'on-time';
      else if (etaMs < earlyMs) timeWindowStatus = 'early';
      else timeWindowStatus = 'late';
    }
  }

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded border ${cardBorderClass} ${className}`}
    >
      {/* Step circle */}
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${stepCircleClass}`}
      >
        {isBreak ? <Coffee className="w-4 h-4" /> : stopIndex}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {priorityDot && (
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityDot}`} />
          )}
          <span className="font-semibold text-sm text-rmpg-100 truncate">
            {isBreak ? 'Break' : locationName}
          </span>
        </div>
        <div className="flex items-center gap-1 mt-0.5 text-xs text-brand-400">
          <Clock className="w-3 h-3 flex-shrink-0" />
          <span>{formatEta(eta)}</span>
        </div>
        {isDropped && (
          <div className="flex items-center gap-1 mt-1 text-xs text-red-400 font-medium">
            <XCircle className="w-3 h-3 flex-shrink-0" />
            Dropped — reassign manually
          </div>
        )}
      </div>

      {/* Right annotations */}
      <div className="flex flex-col items-end gap-1 flex-shrink-0 text-xs">
        {odometerMiles != null && (
          <span className="text-fg-muted">{odometerMiles} mi</span>
        )}
        {travelMinutes != null && (
          <span className="text-fg-secondary">{travelMinutes}m drive</span>
        )}
        {timeWindowStatus === 'on-time' && (
          <span className="text-green-400">On-time</span>
        )}
        {timeWindowStatus === 'early' && (
          <span className="text-amber-300">Early</span>
        )}
        {timeWindowStatus === 'late' && (
          <span className="text-red-400">Late</span>
        )}
        {waitMinutes != null && (
          <span className="text-amber-300">Arrives {waitMinutes} min early</span>
        )}
        {durationMinutes != null && (
          <span className="text-rmpg-400">{durationMinutes}m on-site</span>
        )}
      </div>
    </div>
  );
}
