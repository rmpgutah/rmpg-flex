// ============================================================
// RMPG Flex — MeasurementOverlay
// Floating panel shown during/after measurement mode.
// Displays distance or area value with Clear/Done controls.
// ============================================================

import React from 'react';
import { X, Check, Ruler, Maximize2 } from 'lucide-react';
import type { MeasureMode } from '../hooks/useMapMeasurement';

interface MeasurementOverlayProps {
  measuring: boolean;
  measureMode: MeasureMode | null;
  measureDisplay: string;
  onFinish: () => void;
  onClear: () => void;
}

export default function MeasurementOverlay({
  measuring,
  measureMode,
  measureDisplay,
  onFinish,
  onClear,
}: MeasurementOverlayProps) {
  if (!measureMode) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Measurement: ${measureMode === 'distance' ? 'Distance' : 'Area'} - ${measureDisplay}`}
      className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[1001] flex items-center gap-3 px-4 py-2.5 shadow-lg backdrop-blur-md transition-all duration-200 rounded-sm border border-[#1e3048]"
      style={{
        background: 'rgba(13, 21, 32, 0.95)',
        borderRadius: 2,
      }}
    >
      {/* Mode icon */}
      {measureMode === 'distance' ? (
        <Ruler className="w-4 h-4 text-gold-400" style={{ color: '#d4a017' }} />
      ) : (
        <Maximize2 className="w-4 h-4" style={{ color: '#d4a017' }} />
      )}

      {/* Value display */}
      <div className="flex flex-col items-center min-w-[100px]">
        <span className="text-[9px] text-[#5a6e80] uppercase tracking-widest font-bold leading-none">
          {measureMode === 'distance' ? 'Distance' : 'Area'}
        </span>
        <span
          className="text-base font-mono font-bold text-[#60a5fa] leading-tight"
        >
          {measureDisplay}
        </span>
      </div>

      {/* Hint text */}
      {measuring && (
        <span className="text-[8px] text-rmpg-500 font-mono max-w-[100px] leading-tight">
          Click to add points. Double-click to finish.
        </span>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 ml-1">
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
  );
}
