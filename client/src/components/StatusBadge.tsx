import React from 'react';
import type { CallPriority, UnitStatus, CallStatus, IncidentStatus } from '../types';

type BadgeType = 'priority' | 'unit_status' | 'call_status' | 'incident_status';

export interface StatusBadgeProps {
  status: string;
  type?: BadgeType;
  size?: 'sm' | 'md';
  className?: string;
}

const PRIORITY_CONFIG: Record<CallPriority, { label: string; classes: string }> = {
  P1: { label: 'P1 - EMER', classes: 'bg-red-900/50 text-red-400 border border-red-700/50' },
  P2: { label: 'P2 - URG', classes: 'bg-amber-900/50 text-amber-400 border border-amber-700/50' },
  P3: { label: 'P3 - RTN', classes: 'bg-brand-900/50 text-brand-400 border border-brand-700/50' },
  P4: { label: 'P4 - SCHED', classes: 'bg-gray-700/50 text-rmpg-300 border border-rmpg-600/50' },
};

const UNIT_STATUS_CONFIG: Record<UnitStatus, { label: string; classes: string }> = {
  available: { label: 'Available', classes: 'bg-green-900/50 text-green-400 border border-green-700/50' },
  dispatched: { label: 'Dispatched', classes: 'bg-amber-900/50 text-amber-400 border border-amber-700/50' },
  enroute: { label: 'En Route', classes: 'bg-brand-900/50 text-brand-400 border border-brand-700/50' },
  onscene: { label: 'On Scene', classes: 'bg-purple-900/50 text-purple-400 border border-purple-700/50' },
  busy: { label: 'Busy', classes: 'bg-red-900/50 text-red-400 border border-red-700/50' },
  off_duty: { label: 'Off Duty', classes: 'bg-gray-700/50 text-rmpg-400 border border-rmpg-600/50' },
};

const CALL_STATUS_CONFIG: Record<CallStatus, { label: string; classes: string }> = {
  pending: { label: 'Pending', classes: 'bg-yellow-900/50 text-yellow-400 border border-yellow-700/50' },
  dispatched: { label: 'Dispatched', classes: 'bg-amber-900/50 text-amber-400 border border-amber-700/50' },
  enroute: { label: 'En Route', classes: 'bg-brand-900/50 text-brand-400 border border-brand-700/50' },
  onscene: { label: 'On Scene', classes: 'bg-purple-900/50 text-purple-400 border border-purple-700/50' },
  cleared: { label: 'Cleared', classes: 'bg-gray-600/50 text-rmpg-200 border border-gray-500/50' },
  closed: { label: 'Closed', classes: 'bg-gray-700/50 text-rmpg-400 border border-rmpg-600/50' },
  cancelled: { label: 'Cancelled', classes: 'bg-gray-700/50 text-rmpg-400 border border-rmpg-600/50' },
  archived: { label: 'Archived', classes: 'bg-slate-800/50 text-slate-400 border border-slate-600/50' },
  on_hold: { label: 'HELD', classes: 'bg-amber-900/50 text-amber-400 border border-amber-600/50 animate-pulse' },
};

const INCIDENT_STATUS_CONFIG: Record<IncidentStatus, { label: string; classes: string }> = {
  draft: { label: 'Draft', classes: 'bg-gray-700/50 text-rmpg-300 border border-rmpg-600/50' },
  submitted: { label: 'Submitted', classes: 'bg-brand-900/50 text-brand-400 border border-brand-700/50' },
  under_review: { label: 'Under Review', classes: 'bg-amber-900/50 text-amber-400 border border-amber-700/50' },
  approved: { label: 'Approved', classes: 'bg-green-900/50 text-green-400 border border-green-700/50' },
  returned: { label: 'Returned', classes: 'bg-red-900/50 text-red-400 border border-red-700/50' },
};

function getConfig(status: string, type: BadgeType) {
  switch (type) {
    case 'priority':
      return PRIORITY_CONFIG[status as CallPriority];
    case 'unit_status':
      return UNIT_STATUS_CONFIG[status as UnitStatus];
    case 'call_status':
      return CALL_STATUS_CONFIG[status as CallStatus];
    case 'incident_status':
      return INCIDENT_STATUS_CONFIG[status as IncidentStatus];
    default:
      return null;
  }
}

export default React.memo(function StatusBadge({ status, type, size = 'md', className = '' }: StatusBadgeProps) {
  const config = type ? getConfig(status, type) : null;

  if (!config) {
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold bg-gray-700 text-rmpg-300 border border-rmpg-600 ${className}`}>
        {status}
      </span>
    );
  }

  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]';

  return (
    <span
      className={`inline-flex items-center font-bold tracking-wide uppercase panel-beveled ${sizeClasses} ${config.classes} ${className}`}
    >
      {config.label}
    </span>
  );
});
