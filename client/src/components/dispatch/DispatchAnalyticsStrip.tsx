import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area,
} from 'recharts';
import { TrendingUp, MapPin, ChevronDown, ChevronUp } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { chartSeriesColors } from '../../utils/chartPalette';

interface CallVolumeDay {
  date: string;
  count: number;
}

interface ZoneBreakdown {
  zone: string;
  count: number;
}

const CHART_TOOLTIP_STYLE = {
  backgroundColor: 'var(--surface-raised)',
  border: '1px solid var(--border-strong)',
  borderRadius: '2px',
  color: 'var(--text-primary)',
  fontSize: '11px',
  boxShadow: '0 4px 12px rgba(0 0 0 / 0.3)',
  padding: '6px 10px',
};

export default function DispatchAnalyticsStrip() {
  const [expanded, setExpanded] = useState(() => localStorage.getItem('rmpg_dispatch_analytics') !== '0');
  const [callVolume, setCallVolume] = useState<CallVolumeDay[]>([]);
  const [zones, setZones] = useState<ZoneBreakdown[]>([]);
  const [repeatAddresses, setRepeatAddresses] = useState<{ address: string; count: number }[]>([]);

  const fetchData = useCallback(async () => {
    const safe = async <T,>(url: string): Promise<T | null> => {
      try { return await apiFetch<T>(url); } catch { return null; }
    };
    const [cv, cz, ra] = await Promise.all([
      safe<any>('/dispatch/call-volume?days=7'),
      safe<any>('/dispatch/by-zone?days=7'),
      safe<any>('/dispatch/repeat-addresses?days=7&min_count=2&limit=5'),
    ]);
    if (cv?.by_day) setCallVolume(cv.by_day);
    if (cz?.by_zone) setZones(cz.by_zone);
    if (ra?.addresses) setRepeatAddresses(ra.addresses);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem('rmpg_dispatch_analytics', next ? '1' : '0');
  };

  const colors = chartSeriesColors();
  const totalWeek = callVolume.reduce((s, d) => s + d.count, 0);
  const avgDaily = callVolume.length > 0 ? Math.round(totalWeek / callVolume.length) : 0;

  return (
    <div className="border-b border-[var(--spm-border)]" style={{ background: 'var(--surface-deep)' }}>
      <button
        type="button"
        onClick={toggle}
        className="w-full px-3 py-1 flex items-center gap-2 text-[9px] font-bold uppercase tracking-wider text-rmpg-400 hover:text-rmpg-200 transition-colors"
      >
        <TrendingUp className="w-3 h-3" />
        <span>7-Day Analytics</span>
        <span className="font-mono text-rmpg-500 tabular-nums">{totalWeek} calls / {avgDaily} avg</span>
        <span className="ml-auto">
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-2 grid grid-cols-3 gap-2">
          {/* Call Volume Trend */}
          <div className="panel-beveled bg-surface-sunken p-2">
            <div className="text-[8px] text-rmpg-500 font-bold uppercase tracking-wider mb-1">Call Volume (7 Days)</div>
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
            <div className="text-[8px] text-rmpg-500 font-bold uppercase tracking-wider mb-1">By Zone (7 Days)</div>
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
        </div>
      )}
    </div>
  );
}
