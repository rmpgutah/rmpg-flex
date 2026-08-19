import { useEffect, useRef } from 'react';
import { Route } from 'lucide-react';
import type { SubmitParams, V2Solution } from '../utils/mapboxOptimizationV2';
import { parseTimestamp } from '../utils/dateUtils';
import { useOptimizationV2 } from '../hooks/useOptimizationV2';
import OptimizationV2StatusBadge from './OptimizationV2StatusBadge';

interface Props {
  submitParams: SubmitParams | null;
  onSolution: (solution: V2Solution) => void;
  onFallback?: () => void;
  label?: string;
  droppedLabel?: string;
  className?: string;
}

function formatEtaTime(iso: string): string {
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

function formatKm(meters: number): string {
  return (meters / 1000).toFixed(1) + 'km';
}

export default function OptimizationV2Panel({
  submitParams,
  onSolution,
  onFallback,
  label = 'Optimize with Live Traffic',
  droppedLabel = 'stops could not be assigned',
  className = '',
}: Props) {
  const hook = useOptimizationV2();
  const firedRef = useRef<'complete' | 'error' | null>(null);

  useEffect(() => {
    if (hook.status === 'complete' && hook.solution && firedRef.current !== 'complete') {
      firedRef.current = 'complete';
      onSolution(hook.solution);
    }
    if (hook.status === 'error' && firedRef.current !== 'error') {
      firedRef.current = 'error';
      onFallback?.();
    }
  }, [hook.status, hook.solution, onSolution, onFallback]);

  // Reset the fired guard whenever a new job starts
  useEffect(() => {
    if (hook.status === 'idle' || hook.status === 'pending') {
      firedRef.current = null;
    }
  }, [hook.status]);

  function handleSubmit() {
    if (!submitParams) return;
    hook.submit(submitParams);
  }

  // ── Idle ──────────────────────────────────────────────────────────────────
  if (hook.status === 'idle') {
    return (
      <div className={className}>
        <button
          onClick={handleSubmit}
          disabled={submitParams === null}
          title={submitParams === null ? 'Waiting for data…' : undefined}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-40 transition-colors"
        >
          <Route className="w-4 h-4" />
          {label}
        </button>
      </div>
    );
  }

  // ── Pending / Processing ─────────────────────────────────────────────────
  if (hook.status === 'pending' || hook.status === 'processing') {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <OptimizationV2StatusBadge status={hook.status} elapsedMs={hook.elapsedMs} />
        <button
          onClick={hook.reset}
          className="text-xs text-rmpg-400 hover:text-rmpg-200 underline transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── Complete ─────────────────────────────────────────────────────────────
  if (hook.status === 'complete' && hook.solution) {
    const { routes, dropped } = hook.solution;
    const stops = routes[0]?.stops ?? [];
    const serviceStops = stops.filter((s) => s.type !== 'start' && s.type !== 'end');
    const firstEta = serviceStops[0]?.eta;
    const lastEta = serviceStops[serviceStops.length - 1]?.eta;
    const lastOdometer = stops[stops.length - 1]?.odometer ?? 0;
    const droppedCount = dropped.services.length + dropped.shipments.length;

    return (
      <div className={`space-y-1.5 ${className}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <OptimizationV2StatusBadge status="complete" />
          <span className="text-xs text-rmpg-300">
            {serviceStops.length} stop{serviceStops.length !== 1 ? 's' : ''}
            {firstEta && lastEta ? ` · ETA ${formatEtaTime(firstEta)}–${formatEtaTime(lastEta)}` : ''}
            {lastOdometer > 0 ? ` · ${formatKm(lastOdometer)} total` : ''}
          </span>
        </div>
        {droppedCount > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-amber-700/40 bg-amber-900/20 text-xs text-amber-300">
            <span className="font-medium">{droppedCount}</span>
            {droppedLabel}
          </div>
        )}
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <OptimizationV2StatusBadge status="error" />
      <span className="text-xs text-rmpg-400">Optimization failed — using local route</span>
    </div>
  );
}
