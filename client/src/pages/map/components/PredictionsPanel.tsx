// ============================================================
// RMPG Flex — PredictionsPanel Component
// Floating panel showing predicted incident hotspots with
// confidence scores, risk breakdowns, and navigate-to buttons.
// ============================================================

import React from 'react';
import { X, Brain, Navigation, Loader2, Crosshair, Swords, Heart, TrendingUp } from 'lucide-react';
import type { PredictedHotspot } from '../hooks/useMapPredictions';

interface PredictionsPanelProps {
  hotspots: PredictedHotspot[];
  loading?: boolean;
  onNavigate: (lat: number, lng: number) => void;
  onClose?: () => void;
}

function confidenceColor(score: number): string {
  if (score >= 70) return '#ef4444';
  if (score >= 40) return '#f59e0b';
  return '#888888';
}

function confidenceLabel(score: number): string {
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MODERATE';
  return 'LOW';
}

export default function PredictionsPanel({
  hotspots,
  loading,
  onNavigate,
  onClose,
}: PredictionsPanelProps) {
  const highCount = hotspots.filter(h => h.score >= 70).length;
  const modCount = hotspots.filter(h => h.score >= 40 && h.score < 70).length;
  const lowCount = hotspots.filter(h => h.score < 40).length;
  const totalIncidents = hotspots.reduce((s, h) => s + h.incident_count, 0);

  return (
    <div className="panel-beveled bg-surface-base overflow-hidden transition-all duration-200 ease-out shadow-lg backdrop-blur-sm" style={{ width: 300 }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: '#050505', borderBottom: '1px solid #1e2a3a' }}
      >
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-purple-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-rmpg-200">
            Predicted Hotspots
          </span>
          {hotspots.length > 0 && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-purple-900/30 text-purple-400">
              {hotspots.length}
            </span>
          )}
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="toolbar-btn p-1 hover:bg-[#181818] transition-colors duration-150 rounded-sm" title="Close" aria-label="Close predictions panel">
            <X size={12} className="text-rmpg-400" />
          </button>
        )}
      </div>

      {/* ── Body ───────────────────────────────────────────── */}
      <div className="p-2 space-y-2">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-6">
            <Loader2 size={14} className="animate-spin text-purple-400" />
            <span className="text-[9px] font-mono text-rmpg-500">Analyzing patterns…</span>
          </div>
        )}

        {!loading && hotspots.length === 0 && (
          <div className="text-center py-6 text-[9px] font-mono text-rmpg-500">
            No predicted hotspots for this shift
          </div>
        )}

        {!loading && hotspots.length > 0 && (
          <>
            {/* ── Summary stats ──────────────────────────── */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                {highCount > 0 && (
                  <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-sm bg-red-900/30 text-red-400 border border-red-800/30">
                    {highCount} HIGH
                  </span>
                )}
                {modCount > 0 && (
                  <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-sm bg-amber-900/30 text-amber-400 border border-amber-800/30">
                    {modCount} MOD
                  </span>
                )}
                {lowCount > 0 && (
                  <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-sm bg-blue-900/30 text-blue-400 border border-blue-800/30">
                    {lowCount} LOW
                  </span>
                )}
              </div>
              <span className="text-[8px] font-mono text-rmpg-500">
                {totalIncidents} historical
              </span>
            </div>

            {/* ── Hotspot list ────────────────────────────── */}
            <div className="max-h-[360px] space-y-1.5 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent" style={{ scrollbarWidth: 'thin' }}>
              {hotspots.map((hs, idx) => {
                const color = confidenceColor(hs.score);
                const label = confidenceLabel(hs.score);
                const types = hs.top_types?.split(',').map(t => t.trim()).filter(Boolean) || [];
                const maxScore = Math.max(...hotspots.map(h => h.score), 1);
                const barWidth = Math.max(10, (hs.score / maxScore) * 100);

                return (
                  <div
                    key={`${hs.latitude}-${hs.longitude}-${idx}`}
                    className="rounded-sm overflow-hidden transition-all duration-150 hover:bg-[#0f1926]"
                    style={{
                      background: '#050505',
                      border: '1px solid #1e2a3a',
                      borderLeft: `3px solid ${color}`,
                    }}
                  >
                    <div className="px-2 py-1.5">
                      {/* Score + confidence bar */}
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[11px] font-mono font-black"
                            style={{ color }}
                          >
                            {hs.score}
                          </span>
                          <span
                            className="text-[7px] font-bold uppercase px-1 py-0.5 rounded-sm"
                            style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
                          >
                            {label}
                          </span>
                        </div>
                        <span className="text-[9px] font-mono text-rmpg-400">
                          {hs.incident_count} incidents
                        </span>
                      </div>

                      {/* #28: Confidence bar with wider glow for high scores */}
                      <div className="h-1.5 rounded-full bg-rmpg-800 mb-1.5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500 ease-out"
                          style={{ width: `${barWidth}%`, background: `linear-gradient(90deg, ${color}cc, ${color})`, boxShadow: `0 0 6px ${color}50` }}
                        />
                      </div>

                      {/* Risk indicators */}
                      <div className="flex items-center gap-1.5 mb-1">
                        {hs.weapons_count > 0 && (
                          <div className="flex items-center gap-0.5">
                            <Swords size={9} className="text-red-400" />
                            <span className="text-[8px] font-mono text-red-400">{hs.weapons_count}</span>
                          </div>
                        )}
                        {hs.dv_count > 0 && (
                          <div className="flex items-center gap-0.5">
                            <Heart size={9} className="text-amber-400" />
                            <span className="text-[8px] font-mono text-amber-400">{hs.dv_count}</span>
                          </div>
                        )}
                        {types.length > 0 && (
                          <span className="text-[7px] font-mono text-rmpg-500 truncate flex-1" title={hs.top_types}>
                            {types.slice(0, 2).join(' · ')}
                          </span>
                        )}
                      </div>

                      {/* Navigate */}
                      <button type="button"
                        onClick={() => { if (hs.latitude != null && hs.longitude != null) onNavigate(hs.latitude, hs.longitude); }}
                        className="toolbar-btn flex items-center gap-1 px-2 py-0.5 text-[8px] w-full justify-center transition-all duration-150 active:scale-[0.97]"
                        title="Center map on this hotspot"
                        aria-label={`Navigate to hotspot with score ${hs.score}`}
                      >
                        <Crosshair size={9} />
                        <span>Navigate to Zone</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────── */}
      {hotspots.length > 0 && (
        <div
          className="px-3 py-1.5 flex items-center justify-between"
          style={{ borderTop: '1px solid #1e2a3a', background: '#050505' }}
        >
          <div className="flex items-center gap-1">
            <TrendingUp size={10} className="text-purple-400" />
            <span className="text-[8px] text-rmpg-500 font-mono">
              Based on historical pattern analysis
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
