import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area, ScatterChart, Scatter,
} from 'recharts';
import {
  BarChart3, Car, Fuel, Wrench, DollarSign, AlertTriangle, XCircle,
  Gauge, CheckCircle, ShieldAlert, TrendingUp, Calendar, Activity,
  Info, ChevronDown, ChevronUp, Search, X, Heart, Clock, User, Bell,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import type { FleetAnalytics, FleetServiceAlert } from '../../../types';

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#0a0a0a',
    border: '1px solid #222222',
    color: '#e0e0e0',
    fontSize: 10,
    fontFamily: 'Consolas, monospace',
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

const ISSUE_BAR_COLORS = ['#888888', '#555555', '#666666', '#888888', '#d4a017'];

const STATUS_DOT_COLORS: Record<string, string> = {
  in_service: '#22c55e',
  maintenance: '#f59e0b',
  out_of_service: '#ef4444',
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
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 px-2 py-1.5 bg-[#050505] border border-[#222222] rounded-[2px] text-[8px] text-rmpg-300 font-normal normal-case tracking-normal shadow-lg pointer-events-none">
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

  useEffect(() => {
    apiFetch<any>('/fleet/fleet-cost-analytics').then((d: any) => d && setCostAnalytics(d)).catch(() => {});
    apiFetch<any>('/fleet/inspection-stats').then((d: any) => d && setInspectionStats(d)).catch(() => {});
    apiFetch<any>('/fleet/notifications').then((d: any) => d?.notifications && setNotifications(d.notifications)).catch(() => {});
    apiFetch<any>('/fleet/overdue-inspections').then((d: any) => d?.alerts && setOverdueInspections(d.alerts)).catch(() => {});
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
    maintenance_cost_trend, mileage_distribution, status_breakdown,
    fuel_economy_trend, fleet_summary, cost_per_mile_ranking,
    service_compliance, inspection_pass_rate, utilization,
    daily_usage, maintenance_forecast, oldest_vehicle_year, avg_daily_miles,
    top_issues,
  } = analytics;

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
    <div className="flex-1 overflow-y-auto p-4 space-y-3">

      {/* Period Filter */}
      <div className="flex items-center gap-1.5">
        <Calendar className="w-3 h-3 text-[#d4a017]" />
        <span className="text-[8px] text-[#d4a017] uppercase font-bold tracking-wider mr-2">Period</span>
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handlePeriodChange(opt.value)}
            className={`px-2.5 py-1 text-[9px] font-mono font-bold tracking-wider rounded-[2px] border transition-colors duration-150
              ${period === opt.value
                ? 'bg-[#888888] border-[#888888] text-white'
                : 'bg-[#050505] border-[#222222] text-rmpg-400 hover:text-white hover:border-[#2a4060]'
              }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* ROW 1: KPI Cards with Tooltips */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {/* Total Fleet Costs */}
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="w-3 h-3 text-[#d4a017]" />
            <span className="text-[8px] text-[#d4a017] uppercase font-bold tracking-wider">Total Fleet Costs</span>
            <InfoTooltip text={KPI_TOOLTIPS.total_fleet_costs} />
          </div>
          <div className="text-xl font-bold font-mono text-white tabular-nums">
            ${totalCosts >= 1000 ? `${(totalCosts / 1000).toFixed(1)}k` : totalCosts.toFixed(0)}
          </div>
          <div className="flex gap-3 mt-1 text-[8px] text-rmpg-400 font-mono tabular-nums">
            <span>Maint: ${(fleet_summary.total_maintenance_cost / 1000).toFixed(1)}k</span>
            <span>Fuel: ${(fleet_summary.total_fuel_cost / 1000).toFixed(1)}k</span>
          </div>
        </div>

        {/* Average MPG */}
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Fuel className="w-3 h-3 text-[#d4a017]" />
            <span className="text-[8px] text-[#d4a017] uppercase font-bold tracking-wider">Average MPG</span>
            <InfoTooltip text={KPI_TOOLTIPS.average_mpg} />
          </div>
          <div className="text-xl font-bold font-mono text-white tabular-nums">
            {fleet_summary.avg_mpg != null ? fleet_summary.avg_mpg.toFixed(1) : '--'}
          </div>
          <div className="text-[8px] text-rmpg-400 mt-1">Fleet-wide fuel economy</div>
        </div>

        {/* Service Compliance */}
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Wrench className="w-3 h-3 text-[#d4a017]" />
            <span className="text-[8px] text-[#d4a017] uppercase font-bold tracking-wider">Service Compliance</span>
            <InfoTooltip text={KPI_TOOLTIPS.service_compliance} />
          </div>
          <div className={`text-xl font-bold font-mono tabular-nums ${complianceRate >= 80 ? 'text-green-400' : complianceRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
            {complianceRate.toFixed(1)}%
          </div>
          <div className="text-[8px] text-rmpg-400 mt-1 font-mono tabular-nums">
            {service_compliance ? `${service_compliance.compliant} ok / ${service_compliance.overdue} overdue` : '--'}
          </div>
        </div>

        {/* Inspection Pass Rate */}
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle className="w-3 h-3 text-[#d4a017]" />
            <span className="text-[8px] text-[#d4a017] uppercase font-bold tracking-wider">Inspection Pass Rate</span>
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
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <DollarSign className="w-3 h-3" /> Maintenance Cost Trend
          </h4>
          {maintenance_cost_trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={maintenance_cost_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#181818" />
                <XAxis dataKey="month" tick={{ fill: '#666666', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#222222' }} />
                <YAxis tick={{ fill: '#666666', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#222222' }}
                  tickFormatter={(v) => `$${v}`} />
                <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(value: any) => [`$${Number(value).toFixed(0)}`, 'Cost']} />
                <Bar dataKey="total_cost" fill="#888888" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-[10px] text-rmpg-500">No maintenance data</div>
          )}
        </div>

        {/* Fuel Economy Trend (Line Chart) */}
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Fuel className="w-3 h-3" /> Fuel Economy Trend
          </h4>
          {fuel_economy_trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={fuel_economy_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#181818" />
                <XAxis dataKey="month" tick={{ fill: '#666666', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#222222' }} />
                <YAxis tick={{ fill: '#666666', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#222222' }}
                  tickFormatter={(v) => `${v} mpg`} />
                <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(value: any) => [value != null ? `${value} mpg` : 'N/A', 'Avg MPG']} />
                <Line type="monotone" dataKey="avg_mpg" stroke="#22c55e" strokeWidth={2} dot={{ r: 3, fill: '#22c55e' }} connectNulls />
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
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3" /> Top Vehicles by Cost
          </h4>
          {(cost_per_mile_ranking && cost_per_mile_ranking.length > 0) ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-[#222222]">
                    <th className="text-left py-1 pr-2">Vehicle</th>
                    <th className="text-left py-1 pr-2">Make/Model</th>
                    <th className="text-right py-1 pr-2 font-mono">$/Mile</th>
                    <th className="text-right py-1 font-mono">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cost_per_mile_ranking.map((v) => (
                    <tr key={v.id} className="border-b border-[#222222]/50 hover:bg-[#050505] transition-colors duration-150">
                      <td className="py-1 pr-2 font-mono font-bold text-white">{v.vehicle_number}</td>
                      <td className="py-1 pr-2 text-rmpg-400">{v.make} {v.model}</td>
                      <td className="py-1 pr-2 text-right font-mono tabular-nums text-green-400">
                        {v.cost_per_mile != null ? `$${v.cost_per_mile.toFixed(2)}` : '--'}
                      </td>
                      <td className="py-1 text-right font-mono tabular-nums text-cyan-400">
                        ${v.total_cost >= 1000 ? `${(v.total_cost / 1000).toFixed(1)}k` : v.total_cost.toFixed(0)}
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

        {/* Service Alerts */}
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
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
                    <span className="font-mono font-bold text-white">{alert.vehicle_number}</span>
                    <span className={`${sev.text} truncate mx-2`}>{alert.issue}</span>
                    <span className="font-mono tabular-nums text-rmpg-400 shrink-0">
                      {alert.due_date ? new Date(alert.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '--'}
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

      {/* ROW 4: Mileage Distribution + Fleet Status */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Mileage Distribution (Bar Chart) */}
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Gauge className="w-3 h-3" /> Mileage Distribution
          </h4>
          {mileage_distribution.some(d => d.count > 0) ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={mileage_distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#181818" />
                <XAxis dataKey="range" tick={{ fill: '#666666', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#222222' }} />
                <YAxis tick={{ fill: '#666666', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#222222' }} />
                <Tooltip {...CHART_TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="#4a90c4" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-[10px] text-rmpg-500">No data</div>
          )}
        </div>

        {/* Fleet Status (Donut) */}
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
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
                    <span className="ml-auto font-mono font-bold tabular-nums text-white">{s.count}</span>
                  </div>
                ))}
                {utilization && (
                  <div className="mt-2 pt-2 border-t border-[#222222] text-[9px] text-rmpg-400">
                    <span>Utilization: </span>
                    <span className="font-mono font-bold text-[#d4a017] tabular-nums">{utilization.rate}%</span>
                    <span className="ml-1">({utilization.assigned} assigned)</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-[10px] text-rmpg-500">No data</div>
          )}
        </div>
      </div>

      {/* ROW 5: Daily Fleet Utilization + Maintenance Forecast */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Daily Fleet Utilization (Area Chart) */}
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Activity className="w-3 h-3" /> Daily Fleet Utilization
          </h4>
          {daily_usage && daily_usage.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={daily_usage}>
                <defs>
                  <linearGradient id="utilGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#888888" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#888888" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#181818" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#666666', fontSize: 8 }}
                  tickLine={false}
                  axisLine={{ stroke: '#222222' }}
                  tickFormatter={(v) => {
                    const d = new Date(v + 'T00:00:00');
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  }}
                />
                <YAxis
                  tick={{ fill: '#666666', fontSize: 9 }}
                  tickLine={false}
                  axisLine={{ stroke: '#222222' }}
                  allowDecimals={false}
                />
                <Tooltip
                  {...CHART_TOOLTIP_STYLE}
                  formatter={(value: any, name: string) => [value, name === 'active_vehicles' ? 'Active Vehicles' : name]}
                  labelFormatter={(label) => {
                    const d = new Date(label + 'T00:00:00');
                    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="active_vehicles"
                  stroke="#888888"
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
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Wrench className="w-3 h-3" /> Maintenance Forecast
          </h4>
          {maintenance_forecast && maintenance_forecast.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-[#222222]">
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
                      <tr key={v.id} className="border-b border-[#222222]/50 hover:bg-[#050505] transition-colors duration-150">
                        <td className="py-1 pr-2 font-mono font-bold text-white">{v.vehicle_number}</td>
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
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Gauge className="w-3 h-3 text-[#d4a017]" />
            <span className="text-[8px] text-[#d4a017] uppercase font-bold tracking-wider">Avg Daily Miles</span>
          </div>
          <div className="text-lg font-bold font-mono text-white tabular-nums">
            {avg_daily_miles != null && avg_daily_miles > 0 ? avg_daily_miles.toFixed(1) : '--'}
          </div>
          <div className="text-[8px] text-rmpg-400 mt-1">Fleet avg from fuel logs</div>
        </div>

        {/* Total Vehicles */}
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Car className="w-3 h-3 text-[#d4a017]" />
            <span className="text-[8px] text-[#d4a017] uppercase font-bold tracking-wider">Total Vehicles</span>
          </div>
          <div className="text-lg font-bold font-mono text-white tabular-nums">
            {fleet_summary.total_vehicles}
          </div>
          <div className="text-[8px] text-rmpg-400 mt-1">Registered in fleet</div>
        </div>

        {/* Oldest Vehicle */}
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Calendar className="w-3 h-3 text-[#d4a017]" />
            <span className="text-[8px] text-[#d4a017] uppercase font-bold tracking-wider">Oldest Vehicle</span>
          </div>
          <div className="text-lg font-bold font-mono text-white tabular-nums">
            {oldest_vehicle_year ?? '--'}
          </div>
          <div className="text-[8px] text-rmpg-400 mt-1">Model year (non-retired)</div>
        </div>

        {/* Fleet Utilization */}
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Activity className="w-3 h-3 text-[#d4a017]" />
            <span className="text-[8px] text-[#d4a017] uppercase font-bold tracking-wider">Fleet Utilization</span>
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-[#d4a017]">
            {utilization ? `${utilization.rate}%` : '--'}
          </div>
          {utilization && (
            <div className="mt-1.5">
              <div className="h-1.5 bg-[#050505] rounded-[1px] overflow-hidden">
                <div
                  className="h-full rounded-[1px] transition-all duration-150"
                  style={{
                    width: `${Math.min(utilization.rate, 100)}%`,
                    backgroundColor: utilization.rate >= 80 ? '#22c55e' : utilization.rate >= 50 ? '#f59e0b' : '#ef4444',
                  }}
                />
              </div>
              <div className="text-[7px] text-rmpg-500 mt-0.5 font-mono tabular-nums">
                {utilization.assigned} / {utilization.assigned + utilization.unassigned} assigned
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ROW 7: Combined Cost Trend (Full Width) */}
      <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
        <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
          <TrendingUp className="w-3 h-3" /> Combined Cost Trend (12 Months)
        </h4>
        {costTrendChartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={costTrendChartData}>
              <defs>
                <linearGradient id="maintGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#888888" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="#888888" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="fuelGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#181818" />
              <XAxis dataKey="month" tick={{ fill: '#666666', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#222222' }} />
              <YAxis tick={{ fill: '#666666', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#222222' }}
                tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
              <Tooltip
                {...CHART_TOOLTIP_STYLE}
                formatter={(value: any, name: string) => {
                  const label = name === 'maintenance_cost' ? 'Maintenance' : name === 'fuel_cost' ? 'Fuel' : name;
                  return [`$${Number(value).toFixed(0)}`, label];
                }}
              />
              <Area type="monotone" dataKey="maintenance_cost" stackId="1" stroke="#888888" strokeWidth={2} fill="url(#maintGradient)" />
              <Area type="monotone" dataKey="fuel_cost" stackId="1" stroke="#22c55e" strokeWidth={2} fill="url(#fuelGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[220px] flex items-center justify-center text-[10px] text-rmpg-500">No cost trend data available</div>
        )}
        <div className="flex items-center gap-4 mt-2">
          <div className="flex items-center gap-1.5 text-[8px]">
            <div className="w-3 h-1.5 bg-[#888888] rounded-[1px]" />
            <span className="text-rmpg-400">Maintenance</span>
          </div>
          <div className="flex items-center gap-1.5 text-[8px]">
            <div className="w-3 h-1.5 bg-[#22c55e] rounded-[1px]" />
            <span className="text-rmpg-400">Fuel</span>
          </div>
        </div>
      </div>

      {/* ROW 8: Top Maintenance Issues + Vehicle Lifecycle */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Top Maintenance Issues (Horizontal Bar Chart) */}
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
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
                        {issue.count}x &middot; ${issue.total_cost >= 1000 ? `${(issue.total_cost / 1000).toFixed(1)}k` : (issue.total_cost || 0).toFixed(0)}
                      </span>
                    </div>
                    <div className="h-2 bg-[#050505] rounded-[1px] overflow-hidden">
                      <div
                        className="h-full rounded-[1px] transition-all duration-150"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: ISSUE_BAR_COLORS[idx] || '#888888',
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
        <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Activity className="w-3 h-3" /> Vehicle Lifecycle
          </h4>
          {lifecycle.length > 0 ? (
            <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-[#222222] sticky top-0 bg-[#0a0a0a]">
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
                      <tr key={v.id} className="border-b border-[#222222]/50 hover:bg-[#050505] transition-colors duration-150">
                        <td className="py-1 pr-1">
                          <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_DOT_COLORS[v.status] || '#666666' }} />
                            <span className="font-mono font-bold text-white">{v.vehicle_number}</span>
                          </div>
                        </td>
                        <td className="py-1 pr-1 text-right font-mono tabular-nums text-rmpg-300">{v.age_years}y</td>
                        <td className="py-1 pr-1 text-right font-mono tabular-nums text-rmpg-300">
                          {v.current_mileage > 0 ? `${(v.current_mileage / 1000).toFixed(0)}k` : '--'}
                        </td>
                        <td className="py-1 pr-1 text-right font-mono tabular-nums text-cyan-400">
                          ${v.cost_per_year >= 1000 ? `${(v.cost_per_year / 1000).toFixed(1)}k` : v.cost_per_year}
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
      <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px]">
        <button
          onClick={() => setCompareExpanded(!compareExpanded)}
          className="w-full flex items-center justify-between p-3 hover:bg-[#050505] transition-colors duration-150"
        >
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider flex items-center gap-1.5">
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
                          ? 'bg-[#888888] border-[#888888] text-white'
                          : 'bg-[#050505] border-[#222222] text-rmpg-400 hover:text-white hover:border-[#2a4060]'
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
                  className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider rounded-[2px] bg-[#888888] text-white border border-[#888888] hover:bg-[#2068b0] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
                >
                  {compareLoading ? 'Loading...' : 'Compare'}
                </button>
                {selectedIds.length > 0 && (
                  <button
                    onClick={() => { setSelectedIds([]); setComparisonResults([]); }}
                    className="px-2 py-1.5 text-[9px] text-rmpg-400 hover:text-white transition-colors duration-150"
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
                    <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-[#222222]">
                      <th className="text-left py-1.5 pr-3 font-bold">Metric</th>
                      {comparisonResults.map((v) => (
                        <th key={v.id} className="text-right py-1.5 px-2 font-mono font-bold text-white">{v.vehicle_number}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Make/Model */}
                    <tr className="border-b border-[#222222]/50">
                      <td className="py-1.5 pr-3 text-rmpg-400">Make/Model</td>
                      {comparisonResults.map((v) => (
                        <td key={v.id} className="py-1.5 px-2 text-right text-rmpg-300">{v.make} {v.model} ({v.year})</td>
                      ))}
                    </tr>
                    {/* Total Cost */}
                    <tr className="border-b border-[#222222]/50">
                      <td className="py-1.5 pr-3 text-rmpg-400">Total Cost</td>
                      {comparisonResults.map((v) => {
                        const best = getBestValue('total_cost', true);
                        return (
                          <td key={v.id} className={`py-1.5 px-2 text-right font-mono tabular-nums ${v.total_cost === best ? 'text-green-400 font-bold' : 'text-rmpg-300'}`}>
                            ${v.total_cost >= 1000 ? `${(v.total_cost / 1000).toFixed(1)}k` : v.total_cost.toFixed(0)}
                          </td>
                        );
                      })}
                    </tr>
                    {/* Cost/Mile */}
                    <tr className="border-b border-[#222222]/50">
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
                    <tr className="border-b border-[#222222]/50">
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
                    <tr className="border-b border-[#222222]/50">
                      <td className="py-1.5 pr-3 text-rmpg-400">Mileage</td>
                      {comparisonResults.map((v) => (
                        <td key={v.id} className="py-1.5 px-2 text-right font-mono tabular-nums text-rmpg-300">
                          {v.current_mileage ? v.current_mileage.toLocaleString() : '--'}
                        </td>
                      ))}
                    </tr>
                    {/* Inspections */}
                    <tr className="border-b border-[#222222]/50">
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
                    <tr className="border-b border-[#222222]/50">
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
      <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider flex items-center gap-1.5">
            <Heart className="w-3 h-3" /> Vehicle Health Scores
          </h4>
          <select
            value={healthSort}
            onChange={(e) => setHealthSort(e.target.value as 'score' | 'number' | 'age')}
            className="text-[9px] bg-[#050505] border border-[#222222] rounded-[2px] text-rmpg-300 px-2 py-1 font-mono"
          >
            <option value="score">Sort: Worst First</option>
            <option value="number">Sort: Vehicle #</option>
            <option value="age">Sort: Oldest First</option>
          </select>
        </div>
        {sortedHealthScores.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {sortedHealthScores.map((v) => {
              const scoreColor = v.health_score >= 80 ? '#22c55e' : v.health_score >= 40 ? '#f59e0b' : '#ef4444';
              const circumference = 2 * Math.PI * 28;
              const strokeDash = (v.health_score / 100) * circumference;
              const badgeColors: Record<string, string> = {
                Excellent: 'text-green-400 bg-green-900/20 border-green-800/40',
                Good: 'text-gray-400 bg-gray-900/20 border-gray-800/40',
                Fair: 'text-amber-400 bg-amber-900/20 border-amber-800/40',
                Poor: 'text-orange-400 bg-orange-900/20 border-orange-800/40',
                Critical: 'text-red-400 bg-red-900/20 border-red-800/40',
              };
              const factorLabels = ['age', 'mileage', 'service', 'inspection', 'cost'] as const;
              return (
                <div key={v.vehicle_id} className="bg-[#050505] border border-[#222222] rounded-[2px] p-2.5">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-[11px] font-mono font-bold text-white">{v.vehicle_number}</div>
                      <div className="text-[8px] text-rmpg-400">{v.make} {v.model}</div>
                    </div>
                    <div className="relative w-16 h-16 flex-shrink-0">
                      <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                        <circle cx="32" cy="32" r="28" fill="none" stroke="#222222" strokeWidth="4" />
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
                      <div key={f} className="flex-1" title={`${f}: ${v.factors[f]}`}>
                        <div className="h-1 bg-[#222222] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-150"
                            style={{
                              width: `${v.factors[f]}%`,
                              backgroundColor: v.factors[f] >= 80 ? '#22c55e' : v.factors[f] >= 40 ? '#f59e0b' : '#ef4444',
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
      <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
        <div className="flex items-center gap-2 mb-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider flex items-center gap-1.5">
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
                <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-[#222222]">
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
                    overdue: { dot: '#ef4444', text: 'text-red-400' },
                    critical: { dot: '#f59e0b', text: 'text-amber-400' },
                    upcoming: { dot: '#888888', text: 'text-gray-400' },
                    ok: { dot: '#22c55e', text: 'text-green-400' },
                  };
                  const uc = urgencyColors[m.urgency] || urgencyColors.ok;
                  return (
                    <tr key={`${m.vehicle_id}-${m.service_type}`} className="border-b border-[#222222]/50 hover:bg-[#050505] transition-colors duration-150">
                      <td className="py-1.5 pr-3 font-mono font-bold text-white">{m.vehicle_number}</td>
                      <td className="py-1.5 pr-3 text-rmpg-300">{(m.service_type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</td>
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
      <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] p-3">
        <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider flex items-center gap-1.5 mb-3">
          <User className="w-3 h-3" /> Driver Performance
        </h4>
        {driverPerf.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-[#222222]">
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
                    <tr key={d.call_sign} className="border-b border-[#222222]/50 hover:bg-[#050505] transition-colors duration-150">
                      <td className="py-1.5 pr-3 text-rmpg-300 truncate max-w-[120px]">{d.officer_name}</td>
                      <td className="py-1.5 pr-2 font-mono font-bold text-white">{d.call_sign}</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-rmpg-300">{d.total_miles.toLocaleString()}</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-rmpg-300">{d.total_hours}</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-rmpg-300">
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block w-8 h-1 bg-[#222222] rounded-full overflow-hidden">
                            <span className="block h-full rounded-full" style={{ width: `${d.idle_pct}%`, backgroundColor: d.idle_pct > 60 ? '#ef4444' : d.idle_pct > 30 ? '#f59e0b' : '#22c55e' }} />
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
                <span className="truncate">{n.message}</span>
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
            {serviceAlerts.slice(0, 8).map((a: any) => (
              <div key={a.vehicle_id} className={`flex items-center justify-between px-2 py-1.5 rounded text-[10px] border ${a.severity === 'overdue' ? 'bg-red-900/20 border-red-800/40 text-red-400' : a.severity === 'critical' ? 'bg-amber-900/20 border-amber-800/40 text-amber-400' : 'bg-gray-900/20 border-gray-800/40 text-gray-400'}`}>
                <span className="font-mono font-bold">{a.vehicle_number}</span>
                <span>{(a.service_type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                <span className="font-mono">{a.days_until < 0 ? `${Math.abs(a.days_until)}d overdue` : `${a.days_until}d`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inspection Stats */}
      {inspectionStats && (
        <div className="panel-beveled p-3 bg-surface-base">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <CheckCircle className="w-3 h-3" /> Inspection Pass/Fail Summary
          </h4>
          <div className="grid grid-cols-4 gap-2 mb-2">
            <div className="text-center p-1.5 bg-surface-sunken rounded">
              <div className="text-sm font-bold font-mono text-cyan-400">{inspectionStats.total_inspections}</div>
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
              <div className="text-sm font-bold font-mono text-cyan-400">${(costAnalytics.fleet_total_cost / 1000).toFixed(1)}k</div>
              <div className="text-[7px] text-rmpg-500 uppercase">Total Cost</div>
            </div>
            <div className="text-center p-1.5 bg-surface-sunken rounded">
              <div className="text-sm font-bold font-mono text-brand-400">{(costAnalytics.fleet_total_miles / 1000).toFixed(0)}k</div>
              <div className="text-[7px] text-rmpg-500 uppercase">Total Miles</div>
            </div>
          </div>
          {costAnalytics.vehicles?.length > 0 && (
            <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
              {costAnalytics.vehicles.filter((v: any) => v.cost_per_mile != null).slice(0, 15).sort((a: any, b: any) => (b.cost_per_mile || 0) - (a.cost_per_mile || 0)).map((v: any) => (
                <div key={v.id} className="flex items-center justify-between px-2 py-1 bg-surface-sunken rounded text-[10px]">
                  <span className="font-mono text-white font-bold">{v.vehicle_number}</span>
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
                <span className="font-mono text-white font-bold">{a.vehicle_number}</span>
                <span className="text-rmpg-400">{a.make} {a.model}</span>
                <span className={`font-mono ${a.severity === 'critical' ? 'text-red-400' : a.severity === 'never_inspected' ? 'text-amber-400' : 'text-amber-400'}`}>
                  {a.days_since_inspection != null ? `${a.days_since_inspection}d ago` : 'Never inspected'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
