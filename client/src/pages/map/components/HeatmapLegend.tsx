// ============================================================
// RMPG Flex — Heatmap Legend
// Small bottom-right gradient bar that makes the heatmap color
// scale readable. Without it, officers couldn't tell whether a
// deep-red spot meant "4 calls" or "400" — same color, vastly
// different operational meaning.
//
// Rendered only while the heatmap is visible. Colors match the
// gradients in useMapHeatmap / useMapHeatmapAdvanced exactly.
// ============================================================

import React from 'react';

export interface HeatmapLegendProps {
  /** Label above the gradient bar */
  title?: string;
  /** Lowest intensity label (left end) */
  minLabel?: string;
  /** Highest intensity label (right end) */
  maxLabel?: string;
  /** Which color ramp to display — keeps legend in sync with map */
  mode?: 'calls' | 'risk';
  /** Position on the map overlay. bottom-right is the default. */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** Optional hint text shown under the bar (e.g. "last 30 days") */
  hint?: string;
}

const CALLS_GRADIENT =
  'linear-gradient(to right, rgba(0,128,255,0.4) 0%, rgba(0,200,100,0.6) 25%, rgba(200,200,0,0.75) 50%, rgba(255,140,0,0.9) 75%, rgba(255,50,0,1) 100%)';

const RISK_GRADIENT =
  'linear-gradient(to right, rgba(255,165,0,0.4) 0%, rgba(255,100,0,0.6) 30%, rgba(255,50,0,0.8) 60%, rgba(200,0,0,1) 100%)';

function positionStyle(pos: HeatmapLegendProps['position']): React.CSSProperties {
  switch (pos) {
    case 'bottom-left': return { bottom: 16, left: 16 };
    case 'top-right': return { top: 16, right: 16 };
    case 'top-left': return { top: 16, left: 16 };
    case 'bottom-right':
    default: return { bottom: 16, right: 16 };
  }
}

export default function HeatmapLegend({
  title = 'HEATMAP INTENSITY',
  minLabel = 'Low',
  maxLabel = 'High',
  mode = 'calls',
  position = 'bottom-right',
  hint,
}: HeatmapLegendProps) {
  return (
    <div
      className="absolute z-[1000] backdrop-blur-sm"
      style={{
        ...positionStyle(position),
        background: 'rgba(6,12,20,0.92)',
        border: '1px solid #2b2b2b',
        borderRadius: 2,
        padding: '6px 10px',
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        minWidth: 180,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          fontSize: 8,
          color: '#888888',
          fontWeight: 900,
          letterSpacing: '0.15em',
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <div
        style={{
          height: 10,
          width: '100%',
          background: mode === 'risk' ? RISK_GRADIENT : CALLS_GRADIENT,
          borderRadius: 1,
          border: '1px solid #1a1a1a',
        }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 8,
          color: '#9ca3af',
          marginTop: 2,
          letterSpacing: '0.05em',
        }}
      >
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
      {hint && (
        <div
          style={{
            fontSize: 8,
            color: '#5a6e80',
            marginTop: 3,
            fontStyle: 'italic',
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
