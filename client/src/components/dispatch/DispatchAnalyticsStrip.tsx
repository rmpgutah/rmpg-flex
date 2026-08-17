import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area, PieChart, Pie,
} from 'recharts';
import { TrendingUp, MapPin, ChevronDown, ChevronUp, Clock, Shield } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { chartSeriesColors } from '../../utils/chartPalette';

interface CallVolumeDay { date: string; count: number }
interface ZoneBreakdown { zone: string; count: number }
interface PriorityItem { priority: string; count: number }
interface HourItem { hour: number; count: number }
interface ResponseTimeItem { priority: string; avg_minutes: number; count: number }

const CHART_TOOLTIP_STYLE = {
  backgroundColor: 'var(--surface-raised)',
  border: '1px solid var(--border-strong)',
  borderRadius: '2px',
  color: 'var(--text-primary)',
  fontSize: '11px',
  boxShadow: '0 4px 12px rgba(0 0 0 / 0.3)',
  padding: '6px 10px',
};

const PRIORITY_COLORS: Record<string, string> = {
  P1: 'var(--sev-critical)',
  P2: 'var(--sev-high)',
  P3: 'var(--sev-warn)',
  P4: 'var(--sev-ok)',
  Unknown: 'var(--spm-text-muted)',
};

const DAY_OPTIONS = [7, 14, 30] as const;
type DayRange = typeof DAY_OPTIONS[number];

function formatHour(h: number): string {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

export default function DispatchAnalyticsStrip() {
  const [expanded, setExpanded] = useState(() => localStorage.getItem('rmpg_dispatch_analytics') !== '0');
  const [days, setDays] = useState<DayRange>(() => {
    const saved = parseInt(localStorage.getItem('rmpg_dispatch_analytics_days') || '7', 10);
    return (DAY_OPTIONS as readonly number[]).includes(saved) ? (saved as DayRange) : 7;
  });

  const [callVolume, setCallVolume] = useState<CallVolumeDay[]>([]);
  const [zones, setZones] = useState<ZoneBreakdown[]>([]);
  const [repeatAddresses, setRepeatAddresses] = useState<{ address: string; count: number }[]>([]);
  const [priorityDist, setPriorityDist] = useState<PriorityItem[]>([]);
  const [hourlyToday, setHourlyToday] = useState<HourItem[]>([]);
  const [responseTimes, setResponseTimes] = useState<ResponseTimeItem[]>([]);

  const fetchData = useCallback(async (d: DayRange) => {
    const safe = async <T,>(url: string): Promise<T | null> => {
      try { return await apiFetch<T>(url); } catch { return null; }
    };
    const [cv, cz, ra, pd, ht, rt] = await Promise.all([
      safe<any>(`/dispatch/call-volume?days=${d}`),
      safe<any>(`/dispatch/by-zone?days=${d}`),
      safe<any>(`/dispatch/repeat-addresses?days=${d}&min_count=2&limit=5`),
      safe<any>(`/dispatch/priority-distribution?days=${d}`),
      safe<any>('/dispatch/hourly-today'),
      safe<any>(`/dispatch/response-times?days=${d}`),
    ]);
    if (cv?.by_day) setCallVolume(cv.by_day);
    if (cz?.by_zone) setZones(cz.by_zone);
    if (ra?.addresses) setRepeatAddresses(ra.addresses);
    if (pd?.by_priority) setPriorityDist(pd.by_priority);
    if (ht?.hours) setHourlyToday(ht.hours);
    if (rt?.by_priority) setResponseTimes(rt.by_priority);
  }, []);

  useEffect(() => { fetchData(days); }, [fetchData, days]);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem('rmpg_dispatch_analytics', next ? '1' : '0');
  };

  const changeDays = (d: DayRange) => {
    setDays(d);
    localStorage.setItem('rmpg_dispatch_analytics_days', String(d));
  };

  const colors = chartSeriesColors();
  const totalWeek = callVolume.reduce((s, d) => s + d.count, 0);
  const avgDaily = callVolume.length > 0 ? Math.round(totalWeek / callVolume.length) : 0;
  const totalPriority = priorityDist.reduce((s, d) => s + d.count, 0);
  const peakHour = hourlyToday.reduce((best, h) => h.count > best.count ? h : best, { hour: 0, count: 0 });

  return (
    <div className="border-b border-[var(--spm-border)]" style={{ background: 'var(--surface-deep)' }}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-1">
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-wider text-rmpg-400 hover:text-rmpg-200 transition-colors flex-1 min-w-0"
        >
          <TrendingUp className="w-3 h-3 flex-shrink-0" />
          <span>{days}-Day Analytics</span>
          <span className="font-mono text-rmpg-500 tabular-nums">{totalWeek} calls / {avgDaily} avg</span>
          {peakHour.count > 0 && expanded && (
            <span className="font-mono text-rmpg-600 tabular-nums">· Peak {formatHour(peakHour.hour)} ({peakHour.count})</span>
          )}
          <span className="ml-1">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </span>
        </button>
        {/* Time range picker — always visible so the range is clear even when collapsed */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => changeDays(d)}
              className="text-[8px] font-bold font-mono px-1.5 py-0.5 transition-colors"
              style={days === d
                ? { background: 'rgb(var(--brand-gold-rgb) / 0.18)', color: 'var(--brand-gold)', border: '1px solid rgb(var(--brand-gold-rgb) / 0.4)' }
                : { color: 'var(--spm-text-muted)', border: '1px solid transparent' }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-2 grid grid-cols-3 gap-2">
          {/* Row 1 */}

          {/* Call Volume Trend */}
          <div className="panel-beveled bg-surface-sunken p-2">
            <div className="text-[8px] text-rmpg-500 font-bold uppercase tracking-wider mb-1">Call Volume ({days}d)</div>
            {callVolume.length > 0 ? (
              <ResponsiveContainer width="100%" height={60}>
                <AreaChart data={callVolume} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
                  <defs>
                    <linearGradient id="cvGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={colors[0]} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={colors[0]} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelFormatter={(l) => String(l).slice(5)} />
                  <Area type="monotone" dataKey="count" stroke={colors[0]} fill="url(#cvGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[60px] flex items-center justify-center text-[9px] text-rmpg-600">No data</div>
            )}
          </div>

          {/* Zone Breakdown */}
          <div className="panel-beveled bg-surface-sunken p-2">
            <div className="text-[8px] text-rmpg-500 font-bold uppercase tracking-wider mb-1">By Zone ({days}d)</div>
            {zones.length > 0 ? (
              <ResponsiveContainer width="100%" height={60}>
                <BarChart data={zones.slice(0, 6)} layout="vertical" margin={{ top: 0, right: 4, bottom: 0, left: 30 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="zone" tick={{ fill: 'var(--spm-text-muted)', fontSize: 8 }} width={28} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="count" radius={[0, 2, 2, 0]} barSize={8}>
                    {zones.slice(0, 6).map((_, i) => (
                      <Cell key={i} fill={colors[i % colors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[60px] flex items-center justify-center text-[9px] text-rmpg-600">No data</div>
            )}
          </div>

          {/* Repeat Addresses */}
          <div className="panel-beveled bg-surface-sunken p-2">
            <div className="text-[8px] text-rmpg-500 font-bold uppercase tracking-wider mb-1">
              <MapPin className="w-2.5 h-2.5 inline mr-0.5" />Repeat Addresses
            </div>
            <div className="space-y-0.5 overflow-hidden" style={{ maxHeight: 60 }}>
              {repeatAddresses.length > 0 ? repeatAddresses.map((r, i) => (
                <div key={i} className="flex items-center gap-1 text-[8px]">
                  <span className="font-mono font-bold text-amber-400 tabular-nums w-4 text-right">{r.count}</span>
                  <span className="text-rmpg-300 truncate">{r.address}</span>
                </div>
              )) : (
                <div className="h-[50px] flex items-center justify-center text-[9px] text-rmpg-600">No repeats</div>
              )}
            </div>
          </div>

          {/* Row 2 */}

          {/* Priority Distribution */}
          <div className="panel-beveled bg-surface-sunken p-2">
            <div className="text-[8px] text-rmpg-500 font-bold uppercase tracking-wider mb-1">
              <Shield className="w-2.5 h-2.5 inline mr-0.5" />Priority Split ({days}d)
            </div>
            {priorityDist.length > 0 ? (
              <div className="flex items-center gap-2 h-[60px]">
                <ResponsiveContainer width={60} height={60}>
                  <PieChart>
                    <Pie
                      data={priorityDist}
                      dataKey="count"
                      nameKey="priority"
                      cx="50%"
                      cy="50%"
                      innerRadius={14}
                      outerRadius={26}
                      strokeWidth={0}
                    >
                      {priorityDist.map((d, i) => (
                        <Cell key={i} fill={PRIORITY_COLORS[d.priority] || colors[i % colors.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  {priorityDist.map((d) => (
                    <div key={d.priority} className="flex items-center gap-1 text-[8px]">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PRIORITY_COLORS[d.priority] || 'var(--spm-text-muted)' }} />
                      <span className="font-mono font-bold text-rmpg-300">{d.priority}</span>
                      <span className="font-mono tabular-nums text-rmpg-400 ml-auto">{d.count}</span>
                      <span className="text-rmpg-600 tabular-nums">
                        {totalPriority > 0 ? `${Math.round((d.count / totalPriority) * 100)}%` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-[60px] flex items-center justify-center text-[9px] text-rmpg-600">No data</div>
            )}
          </div>

          {/* Hourly Volume — Today */}
          <div className="panel-beveled bg-surface-sunken p-2">
            <div className="text-[8px] text-rmpg-500 font-bold uppercase tracking-wider mb-1">
              <Clock className="w-2.5 h-2.5 inline mr-0.5" />Today by Hour
            </div>
            {hourlyToday.some(h => h.count > 0) ? (
              <ResponsiveContainer width="100%" height={60}>
                <BarChart data={hourlyToday} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
                  <XAxis
                    dataKey="hour"
                    tickFormatter={(h) => h % 6 === 0 ? formatHour(h) : ''}
                    tick={{ fill: 'var(--spm-text-muted)', fontSize: 7 }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    labelFormatter={(h) => `${formatHour(Number(h))} — ${formatHour(Number(h) + 1)}`}
                  />
                  <Bar dataKey="count" barSize={4} radius={[1, 1, 0, 0]}>
                    {hourlyToday.map((h, i) => (
                      <Cell
                        key={i}
                        fill={h.count === peakHour.count && h.count > 0 ? 'var(--sev-warn)' : colors[0]}
                        fillOpacity={h.count > 0 ? 1 : 0.2}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[60px] flex items-center justify-center text-[9px] text-rmpg-600">No calls today yet</div>
            )}
          </div>

          {/* Response Times by Priority */}
          <div className="panel-beveled bg-surface-sunken p-2">
            <div className="text-[8px] text-rmpg-500 font-bold uppercase tracking-wider mb-1">
              Avg Response (min, {days}d)
            </div>
            {responseTimes.length > 0 ? (
              <div className="space-y-1 mt-1" style={{ maxHeight: 60 }}>
                {responseTimes.map((r) => {
                  const maxMin = Math.max(...responseTimes.map(x => x.avg_minutes), 1);
                  const pct = Math.round((r.avg_minutes / maxMin) * 100);
                  const color = PRIORITY_COLORS[r.priority] || 'var(--spm-text-muted)';
                  return (
                    <div key={r.priority} className="flex items-center gap-1.5 text-[8px]">
                      <span className="font-mono font-bold w-5 flex-shrink-0" style={{ color }}>{r.priority}</span>
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-weak)' }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, opacity: 0.75 }} />
                      </div>
                      <span className="font-mono tabular-nums text-rmpg-300 w-8 text-right flex-shrink-0">{r.avg_minutes}m</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-[60px] flex items-center justify-center text-[9px] text-rmpg-600">No response data</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
