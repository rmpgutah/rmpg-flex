import React from 'react';
import type { CallPriority, UnitStatus, CallStatus, IncidentStatus } from '../types';
import {
  PRIORITY_CLASSES, PRIORITY_LABELS,
  UNIT_STATUS_CLASSES, UNIT_STATUS_LABELS,
  CALL_STATUS_CLASSES, CALL_STATUS_LABELS,
  INCIDENT_STATUS_CLASSES, INCIDENT_STATUS_LABELS,
} from '../utils/statusColors';

type BadgeType = 'priority' | 'unit_status' | 'call_status' | 'incident_status' | 'generic';

// ── Generic status color map ─────────────────────────────────
// Maps common status strings to consistent badge colors.
// Used when type='generic' or as a smart fallback when no type is provided.
const GENERIC_STATUS_MAP: Record<string, { label: string; classes: string }> = {
  // Active / positive states (green)
  active:    { label: 'Active',    classes: 'bg-green-900/50 text-green-400 border border-green-700/50' },
  approved:  { label: 'Approved',  classes: 'bg-green-900/50 text-green-400 border border-green-700/50' },
  completed: { label: 'Completed', classes: 'bg-green-900/50 text-green-400 border border-green-700/50' },
  served:    { label: 'Served',    classes: 'bg-green-900/50 text-green-400 border border-green-700/50' },
  paid:      { label: 'Paid',      classes: 'bg-green-900/50 text-green-400 border border-green-700/50' },
  resolved:  { label: 'Resolved',  classes: 'bg-green-900/50 text-green-400 border border-green-700/50' },
  verified:  { label: 'Verified',  classes: 'bg-green-900/50 text-green-400 border border-green-700/50' },
  issued:    { label: 'Issued',    classes: 'bg-green-900/50 text-green-400 border border-green-700/50' },
  // Warning / pending states (amber)
  pending:     { label: 'Pending',     classes: 'bg-amber-900/50 text-amber-400 border border-amber-700/50' },
  in_progress: { label: 'In Progress', classes: 'bg-amber-900/50 text-amber-400 border border-amber-700/50' },
  attempted:   { label: 'Attempted',   classes: 'bg-amber-900/50 text-amber-400 border border-amber-700/50' },
  scheduled:   { label: 'Scheduled',   classes: 'bg-amber-900/50 text-amber-400 border border-amber-700/50' },
  contested:   { label: 'Contested',   classes: 'bg-amber-900/50 text-amber-400 border border-amber-700/50' },
  // Danger / negative states (red)
  rejected:       { label: 'Rejected',       classes: 'bg-red-900/50 text-red-400 border border-red-700/50' },
  failed:         { label: 'Failed',         classes: 'bg-red-900/50 text-red-400 border border-red-700/50' },
  overdue:        { label: 'Overdue',        classes: 'bg-red-900/50 text-red-400 border border-red-700/50' },
  expired:        { label: 'Expired',        classes: 'bg-red-900/50 text-red-400 border border-red-700/50' },
  warrant_issued: { label: 'Warrant Issued', classes: 'bg-red-900/50 text-red-400 border border-red-700/50' },
  voided:         { label: 'Voided',         classes: 'bg-red-900/50 text-red-400 border border-red-700/50' },
  dismissed:      { label: 'Dismissed',      classes: 'bg-red-900/50 text-red-400 border border-red-700/50' },
  // Info / blue states
  open:      { label: 'Open',      classes: 'bg-brand-900/50 text-brand-400 border border-brand-700/50' },
  assigned:  { label: 'Assigned',  classes: 'bg-brand-900/50 text-brand-400 border border-brand-700/50' },
  submitted: { label: 'Submitted', classes: 'bg-brand-900/50 text-brand-400 border border-brand-700/50' },
  // Neutral / inactive (gray)
  inactive:  { label: 'Inactive',  classes: 'bg-rmpg-700/50 text-rmpg-400 border border-rmpg-600/50' },
  closed:    { label: 'Closed',    classes: 'bg-rmpg-700/50 text-rmpg-400 border border-rmpg-600/50' },
  archived:  { label: 'Archived',  classes: 'bg-rmpg-700/50 text-rmpg-400 border border-rmpg-600/50' },
  cancelled: { label: 'Cancelled', classes: 'bg-rmpg-700/50 text-rmpg-400 border border-rmpg-600/50' },
  draft:     { label: 'Draft',     classes: 'bg-rmpg-700/50 text-rmpg-300 border border-rmpg-600/50' },
  unpaid:    { label: 'Unpaid',    classes: 'bg-rmpg-700/50 text-rmpg-300 border border-rmpg-600/50' },
};

export interface StatusBadgeProps {
  status: string;
  type?: BadgeType;
  size?: 'sm' | 'md';
  className?: string;
}

function getConfig(status: string, type: BadgeType): { label: string; classes: string } | null {
  switch (type) {
    case 'priority': {
      const p = status as CallPriority;
      return PRIORITY_CLASSES[p] ? { label: PRIORITY_LABELS[p], classes: PRIORITY_CLASSES[p] } : null;
    }
    case 'unit_status': {
      const u = status as UnitStatus;
      return UNIT_STATUS_CLASSES[u] ? { label: UNIT_STATUS_LABELS[u], classes: UNIT_STATUS_CLASSES[u] } : null;
    }
    case 'call_status': {
      const c = status as CallStatus;
      return CALL_STATUS_CLASSES[c] ? { label: CALL_STATUS_LABELS[c], classes: CALL_STATUS_CLASSES[c] } : null;
    }
    case 'incident_status': {
      const i = status as IncidentStatus;
      return INCIDENT_STATUS_CLASSES[i] ? { label: INCIDENT_STATUS_LABELS[i], classes: INCIDENT_STATUS_CLASSES[i] } : null;
    }
    case 'generic': {
      const key = status.toLowerCase().replace(/\s+/g, '_');
      return GENERIC_STATUS_MAP[key] || null;
    }
    default:
      return null;
  }
}

/** Try to resolve a generic color for a status string (used in no-type fallback). */
function getGenericFallback(status: string): { label: string; classes: string } | null {
  const key = status.toLowerCase().replace(/\s+/g, '_');
  return GENERIC_STATUS_MAP[key] || null;
}

export default React.memo(function StatusBadge({ status, type, size = 'md', className = '' }: StatusBadgeProps) {
  const config = type ? getConfig(status, type) : getGenericFallback(status);

  {/* 15: Consistent badge sizing with min-width for uniform appearance; 16: Leading-none for tight badges */}
  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5 text-[9px] leading-none' : 'px-2 py-0.5 text-[10px] leading-tight';

  if (!config) {
    // Unknown status -- render with neutral gray styling
    const label = status.replace(/_/g, ' ');
    {/* 17: Whitespace-nowrap on unknown badges to prevent wrapping */}
    return (
      <span className={`inline-flex items-center font-bold tracking-wide uppercase whitespace-nowrap panel-beveled ${sizeClasses} bg-rmpg-700 text-rmpg-300 border border-rmpg-600 ${className}`} role="status" aria-label={`Status: ${label}`}>
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center font-bold tracking-wide uppercase whitespace-nowrap panel-beveled transition-colors duration-150 ${sizeClasses} ${config.classes} ${className}`}
      role="status"
      aria-label={`Status: ${config.label}`}
    >
      {config.label}
    </span>
  );
});
