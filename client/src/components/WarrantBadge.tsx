import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface WarrantBadgeProps {
  flags?: string | any[];
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  personId?: number;
}

export default function WarrantBadge({ flags, size = 'sm', onClick }: WarrantBadgeProps) {
  let warrantCount = 0;
  let severity = 'unknown';

  if (typeof flags === 'string') {
    try {
      const parsed = JSON.parse(flags);
      if (Array.isArray(parsed)) {
        const wf = parsed.find((f: any) => (typeof f === 'object' ? f.type : f) === 'warrant_flag');
        if (wf && typeof wf === 'object') {
          warrantCount = wf.count || 1;
          severity = wf.severity || 'unknown';
        } else if (wf) {
          warrantCount = 1;
        }
      }
    } catch { /* ignore */ }
  } else if (Array.isArray(flags)) {
    const wf = flags.find((f: any) => (typeof f === 'object' ? f.type : f) === 'warrant_flag');
    if (wf && typeof wf === 'object') {
      warrantCount = wf.count || 1;
      severity = wf.severity || 'unknown';
    } else if (wf) {
      warrantCount = 1;
    }
  }

  if (warrantCount === 0) return null;

  const colorMap: Record<string, string> = {
    felony: 'bg-red-900/50 text-red-400 border-red-700/50',
    misdemeanor: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
    unknown: 'bg-orange-900/50 text-orange-400 border-orange-700/50',
  };

  const sizeMap = {
    sm: 'text-[8px] px-1 py-0.5',
    md: 'text-[9px] px-1.5 py-0.5',
    lg: 'text-[10px] px-2 py-1',
  };

  const classes = `inline-flex items-center gap-0.5 font-bold rounded-sm border ${colorMap[severity] || colorMap.unknown} ${sizeMap[size]}`;

  const content = (
    <>
      <AlertTriangle className={size === 'sm' ? 'w-2 h-2' : 'w-3 h-3'} />
      {warrantCount > 1 ? `${warrantCount} WARRANTS` : 'WARRANT'}
    </>
  );

  if (onClick) {
    return <button type="button" onClick={onClick} className={classes}>{content}</button>;
  }

  return <span className={classes}>{content}</span>;
}
