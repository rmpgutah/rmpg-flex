import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area, ScatterChart, Scatter,
} from 'recharts';
import {
  BarChart3, Car, Fuel, Wrench, DollarSign, AlertTriangle,
  Gauge, CheckCircle, ShieldAlert, TrendingUp, Calendar, Activity,
  Info, ChevronDown, ChevronUp, Search, X,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import type { FleetAnalytics, FleetServiceAlert } from '../../../types';

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#141e2b',
    border: '1px solid #1e3048',
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

const ISSUE_BAR_COLORS = ['#1a5a9e', '#2068b0', '#2b78c2', '#3888d4', '#d4a017'];

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
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 px-2 py-1.5 bg-[#0d1520] border border-[#1e3048] rounded-[2px] text-[8px] text-rmpg-300 font-normal normal-case tracking-normal shadow-lg pointer-events-none">
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
                ? 'bg-[#1a5a9e] border-[#1a5a9e] text-white'
                : 'bg-[#0d1520] border-[#1e3048] text-rmpg-400 hover:text-white hover:border-[#2a4060]'
              }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* ROW 1: KPI Cards with Tooltips */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {/* Total Fleet Costs */}
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
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
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
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
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
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
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
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
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <DollarSign className="w-3 h-3" /> Maintenance Cost Trend
          </h4>
          {maintenance_cost_trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={maintenance_cost_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#162236" />
                <XAxis dataKey="month" tick={{ fill: '#5a6e80', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#1e3048' }} />
                <YAxis tick={{ fill: '#5a6e80', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#1e3048' }}
                  tickFormatter={(v) => `$${v}`} />
                <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(value: any) => [`$${Number(value).toFixed(0)}`, 'Cost']} />
                <Bar dataKey="total_cost" fill="#1a5a9e" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-[10px] text-rmpg-500">No maintenance data</div>
          )}
        </div>

        {/* Fuel Economy Trend (Line Chart) */}
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Fuel className="w-3 h-3" /> Fuel Economy Trend
          </h4>
          {fuel_economy_trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={fuel_economy_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#162236" />
                <XAxis dataKey="month" tick={{ fill: '#5a6e80', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#1e3048' }} />
                <YAxis tick={{ fill: '#5a6e80', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#1e3048' }}
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
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3" /> Top Vehicles by Cost
          </h4>
          {(cost_per_mile_ranking && cost_per_mile_ranking.length > 0) ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-[#1e3048]">
                    <th className="text-left py-1 pr-2">Vehicle</th>
                    <th className="text-left py-1 pr-2">Make/Model</th>
                    <th className="text-right py-1 pr-2 font-mono">$/Mile</th>
                    <th className="text-right py-1 font-mono">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cost_per_mile_ranking.map((v) => (
                    <tr key={v.id} className="border-b border-[#1e3048]/50 hover:bg-[#0d1520] transition-colors duration-150">
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
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
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
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Gauge className="w-3 h-3" /> Mileage Distribution
          </h4>
          {mileage_distribution.some(d => d.count > 0) ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={mileage_distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#162236" />
                <XAxis dataKey="range" tick={{ fill: '#5a6e80', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#1e3048' }} />
                <YAxis tick={{ fill: '#5a6e80', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#1e3048' }} />
                <Tooltip {...CHART_TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="#4a90c4" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-[10px] text-rmpg-500">No data</div>
          )}
        </div>

        {/* Fleet Status (Donut) */}
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
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
                  <div className="mt-2 pt-2 border-t border-[#1e3048] text-[9px] text-rmpg-400">
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
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Activity className="w-3 h-3" /> Daily Fleet Utilization
          </h4>
          {daily_usage && daily_usage.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={daily_usage}>
                <defs>
                  <linearGradient id="utilGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1a5a9e" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#1a5a9e" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#162236" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#5a6e80', fontSize: 8 }}
                  tickLine={false}
                  axisLine={{ stroke: '#1e3048' }}
                  tickFormatter={(v) => {
                    const d = new Date(v + 'T00:00:00');
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  }}
                />
                <YAxis
                  tick={{ fill: '#5a6e80', fontSize: 9 }}
                  tickLine={false}
                  axisLine={{ stroke: '#1e3048' }}
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
                  stroke="#1a5a9e"
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
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Wrench className="w-3 h-3" /> Maintenance Forecast
          </h4>
          {maintenance_forecast && maintenance_forecast.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-[#1e3048]">
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
                      <tr key={v.id} className="border-b border-[#1e3048]/50 hover:bg-[#0d1520] transition-colors duration-150">
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
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
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
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
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
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
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
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Activity className="w-3 h-3 text-[#d4a017]" />
            <span className="text-[8px] text-[#d4a017] uppercase font-bold tracking-wider">Fleet Utilization</span>
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-[#d4a017]">
            {utilization ? `${utilization.rate}%` : '--'}
          </div>
          {utilization && (
            <div className="mt-1.5">
              <div className="h-1.5 bg-[#0d1520] rounded-[1px] overflow-hidden">
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
      <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
        <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
          <TrendingUp className="w-3 h-3" /> Combined Cost Trend (12 Months)
        </h4>
        {costTrendChartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={costTrendChartData}>
              <defs>
                <linearGradient id="maintGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1a5a9e" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="#1a5a9e" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="fuelGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#162236" />
              <XAxis dataKey="month" tick={{ fill: '#5a6e80', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#1e3048' }} />
              <YAxis tick={{ fill: '#5a6e80', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#1e3048' }}
                tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
              <Tooltip
                {...CHART_TOOLTIP_STYLE}
                formatter={(value: any, name: string) => {
                  const label = name === 'maintenance_cost' ? 'Maintenance' : name === 'fuel_cost' ? 'Fuel' : name;
                  return [`$${Number(value).toFixed(0)}`, label];
                }}
              />
              <Area type="monotone" dataKey="maintenance_cost" stackId="1" stroke="#1a5a9e" strokeWidth={2} fill="url(#maintGradient)" />
              <Area type="monotone" dataKey="fuel_cost" stackId="1" stroke="#22c55e" strokeWidth={2} fill="url(#fuelGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[220px] flex items-center justify-center text-[10px] text-rmpg-500">No cost trend data available</div>
        )}
        <div className="flex items-center gap-4 mt-2">
          <div className="flex items-center gap-1.5 text-[8px]">
            <div className="w-3 h-1.5 bg-[#1a5a9e] rounded-[1px]" />
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
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
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
                    <div className="h-2 bg-[#0d1520] rounded-[1px] overflow-hidden">
                      <div
                        className="h-full rounded-[1px] transition-all duration-150"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: ISSUE_BAR_COLORS[idx] || '#1a5a9e',
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
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
          <h4 className="text-[9px] text-[#d4a017] uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Activity className="w-3 h-3" /> Vehicle Lifecycle
          </h4>
          {lifecycle.length > 0 ? (
            <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-[#1e3048] sticky top-0 bg-[#141e2b]">
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
                      <tr key={v.id} className="border-b border-[#1e3048]/50 hover:bg-[#0d1520] transition-colors duration-150">
                        <td className="py-1 pr-1">
                          <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_DOT_COLORS[v.status] || '#6b7280' }} />
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
      <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px]">
        <button
          onClick={() => setCompareExpanded(!compareExpanded)}
          className="w-full flex items-center justify-between p-3 hover:bg-[#0d1520] transition-colors duration-150"
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
                          ? 'bg-[#1a5a9e] border-[#1a5a9e] text-white'
                          : 'bg-[#0d1520] border-[#1e3048] text-rmpg-400 hover:text-white hover:border-[#2a4060]'
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
                  className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider rounded-[2px] bg-[#1a5a9e] text-white border border-[#1a5a9e] hover:bg-[#2068b0] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
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
                    <tr className="text-rmpg-400 uppercase text-[8px] tracking-wider border-b border-[#1e3048]">
                      <th className="text-left py-1.5 pr-3 font-bold">Metric</th>
                      {comparisonResults.map((v) => (
                        <th key={v.id} className="text-right py-1.5 px-2 font-mono font-bold text-white">{v.vehicle_number}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Make/Model */}
                    <tr className="border-b border-[#1e3048]/50">
                      <td className="py-1.5 pr-3 text-rmpg-400">Make/Model</td>
                      {comparisonResults.map((v) => (
                        <td key={v.id} className="py-1.5 px-2 text-right text-rmpg-300">{v.make} {v.model} ({v.year})</td>
                      ))}
                    </tr>
                    {/* Total Cost */}
                    <tr className="border-b border-[#1e3048]/50">
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
                    <tr className="border-b border-[#1e3048]/50">
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
                    <tr className="border-b border-[#1e3048]/50">
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
                    <tr className="border-b border-[#1e3048]/50">
                      <td className="py-1.5 pr-3 text-rmpg-400">Mileage</td>
                      {comparisonResults.map((v) => (
                        <td key={v.id} className="py-1.5 px-2 text-right font-mono tabular-nums text-rmpg-300">
                          {v.current_mileage ? v.current_mileage.toLocaleString() : '--'}
                        </td>
                      ))}
                    </tr>
                    {/* Inspections */}
                    <tr className="border-b border-[#1e3048]/50">
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
                    <tr className="border-b border-[#1e3048]/50">
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
    </div>
  );
}
