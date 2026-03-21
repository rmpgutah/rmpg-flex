// ============================================================
// RMPG Flex — Crime Analysis / ILP Dashboard
// ============================================================
// Intelligence-Led Policing analytics with top offenses,
// temporal trends, hotspots, repeat offenders, and response
// metrics — all driven by existing calls/incidents data.
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  TrendingUp, BarChart3, Clock, MapPin, Users, AlertTriangle,
  RefreshCw, Loader2, Calendar, Filter,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import ExportButton from '../components/ExportButton';
import { apiFetch } from '../hooks/useApi';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';

export default function CrimeAnalysisPage() {
  const isMobile = useIsMobile();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('90');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let url = '/reports/crime-analysis';
      if (dateRange === 'custom' && startDate && endDate) {
        url += `?start_date=${startDate}&end_date=${endDate}`;
      } else if (dateRange !== 'custom') {
        url += `?days=${dateRange}`;
      }
      const res = await apiFetch<{ data: any }>(url);
      if (mountedRef.current) setData(res.data);
    } catch { /* silent */ }
    finally { if (mountedRef.current) setLoading(false); }
  }, [dateRange, startDate, endDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-rmpg-500 mx-auto mb-2" />
          <div className="text-xs text-rmpg-500">Loading crime analysis...</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-xs text-rmpg-500">No data available</div>
      </div>
    );
  }

  const maxOffenseCount = Math.max(1, ...(data.topOffenses || []).map((o: any) => o.count ?? 0));
  const maxHotspotCount = Math.max(1, ...(data.hotspots || []).map((h: any) => h.count ?? 0));
  const maxTodCount = Math.max(1, ...(data.timeOfDay || []).map((t: any) => t.count ?? 0));

  return (
    <div className="h-full flex flex-col">
      <PanelTitleBar title="Crime Analysis — Intelligence-Led Policing" icon={TrendingUp}>
        <div className="flex items-center gap-2">
          <select
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
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1.5 py-0.5 outline-none"
                title="Start date"
              />
              <span className="text-[10px] text-rmpg-500">to</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1.5 py-0.5 outline-none"
                title="End date"
              />
            </>
          )}
          <ExportButton
            exportUrl={
              dateRange === 'custom' && startDate && endDate
                ? `/reports/crime-analysis/export?format=csv&start_date=${startDate}&end_date=${endDate}`
                : `/reports/crime-analysis/export?format=csv&days=${dateRange}`
            }
            exportFilename="crime_analysis.csv"
          />
          <button onClick={fetchData} className="toolbar-btn">
            <RefreshCw style={{ width: 11, height: 11 }} />
          </button>
        </div>
      </PanelTitleBar>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Summary Cards */}
        <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-3 mb-4`}>
          {[
            { label: 'Total Incidents', value: data.topOffenses?.reduce((a: number, b: any) => a + b.count, 0) || 0, color: 'text-white' },
            { label: 'Clearance Rate', value: `${data.clearanceRate?.rate ?? 0}%`, color: 'text-green-400' },
            { label: 'Avg Response', value: `${data.responseMetrics?.[0]?.avg_minutes ?? '—'} min`, color: 'text-amber-400' },
            { label: 'Repeat Offenders', value: data.repeatOffenders?.length || 0, color: 'text-red-400' },
          ].map(card => (
            <div key={card.label} className="panel-beveled p-3 text-center">
              <div className="text-[9px] font-mono text-rmpg-500 uppercase">{card.label}</div>
              <div className={`text-xl font-bold mt-1 ${card.color}`}>{card.value}</div>
            </div>
          ))}
        </div>

        <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
          {/* Top Offenses */}
          <div className="panel-surface">
            <PanelTitleBar title="Top Offenses" icon={BarChart3} />
            <div className="p-3 space-y-2">
              {(data.topOffenses || []).slice(0, 10).map((offense: any, idx: number) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-[10px] text-rmpg-300 w-32 truncate" title={offense.offense_type}>
                    {offense.offense_type || 'Unknown'}
                  </span>
                  <div className="flex-1 h-4 bg-surface-sunken border border-rmpg-700 relative">
                    <div
                      className="h-full"
                      style={{
                        width: `${(offense.count / maxOffenseCount) * 100}%`,
                        background: 'linear-gradient(90deg, #124070, #1a5a9e)',
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-mono font-bold text-white w-8 text-right">{offense.count}</span>
                </div>
              ))}
              {(data.topOffenses || []).length === 0 && (
                <div className="text-center py-4 text-rmpg-500 text-xs">No offense data</div>
              )}
            </div>
          </div>

          {/* Hotspots */}
          <div className="panel-surface">
            <PanelTitleBar title="Hotspots (Top Locations)" icon={MapPin} />
            <div className="p-3 space-y-2">
              {(data.hotspots || []).slice(0, 10).map((spot: any, idx: number) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-[10px] text-rmpg-300 w-40 truncate" title={spot.location}>
                    {spot.location || 'Unknown'}
                  </span>
                  <div className="flex-1 h-4 bg-surface-sunken border border-rmpg-700 relative">
                    <div
                      className="h-full"
                      style={{
                        width: `${(spot.count / maxHotspotCount) * 100}%`,
                        background: 'linear-gradient(90deg, #92400e, #d97706)',
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-mono font-bold text-white w-8 text-right">{spot.count}</span>
                </div>
              ))}
              {(data.hotspots || []).length === 0 && (
                <div className="text-center py-4 text-rmpg-500 text-xs">No hotspot data</div>
              )}
            </div>
          </div>

          {/* Time of Day Distribution */}
          <div className="panel-surface">
            <PanelTitleBar title="Time of Day Distribution" icon={Clock} />
            <div className="p-3">
              <div className="flex items-end gap-[2px] h-24">
                {(data.timeOfDay || []).map((hour: any, idx: number) => (
                  <div
                    key={idx}
                    className="flex-1 relative group"
                    title={`${String(hour.hour).padStart(2, '0')}:00 — ${hour.count} calls`}
                  >
                    <div
                      className="w-full transition-all"
                      style={{
                        height: `${Math.max((hour.count / maxTodCount) * 100, 2)}%`,
                        background: hour.hour >= 6 && hour.hour < 18
                          ? 'linear-gradient(180deg, #2563eb, #1d4ed8)'
                          : 'linear-gradient(180deg, #7c3aed, #5b21b6)',
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[8px] font-mono text-rmpg-500">00:00</span>
                <span className="text-[8px] font-mono text-rmpg-500">06:00</span>
                <span className="text-[8px] font-mono text-rmpg-500">12:00</span>
                <span className="text-[8px] font-mono text-rmpg-500">18:00</span>
                <span className="text-[8px] font-mono text-rmpg-500">23:00</span>
              </div>
              <div className="flex items-center justify-center gap-4 mt-2">
                <span className="flex items-center gap-1 text-[9px] text-rmpg-400">
                  <div className="w-3 h-2" style={{ background: '#2563eb' }} /> Day
                </span>
                <span className="flex items-center gap-1 text-[9px] text-rmpg-400">
                  <div className="w-3 h-2" style={{ background: '#7c3aed' }} /> Night
                </span>
              </div>
            </div>
          </div>

          {/* Day of Week */}
          <div className="panel-surface">
            <PanelTitleBar title="Day of Week" icon={Calendar} />
            <div className="p-3 space-y-2">
              {(data.dayOfWeek || []).map((day: any, idx: number) => {
                const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const maxDow = Math.max(1, ...(data.dayOfWeek || []).map((d: any) => d.count));
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-[10px] text-rmpg-300 w-8">{dayNames[day.day_of_week] || day.day_of_week}</span>
                    <div className="flex-1 h-4 bg-surface-sunken border border-rmpg-700 relative">
                      <div
                        className="h-full"
                        style={{
                          width: `${(day.count / maxDow) * 100}%`,
                          background: day.day_of_week === 0 || day.day_of_week === 6
                            ? 'linear-gradient(90deg, #7c3aed, #a855f7)'
                            : 'linear-gradient(90deg, #059669, #10b981)',
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-mono font-bold text-white w-8 text-right">{day.count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Repeat Offenders */}
          <div className="panel-surface">
            <PanelTitleBar title="Repeat Offenders (3+ Incidents)" icon={Users} />
            <div className="p-3">
              {(data.repeatOffenders || []).length === 0 ? (
                <div className="text-center py-4 text-rmpg-500 text-xs">No repeat offenders</div>
              ) : (
                <div className="space-y-1">
                  {(data.repeatOffenders || []).slice(0, 15).map((person: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between px-2 py-1.5 panel-beveled">
                      <span className="text-[10px] text-white">{person.name || 'Unknown'}</span>
                      <span className="text-[10px] font-mono font-bold text-red-400">{person.incident_count} incidents</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Response Metrics */}
          <div className="panel-surface">
            <PanelTitleBar title="Response Metrics by Priority" icon={AlertTriangle} />
            <div className="p-3">
              {(data.responseMetrics || []).length === 0 ? (
                <div className="text-center py-4 text-rmpg-500 text-xs">No response data</div>
              ) : (
                <div className="space-y-2">
                  {(data.responseMetrics || []).map((metric: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between px-2 py-1.5 panel-beveled">
                      <span className="text-[10px] font-bold uppercase" style={{
                        color: metric.priority === 'critical' ? '#ef4444' : metric.priority === 'high' ? '#f59e0b' : metric.priority === 'normal' ? '#3b82f6' : '#9ca3af',
                      }}>
                        {metric.priority}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="text-[9px] text-rmpg-400">Avg: <span className="text-white font-bold">{metric.avg_minutes} min</span></span>
                        <span className="text-[9px] text-rmpg-400">Calls: <span className="text-white font-bold">{metric.call_count}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Monthly Trend */}
          <div className={`panel-surface ${isMobile ? '' : 'col-span-2'}`}>
            <PanelTitleBar title="Monthly Incident Trend" icon={TrendingUp} />
            <div className="p-3">
              {(data.trendData || []).length === 0 ? (
                <div className="text-center py-4 text-rmpg-500 text-xs">No trend data</div>
              ) : (
                <div>
                  <div className="flex items-end gap-1 h-28">
                    {(data.trendData || []).map((month: any, idx: number) => {
                      const maxTrend = Math.max(1, ...(data.trendData || []).map((m: any) => m.count));
                      return (
                        <div key={idx} className="flex-1 flex flex-col items-center">
                          <div
                            className="w-full"
                            style={{
                              height: `${Math.max((month.count / maxTrend) * 100, 2)}%`,
                              background: 'linear-gradient(180deg, #1a5a9e, #124070)',
                            }}
                            title={`${month.month}: ${month.count} incidents`}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between mt-1">
                    {(data.trendData || []).map((month: any, idx: number) => (
                      <span key={idx} className="text-[7px] font-mono text-rmpg-500 flex-1 text-center">
                        {month.month?.slice(5) || ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
