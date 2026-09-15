// ============================================================
// RMPG Flex — Crime Analysis / ILP Dashboard
// ============================================================
// Intelligence-Led Policing analytics with top offenses,
// temporal trends, hotspots, repeat offenders, and response
// metrics — all driven by existing calls/incidents data.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import {
  TrendingUp, BarChart3, Clock, MapPin, Users, AlertTriangle, RefreshCw, Loader2,
  Calendar,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Cell,
} from 'recharts';
import PanelTitleBar from '../components/PanelTitleBar';
import { humanizePriority } from '../utils/statusLabels';
import ExportButton from '../components/ExportButton';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { crimeOffensesToCsv, crimeHotspotsToCsv, downloadTextFile } from '../utils/rmsListExport';
import { useMountedRef } from '../hooks/useMountedRef';

/* ── Custom Tooltip ─────────────────────────────────────────── */
const ChartTooltip = ({ active, payload, label, formatter }: any) => {
  if (!active || !payload?.length) return null;
  const display = formatter ? formatter(label, payload[0].value) : `${payload[0].value}`;
  return (
    <div style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)', padding: '6px 10px', borderRadius: 2 }}>
      <div style={{ color: 'var(--text-secondary)', fontSize: 10, fontFamily: 'Arial, sans-serif' }}>{label}</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 11, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }}>{display}</div>
    </div>
  );
};

/* ── Shared axis / grid props ───────────────────────────────── */
const AXIS_STYLE = { fill: 'var(--text-secondary)', fontSize: 9, fontFamily: 'Arial, sans-serif' };
const GRID_PROPS = { stroke: 'var(--border-subtle)', strokeDasharray: '3 3' } as const;

export default function CrimeAnalysisPage() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const canExport = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor';
  const filterRef = useRef<HTMLSelectElement>(null);
  const { addToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Deep-link seed: ?days=30|90|180|365|custom or ?date_range= alias — read
  // once on mount, then strip the param so the URL stays clean.
  const VALID_DAYS = new Set(['30', '90', '180', '365', 'custom']);
  const seedDays = searchParams.get('days') ?? searchParams.get('date_range') ?? '90';
  const [dateRange, setDateRange] = useState<string>(() => VALID_DAYS.has(seedDays) ? seedDays : '90');
  const [startDate, setStartDate] = useState(searchParams.get('start_date') ?? '');
  const [endDate, setEndDate] = useState(searchParams.get('end_date') ?? '');

  const mountedRef = useMountedRef();

  // Strip deep-link params after seeding so the address bar stays tidy.
  useEffect(() => {
    const hasSeedParam = searchParams.has('days') || searchParams.has('date_range')
      || searchParams.has('start_date') || searchParams.has('end_date');
    if (!hasSeedParam) return;
    const next = new URLSearchParams(searchParams);
    ['days', 'date_range', 'start_date', 'end_date'].forEach((k) => next.delete(k));
    setSearchParams(next, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      let url = '/reports/crime-analysis';
      if (dateRange === 'custom' && startDate && endDate) {
        url += `?start_date=${startDate}&end_date=${endDate}`;
      } else if (dateRange !== 'custom') {
        url += `?days=${dateRange}`;
      }
      const res = await apiFetch<{ data: any }>(url);
      if (mountedRef.current) setData(res.data);
    } catch {
      if (mountedRef.current) {
        setLoadError(true);
        addToast('Failed to load crime analysis data', 'error');
      }
    }
    finally { if (mountedRef.current) setLoading(false); }
  }, [dateRange, startDate, endDate, addToast]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useLiveSync('incidents', fetchData);

  /* ── Derived data ──────────────────────────────────────────── */
  // filterActive = user has chosen a custom or non-default period, so "no
  // data" means the filter returned nothing rather than the system being empty.
  const filterActive = dateRange !== '90' || !!(startDate || endDate);
  const emptyHint = filterActive ? 'No data for this period' : 'No data available';

  const totalIncidents = data?.topOffenses?.reduce((a: number, b: any) => a + b.count, 0) || 0;

  const offenseData = (data?.topOffenses || []).slice(0, 10).map((o: any) => ({
    name: (o.offense_type || 'Unknown').slice(0, 20),
    fullName: o.offense_type || 'Unknown',
    count: o.count ?? 0,
  }));

  const hotspotData = (data?.hotspots || []).slice(0, 10).map((h: any) => ({
    name: (h.location || 'Unknown').slice(0, 22),
    fullName: h.location || 'Unknown',
    count: h.count ?? 0,
    lat: h.lat, lng: h.lng,
  }));

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dowData = (data?.dayOfWeek || []).map((d: any) => ({
    name: dayNames[d.day_of_week] ?? d.day_of_week,
    count: d.count ?? 0,
    isWeekend: d.day_of_week === 0 || d.day_of_week === 6,
  }));

  const todData = (data?.timeOfDay || []).map((t: any) => ({
    hour: `${String(t.hour).padStart(2, '0')}:00`,
    count: t.count ?? 0,
    isDay: t.hour >= 6 && t.hour < 18,
  }));

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const trendData = (data?.trendData || []).map((m: any) => {
    const parts = (m.month || '').split('-');
    const label = parts.length === 2 ? `${monthNames[parseInt(parts[1], 10) - 1] || parts[1]} ${parts[0]?.slice(2)}` : m.month;
    return { name: label, count: m.count ?? 0 };
  });

  const responseTargets: Record<string, number> = { critical: 5, high: 8, normal: 12, low: 20 };

  /* ── Gradient defs shared across charts ────────────────────── */
  const BlueGradient = (
    <defs>
      <linearGradient id="blueBar" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="var(--rmpg-600)" />
        <stop offset="100%" stopColor="var(--rmpg-400)" />
      </linearGradient>
    </defs>
  );

  const OrangeGradient = (
    <defs>
      <linearGradient id="orangeBar" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="var(--sev-high)" />
        <stop offset="100%" stopColor="var(--sev-warn)" />
      </linearGradient>
    </defs>
  );

  const AreaGradientBlue = (
    <defs>
      <linearGradient id="areaBlue" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--rmpg-400)" stopOpacity={0.4} />
        <stop offset="100%" stopColor="var(--rmpg-400)" stopOpacity={0.05} />
      </linearGradient>
    </defs>
  );

  // Set document title
  useEffect(() => { document.title = 'Crime Analysis — RMPG Flex'; }, []);


  // Loading FIRST — on mount data is null AND loading is true; checking !data
  // first used to flash (and, when the endpoint was stubbed, permanently show)
  // "No data available" instead of the spinner.
  if (loading && !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-rmpg-500 mx-auto mb-2" role="status" aria-label="Loading" />
          <div className="text-xs text-rmpg-500">Loading crime analysis...</div>
        </div>
      </div>
    );
  }
  if (loadError && !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-xs text-red-400 flex items-center gap-3">
          <span>Failed to load crime analysis.</span>
          <button type="button" className="toolbar-btn" onClick={() => void fetchData()}>Retry</button>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-xs text-rmpg-500">
          {filterActive ? 'No data for the selected period' : 'No data available'}
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-rmpg-500 mx-auto mb-2" role="status" aria-label="Loading" />
          <div className="text-xs text-rmpg-500">Loading crime analysis...</div>
        </div>
      </div>
    );
  }


  return (
    <div className="h-full flex flex-col">
      <PanelTitleBar title="Crime Analysis — Intelligence-Led Policing" icon={TrendingUp}>
        <div className="flex items-center gap-2">
          <select
            id="ff-crimeanalysispage-0"
            ref={filterRef}
            value={dateRange}
            onChange={e => setDateRange(e.target.value)}
            className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1.5 py-0.5 outline-none"
          >
            <option value="30">Last 30 Days</option>
            <option value="90">Last 90 Days</option>
            <option value="180">Last 6 Months</option>
            <option value="365">Last Year</option>
            <option value="custom">Custom Range</option>
          </select>
          {dateRange === 'custom' && (
            <>
              <input id="ff-crimeanalysispage-1" type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1.5 py-0.5 outline-none" title="Start date" />
              <span className="text-[10px] text-rmpg-500">to</span>
              <input id="ff-crimeanalysispage-2" type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1.5 py-0.5 outline-none" title="End date" />
            </>
          )}
          {canExport && (
            <ExportButton
              exportUrl={dateRange === 'custom' && startDate && endDate
                ? `/reports/crime-analysis/export?format=csv&start_date=${startDate}&end_date=${endDate}`
                : `/reports/crime-analysis/export?format=csv&days=${dateRange}`}
              exportFilename="crime_analysis.csv"
            />
          )}
          <button
            type="button"
            className="toolbar-btn"
            disabled={!offenseData.length}
            onClick={() => downloadTextFile('crime-offenses.csv', crimeOffensesToCsv(data?.topOffenses ?? []))}
          >Offenses CSV</button>
          <button
            type="button"
            className="toolbar-btn"
            disabled={!hotspotData.length}
            onClick={() => downloadTextFile('crime-hotspots.csv', crimeHotspotsToCsv(data?.hotspots ?? []))}
          >Hotspots CSV</button>
          <button type="button" onClick={fetchData} className="toolbar-btn">
            <RefreshCw style={{ width: 11, height: 11 }} />
          </button>
        </div>
      </PanelTitleBar>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {/* ── Summary Cards ──────────────────────────────────── */}
        <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-3 mb-4`}>
          {[
            { label: 'Total Incidents', value: totalIncidents, color: 'text-rmpg-100', spark: 'var(--text-secondary)' },
            { label: 'Clearance Rate', value: `${data?.clearanceRate?.rate ?? 0}%`, color: 'text-green-400', spark: 'var(--sev-ok)' },
            { label: 'Avg Response', value: `${data?.responseMetrics?.[0]?.avg_minutes ?? '—'} min`, color: 'text-amber-400', spark: 'var(--sev-warn)' },
            { label: 'Repeat Offenders', value: data?.repeatOffenders?.length || 0, color: 'text-red-400', spark: 'var(--sev-critical)' },
          ].map(card => (
            <div key={card.label} className="panel-beveled p-3 text-center relative overflow-hidden">
              <div className="text-[9px] font-mono text-rmpg-500 uppercase">{card.label}</div>
              <div className={`text-xl font-bold mt-1 ${card.color}`}>{card.value}</div>
              {/* sparkline accent bar */}
              <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: card.spark, opacity: 0.6 }} />
            </div>
          ))}
        </div>

        <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>

          {/* ── Top Offenses (horizontal bar) ────────────────── */}
          <div className="panel-surface">
            <PanelTitleBar title="Top Offenses" icon={BarChart3} />
            <div className="p-3">
              {offenseData.length === 0 ? (
                <div className="text-center py-4 text-rmpg-500 text-xs">{emptyHint}</div>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={offenseData} layout="vertical" margin={{ left: 4, right: 30, top: 4, bottom: 4 }}>
                    {BlueGradient}
                    <CartesianGrid {...GRID_PROPS} horizontal={false} />
                    <XAxis type="number" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={AXIS_STYLE} width={80} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip formatter={(l: string, v: number) => `${v} incidents`} />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Bar dataKey="count" fill="url(#blueBar)" radius={[0, 2, 2, 0]} barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* ── Hotspots (horizontal bar) ────────────────────── */}
          <div className="panel-surface">
            <PanelTitleBar title="Hotspots (Top Locations)" icon={MapPin} />
            <div className="p-3">
              {hotspotData.length === 0 ? (
                <div className="text-center py-4 text-rmpg-500 text-xs">{emptyHint}</div>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={hotspotData} layout="vertical" margin={{ left: 4, right: 30, top: 4, bottom: 4 }}>
                    {OrangeGradient}
                    <CartesianGrid {...GRID_PROPS} horizontal={false} />
                    <XAxis type="number" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={AXIS_STYLE} width={90} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip formatter={(_: string, v: number) => `${v} calls`} />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Bar dataKey="count" fill="url(#orangeBar)" radius={[0, 2, 2, 0]} barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* ── Time of Day (area chart) ─────────────────────── */}
          <div className="panel-surface">
            <PanelTitleBar title="Time of Day Distribution" icon={Clock} />
            <div className="p-3">
              {todData.length === 0 ? (
                <div className="text-center py-4 text-rmpg-500 text-xs">{emptyHint}</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={todData} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="todGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--sev-special-soft)" stopOpacity={0.5} />
                          <stop offset="50%" stopColor="var(--rmpg-400)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="var(--rmpg-400)" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="hour" tick={AXIS_STYLE} axisLine={false} tickLine={false}
                        interval={isMobile ? 5 : 3} />
                      <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={28} />
                      <Tooltip content={<ChartTooltip formatter={(l: string, v: number) => `${v} calls`} />} />
                      <Area type="monotone" dataKey="count" stroke="var(--sev-special-soft)" strokeWidth={2}
                        fill="url(#todGrad)" dot={false} activeDot={{ r: 3, fill: 'var(--sev-special)', stroke: 'var(--sev-special-soft)' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                  <div className="flex items-center justify-center gap-4 mt-2">
                    <span className="flex items-center gap-1 text-[9px] text-rmpg-400">
                      <div className="w-3 h-2 bg-rmpg-400" /> Day (06-18)
                    </span>
                    <span className="flex items-center gap-1 text-[9px] text-rmpg-400">
                      <div className="w-3 h-2" style={{ background: 'var(--sev-special-soft)' }} /> Night
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Day of Week (vertical bar) ───────────────────── */}
          <div className="panel-surface">
            <PanelTitleBar title="Day of Week" icon={Calendar} />
            <div className="p-3">
              {dowData.length === 0 ? (
                <div className="text-center py-4 text-rmpg-500 text-xs">{emptyHint}</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={dowData} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="greenBar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--sev-ok-soft)" />
                        <stop offset="100%" stopColor="var(--sev-ok)" />
                      </linearGradient>
                      <linearGradient id="purpleBar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--sev-special)" />
                        <stop offset="100%" stopColor="var(--sev-special-soft)" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...GRID_PROPS} vertical={false} />
                    <XAxis dataKey="name" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={28} />
                    <Tooltip content={<ChartTooltip formatter={(l: string, v: number) => `${v} incidents`} />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]} barSize={24}>
                      {dowData.map((d: any) => (
                        <Cell key={d.name} fill={d.isWeekend ? 'url(#purpleBar)' : 'url(#greenBar)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
              <div className="flex items-center justify-center gap-4 mt-1">
                <span className="flex items-center gap-1 text-[9px] text-rmpg-400">
                  <div className="w-3 h-2 rounded-[1px] bg-green-400" /> Weekday
                </span>
                <span className="flex items-center gap-1 text-[9px] text-rmpg-400">
                  <div className="w-3 h-2 rounded-[1px]" style={{ background: 'var(--sev-special)' }} /> Weekend
                </span>
              </div>
            </div>
          </div>

          {/* ── Repeat Offenders (table) ─────────────────────── */}
          <div className="panel-surface">
            <PanelTitleBar title="Repeat Offenders (3+ Incidents)" icon={Users} />
            <div className="p-3">
              {(data?.repeatOffenders || []).length === 0 ? (
                <div className="text-center py-4 text-rmpg-500 text-xs">{emptyHint}</div>
              ) : (
                <div className="space-y-1">
                  {(data?.repeatOffenders || []).slice(0, 15).map((person: any, idx: number) => {
                    const maxCount = Math.max(1, ...(data?.repeatOffenders || []).map((p: any) => p.incident_count ?? 0));
                    const pct = ((person.incident_count ?? 0) / maxCount) * 100;
                    return (
                      <div key={idx} className="flex items-center gap-2 px-2 py-1.5 panel-beveled">
                        <span className="text-[9px] font-mono text-rmpg-500 w-4 text-right">{idx + 1}</span>
                        <span className="text-[10px] text-rmpg-100 min-w-0 flex-1 truncate">{person.name || 'Unknown'}</span>
                        <div className="w-16 h-2 bg-surface-sunken rounded-[1px] overflow-hidden">
                          <div className="h-full rounded-[1px] bg-gradient-to-r from-red-600 to-red-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] font-mono font-bold text-red-400 w-12 text-right">{person.incident_count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Response Metrics ──────────────────────────────── */}
          <div className="panel-surface">
            <PanelTitleBar title="Response Metrics by Priority" icon={AlertTriangle} />
            <div className="p-3">
              {(data?.responseMetrics || []).length === 0 ? (
                <div className="text-center py-4 text-rmpg-500 text-xs">{emptyHint}</div>
              ) : (
                <div className="space-y-2">
                  {(data?.responseMetrics || []).map((metric: any, idx: number) => {
                    const target = responseTargets[metric.priority] ?? 15;
                    const pct = Math.min(100, ((metric.avg_minutes ?? 0) / target) * 100);
                    const overTarget = (metric.avg_minutes ?? 0) > target;
                    const barColor = overTarget ? 'var(--sev-critical)' : metric.priority === 'critical' ? 'var(--sev-warn)' : 'var(--sev-ok)';
                    const labelColor = metric.priority === 'critical' ? 'var(--sev-critical)' : metric.priority === 'high' ? 'var(--sev-warn-soft)' : 'var(--text-secondary)';
                    return (
                      <div key={idx} className="px-2 py-2 panel-beveled space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase" style={{ color: labelColor }}>
                            {humanizePriority(metric.priority)}
                          </span>
                          <div className="flex items-center gap-3">
                            <span className="text-[9px] text-rmpg-400">Avg: <span className="text-rmpg-100 font-bold">{metric.avg_minutes} min</span></span>
                            <span className="text-[9px] text-rmpg-400">Target: <span className="text-rmpg-300">{target}m</span></span>
                            <span className="text-[9px] text-rmpg-400">Calls: <span className="text-rmpg-100 font-bold">{metric.call_count}</span></span>
                          </div>
                        </div>
                        <div className="h-2 bg-surface-sunken rounded-[1px] overflow-hidden relative">
                          <div className="h-full rounded-[1px] transition-all" style={{ width: `${pct}%`, background: barColor }} />
                          {/* target marker */}
                          <div className="absolute top-0 h-full w-px bg-rmpg-400" style={{ left: '100%', opacity: 0.4 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Monthly Trend (area chart, full width) ────────── */}
          <div className={`panel-surface ${isMobile ? '' : 'col-span-2'}`}>
            <PanelTitleBar title="Monthly Incident Trend" icon={TrendingUp} />
            <div className="p-3">
              {trendData.length === 0 ? (
                <div className="text-center py-4 text-rmpg-500 text-xs">{emptyHint}</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={trendData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    {AreaGradientBlue}
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="name" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={30} />
                    <Tooltip content={<ChartTooltip formatter={(l: string, v: number) => `${v} incidents`} />} />
                    <Area type="monotone" dataKey="count" stroke="var(--rmpg-400)" strokeWidth={2}
                      fill="url(#areaBlue)" dot={{ r: 3, fill: 'var(--rmpg-400)', stroke: 'var(--rmpg-400)', strokeWidth: 1 }}
                      activeDot={{ r: 5, fill: 'var(--rmpg-400)', stroke: 'var(--surface-base)', strokeWidth: 1 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
