// ============================================================
// RMPG Flex — Personnel: Analytics Dashboard Tab
// ============================================================

import React from 'react';
import {
  Users, UserCheck, Radio, Clock, Calendar, UserPlus, UserMinus,
  Loader2, BarChart3, TrendingUp, PieChart as PieChartIcon, ShieldCheck,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { PersonnelAnalytics } from '../../../types';
import { CHART_TOOLTIP_STYLE } from '../utils/personnelConstants';
import { toDisplayLabel } from '../../../utils/formatters';

interface Props {
  analytics: PersonnelAnalytics | null;
  loading: boolean;
}

const AXIS_TICK = { fill: '#5a6e80', fontSize: 9 };
const GRID_STROKE = '#162236';
const BRAND_500 = '#1a5a9e';
const OVERTIME_COLOR = '#f59e0b';

export default function AnalyticsTab({ analytics, loading }: Props) {
  if (loading || !analytics) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
        <span className="ml-2 text-xs text-rmpg-400">Loading analytics...</span>
      </div>
    );
  }

  const { headcount_summary: hc, credential_compliance: cc } = analytics;

  const headcountCards: { label: string; value: string | number; icon: React.ElementType; color: string; topBorder: string }[] = [
    { label: 'Total Personnel', value: hc.total_personnel, icon: Users, color: 'text-rmpg-100', topBorder: 'border-t-rmpg-500' },
    { label: 'Active', value: hc.active, icon: UserCheck, color: 'text-green-400', topBorder: 'border-t-green-500' },
    { label: 'On Duty', value: hc.on_duty, icon: Radio, color: 'text-green-400', topBorder: 'border-t-green-500' },
    { label: 'Clocked In', value: hc.clocked_in, icon: Clock, color: 'text-blue-400', topBorder: 'border-t-blue-500' },
    { label: 'Avg Tenure', value: `${hc.avg_tenure_years.toFixed(1)}y`, icon: Calendar, color: 'text-rmpg-200', topBorder: 'border-t-rmpg-500' },
    { label: 'New Hires (30d)', value: hc.new_hires_30d, icon: UserPlus, color: 'text-cyan-400', topBorder: 'border-t-cyan-500' },
    { label: 'Terminations (30d)', value: hc.terminations_30d, icon: UserMinus, color: 'text-red-400', topBorder: 'border-t-red-500' },
  ];

  const complianceRate = cc.compliance_rate;
  const complianceTotal = cc.valid + cc.expiring_soon + cc.expired;
  const validPct = complianceTotal > 0 ? (cc.valid / complianceTotal) * 100 : 0;
  const expiringPct = complianceTotal > 0 ? (cc.expiring_soon / complianceTotal) * 100 : 0;
  const expiredPct = complianceTotal > 0 ? (cc.expired / complianceTotal) * 100 : 0;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Headcount Summary Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {headcountCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={`panel-beveled p-2.5 text-center bg-surface-base border-t-2 ${card.topBorder}`}>
              <Icon className={`w-3.5 h-3.5 mx-auto mb-1 ${card.color}`} />
              <p className={`text-sm font-bold font-mono ${card.color}`}>{card.value}</p>
              <p className="text-[7px] uppercase text-rmpg-400 font-bold tracking-wider">{card.label}</p>
            </div>
          );
        })}
      </div>

      {/* Divider between headcount cards and charts */}
      <div className="panel-inset h-px" />

      {/* Charts Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Hours Trend */}
        <div className="panel-beveled p-4 bg-surface-base">
          <div className="flex items-center gap-1.5 mb-3">
            <TrendingUp className="w-3 h-3 text-brand-400" />
            <h3 className="text-[10px] uppercase text-rmpg-300 font-bold tracking-wider">Hours Trend</h3>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={analytics.hours_trend}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="month" tick={AXIS_TICK} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Line
                type="monotone"
                dataKey="total_hours"
                stroke={BRAND_500}
                strokeWidth={2}
                dot={{ r: 2, fill: BRAND_500 }}
                name="Total Hours"
              />
              <Line
                type="monotone"
                dataKey="overtime_hours"
                stroke={OVERTIME_COLOR}
                strokeWidth={2}
                dot={{ r: 2, fill: OVERTIME_COLOR }}
                name="Overtime Hours"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Attendance Patterns */}
        <div className="panel-beveled p-4 bg-surface-base">
          <div className="flex items-center gap-1.5 mb-3">
            <BarChart3 className="w-3 h-3 text-brand-400" />
            <h3 className="text-[10px] uppercase text-rmpg-300 font-bold tracking-wider">Attendance Patterns</h3>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={analytics.attendance_patterns}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="day_of_week" tick={AXIS_TICK} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Bar dataKey="avg_hours" fill={BRAND_500} radius={[2, 2, 0, 0]} name="Avg Hours" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Role Distribution */}
        <div className="panel-beveled p-4 bg-surface-base">
          <div className="flex items-center gap-1.5 mb-3">
            <PieChartIcon className="w-3 h-3 text-brand-400" />
            <h3 className="text-[10px] uppercase text-rmpg-300 font-bold tracking-wider">Role Distribution</h3>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={analytics.role_distribution}
                dataKey="count"
                nameKey="role"
                cx="50%"
                cy="50%"
                outerRadius={70}
                innerRadius={35}
                paddingAngle={2}
                strokeWidth={0}
              >
                {analytics.role_distribution.map((entry, idx) => (
                  <Cell key={`cell-${idx}`} fill={entry.color || BRAND_500} />
                ))}
              </Pie>
              <Tooltip {...CHART_TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-2">
            {analytics.role_distribution.map((entry) => (
              <div key={entry.role} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color || BRAND_500 }} />
                <span className="text-[9px] text-rmpg-400">{toDisplayLabel(entry.role)}</span>
                <span className="text-[9px] text-rmpg-500 font-mono">({entry.count})</span>
              </div>
            ))}
          </div>
        </div>

        {/* Credential Compliance */}
        <div className="panel-beveled p-4 bg-surface-base">
          <div className="flex items-center gap-1.5 mb-3">
            <ShieldCheck className="w-3 h-3 text-brand-400" />
            <h3 className="text-[10px] uppercase text-rmpg-300 font-bold tracking-wider">Credential Compliance</h3>
          </div>

          {/* Gauge display */}
          <div className="flex flex-col items-center py-4">
            <div className="relative w-28 h-28">
              <svg viewBox="0 0 120 120" className="w-full h-full">
                {/* Background circle */}
                <circle cx="60" cy="60" r="50" fill="none" stroke="#162236" strokeWidth="10" />
                {/* Progress arc */}
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  fill="none"
                  stroke={complianceRate >= 90 ? '#22c55e' : complianceRate >= 70 ? '#f59e0b' : '#ef4444'}
                  strokeWidth="10"
                  strokeDasharray={`${(complianceRate / 100) * 314.16} 314.16`}
                  strokeLinecap="round"
                  transform="rotate(-90 60 60)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold font-mono text-rmpg-100">{complianceRate.toFixed(0)}%</span>
                <span className="text-[8px] uppercase text-rmpg-400 font-bold">Compliant</span>
              </div>
            </div>
          </div>

          {/* Progress bar segments */}
          <div className="space-y-2 mt-2">
            <div className="w-full h-2 rounded-full overflow-hidden flex" style={{ background: '#162236' }}>
              <div className="h-full bg-green-500" style={{ width: `${validPct}%` }} />
              <div className="h-full bg-amber-500" style={{ width: `${expiringPct}%` }} />
              <div className="h-full bg-red-500" style={{ width: `${expiredPct}%` }} />
            </div>
            <div className="flex justify-between text-[9px]">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-rmpg-400">Valid</span>
                <span className="text-rmpg-200 font-mono">{cc.valid}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-rmpg-400">Expiring</span>
                <span className="text-rmpg-200 font-mono">{cc.expiring_soon}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-rmpg-400">Expired</span>
                <span className="text-rmpg-200 font-mono">{cc.expired}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
