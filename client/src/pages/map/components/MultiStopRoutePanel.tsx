// ============================================================
// RMPG Flex — Multi-Stop Patrol Route Panel
// ============================================================
// Floating panel for building an optimized one-unit-many-calls patrol
// route (PSO client requests, welfare checks, paper service, etc.).
// Queue calls from their popups, pick the responding unit, and let the
// Mapbox Optimization API solve the fastest visiting order.
// ============================================================

import { Route, X, Trash2, Zap, GripVertical } from 'lucide-react';
import type { MultiStopRoute } from '../../../hooks/useMapRouting';
import type { MapUnit } from '../utils/mapConstants';

export interface QueuedStop {
  callNumber: string;
  lat: number;
  lng: number;
  label?: string;
}

interface Props {
  queue: QueuedStop[];
  units: MapUnit[];
  selectedUnit: string | null;
  result: MultiStopRoute | null;
  loading: boolean;
  isMobile: boolean;
  onSelectUnit: (callSign: string) => void;
  onRemoveStop: (callNumber: string) => void;
  onClear: () => void;
  onOptimize: () => void;
}

export default function MultiStopRoutePanel({
  queue,
  units,
  selectedUnit,
  result,
  loading,
  isMobile,
  onSelectUnit,
  onRemoveStop,
  onClear,
  onOptimize,
}: Props) {
  if (queue.length === 0) return null;

  // Units that can actually be an origin (valid GPS).
  const routableUnits = units.filter((u) => u.latitude != null && u.longitude != null);
  const canOptimize = queue.length >= 1 && !!selectedUnit && !loading;

  return (
    <div
      className={`absolute z-30 bg-surface-raised/95 border border-border-default backdrop-blur-md font-mono overflow-hidden ${
        isMobile ? '' : ''
      }`}
      style={{
        ...(isMobile
          ? { top: 56, left: 8, right: 8 }
          : { top: 64, right: 16, width: 300 }),
        borderRadius: 2,
        boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border-subtle">
        <Route className="w-3.5 h-3.5 text-brand-gold-500" />
        <span className="text-[10px] font-black tracking-wider text-brand-gold-500 flex-1 uppercase">
          Patrol Route
        </span>
        <span className="text-[8px] font-black text-surface-base bg-brand-gold-500 px-1.5 py-px" style={{ borderRadius: 2 }}>
          {queue.length} STOP{queue.length === 1 ? '' : 'S'}
        </span>
        <button onClick={onClear} aria-label="Clear patrol route" className="text-rmpg-500 hover:text-rmpg-300 flex">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Unit selector */}
      <div className="px-2.5 py-2 border-b border-border-subtle">
        <div className="text-[7px] text-rmpg-500 tracking-wider mb-1 uppercase">Responding Unit</div>
        {routableUnits.length === 0 ? (
          <div className="text-[9px] text-red-400">No units with GPS available</div>
        ) : (
          <select
            id="ff-multistoproutepanel-0"
            value={selectedUnit ?? ''}
            onChange={(e) => onSelectUnit(e.target.value)}
            className="w-full bg-surface-overlay text-rmpg-300 border border-border-subtle px-1.5 py-1 text-[10px] outline-none"
            style={{ borderRadius: 2 }}
          >
            <option value="" disabled>
              Select unit…
            </option>
            {routableUnits.map((u) => (
              <option key={u.id} value={u.call_sign}>
                {u.call_sign} — {u.officer_name || 'Unassigned'}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Stops list — optimized order if we have a result, else queue order */}
      <div className="scrollbar-dark overflow-y-auto" style={{ maxHeight: isMobile ? 180 : 260 }}>
        {result
          ? result.stops.map((s) => (
              <div key={s.callNumber} className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border-subtle">
                <span
                  className="w-[18px] h-[18px] shrink-0 flex items-center justify-center border text-brand-gold-500 text-[10px] font-black bg-surface-base"
                  style={{ borderRadius: 2 }}
                >
                  {s.order}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold text-rmpg-200 truncate">{s.callNumber}</div>
                  {s.label && <div className="text-[8px] text-rmpg-500 truncate">{s.label}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[9px] text-brand-gold-500 font-bold">{s.legEta}</div>
                  <div className="text-[7px] text-rmpg-500">{s.legDistance}</div>
                </div>
              </div>
            ))
          : queue.map((s) => (
              <div key={s.callNumber} className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border-subtle">
                <GripVertical className="w-3 h-3 text-rmpg-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold text-rmpg-200 truncate">{s.callNumber}</div>
                  {s.label && <div className="text-[8px] text-rmpg-500 truncate">{s.label}</div>}
                </div>
                <button
                  onClick={() => onRemoveStop(s.callNumber)}
                  aria-label={`Remove ${s.callNumber}`}
                  className="text-rmpg-500 hover:text-red-400 shrink-0 flex p-0.5"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
      </div>

      {/* Result totals */}
      {result && (
        <div className="flex items-baseline gap-2.5 px-2.5 py-2 border-t border-border-subtle">
          <span className="text-[7px] text-rmpg-500 tracking-wider uppercase">Total</span>
          <span className="text-[15px] font-black text-brand-gold-500">{result.totalEta}</span>
          <span className="text-[10px] text-rmpg-400">{result.totalDistance}</span>
        </div>
      )}

      {/* Action */}
      <div className="px-2.5 py-2">
        <button
          onClick={onOptimize}
          disabled={!canOptimize}
          className={`w-full flex items-center justify-center gap-1.5 py-1.5 text-[9px] font-black tracking-wider uppercase transition-colors ${
            canOptimize
              ? 'bg-brand-gold-500 text-surface-base border border-brand-gold-500'
              : 'bg-surface-raised text-rmpg-600 border border-border-subtle cursor-not-allowed'
          }`}
          style={{ borderRadius: 2 }}
        >
          <Zap className="w-3 h-3" />
          {loading ? 'Optimizing…' : result ? 'Re-optimize' : 'Optimize & Route'}
        </button>
      </div>
    </div>
  );
}
