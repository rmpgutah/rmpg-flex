import { Clock, XCircle } from 'lucide-react';
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
  className = '',
}: Props) {
  const stepCircleClass = isDropped
    ? 'bg-red-900/50 text-red-400'
    : isNext
      ? 'bg-blue-600 text-white'
      : 'bg-surface-raised text-rmpg-100';

  const cardBorderClass = isDropped
    ? 'border-red-700/40 bg-red-900/10 opacity-60'
    : isNext
      ? 'border-blue-500/60 bg-blue-900/20'
      : 'border-rmpg-600/40 bg-surface-raised';

  const priorityDot = priority ? (PRIORITY_DOT[priority] ?? 'bg-rmpg-500') : null;
  const waitMinutes = wait != null && wait > 60 ? Math.round(wait / 60) : null;
  const durationMinutes = duration != null ? Math.round(duration / 60) : null;

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded border ${cardBorderClass} ${className}`}
    >
      {/* Step circle */}
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${stepCircleClass}`}
      >
        {stopIndex}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {priorityDot && (
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityDot}`} />
          )}
          <span className="font-semibold text-sm text-rmpg-100 truncate">{locationName}</span>
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
