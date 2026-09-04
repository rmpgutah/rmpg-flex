// ============================================================
// RMPG Flex — Officer Detail: Deployment History Tab
// ============================================================

import { useMemo } from 'react';
import {
  MapPinned, Plus, Calendar, Clock, Briefcase, Building2,
  Loader2, CheckCircle2, AlertCircle, Timer,
} from 'lucide-react';
import type { Deployment } from '../../../types';
import { DEPLOYMENT_STATUS_COLORS } from '../utils/personnelConstants';
import { toDisplayLabel } from '../../../utils/formatters';
import { parseTimestamp } from '../../../utils/dateUtils';

interface Props {
  deployments: Deployment[];
  loading: boolean;
  onAddDeployment: (officerId: string) => void;
  officerId: string;
}

const formatDate = (d?: string) => {
  if (!d) return '-';
  return parseTimestamp(d).toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

function durationDays(start?: string, end?: string): number {
  if (!start) return 0;
  const s = parseTimestamp(start).getTime();
  const e = end ? parseTimestamp(end).getTime() : Date.now();
  return Math.max(0, Math.floor((e - s) / 86400000));
}

function formatDuration(days: number): string {
  if (days === 0) return '< 1 day';
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  const rem = days % 30;
  return rem > 0 ? `${months}mo ${rem}d` : `${months} mo`;
}

export default function DeploymentDetailTab({ deployments, loading, onAddDeployment, officerId }: Props) {
  const { current, scheduled, past } = useMemo(() => {
    const c = deployments.filter((d) => d.status === 'active');
    const s = deployments.filter((d) => d.status === 'scheduled');
    const p = deployments.filter((d) => d.status !== 'active' && d.status !== 'scheduled');
    p.sort((a, b) =>
      parseTimestamp(b.start_date).getTime() - parseTimestamp(a.start_date).getTime()
    );
    return { current: c, scheduled: s, past: p };
  }, [deployments]);

  const currentDeployment = current[0];

  const totalDaysOnFile = useMemo(
    () => deployments.reduce((sum, d) => sum + durationDays(d.start_date, d.end_date), 0),
    [deployments],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-brand-400 animate-spin" role="status" aria-label="Loading" />
        <span className="ml-2 text-xs text-rmpg-400">Loading deployment history...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-rmpg-100 flex items-center gap-1.5">
          <MapPinned className="w-3.5 h-3.5 text-brand-400" />
          Deployment History
          <span className="text-rmpg-600 font-normal text-xs">({deployments.length})</span>
        </h3>
        <button
          type="button"
          onClick={() => onAddDeployment(officerId)}
          className="toolbar-btn toolbar-btn-primary text-[10px] px-3 py-1 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          Add Deployment
        </button>
      </div>

      {/* Summary stats */}
      {deployments.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="panel-beveled p-2 text-center bg-surface-base">
            <p className="text-lg font-bold font-mono text-rmpg-100">{deployments.length}</p>
            <p className="text-[9px] text-rmpg-500 uppercase tracking-wider">Total</p>
          </div>
          <div className="panel-beveled p-2 text-center bg-surface-base">
            <p className="text-lg font-bold font-mono text-green-400">{current.length}</p>
            <p className="text-[9px] text-rmpg-500 uppercase tracking-wider">Active</p>
          </div>
          <div className="panel-beveled p-2 text-center bg-surface-base">
            <p className="text-sm font-bold font-mono text-rmpg-300">{formatDuration(totalDaysOnFile)}</p>
            <p className="text-[9px] text-rmpg-500 uppercase tracking-wider">Total Time</p>
          </div>
        </div>
      )}

      {/* Current Assignment */}
      {currentDeployment ? (
        <div
          className="panel-beveled p-3 border-l-2 border-l-green-500 border-t-2 border-t-green-500"
          style={{ background: 'color-mix(in srgb, var(--surface-sunken) 85%, transparent)' }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="led-dot led-green" />
              <span className="text-[10px] font-bold uppercase text-green-400 tracking-wider">
                Current Assignment
              </span>
            </div>
            <span className="flex items-center gap-1 text-[9px] text-green-500 font-mono">
              <Timer className="w-3 h-3" />
              {formatDuration(durationDays(currentDeployment.start_date))} on-site
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-2">
            <div>
              <p className="field-label">Property</p>
              <p className="text-xs text-rmpg-100 font-semibold flex items-center gap-1">
                <Building2 className="w-3 h-3 text-rmpg-400" />
                {currentDeployment.property_name}
              </p>
            </div>
            <div>
              <p className="field-label">Client</p>
              <p className="text-xs text-rmpg-200">{currentDeployment.client_name || '-'}</p>
            </div>
            <div>
              <p className="field-label">Position</p>
              <p className="text-xs text-rmpg-200 flex items-center gap-1">
                <Briefcase className="w-3 h-3 text-rmpg-400" />
                {currentDeployment.position}
              </p>
            </div>
            <div>
              <p className="field-label">Start Date</p>
              <p className="text-xs text-rmpg-200 font-mono flex items-center gap-1">
                <Calendar className="w-3 h-3 text-rmpg-400" />
                {formatDate(currentDeployment.start_date)}
              </p>
            </div>
            {currentDeployment.hours_per_week != null && (
              <div>
                <p className="field-label">Hours / Week</p>
                <p className="text-xs text-rmpg-200 font-mono flex items-center gap-1">
                  <Clock className="w-3 h-3 text-rmpg-400" />
                  {currentDeployment.hours_per_week} hrs
                </p>
              </div>
            )}
            {currentDeployment.end_date && (
              <div>
                <p className="field-label">End Date</p>
                <p className="text-xs text-rmpg-200 font-mono flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-rmpg-400" />
                  {formatDate(currentDeployment.end_date)}
                </p>
              </div>
            )}
          </div>

          {currentDeployment.notes && (
            <p className="text-[10px] text-rmpg-400 mt-2 italic border-t border-rmpg-700/50 pt-2">
              {currentDeployment.notes}
            </p>
          )}
        </div>
      ) : (
        <div className="panel-beveled p-3 border-l-2 border-l-amber-600/60 bg-surface-base">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
            <p className="text-xs text-amber-400 font-semibold">No active deployment</p>
          </div>
          <p className="text-[10px] text-rmpg-500 mt-1">
            This officer has no current site assignment on record.
          </p>
        </div>
      )}

      {/* Scheduled (future) deployments */}
      {scheduled.length > 0 && (
        <div className="space-y-1.5">
          <p className="field-label tracking-widest text-brand-400">Scheduled</p>
          {scheduled.map((dep) => (
            <DeploymentCard key={dep.id} dep={dep} />
          ))}
        </div>
      )}

      {/* Past deployments */}
      {past.length > 0 && (
        <div className="space-y-1.5">
          <p className="field-label tracking-widest">Past Deployments</p>
          {past.map((dep) => (
            <DeploymentCard key={dep.id} dep={dep} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {deployments.length === 0 && (
        <div className="text-center py-16" role="status">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
            <MapPinned className="w-8 h-8 text-rmpg-600" />
          </div>
          <p className="text-sm text-rmpg-400 font-medium">No deployment history for this officer</p>
          <p className="text-[10px] text-rmpg-600 mt-1">Click "Add Deployment" to assign a deployment</p>
        </div>
      )}
    </div>
  );
}

function pastBorderColor(status: string): string {
  switch (status) {
    case 'completed': return 'border-l-rmpg-500';
    case 'cancelled': return 'border-l-red-500';
    case 'scheduled': return 'border-l-brand-500';
    default: return 'border-l-rmpg-600';
  }
}

function DeploymentCard({ dep }: { dep: Deployment }) {
  const days = durationDays(dep.start_date, dep.end_date);
  return (
    <div className={`panel-beveled p-3 bg-surface-base border-l-2 ${pastBorderColor(dep.status)}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-rmpg-100 font-semibold flex items-center gap-1">
          <Building2 className="w-3 h-3 text-rmpg-400" />
          {dep.property_name}
        </span>
        <div className="flex items-center gap-2">
          {days > 0 && (
            <span className="text-[9px] text-rmpg-500 font-mono">{formatDuration(days)}</span>
          )}
          <span
            className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase ${
              DEPLOYMENT_STATUS_COLORS[dep.status] ?? DEPLOYMENT_STATUS_COLORS.completed
            }`}
          >
            {toDisplayLabel(dep.status)}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-1">
        <div>
          <p className="field-label">Client</p>
          <p className="text-[11px] text-rmpg-300">{dep.client_name || '-'}</p>
        </div>
        <div>
          <p className="field-label">Position</p>
          <p className="text-[11px] text-rmpg-300">{dep.position}</p>
        </div>
        <div>
          <p className="field-label">Date Range</p>
          <p className="font-mono text-[10px] text-rmpg-300">
            {formatDate(dep.start_date)}
            {dep.end_date ? ` — ${formatDate(dep.end_date)}` : ' — present'}
          </p>
        </div>
      </div>
      {dep.notes && (
        <p className="text-[10px] text-rmpg-400 mt-1.5 italic">{dep.notes}</p>
      )}
    </div>
  );
}
