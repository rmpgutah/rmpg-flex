import { useEffect, useState } from 'react';
import { apiFetchV2 } from '../hooks/apiFetchV2';

/** Real /api/fleet/analytics shape (src/routes/fleet.ts:484-498).
 *  status_breakdown: counts by status; fleet_summary: aggregate costs over
 *  the period (default 90d). The earlier KpiRibbon assumed flat keys
 *  in_service / monthly_fuel_spend_usd / monthly_cost_per_mile_usd —
 *  none of those exist on the wire, so every cell rendered as '—'. */
interface AnalyticsResp {
  status_breakdown?: Array<{ status: string; count: number }>;
  fleet_summary?: {
    total_vehicles?: number;
    avg_mileage?: number;
    avg_mpg?: number | null;
    total_maintenance_cost?: number;
    total_fuel_cost?: number;
    vehicles_needing_service?: number;
    inspections_failing?: number;
  };
  cost_per_mile_ranking?: Array<{ vehicle_id: number; cost_per_mile: number | null }>;
}
interface OverdueResp { alerts?: Array<{ id: number }> }

interface KpiData {
  in_service?: number;
  in_maintenance?: number;
  overdue_pms?: number;
  total_fuel_cost_period?: number;
  avg_cost_per_mile?: number;
}

export function KpiRibbon() {
  const [data, setData] = useState<KpiData>({});
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      apiFetchV2<AnalyticsResp>('/fleet/analytics?period=90d'),
      apiFetchV2<OverdueResp>('/fleet/overdue-inspections'),
    ]).then(([a, o]) => {
      if (cancelled) return;
      const next: KpiData = {};
      if (a.status === 'fulfilled' && a.value) {
        const breakdown = Array.isArray(a.value.status_breakdown) ? a.value.status_breakdown : [];
        const byStatus = (s: string) => breakdown.find((b) => b.status === s)?.count;
        next.in_service = byStatus('in_service');
        next.in_maintenance = byStatus('maintenance');
        next.total_fuel_cost_period = a.value.fleet_summary?.total_fuel_cost;
        // Avg cost-per-mile across ranked vehicles (filter null entries).
        const ranking = Array.isArray(a.value.cost_per_mile_ranking) ? a.value.cost_per_mile_ranking : [];
        const cpms = ranking.map((r) => r.cost_per_mile).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
        if (cpms.length > 0) {
          next.avg_cost_per_mile = cpms.reduce((s, n) => s + n, 0) / cpms.length;
        }
      }
      if (o.status === 'fulfilled' && Array.isArray(o.value?.alerts)) {
        next.overdue_pms = o.value!.alerts!.length;
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
      <Cell label="Fuel (90d)" value={fmtUsd(data.total_fuel_cost_period)} />
      <Cell label="Avg cost/mi" value={fmtUsd(data.avg_cost_per_mile)} />
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
