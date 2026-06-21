import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../hooks/useApi';

interface AnalyticsResp {
  in_service?: number;
  in_maintenance?: number;
  monthly_fuel_spend_usd?: number;
  monthly_cost_per_mile_usd?: number;
}
interface OverdueResp {
  alerts?: Array<{ id: number }>;
}

interface KpiData {
  in_service?: number;
  in_maintenance?: number;
  overdue_pms?: number;
  monthly_fuel_spend?: number;
  cost_per_mile?: number;
}

export function KpiRibbon() {
  const [data, setData] = useState<KpiData>({});
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      apiFetch<AnalyticsResp>('/fleet/analytics'),
      apiFetch<OverdueResp>('/fleet/overdue-inspections'),
    ]).then(([a, o]) => {
      if (cancelled) return;
      const next: KpiData = {};
      if (a.status === 'fulfilled' && a.value) {
        next.in_service = a.value.in_service;
        next.in_maintenance = a.value.in_maintenance;
        next.monthly_fuel_spend = a.value.monthly_fuel_spend_usd;
        next.cost_per_mile = a.value.monthly_cost_per_mile_usd;
      }
      if (o.status === 'fulfilled' && o.value?.alerts) {
        next.overdue_pms = o.value.alerts.length;
      }
      setData(next);
    });
    return () => { cancelled = true; };
  }, []);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 p-3 border-b border-rmpg-700 bg-surface-base">
      <Cell label="In service" value={fmt(data.in_service)} />
      <Cell label="In maintenance" value={fmt(data.in_maintenance)} />
      <Cell label="Overdue PMs" value={fmt(data.overdue_pms)} />
      <Cell label="Monthly fuel" value={fmtUsd(data.monthly_fuel_spend)} />
      <Cell label="Cost / mi" value={fmtUsd(data.cost_per_mile)} />
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-rmpg-700 bg-surface-raised px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-rmpg-400">{label}</div>
      <div className="text-base font-semibold text-rmpg-100 mt-0.5">{value}</div>
    </div>
  );
}

function fmt(n: number | undefined): string {
  return typeof n === 'number' ? n.toLocaleString() : '—';
}
function fmtUsd(n: number | undefined): string {
  if (typeof n !== 'number') return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}
