import React, { useState } from 'react';
import { X, Route, Navigation, AlertTriangle, ArrowUp, Loader2, Zap } from 'lucide-react';

interface CorridorAnalysisPanelProps {
  corridorData: {
    total_risk_score: number;
    segments: {
      start: { lat: number; lng: number };
      end: { lat: number; lng: number };
      risk_score: number;
      traffic_label: string | null;
      ambush_notes: string[];
    }[];
    ambush_vulnerabilities: string[];
  } | null;
  pursuitProjection: { lat: number; lng: number; heading: number } | null;
  loading: boolean;
  onAnalyzeCorridor: () => void;
  onShowPursuitProjection: (heading: number) => void;
  onClearPursuit: () => void;
  onShowEscapeRoutes: () => void;
  onClearEscapeRoutes: () => void;
  onClearCorridor: () => void;
  onClose: () => void;
}

function getRiskColor(score: number): string {
  if (score <= 3) return '#22c55e';
  if (score <= 6) return '#f59e0b';
  return '#ef4444';
}

function getRiskLabel(score: number): string {
  if (score <= 3) return 'LOW';
  if (score <= 6) return 'MODERATE';
  return 'HIGH';
}

export default function CorridorAnalysisPanel({
  corridorData,
  pursuitProjection,
  loading,
  onAnalyzeCorridor,
  onShowPursuitProjection,
  onClearPursuit,
  onShowEscapeRoutes,
  onClearEscapeRoutes,
  onClearCorridor,
  onClose,
}: CorridorAnalysisPanelProps) {
  const [headingInput, setHeadingInput] = useState('0');

  const handlePursuitProject = () => {
    const heading = Math.min(360, Math.max(0, parseInt(headingInput, 10) || 0));
    onShowPursuitProjection(heading);
  };

  return (
    <div
      className="panel-beveled rounded-sm bg-surface-base border border-rmpg-700 shadow-xl transition-all duration-200 ease-out backdrop-blur-sm"
      style={{ width: 280, maxWidth: 280 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-rmpg-700">
        <div className="flex items-center gap-1.5">
          <Route size={12} className="text-rmpg-400" />
          <span className="text-[10px] uppercase tracking-widest font-semibold text-rmpg-300">
            Corridor Analysis
          </span>
        </div>
        <button type="button"
          onClick={onClose}
          className="p-0.5 rounded-sm hover:bg-[#181818] text-rmpg-400 hover:text-rmpg-200 transition-colors duration-150"
          aria-label="Close corridor analysis"
        >
          <X size={12} />
        </button>
      </div>

      <div className="p-3 space-y-3 max-h-[480px] overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent">
        {/* === Corridor Analysis Section === */}
        <section className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-widest text-rmpg-400 font-semibold flex items-center gap-1">
            <Route size={10} />
            Route Analysis
          </h3>

          <div className="flex gap-1.5">
            <button type="button"
              onClick={onAnalyzeCorridor}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-sm text-[9px] font-mono font-medium bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 active:scale-[0.97]"
              aria-label="Analyze corridor route"
            >
              {loading ? <Loader2 size={10} className="animate-spin" /> : <Route size={10} />}
              Analyze Route
            </button>
            {corridorData && (
              <button type="button"
                onClick={onClearCorridor}
                className="px-2 py-1.5 rounded-sm text-[9px] font-mono font-medium bg-rmpg-700/40 border border-rmpg-700 text-rmpg-400 hover:bg-rmpg-700/60 transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Corridor Results */}
          {corridorData && (
            <div className="space-y-2">
              {/* Total Risk Score */}
              <div className="flex items-center justify-between px-2 py-1.5 rounded-sm bg-rmpg-700/20 border border-rmpg-700/50">
                <span className="text-[9px] font-mono text-rmpg-400">TOTAL RISK</span>
                <span
                  className="text-[11px] font-mono font-bold tabular-nums"
                  style={{ color: getRiskColor(corridorData.total_risk_score), textShadow: `0 0 6px ${getRiskColor(corridorData.total_risk_score)}30` }}
                >
                  {corridorData.total_risk_score.toFixed(1)} — {getRiskLabel(corridorData.total_risk_score)}
                </span>
              </div>

              {/* Segment Breakdown */}
              {corridorData.segments.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[9px] font-mono text-rmpg-400 uppercase tracking-wider">
                    Segments
                  </span>
                  {/* #36: Segment risk bars with glow */}
                  <div className="flex gap-0.5">
                    {corridorData.segments.map((seg, i) => (
                      <div
                        key={i}
                        className="flex-1 h-2 rounded-sm transition-all duration-300"
                        style={{ backgroundColor: getRiskColor(seg.risk_score), boxShadow: `0 0 4px ${getRiskColor(seg.risk_score)}40` }}
                        title={`Segment ${i + 1}: Risk ${seg.risk_score}${seg.traffic_label ? ` | ${seg.traffic_label}` : ''}`}
                      />
                    ))}
                  </div>
                  <div className="space-y-0.5">
                    {corridorData.segments.map((seg, i) => (
                      <div key={i} className="flex items-center justify-between text-[9px] font-mono hover:bg-[#181818]/50 rounded-sm px-1 -mx-1 transition-colors duration-150">
                        <div className="flex items-center gap-1">
                          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getRiskColor(seg.risk_score), boxShadow: `0 0 3px ${getRiskColor(seg.risk_score)}50` }} />
                          <span className="text-rmpg-400">Seg {i + 1}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {seg.traffic_label && (
                            <span className="text-rmpg-400/70">{seg.traffic_label}</span>
                          )}
                          <span style={{ color: getRiskColor(seg.risk_score) }}>
                            {seg.risk_score.toFixed(1)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ambush Vulnerabilities */}
              {corridorData.ambush_vulnerabilities.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[9px] font-mono text-rmpg-400 uppercase tracking-wider flex items-center gap-1">
                    <AlertTriangle size={9} className="text-red-400" />
                    Ambush Vulnerabilities
                  </span>
                  <div className="space-y-0.5">
                    {corridorData.ambush_vulnerabilities.map((v, i) => (
                      <div key={i} className="text-[9px] font-mono text-red-400 pl-2 border-l border-red-500/30">
                        {v}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Divider */}
        <div className="border-t border-rmpg-700/50" />

        {/* === Pursuit Projection Section === */}
        <section className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-widest text-rmpg-400 font-semibold flex items-center gap-1">
            <Navigation size={10} />
            Pursuit Projection
          </h3>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 flex-1">
              <ArrowUp size={10} className="text-rmpg-400" />
              <input
                type="number"
                min={0}
                max={360}
                value={headingInput}
                onChange={(e) => setHeadingInput(e.target.value)}
                className="w-full px-1.5 py-1 rounded-sm text-[9px] font-mono bg-rmpg-700/30 border border-rmpg-700 text-rmpg-200 focus:outline-none focus:border-blue-500/50"
                placeholder="0-360°"
              />
            </div>
            <button type="button"
              onClick={handlePursuitProject}
              disabled={loading}
              className="flex items-center gap-1 px-2 py-1.5 rounded-sm text-[9px] font-mono font-medium bg-amber-600/20 border border-amber-500/30 text-amber-300 hover:bg-amber-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 active:scale-[0.97]"
              aria-label="Project pursuit path"
            >
              {loading ? <Loader2 size={10} className="animate-spin" /> : <Navigation size={10} />}
              Project
            </button>
          </div>

          {pursuitProjection && (
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono text-rmpg-400">
                HDG {pursuitProjection.heading}° from {pursuitProjection.lat.toFixed(4)}, {pursuitProjection.lng.toFixed(4)}
              </span>
              <button type="button"
                onClick={onClearPursuit}
                className="px-1.5 py-0.5 rounded-sm text-[9px] font-mono text-rmpg-400 bg-rmpg-700/40 border border-rmpg-700 hover:bg-rmpg-700/60 transition-colors"
              >
                Clear
              </button>
            </div>
          )}
        </section>

        {/* Divider */}
        <div className="border-t border-rmpg-700/50" />

        {/* === Escape Routes Section === */}
        <section className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-widest text-rmpg-400 font-semibold flex items-center gap-1">
            <Zap size={10} />
            Escape Routes
          </h3>

          <div className="flex gap-1.5">
            <button type="button"
              onClick={onShowEscapeRoutes}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-sm text-[9px] font-mono font-medium bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 active:scale-[0.97]"
              aria-label="Show escape routes"
            >
              {loading ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
              Show Escape Routes
            </button>
            <button type="button"
              onClick={onClearEscapeRoutes}
              className="px-2 py-1.5 rounded-sm text-[9px] font-mono font-medium bg-rmpg-700/40 border border-rmpg-700 text-rmpg-400 hover:bg-rmpg-700/60 transition-colors"
            >
              Clear
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
