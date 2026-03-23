import React from 'react';
import { X, Radar, Target, Pentagon, Building, MapPin, Loader2 } from 'lucide-react';

interface PerimeterToolsPanelProps {
  perimeterData: {
    quadrants: { NE: number; NW: number; SE: number; SW: number };
    gaps: string[];
    staging_suggestion: { lat: number; lng: number; reason: string } | null;
  } | null;
  isDrawingContainment: boolean;
  containmentVertices: number;
  hvtVisible: boolean;
  loading: boolean;
  onAnalyzeCoverage: () => void;
  onStartContainment: () => void;
  onClearContainment: () => void;
  onToggleHVTs: () => void;
  onClose: () => void;
}

function getCoverageColor(pct: number): string {
  if (pct >= 80) return '#22c55e';
  if (pct >= 60) return '#f59e0b';
  return '#ef4444';
}

function getCoverageLabel(pct: number): string {
  if (pct >= 80) return 'text-green-400';
  if (pct >= 60) return 'text-amber-400';
  return 'text-red-400';
}

export default function PerimeterToolsPanel({
  perimeterData,
  isDrawingContainment,
  containmentVertices,
  hvtVisible,
  loading,
  onAnalyzeCoverage,
  onStartContainment,
  onClearContainment,
  onToggleHVTs,
  onClose,
}: PerimeterToolsPanelProps) {
  const quadrantEntries: [string, number][] = perimeterData
    ? [
        ['NE', perimeterData.quadrants.NE],
        ['NW', perimeterData.quadrants.NW],
        ['SE', perimeterData.quadrants.SE],
        ['SW', perimeterData.quadrants.SW],
      ]
    : [];

  return (
    <div className="panel-beveled rounded-sm bg-surface-base border border-rmpg-700 shadow-lg w-[280px] max-w-[280px] select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-rmpg-700">
        <div className="flex items-center gap-1.5">
          <Radar className="w-3.5 h-3.5 text-rmpg-400" />
          <span className="text-[10px] uppercase tracking-widest font-semibold text-rmpg-300">
            Perimeter Tools
          </span>
        </div>
        <button type="button"
          onClick={onClose}
          className="p-0.5 rounded-sm hover:bg-rmpg-700/50 text-rmpg-400 hover:text-rmpg-200 transition-colors"
         aria-label="Close" title="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* 1. Perimeter Check */}
        <section className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Target className="w-3 h-3 text-rmpg-400" />
            <span className="text-[10px] uppercase tracking-widest text-rmpg-300">
              Perimeter Check
            </span>
          </div>
          <button type="button"
            onClick={onAnalyzeCoverage}
            disabled={loading}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-sm text-[9px] font-mono uppercase tracking-wider bg-rmpg-700/40 border border-rmpg-700 text-rmpg-300 hover:bg-rmpg-700/70 hover:text-rmpg-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Radar className="w-3 h-3" />
                Analyze Coverage
              </>
            )}
          </button>

          {perimeterData && (
            <div className="space-y-2 mt-2">
              {/* Quadrant coverage bars */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {quadrantEntries.map(([label, pct]) => (
                  <div key={label} className="space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-mono text-rmpg-400">{label}</span>
                      <span className={`text-[9px] font-mono font-semibold ${getCoverageLabel(pct)}`}>
                        {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-sm bg-rmpg-700/50 overflow-hidden">
                      <div
                        className="h-full rounded-sm transition-all duration-300"
                        style={{
                          width: `${Math.min(pct, 100)}%`,
                          backgroundColor: getCoverageColor(pct),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Gap analysis */}
              {perimeterData.gaps.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[9px] font-mono text-red-400 uppercase tracking-wider">
                    Gaps Detected
                  </span>
                  <ul className="space-y-0.5">
                    {perimeterData.gaps.map((gap, i) => (
                      <li key={i} className="text-[9px] font-mono text-rmpg-400 flex items-start gap-1">
                        <span className="text-red-500 mt-px">&#x25CF;</span>
                        {gap}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Divider */}
        <div className="border-t border-rmpg-700/60" />

        {/* 2. Containment Polygon */}
        <section className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Pentagon className="w-3 h-3 text-rmpg-400" />
            <span className="text-[10px] uppercase tracking-widest text-rmpg-300">
              Containment Polygon
            </span>
          </div>
          <div className="flex gap-1.5">
            <button type="button"
              onClick={onStartContainment}
              disabled={isDrawingContainment}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-sm text-[9px] font-mono uppercase tracking-wider bg-rmpg-700/40 border border-rmpg-700 text-rmpg-300 hover:bg-rmpg-700/70 hover:text-rmpg-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Pentagon className="w-3 h-3" />
              Draw
            </button>
            <button type="button"
              onClick={onClearContainment}
              disabled={containmentVertices === 0 && !isDrawingContainment}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-sm text-[9px] font-mono uppercase tracking-wider bg-rmpg-700/40 border border-rmpg-700 text-rmpg-300 hover:bg-rmpg-700/70 hover:text-rmpg-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
             aria-label="Close" title="Close">
              <X className="w-3 h-3" />
              Clear
            </button>
          </div>
          <div className="text-[9px] font-mono text-rmpg-400">
            {isDrawingContainment ? (
              <span className="text-amber-400 flex items-center gap-1">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                Drawing... (click to add, double-click to finish)
              </span>
            ) : containmentVertices > 0 ? (
              <span className="text-green-400">
                Polygon set ({containmentVertices} vertices)
              </span>
            ) : (
              <span className="text-rmpg-400/60">No polygon drawn</span>
            )}
          </div>
        </section>

        {/* Divider */}
        <div className="border-t border-rmpg-700/60" />

        {/* 3. Critical Infrastructure */}
        <section className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Building className="w-3 h-3 text-rmpg-400" />
            <span className="text-[10px] uppercase tracking-widest text-rmpg-300">
              Critical Infrastructure
            </span>
          </div>
          <button type="button"
            onClick={onToggleHVTs}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-sm text-[9px] font-mono uppercase tracking-wider bg-rmpg-700/40 border border-rmpg-700 text-rmpg-300 hover:bg-rmpg-700/70 hover:text-rmpg-200 transition-colors"
          >
            <Building className="w-3 h-3" />
            {hvtVisible ? 'Hide HVTs' : 'Show HVTs'}
          </button>
        </section>

        {/* Divider */}
        <div className="border-t border-rmpg-700/60" />

        {/* 4. Staging Suggestion */}
        <section className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3 h-3 text-rmpg-400" />
            <span className="text-[10px] uppercase tracking-widest text-rmpg-300">
              Staging Suggestion
            </span>
          </div>
          {perimeterData?.staging_suggestion ? (
            <div className="p-2 rounded-sm bg-rmpg-700/30 border border-rmpg-700/50 space-y-1">
              <div className="text-[9px] font-mono text-green-400 flex items-center gap-1">
                <MapPin className="w-2.5 h-2.5" />
                Recommended Location
              </div>
              <div className="text-[9px] font-mono text-rmpg-300">
                {perimeterData.staging_suggestion.lat.toFixed(5)},{' '}
                {perimeterData.staging_suggestion.lng.toFixed(5)}
              </div>
              <div className="text-[9px] font-mono text-rmpg-400">
                {perimeterData.staging_suggestion.reason}
              </div>
            </div>
          ) : (
            <div className="text-[9px] font-mono text-rmpg-400/60">
              Run perimeter analysis to get staging recommendation
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
