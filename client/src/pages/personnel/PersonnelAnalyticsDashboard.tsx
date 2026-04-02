import React, { useMemo, useState, useEffect } from 'react';
import {
  Users, UserCheck, Clock, Award, AlertTriangle, TrendingUp, GraduationCap, Bell, Shield,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { dateToLocalYMD } from '../../utils/dateUtils';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area,
} from 'recharts';
import type { Credential, TimeEntry, TrainingRecord } from '../../types';
import type { OfficerWithStatus } from './utils/personnelMappers';
import { ROLE_COLORS } from './utils/personnelConstants';
import { toDisplayLabel } from '../../utils/formatters';

interface Props {
  officers: OfficerWithStatus[];
  credentials: Credential[];
  timeEntries: TimeEntry[];
  training: TrainingRecord[];
}

const ROLE_HEX: Record<string, string> = {
  admin: '#ef4444', manager: '#f59e0b', supervisor: '#888888',
  officer: '#22c55e', dispatcher: '#a855f7', contract_manager: '#22c55e',
};

const ChartTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#050505', border: '1px solid #1e2a3a', padding: '6px 10px', borderRadius: 2 }}>
      <div style={{ color: '#e5e7eb', fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold' }}>
        {payload[0].name}: {payload[0].value}
      </div>
    </div>
  );
};

export default function PersonnelAnalyticsDashboard({ officers, credentials, timeEntries, training }: Props) {
  const onDuty = officers.filter(o => o.status === 'on_duty').length;
  const clockedIn = timeEntries.filter(t => t.status === 'clocked_in').length;
  const totalHours = timeEntries.reduce((s, t) => s + (t.total_hours || 0), 0);
  const expiredCreds = credentials.filter(c => c.status === 'expired').length;
  const expiringCreds = credentials.filter(c => c.status === 'expiring_soon').length;
  const validCreds = credentials.filter(c => c.status === 'valid').length;
  const credCompliance = credentials.length > 0 ? Math.round((validCreds / credentials.length) * 100) : 100;
  const completedTraining = training.filter(t => t.status === 'completed').length;
  const overdueTraining = training.filter(t => t.status === 'overdue').length;
  const pendingTraining = training.length - completedTraining - overdueTraining;

  // Role distribution for PieChart
  const roleCounts = officers.reduce((acc, o) => {
    acc[o.role] = (acc[o.role] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const roleData = useMemo(() =>
    Object.entries(roleCounts).sort(([, a], [, b]) => b - a).map(([role, count]) => ({
      name: role, value: count,
    })), [officers]);

  const credPieData = useMemo(() => [
    { name: 'Valid', value: validCreds, color: '#22c55e' },
    { name: 'Expiring', value: expiringCreds, color: '#f59e0b' },
    { name: 'Expired', value: expiredCreds, color: '#ef4444' },
  ].filter(d => d.value > 0), [validCreds, expiringCreds, expiredCreds]);

  const trainingBarData = useMemo(() => [
    { name: 'Completed', value: completedTraining, fill: '#22c55e' },
    { name: 'Overdue', value: overdueTraining, fill: '#ef4444' },
    { name: 'Pending', value: Math.max(0, pendingTraining), fill: '#6b7280' },
  ], [completedTraining, overdueTraining, pendingTraining]);

  // Hours by day for AreaChart (last 7 days)
  const hoursByDay = useMemo(() => {
    const days: Record<string, number> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      days[dateToLocalYMD(d)] = 0;
    }
    timeEntries.forEach(t => {
      const date = (t.clock_in || '').slice(0, 10);
      if (date in days) days[date] += t.total_hours || 0;
    });
    return Object.entries(days).map(([date, hours]) => ({
      date: date.slice(5), hours: Math.round(hours * 10) / 10,
    }));
  }, [timeEntries]);

  const hasHoursData = hoursByDay.some(d => d.hours > 0);

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <h3 className="text-xs font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2">
        <TrendingUp className="w-3.5 h-3.5 text-brand-400" />
        Personnel Overview
      </h3>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="panel-beveled p-3 text-center bg-surface-base border-t-2 border-t-brand-500">
          <Users className="w-4 h-4 mx-auto text-brand-400 mb-1" />
          <p className="text-xl font-bold font-mono text-white">{officers.length}</p>
          <p className="field-label">Total Personnel</p>
        </div>
        <div className="panel-beveled p-3 text-center bg-surface-base border-t-2 border-t-green-500">
          <UserCheck className="w-4 h-4 mx-auto text-green-400 mb-1" />
          <p className="text-xl font-bold font-mono text-green-400">{onDuty}</p>
          <p className="field-label">On Duty</p>
        </div>
        <div className="panel-beveled p-3 text-center bg-surface-base border-t-2 border-t-blue-500">
          <Clock className="w-4 h-4 mx-auto text-brand-400 mb-1" />
          <p className="text-xl font-bold font-mono text-brand-400">{clockedIn}</p>
          <p className="field-label">Clocked In</p>
        </div>
        <div className="panel-beveled p-3 text-center bg-surface-base border-t-2 border-t-rmpg-500">
          <Clock className="w-4 h-4 mx-auto text-white mb-1" />
          <p className="text-xl font-bold font-mono text-white">{totalHours.toFixed(0)}</p>
          <p className="field-label">Period Hours</p>
        </div>
      </div>

      {/* Credential Health — compliance bar + pie chart */}
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

      {/* Role Distribution — Donut PieChart */}
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
                    {roleData.map((d, i) => <Cell key={i} fill={ROLE_HEX[d.name] || '#6b7280'} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-1.5">
              {roleData.map(d => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: ROLE_HEX[d.name] || '#6b7280' }} />
                  <span className="text-rmpg-200 capitalize flex-1">{d.name.replace('_', ' ')}</span>
                  <span className="font-mono text-white">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-rmpg-500 text-center py-4">No personnel data</p>
        )}
      </div>

      {/* Training Status — BarChart */}
      <div className="panel-beveled p-4 bg-surface-base">
        <h4 className="field-label text-brand-400 mb-3 flex items-center gap-1.5">
          <GraduationCap className="w-3 h-3" /> Training Status
        </h4>
        {training.length > 0 ? (
          <div className="h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trainingBarData} layout="vertical" margin={{ left: 60, right: 10, top: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#d1d5db', fontSize: 10 }} axisLine={false} tickLine={false} width={55} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="value" radius={[0, 2, 2, 0]}>
                  {trainingBarData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="panel-inset p-2 text-center">
              <p className="text-lg font-bold text-white font-mono">0</p>
              <p className="field-label">Total Records</p>
            </div>
          </div>
        )}
      </div>

      {/* Hours Distribution — AreaChart (last 7 days) */}
      {hasHoursData && (
        <div className="panel-beveled p-4 bg-surface-base">
          <h4 className="field-label text-brand-400 mb-3 flex items-center gap-1.5">
            <Clock className="w-3 h-3" /> Hours — Last 7 Days
          </h4>
          <div className="h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hoursByDay} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="hoursGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#888888" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#888888" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} width={30} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="hours" name="Hours" stroke="#888888" fill="url(#hoursGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Credential Alerts */}
      {(expiredCreds > 0 || expiringCreds > 0) && (
        <div className="panel-beveled p-3 border-l-2 border-l-amber-500 bg-[#1a1a0a]">
          <h4 className="field-label text-amber-400 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> Credential Alerts
          </h4>
          <div className="space-y-1.5">
            {credentials.filter(c => c.status === 'expired' || c.status === 'expiring_soon').slice(0, 5).map(cred => (
              <div key={cred.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={cred.status === 'expired' ? 'led-dot led-red' : 'led-dot led-amber'} />
                  <span className="text-rmpg-200">{cred.officer_name}</span>
                  <span className="text-rmpg-400">-</span>
                  <span className="text-rmpg-300">{toDisplayLabel(cred.type)}</span>
                </div>
                <span className={`text-[10px] font-mono ${cred.status === 'expired' ? 'text-red-400' : 'text-amber-400'}`}>
                  {cred.expiry_date || 'No expiry'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Enhanced: Duty Hours & Cert Warnings */}
      <DutyHoursPanel />
      <CertWarningsPanel />

      <p className="text-[9px] text-rmpg-500 text-center pt-2">
        Select an officer from the roster to view their details
      </p>
    </div>
  );
}

function DutyHoursPanel() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    apiFetch('/api/personnel/duty-hours?period=14').then((d: any) => d && setData(d)).catch(() => {});
  }, []);
  if (!data?.officers?.length) return null;
  const flagged = data.flagged_excessive_hours || [];
  return (
    <div className="panel-beveled p-3">
      <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
        <Clock className="w-3 h-3" /> Duty Hours (14 Day Period)
        {flagged.length > 0 && (
          <span className="ml-auto text-[8px] bg-red-900/30 text-red-400 px-1.5 py-0.5 rounded">{flagged.length} excessive</span>
        )}
      </h4>
      <div className="space-y-0.5 max-h-[120px] overflow-y-auto">
        {data.officers.slice(0, 10).map((o: any) => (
          <div key={o.officer_id} className="flex items-center justify-between px-2 py-0.5 bg-surface-sunken rounded text-[9px]">
            <span className="text-rmpg-200">{o.officer_name}</span>
            <span className="font-mono text-cyan-400">{o.total_hours}h</span>
            <span className="font-mono text-amber-400">{o.total_overtime}h OT</span>
            <span className="text-rmpg-500">{o.shift_count} shifts</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CertWarningsPanel() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    apiFetch('/api/personnel/cert-expiration-warnings').then((d: any) => d && setData(d)).catch(() => {});
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
        <div className="text-center p-1 bg-blue-900/10 rounded"><span className="text-xs font-bold text-blue-400">{data.summary.within_90}</span><div className="text-[7px] text-rmpg-500">90d</div></div>
      </div>
      <div className="space-y-0.5 max-h-[100px] overflow-y-auto">
        {data.warnings.slice(0, 8).map((w: any) => (
          <div key={w.credential_id} className="flex items-center justify-between px-2 py-0.5 bg-surface-sunken rounded text-[9px]">
            <span className="text-rmpg-200">{w.officer_name}</span>
            <span className="text-rmpg-400">{w.credential_type}</span>
            <span className={`font-mono ${w.severity === 'expired' ? 'text-red-400' : w.severity === 'critical' ? 'text-red-300' : 'text-amber-400'}`}>
              {w.days_until < 0 ? `${Math.abs(w.days_until)}d overdue` : `${w.days_until}d`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
