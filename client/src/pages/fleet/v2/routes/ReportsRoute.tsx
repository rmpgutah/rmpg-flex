import { useEffect, useState } from 'react';
import { ArrowRight, Activity, Wrench, AlertTriangle, TrendingUp, Users, CalendarCheck, DollarSign, ClipboardCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { apiFetchV2 } from '../hooks/apiFetchV2';
import { SectionHeader } from '../shell/SectionHeader';
import { useFleetV2View } from '../hooks/useFleetV2Audit';

/** Defensive: server endpoints occasionally return non-array shapes (error
 *  envelopes with 200, null fields). Guard every array consumer with this. */
function asArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

interface HealthScoresResp { health_scores?: Array<{ score?: number }> }
interface MaintScheduleResp { schedule?: Array<{ due_soon?: boolean; overdue?: boolean }> }
interface DriverPerfResp { drivers?: Array<unknown> }
interface ServiceAlertsResp { all_alerts?: Array<{ severity?: string }> }
interface CostTrendsResp { cost_trends?: Array<{ month?: string; total?: number }> }
interface LifecycleResp { lifecycle?: Array<unknown> }
interface MonthlySpendResp { monthly_spend?: Array<{ month?: string; total?: number }> }
interface OverdueResp { alerts?: Array<unknown> }

export function ReportsRoute() {
  useFleetV2View('/fleet/v2/reports');
  return (
    <div className="h-full flex flex-col">
      <SectionHeader title="Reports" />
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <HealthScoresCard />
          <MaintenanceScheduleCard />
          <ServiceAlertsCard />
          <OverdueInspectionsCard />
          <CostTrendsCard />
          <MonthlySpendCard />
          <DriverPerformanceCard />
          <LifecycleCard />
        </div>
      </div>
    </div>
  );
}

// ─── Card primitives ─────────────────────────────────────────────────

interface CardProps {
  title: string;
  icon: LucideIcon;
  loading: boolean;
  headline: string;
  secondary?: string;
  tone?: 'neutral' | 'warn' | 'good' | 'bad';
}

function Card({ title, icon: Icon, loading, headline, secondary, tone = 'neutral' }: CardProps) {
  const toneClass =
    tone === 'warn' ? 'text-amber-400' :
    tone === 'good' ? 'text-green-400' :
    tone === 'bad'  ? 'text-red-400' :
    'text-rmpg-100';
  return (
    <div className="rounded-sm border border-rmpg-700 bg-surface-raised p-3">
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 text-brand-400" />
          <h3 className="text-[11px] font-semibold text-rmpg-100">{title}</h3>
        </div>
        <ArrowRight className="w-3 h-3 text-rmpg-500" aria-hidden />
      </div>
      <div className={`text-2xl font-semibold ${toneClass}`}>
        {loading ? '—' : headline}
      </div>
      {secondary ? <div className="text-[10px] text-rmpg-400 mt-1">{secondary}</div> : null}
    </div>
  );
}

// ─── Individual cards ────────────────────────────────────────────────

function HealthScoresCard() {
  const [data, setData] = useState<HealthScoresResp | null>(null);
  useEffect(() => { apiFetchV2<HealthScoresResp>('/fleet/health-scores').then(setData).catch(() => setData({})); }, []);
  const scores = asArr<{ score?: number }>(data?.health_scores);
  const avg = scores.length > 0 ? scores.reduce((s, r) => s + (r.score ?? 0), 0) / scores.length : null;
  const low = scores.filter((r) => (r.score ?? 100) < 60).length;
  return (
    <Card
      title="Health Scores"
      icon={Activity}
      loading={data === null}
      headline={avg != null ? avg.toFixed(0) : '—'}
      secondary={`${scores.length} vehicles · ${low} below 60`}
      tone={avg != null && avg >= 80 ? 'good' : avg != null && avg < 60 ? 'bad' : 'neutral'}
    />
  );
}

function MaintenanceScheduleCard() {
  const [data, setData] = useState<MaintScheduleResp | null>(null);
  useEffect(() => { apiFetchV2<MaintScheduleResp>('/fleet/maintenance-schedule').then(setData).catch(() => setData({})); }, []);
  const schedule = asArr<{ due_soon?: boolean; overdue?: boolean }>(data?.schedule);
  const overdue = schedule.filter((s) => s.overdue).length;
  const dueSoon = schedule.filter((s) => s.due_soon).length;
  return (
    <Card
      title="Maintenance Schedule"
      icon={Wrench}
      loading={data === null}
      headline={`${overdue}`}
      secondary={`${overdue} overdue · ${dueSoon} due soon`}
      tone={overdue > 0 ? 'bad' : dueSoon > 0 ? 'warn' : 'good'}
    />
  );
}

function ServiceAlertsCard() {
  const [data, setData] = useState<ServiceAlertsResp | null>(null);
  useEffect(() => { apiFetchV2<ServiceAlertsResp>('/fleet/service-alerts').then(setData).catch(() => setData({})); }, []);
  const alerts = asArr<{ severity?: string }>(data?.all_alerts);
  const critical = alerts.filter((a) => (a.severity ?? '').toLowerCase() === 'critical' || (a.severity ?? '').toLowerCase() === 'high').length;
  return (
    <Card
      title="Service Alerts"
      icon={AlertTriangle}
      loading={data === null}
      headline={`${alerts.length}`}
      secondary={`${critical} critical/high`}
      tone={critical > 0 ? 'bad' : alerts.length > 0 ? 'warn' : 'good'}
    />
  );
}

function OverdueInspectionsCard() {
  const [data, setData] = useState<OverdueResp | null>(null);
  useEffect(() => { apiFetchV2<OverdueResp>('/fleet/overdue-inspections').then(setData).catch(() => setData({})); }, []);
  const alerts = asArr(data?.alerts);
  return (
    <Card
      title="Overdue Inspections"
      icon={ClipboardCheck}
      loading={data === null}
      headline={`${alerts.length}`}
      secondary={alerts.length === 0 ? 'All vehicles current' : 'Action required'}
      tone={alerts.length === 0 ? 'good' : 'bad'}
    />
  );
}

function CostTrendsCard() {
  const [data, setData] = useState<CostTrendsResp | null>(null);
  useEffect(() => { apiFetchV2<CostTrendsResp>('/fleet/cost-trends').then(setData).catch(() => setData({})); }, []);
  const trends = asArr<{ month?: string; total?: number }>(data?.cost_trends);
  const latest = trends[trends.length - 1];
  const prev = trends[trends.length - 2];
  const delta = latest && prev && latest.total != null && prev.total != null && prev.total !== 0
    ? ((latest.total - prev.total) / prev.total) * 100
    : null;
  return (
    <Card
      title="Cost Trends"
      icon={TrendingUp}
      loading={data === null}
      headline={latest?.total != null ? `$${Math.round(latest.total).toLocaleString()}` : '—'}
      secondary={delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs prev month` : `${trends.length} months tracked`}
      tone={delta == null ? 'neutral' : delta > 10 ? 'warn' : delta < -10 ? 'good' : 'neutral'}
    />
  );
}

function MonthlySpendCard() {
  const [data, setData] = useState<MonthlySpendResp | null>(null);
  useEffect(() => { apiFetchV2<MonthlySpendResp>('/fleet/monthly-spend?months=8').then(setData).catch(() => setData({})); }, []);
  const months = asArr<{ month?: string; total?: number }>(data?.monthly_spend);
  const latest = months[months.length - 1];
  const avg = months.length > 0 ? months.reduce((s, m) => s + (m.total ?? 0), 0) / months.length : null;
  return (
    <Card
      title="Monthly Spend"
      icon={DollarSign}
      loading={data === null}
      headline={latest?.total != null ? `$${Math.round(latest.total).toLocaleString()}` : '—'}
      secondary={avg != null ? `Avg $${Math.round(avg).toLocaleString()} / mo` : ''}
    />
  );
}

function DriverPerformanceCard() {
  const [data, setData] = useState<DriverPerfResp | null>(null);
  useEffect(() => { apiFetchV2<DriverPerfResp>('/fleet/driver-performance').then(setData).catch(() => setData({})); }, []);
  const drivers = asArr(data?.drivers);
  return (
    <Card
      title="Driver Performance"
      icon={Users}
      loading={data === null}
      headline={`${drivers.length}`}
      secondary="drivers tracked"
    />
  );
}

function LifecycleCard() {
  const [data, setData] = useState<LifecycleResp | null>(null);
  useEffect(() => { apiFetchV2<LifecycleResp>('/fleet/vehicle-lifecycle').then(setData).catch(() => setData({})); }, []);
  const lifecycle = asArr(data?.lifecycle);
  return (
    <Card
      title="Vehicle Lifecycle"
      icon={CalendarCheck}
      loading={data === null}
      headline={`${lifecycle.length}`}
      secondary="vehicles in lifecycle plan"
    />
  );
}
