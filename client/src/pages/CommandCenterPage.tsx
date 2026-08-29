import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Radio, Users, AlertTriangle, Shield, Activity, Clock, Phone, MapPin, Maximize,
  Minimize, ShieldAlert, TrendingUp, Loader2,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from 'recharts';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatusBadge from '../components/StatusBadge';
import { formatIncidentType } from '../utils/caseNumbers';
import { parseTimestamp } from '../utils/dateUtils';
import { useAuth } from '../context/AuthContext';
import { toDisplayLabel } from '../utils/formatters';

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

// CSS-variable-backed color tokens for unit status dots — avoids hardcoded hex
const UNIT_STATUS_TOK: Record<string, { dot: string; label: string }> = {
  available:      { dot: 'rgb(var(--sev-ok-rgb))',  label: 'text-green-400' },
  dispatched:     { dot: 'rgb(var(--sev-warn-rgb))',  label: 'text-amber-400' },
  enroute:        { dot: 'rgb(var(--rmpg-400-rgb))',   label: 'text-rmpg-400' },
  onscene:        { dot: 'rgb(var(--sev-special-rgb))', label: 'text-purple-400' },
  busy:           { dot: 'rgb(var(--sev-critical-rgb))',    label: 'text-red-400' },
  off_duty:       { dot: 'rgb(var(--rmpg-600-rgb))',   label: 'text-rmpg-600' },
  out_of_service: { dot: 'rgb(var(--rmpg-600-rgb))',   label: 'text-rmpg-600' },
};

const VALID_PANELS = ['calls', 'units', 'alerts'] as const;
type PanelId = typeof VALID_PANELS[number];

export default function CommandCenterPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManage = ['admin', 'manager', 'supervisor'].includes((user as any)?.role || '');

  // Deep-link: ?panel= strips after mount
  const initialPanel = ((): PanelId => {
    const p = searchParams.get('panel') as PanelId | null;
    return p && (VALID_PANELS as readonly string[]).includes(p) ? p : 'calls';
  })();

  const [data, setData] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePanel, setActivePanel] = useState<PanelId>(initialPanel);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [callQuery, setCallQuery] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const navigate = useNavigate();

  // Strip deep-link param after first mount
  useEffect(() => {
    if (searchParams.has('panel')) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const result = await apiFetch<CommandCenterData>('/reports/command-center');
      setData(result);
    } catch { /* stale data stays visible on transient error */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // N shortcut: force-refresh; Esc cascade: no open modals here, just stop propagation
  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'N' || e.key === 'n') {
        e.preventDefault();
        fetchDataRef.current();
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        // No open modals on this page — cascade terminates here
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Distinct loading state (first fetch, no data yet)
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full bg-surface-base gap-2">
        <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
        <span className="text-rmpg-400 text-sm font-mono">Loading Command Center...</span>
      </div>
    );
  }

  // Distinct no-data state (loaded but network error / empty response)
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-surface-base gap-2">
        <AlertTriangle className="w-6 h-6 text-amber-400" />
        <span className="text-rmpg-400 text-sm font-mono">Command Center data unavailable</span>
        <button
          onClick={fetchData}
          className="mt-1 px-3 py-1 text-xs font-mono text-brand-400 border border-brand-400/40 hover:bg-brand-400/10"
        >
          Retry
        </button>
      </div>
    );
  }

  const formatElapsed = (dateStr: string) => {
    const min = Math.floor((Date.now() - parseTimestamp(dateStr).getTime()) / 60000);
    if (min < 60) return `${min}m`;
    return `${Math.floor(min / 60)}h ${min % 60}m`;
  };

  return (
    <div className="h-full flex flex-col bg-surface-sunken overflow-hidden" data-panel={activePanel}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-1 bg-surface-base border-b border-rmpg-700/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Shield className="w-4 h-4 text-brand-400" />
          <span className="text-sm font-bold text-brand-400 font-mono tracking-wider">COMMAND CENTER</span>
          <span className="text-[9px] text-rmpg-500 font-mono">{new Date().toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-2">
          {(data.kpis.anomaly_alerts ?? 0) > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold text-red-400 bg-red-900/30 border border-red-700/40 animate-pulse">
              <AlertTriangle style={{ width: 9, height: 9 }} /> {data.kpis.anomaly_alerts} ALERT{data.kpis.anomaly_alerts !== 1 ? 'S' : ''}
            </span>
          )}
          {/* Fullscreen is a supervisor+ action */}
          {canManage && (
            <button onClick={toggleFullscreen} className="toolbar-btn" title="Toggle fullscreen (N=refresh)">
              {isFullscreen ? <Minimize style={{ width: 12, height: 12 }} /> : <Maximize style={{ width: 12, height: 12 }} />}
            </button>
          )}
          <button type="button" onClick={fetchData} className="toolbar-btn text-[9px] font-mono text-brand-400">REFRESH</button>
        </div>
      </div>

      <div className="flex gap-1 px-2 py-1 bg-surface-base border-b border-rmpg-700/50">
        {VALID_PANELS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setActivePanel(p)}
            className="text-[8px] px-2 py-0.5 uppercase tracking-wide rounded-[2px] border border-border-subtle"
            style={{
              background: activePanel === p ? 'var(--brand-400)' : 'transparent',
              color: activePanel === p ? 'var(--surface-base)' : 'var(--text-secondary)',
            }}
          >
            {p}
          </button>
        ))}
        <input
          value={callQuery}
          onChange={(e) => setCallQuery(e.target.value)}
          placeholder="Filter calls…"
          aria-label="Filter active calls"
          className="ml-auto text-[10px] px-2 py-0.5 bg-surface-sunken border border-border-subtle rounded-[2px] text-rmpg-100 w-40"
        />
        <input
          value={unitFilter}
          onChange={(e) => setUnitFilter(e.target.value)}
          placeholder="Filter units…"
          aria-label="Filter units"
          className="text-[10px] px-2 py-0.5 bg-surface-sunken border border-border-subtle rounded-[2px] text-rmpg-100 w-32"
        />
      </div>

      {/* Main Grid */}
      <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-1 p-1 min-h-0">
        {/* LEFT: KPIs + Chart (3 cols) */}
        <div className="col-span-3 flex flex-col gap-1 min-h-0">
          {/* KPI Strip */}
          <div className="grid grid-cols-5 gap-1 flex-shrink-0">
            {[
              {
                label: 'ACTIVE CALLS',
                value: data.kpis.active_calls,
                icon: Phone,
                color: data.kpis.active_calls > 5
                  ? 'rgb(var(--sev-critical-rgb))'
                  : 'rgb(var(--sev-ok-rgb))',
              },
              {
                label: 'CALLS TODAY',
                value: data.kpis.calls_today,
                icon: Activity,
                color: 'rgb(var(--rmpg-400-rgb))',
              },
              {
                label: 'AVG RESPONSE',
                value: `${data.kpis.avg_response_min}m`,
                icon: Clock,
                color: data.kpis.avg_response_min > 8
                  ? 'rgb(var(--sev-high-rgb))'
                  : 'rgb(var(--sev-ok-rgb))',
              },
              {
                label: 'UNITS AVAIL',
                value: `${data.kpis.units_available}/${data.kpis.units_total}`,
                icon: Users,
                color: data.kpis.units_available < 2
                  ? 'rgb(var(--sev-critical-rgb))'
                  : 'rgb(var(--sev-ok-rgb))',
              },
              {
                label: 'BOLOS',
                value: data.kpis.active_bolos,
                icon: ShieldAlert,
                color: data.kpis.active_bolos > 0
                  ? 'rgb(var(--sev-warn-rgb))'
                  : 'rgb(var(--rmpg-600-rgb))',
              },
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
            {(data.calls_by_hour?.length ?? 0) === 0 ? (
              <div className="h-[calc(100%-24px)] flex items-center justify-center text-rmpg-500 text-xs font-mono">
                No call data for today
              </div>
            ) : (
              <div className="h-[calc(100%-24px)]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.calls_by_hour}>
                    <XAxis dataKey="hour" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={(h: number) => `${h}:00`} />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} width={25} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {data.calls_by_hour.map((entry, index) => (
                        <Cell
                          key={index}
                          fill={
                            entry.count > 5
                              ? 'rgb(var(--sev-critical-rgb))'
                              : entry.count > 3
                              ? 'rgb(var(--sev-warn-rgb))'
                              : 'rgb(var(--rmpg-400-rgb))'
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Anomaly Alerts */}
          {(data.anomaly_alerts?.length ?? 0) > 0 && (
            <div className="panel-beveled bg-surface-base p-2 flex-shrink-0 max-h-32 overflow-y-auto">
              <PanelTitleBar title="ACTIVE ALERTS" icon={AlertTriangle} />
              <div className="space-y-1 mt-1">
                {(data.anomaly_alerts ?? []).map((alert: any) => (
                  <div key={alert.id} className="flex items-center gap-2 px-2 py-1 text-[10px] font-mono bg-red-900/10 border border-red-900/30">
                    <AlertTriangle style={{ width: 10, height: 10 }} className="text-red-400 flex-shrink-0" />
                    <span className="text-red-400 font-bold">{alert.title}</span>
                    <span className="text-rmpg-400 min-w-0 truncate flex-1">{alert.details}</span>
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
            <PanelTitleBar title={`ACTIVE CALLS (${data.active_calls?.length ?? 0})`} icon={Radio} />
            <div className="flex-1 min-h-0 overflow-y-auto p-1 space-y-1">
              {(data.active_calls?.length ?? 0) === 0 ? (
                <div className="text-center text-rmpg-500 text-xs py-8 font-mono">No active calls</div>
              ) : (
                (data.active_calls ?? [])
                  .filter((call: any) => {
                    if (!callQuery.trim()) return true;
                    const hay = `${call.call_number} ${call.location_address ?? call.address ?? ''} ${call.call_type ?? ''} ${call.incident_type ?? ''}`.toLowerCase();
                    return hay.includes(callQuery.trim().toLowerCase());
                  })
                  .map((call: any) => {
                  const priorityDot =
                    call.priority === 'P1' ? 'rgb(var(--sev-critical-rgb))'
                    : call.priority === 'P2' ? 'rgb(var(--sev-warn-rgb))'
                    : call.priority === 'P3' ? 'rgb(var(--rmpg-400-rgb))'
                    : 'rgb(var(--rmpg-600-rgb))';
                  return (
                    <div
                      key={call.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/dispatch?call_id=${call.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/dispatch?call_id=${call.id}`); }}
                      className="flex items-center gap-2 px-2 py-1.5 panel-beveled cursor-pointer"
                      style={{
                        borderLeft: `3px solid ${priorityDot}`,
                        background: call.priority === 'P1'
                          ? 'rgba(var(--sev-critical-rgb), 0.06)'
                          : 'var(--surface-base)',
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
                                color: call.risk_score >= 80
                                  ? 'rgb(var(--sev-critical-rgb))'
                                  : 'rgb(var(--sev-high-rgb))',
                                background: call.risk_score >= 80
                                  ? 'rgba(var(--sev-critical-rgb), 0.15)'
                                  : 'rgba(var(--sev-high-rgb), 0.15)',
                              }}
                            >
                              R:{call.risk_score}
                            </span>
                          )}
                        </div>
                        {/* API returns call_type; incident_type is a display alias in some contexts */}
                        <div className="text-[10px] text-brand-400 truncate">
                          {formatIncidentType(call.incident_type ?? call.call_type)}
                        </div>
                        <div className="text-[9px] text-rmpg-400 truncate flex items-center gap-1">
                          <MapPin style={{ width: 8, height: 8, flexShrink: 0 }} />
                          {call.location_address ?? call.address}
                        </div>
                      </div>
                      <div className="text-[9px] text-rmpg-500 font-mono flex-shrink-0">
                        {formatElapsed(call.created_at)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Unit Status Board */}
          <div className="panel-beveled bg-surface-base flex flex-col flex-shrink-0" style={{ maxHeight: '35%' }}>
            <PanelTitleBar title={`UNIT STATUS (${data.units?.length ?? 0})`} icon={Users} />
            <div className="flex-1 min-h-0 overflow-y-auto p-1">
              {(data.units?.length ?? 0) === 0 ? (
                <div className="text-center text-rmpg-500 text-xs py-4 font-mono">No units online</div>
              ) : (
                <div className="grid grid-cols-3 gap-1">
                  {(data.units ?? [])
                    .filter((unit: any) => {
                      if (!unitFilter.trim()) return true;
                      const hay = `${unit.call_sign ?? ''} ${unit.unit_number ?? ''} ${unit.status ?? ''}`.toLowerCase();
                      return hay.includes(unitFilter.trim().toLowerCase());
                    })
                    .map((unit: any) => {
                    const tok = UNIT_STATUS_TOK[unit.status] ?? UNIT_STATUS_TOK.off_duty;
                    // API returns unit_number; call_sign is a display alias some rows carry
                    const callSign = unit.call_sign ?? unit.unit_number ?? '—';
                    return (
                      <div key={unit.id} className="flex items-center gap-1.5 px-2 py-1 panel-beveled bg-surface-base">
                        <span
                          className="rounded-full flex-shrink-0"
                          style={{ width: 6, height: 6, background: tok.dot, boxShadow: `0 0 4px ${tok.dot}` }}
                        />
                        <div className="min-w-0">
                          <span className="text-[10px] font-bold font-mono text-rmpg-100 block truncate">{callSign}</span>
                          <span className={`text-[8px] uppercase font-bold ${tok.label}`}>
                            {toDisplayLabel(unit.status)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
