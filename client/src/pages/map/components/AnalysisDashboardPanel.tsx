// ============================================================
// RMPG Flex — AnalysisDashboardPanel Component
// Floating cross-feature intelligence panel for the map.
// Shows overlap zones, repeat addresses, enforcement stats,
// and shift trends when "Analysis Intel" toggle is active.
// ============================================================

import React from 'react';
import {
  X,
  Brain,
  RefreshCw,
  AlertTriangle,
  MapPin,
  Scale,
  TrendingUp,
  TrendingDown,
  Shield,
  Radar,
  Loader2,
  ChevronRight,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────

interface OverlapLocation {
  latitude: number;
  longitude: number;
  safetyRisk: 'high' | 'moderate';
  predictionScore: number;
  totalFlagged: number;
}

interface RepeatAddress {
  address: string;
  callCount: number;
  nearestZoneRisk: 'high' | 'moderate';
}

interface AnalysisData {
  overlapZones: { count: number; locations: OverlapLocation[] };
  repeatInRiskZones: { count: number; addresses: RepeatAddress[] };
  enforcement: { total30d: number; inPredictedAreas: number; effectivenessRate: number };
  shiftTrend: { currentShift: string; currentPeriodCalls: number; previousPeriodCalls: number; changePercent: number };
  metrics: {
    totalSafetyZones: number;
    highRiskZones: number;
    activePredictions: number;
    activeGeofences: number;
    totalEnforcement30d: number;
    repeatAddressCount: number;
  };
}

interface AnalysisDashboardPanelProps {
  data: AnalysisData | null;
  loading: boolean;
  onRefresh: () => void;
  onNavigate: (lat: number, lng: number) => void;
  onClose: () => void;
}

// ─── Helpers ────────────────────────────────────────────────

function shiftColor(shift: string): string {
  const s = shift.toLowerCase();
  if (s.includes('day')) return '#d4a017';
  if (s.includes('swing')) return '#888888';
  if (s.includes('night') || s.includes('grave')) return '#a855f7';
  return '#666666';
}

function shiftBg(shift: string): string {
  const s = shift.toLowerCase();
  if (s.includes('day')) return 'rgba(212,160,23,0.15)';
  if (s.includes('swing')) return 'rgba(136, 136, 136,0.15)';
  if (s.includes('night') || s.includes('grave')) return 'rgba(168,85,247,0.15)';
  return 'rgba(107,114,128,0.15)';
}

function effectivenessColor(rate: number): string {
  if (rate > 50) return '#22c55e';
  if (rate >= 25) return '#f59e0b';
  return '#ef4444';
}

// ─── Component ──────────────────────────────────────────────

export default function AnalysisDashboardPanel({
  data,
  loading,
  onRefresh,
  onNavigate,
  onClose,
}: AnalysisDashboardPanelProps) {
  const m = data?.metrics;

  return (
    <div
      className="panel-beveled rounded-sm flex flex-col overflow-hidden transition-all duration-200 ease-out shadow-lg backdrop-blur-sm"
      style={{
        width: 320,
        maxHeight: 'calc(100dvh - 160px)',
        background: '#0a0a0a',
        border: '1px solid #1e2a3a',
      }}
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ background: '#050505', borderBottom: '1px solid #1e2a3a' }}
      >
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-purple-400" />
          <span
            className="font-mono text-[10px] font-bold tracking-widest uppercase"
            style={{ color: '#a855f7' }}
          >
            Analysis Intel
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button"
            onClick={onRefresh}
            className="p-1 rounded hover:bg-[#181818] transition-colors duration-150"
            title="Refresh analysis"
            aria-label="Refresh analysis data"
          >
            <RefreshCw
              size={12}
              className={`text-rmpg-400 ${loading ? 'animate-spin' : ''}`}
            />
          </button>
          <button type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[#181818] transition-colors duration-150"
            title="Close panel"
            aria-label="Close analysis dashboard"
          >
            <X size={12} className="text-rmpg-400" />
          </button>
        </div>
      </div>

      {/* ── Scrollable body ────────────────────────────────── */}
      <div className="overflow-y-auto flex-1 custom-scrollbar scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent">
        {loading && !data ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={18} className="animate-spin text-purple-400" />
            <span className="ml-2 text-[10px] text-rmpg-500 font-mono">Loading analysis...</span>
          </div>
        ) : !data ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-[10px] text-rmpg-600 font-mono">No data available</span>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {/* ── Section 1: Metrics Grid ──────────────────── */}
            <div className="grid grid-cols-3 gap-1">
              <MetricCell value={m?.totalSafetyZones ?? 0} label="Safety Zones" color="#ef4444" />
              <MetricCell value={m?.highRiskZones ?? 0} label="High Risk" color="#991b1b" />
              <MetricCell value={m?.activePredictions ?? 0} label="Predictions" color="#a855f7" />
              <MetricCell value={m?.activeGeofences ?? 0} label="Geofences" color="#888888" />
              <MetricCell value={m?.totalEnforcement30d ?? 0} label="Enforcement 30d" color="#f43f5e" />
              <MetricCell value={m?.repeatAddressCount ?? 0} label="Repeat Addrs" color="#f97316" />
            </div>

            {/* ── Section 2: Overlap Zones ─────────────────── */}
            {data.overlapZones.count > 0 && (
              <SectionBlock
                icon={<AlertTriangle size={10} className="text-amber-400" />}
                title="Risk Convergence"
              >
                <p className="text-[9px] text-rmpg-500 font-mono mb-1.5">
                  Locations flagged as both safety zones and prediction hotspots
                </p>
                <div className="space-y-1">
                  {data.overlapZones.locations.map((loc, i) => (
                    <button type="button"
                      key={i}
                      onClick={() => onNavigate(loc.latitude, loc.longitude)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-surface-raised/50 transition-all duration-150 active:scale-[0.97] group"
                      style={{
                        background: '#050505',
                        borderLeft: `2px solid ${loc.safetyRisk === 'high' ? '#ef4444' : '#f59e0b'}`,
                      }}
                    >
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-[8px] font-mono font-bold uppercase px-1 rounded-sm"
                            style={{
                              color: loc.safetyRisk === 'high' ? '#ef4444' : '#f59e0b',
                              background:
                                loc.safetyRisk === 'high'
                                  ? 'rgba(239,68,68,0.15)'
                                  : 'rgba(245,158,11,0.15)',
                            }}
                          >
                            {loc.safetyRisk}
                          </span>
                          <span className="text-[9px] text-gray-400 font-mono">
                            Score: {loc.predictionScore}%
                          </span>
                        </div>
                        <span className="text-[8px] text-rmpg-600 font-mono">
                          {loc.totalFlagged} flagged
                        </span>
                      </div>
                      <ChevronRight
                        size={10}
                        className="text-rmpg-600 group-hover:text-purple-400 transition-colors"
                      />
                    </button>
                  ))}
                </div>
              </SectionBlock>
            )}

            {data.overlapZones.count === 0 && (
              <SectionBlock
                icon={<AlertTriangle size={10} className="text-amber-400" />}
                title="Risk Convergence"
              >
                <p className="text-[9px] text-rmpg-600 font-mono italic">
                  No convergence zones detected
                </p>
              </SectionBlock>
            )}

            {/* ── Section 3: Repeat Addresses ─────────────── */}
            {data.repeatInRiskZones.count > 0 ? (
              <SectionBlock
                icon={<MapPin size={10} className="text-orange-400" />}
                title="Chronic Locations in Risk Zones"
              >
                <div className="space-y-1">
                  {data.repeatInRiskZones.addresses.map((addr, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-sm"
                      style={{ background: '#050505' }}
                    >
                      <div className="flex-1 min-w-0">
                        <span
                          className="text-[9px] text-rmpg-300 font-mono block truncate"
                          title={addr.address}
                        >
                          {addr.address}
                        </span>
                      </div>
                      <span
                        className="text-[8px] font-mono font-bold px-1.5 rounded-sm shrink-0"
                        style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316' }}
                      >
                        {addr.callCount}
                      </span>
                      <span
                        className="text-[8px] font-mono uppercase px-1 rounded-sm shrink-0"
                        style={{
                          color: addr.nearestZoneRisk === 'high' ? '#ef4444' : '#f59e0b',
                          background:
                            addr.nearestZoneRisk === 'high'
                              ? 'rgba(239,68,68,0.12)'
                              : 'rgba(245,158,11,0.12)',
                        }}
                      >
                        {addr.nearestZoneRisk}
                      </span>
                    </div>
                  ))}
                </div>
              </SectionBlock>
            ) : (
              <SectionBlock
                icon={<MapPin size={10} className="text-orange-400" />}
                title="Chronic Locations in Risk Zones"
              >
                <p className="text-[9px] text-rmpg-600 font-mono italic">
                  No chronic locations in risk zones
                </p>
              </SectionBlock>
            )}

            {/* ── Section 4: Enforcement Effectiveness ─────── */}
            <SectionBlock
              icon={<Scale size={10} className="text-emerald-400" />}
              title="Enforcement Effectiveness"
            >
              <div className="space-y-1.5">
                <div
                  className="w-full h-3 rounded-sm overflow-hidden"
                  style={{ background: '#050505' }}
                >
                  <div
                    className="h-full rounded-sm transition-all duration-500"
                    style={{
                      width: `${Math.min(100, data.enforcement.effectivenessRate)}%`,
                      background: effectivenessColor(data.enforcement.effectivenessRate),
                    }}
                  />
                </div>
                <p className="text-[9px] font-mono" style={{ color: effectivenessColor(data.enforcement.effectivenessRate) }}>
                  {data.enforcement.effectivenessRate}% of enforcement in predicted areas
                </p>
                <div className="flex items-center gap-3">
                  <span className="text-[8px] text-rmpg-500 font-mono">
                    Total: {data.enforcement.total30d}
                  </span>
                  <span className="text-[8px] text-rmpg-500 font-mono">
                    In predicted: {data.enforcement.inPredictedAreas}
                  </span>
                </div>
              </div>
            </SectionBlock>

            {/* ── Section 5: Shift Trend ───────────────────── */}
            <SectionBlock
              icon={
                data.shiftTrend.changePercent <= 0 ? (
                  <TrendingDown size={10} className="text-emerald-400" />
                ) : (
                  <TrendingUp size={10} className="text-red-400" />
                )
              }
              title="7-Day Trend"
            >
              <div className="space-y-1.5">
                <span
                  className="inline-block text-[8px] font-mono font-bold uppercase px-1.5 py-0.5 rounded-sm"
                  style={{
                    color: shiftColor(data.shiftTrend.currentShift),
                    background: shiftBg(data.shiftTrend.currentShift),
                  }}
                >
                  {data.shiftTrend.currentShift}
                </span>
                <div className="flex items-center gap-3">
                  <div>
                    <span className="text-[8px] text-rmpg-500 font-mono uppercase block">This week</span>
                    <span className="text-[11px] text-white font-mono font-bold tabular-nums">
                      {data.shiftTrend.currentPeriodCalls}
                    </span>
                    <span className="text-[8px] text-rmpg-600 font-mono ml-0.5">calls</span>
                  </div>
                  <div>
                    <span className="text-[8px] text-rmpg-500 font-mono uppercase block">Last week</span>
                    <span className="text-[11px] text-white font-mono font-bold tabular-nums">
                      {data.shiftTrend.previousPeriodCalls}
                    </span>
                    <span className="text-[8px] text-rmpg-600 font-mono ml-0.5">calls</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {data.shiftTrend.changePercent > 0 ? (
                    <>
                      <TrendingUp size={10} className="text-red-400" />
                      <span className="text-[9px] font-mono font-bold text-red-400">
                        +{data.shiftTrend.changePercent}%
                      </span>
                      <span className="text-[8px] text-rmpg-600 font-mono ml-1">increase</span>
                    </>
                  ) : data.shiftTrend.changePercent < 0 ? (
                    <>
                      <TrendingDown size={10} className="text-emerald-400" />
                      <span className="text-[9px] font-mono font-bold text-emerald-400">
                        {data.shiftTrend.changePercent}%
                      </span>
                      <span className="text-[8px] text-rmpg-600 font-mono ml-1">decrease</span>
                    </>
                  ) : (
                    <span className="text-[9px] font-mono text-rmpg-500">No change</span>
                  )}
                </div>
              </div>
            </SectionBlock>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────

function MetricCell({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center py-2 px-1 rounded-sm panel-inset"
      style={{ background: '#050505', border: '1px solid #1e2a3a' }}
    >
      {/* #52: Metric cell value with text shadow glow */}
      <span className="text-[14px] font-mono font-bold leading-none tabular-nums" style={{ color, textShadow: `0 0 8px ${color}30` }}>
        {value}
      </span>
      <span className="text-[7px] font-mono uppercase tracking-widest text-rmpg-500 mt-1 text-center leading-tight">
        {label}
      </span>
    </div>
  );
}

function SectionBlock({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-sm p-2 panel-inset"
      style={{ background: '#0a0a0a', border: '1px solid #1e2a3a' }}
    >
      <div className="flex items-center gap-1.5 mb-1.5 pb-1" style={{ borderBottom: '1px solid transparent', borderImage: 'linear-gradient(to right, #1e2a3a, #2a3f5a, #1e2a3a) 1' }}>
        {icon}
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-gray-400">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}
