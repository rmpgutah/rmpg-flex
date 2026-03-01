// ============================================================
// RMPG Flex — Personnel: Overtime Tracking Tab
// Real-time overtime monitoring with daily/weekly thresholds,
// approaching-OT alerts, active shift projections, and
// per-officer weekly breakdown.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle, Clock, TrendingUp, Users, Timer, Shield,
  ChevronDown, ChevronUp, Loader2, RefreshCw, Activity,
} from 'lucide-react';
import type { OvertimeData, OvertimeAlert, ActiveShiftProjection, WeeklyBreakdown } from '../../../types';
import { apiFetch } from '../../../hooks/useApi';

// ── Helpers ──────────────────────────────────────────────

function formatHours(h: number): string {
  return h.toFixed(1);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatWeekOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `Week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function formatClockTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function getElapsedSince(clockIn: string): string {
  const diff = Date.now() - new Date(clockIn).getTime();
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hrs}h ${mins}m`;
}

function progressColor(ratio: number): string {
  if (ratio >= 1) return 'bg-red-500';
  if (ratio >= 0.8) return 'bg-amber-500';
  return 'bg-green-500';
}

// ── Component ────────────────────────────────────────────

export default function OvertimeTab() {
  const [data, setData] = useState<OvertimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedOfficer, setExpandedOfficer] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const result = await apiFetch<OvertimeData>('/personnel/overtime?weeks=4');
      setData(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to load overtime data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 60 seconds for live shift tracking
  useEffect(() => {
    const timer = setInterval(() => fetchData(true), 60000);
    return () => clearInterval(timer);
  }, [fetchData]);

  // Group weekly breakdown by officer (current week)
  const currentWeekBreakdown = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    const weekStart = monday.toISOString().split('T')[0];
    return data.weekly_breakdown.filter(w => w.week_start === weekStart);
  }, [data]);

  // Historical weekly breakdown (all weeks except current)
  const historicalBreakdown = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    const weekStart = monday.toISOString().split('T')[0];
    return data.weekly_breakdown.filter(w => w.week_start !== weekStart);
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center flex-1">
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
          <p className="text-sm text-rmpg-300">{error || 'No data'}</p>
          <button onClick={() => fetchData()} className="toolbar-btn mt-3">Retry</button>
        </div>
      </div>
    );
  }

  const { summary, alerts, active_shifts, daily_breakdown, thresholds } = data;

  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const warningAlerts = alerts.filter(a => a.severity === 'warning');

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-brand-400" />
          <h2 className="text-sm font-bold text-rmpg-200 uppercase tracking-wider">Overtime Tracking</h2>
        </div>
        <button
          onClick={() => fetchData(true)}
          className={`toolbar-btn flex items-center gap-1 text-[10px] ${refreshing ? 'opacity-50' : ''}`}
          disabled={refreshing}
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Updating...' : 'Refresh'}
        </button>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-5 gap-2">
        <SummaryCard
          icon={Clock}
          label="OT This Week"
          value={`${formatHours(summary.current_week_overtime)}h`}
          color="text-red-400"
          bgClass="bg-[#1a0a0a]"
          border="border-red-700/30"
          topBorder="border-t-red-500"
        />
        <SummaryCard
          icon={TrendingUp}
          label="OT (30 Days)"
          value={`${formatHours(summary.thirty_day_overtime)}h`}
          color="text-amber-400"
          bgClass="bg-[#1a1400]"
          border="border-amber-700/30"
          topBorder="border-t-amber-500"
        />
        <SummaryCard
          icon={AlertTriangle}
          label="In Overtime"
          value={String(summary.officers_in_overtime)}
          color={summary.officers_in_overtime > 0 ? 'text-red-400' : 'text-green-400'}
          bgClass={summary.officers_in_overtime > 0 ? 'bg-[#1a0a0a]' : 'bg-[#0a1a0a]'}
          border={summary.officers_in_overtime > 0 ? 'border-red-700/30' : 'border-green-700/30'}
          topBorder={summary.officers_in_overtime > 0 ? 'border-t-red-500' : 'border-t-green-500'}
        />
        <SummaryCard
          icon={Shield}
          label="Approaching OT"
          value={String(summary.officers_approaching)}
          color={summary.officers_approaching > 0 ? 'text-amber-400' : 'text-green-400'}
          bgClass={summary.officers_approaching > 0 ? 'bg-[#1a1400]' : 'bg-[#0a1a0a]'}
          border={summary.officers_approaching > 0 ? 'border-amber-700/30' : 'border-green-700/30'}
          topBorder={summary.officers_approaching > 0 ? 'border-t-amber-500' : 'border-t-green-500'}
        />
        <SummaryCard
          icon={Activity}
          label="Active Shifts"
          value={String(summary.active_shifts)}
          color="text-brand-400"
          bgClass="bg-[#0a1020]"
          border="border-brand-700/30"
          topBorder="border-t-brand-500"
        />
      </div>

      {/* ── Alert Banner ── */}
      {criticalAlerts.length > 0 && (
        <div className="panel-beveled border border-red-700/40 bg-red-950/30 p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-[11px] font-bold text-red-400 uppercase tracking-wider">
              Overtime Alerts ({criticalAlerts.length})
            </span>
          </div>
          <div className="space-y-1">
            {criticalAlerts.map((alert, i) => (
              <AlertRow key={`crit-${i}`} alert={alert} />
            ))}
          </div>
        </div>
      )}

      {warningAlerts.length > 0 && (
        <div className="panel-beveled border border-amber-700/40 bg-amber-950/20 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-amber-400" />
            <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">
              Approaching Overtime ({warningAlerts.length})
            </span>
          </div>
          <div className="space-y-1">
            {warningAlerts.map((alert, i) => (
              <AlertRow key={`warn-${i}`} alert={alert} />
            ))}
          </div>
        </div>
      )}

      {alerts.length === 0 && (
        <div className="panel-beveled border border-green-700/30 bg-green-950/20 p-3 text-center">
          <span className="text-[11px] text-green-400 font-semibold">
            All Clear — No officers in or approaching overtime
          </span>
        </div>
      )}

      {/* ── Active Shifts (Live) ── */}
      {active_shifts.length > 0 && (
        <div className="panel-beveled border border-rmpg-600 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Timer className="w-4 h-4 text-green-400" />
            <span className="text-[11px] font-bold text-rmpg-200 uppercase tracking-wider">
              Live Shifts ({active_shifts.length})
            </span>
            <span className="led-dot led-green animate-pulse" />
          </div>
          <div className="space-y-1.5">
            {active_shifts.map((shift) => (
              <ActiveShiftRow key={shift.entry_id} shift={shift} threshold={thresholds.daily} />
            ))}
          </div>
        </div>
      )}

      {/* ── Current Week Breakdown ── */}
      <div className="panel-beveled border border-rmpg-600 p-3">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-brand-400" />
          <span className="text-[11px] font-bold text-rmpg-200 uppercase tracking-wider">
            Current Week — Officer Hours
          </span>
          <span className="text-[9px] text-rmpg-500 ml-auto font-mono">
            {thresholds.daily}h/day · {thresholds.weekly}h/week thresholds
          </span>
        </div>

        {currentWeekBreakdown.length === 0 ? (
          <div className="text-center py-4 text-rmpg-500 text-[11px]">No completed shifts this week</div>
        ) : (
          <div className="space-y-1.5">
            {currentWeekBreakdown.map((row) => (
              <WeeklyRow
                key={`${row.officer_id}-${row.week_start}`}
                row={row}
                dailyBreakdown={daily_breakdown.filter(d => d.officer_id === row.officer_id)}
                threshold={thresholds.weekly}
                isExpanded={expandedOfficer === `${row.officer_id}-${row.week_start}`}
                onToggle={() => setExpandedOfficer(
                  expandedOfficer === `${row.officer_id}-${row.week_start}` ? null : `${row.officer_id}-${row.week_start}`
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Historical Weeks ── */}
      {historicalBreakdown.length > 0 && (
        <div className="panel-beveled border border-rmpg-600 p-3">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-rmpg-400" />
            <span className="text-[11px] font-bold text-rmpg-200 uppercase tracking-wider">
              Previous Weeks
            </span>
          </div>
          {/* Group by week */}
          {Array.from(new Set(historicalBreakdown.map(r => r.week_start)))
            .sort((a, b) => b.localeCompare(a))
            .map(weekStart => (
              <div key={weekStart} className="mb-3">
                <div className="text-[10px] text-rmpg-400 font-semibold mb-1.5 uppercase tracking-wider">
                  {formatWeekOf(weekStart)}
                </div>
                <div className="space-y-1">
                  {historicalBreakdown
                    .filter(r => r.week_start === weekStart)
                    .map(row => (
                      <div
                        key={`${row.officer_id}-${row.week_start}`}
                        className="flex items-center gap-3 px-3 py-1.5 bg-surface-raised border border-rmpg-700/50 rounded"
                      >
                        <span className="text-[11px] text-rmpg-200 font-medium w-40 truncate">{row.officer_name}</span>
                        {row.badge_number && <span className="text-[9px] font-mono text-rmpg-500">#{row.badge_number}</span>}
                        <div className="flex-1 mx-2">
                          <div className="h-1.5 bg-rmpg-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${progressColor(row.total_hours / thresholds.weekly)}`}
                              style={{ width: `${Math.min(100, (row.total_hours / thresholds.weekly) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-rmpg-300 w-14 text-right">{formatHours(row.total_hours)}h</span>
                        {row.overtime_hours > 0 && (
                          <span className="text-[9px] font-mono text-red-400 bg-red-900/30 px-1.5 py-0.5 rounded">
                            +{formatHours(row.overtime_hours)} OT
                          </span>
                        )}
                      </div>
                    ))
                  }
                </div>
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────

function SummaryCard({ icon: Icon, label, value, color, bgClass, border, topBorder }: {
  icon: React.ElementType; label: string; value: string;
  color: string; bgClass: string; border: string; topBorder: string;
}) {
  return (
    <div className={`panel-beveled p-2.5 text-center border ${border} border-t-2 ${topBorder} ${bgClass}`}>
      <Icon className={`w-3.5 h-3.5 mx-auto ${color} mb-1`} />
      <div className={`text-sm font-bold font-mono ${color}`}>{value}</div>
      <div className="text-[8px] text-rmpg-500 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

function AlertRow({ alert }: { alert: OvertimeAlert }) {
  const isCritical = alert.severity === 'critical';
  return (
    <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded ${
      isCritical ? 'bg-red-950/50' : 'bg-amber-950/30'
    }`}>
      <span className={`led-dot ${isCritical ? 'led-red' : 'led-amber'}`} />
      <span className="text-[11px] text-rmpg-200 font-medium w-36 truncate">{alert.officer_name}</span>
      {alert.badge_number && <span className="text-[9px] font-mono text-rmpg-500">#{alert.badge_number}</span>}
      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
        isCritical ? 'bg-red-900/40 text-red-400' : 'bg-amber-900/30 text-amber-400'
      }`}>
        {alert.type.replace(/_/g, ' ').toUpperCase()}
      </span>
      <span className="text-[10px] text-rmpg-400 flex-1 truncate">{alert.message}</span>
    </div>
  );
}

function ActiveShiftRow({ shift, threshold }: { shift: ActiveShiftProjection; threshold: number }) {
  const ratio = shift.current_hours / threshold;
  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded border ${
      shift.is_overtime ? 'bg-red-950/30 border-red-700/30' : 'bg-surface-raised border-rmpg-700/50'
    }`}>
      <span className={`led-dot ${shift.status === 'on_break' ? 'led-amber' : 'led-green'} animate-pulse`} />
      <span className="text-[11px] text-rmpg-200 font-medium w-36 truncate">{shift.officer_name}</span>
      {shift.badge_number && <span className="text-[9px] font-mono text-rmpg-500">#{shift.badge_number}</span>}
      <span className="text-[9px] text-rmpg-500 uppercase font-semibold">
        {shift.status === 'on_break' ? 'BREAK' : 'ACTIVE'}
      </span>
      <span className="text-[9px] text-rmpg-500 font-mono">
        In: {formatClockTime(shift.clock_in)} · {getElapsedSince(shift.clock_in)}
      </span>
      <div className="flex-1 mx-2">
        <div className="h-2 bg-rmpg-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${progressColor(ratio)}`}
            style={{ width: `${Math.min(100, ratio * 100)}%` }}
          />
        </div>
      </div>
      <span className={`text-[11px] font-mono font-bold ${
        shift.is_overtime ? 'text-red-400' : 'text-rmpg-200'
      }`}>
        {formatHours(shift.current_hours)}h
      </span>
      {shift.is_overtime && (
        <span className="text-[9px] font-mono text-red-400 bg-red-900/30 px-1.5 py-0.5 rounded">
          +{formatHours(shift.overtime_hours)} OT
        </span>
      )}
    </div>
  );
}

function WeeklyRow({ row, dailyBreakdown, threshold, isExpanded, onToggle }: {
  row: WeeklyBreakdown;
  dailyBreakdown: { work_date: string; total_hours: number; is_overtime: boolean; break_minutes: number }[];
  threshold: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const ratio = row.total_hours / threshold;
  const hasOT = row.overtime_hours > 0;

  return (
    <div className={`rounded border ${hasOT ? 'border-red-700/30 bg-red-950/10' : 'border-rmpg-700/50 bg-surface-raised'}`}>
      <div
        className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:brightness-110 transition"
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronUp className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
        )}
        <span className="text-[11px] text-rmpg-200 font-medium w-40 truncate">{row.officer_name}</span>
        {row.badge_number && <span className="text-[9px] font-mono text-rmpg-500">#{row.badge_number}</span>}
        {row.department && <span className="text-[9px] text-rmpg-500">{row.department}</span>}
        <div className="flex-1 mx-2">
          <div className="h-2 bg-rmpg-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${progressColor(ratio)}`}
              style={{ width: `${Math.min(100, ratio * 100)}%` }}
            />
          </div>
        </div>
        <span className="text-[10px] font-mono text-rmpg-400 w-20 text-right">
          {formatHours(row.total_hours)} / {threshold}h
        </span>
        <span className="text-[9px] text-rmpg-500 w-14 text-right">{row.shift_count} shift{row.shift_count !== 1 ? 's' : ''}</span>
        {hasOT && (
          <span className="text-[9px] font-mono text-red-400 bg-red-900/30 px-1.5 py-0.5 rounded flex-shrink-0">
            +{formatHours(row.overtime_hours)} OT
          </span>
        )}
      </div>

      {/* Expanded daily breakdown */}
      {isExpanded && dailyBreakdown.length > 0 && (
        <div className="border-t border-rmpg-700/50 px-4 py-2 space-y-1">
          <div className="flex items-center gap-2 text-[9px] text-rmpg-500 uppercase tracking-wider font-bold mb-1">
            <span className="w-28">Date</span>
            <span className="flex-1">Hours</span>
            <span className="w-14 text-right">Break</span>
            <span className="w-14 text-right">Total</span>
          </div>
          {dailyBreakdown.map((day) => (
            <div
              key={day.work_date}
              className={`flex items-center gap-2 text-[10px] py-0.5 ${
                day.is_overtime ? 'text-red-400' : 'text-rmpg-300'
              }`}
            >
              <span className="w-28 text-rmpg-400">{formatDate(day.work_date)}</span>
              <div className="flex-1">
                <div className="h-1.5 bg-rmpg-700 rounded-full overflow-hidden max-w-[200px]">
                  <div
                    className={`h-full rounded-full ${progressColor(day.total_hours / 8)}`}
                    style={{ width: `${Math.min(100, (day.total_hours / 12) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="w-14 text-right font-mono text-rmpg-500">{day.break_minutes}m</span>
              <span className={`w-14 text-right font-mono font-bold ${day.is_overtime ? 'text-red-400' : ''}`}>
                {formatHours(day.total_hours)}h
              </span>
              {day.is_overtime && (
                <span className="text-[8px] text-red-400 ml-1">OT</span>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 text-[10px] pt-1 border-t border-rmpg-700/50 font-bold">
            <span className="w-28 text-rmpg-300">Week Total</span>
            <div className="flex-1" />
            <span className="w-14 text-right font-mono text-rmpg-400">{row.total_break_minutes}m</span>
            <span className={`w-14 text-right font-mono ${hasOT ? 'text-red-400' : 'text-rmpg-200'}`}>
              {formatHours(row.total_hours)}h
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
