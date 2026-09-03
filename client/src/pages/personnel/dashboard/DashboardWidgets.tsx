// ============================================================
// RMPG Flex — Personnel: Reusable Dashboard Widgets
// ------------------------------------------------------------
// Presentational chart/panel building blocks shared by the
// Command dashboard (PersonnelDashboard.tsx). Each widget takes
// already-fetched data via props; the two "live" panels at the
// bottom own their own apiFetch and degrade to null on failure.
// Extracted from the former PersonnelAnalyticsDashboard.
// ============================================================

import { useMemo, useState, useEffect } from 'react';
import { Award, Users, GraduationCap, Clock, Shield } from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import { apiFetch } from '../../../hooks/useApi';
import { dateToLocalYMD } from '../../../utils/dateUtils';
import { formatEnumValue, toDisplayLabel } from '../../../utils/formatters';
import type { Credential, TimeEntry, TrainingRecord } from '../../../types';
import type { OfficerWithStatus } from '../utils/personnelMappers';

// Brand-aligned role colors (zero-blue Spillman palette)
export const ROLE_HEX: Record<string, string> = {
  admin: 'var(--sev-critical)', manager: 'var(--stat-accent-purple)', supervisor: 'var(--sev-warn)',
  officer: 'var(--sev-ok)', dispatcher: 'var(--text-secondary)', contract_manager: 'var(--sev-ok)',
};

export const ChartTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--surface-deep)', border: '1px solid var(--border-default)', padding: '6px 10px', borderRadius: 2 }}>
      <div style={{ color: 'var(--text-primary)', fontSize: 10, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }}>
        {payload[0].name}: {payload[0].value}
      </div>
    </div>
  );
};

// ── Credential Compliance (bar + donut + valid/expiring/expired) ──
export function CredentialComplianceCard({ credentials }: { credentials: Credential[] }) {
  const expiredCreds = credentials.filter(c => c.status === 'expired').length;
  const expiringCreds = credentials.filter(c => c.status === 'expiring_soon').length;
  const validCreds = credentials.filter(c => c.status === 'valid').length;
  const credCompliance = credentials.length > 0 ? Math.round((validCreds / credentials.length) * 100) : 100;

  const credPieData = useMemo(() => [
    { name: 'Valid', value: validCreds, color: 'var(--sev-ok)' },
    { name: 'Expiring', value: expiringCreds, color: 'var(--sev-warn)' },
    { name: 'Expired', value: expiredCreds, color: 'var(--sev-critical)' },
  ].filter(d => d.value > 0), [validCreds, expiringCreds, expiredCreds]);

  return (
    <div className="panel-beveled p-4 bg-surface-base">
      <h4 className="field-label text-brand-400 mb-3 flex items-center gap-1.5">
        <Award className="w-3 h-3" /> Credential Compliance
      </h4>
      <div className="flex items-center gap-4 mb-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-rmpg-300">Compliance Rate</span>
            <span className={`text-sm font-bold font-mono ${credCompliance >= 90 ? 'text-green-400' : credCompliance >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
              {credCompliance}%
            </span>
          </div>
          <div className="h-2 bg-rmpg-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${credCompliance >= 90 ? 'bg-green-500' : credCompliance >= 70 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${credCompliance}%` }}
            />
          </div>
        </div>
        {credPieData.length > 0 && (
          <div className="w-[90px] h-[90px] flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={credPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={25} outerRadius={40} strokeWidth={0}>
                  {credPieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="panel-inset p-2 text-center">
          <p className="text-lg font-bold text-green-400 font-mono">{validCreds}</p>
          <p className="field-label">Valid</p>
        </div>
        <div className="panel-inset p-2 text-center">
          <p className="text-lg font-bold text-amber-400 font-mono">{expiringCreds}</p>
          <p className="field-label">Expiring</p>
        </div>
        <div className="panel-inset p-2 text-center">
          <p className="text-lg font-bold text-red-400 font-mono">{expiredCreds}</p>
          <p className="field-label">Expired</p>
        </div>
      </div>
    </div>
  );
}

// ── Role Distribution (donut + legend) ──
export function RoleDistributionCard({ officers }: { officers: OfficerWithStatus[] }) {
  const roleData = useMemo(() => {
    const counts = officers.reduce((acc, o) => {
      acc[o.role] = (acc[o.role] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(counts).sort(([, a], [, b]) => b - a).map(([role, count]) => ({ name: role, value: count }));
  }, [officers]);

  return (
    <div className="panel-beveled p-4 bg-surface-base">
      <h4 className="field-label text-brand-400 mb-3 flex items-center gap-1.5">
        <Users className="w-3 h-3" /> Role Distribution
      </h4>
      {roleData.length > 0 ? (
        <div className="flex items-center gap-4">
          <div className="w-[140px] h-[140px] flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={roleData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={70} strokeWidth={0} paddingAngle={2}>
                  {roleData.map((d, i) => <Cell key={i} fill={ROLE_HEX[d.name] || 'var(--text-muted)'} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-1.5">
            {roleData.map(d => (
              <div key={d.name} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: ROLE_HEX[d.name] || 'var(--text-muted)' }} />
                <span className="text-rmpg-200 capitalize flex-1">{toDisplayLabel(d.name)}</span>
                <span className="font-mono text-rmpg-100">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-rmpg-500 text-center py-4">No personnel data</p>
      )}
    </div>
  );
}

// ── Training Status (horizontal bar) ──
export function TrainingStatusCard({ training }: { training: TrainingRecord[] }) {
  const completedTraining = training.filter(t => t.status === 'completed').length;
  const overdueTraining = training.filter(t => t.status === 'overdue').length;
  const pendingTraining = training.length - completedTraining - overdueTraining;

  const trainingBarData = useMemo(() => [
    { name: 'Completed', value: completedTraining, fill: 'var(--sev-ok)' },
    { name: 'Overdue', value: overdueTraining, fill: 'var(--sev-critical)' },
    { name: 'Pending', value: Math.max(0, pendingTraining), fill: 'var(--text-muted)' },
  ], [completedTraining, overdueTraining, pendingTraining]);

  return (
    <div className="panel-beveled p-4 bg-surface-base">
      <h4 className="field-label text-brand-400 mb-3 flex items-center gap-1.5">
        <GraduationCap className="w-3 h-3" /> Training Status
      </h4>
      {training.length > 0 ? (
        <div className="h-[120px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trainingBarData} layout="vertical" margin={{ left: 60, right: 10, top: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'Arial, sans-serif' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} axisLine={false} tickLine={false} width={55} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="value" radius={[0, 2, 2, 0]}>
                {trainingBarData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-xs text-rmpg-500 text-center py-6">No training records</p>
      )}
    </div>
  );
}

// ── Hours — Last 7 Days (area) ──
export function HoursTrendCard({ timeEntries }: { timeEntries: TimeEntry[] }) {
  const hoursByDay = useMemo(() => {
    const days: Record<string, number> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i); // new-date-ok: cloning a Date, not parsing a server string
      days[dateToLocalYMD(d)] = 0;
    }
    timeEntries.forEach(t => {
      const date = (t.clock_in || '').slice(0, 10);
      if (date in days) days[date] += t.total_hours || 0;
    });
    return Object.entries(days).map(([date, hours]) => ({ date: date.slice(5), hours: Math.round(hours * 10) / 10 }));
  }, [timeEntries]);

  const hasHoursData = hoursByDay.some(d => d.hours > 0);
  if (!hasHoursData) return null;

  return (
    <div className="panel-beveled p-4 bg-surface-base">
      <h4 className="field-label text-brand-400 mb-3 flex items-center gap-1.5">
        <Clock className="w-3 h-3" /> Hours — Last 7 Days
      </h4>
      <div className="h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={hoursByDay} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
            <defs>
              {/* Brand-gold gradient sourced from the theme CSS variable so
                  light/dark/legacy palette swaps stay in sync — Recharts SVG
                  resolves CSS custom properties via paint-attr inheritance. */}
              <linearGradient id="hoursGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--brand-gold)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="var(--brand-gold)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'Arial, sans-serif' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'Arial, sans-serif' }} axisLine={false} tickLine={false} width={30} />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="hours" name="Hours" stroke="var(--brand-gold)" fill="url(#hoursGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Live: Duty Hours (14-day) — self-fetching, renders null when empty ──
interface DutyHoursData {
  entries: { officer_id: number; officer_name: string; total_hours: number; total_overtime: number; shifts_completed: number }[];
  totals?: { totalHours: number; totalOfficers: number };
  flagged_excessive_hours?: { officer_id: number; officer_name: string; total_hours: number }[];
}

export function DutyHoursPanel() {
  const [data, setData] = useState<DutyHoursData | null>(null);
  useEffect(() => {
    apiFetch<DutyHoursData>('/api/personnel/duty-hours?period=14')
      .then((d) => d && setData(d))
      .catch((err) => console.warn('[Personnel] Duty hours fetch failed:', err?.message));
  }, []);
  if (!data?.entries?.length) return null;
  const flagged = data.flagged_excessive_hours || [];
  return (
    <div className="panel-beveled p-3">
      <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
        <Clock className="w-3 h-3" /> Duty Hours (14 Day Period)
        {flagged.length > 0 && (
          <span className="ml-auto text-[8px] bg-red-900/30 text-red-400 px-1.5 py-0.5 rounded">{flagged.length} excessive</span>
        )}
      </h4>
      <div className="space-y-0.5 max-h-[140px] overflow-y-auto scrollbar-dark">
        {data.entries.slice(0, 10).map((o) => (
          <div key={o.officer_id} className="flex items-center justify-between px-2 py-0.5 bg-surface-sunken rounded text-[9px]">
            <span className="text-rmpg-200 min-w-0 flex-1 truncate">{o.officer_name}</span>
            <span className="font-mono text-rmpg-400 w-12 text-right">{o.total_hours}h</span>
            <span className="font-mono text-amber-400 w-14 text-right">{o.total_overtime}h OT</span>
            <span className="text-rmpg-500 w-14 text-right">{o.shifts_completed} shifts</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Live: Certification Warnings — self-fetching, renders null when empty ──
interface CertWarningsData {
  summary: { expired: number; within_30: number; within_60: number; within_90: number };
  warnings: { credential_id: number; officer_name: string; credential_type: string; days_until: number; severity: string }[];
}

export function CertWarningsPanel() {
  const [data, setData] = useState<CertWarningsData | null>(null);
  useEffect(() => {
    apiFetch<CertWarningsData>('/api/personnel/cert-expiration-warnings')
      .then((d) => d && setData(d))
      .catch((err) => console.warn('[Personnel] Cert warnings fetch failed:', err?.message));
  }, []);
  if (!data?.warnings?.length) return null;
  return (
    <div className="panel-beveled p-3">
      <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
        <Shield className="w-3 h-3 text-amber-400" /> Certification Warnings
      </h4>
      <div className="grid grid-cols-4 gap-1 mb-2">
        <div className="text-center p-1 bg-red-900/20 rounded"><span className="text-xs font-bold text-red-400">{data.summary.expired}</span><div className="text-[7px] text-rmpg-500">Expired</div></div>
        <div className="text-center p-1 bg-red-900/10 rounded"><span className="text-xs font-bold text-red-300">{data.summary.within_30}</span><div className="text-[7px] text-rmpg-500">30d</div></div>
        <div className="text-center p-1 bg-amber-900/10 rounded"><span className="text-xs font-bold text-amber-400">{data.summary.within_60}</span><div className="text-[7px] text-rmpg-500">60d</div></div>
        <div className="text-center p-1 bg-surface-sunken/10 rounded"><span className="text-xs font-bold text-rmpg-400">{data.summary.within_90}</span><div className="text-[7px] text-rmpg-500">90d</div></div>
      </div>
      <div className="space-y-0.5 max-h-[120px] overflow-y-auto scrollbar-dark">
        {data.warnings.slice(0, 8).map((w) => (
          <div key={w.credential_id} className="flex items-center justify-between px-2 py-0.5 bg-surface-sunken rounded text-[9px]">
            <span className="text-rmpg-200 min-w-0 flex-1 truncate">{w.officer_name}</span>
            <span className="text-rmpg-400 min-w-0 flex-1 truncate">{formatEnumValue(w.credential_type)}</span>
            <span className={`font-mono ${w.severity === 'expired' ? 'text-red-400' : w.severity === 'critical' ? 'text-red-300' : 'text-amber-400'}`}>
              {w.days_until < 0 ? `${Math.abs(w.days_until)}d overdue` : `${w.days_until}d`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
