import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  BarChart3, Car, Fuel, Wrench, DollarSign, AlertTriangle, XCircle, Gauge,
} from 'lucide-react';
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
      <div className="grid grid-cols-6 gap-2">
        <div className="panel-beveled p-2 text-center" style={{ background: '#161616' }}>
          <Car className="w-3 h-3 mx-auto text-cyan-400 mb-0.5" />
          <div className="text-sm font-bold font-mono text-cyan-400">{fleet_summary.total_vehicles}</div>
          <div className="text-[7px] text-rmpg-500 uppercase">Vehicles</div>
        </div>
        <div className="panel-beveled p-2 text-center" style={{ background: '#161616' }}>
          <Gauge className="w-3 h-3 mx-auto text-brand-400 mb-0.5" />
          <div className="text-sm font-bold font-mono text-brand-400">{fleet_summary.avg_mileage.toLocaleString()}</div>
          <div className="text-[7px] text-rmpg-500 uppercase">Avg Mi</div>
        </div>
        <div className="panel-beveled p-2 text-center" style={{ background: '#161616' }}>
          <Wrench className="w-3 h-3 mx-auto text-amber-400 mb-0.5" />
          <div className="text-sm font-bold font-mono text-amber-400">${(fleet_summary.total_maintenance_cost / 1000).toFixed(1)}k</div>
          <div className="text-[7px] text-rmpg-500 uppercase">Maint Cost</div>
        </div>
        <div className="panel-beveled p-2 text-center" style={{ background: '#161616' }}>
          <Fuel className="w-3 h-3 mx-auto text-green-400 mb-0.5" />
          <div className="text-sm font-bold font-mono text-green-400">${(fleet_summary.total_fuel_cost / 1000).toFixed(1)}k</div>
          <div className="text-[7px] text-rmpg-500 uppercase">Fuel Cost</div>
        </div>
        <div className="panel-beveled p-2 text-center" style={{ background: fleet_summary.vehicles_needing_service > 0 ? '#1a1400' : '#161616' }}>
          <AlertTriangle className="w-3 h-3 mx-auto mb-0.5" style={{ color: fleet_summary.vehicles_needing_service > 0 ? '#f59e0b' : '#22c55e' }} />
          <div className="text-sm font-bold font-mono" style={{ color: fleet_summary.vehicles_needing_service > 0 ? '#f59e0b' : '#22c55e' }}>
            {fleet_summary.vehicles_needing_service}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Need Svc</div>
        </div>
        <div className="panel-beveled p-2 text-center" style={{ background: fleet_summary.inspections_failing > 0 ? '#1a0a0a' : '#161616' }}>
          <XCircle className="w-3 h-3 mx-auto mb-0.5" style={{ color: fleet_summary.inspections_failing > 0 ? '#ef4444' : '#22c55e' }} />
          <div className="text-sm font-bold font-mono" style={{ color: fleet_summary.inspections_failing > 0 ? '#ef4444' : '#22c55e' }}>
            {fleet_summary.inspections_failing}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Insp Fail</div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Maintenance Cost Trend */}
        <div className="panel-beveled p-3 bg-surface-base">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <DollarSign className="w-3 h-3" /> Maintenance Cost Trend
          </h4>
          {maintenance_cost_trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={maintenance_cost_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#162236" />
                <XAxis dataKey="month" tick={{ fill: '#707070', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#2a3e58' }} />
                <YAxis tick={{ fill: '#707070', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#2a3e58' }}
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
                <XAxis dataKey="range" tick={{ fill: '#707070', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#2a3e58' }} />
                <YAxis tick={{ fill: '#707070', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#2a3e58' }} />
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
                <XAxis dataKey="month" tick={{ fill: '#707070', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#2a3e58' }} />
                <YAxis tick={{ fill: '#707070', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#2a3e58' }}
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
    </div>
  );
}
