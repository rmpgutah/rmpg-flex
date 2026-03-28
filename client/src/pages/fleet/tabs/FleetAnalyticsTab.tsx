import React, { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts';
import {
  BarChart3, Car, Fuel, Wrench, DollarSign, AlertTriangle,
  Gauge, CheckCircle, ShieldAlert, TrendingUp,
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

interface Props {
  analytics: FleetAnalytics | null;
  loading?: boolean;
}

export default function FleetAnalyticsTab({ analytics, loading }: Props) {
  useEffect(() => { document.title = 'Fleet - Analytics \u2014 RMPG Flex'; }, []);

  // Service alerts from dedicated endpoint
  const [serviceAlerts, setServiceAlerts] = useState<FleetServiceAlert[]>([]);

  useEffect(() => {
    apiFetch<{ all_alerts: FleetServiceAlert[] }>('/fleet/service-alerts')
      .then((d) => d?.all_alerts && setServiceAlerts(d.all_alerts))
      .catch(() => {});
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
  } = analytics;

  const totalCosts = (fleet_summary.total_maintenance_cost || 0) + (fleet_summary.total_fuel_cost || 0);
  const complianceRate = service_compliance?.rate ?? 100;
  const inspPassRate = inspection_pass_rate?.rate ?? 100;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">

      {/* ═══ ROW 1: KPI Cards ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {/* Total Fleet Costs */}
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-[2px] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="w-3 h-3 text-[#d4a017]" />
            <span className="text-[8px] text-[#d4a017] uppercase font-bold tracking-wider">Total Fleet Costs</span>
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
          </div>
          <div className={`text-xl font-bold font-mono tabular-nums ${inspPassRate >= 80 ? 'text-green-400' : inspPassRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
            {inspPassRate.toFixed(1)}%
          </div>
          <div className="text-[8px] text-rmpg-400 mt-1 font-mono tabular-nums">
            {inspection_pass_rate ? `${inspection_pass_rate.passed} pass / ${inspection_pass_rate.failed} fail of ${inspection_pass_rate.total}` : '--'}
          </div>
        </div>
      </div>

      {/* ═══ ROW 2: Maintenance Cost Trend + Fuel Economy Trend ═══ */}
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

      {/* ═══ ROW 3: Top Vehicles by Cost + Service Alerts ═══ */}
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

      {/* ═══ ROW 4: Mileage Distribution + Fleet Status ═══ */}
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
    </div>
  );
}
