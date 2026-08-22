import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';

interface ShiftStats {
  shift_name: string;
  calls: number;
  incidents: number;
  citations: number;
  patrol_scans: number;
}

interface ShiftStatsBarProps {
  /** Extra Tailwind / inline classes for the wrapper */
  className?: string;
  /** Active unit count derived from the dispatch board */
  activeUnits?: number;
}

export default function ShiftStatsBar({ className = '', activeUnits }: ShiftStatsBarProps) {
  const [stats, setStats] = useState<ShiftStats | null>(null);

  const load = () => {
    apiFetch<ShiftStats>('/admin/shift-stats')
      .then(setStats)
      .catch(() => {/* non-fatal */});
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!stats) return null;

  const items: { label: string; value: string | number }[] = [
    { label: 'Shift', value: stats.shift_name },
    { label: 'Calls', value: stats.calls },
    { label: 'Incidents', value: stats.incidents },
    ...(activeUnits != null ? [{ label: 'Units active', value: activeUnits }] : []),
  ];

  return (
    <div
      className={`flex items-center gap-3 px-3 py-1 text-[9px] font-mono flex-shrink-0 flex-wrap ${className}`}
      style={{ background: 'var(--surface-sunken)', borderBottom: '1px solid var(--spm-border)' }}
      aria-label="Shift statistics"
    >
      {items.map((item, i) => (
        <React.Fragment key={item.label}>
          {i > 0 && <span className="text-fg-muted" aria-hidden="true">|</span>}
          <span className="text-fg-muted">{item.label}:</span>
          <span className="text-rmpg-200 font-bold tabular-nums">{item.value}</span>
        </React.Fragment>
      ))}
    </div>
  );
}
