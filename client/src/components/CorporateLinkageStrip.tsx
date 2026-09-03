import { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';
import type { CorporateMine, CorporateSnapshot } from '../utils/corporateOpsClient';

type Mode = 'snapshot' | 'mine';

interface Props {
  mode?: Mode;
  className?: string;
}

export default function CorporateLinkageStrip({ mode = 'snapshot', className = '' }: Props) {
  const [snap, setSnap] = useState<CorporateSnapshot | null>(null);
  const [mine, setMine] = useState<CorporateMine | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (mode === 'mine') {
          const row = await apiFetch<CorporateMine>('/corporate-ops/mine');
          if (!cancelled) setMine(row);
          return;
        }
        const row = await apiFetch<CorporateSnapshot>('/corporate-ops/snapshot');
        if (!cancelled) setSnap(row);
      } catch {
        if (mode === 'snapshot' && !cancelled) {
          try {
            const row = await apiFetch<CorporateMine>('/corporate-ops/mine');
            if (!cancelled) setMine(row);
          } catch { /* officers without snapshot still get /mine */ }
        }
      }
    };
    void load();
    const id = window.setInterval(() => { void load(); }, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [mode]);

  const items = snap
    ? [
      { label: 'Clocked', value: String(snap.clocked_in_now ?? 0) },
      { label: 'Duty mi', value: Number(snap.duty_miles_today ?? 0).toFixed(1) },
      { label: 'Serves', value: String(snap.serve_attempts_today ?? 0) },
      { label: 'Fleet due', value: String(snap.fleet_service_due ?? 0) },
      ...(snap.cost_per_mile_30d != null ? [{ label: 'CPM 30d', value: `$${Number(snap.cost_per_mile_30d).toFixed(2)}` }] : []),
      ...(snap.low_fuel_units && snap.low_fuel_units.length > 0
        ? [{ label: 'Low fuel', value: String(snap.low_fuel_units.length) }]
        : []),
    ]
    : mine
      ? [
        { label: 'On duty', value: mine.on_duty ? 'yes' : 'no' },
        { label: 'Hours', value: Number(mine.hours_today ?? 0).toFixed(1) },
        { label: 'Duty mi', value: Number(mine.duty_miles_today ?? 0).toFixed(1) },
        { label: 'Serves', value: String(mine.serve_attempts_today ?? 0) },
      ]
      : [];

  if (items.length === 0) return null;

  return (
    <div
      className={`flex items-center gap-3 px-3 py-1 text-[9px] font-mono flex-shrink-0 flex-wrap ${className}`}
      style={{ background: 'var(--surface-sunken)', borderBottom: '1px solid var(--spm-border, var(--border-default))' }}
      aria-label="Corporate hours and mileage"
    >
      {items.map((item, i) => (
        <span key={item.label} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-fg-muted" aria-hidden="true">|</span>}
          <span className="text-[color:var(--field-label-color)] uppercase">{item.label}:</span>
          <span className="text-rmpg-100 font-bold tabular-nums">{item.value}</span>
        </span>
      ))}
    </div>
  );
}
