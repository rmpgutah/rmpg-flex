import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { UnitStatus } from '../../../types';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS } from '../utils/mapConstants';

type BreadcrumbColorMode = 'unit' | 'speed' | 'status';

interface MapLegendProps {
  layers: { units: boolean; incidents: boolean; properties: boolean };
  showBreadcrumbs: boolean;
  breadcrumbColorMode: BreadcrumbColorMode;
}

const STATUS_ORDER: UnitStatus[] = ['available', 'dispatched', 'enroute', 'onscene', 'busy', 'off_duty'];
const PRIORITY_ORDER = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;
const PRIORITY_LABELS: Record<string, string> = { P1: 'CRITICAL', P2: 'HIGH', P3: 'MEDIUM', P4: 'LOW', P5: 'INFO' };

const SPEED_GRADIENT = [
  { color: '#22c55e', label: '0 mph (Idle)' },
  { color: '#eab308', label: '25 mph' },
  { color: '#f97316', label: '50 mph' },
  { color: '#ef4444', label: '75+ mph' },
];

const STATUS_BREADCRUMB_COLORS = [
  { color: UNIT_STATUS_COLORS.available, label: 'Available' },
  { color: UNIT_STATUS_COLORS.dispatched, label: 'Dispatched' },
  { color: UNIT_STATUS_COLORS.enroute, label: 'Enroute' },
  { color: UNIT_STATUS_COLORS.onscene, label: 'On Scene' },
  { color: UNIT_STATUS_COLORS.busy, label: 'Busy' },
];

export default function MapLegend({ layers, showBreadcrumbs, breadcrumbColorMode }: MapLegendProps) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center justify-center backdrop-blur-md shadow-xl transition-colors hover:brightness-125"
        style={{
          width: 32,
          height: 32,
          borderRadius: 2,
          background: 'rgba(13, 21, 32, 0.9)',
          border: '1px solid #2b2b2b',
        }}
        title="Show legend"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="3" width="4" height="2" rx="0.5" fill="#22c55e" />
          <rect x="8" y="3" width="6" height="1" rx="0.5" fill="#8899aa" />
          <rect x="2" y="7" width="4" height="2" rx="0.5" fill="#f59e0b" />
          <rect x="8" y="7" width="6" height="1" rx="0.5" fill="#8899aa" />
          <rect x="2" y="11" width="4" height="2" rx="0.5" fill="#888888" />
          <rect x="8" y="11" width="6" height="1" rx="0.5" fill="#8899aa" />
        </svg>
      </button>
    );
  }

  return (
    <div
      className="backdrop-blur-md shadow-xl transition-all duration-200 scrollbar-thin"
      style={{
        borderRadius: 2,
        background: 'rgba(13, 21, 32, 0.9)',
        border: '1px solid #2b2b2b',
        maxHeight: 360,
        overflowY: 'auto',
        width: 168,
      }}
      aria-label="Map legend"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1.5" style={{ borderBottom: '1px solid #2b2b2b' }}>
        <span className="text-[9px] font-mono font-black tracking-wider text-rmpg-300 uppercase">Legend</span>
          {/* #12: Collapse chevron with rotation animation */}
        <button type="button" onClick={() => setExpanded(false)} aria-expanded={expanded} className="text-rmpg-400 hover:text-white transition-colors duration-150 p-0.5">
          <ChevronDown className="w-3 h-3 transition-transform duration-200" style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
        </button>
      </div>

      <div className="px-2.5 py-2 space-y-2.5">
        {/* Unit Status */}
        <div>
          <div className="text-[8px] font-mono font-bold tracking-wider text-[#9ca3af] uppercase mb-1">Unit Status</div>
          <div className="space-y-0.5">
            {STATUS_ORDER.map((status) => (
              <div key={status} className="flex items-center gap-1.5 hover:bg-[#181818]/50 transition-colors duration-100 px-0.5 -mx-0.5 rounded-sm">
                {/* #13: Legend swatches with consistent LED glow */}
                <div
                  className="rounded-sm shrink-0"
                  style={{ backgroundColor: UNIT_STATUS_COLORS[status], boxShadow: `0 0 6px ${UNIT_STATUS_COLORS[status]}60`, width: 10, height: 10 }}
                />
                <span className="text-[9px] font-mono text-[#9ca3af]">{UNIT_STATUS_LABELS[status]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Call Priority */}
        <div>
          <div className="h-px mb-2" style={{ background: 'linear-gradient(90deg, transparent, #2b2b2b, transparent)' }} />
          <div className="text-[8px] font-mono font-bold tracking-wider text-[#9ca3af] uppercase mb-1">Call Priority</div>
          <div className="space-y-0.5">
            {PRIORITY_ORDER.map((p) => (
              <div key={p} className="flex items-center gap-1.5 hover:bg-[#181818]/50 transition-colors duration-100 px-0.5 -mx-0.5 rounded-sm">
                {/* #14: Priority legend swatches match swatch sizing */}
              <div className="shrink-0 rounded-sm" style={{ backgroundColor: PRIORITY_COLORS[p], width: 10, height: 10, borderRadius: 2, boxShadow: `0 0 4px ${PRIORITY_COLORS[p]}50` }} />
                <span className="text-[9px] font-mono text-[#9ca3af]">{p} - {PRIORITY_LABELS[p]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Layer Symbols */}
        <div>
          <div className="h-px mb-2" style={{ background: 'linear-gradient(90deg, transparent, #2b2b2b, transparent)' }} />
          <div className="text-[8px] font-mono font-bold tracking-wider text-[#9ca3af] uppercase mb-1">Symbols</div>
          <div className="space-y-0.5">
            {layers.properties && (
              <div className="flex items-center gap-1.5 hover:bg-[#181818]/50 transition-colors duration-100 px-0.5 -mx-0.5 rounded-sm">
                {/* #15: Property swatch with gold glow */}
              <div className="shrink-0 rounded-sm" style={{ backgroundColor: '#d4a017', opacity: 0.8, width: 10, height: 10, boxShadow: '0 0 4px #d4a01750' }} />
                <span className="text-[9px] font-mono text-[#9ca3af]">Property</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 hover:bg-[#181818]/50 transition-colors duration-100 px-0.5 -mx-0.5 rounded-sm">
              <div className="shrink-0" style={{ width: 12, height: 2, background: 'linear-gradient(90deg, #888888, #22c55e)', borderRadius: 1 }} />
              <span className="text-[9px] font-mono text-[#9ca3af]">Tracking line</span>
            </div>
            <div className="flex items-center gap-1.5 hover:bg-[#181818]/50 transition-colors duration-100 px-0.5 -mx-0.5 rounded-sm">
              <div className="flex gap-px shrink-0">
                <div className="w-1 h-1 rounded-full bg-gray-400" />
                <div className="w-1 h-1 rounded-full bg-gray-400 opacity-70" />
                <div className="w-1 h-1 rounded-full bg-gray-400 opacity-40" />
              </div>
              <span className="text-[9px] font-mono text-[#9ca3af]">Breadcrumb trail</span>
            </div>
          </div>
        </div>

        {/* Breadcrumb Color Mode Legend */}
        {showBreadcrumbs && (
          <div>
            <div className="h-px mb-2" style={{ background: 'linear-gradient(90deg, transparent, #2b2b2b, transparent)' }} />
            <div className="text-[8px] font-mono font-bold tracking-wider text-[#9ca3af] uppercase mb-1">
              Breadcrumbs: {breadcrumbColorMode === 'unit' ? 'By Unit' : breadcrumbColorMode === 'speed' ? 'By Speed' : 'By Status'}
            </div>
            {breadcrumbColorMode === 'speed' && (
              <div className="space-y-0.5">
                {SPEED_GRADIENT.map((s) => (
                  <div key={s.label} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-[9px] font-mono text-rmpg-200">{s.label}</span>
                  </div>
                ))}
              </div>
            )}
            {breadcrumbColorMode === 'status' && (
              <div className="space-y-0.5">
                {STATUS_BREADCRUMB_COLORS.map((s) => (
                  <div key={s.label} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-[9px] font-mono text-rmpg-200">{s.label}</span>
                  </div>
                ))}
              </div>
            )}
            {breadcrumbColorMode === 'unit' && (
              <div className="text-[8px] font-mono text-rmpg-500 italic">Each unit has a unique color</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
