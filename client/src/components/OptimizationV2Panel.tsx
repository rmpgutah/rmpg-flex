import { useEffect, useRef } from 'react';
import { Route } from 'lucide-react';
import type { SubmitParams, V2Solution, V2Stop } from '../utils/mapboxOptimizationV2';
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

function formatMiles(meters: number): string {
  return (meters / 1609.34).toFixed(1) + ' mi';
}

function estimateFuelCost(totalDistanceMeters: number, avgMpg: number | null, fuelPricePerGallon = 3.5): string | null {
  if (!avgMpg || avgMpg <= 0 || totalDistanceMeters <= 0) return null;
  const miles = totalDistanceMeters / 1609.34;
  const gallons = miles / avgMpg;
  const cost = gallons * fuelPricePerGallon;
  return `$${cost.toFixed(2)}`;
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
    const totalServiceStops = routes.reduce(
      (acc, r) => acc + r.stops.filter((s) => s.type === 'service').length, 0,
    );
    const totalBreakStops = routes.reduce(
      (acc, r) => acc + r.stops.filter((s) => s.type === 'break').length, 0,
    );
    const firstEta = routes[0]?.stops.find((s: V2Stop) => s.type === 'service')?.eta;
    const lastRoute = routes[routes.length - 1];
    const filteredStops = lastRoute?.stops.filter((s: V2Stop) => s.type !== 'start' && s.type !== 'end');
    const lastStop = filteredStops?.[filteredStops.length - 1];
    const lastEta = lastStop?.eta;
    const droppedCount = dropped.services.length + dropped.shipments.length;
    const fuelCost = estimateFuelCost(hook.totalDistanceMeters, hook.avgMpg);

    return (
      <div className={`space-y-1.5 ${className}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <OptimizationV2StatusBadge status="complete" />
          <span className="text-xs text-rmpg-300">
            {totalServiceStops} stop{totalServiceStops !== 1 ? 's' : ''}
            {totalBreakStops > 0 ? ` · ${totalBreakStops} break${totalBreakStops !== 1 ? 's' : ''}` : ''}
            {hook.routeCount > 1 ? ` · ${hook.routeCount} routes` : ''}
            {firstEta && lastEta ? ` · ETA ${formatEtaTime(firstEta)}–${formatEtaTime(lastEta)}` : ''}
            {hook.totalDistanceMeters > 0 ? ` · ${formatMiles(hook.totalDistanceMeters)} total` : ''}
            {hook.totalDurationSeconds > 0 ? ` · ~${Math.round(hook.totalDurationSeconds / 60)}m` : ''}
            {fuelCost ? ` · ~${fuelCost} fuel` : ''}
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
