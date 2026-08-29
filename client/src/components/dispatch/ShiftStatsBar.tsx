import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';

interface ShiftStats {
  shift_name: string;
  calls: number;
  incidents: number;
  citations: number;
  patrol_scans: number;
}

interface DispatchCorporate {
  clocked_in?: number;
  duty_miles_today?: number;
  serve_attempts_today?: number;
}

interface ShiftStatsBarProps {
  /** Extra Tailwind / inline classes for the wrapper */
  className?: string;
  /** Active unit count derived from the dispatch board */
  activeUnits?: number;
}

export default function ShiftStatsBar({ className = '', activeUnits }: ShiftStatsBarProps) {
  const [stats, setStats] = useState<ShiftStats | null>(null);
  const [corp, setCorp] = useState<DispatchCorporate | null>(null);

  const load = () => {
    apiFetch<ShiftStats>('/admin/shift-stats')
      .then(setStats)
      .catch(() => {/* non-fatal */});
    apiFetch<DispatchCorporate>('/dispatch')
      .then((row) => setCorp({
        clocked_in: row.clocked_in,
        duty_miles_today: row.duty_miles_today,
        serve_attempts_today: row.serve_attempts_today,
      }))
      .catch(() => {/* non-fatal */});
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!stats && !corp) return null;

  const items: { label: string; value: string | number }[] = [
    ...(stats ? [
      { label: 'Shift', value: stats.shift_name },
      { label: 'Calls', value: stats.calls },
      { label: 'Incidents', value: stats.incidents },
    ] : []),
    ...(activeUnits != null ? [{ label: 'Units active', value: activeUnits }] : []),
    ...(corp?.clocked_in != null ? [{ label: 'Clocked in', value: corp.clocked_in }] : []),
    ...(corp?.duty_miles_today != null ? [{ label: 'Duty miles', value: Number(corp.duty_miles_today).toFixed(1) }] : []),
    ...(corp?.serve_attempts_today != null ? [{ label: 'Serve attempts', value: corp.serve_attempts_today }] : []),
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
