// ============================================================
// RMPG Flex — Shift Scorecard
// Per-shift performance scorecard for law enforcement officers
// ============================================================

import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Minus, Award, Target, Shield, Activity, BarChart3 } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from './PanelTitleBar';

interface MetricDetail {
  score: number;
  max: number;
  [key: string]: any;
}

interface ScorecardData {
  metrics: {
    response_time: MetricDetail;
    call_volume: MetricDetail;
    patrol_coverage: MetricDetail;
    report_completion: MetricDetail;
    proactive_activity: MetricDetail;
    safety: MetricDetail;
  };
  total_score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  trend: { current: number; previous_avg: number; direction: 'up' | 'down' | 'flat' };
  peer_rank: { rank: number; total: number };
}

interface ShiftScorecardProps {
  officerId?: number | string;
}

const GRADE_COLORS: Record<string, string> = {
  A: '#d4a017', B: '#22c55e', C: '#eab308', D: '#f97316', F: '#ef4444',
};

const METRIC_CONFIG: { key: keyof ScorecardData['metrics']; label: string; icon: React.ElementType; color: string }[] = [
  { key: 'response_time', label: 'Response Time', icon: Activity, color: '#888888' },
  { key: 'call_volume', label: 'Call Volume', icon: BarChart3, color: '#8b5cf6' },
  { key: 'patrol_coverage', label: 'Patrol Coverage', icon: Target, color: '#888888' },
  { key: 'report_completion', label: 'Reports', icon: Award, color: '#d4a017' },
  { key: 'proactive_activity', label: 'Proactive', icon: TrendingUp, color: '#22c55e' },
  { key: 'safety', label: 'Safety', icon: Shield, color: '#f97316' },
];

const TREND_ICONS: Record<string, { Icon: React.ElementType; color: string }> = {
  up: { Icon: TrendingUp, color: '#22c55e' },
  down: { Icon: TrendingDown, color: '#ef4444' },
  flat: { Icon: Minus, color: '#eab308' },
};

export default function ShiftScorecard({ officerId }: ShiftScorecardProps) {
  const [shiftDate, setShiftDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<ScorecardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!officerId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<ScorecardData>(`/reports/shift-scorecard?officer_id=${officerId}&shift_date=${shiftDate}`)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load scorecard'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [officerId, shiftDate]);

  // Circular progress indicator (CSS conic-gradient)
  const pct = data ? Math.round(data.total_score) : 0;
  const conicGradient = data
    ? `conic-gradient(${GRADE_COLORS[data.grade] || '#888888'} ${pct * 3.6}deg, #050505 0deg)`
    : 'conic-gradient(#050505 360deg)';

  const trend = data ? TREND_ICONS[data.trend.direction] : null;

  return (
    <div className="panel-beveled" style={{ background: '#0a0a0a' }}>
      <PanelTitleBar title="Shift Scorecard" icon={Award}>
        <input
          type="date"
          value={shiftDate}
          onChange={(e) => setShiftDate(e.target.value)}
          className="toolbar-btn text-xs"
          style={{ fontFamily: 'monospace', background: '#050505', color: '#94a3b8', border: '1px solid #888888', borderRadius: 2, padding: '1px 6px' }}
        />
      </PanelTitleBar>

      {!officerId && (
        <div className="p-4 text-center text-rmpg-400 text-sm" style={{ fontFamily: 'monospace' }}>
          Select an officer to view scorecard
        </div>
      )}

      {loading && (
        <div className="p-4 text-center text-rmpg-400 text-sm" style={{ fontFamily: 'monospace' }}>
          Loading scorecard...
        </div>
      )}

      {error && (
        <div className="p-4 text-center text-red-400 text-sm" style={{ fontFamily: 'monospace' }}>
          {error}
        </div>
      )}

      {data && !loading && (
        <div className="p-3 space-y-3">
          {/* Grade + Score + Trend Row */}
          <div className="flex items-center gap-4">
            {/* Letter Grade */}
            <div
              className="flex items-center justify-center font-bold"
              style={{
                fontFamily: 'monospace', fontSize: 48, lineHeight: 1,
                color: GRADE_COLORS[data.grade], textShadow: `0 0 12px ${GRADE_COLORS[data.grade]}40`,
                minWidth: 64,
              }}
            >
              {data.grade}
            </div>

            {/* Circular Score */}
            <div className="relative flex items-center justify-center" style={{ width: 72, height: 72 }}>
              <div
                style={{
                  position: 'absolute', inset: 0, borderRadius: '50%',
                  background: conicGradient,
                }}
              />
              <div
                className="flex items-center justify-center"
                style={{
                  position: 'relative', width: 56, height: 56, borderRadius: '50%',
                  background: '#0a0a0a', fontFamily: 'monospace', fontSize: 18,
                  fontWeight: 700, color: '#e2e8f0',
                }}
              >
                {pct}
              </div>
            </div>

            {/* Trend + Peer Rank */}
            <div className="flex-1 space-y-1">
              {trend && (
                <div className="flex items-center gap-1.5">
                  <trend.Icon size={14} style={{ color: trend.color }} />
                  <span className="text-rmpg-300 text-xs" style={{ fontFamily: 'monospace' }}>
                    {data.trend.current} vs {data.trend.previous_avg.toFixed(1)} avg
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-rmpg-400 text-xs" style={{ fontFamily: 'monospace' }}>
                <BarChart3 size={12} />
                Rank {data.peer_rank.rank}/{data.peer_rank.total}
              </div>
              {/* Peer rank bar */}
              <div style={{ height: 4, background: '#050505', borderRadius: 2, position: 'relative' }}>
                <div
                  style={{
                    position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: 2,
                    width: `${Math.max(4, ((data.peer_rank.total - data.peer_rank.rank + 1) / data.peer_rank.total) * 100)}%`,
                    background: '#888888',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Metric Gauges */}
          <div className="space-y-2">
            {METRIC_CONFIG.map(({ key, label, icon: MIcon, color }) => {
              const m = data.metrics[key];
              const pctFill = m.max > 0 ? (m.score / m.max) * 100 : 0;
              return (
                <div key={key} className="flex items-center gap-2">
                  <MIcon size={13} style={{ color, flexShrink: 0 }} />
                  <span className="text-rmpg-300 text-xs w-20 truncate" style={{ fontFamily: 'monospace' }}>
                    {label}
                  </span>
                  <div className="flex-1" style={{ height: 8, background: '#050505', borderRadius: 2, position: 'relative' }}>
                    <div
                      style={{
                        position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: 2,
                        width: `${Math.min(100, pctFill)}%`,
                        background: color, opacity: 0.85,
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                  <span className="text-rmpg-400 text-xs w-12 text-right" style={{ fontFamily: 'monospace' }}>
                    {m.score}/{m.max}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
