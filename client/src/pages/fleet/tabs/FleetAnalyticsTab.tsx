import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import {
  BarChart3, Car, Fuel, Wrench, DollarSign, AlertTriangle, XCircle, Gauge,
  CheckCircle, ShieldAlert, TrendingUp, Calendar, Activity, Info, ChevronDown,
  ChevronUp, Search, X, Heart, Clock, User, Bell,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp } from '../../../utils/dateUtils';
import { formatCostAbbrev, toDisplayLabel } from '../../../utils/formatters';
import type { FleetAnalytics, FleetServiceAlert } from '../../../types';
import { chartSeriesColors } from '../../../utils/chartPalette';

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'var(--surface-base)',
    border: '1px solid var(--border-default)',
    color: 'var(--text-primary)',
    fontSize: 10,
    fontFamily: 'Arial, sans-serif',
    borderRadius: 2,
  },
};

const STATUS_LABELS: Record<string, string> = {
  in_service: 'In Service',
  maintenance: 'Maintenance',
  out_of_service: 'Out of Service',
  retired: 'Retired',
};

const SEVERITY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  critical: { bg: 'bg-red-900/20', border: 'border-red-800/40', text: 'text-red-400' },
  warning: { bg: 'bg-amber-900/20', border: 'border-amber-800/40', text: 'text-amber-400' },
};

const PERIOD_OPTIONS = [
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
  { label: '1Y', value: '1y' },
  { label: 'ALL', value: 'all' },
] as const;

const MAINTENANCE_TYPE_LABELS: Record<string, string> = {
  oil_change: 'Oil Change',
  tire_rotation: 'Tire Rotation',
  brake_service: 'Brake Service',
  inspection: 'Inspection',
  repair: 'Repair',
  other: 'Other',
};

// Built at render time (not module scope) — index 4 is the theme-resolved
// gold series color, only correct once the theme class is stamped on <html>.
function issueBarColors(): string[] {
  return ['var(--text-muted)', 'var(--text-muted)', 'var(--text-muted)', 'var(--text-muted)', chartSeriesColors()[2]];
}

const STATUS_DOT_COLORS: Record<string, string> = {
  in_service: 'var(--sev-ok)',
  maintenance: 'var(--sev-warn)',
  out_of_service: 'var(--sev-critical)',
};

const KPI_TOOLTIPS: Record<string, string> = {
  total_fleet_costs: 'Combined maintenance and fuel expenses for the selected period',
  average_mpg: 'Fleet-wide fuel economy calculated from fuel log entries',
  service_compliance: 'Percentage of vehicles with up-to-date service records',
  inspection_pass_rate: 'Percentage of inspections that passed in the selected period',
};

interface CostTrendItem {
  month: string;
  maintenance_cost: number;
  fuel_cost: number;
  total_cost: number;
  vehicle_count: number;
}

interface LifecycleItem {
  id: number;
  vehicle_number: string;
  year: number;
  status: string;
  age_years: number;
  current_mileage: number;
  avg_annual_mileage: number;
  total_lifetime_cost: number;
  cost_per_year: number;
  estimated_remaining_life_years: number | null;
}

interface ComparisonVehicle {
  id: number;
  vehicle_number: string;
  make: string;
  model: string;
  year: number;
  current_mileage: number;
  status: string;
  total_maintenance_cost: number;
  total_fuel_cost: number;
  total_cost: number;
  cost_per_mile: number | null;
  avg_mpg: number | null;
  inspection_count: number;
  inspection_pass_rate: number | null;
  last_service_date: string | null;
  days_since_last_service: number | null;
  assignment_count: number;
}

interface FleetVehicleOption {
  id: number;
  vehicle_number: string;
  make: string;
  model: string;
}

interface HealthScoreItem {
  vehicle_id: number;
  vehicle_number: string;
  make: string;
  model: string;
  year: number;
  health_score: number;
  factors: { age: number; mileage: number; service: number; inspection: number; cost: number };
  status_label: string;
}

interface MaintenanceScheduleItem {
  vehicle_id: number;
  vehicle_number: string;
  service_type: string;
  due_date: string | null;
  due_mileage: number | null;
  days_until: number | null;
  miles_until: number | null;
  urgency: string;
}

interface DriverPerformanceItem {
  officer_name: string;
  call_sign: string;
  total_miles: number;
  total_hours: number;
  idle_pct: number;
  avg_speed: number;
  max_speed: number;
  avg_mpg: number | null;
  inspection_score: number;
  damage_count: number;
  overall_score: number;
}

interface Props {
  analytics: FleetAnalytics | null;
  loading?: boolean;
  onPeriodChange?: (period: string) => void;
}

function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex ml-1">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        className="text-rmpg-500 hover:text-rmpg-300 transition-colors duration-150 focus:outline-none"
        aria-label="More info"
      >
        <Info className="w-2.5 h-2.5" />
      </button>
      {show && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 px-2 py-1.5 bg-surface-overlay border border-rmpg-700 rounded-[2px] text-[8px] text-rmpg-300 font-normal normal-case tracking-normal shadow-lg pointer-events-none">
          {text}
        </div>
      )}
    </span>
  );
}

export default function FleetAnalyticsTab({ analytics, loading, onPeriodChange }: Props) {
  useEffect(() => { document.title = 'Fleet - Analytics \u2014 RMPG Flex'; }, []);

  const [period, setPeriod] = useState('90d');

  // Service alerts from dedicated endpoint
  const [serviceAlerts, setServiceAlerts] = useState<FleetServiceAlert[]>([]);

  // Cost trends data
  const [costTrends, setCostTrends] = useState<CostTrendItem[]>([]);

  // Vehicle lifecycle data
  const [lifecycle, setLifecycle] = useState<LifecycleItem[]>([]);

  // Vehicle comparison state
  const [compareExpanded, setCompareExpanded] = useState(false);
  const [allVehicles, setAllVehicles] = useState<FleetVehicleOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [comparisonResults, setComparisonResults] = useState<ComparisonVehicle[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);

  // Health scores state
  const [healthScores, setHealthScores] = useState<HealthScoreItem[]>([]);
  const [healthSort, setHealthSort] = useState<'score' | 'number' | 'age'>('score');

  // Maintenance schedule state
  const [maintSchedule, setMaintSchedule] = useState<MaintenanceScheduleItem[]>([]);

  // Driver performance state
  const [driverPerf, setDriverPerf] = useState<DriverPerformanceItem[]>([]);

  // Fetch health scores
  useEffect(() => {
    apiFetch<{ health_scores: HealthScoreItem[] }>('/fleet/health-scores')
      .then((d) => d?.health_scores && setHealthScores(d.health_scores))
      .catch(() => {});
  }, []);

  // Fetch maintenance schedule
  useEffect(() => {
    apiFetch<{ schedule: MaintenanceScheduleItem[] }>('/fleet/maintenance-schedule')
      .then((d) => d?.schedule && setMaintSchedule(d.schedule))
      .catch(() => {});
  }, []);

  // Fetch driver performance
  useEffect(() => {
    apiFetch<{ drivers: DriverPerformanceItem[] }>('/fleet/driver-performance')
      .then((d) => d?.drivers && setDriverPerf(d.drivers))
      .catch(() => {});
  }, []);

  // Sorted health scores
  const sortedHealthScores = useMemo(() => {
    const arr = [...healthScores];
    if (healthSort === 'score') arr.sort((a, b) => a.health_score - b.health_score);
    else if (healthSort === 'number') arr.sort((a, b) => a.vehicle_number.localeCompare(b.vehicle_number));
    else if (healthSort === 'age') arr.sort((a, b) => (a.year || 9999) - (b.year || 9999));
    return arr;
  }, [healthScores, healthSort]);

  const overdueCount = useMemo(() =>
    maintSchedule.filter((m) => m.urgency === 'overdue' || m.urgency === 'critical').length,
  [maintSchedule]);

  useEffect(() => {
    apiFetch<{ all_alerts: FleetServiceAlert[] }>('/fleet/service-alerts')
      .then((d) => d?.all_alerts && setServiceAlerts(d.all_alerts))
      .catch(() => {});
  }, []);

  // Fetch cost trends
  useEffect(() => {
    apiFetch<{ cost_trends: CostTrendItem[] }>('/fleet/cost-trends')
      .then((d) => d?.cost_trends && setCostTrends(d.cost_trends))
      .catch(() => {});
  }, []);

  // Fetch vehicle lifecycle
  useEffect(() => {
    apiFetch<{ lifecycle: LifecycleItem[] }>('/fleet/vehicle-lifecycle')
      .then((d) => d?.lifecycle && setLifecycle(d.lifecycle))
      .catch(() => {});
  }, []);

  // Fetch all vehicles list for comparison selector
  useEffect(() => {
    apiFetch<{ vehicles: FleetVehicleOption[] }>('/fleet?limit=500&fields=id,vehicle_number,make,model')
      .then((d) => {
        if (d?.vehicles) setAllVehicles(d.vehicles);
      })
      .catch(() => {});
  }, []);

  const handlePeriodChange = useCallback((newPeriod: string) => {
    setPeriod(newPeriod);
    onPeriodChange?.(newPeriod);
  }, [onPeriodChange]);

  const handleCompare = useCallback(() => {
    if (selectedIds.length < 2 || selectedIds.length > 5) return;
    setCompareLoading(true);
    apiFetch<{ vehicles: ComparisonVehicle[] }>(`/fleet/vehicle-comparison?ids=${selectedIds.join(',')}`)
      .then((d) => d?.vehicles && setComparisonResults(d.vehicles))
      .catch(() => {})
      .finally(() => setCompareLoading(false));
  }, [selectedIds]);

  const toggleVehicleSelection = useCallback((id: number) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((v) => v !== id);
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  }, []);

  // Format cost trends for chart display
  const costTrendChartData = useMemo(() =>
    costTrends.map((t) => ({
      ...t,
      month: t.month.substring(5), // Show MM only
    })),
  [costTrends]);

  // Additional analytics data
  const [costAnalytics, setCostAnalytics] = useState<any>(null);
  const [inspectionStats, setInspectionStats] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [overdueInspections, setOverdueInspections] = useState<any[]>([]);
  // Fleet.io sync health — link coverage, conflict trend, outbound latency.
  const [fleetioAnalytics, setFleetioAnalytics] = useState<any>(null);

  // Combined cost trend (12 months) — enhanced endpoint with fuel + maintenance + recurring
  const [combinedCostTrend, setCombinedCostTrend] = useState<any[]>([]);
  // Monthly spend (last 8 months) — per-category breakdown
  const [monthlySpend, setMonthlySpend] = useState<any[]>([]);
  // Daily GPS mileage — start-of-shift to end-of-shift
  const [dailyGpsMileage, setDailyGpsMileage] = useState<any[]>([]);
  const [dailyGpsLoading, setDailyGpsLoading] = useState(false);

  // Daily Mileage Run — fleet miles per day, summed across vehicles from the
  // GPS-derived per-vehicle daily mileage (/fleet/daily-gps-mileage).
  const dailyMileageRun = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const r of dailyGpsMileage as Array<{ date: string; miles: number }>) {
      if (!r?.date) continue;
      byDate.set(r.date, (byDate.get(r.date) ?? 0) + (Number(r.miles) || 0));
    }
    return Array.from(byDate.entries())
      .map(([date, miles]) => ({ date, miles: Math.round(miles * 10) / 10 }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [dailyGpsMileage]);

  useEffect(() => {
    apiFetch<any>('/fleet/fleet-cost-analytics').then((d: any) => d && setCostAnalytics(d)).catch(() => {});
    apiFetch<any>('/fleet/inspection-stats').then((d: any) => d && setInspectionStats(d)).catch(() => {});
    apiFetch<any>('/fleet/notifications').then((d: any) => d?.notifications && setNotifications(d.notifications)).catch(() => {});
    apiFetch<any>('/fleet/overdue-inspections').then((d: any) => d?.alerts && setOverdueInspections(d.alerts)).catch(() => {});
    apiFetch<any>('/fleetio/analytics').then((d: any) => d && !d.error && setFleetioAnalytics(d)).catch(() => {});
  }, []);

  // Fetch combined cost trend (12 months)
  useEffect(() => {
    apiFetch<{ combined_cost_trend: any[] }>('/fleet/combined-cost-trend')
      .then((d) => d?.combined_cost_trend && setCombinedCostTrend(d.combined_cost_trend))
      .catch(() => {});
  }, []);

  // Fetch monthly spend (8 months)
  useEffect(() => {
    apiFetch<{ monthly_spend: any[] }>('/fleet/monthly-spend?months=8')
      .then((d) => d?.monthly_spend && setMonthlySpend(d.monthly_spend))
      .catch(() => {});
  }, []);

  // Fetch daily GPS mileage (30 days)
  useEffect(() => {
    setDailyGpsLoading(true);
    apiFetch<{ daily_mileage: any[] }>('/fleet/daily-gps-mileage?days=30')
      .then((d) => d?.daily_mileage && setDailyGpsMileage(d.daily_mileage))
      .catch(() => {})
      .finally(() => setDailyGpsLoading(false));
  }, []);


  if (loading || !analytics) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <BarChart3 className="w-10 h-10 text-rmpg-600 mx-auto mb-3 animate-pulse" />
          <p className="text-[11px] text-rmpg-500">{loading ? 'Loading analytics...' : 'No analytics data available'}</p>
        </div>
      </div>
    );
  }

  const {
    maintenance_cost_trend = [], mileage_distribution = [], status_breakdown = [],
    fuel_economy_trend = [], fleet_summary = { total_vehicles: 0, avg_mileage: 0, avg_mpg: null, total_maintenance_cost: 0, total_fuel_cost: 0, vehicles_needing_service: 0, inspections_failing: 0 },
    cost_per_mile_ranking = [],
    service_compliance = { compliant: 0, overdue: 0, rate: 100 },
    inspection_pass_rate = { total: 0, passed: 0, failed: 0, rate: 100 },
    utilization = { assigned: 0, unassigned: 0, rate: 0 },
    daily_usage = [], maintenance_forecast = [], oldest_vehicle_year = null, avg_daily_miles = null,
    top_issues = [],
    scope = 'fleet',
    omitted_for_vehicle_scope = [],
    fleet_comparison = null,
  } = analytics || {};

  // A card named by the server as fleet-only is hidden outright — an empty
  // chart reads as "no data for this vehicle", which is a different and
  // false claim.
  const isOmitted = (block: string) => omitted_for_vehicle_scope.includes(block);

  // On the scoped path every value below is THIS VEHICLE's, so the labels must
  // say so. A card captioned "fleet-wide" over a single vehicle's number is the
  // exact defect this scope work exists to remove.
  const isVehicleScope = scope === 'vehicle';

  const totalCosts = (fleet_summary.total_maintenance_cost || 0) + (fleet_summary.total_fuel_cost || 0);
  const complianceRate = service_compliance?.rate ?? 100;
  const inspPassRate = inspection_pass_rate?.rate ?? 100;

  // Find best values in comparison for highlighting
  const getBestValue = (field: keyof ComparisonVehicle, lower = true) => {
    if (comparisonResults.length === 0) return null;
    const vals = comparisonResults.map((v) => v[field] as number | null).filter((v): v is number => v != null);
    if (vals.length === 0) return null;
    return lower ? Math.min(...vals) : Math.max(...vals);
  };

  return (
    <div className="p-4 space-y-3">
      <div
        data-testid="analytics-scope-banner"
        className="px-3 py-1.5 text-[9px] uppercase tracking-wider font-semibold text-fg-secondary border-b border-rmpg-700 bg-surface-sunken"
      >
        {scope === 'vehicle' ? 'Scope: this vehicle' : 'Scope: fleet-wide'}
      </div>

      {fleet_comparison && (
        <div
          data-testid="fleet-comparison"
          className="px-3 py-1.5 flex items-center gap-4 text-[10px] font-mono border-b border-rmpg-700 bg-surface-sunken"
        >
          <span className="text-fg-muted uppercase tracking-wider text-[9px]">Fleet avg</span>
          <span className="text-fg-secondary">
            MPG <strong className="text-rmpg-100 tabular-nums">
              {fleet_comparison.avg_mpg != null ? fleet_comparison.avg_mpg.toFixed(1) : '--'}
            </strong>
          </span>
          <span className="text-fg-secondary">
            Miles <strong className="text-rmpg-100 tabular-nums">
              {Math.round(fleet_comparison.avg_mileage).toLocaleString()}
            </strong>
          </span>
          <span className="text-fg-secondary">
            Maint <strong className="text-rmpg-100 tabular-nums">
              ${Math.round(fleet_comparison.total_maintenance_cost).toLocaleString()}
            </strong>
          </span>
          <span className="text-fg-secondary">
            Fuel <strong className="text-rmpg-100 tabular-nums">
              ${Math.round(fleet_comparison.total_fuel_cost).toLocaleString()}
            </strong>
          </span>
        </div>
      )}

      {/* Period Filter */}
      <div className="flex items-center gap-1.5">
        <Calendar className="w-3 h-3 text-accent-silver-500" />
        <span className="text-[8px] text-[color:var(--field-label-color)] uppercase font-bold tracking-wider mr-2">Period</span>
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handlePeriodChange(opt.value)}
            className={`px-2.5 py-1 text-[9px] font-mono font-bold tracking-wider rounded-[2px] border transition-colors duration-150
              ${period === opt.value
                ? 'bg-[color:var(--text-muted)] border-[color:var(--text-muted)] text-rmpg-100'
                : 'bg-surface-sunken border-rmpg-700 text-rmpg-400 hover:text-rmpg-100 hover:border-rmpg-600'
              }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* ROW 1: KPI Cards with Tooltips */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {/* Total Fleet Costs */}
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="w-3 h-3 text-accent-silver-500" />
            <span className="text-[8px] text-[color:var(--field-label-color)] uppercase font-bold tracking-wider">{isVehicleScope ? 'Total Vehicle Costs' : 'Total Fleet Costs'}</span>
            <InfoTooltip text={KPI_TOOLTIPS.total_fleet_costs} />
          </div>
          <div className="text-xl font-bold font-mono text-rmpg-100 tabular-nums">
            {formatCostAbbrev(totalCosts)}
          </div>
          <div className="flex gap-3 mt-1 text-[8px] text-rmpg-400 font-mono tabular-nums">
            <span>Maint: ${((fleet_summary.total_maintenance_cost || 0) / 1000).toFixed(1)}k</span>
            <span>Fuel: ${((fleet_summary.total_fuel_cost || 0) / 1000).toFixed(1)}k</span>
          </div>
        </div>

        {/* Average MPG */}
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Fuel className="w-3 h-3 text-accent-silver-500" />
            <span className="text-[8px] text-[color:var(--field-label-color)] uppercase font-bold tracking-wider">Average MPG</span>
            <InfoTooltip text={KPI_TOOLTIPS.average_mpg} />
          </div>
          <div className="text-xl font-bold font-mono text-rmpg-100 tabular-nums">
            {fleet_summary.avg_mpg != null ? fleet_summary.avg_mpg.toFixed(1) : '--'}
          </div>
          <div className="text-[8px] text-rmpg-400 mt-1">{isVehicleScope ? "This vehicle's fuel economy" : 'Fleet-wide fuel economy'}</div>
        </div>

        {/* Service Compliance */}
        {!isOmitted('service_compliance') && (
        <div data-testid="card-service_compliance" className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Wrench className="w-3 h-3 text-accent-silver-500" />
            <span className="text-[8px] text-[color:var(--field-label-color)] uppercase font-bold tracking-wider">Service Compliance</span>
            <InfoTooltip text={KPI_TOOLTIPS.service_compliance} />
          </div>
          <div className={`text-xl font-bold font-mono tabular-nums ${complianceRate >= 80 ? 'text-green-400' : complianceRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
            {complianceRate.toFixed(1)}%
          </div>
          <div className="text-[8px] text-rmpg-400 mt-1 font-mono tabular-nums">
            {service_compliance ? `${service_compliance.compliant} ok / ${service_compliance.overdue} overdue` : '--'}
          </div>
        </div>
        )}

        {/* Inspection Pass Rate */}
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle className="w-3 h-3 text-accent-silver-500" />
            <span className="text-[8px] text-[color:var(--field-label-color)] uppercase font-bold tracking-wider">Inspection Pass Rate</span>
            <InfoTooltip text={KPI_TOOLTIPS.inspection_pass_rate} />
          </div>
          <div className={`text-xl font-bold font-mono tabular-nums ${inspPassRate >= 80 ? 'text-green-400' : inspPassRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
            {inspPassRate.toFixed(1)}%
          </div>
          <div className="text-[8px] text-rmpg-400 mt-1 font-mono tabular-nums">
            {inspection_pass_rate ? `${inspection_pass_rate.passed} pass / ${inspection_pass_rate.failed} fail of ${inspection_pass_rate.total}` : '--'}
          </div>
        </div>
      </div>

      {/* ROW 2: Maintenance Cost Trend + Fuel Economy Trend */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Maintenance Cost Trend (Bar Chart) */}
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <DollarSign className="w-3 h-3" /> Maintenance Cost Trend
          </h4>
          {maintenance_cost_trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={maintenance_cost_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} tickLine={false} axisLine={{ stroke: 'var(--border-subtle)' }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9 }} tickLine={false} axisLine={{ stroke: 'var(--border-subtle)' }}
                  tickFormatter={(v) => `$${v}`} />
                <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(value: any) => [`$${Number(value).toFixed(0)}`, 'Cost']} />
                <Bar dataKey="total_cost" fill="var(--text-muted)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-[10px] text-rmpg-500">No maintenance data</div>
          )}
        </div>

        {/* Fuel Economy Trend (Line Chart) */}
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Fuel className="w-3 h-3" /> Fuel Economy Trend
          </h4>
          {fuel_economy_trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={fuel_economy_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} tickLine={false} axisLine={{ stroke: 'var(--border-subtle)' }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9 }} tickLine={false} axisLine={{ stroke: 'var(--border-subtle)' }}
                  tickFormatter={(v) => `${v} mpg`} />
                <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(value: any) => [value != null ? `${value} mpg` : 'N/A', 'Avg MPG']} />
                <Line type="monotone" dataKey="avg_mpg" stroke="var(--sev-ok)" strokeWidth={2} dot={{ r: 3, fill: 'var(--sev-ok)' }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-[10px] text-rmpg-500">No fuel data</div>
          )}
        </div>
      </div>

      {/* ROW 3: Top Vehicles by Cost + Service Alerts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Top Vehicles by Cost */}
        {!isOmitted('cost_per_mile_ranking') && (
        <div data-testid="card-cost_per_mile_ranking" className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3" /> Top Vehicles by Cost
          </h4>
          {(cost_per_mile_ranking && cost_per_mile_ranking.length > 0) ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-rmpg-700">
                    <th className="text-left py-1 pr-2">Vehicle</th>
                    <th className="text-left py-1 pr-2">Make/Model</th>
                    <th className="text-right py-1 pr-2 font-mono">$/Mile</th>
                    <th className="text-right py-1 font-mono">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cost_per_mile_ranking.map((v) => (
                    <tr key={v.id} className="border-b border-rmpg-700/50 hover:bg-surface-sunken transition-colors duration-150">
                      <td className="py-1 pr-2 font-mono font-bold text-rmpg-100">{v.vehicle_number}</td>
                      <td className="py-1 pr-2 text-rmpg-400">{v.make} {v.model}</td>
                      <td className="py-1 pr-2 text-right font-mono tabular-nums text-green-400">
                        {v.cost_per_mile != null ? `$${v.cost_per_mile.toFixed(2)}` : '--'}
                      </td>
                      <td className="py-1 text-right font-mono tabular-nums text-rmpg-400">
                        {formatCostAbbrev(v.total_cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-[120px] flex items-center justify-center text-[10px] text-rmpg-500">No cost data available</div>
          )}
        </div>
        )}

        {/* Service Alerts */}
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <ShieldAlert className="w-3 h-3" /> Service Alerts
            {serviceAlerts.length > 0 && (
              <span className="ml-auto bg-red-900/40 text-red-400 px-1.5 py-0.5 rounded-[2px] text-[8px] font-mono tabular-nums">
                {serviceAlerts.length}
              </span>
            )}
          </h4>
          {serviceAlerts.length > 0 ? (
            <div className="space-y-1 max-h-[220px] overflow-y-auto">
              {serviceAlerts.slice(0, 12).map((alert, i) => {
                const sev = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.warning;
                return (
                  <div key={`${alert.vehicle_id}-${alert.issue}-${i}`}
                    className={`flex items-center justify-between px-2 py-1.5 ${sev.bg} border ${sev.border} rounded-[2px] text-[10px]`}
                  >
                    <span className="font-mono font-bold text-rmpg-100">{alert.vehicle_number}</span>
                    <span className={`min-w-0 ${sev.text} truncate mx-2`}>{alert.issue}</span>
                    <span className="font-mono tabular-nums text-rmpg-400 shrink-0">
                      {alert.due_date ? parseTimestamp(alert.due_date).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' }) : '--'}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-[120px] flex items-center justify-center text-[10px] text-green-500">
              <CheckCircle className="w-4 h-4 mr-1.5" /> No active alerts
            </div>
          )}
        </div>
      </div>

      {/* ROW 4: Daily Mileage Run + Fleet Status */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Daily Mileage Run (GPS miles per day, fleet-wide) */}
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Gauge className="w-3 h-3" /> Daily Mileage Run
          </h4>
          {dailyMileageRun.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={dailyMileageRun}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'var(--text-muted)', fontSize: 8 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border-subtle)' }}
                  tickFormatter={(v) => {
                    const d = parseTimestamp(v);
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  }}
                />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9 }} tickLine={false} axisLine={{ stroke: 'var(--border-subtle)' }} />
                <Tooltip
                  {...CHART_TOOLTIP_STYLE}
                  formatter={(value: any) => [`${value} mi`, 'Miles']}
                  labelFormatter={(label) => {
                    const d = parseTimestamp(String(label));
                    return d.toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' });
                  }}
                />
                <Bar dataKey="miles" fill={chartSeriesColors()[2]} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-[10px] text-rmpg-500">No GPS mileage data</div>
          )}
        </div>

        {/* Fleet Status (Donut) */}
        {!isOmitted('status_breakdown') && (
        <div data-testid="card-status_breakdown" className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Car className="w-3 h-3" /> Fleet Status
          </h4>
          {status_breakdown.length > 0 ? (
            <div className="flex items-center gap-3">
              <ResponsiveContainer width="55%" height={180}>
                <PieChart>
                  <Pie
                    data={status_breakdown.map(s => ({ ...s, name: STATUS_LABELS[s.status] || s.status }))}
                    dataKey="count"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={60}
                    innerRadius={30}
                    paddingAngle={2}
                  >
                    {status_breakdown.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {status_breakdown.map((s) => (
                  <div key={s.status} className="flex items-center gap-2 text-[10px]">
                    <div className="w-2 h-2 rounded-[1px] shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-rmpg-400">{STATUS_LABELS[s.status] || s.status}</span>
                    <span className="ml-auto font-mono font-bold tabular-nums text-rmpg-100">{s.count}</span>
                  </div>
                ))}
                {utilization && (
                  <div className="mt-2 pt-2 border-t border-rmpg-700 text-[9px] text-rmpg-400">
                    <span>Utilization: </span>
                    <span className="font-mono font-bold text-rmpg-100 tabular-nums">{utilization.rate}%</span>
                    <span className="ml-1">({utilization.assigned} assigned)</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-[10px] text-rmpg-500">No data</div>
          )}
        </div>
        )}
      </div>

      {/* ROW 5: Daily Fleet Utilization + Maintenance Forecast */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Daily Fleet Utilization (Area Chart) */}
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Activity className="w-3 h-3" /> {isVehicleScope ? 'Daily Vehicle Utilization' : 'Daily Fleet Utilization'}
          </h4>
          {daily_usage && daily_usage.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={daily_usage}>
                <defs>
                  <linearGradient id="utilGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--text-muted)" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="var(--text-muted)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'var(--text-muted)', fontSize: 8 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border-subtle)' }}
                  tickFormatter={(v) => {
                    const d = parseTimestamp(v);
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  }}
                />
                <YAxis
                  tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border-subtle)' }}
                  allowDecimals={false}
                />
                <Tooltip
                  {...CHART_TOOLTIP_STYLE}
                  formatter={(value: any, name: any) => [value, name === 'active_vehicles' ? 'Active Vehicles' : name]}
                  labelFormatter={(label) => {
                    const d = parseTimestamp(String(label));
                    return d.toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' });
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="active_vehicles"
                  stroke="var(--text-muted)"
                  strokeWidth={2}
                  fill="url(#utilGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-[10px] text-rmpg-500">No GPS usage data</div>
          )}
        </div>

        {/* Maintenance Forecast */}
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Wrench className="w-3 h-3" /> Maintenance Forecast
          </h4>
          {maintenance_forecast && maintenance_forecast.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-rmpg-700">
                    <th className="text-left py-1 pr-2">Vehicle #</th>
                    <th className="text-right py-1 pr-2 font-mono">Current Mi</th>
                    <th className="text-right py-1 pr-2 font-mono">Next Svc</th>
                    <th className="text-right py-1 font-mono">Est. Days</th>
                  </tr>
                </thead>
                <tbody>
                  {maintenance_forecast.map((v) => {
                    const days = v.est_days_until_service;
                    const dayColor = days == null ? 'text-rmpg-400'
                      : days < 7 ? 'text-red-400'
                      : days < 30 ? 'text-amber-400'
                      : 'text-green-400';
                    return (
                      <tr key={v.id} className="border-b border-rmpg-700/50 hover:bg-surface-sunken transition-colors duration-150">
                        <td className="py-1 pr-2 font-mono font-bold text-rmpg-100">{v.vehicle_number}</td>
                        <td className="py-1 pr-2 text-right font-mono tabular-nums text-rmpg-300">
                          {v.current_mileage != null ? v.current_mileage.toLocaleString() : '--'}
                        </td>
                        <td className="py-1 pr-2 text-right font-mono tabular-nums text-rmpg-300">
                          {v.next_service_due != null ? v.next_service_due.toLocaleString() : '--'}
                        </td>
                        <td className={`py-1 text-right font-mono font-bold tabular-nums ${dayColor}`}>
                          {days != null ? (days <= 0 ? 'OVERDUE' : `${days}d`) : '--'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-[120px] flex items-center justify-center text-[10px] text-rmpg-500">No forecast data available</div>
          )}
        </div>
      </div>

      {/* ROW 6: Quick Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {/* Avg Daily Miles */}
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Gauge className="w-3 h-3 text-accent-silver-500" />
            <span className="text-[8px] text-[color:var(--field-label-color)] uppercase font-bold tracking-wider">Avg Daily Miles</span>
          </div>
          <div className="text-lg font-bold font-mono text-rmpg-100 tabular-nums">
            {avg_daily_miles != null && avg_daily_miles > 0 ? avg_daily_miles.toFixed(1) : '--'}
          </div>
          <div className="text-[8px] text-rmpg-400 mt-1">{isVehicleScope ? "This vehicle's avg from fuel logs" : 'Fleet avg from fuel logs'}</div>
        </div>

        {/* Total Vehicles — a fleet count, not a vehicle fact. It lives inside
            fleet_summary rather than being its own block, so FLEET_ONLY_BLOCKS
            cannot gate it; hide it directly on the scoped path instead. */}
        {!isVehicleScope && (
        <div data-testid="card-total_vehicles" className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Car className="w-3 h-3 text-accent-silver-500" />
            <span className="text-[8px] text-[color:var(--field-label-color)] uppercase font-bold tracking-wider">Total Vehicles</span>
          </div>
          <div className="text-lg font-bold font-mono text-rmpg-100 tabular-nums">
            {fleet_summary.total_vehicles}
          </div>
          <div className="text-[8px] text-rmpg-400 mt-1">Registered in fleet</div>
        </div>
        )}

        {/* Oldest Vehicle */}
        {!isOmitted('oldest_vehicle_year') && (
        <div data-testid="card-oldest_vehicle_year" className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Calendar className="w-3 h-3 text-accent-silver-500" />
            <span className="text-[8px] text-[color:var(--field-label-color)] uppercase font-bold tracking-wider">Oldest Vehicle</span>
          </div>
          <div className="text-lg font-bold font-mono text-rmpg-100 tabular-nums">
            {oldest_vehicle_year ?? '--'}
          </div>
          <div className="text-[8px] text-rmpg-400 mt-1">Model year (non-retired)</div>
        </div>
        )}

        {/* Fleet Utilization */}
        {!isOmitted('utilization') && (
        <div data-testid="card-utilization" className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Activity className="w-3 h-3 text-accent-silver-500" />
            <span className="text-[8px] text-[color:var(--field-label-color)] uppercase font-bold tracking-wider">Fleet Utilization</span>
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-rmpg-100">
            {utilization ? `${utilization.rate}%` : '--'}
          </div>
          {utilization && (
            <div className="mt-1.5">
              <div className="h-1.5 bg-surface-deep rounded-[1px] overflow-hidden">
                <div
                  className="h-full rounded-[1px] transition-all duration-150"
                  style={{
                    width: `${Math.min(utilization.rate, 100)}%`,
                    backgroundColor: utilization.rate >= 80 ? 'var(--sev-ok)' : utilization.rate >= 50 ? 'var(--sev-warn)' : 'var(--sev-critical)',
                  }}
                />
              </div>
              <div className="text-[7px] text-rmpg-500 mt-0.5 font-mono tabular-nums">
                {utilization.assigned} / {utilization.assigned + utilization.unassigned} assigned
              </div>
            </div>
          )}
        </div>
        )}
      </div>

      {/* ROW 7: Combined Cost Trend (Full Width) */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
        <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
          <TrendingUp className="w-3 h-3" /> Combined Cost Trend (12 Months)
        </h4>
        {costTrendChartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={costTrendChartData}>
              <defs>
                <linearGradient id="maintGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--text-muted)" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="var(--text-muted)" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="fuelGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--sev-ok)" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="var(--sev-ok)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} tickLine={false} axisLine={{ stroke: 'var(--border-subtle)' }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9 }} tickLine={false} axisLine={{ stroke: 'var(--border-subtle)' }}
                tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
              <Tooltip
                {...CHART_TOOLTIP_STYLE}
                formatter={(value: any, name: any) => {
                  const label = name === 'maintenance_cost' ? 'Maintenance' : name === 'fuel_cost' ? 'Fuel' : name;
                  return [`$${Number(value).toFixed(0)}`, label];
                }}
              />
              <Area type="monotone" dataKey="maintenance_cost" stackId="1" stroke="var(--text-muted)" strokeWidth={2} fill="url(#maintGradient)" />
              <Area type="monotone" dataKey="fuel_cost" stackId="1" stroke="var(--sev-ok)" strokeWidth={2} fill="url(#fuelGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[220px] flex items-center justify-center text-[10px] text-rmpg-500">No cost trend data available</div>
        )}
        <div className="flex items-center gap-4 mt-2">
          <div className="flex items-center gap-1.5 text-[8px]">
            <div className="w-3 h-1.5 bg-[color:var(--text-muted)] rounded-[1px]" />
            <span className="text-rmpg-400">Maintenance</span>
          </div>
          <div className="flex items-center gap-1.5 text-[8px]">
            <div className="w-3 h-1.5 bg-[color:var(--sev-ok)] rounded-[1px]" />
            <span className="text-rmpg-400">Fuel</span>
          </div>
        </div>
      </div>

      {/* ROW 7b: Monthly Spend (Last 8 Months) */}
      {monthlySpend.length > 0 && (
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <DollarSign className="w-3 h-3" /> Monthly Spend (Last 8 Months)
          </h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlySpend.map((m: any) => ({ ...m, month: m.month.substring(5) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} tickLine={false} axisLine={{ stroke: 'var(--border-subtle)' }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9 }} tickLine={false} axisLine={{ stroke: 'var(--border-subtle)' }}
                tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
              <Tooltip
                {...CHART_TOOLTIP_STYLE}
                formatter={(value: any, name: any) => {
                  const labels: Record<string, string> = { fuel_cost: 'Fuel', maintenance_cost: 'Maintenance', other_costs: 'Other', loan_payments: 'Loans' };
                  return [`$${Number(value).toFixed(0)}`, labels[name] || name];
                }}
              />
              <Bar dataKey="fuel_cost" stackId="a" fill="var(--sev-ok)" radius={[0,0,0,0]} />
              <Bar dataKey="maintenance_cost" stackId="a" fill="var(--text-muted)" radius={[0,0,0,0]} />
              <Bar dataKey="other_costs" stackId="a" fill="var(--sev-warn)" radius={[0,0,0,0]} />
              <Bar dataKey="loan_payments" stackId="a" fill="var(--sev-critical)" radius={[0,0,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1.5 text-[8px]"><div className="w-3 h-1.5 bg-[color:var(--sev-ok)] rounded-[1px]" /><span className="text-rmpg-400">Fuel</span></div>
            <div className="flex items-center gap-1.5 text-[8px]"><div className="w-3 h-1.5 bg-[color:var(--text-muted)] rounded-[1px]" /><span className="text-rmpg-400">Maint</span></div>
            <div className="flex items-center gap-1.5 text-[8px]"><div className="w-3 h-1.5 bg-[color:var(--sev-warn)] rounded-[1px]" /><span className="text-rmpg-400">Other</span></div>
            <div className="flex items-center gap-1.5 text-[8px]"><div className="w-3 h-1.5 bg-[color:var(--sev-critical)] rounded-[1px]" /><span className="text-rmpg-400">Loans</span></div>
          </div>
        </div>
      )}

      {/* ROW 7c: Daily GPS Mileage (Start of Shift → End of Shift) */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
        <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
          <Gauge className="w-3 h-3" /> Daily GPS Mileage (Start of Shift — End of Shift)
        </h4>
        {dailyGpsLoading ? (
          <div className="h-[160px] flex items-center justify-center text-[10px] text-rmpg-500">Loading GPS mileage data...</div>
        ) : dailyGpsMileage.length > 0 ? (
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-rmpg-700 sticky top-0 bg-surface-raised">
                  <th className="text-left py-1 pr-2">Date</th>
                  <th className="text-left py-1 pr-2">Vehicle</th>
                  <th className="text-right py-1 pr-2 font-mono">GPS Miles</th>
                  <th className="text-right py-1 pr-2 font-mono">Points</th>
                  <th className="text-left py-1 pr-2">Shift Start</th>
                  <th className="text-left py-1">Shift End</th>
                </tr>
              </thead>
              <tbody>
                {dailyGpsMileage.map((d: any, i: number) => {
                  const startTime = d.shift_start ? d.shift_start.split(' ')[1]?.slice(0, 5) || d.shift_start : '—';
                  const endTime = d.shift_end ? d.shift_end.split(' ')[1]?.slice(0, 5) || d.shift_end : '—';
                  return (
                    <tr key={i} className="border-b border-rmpg-700/50 hover:bg-surface-sunken transition-colors duration-150">
                      <td className="py-1 pr-2 text-rmpg-200 font-mono">{d.date?.slice(5)}</td>
                      <td className="py-1 pr-2 text-rmpg-100 font-semibold">#{d.vehicle_number}</td>
                      <td className="py-1 pr-2 text-right text-[color:var(--sev-ok)] font-mono font-bold tabular-nums">{d.gps_miles?.toFixed(1)} mi</td>
                      <td className="py-1 pr-2 text-right text-rmpg-500 font-mono tabular-nums">{d.points_count}</td>
                      <td className="py-1 pr-2 text-rmpg-400 text-[9px]">{startTime}</td>
                      <td className="py-1 text-rmpg-400 text-[9px]">{endTime}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-[160px] flex items-center justify-center text-[10px] text-rmpg-500">
            No GPS mileage data available — vehicles must have assigned units with active GPS tracking
          </div>
        )}
      </div>

      {/* ROW 8: Top Maintenance Issues + Vehicle Lifecycle */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Top Maintenance Issues (Horizontal Bar Chart) */}
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Wrench className="w-3 h-3" /> Top Maintenance Issues
          </h4>
          {top_issues && top_issues.length > 0 ? (
            <div className="space-y-2">
              {top_issues.map((issue, idx) => {
                const maxCount = top_issues[0].count;
                const pct = maxCount > 0 ? (issue.count / maxCount) * 100 : 0;
                return (
                  <div key={issue.type} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-rmpg-300">{MAINTENANCE_TYPE_LABELS[issue.type] || issue.type}</span>
                      <span className="font-mono tabular-nums text-rmpg-400">
                        {issue.count}x &middot; {formatCostAbbrev(issue.total_cost)}
                      </span>
                    </div>
                    <div className="h-2 bg-surface-deep rounded-[1px] overflow-hidden">
                      <div
                        className="h-full rounded-[1px] transition-all duration-150"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: issueBarColors()[idx] || 'var(--text-muted)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-[10px] text-rmpg-500">No maintenance type data</div>
          )}
        </div>

        {/* Vehicle Lifecycle Table */}
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
          <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Activity className="w-3 h-3" /> Vehicle Lifecycle
          </h4>
          {lifecycle.length > 0 ? (
            <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-rmpg-700 sticky top-0 bg-surface-raised">
                    <th className="text-left py-1 pr-1">Vehicle</th>
                    <th className="text-right py-1 pr-1 font-mono">Age</th>
                    <th className="text-right py-1 pr-1 font-mono">Miles</th>
                    <th className="text-right py-1 pr-1 font-mono">$/Year</th>
                    <th className="text-right py-1 font-mono">Est. Life</th>
                  </tr>
                </thead>
                <tbody>
                  {lifecycle.map((v) => {
                    const lifeColor = v.estimated_remaining_life_years == null ? 'text-rmpg-400'
                      : v.estimated_remaining_life_years < 1 ? 'text-red-400'
                      : v.estimated_remaining_life_years < 3 ? 'text-amber-400'
                      : 'text-green-400';
                    return (
                      <tr key={v.id} className="border-b border-rmpg-700/50 hover:bg-surface-sunken transition-colors duration-150">
                        <td className="py-1 pr-1">
                          <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_DOT_COLORS[v.status] || 'var(--text-muted)' }} />
                            <span className="font-mono font-bold text-rmpg-100">{v.vehicle_number}</span>
                          </div>
                        </td>
                        <td className="py-1 pr-1 text-right font-mono tabular-nums text-rmpg-300">{v.age_years}y</td>
                        <td className="py-1 pr-1 text-right font-mono tabular-nums text-rmpg-300">
                          {v.current_mileage > 0 ? `${(v.current_mileage / 1000).toFixed(0)}k` : '--'}
                        </td>
                        <td className="py-1 pr-1 text-right font-mono tabular-nums text-rmpg-400">
                          {formatCostAbbrev(v.cost_per_year)}
                        </td>
                        <td className={`py-1 text-right font-mono font-bold tabular-nums ${lifeColor}`}>
                          {v.estimated_remaining_life_years != null ? `${v.estimated_remaining_life_years}y` : '--'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-[10px] text-rmpg-500">No lifecycle data available</div>
          )}
        </div>
      </div>

      {/* ROW 9: Vehicle Comparison Tool (Collapsible) */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px]">
        <button
          onClick={() => setCompareExpanded(!compareExpanded)}
          className="w-full flex items-center justify-between p-3 hover:bg-surface-sunken transition-colors duration-150"
        >
          <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider flex items-center gap-1.5">
            <Search className="w-3 h-3" /> Compare Vehicles
          </h4>
          {compareExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-rmpg-400" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-rmpg-400" />
          )}
        </button>
        {compareExpanded && (
          <div className="px-3 pb-3 space-y-3">
            {/* Vehicle selector */}
            <div>
              <div className="text-[8px] text-rmpg-400 uppercase tracking-wider mb-1.5">
                Select 2-5 vehicles to compare ({selectedIds.length} selected)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {allVehicles.map((v) => {
                  const isSelected = selectedIds.includes(v.id);
                  return (
                    <button
                      key={v.id}
                      onClick={() => toggleVehicleSelection(v.id)}
                      className={`px-2 py-1 text-[9px] font-mono rounded-[2px] border transition-colors duration-150
                        ${isSelected
                          ? 'bg-[color:var(--text-muted)] border-[color:var(--text-muted)] text-rmpg-100'
                          : 'bg-surface-sunken border-rmpg-700 text-rmpg-400 hover:text-rmpg-100 hover:border-rmpg-600'
                        }`}
                    >
                      {v.vehicle_number}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={handleCompare}
                  disabled={selectedIds.length < 2 || selectedIds.length > 5 || compareLoading}
                  className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider rounded-[2px] bg-[color:var(--text-muted)] text-rmpg-100 border border-[color:var(--text-muted)] hover:bg-rmpg-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
                >
                  {compareLoading ? 'Loading...' : 'Compare'}
                </button>
                {selectedIds.length > 0 && (
                  <button
                    onClick={() => { setSelectedIds([]); setComparisonResults([]); }}
                    className="px-2 py-1.5 text-[9px] text-rmpg-400 hover:text-rmpg-100 transition-colors duration-150"
                  >
                    <X className="w-3 h-3 inline mr-0.5" /> Clear
                  </button>
                )}
              </div>
            </div>

            {/* Comparison Results Table */}
            {comparisonResults.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-rmpg-700">
                      <th className="text-left py-1.5 pr-3 font-bold">Metric</th>
                      {comparisonResults.map((v) => (
                        <th key={v.id} className="text-right py-1.5 px-2 font-mono font-bold text-rmpg-100">{v.vehicle_number}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Make/Model */}
                    <tr className="border-b border-rmpg-700/50">
                      <td className="py-1.5 pr-3 text-rmpg-400">Make/Model</td>
                      {comparisonResults.map((v) => (
                        <td key={v.id} className="py-1.5 px-2 text-right text-rmpg-300">{v.make} {v.model} ({v.year})</td>
                      ))}
                    </tr>
                    {/* Total Cost */}
                    <tr className="border-b border-rmpg-700/50">
                      <td className="py-1.5 pr-3 text-rmpg-400">Total Cost</td>
                      {comparisonResults.map((v) => {
                        const best = getBestValue('total_cost', true);
                        return (
                          <td key={v.id} className={`py-1.5 px-2 text-right font-mono tabular-nums ${v.total_cost === best ? 'text-green-400 font-bold' : 'text-rmpg-300'}`}>
                            {formatCostAbbrev(v.total_cost)}
                          </td>
                        );
                      })}
                    </tr>
                    {/* Cost/Mile */}
                    <tr className="border-b border-rmpg-700/50">
                      <td className="py-1.5 pr-3 text-rmpg-400">Cost/Mile</td>
                      {comparisonResults.map((v) => {
                        const best = getBestValue('cost_per_mile', true);
                        return (
                          <td key={v.id} className={`py-1.5 px-2 text-right font-mono tabular-nums ${v.cost_per_mile === best ? 'text-green-400 font-bold' : 'text-rmpg-300'}`}>
                            {v.cost_per_mile != null ? `$${v.cost_per_mile.toFixed(3)}` : '--'}
                          </td>
                        );
                      })}
                    </tr>
                    {/* Avg MPG */}
                    <tr className="border-b border-rmpg-700/50">
                      <td className="py-1.5 pr-3 text-rmpg-400">Avg MPG</td>
                      {comparisonResults.map((v) => {
                        const best = getBestValue('avg_mpg', false);
                        return (
                          <td key={v.id} className={`py-1.5 px-2 text-right font-mono tabular-nums ${v.avg_mpg === best ? 'text-green-400 font-bold' : 'text-rmpg-300'}`}>
                            {v.avg_mpg != null ? v.avg_mpg.toFixed(1) : '--'}
                          </td>
                        );
                      })}
                    </tr>
                    {/* Mileage */}
                    <tr className="border-b border-rmpg-700/50">
                      <td className="py-1.5 pr-3 text-rmpg-400">Mileage</td>
                      {comparisonResults.map((v) => (
                        <td key={v.id} className="py-1.5 px-2 text-right font-mono tabular-nums text-rmpg-300">
                          {v.current_mileage ? v.current_mileage.toLocaleString() : '--'}
                        </td>
                      ))}
                    </tr>
                    {/* Inspections */}
                    <tr className="border-b border-rmpg-700/50">
                      <td className="py-1.5 pr-3 text-rmpg-400">Inspections</td>
                      {comparisonResults.map((v) => {
                        const best = getBestValue('inspection_pass_rate', false);
                        return (
                          <td key={v.id} className={`py-1.5 px-2 text-right font-mono tabular-nums ${v.inspection_pass_rate === best ? 'text-green-400 font-bold' : 'text-rmpg-300'}`}>
                            {v.inspection_count > 0
                              ? `${v.inspection_pass_rate?.toFixed(0) ?? '--'}% (${v.inspection_count})`
                              : '--'}
                          </td>
                        );
                      })}
                    </tr>
                    {/* Days Since Last Service */}
                    <tr className="border-b border-rmpg-700/50">
                      <td className="py-1.5 pr-3 text-rmpg-400">Days Since Service</td>
                      {comparisonResults.map((v) => {
                        const best = getBestValue('days_since_last_service', true);
                        return (
                          <td key={v.id} className={`py-1.5 px-2 text-right font-mono tabular-nums ${v.days_since_last_service === best ? 'text-green-400 font-bold' : 'text-rmpg-300'}`}>
                            {v.days_since_last_service != null ? `${v.days_since_last_service}d` : '--'}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ROW 10: Vehicle Health Dashboard */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider flex items-center gap-1.5">
            <Heart className="w-3 h-3" /> Vehicle Health Scores
          </h4>
          <select id="ff-fleetanalyticstab-0"
            value={healthSort}
            onChange={(e) => setHealthSort(e.target.value as 'score' | 'number' | 'age')}
            className="text-[9px] bg-surface-sunken border border-rmpg-700 rounded-[2px] text-rmpg-300 px-2 py-1 font-mono"
          >
            <option value="score">Sort: Worst First</option>
            <option value="number">Sort: Vehicle #</option>
            <option value="age">Sort: Oldest First</option>
          </select>
        </div>
        {sortedHealthScores.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {sortedHealthScores.map((v) => {
              const scoreColor = v.health_score >= 80 ? 'var(--sev-ok)' : v.health_score >= 40 ? 'var(--sev-warn)' : 'var(--sev-critical)';
              const circumference = 2 * Math.PI * 28;
              const strokeDash = (v.health_score / 100) * circumference;
              const badgeColors: Record<string, string> = {
                Excellent: 'text-green-400 bg-green-900/20 border-green-800/40',
                Good: 'text-rmpg-400 bg-surface-sunken/20 border-border-subtle/40',
                Fair: 'text-amber-400 bg-amber-900/20 border-amber-800/40',
                Poor: 'text-orange-400 bg-orange-900/20 border-orange-800/40',
                Critical: 'text-red-400 bg-red-900/20 border-red-800/40',
              };
              const factorLabels = ['age', 'mileage', 'service', 'inspection', 'cost'] as const;
              // Defensive: never crash the whole Analytics tab if a health-score
              // row arrives without a `factors` object (e.g. a leaner handler
              // response or a partial/stale payload). Fall back to the overall
              // score for every bar so the card still renders.
              const factors = v.factors ?? {
                age: v.health_score, mileage: v.health_score, service: v.health_score,
                inspection: v.health_score, cost: v.health_score,
              };
              return (
                <div key={v.vehicle_id} className="bg-surface-sunken border border-rmpg-700 rounded-[2px] p-2.5">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-[11px] font-mono font-bold text-rmpg-100">{v.vehicle_number}</div>
                      <div className="text-[8px] text-rmpg-400">{v.make} {v.model}</div>
                    </div>
                    <div className="relative w-16 h-16 flex-shrink-0">
                      <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                        <circle cx="32" cy="32" r="28" fill="none" stroke="var(--border-subtle)" strokeWidth="4" />
                        <circle
                          cx="32" cy="32" r="28" fill="none"
                          stroke={scoreColor} strokeWidth="4" strokeLinecap="round"
                          strokeDasharray={`${strokeDash} ${circumference}`}
                          className="transition-all duration-150"
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[14px] font-mono font-bold tabular-nums" style={{ color: scoreColor }}>
                          {v.health_score}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-0.5 mb-1.5">
                    {factorLabels.map((f) => (
                      <div key={f} className="flex-1" title={`${f}: ${factors[f]}`}>
                        <div className="h-1 bg-rmpg-700 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-150"
                            style={{
                              width: `${factors[f]}%`,
                              backgroundColor: factors[f] >= 80 ? 'var(--sev-ok)' : factors[f] >= 40 ? 'var(--sev-warn)' : 'var(--sev-critical)',
                            }}
                          />
                        </div>
                        <div className="text-[6px] text-rmpg-500 text-center mt-0.5 uppercase">{f.substring(0, 3)}</div>
                      </div>
                    ))}
                  </div>
                  <span className={`inline-block text-[7px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-[2px] border ${badgeColors[v.status_label] || ''}`}>
                    {v.status_label}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="h-[100px] flex items-center justify-center text-[10px] text-rmpg-500">No health score data available</div>
        )}
      </div>

      {/* ROW 11: Maintenance Schedule */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
        <div className="flex items-center gap-2 mb-3">
          <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider flex items-center gap-1.5">
            <Wrench className="w-3 h-3" /> Maintenance Schedule
          </h4>
          {overdueCount > 0 && (
            <span className="text-[8px] font-bold font-mono tabular-nums px-1.5 py-0.5 rounded-[2px] bg-red-900/20 border border-red-800/40 text-red-400">
              {overdueCount} urgent
            </span>
          )}
        </div>
        {maintSchedule.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-rmpg-700">
                  <th className="text-left py-1.5 pr-3 font-bold">Vehicle#</th>
                  <th className="text-left py-1.5 pr-3 font-bold">Service Type</th>
                  <th className="text-right py-1.5 px-2 font-bold">Due Date</th>
                  <th className="text-right py-1.5 px-2 font-bold">Due Miles</th>
                  <th className="text-center py-1.5 px-2 font-bold">Status</th>
                  <th className="text-right py-1.5 pl-2 font-bold">Urgency</th>
                </tr>
              </thead>
              <tbody>
                {maintSchedule.map((m) => {
                  const urgencyColors: Record<string, { dot: string; text: string }> = {
                    overdue: { dot: 'var(--sev-critical)', text: 'text-red-400' },
                    critical: { dot: 'var(--sev-warn)', text: 'text-amber-400' },
                    upcoming: { dot: 'var(--text-muted)', text: 'text-rmpg-400' },
                    ok: { dot: 'var(--sev-ok)', text: 'text-green-400' },
                  };
                  const uc = urgencyColors[m.urgency] || urgencyColors.ok;
                  return (
                    <tr key={`${m.vehicle_id}-${m.service_type}`} className="border-b border-rmpg-700/50 hover:bg-surface-sunken transition-colors duration-150">
                      <td className="py-1.5 pr-3 font-mono font-bold text-rmpg-100">{m.vehicle_number}</td>
                      <td className="py-1.5 pr-3 text-rmpg-300">{toDisplayLabel(m.service_type || '')}</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-rmpg-300">
                        {m.due_date || '--'}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-rmpg-300">
                        {m.due_mileage != null ? m.due_mileage.toLocaleString() : '--'}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ backgroundColor: uc.dot, boxShadow: `0 0 4px ${uc.dot}` }}
                        />
                      </td>
                      <td className={`py-1.5 pl-2 text-right font-mono font-bold uppercase text-[8px] tracking-wider ${uc.text}`}>
                        {m.urgency}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-[80px] flex items-center justify-center text-[10px] text-rmpg-500">No scheduled maintenance data</div>
        )}
      </div>

      {/* ROW 12: Driver Performance */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3">
        <h4 className="text-[9px] text-[color:var(--panel-header-color)] uppercase font-bold tracking-wider flex items-center gap-1.5 mb-3">
          <User className="w-3 h-3" /> Driver Performance
        </h4>
        {driverPerf.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-rmpg-700">
                  <th className="text-left py-1.5 pr-3 font-bold">Officer</th>
                  <th className="text-left py-1.5 pr-2 font-bold">Call Sign</th>
                  <th className="text-right py-1.5 px-2 font-bold">Miles</th>
                  <th className="text-right py-1.5 px-2 font-bold">Hours</th>
                  <th className="text-right py-1.5 px-2 font-bold">Idle%</th>
                  <th className="text-right py-1.5 px-2 font-bold">Avg Spd</th>
                  <th className="text-right py-1.5 px-2 font-bold">MPG</th>
                  <th className="text-right py-1.5 px-2 font-bold">Insp%</th>
                  <th className="text-right py-1.5 px-2 font-bold">Dmg</th>
                  <th className="text-right py-1.5 pl-2 font-bold">Score</th>
                </tr>
              </thead>
              <tbody>
                {driverPerf.map((d) => {
                  const scoreColor = d.overall_score >= 80 ? 'text-green-400' : d.overall_score >= 40 ? 'text-amber-400' : 'text-red-400';
                  return (
                    <tr key={d.call_sign} className="border-b border-rmpg-700/50 hover:bg-surface-sunken transition-colors duration-150">
                      <td className="py-1.5 pr-3 text-rmpg-300 truncate max-w-[120px]">{d.officer_name}</td>
                      <td className="py-1.5 pr-2 font-mono font-bold text-rmpg-100">{d.call_sign}</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-rmpg-300">{d.total_miles != null ? d.total_miles.toLocaleString() : '-'}</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-rmpg-300">{d.total_hours}</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-rmpg-300">
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block w-8 h-1 bg-rmpg-700 rounded-full overflow-hidden">
                            <span className="block h-full rounded-full" style={{ width: `${d.idle_pct}%`, backgroundColor: d.idle_pct > 60 ? 'var(--sev-critical)' : d.idle_pct > 30 ? 'var(--sev-warn)' : 'var(--sev-ok)' }} />
                          </span>
                          {d.idle_pct}%
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-rmpg-300">{d.avg_speed}</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-rmpg-300">{d.avg_mpg != null ? d.avg_mpg : '--'}</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-rmpg-300">{d.inspection_score}%</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-rmpg-300">{d.damage_count}</td>
                      <td className={`py-1.5 pl-2 text-right font-mono font-bold tabular-nums ${scoreColor}`}>{d.overall_score}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-[80px] flex items-center justify-center text-[10px] text-rmpg-500">No driver performance data available</div>
        )}
      </div>

      {/* Fleet Notifications & Alerts */}
      {notifications.length > 0 && (
        <div className="panel-beveled p-3 bg-surface-base">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Bell className="w-3 h-3" /> Fleet Alerts ({notifications.length})
          </h4>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {notifications.slice(0, 10).map((n: any, i: number) => (
              <div key={i} className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] ${n.severity === 'critical' ? 'bg-red-900/30 text-red-400' : 'bg-amber-900/30 text-amber-400'}`}>
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span className="min-w-0 truncate">{n.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Service Interval Alerts */}
      {serviceAlerts.length > 0 && (
        <div className="panel-beveled p-3 bg-surface-base">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Clock className="w-3 h-3" /> Service Intervals Due ({serviceAlerts.length})
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {serviceAlerts.slice(0, 8).map((a: any, i: number) => {
              // Never interpolate a possibly-absent value straight into a
              // template string: `${undefined}d` rendered the literal
              // "undefinedd" on live until the server started sending
              // days_until. Fall back to the due date, then to an em dash.
              const days = typeof a.days_until === 'number' && Number.isFinite(a.days_until)
                ? a.days_until : null;
              const due = days != null
                ? (days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`)
                : (a.due_date ? parseTimestamp(a.due_date).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '—');
              // vehicle_id alone is not unique — one vehicle can raise an
              // insurance AND a registration alert, which collided as a key.
              const label = toDisplayLabel(a.service_type || a.type || a.issue || '');
              return (
                <div key={`${a.vehicle_id ?? a.id ?? i}-${a.service_type ?? a.type ?? i}`} className={`flex items-center justify-between px-2 py-1.5 rounded text-[10px] border ${a.severity === 'overdue' ? 'bg-red-900/20 border-red-800/40 text-red-400' : a.severity === 'critical' ? 'bg-amber-900/20 border-amber-800/40 text-amber-400' : 'bg-surface-sunken/20 border-border-subtle/40 text-rmpg-400'}`}>
                  <span className="font-mono font-bold">{a.vehicle_number}</span>
                  <span>{label}</span>
                  <span className="font-mono">{due}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Inspection Stats */}
      {inspectionStats && (
        <div className="panel-beveled p-3 bg-surface-base">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <CheckCircle className="w-3 h-3" /> Inspection Pass/Fail Summary
          </h4>
          {/* Five columns only when a non-pass/fail result exists. Without the
              "Needs Attn" tile the tiles cannot reconcile: Total counts every
              inspection, so Pass + Fail alone silently fell short of it. */}
          <div className={`grid ${inspectionStats.other_count > 0 ? 'grid-cols-5' : 'grid-cols-4'} gap-2 mb-2`}>
            <div className="text-center p-1.5 bg-surface-sunken rounded">
              <div className="text-sm font-bold font-mono text-rmpg-400">{inspectionStats.total_inspections}</div>
              <div className="text-[7px] text-rmpg-500 uppercase">Total</div>
            </div>
            <div className="text-center p-1.5 bg-surface-sunken rounded">
              <div className="text-sm font-bold font-mono text-green-400">{inspectionStats.pass_count}</div>
              <div className="text-[7px] text-rmpg-500 uppercase">Pass</div>
            </div>
            <div className="text-center p-1.5 bg-surface-sunken rounded">
              <div className="text-sm font-bold font-mono text-red-400">{inspectionStats.fail_count}</div>
              <div className="text-[7px] text-rmpg-500 uppercase">Fail</div>
            </div>
            {inspectionStats.other_count > 0 && (
              <div
                className="text-center p-1.5 bg-surface-sunken rounded"
                title={Object.entries(inspectionStats.other_breakdown ?? {})
                  .map(([k, v]) => `${toDisplayLabel(k)}: ${v}`).join(', ')}
              >
                <div className="text-sm font-bold font-mono text-amber-400">{inspectionStats.other_count}</div>
                {/* Uses the muted foreground token rather than the sibling
                    tiles' rmpg ramp: that ramp is sub-AA and under a CI
                    ratchet (accentTokens.test.ts). */}
                <div className="text-[7px] text-fg-muted uppercase">Needs Attn</div>
              </div>
            )}
            <div className="text-center p-1.5 bg-surface-sunken rounded">
              <div className="text-sm font-bold font-mono text-brand-400">{inspectionStats.pass_rate}%</div>
              <div className="text-[7px] text-rmpg-500 uppercase">Pass Rate</div>
            </div>
          </div>
        </div>
      )}

      {/* Cost Per Mile Analytics */}
      {costAnalytics && (
        <div className="panel-beveled p-3 bg-surface-base">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3" /> Fleet Cost Per Mile
          </h4>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="text-center p-1.5 bg-surface-sunken rounded">
              <div className="text-sm font-bold font-mono text-green-400">${costAnalytics.fleet_avg_cost_per_mile?.toFixed(2) || '-'}</div>
              <div className="text-[7px] text-rmpg-500 uppercase">Avg $/Mile</div>
            </div>
            <div className="text-center p-1.5 bg-surface-sunken rounded">
              <div className="text-sm font-bold font-mono text-rmpg-400">${((costAnalytics.fleet_total_cost || 0) / 1000).toFixed(1)}k</div>
              <div className="text-[7px] text-rmpg-500 uppercase">Total Cost</div>
            </div>
            <div className="text-center p-1.5 bg-surface-sunken rounded">
              <div className="text-sm font-bold font-mono text-brand-400">{((costAnalytics.fleet_total_miles || 0) / 1000).toFixed(0)}k</div>
              <div className="text-[7px] text-rmpg-500 uppercase">Total Miles</div>
            </div>
          </div>
          {costAnalytics.vehicles?.length > 0 && (
            <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
              {costAnalytics.vehicles.filter((v: any) => v.cost_per_mile != null).slice(0, 15).sort((a: any, b: any) => (b.cost_per_mile || 0) - (a.cost_per_mile || 0)).map((v: any) => (
                <div key={v.id} className="flex items-center justify-between px-2 py-1 bg-surface-sunken rounded text-[10px]">
                  <span className="font-mono text-rmpg-100 font-bold">{v.vehicle_number}</span>
                  <span className="text-rmpg-400">{v.make} {v.model}</span>
                  <span className="font-mono text-green-400">${v.cost_per_mile?.toFixed(2)}/mi</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Overdue Inspections */}
      {overdueInspections.length > 0 && (
        <div className="panel-beveled p-3 bg-surface-base">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <XCircle className="w-3 h-3 text-red-400" /> Overdue Inspections ({overdueInspections.length})
          </h4>
          <div className="space-y-1 max-h-[150px] overflow-y-auto">
            {overdueInspections.slice(0, 10).map((a: any) => (
              <div key={a.id} className="flex items-center justify-between px-2 py-1.5 bg-red-900/20 rounded text-[10px] border border-red-800/30">
                <span className="font-mono text-rmpg-100 font-bold">{a.vehicle_number}</span>
                <span className="text-rmpg-400">{a.make} {a.model}</span>
                <span className={`font-mono ${a.severity === 'critical' ? 'text-red-400' : a.severity === 'never_inspected' ? 'text-amber-400' : 'text-amber-400'}`}>
                  {a.days_since_inspection != null ? `${a.days_since_inspection}d ago` : 'Never inspected'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fleet.io Sync Health */}
      {fleetioAnalytics && (
        <div className="panel-beveled p-3 bg-surface-base">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Activity className="w-3 h-3" /> Fleet.io Sync Health
          </h4>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {(fleetioAnalytics.link_coverage ?? []).map((lc: any) => (
              <div key={lc.rmpg_table} className="text-center p-1.5 bg-surface-sunken rounded">
                <div className={`text-sm font-bold font-mono ${lc.coverage_pct >= 90 ? 'text-green-400' : lc.coverage_pct >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                  {lc.coverage_pct}%
                </div>
                <div className="text-[7px] text-rmpg-500 uppercase">{toDisplayLabel(lc.rmpg_table)} linked ({lc.linked}/{lc.total})</div>
              </div>
            ))}
          </div>
          {(fleetioAnalytics.latency_by_resource ?? []).length > 0 && (
            <div className="space-y-0.5 mb-2">
              {fleetioAnalytics.latency_by_resource.map((r: any) => (
                <div key={r.resource} className="flex items-center justify-between px-2 py-1 bg-surface-sunken rounded text-[10px]">
                  <span className="font-mono text-rmpg-100 font-bold">{toDisplayLabel(r.resource)}</span>
                  <span className="text-rmpg-400">{r.n} synced (30d)</span>
                  <span className="font-mono text-brand-400">{r.avg_seconds != null ? `${Math.round(r.avg_seconds)}s avg` : '-'}</span>
                </div>
              ))}
            </div>
          )}
          {(fleetioAnalytics.conflict_trend_14d ?? []).length > 0 && (
            <div className="h-[100px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fleetioAnalytics.conflict_trend_14d}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="day" tick={{ fontSize: 8 }} />
                  <YAxis tick={{ fontSize: 8 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="n" name="Conflicts" fill="var(--sev-warn)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
