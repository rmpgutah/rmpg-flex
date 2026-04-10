// ============================================================
// RMPG Flex — TacticalSummaryPanel Component
// Consolidated floating summary panel showing stats for all
// active tactical layers in one compact display.
// ============================================================

import React from 'react';
import { X, Layers } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────

interface TacticalSummaryPanelProps {
  // Patrol Checkpoints
  showCheckpoints: boolean;
  checkpointCount: number;
  overdueCount: number;
  completionPct: number;
  // Field Interviews
  showFieldInterviews: boolean;
  fiCount: number;
  fiDays: number;
  // Dwell Time
  showDwellTime: boolean;
  dwellAlertCount: number;
  // Response Radius
  showResponseRadius: boolean;
  responseActive: boolean;
  // Enforcement
  showEnforcement: boolean;
  enforcementTotal: number;
  enforcementType: string;
  enforcementDays: number;
  // Coverage
  showCoverage: boolean;
  coverageCount: number;
  // Fleet
  showFleet: boolean;
  fleetCount: number;
  // Repeat Addresses
  showRepeat: boolean;
  repeatCount: number;
  repeatDays: number;
  // Daylight
  showDaylight: boolean;
  daylightPhase: string | null;

  onClose: () => void;
}

// ─── Helpers ────────────────────────────────────────────────

{/* #33: DotIndicator with LED glow matching color */}
function DotIndicator({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-[6px] h-[6px] rounded-full flex-shrink-0"
      style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}80` }}
    />
  );
}

// ─── Component ──────────────────────────────────────────────

export default function TacticalSummaryPanel({
  showCheckpoints,
  checkpointCount,
  overdueCount,
  completionPct,
  showFieldInterviews,
  fiCount,
  fiDays,
  showDwellTime,
  dwellAlertCount,
  showResponseRadius,
  responseActive,
  showEnforcement,
  enforcementTotal,
  enforcementType,
  enforcementDays,
  showCoverage,
  coverageCount,
  showFleet,
  fleetCount,
  showRepeat,
  repeatCount,
  repeatDays,
  showDaylight,
  daylightPhase,
  onClose,
}: TacticalSummaryPanelProps) {
  // Count how many layers are active
  const activeCount = [
    showCheckpoints,
    showFieldInterviews,
    showDwellTime,
    showResponseRadius,
    showEnforcement,
    showCoverage,
    showFleet,
    showRepeat,
    showDaylight,
  ].filter(Boolean).length;

  return (
    <div
      className="bg-[#141414] border border-[#181818] rounded-[2px] shadow-lg max-w-[260px] font-mono transition-all duration-200 ease-out backdrop-blur-sm"
      style={{ boxShadow: '1px 1px 0 #0c0c0c, -1px -1px 0 #1e2d3d' }}
    >
      {/* ── Header ─────────────────────────────────── */}
      <div className="flex items-center justify-between px-2 py-1.5" style={{ borderBottom: '1px solid transparent', borderImage: 'linear-gradient(to right, #181818, #2a3f5a, #181818) 1' }}>
        <div className="flex items-center gap-1.5">
          <Layers size={11} className="text-blue-400" />
          <span className="text-[10px] font-bold tracking-wider text-slate-200 uppercase">
            Tactical Layers
          </span>
          {activeCount > 0 && (
            <span className="text-[8px] bg-blue-500/20 text-blue-300 px-1 rounded-[2px] font-bold">
              {activeCount}
            </span>
          )}
        </div>
        <button type="button"
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 hover:bg-[#181818] transition-colors duration-150 p-0.5 rounded-sm"
          title="Close"
          aria-label="Close tactical summary"
        >
          <X size={12} />
        </button>
      </div>

      {/* ── Layer Rows ─────────────────────────────── */}
      <div className="px-2 py-1.5 space-y-1">
        {activeCount === 0 ? (
          <p className="text-[9px] text-slate-500 text-center py-2">
            No tactical layers active
          </p>
        ) : (
          <>
            {/* Patrol Checkpoints */}
            {showCheckpoints && (
              <div className="flex items-center gap-1.5 hover:bg-[#181818]/50 rounded-sm px-1 -mx-1 transition-colors duration-150">
                <DotIndicator color="#4ade80" />
                <span className="text-[9px] text-slate-400 flex-shrink-0">
                  Checkpoints
                </span>
                <span className="text-[9px] text-slate-500 ml-auto flex-shrink-0 tabular-nums">
                  {overdueCount > 0 && (
                    <span className="text-amber-400">{overdueCount} overdue</span>
                  )}
                  {overdueCount > 0 && ' / '}
                  {checkpointCount}
                </span>
                <div className="w-[32px] h-[3px] bg-[#0c0c0c] rounded-full flex-shrink-0 overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${Math.min(completionPct, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Field Interviews */}
            {showFieldInterviews && (
              <div className="flex items-center gap-1.5 hover:bg-[#181818]/50 rounded-sm px-1 -mx-1 transition-colors duration-150">
                <DotIndicator color="#aaaaaa" />
                <span className="text-[9px] text-slate-400 flex-shrink-0">
                  Field Interviews
                </span>
                <span className="text-[9px] text-slate-500 ml-auto flex-shrink-0">
                  {fiCount}
                  <span className="text-slate-600 ml-0.5">{fiDays}d</span>
                </span>
              </div>
            )}

            {/* Dwell Time */}
            {showDwellTime && (
              <div className="flex items-center gap-1.5 hover:bg-[#181818]/50 rounded-sm px-1 -mx-1 transition-colors duration-150">
                <DotIndicator color="#fbbf24" />
                <span className="text-[9px] text-slate-400 flex-shrink-0">
                  Dwell Time
                </span>
                <span className="text-[9px] text-slate-500 ml-auto flex-shrink-0">
                  {dwellAlertCount > 0 ? (
                    <span className="text-amber-400">{dwellAlertCount} alerts</span>
                  ) : (
                    '0 alerts'
                  )}
                </span>
              </div>
            )}

            {/* Response Radius */}
            {showResponseRadius && (
              <div className="flex items-center gap-1.5 hover:bg-[#181818]/50 rounded-sm px-1 -mx-1 transition-colors duration-150">
                <DotIndicator color="#a0a0a0" />
                <span className="text-[9px] text-slate-400 flex-shrink-0">
                  Response
                </span>
                <span
                  className={`text-[9px] ml-auto flex-shrink-0 ${
                    responseActive ? 'text-green-400' : 'text-slate-600'
                  }`}
                >
                  {responseActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            )}

            {/* Enforcement */}
            {showEnforcement && (
              <div className="flex items-center gap-1.5 hover:bg-[#181818]/50 rounded-sm px-1 -mx-1 transition-colors duration-150">
                <DotIndicator color="#fb7185" />
                <span className="text-[9px] text-slate-400 flex-shrink-0">
                  Enforcement
                </span>
                <span className="text-[9px] text-slate-500 ml-auto flex-shrink-0">
                  {enforcementTotal}
                  <span className="text-slate-600 ml-0.5">
                    {enforcementType}/{enforcementDays}d
                  </span>
                </span>
              </div>
            )}

            {/* Coverage */}
            {showCoverage && (
              <div className="flex items-center gap-1.5 hover:bg-[#181818]/50 rounded-sm px-1 -mx-1 transition-colors duration-150">
                <DotIndicator color="#2dd4bf" />
                <span className="text-[9px] text-slate-400 flex-shrink-0">
                  Coverage
                </span>
                <span className="text-[9px] text-slate-500 ml-auto flex-shrink-0">
                  {coverageCount}
                </span>
              </div>
            )}

            {/* Fleet */}
            {showFleet && (
              <div className="flex items-center gap-1.5 hover:bg-[#181818]/50 rounded-sm px-1 -mx-1 transition-colors duration-150">
                <DotIndicator color="#a8a8a8" />
                <span className="text-[9px] text-slate-400 flex-shrink-0">
                  Fleet
                </span>
                <span className="text-[9px] text-slate-500 ml-auto flex-shrink-0">
                  {fleetCount} vehicles
                </span>
              </div>
            )}

            {/* Repeat Addresses */}
            {showRepeat && (
              <div className="flex items-center gap-1.5 hover:bg-[#181818]/50 rounded-sm px-1 -mx-1 transition-colors duration-150">
                <DotIndicator color="#fb923c" />
                <span className="text-[9px] text-slate-400 flex-shrink-0">
                  Repeat Addresses
                </span>
                <span className="text-[9px] text-slate-500 ml-auto flex-shrink-0">
                  {repeatCount}
                  <span className="text-slate-600 ml-0.5">{repeatDays}d</span>
                </span>
              </div>
            )}

            {/* Daylight */}
            {showDaylight && (
              <div className="flex items-center gap-1.5 hover:bg-[#181818]/50 rounded-sm px-1 -mx-1 transition-colors duration-150">
                <DotIndicator color="#facc15" />
                <span className="text-[9px] text-slate-400 flex-shrink-0">
                  Daylight
                </span>
                <span className="text-[9px] text-slate-500 ml-auto flex-shrink-0">
                  {daylightPhase ?? 'Unknown'}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
