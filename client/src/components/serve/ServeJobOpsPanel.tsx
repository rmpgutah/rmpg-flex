import React from 'react';
import { Building2, Clock, AlertTriangle, KeyRound, Shield } from 'lucide-react';
import type { ServeJobMeta } from '../../utils/serveJobIntake';

export default function ServeJobOpsPanel({
  meta,
  compact = false,
  note,
}: {
  meta: ServeJobMeta;
  compact?: boolean;
  note?: string | null;
}) {
  const classLabel = meta.addressClass === 'unknown' ? null : meta.addressClass.replace(/_/g, ' ');
  const venue = meta.venue && meta.venue !== 'none' ? (meta.venueLabel || meta.venue.replace(/_/g, ' ')) : null;
  if (!classLabel && !venue && !meta.windows.length && !meta.firedIds.length && !meta.ops.gate_code) {
    return null;
  }
  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <div className="flex flex-wrap gap-1">
        {classLabel && (
          <span className="inline-flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-wide px-1 py-0 rounded-[2px] border border-rmpg-600/50 text-rmpg-200 bg-rmpg-800/40">
            <Building2 className="w-2.5 h-2.5" />
            {classLabel}
            {meta.addressClassConfirmed ? '' : ' · ?'}
          </span>
        )}
        {venue && (
          <span className="inline-flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-wide px-1 py-0 rounded-[2px] border text-brand-200 bg-brand-900/20"
            style={{ borderColor: 'rgb(var(--accent-silver-500-rgb)/0.4)' }}>
            {venue}
          </span>
        )}
        {meta.ops.no_sunday && (
          <span className="text-[8px] font-bold px-1 py-0 rounded-[2px] border border-amber-700/50 text-amber-300 bg-amber-900/30">NO SUNDAY</span>
        )}
        {meta.ops.dogs_on_site && (
          <span className="inline-flex items-center gap-0.5 text-[8px] font-bold px-1 py-0 rounded-[2px] border border-red-700/50 text-red-300 bg-red-900/30">
            <AlertTriangle className="w-2.5 h-2.5" />DOGS
          </span>
        )}
        {meta.ops.gate_code && (
          <span className="inline-flex items-center gap-0.5 text-[8px] font-mono px-1 py-0 rounded-[2px] border border-rmpg-600/50 text-rmpg-200">
            <KeyRound className="w-2.5 h-2.5" />{meta.ops.gate_code}
          </span>
        )}
        {meta.ops.photo_required && (
          <span className="inline-flex items-center gap-0.5 text-[8px] font-bold px-1 py-0 rounded-[2px] border border-rmpg-600/50 text-rmpg-300">
            <Shield className="w-2.5 h-2.5" />PHOTO
          </span>
        )}
        {meta.firedIds.length > 0 && (
          <span className="text-[8px] font-mono text-rmpg-400 px-1 py-0">{meta.firedIds.length} ops</span>
        )}
      </div>
      {meta.windows.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {meta.windows.map((w) => (
            <span key={w.window} title={w.focus || w.authority}
              className="inline-flex items-center gap-0.5 text-[9px] font-mono text-rmpg-200 bg-surface-sunken border border-rmpg-700/40 px-1 py-0 rounded-[2px]">
              <Clock className="w-2.5 h-2.5" />
              {w.window}
            </span>
          ))}
        </div>
      )}
      {!compact && note && (
        <pre className="whitespace-pre-wrap text-[10px] text-rmpg-300 bg-surface-sunken/60 border border-rmpg-700/30 rounded-[2px] px-2 py-1.5 max-h-48 overflow-y-auto font-sans">
          {note}
        </pre>
      )}
    </div>
  );
}
