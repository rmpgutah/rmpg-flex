import React, { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  BarChart3, Car, Fuel, Wrench, DollarSign, AlertTriangle, XCircle, Gauge,
  Bell, CheckCircle, Clock, TrendingUp,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import type { FleetAnalytics } from '../../../types';

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#141e2b',
    border: '1px solid #2a3e58',
    color: '#e0e0e0',
    fontSize: 10,
    fontFamily: 'Consolas, monospace',
  },
};

const STATUS_LABELS: Record<string, string> = {
  in_service: 'In Service',
  maintenance: 'Maintenance',
  out_of_service: 'Out of Service',
  retired: 'Retired',
};

interface Props {
  analytics: FleetAnalytics | null;
  loading?: boolean;
}

export default function FleetAnalyticsTab({ analytics, loading }: Props) {
  // Set document title
  useEffect(() => { document.title = 'Fleet - Analytics \u2014 RMPG Flex'; }, []);

  // New analytics data
  const [costAnalytics, setCostAnalytics] = useState<any>(null);
  const [serviceAlerts, setServiceAlerts] = useState<any[]>([]);
  const [inspectionStats, setInspectionStats] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [overdueInspections, setOverdueInspections] = useState<any[]>([]);

  useEffect(() => {
    apiFetch('/api/fleet/fleet-cost-analytics').then(r => r.ok ? r.json() : null).then(d => d && setCostAnalytics(d));
    apiFetch('/api/fleet/service-interval-alerts').then(r => r.ok ? r.json() : null).then(d => d?.alerts && setServiceAlerts(d.alerts));
    apiFetch('/api/fleet/inspection-stats').then(r => r.ok ? r.json() : null).then(d => d && setInspectionStats(d));
    apiFetch('/api/fleet/notifications').then(r => r.ok ? r.json() : null).then(d => d?.notifications && setNotifications(d.notifications));
    apiFetch('/api/fleet/overdue-inspections').then(r => r.ok ? r.json() : null).then(d => d?.alerts && setOverdueInspections(d.alerts));
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

  const { maintenance_cost_trend, mileage_distribution, status_breakdown, fuel_economy_trend, fleet_summary } = analytics;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Fleet Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <div className="panel-beveled p-2 text-center bg-surface-sunken">
          <Car className="w-3 h-3 mx-auto text-cyan-400 mb-0.5" />
          <div className="text-sm font-bold font-mono text-cyan-400">{fleet_summary.total_vehicles}</div>
          <div className="text-[7px] text-rmpg-500 uppercase">Vehicles</div>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-sunken">
          <Gauge className="w-3 h-3 mx-auto text-brand-400 mb-0.5" />
          <div className="text-sm font-bold font-mono text-brand-400">{fleet_summary.avg_mileage.toLocaleString()}</div>
          <div className="text-[7px] text-rmpg-500 uppercase">Avg Mi</div>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-sunken">
          <Wrench className="w-3 h-3 mx-auto text-amber-400 mb-0.5" />
          <div className="text-sm font-bold font-mono text-amber-400">${(fleet_summary.total_maintenance_cost / 1000).toFixed(1)}k</div>
          <div className="text-[7px] text-rmpg-500 uppercase">Maint Cost</div>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-sunken">
          <Fuel className="w-3 h-3 mx-auto text-green-400 mb-0.5" />
          <div className="text-sm font-bold font-mono text-green-400">${(fleet_summary.total_fuel_cost / 1000).toFixed(1)}k</div>
          <div className="text-[7px] text-rmpg-500 uppercase">Fuel Cost</div>
        </div>
        <div className="panel-beveled p-2 text-center" style={{ background: fleet_summary.vehicles_needing_service > 0 ? '#1a1400' : 'var(--surface-sunken)' }}>
          <AlertTriangle className="w-3 h-3 mx-auto mb-0.5" style={{ color: fleet_summary.vehicles_needing_service > 0 ? '#f59e0b' : '#22c55e' }} />
          <div className="text-sm font-bold font-mono" style={{ color: fleet_summary.vehicles_needing_service > 0 ? '#f59e0b' : '#22c55e' }}>
            {fleet_summary.vehicles_needing_service}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Need Svc</div>
        </div>
        <div className="panel-beveled p-2 text-center" style={{ background: fleet_summary.inspections_failing > 0 ? '#1a0a0a' : 'var(--surface-sunken)' }}>
          <XCircle className="w-3 h-3 mx-auto mb-0.5" style={{ color: fleet_summary.inspections_failing > 0 ? '#ef4444' : '#22c55e' }} />
          <div className="text-sm font-bold font-mono" style={{ color: fleet_summary.inspections_failing > 0 ? '#ef4444' : '#22c55e' }}>
            {fleet_summary.inspections_failing}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Insp Fail</div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Maintenance Cost Trend */}
        <div className="panel-beveled p-3 bg-surface-base">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <DollarSign className="w-3 h-3" /> Maintenance Cost Trend
          </h4>
          {maintenance_cost_trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={maintenance_cost_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#162236" />
                <XAxis dataKey="month" tick={{ fill: '#5a6e80', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#2a3e58' }} />
                <YAxis tick={{ fill: '#5a6e80', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#2a3e58' }}
                  tickFormatter={(v) => `$${v}`} />
                <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(value: any) => [`$${Number(value).toFixed(0)}`, 'Cost']} />
                <Line type="monotone" dataKey="total_cost" stroke="#1a5a9e" strokeWidth={2} dot={{ r: 3, fill: '#1a5a9e' }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-[10px] text-rmpg-500">No data</div>
          )}
        </div>

        {/* Mileage Distribution */}
        <div className="panel-beveled p-3 bg-surface-base">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Gauge className="w-3 h-3" /> Mileage Distribution
          </h4>
          {mileage_distribution.some(d => d.count > 0) ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={mileage_distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#162236" />
                <XAxis dataKey="range" tick={{ fill: '#5a6e80', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#2a3e58' }} />
                <YAxis tick={{ fill: '#5a6e80', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#2a3e58' }} />
                <Tooltip {...CHART_TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="#4a90c4" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-[10px] text-rmpg-500">No data</div>
          )}
        </div>

        {/* Status Breakdown */}
        <div className="panel-beveled p-3 bg-surface-base">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Car className="w-3 h-3" /> Status Breakdown
          </h4>
          {status_breakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
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
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={{ stroke: '#2a3e58' }}
                >
                  {status_breakdown.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip {...CHART_TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-[10px] text-rmpg-500">No data</div>
          )}
        </div>

        {/* Fuel Economy Trend */}
        <div className="panel-beveled p-3 bg-surface-base">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Fuel className="w-3 h-3" /> Fuel Economy Trend
          </h4>
          {fuel_economy_trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={fuel_economy_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#162236" />
                <XAxis dataKey="month" tick={{ fill: '#5a6e80', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#2a3e58' }} />
                <YAxis tick={{ fill: '#5a6e80', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#2a3e58' }}
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
              <div key={a.vehicle_id} className={`flex items-center justify-between px-2 py-1.5 rounded text-[10px] border ${a.severity === 'overdue' ? 'bg-red-900/20 border-red-800/40 text-red-400' : a.severity === 'critical' ? 'bg-amber-900/20 border-amber-800/40 text-amber-400' : 'bg-blue-900/20 border-blue-800/40 text-blue-400'}`}>
                <span className="font-mono font-bold">{a.vehicle_number}</span>
                <span>{a.service_type}</span>
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
