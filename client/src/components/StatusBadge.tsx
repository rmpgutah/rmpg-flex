import React from 'react';
import type { CallPriority, UnitStatus, CallStatus, IncidentStatus } from '../types';
import {
  PRIORITY_CLASSES, PRIORITY_LABELS,
  UNIT_STATUS_CLASSES, UNIT_STATUS_LABELS,
  CALL_STATUS_CLASSES, CALL_STATUS_LABELS,
  INCIDENT_STATUS_CLASSES, INCIDENT_STATUS_LABELS,
} from '../utils/statusColors';

type BadgeType = 'priority' | 'unit_status' | 'call_status' | 'incident_status';

interface StatusBadgeProps {
  status: string;
  type: BadgeType;
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
    default:
      return null;
  }
}

export default React.memo(function StatusBadge({ status, type, size = 'md', className = '' }: StatusBadgeProps) {
  const config = getConfig(status, type);

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
