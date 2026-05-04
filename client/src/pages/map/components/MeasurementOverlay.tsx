// ============================================================
// RMPG Flex — MeasurementOverlay
// Floating panel shown during/after measurement mode.
// Displays distance or area value with Clear/Done controls.
// ============================================================

import { X, Check, Ruler, Maximize2, Undo2 } from 'lucide-react';
import type { MeasureMode } from '../hooks/useMapMeasurement';

interface MeasurementOverlayProps {
  measuring: boolean;
  measureMode: MeasureMode | null;
  measureDisplay: string;
  measureDisplayMetric?: string;
  perimeterDisplay?: string;
  areaDisplay?: string;
  pointCount?: number;
  onFinish: () => void;
  onClear: () => void;
  onUndo?: () => void;
}

export default function MeasurementOverlay({
  measuring,
  measureMode,
  measureDisplay,
  measureDisplayMetric,
  perimeterDisplay,
  areaDisplay,
  pointCount = 0,
  onFinish,
  onClear,
  onUndo,
}: MeasurementOverlayProps) {
  if (!measureMode) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Measurement: ${measureMode === 'distance' ? 'Distance' : 'Area'} - ${measureDisplay}`}
      className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[1001] flex flex-col items-center gap-1 px-4 py-2.5 shadow-lg backdrop-blur-md transition-all duration-200 rounded-sm border border-[#2b2b2b]"
      style={{
        background: 'rgba(13, 21, 32, 0.95)',
        borderRadius: 2,
      }}
    >
      <div className="flex items-center gap-3">
        {/* Mode icon */}
        {measureMode === 'distance' ? (
          <Ruler className="w-4 h-4 text-gold-400" style={{ color: '#d4a017' }} />
        ) : (
          <Maximize2 className="w-4 h-4" style={{ color: '#d4a017' }} />
        )}

        {/* Value display — dual units (imperial + metric) */}
        <div className="flex flex-col items-center min-w-[100px]">
          <span className="text-[9px] text-[#5a6e80] uppercase tracking-widest font-bold leading-none">
            {measureMode === 'distance' ? 'Distance' : 'Area'}
          </span>
          <span className="text-base font-mono font-bold text-[#a0a0a0] leading-tight tabular-nums">
            {measureDisplay}
          </span>
          {measureDisplayMetric && (
            <span className="text-[9px] font-mono text-[#5a6e80] leading-tight tabular-nums">
              {measureDisplayMetric}
            </span>
          )}
        </div>

        {/* Hint text */}
        {measuring && (
          <span className="text-[8px] text-rmpg-500 font-mono max-w-[100px] leading-tight animate-pulse">
            Click to add points. Double-click to finish.
          </span>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 ml-1">
          {/* Undo last point */}
          {measuring && pointCount > 0 && onUndo && (
            <button type="button"
              onClick={onUndo}
              aria-label="Undo last point"
              className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#d4a017] hover:bg-yellow-900/20 transition-colors rounded-sm"
              style={{ borderRadius: 2, border: '1px solid rgba(212, 160, 23, 0.3)' }}
              title="Undo last point"
            >
              <Undo2 className="w-3 h-3" />
              Undo
            </button>
          )}
          {measuring && (
            <button type="button"
              onClick={onFinish}
              aria-label="Finish measurement"
              className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-green-400 hover:bg-green-900/30 transition-colors rounded-sm"
              style={{ borderRadius: 2, border: '1px solid rgba(34, 197, 94, 0.3)' }}
              title="Finish measuring (keep shape)"
            >
              <Check className="w-3 h-3" />
              Done
            </button>
          )}
          <button type="button"
            onClick={onClear}
            aria-label="Clear measurement"
            className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-red-400 hover:bg-red-900/30 transition-colors duration-150 rounded-sm"
            style={{ borderRadius: 2, border: '1px solid rgba(239, 68, 68, 0.3)' }}
            title="Clear measurement">
            <X className="w-3 h-3" />
            Clear
          </button>
        </div>
      </div>

      {/* Perimeter + Area info (shown when path has 3+ points in distance mode) */}
      {(perimeterDisplay || areaDisplay) && (
        <div className="flex items-center gap-3 text-[8px] font-mono text-[#5a6e80]">
          {perimeterDisplay && <span>{perimeterDisplay}</span>}
          {areaDisplay && <span className="text-[#d4a017]">{areaDisplay}</span>}
        </div>
      )}
    </div>
  );
}
