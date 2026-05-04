import { useState, useEffect, useCallback } from 'react';
import {
  Radio,
  Users,
  AlertTriangle,
  Shield,
  Activity,
  Clock,
  Phone,
  MapPin,
  Maximize,
  Minimize,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from 'recharts';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatusBadge from '../components/StatusBadge';
import { formatIncidentType } from '../utils/caseNumbers';

interface CommandCenterData {
  active_calls: any[];
  units: any[];
  kpis: {
    calls_today: number;
    active_calls: number;
    avg_response_min: number;
    units_available: number;
    units_total: number;
    active_bolos: number;
    anomaly_alerts: number;
  };
  anomaly_alerts: any[];
  calls_by_hour: { hour: number; count: number }[];
}

const UNIT_STATUS_COLORS: Record<string, string> = {
  available: '#22c55e',
  dispatched: '#f59e0b',
  enroute: '#888888',
  onscene: '#a855f7',
  busy: '#ef4444',
  off_duty: '#6b7280',
  out_of_service: '#6b7280',
};

export default function CommandCenterPage() {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const result = await apiFetch<CommandCenterData>('/reports/command-center');
      setData(result);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full bg-surface-base">
        <div className="text-rmpg-400 text-sm font-mono animate-pulse">Loading Command Center...</div>
      </div>
    );
  }

  const formatElapsed = (dateStr: string) => {
    const min = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (min < 60) return `${min}m`;
    return `${Math.floor(min / 60)}h ${min % 60}m`;
  };

  return (
    <div className="h-full flex flex-col bg-surface-sunken overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-1 bg-surface-base border-b border-rmpg-700/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Shield className="w-4 h-4 text-brand-400" />
          <span className="text-sm font-bold text-brand-400 font-mono tracking-wider">COMMAND CENTER</span>
          <span className="text-[9px] text-rmpg-500 font-mono">{new Date().toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-2">
          {data.kpis.anomaly_alerts > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold text-red-400 bg-red-900/30 border border-red-700/40 animate-pulse">
              <AlertTriangle style={{ width: 9, height: 9 }} /> {data.kpis.anomaly_alerts} ALERT{data.kpis.anomaly_alerts !== 1 ? 'S' : ''}
            </span>
          )}
          <button onClick={toggleFullscreen} className="toolbar-btn" title="Toggle fullscreen">
            {isFullscreen ? <Minimize style={{ width: 12, height: 12 }} /> : <Maximize style={{ width: 12, height: 12 }} />}
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="flex-1 grid grid-cols-5 gap-1 p-1 min-h-0">
        {/* LEFT: KPIs + Chart (3 cols) */}
        <div className="col-span-3 flex flex-col gap-1 min-h-0">
          {/* KPI Strip */}
          <div className="grid grid-cols-5 gap-1 flex-shrink-0">
            {[
              { label: 'ACTIVE CALLS', value: data.kpis.active_calls, icon: Phone, color: data.kpis.active_calls > 5 ? '#ef4444' : '#22c55e' },
              { label: 'CALLS TODAY', value: data.kpis.calls_today, icon: Activity, color: '#888888' },
              { label: 'AVG RESPONSE', value: `${data.kpis.avg_response_min}m`, icon: Clock, color: data.kpis.avg_response_min > 8 ? '#f97316' : '#22c55e' },
              { label: 'UNITS AVAIL', value: `${data.kpis.units_available}/${data.kpis.units_total}`, icon: Users, color: data.kpis.units_available < 2 ? '#ef4444' : '#22c55e' },
              { label: 'BOLOS', value: data.kpis.active_bolos, icon: ShieldAlert, color: data.kpis.active_bolos > 0 ? '#f59e0b' : '#6b7280' },
            ].map((kpi) => (
              <div key={kpi.label} className="panel-beveled p-2 bg-surface-base flex items-center gap-2">
                <kpi.icon style={{ width: 14, height: 14, color: kpi.color, flexShrink: 0 }} />
                <div>
                  <div className="text-lg font-bold font-mono" style={{ color: kpi.color }}>{kpi.value}</div>
                  <div className="text-[8px] text-rmpg-500 uppercase tracking-wider">{kpi.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Calls by Hour Chart */}
          <div className="flex-1 panel-beveled bg-surface-base p-2 min-h-0">
            <PanelTitleBar title="CALLS BY HOUR (24H)" icon={TrendingUp} />
            <div className="h-[calc(100%-24px)]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.calls_by_hour}>
                  <XAxis dataKey="hour" tick={{ fontSize: 9, fill: '#6b7280' }} tickFormatter={(h: number) => `${h}:00`} />
                  <YAxis tick={{ fontSize: 9, fill: '#6b7280' }} width={25} />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                    {data.calls_by_hour.map((entry, index) => (
                      <Cell key={index} fill={entry.count > 5 ? '#ef4444' : entry.count > 3 ? '#f59e0b' : '#888888'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Anomaly Alerts */}
          {data.anomaly_alerts.length > 0 && (
            <div className="panel-beveled bg-surface-base p-2 flex-shrink-0 max-h-32 overflow-y-auto">
              <PanelTitleBar title="ACTIVE ALERTS" icon={AlertTriangle} />
              <div className="space-y-1 mt-1">
                {data.anomaly_alerts.map((alert: any) => (
                  <div key={alert.id} className="flex items-center gap-2 px-2 py-1 text-[10px] font-mono bg-red-900/10 border border-red-900/30">
                    <AlertTriangle style={{ width: 10, height: 10, color: '#ef4444' }} />
                    <span className="text-red-400 font-bold">{alert.title}</span>
                    <span className="text-rmpg-400 truncate flex-1">{alert.details}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Call Queue + Unit Board (2 cols) */}
        <div className="col-span-2 flex flex-col gap-1 min-h-0">
          {/* Active Call Queue */}
          <div className="flex-1 panel-beveled bg-surface-base flex flex-col min-h-0">
            <PanelTitleBar title={`ACTIVE CALLS (${data.active_calls.length})`} icon={Radio} />
            <div className="flex-1 overflow-y-auto p-1 space-y-1">
              {data.active_calls.map((call: any) => (
                <div
                  key={call.id}
                  className="flex items-center gap-2 px-2 py-1.5 panel-beveled"
                  style={{
                    borderLeft: `3px solid ${
                      call.priority === 'P1' ? '#ef4444' : call.priority === 'P2' ? '#f59e0b' : call.priority === 'P3' ? '#888888' : '#6b7280'
                    }`,
                    background: call.priority === 'P1' ? 'rgba(239,68,68,0.06)' : '#0a0a0a',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold font-mono text-green-400">{call.call_number}</span>
                      <StatusBadge status={call.priority} type="priority" size="sm" />
                      <StatusBadge status={call.status} type="call_status" size="sm" />
                      {call.risk_score != null && call.risk_score >= 60 && (
                        <span
                          className="text-[8px] font-bold font-mono px-1"
                          style={{
                            color: call.risk_score >= 80 ? '#ef4444' : '#f97316',
                            background: call.risk_score >= 80 ? 'rgba(239,68,68,0.15)' : 'rgba(249,115,22,0.15)',
                          }}
                        >
                          R:{call.risk_score}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-brand-400 truncate">{formatIncidentType(call.incident_type)}</div>
                    <div className="text-[9px] text-rmpg-400 truncate flex items-center gap-1">
                      <MapPin style={{ width: 8, height: 8, flexShrink: 0 }} />
                      {call.location_address}
                    </div>
                  </div>
                  <div className="text-[9px] text-rmpg-500 font-mono flex-shrink-0">{formatElapsed(call.created_at)}</div>
                </div>
              ))}
              {data.active_calls.length === 0 && (
                <div className="text-center text-rmpg-500 text-xs py-8 font-mono">No active calls</div>
              )}
            </div>
          </div>

          {/* Unit Status Board */}
          <div className="panel-beveled bg-surface-base flex flex-col flex-shrink-0" style={{ maxHeight: '35%' }}>
            <PanelTitleBar title={`UNIT STATUS (${data.units.length})`} icon={Users} />
            <div className="flex-1 overflow-y-auto p-1">
              <div className="grid grid-cols-3 gap-1">
                {data.units.map((unit: any) => {
                  const color = UNIT_STATUS_COLORS[unit.status] || '#6b7280';
                  return (
                    <div
                      key={unit.id}
                      className="flex items-center gap-1.5 px-2 py-1 panel-beveled"
                      style={{ background: '#0a0a0a' }}
                    >
                      <span className="rounded-full flex-shrink-0" style={{ width: 6, height: 6, background: color, boxShadow: `0 0 4px ${color}` }} />
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold font-mono text-white block truncate">{unit.call_sign}</span>
                        <span className="text-[8px] uppercase font-bold" style={{ color }}>{unit.status.replace(/_/g, ' ')}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
