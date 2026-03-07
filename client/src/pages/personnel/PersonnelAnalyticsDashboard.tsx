import React from 'react';
import {
  Users, UserCheck, Clock, Award, AlertTriangle, TrendingUp, GraduationCap, Loader2,
} from 'lucide-react';
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

  // Role distribution
  const roleCounts = officers.reduce((acc, o) => {
    acc[o.role] = (acc[o.role] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

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

      {/* Credential Health */}
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

      {/* Role Distribution */}
      <div className="panel-beveled p-4 bg-surface-base">
        <h4 className="field-label text-brand-400 mb-3 flex items-center gap-1.5">
          <Users className="w-3 h-3" /> Role Distribution
        </h4>
        <div className="space-y-2">
          {Object.entries(roleCounts).sort(([, a], [, b]) => b - a).map(([role, count]) => (
            <div key={role} className="flex items-center gap-3">
              <span className={`inline-flex items-center px-2 py-0.5 text-[9px] font-bold uppercase min-w-[80px] justify-center ${ROLE_COLORS[role] || ROLE_COLORS.officer}`}>
                {role}
              </span>
              <div className="flex-1 h-1.5 bg-rmpg-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full"
                  style={{ width: `${(count / officers.length) * 100}%` }}
                />
              </div>
              <span className="text-xs font-mono text-rmpg-200 w-6 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Training Overview */}
      <div className="panel-beveled p-4 bg-surface-base">
        <h4 className="field-label text-brand-400 mb-3 flex items-center gap-1.5">
          <GraduationCap className="w-3 h-3" /> Training Status
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="panel-inset p-2 text-center">
            <p className="text-lg font-bold text-white font-mono">{training.length}</p>
            <p className="field-label">Total Records</p>
          </div>
          <div className="panel-inset p-2 text-center">
            <p className="text-lg font-bold text-green-400 font-mono">{completedTraining}</p>
            <p className="field-label">Completed</p>
          </div>
          <div className="panel-inset p-2 text-center">
            <p className="text-lg font-bold text-red-400 font-mono">{overdueTraining}</p>
            <p className="field-label">Overdue</p>
          </div>
        </div>
      </div>

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

      <p className="text-[9px] text-rmpg-500 text-center pt-2">
        Select an officer from the roster to view their details
      </p>
    </div>
  );
}
