// ============================================================
// RMPG Flex — Statute Analytics Dashboard
// Visualizes citation and incident statute data with charts,
// tables, and trends. Uses /api/reports/statute-analytics.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3, PieChart, TrendingUp, Search, RefreshCw } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import PanelTitleBar from '../components/PanelTitleBar';

interface StatuteEntry {
  statute_number: string;
  title: string;
  offense_level: string;
  count: number;
}

interface LevelEntry { offense_level: string; count: number; }
interface TrendEntry { month: string; count: number; }

export default function StatuteAnalyticsPage() {
  const isMobile = useIsMobile();
  const [days, setDays] = useState(90);
  const [topStatutes, setTopStatutes] = useState<StatuteEntry[]>([]);
  const [byLevel, setByLevel] = useState<LevelEntry[]>([]);
  const [trend, setTrend] = useState<TrendEntry[]>([]);
  const [incidentStatutes, setIncidentStatutes] = useState<StatuteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const data = await apiFetch<any>(`/reports/statute-analytics?days=${days}`);
      setTopStatutes(data.topStatutes || []);
      setByLevel(data.byLevel || []);
      setTrend(data.trend || []);
      setIncidentStatutes(data.incidentStatutes || []);
    } catch (err) {
      console.error('Statute analytics error:', err);
    }
    setLoading(false);
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useLiveSync('incidents', fetchData);

  const maxCount = Math.max(...topStatutes.map(s => s.count), 1);
  const trendMax = Math.max(...trend.map(t => t.count), 1);
  const totalCitations = topStatutes.reduce((s, e) => s + e.count, 0);

  const levelColors: Record<string, string> = {
    felony: '#ef4444',
    misdemeanor_a: '#f59e0b',
    misdemeanor_b: '#eab308',
    misdemeanor_c: '#84cc16',
    infraction: '#22c55e',
    class_b_misdemeanor: '#f59e0b',
    class_c_misdemeanor: '#84cc16',
    class_a_misdemeanor: '#f59e0b',
    third_degree_felony: '#ef4444',
    second_degree_felony: '#dc2626',
    first_degree_felony: '#991b1b',
  };

  const filteredStatutes = topStatutes.filter(s =>
    !search || s.statute_number.toLowerCase().includes(search.toLowerCase()) || s.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col bg-surface-base text-white overflow-hidden">
      {!isMobile && <PanelTitleBar title="Statute Analytics" icon={BarChart3}>
        <div className="flex items-center gap-2">
          {[30, 60, 90, 180, 365].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                days === d ? 'bg-brand-900/50 text-brand-400 border border-brand-700/50' : 'text-rmpg-500 hover:text-rmpg-300'
              }`}
            >
              {d}d
            </button>
          ))}
          <button onClick={fetchData} className="toolbar-btn" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </PanelTitleBar>}

      {/* Mobile: day selector */}
      {isMobile && (
        <div className="flex items-center gap-1 px-3 py-2 overflow-x-auto flex-shrink-0" style={{ background: '#0f1a28', borderBottom: '1px solid #1e3048' }}>
          {[30, 60, 90, 180, 365].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wider shrink-0 transition-colors ${
                days === d ? 'bg-brand-900/50 text-brand-400 border border-brand-700/50' : 'text-rmpg-500 hover:text-rmpg-300'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-rmpg-400 text-xs">Loading statute data...</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Summary Cards */}
          <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-3`}>
            <div className="panel-surface p-3">
              <p className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider">Total Citations</p>
              <p className="text-2xl font-black text-brand-400 mt-1">{totalCitations}</p>
            </div>
            <div className="panel-surface p-3">
              <p className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider">Unique Statutes</p>
              <p className="text-2xl font-black text-amber-400 mt-1">{topStatutes.length}</p>
            </div>
            <div className="panel-surface p-3">
              <p className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider">Incident Statutes</p>
              <p className="text-2xl font-black text-purple-400 mt-1">{incidentStatutes.length}</p>
            </div>
            <div className="panel-surface p-3">
              <p className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider">Time Period</p>
              <p className="text-2xl font-black text-green-400 mt-1">{days}d</p>
            </div>
          </div>

          <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-3'} gap-4`}>
            {/* Top Violations Bar Chart */}
            <div className={`${isMobile ? '' : 'col-span-2'} panel-surface p-3`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-3.5 h-3.5 text-brand-400" />
                  <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Top Violations</h3>
                </div>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
                  <input
                    type="text"
                    className="bg-surface-base border border-rmpg-600 text-white text-[10px] pl-6 pr-2 py-1 w-48 focus:border-brand-500 focus:outline-none"
                    placeholder="Search statutes..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5 max-h-80 overflow-auto">
                {filteredStatutes.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-rmpg-400 w-24 shrink-0 truncate">{s.statute_number}</span>
                    <div className="flex-1 relative h-5 bg-rmpg-800/50">
                      <div
                        className="absolute inset-y-0 left-0 bg-brand-600/60 transition-all"
                        style={{ width: `${(s.count / maxCount) * 100}%` }}
                      />
                      <span className="absolute inset-y-0 left-1 flex items-center text-[9px] text-white font-bold truncate pr-8">
                        {s.title}
                      </span>
                      <span className="absolute inset-y-0 right-1 flex items-center text-[9px] font-mono font-bold text-brand-300">
                        {s.count}
                      </span>
                    </div>
                    <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border shrink-0 ${
                      s.offense_level?.includes('felony') ? 'text-red-400 border-red-700/50 bg-red-900/30' :
                      s.offense_level?.includes('misdemeanor') ? 'text-amber-400 border-amber-700/50 bg-amber-900/30' :
                      'text-green-400 border-green-700/50 bg-green-900/30'
                    }`}>
                      {s.offense_level?.replace(/_/g, ' ') || 'N/A'}
                    </span>
                  </div>
                ))}
                {filteredStatutes.length === 0 && (
                  <p className="text-rmpg-500 text-[10px] text-center py-4">No matching statutes</p>
                )}
              </div>
            </div>

            {/* Offense Level Breakdown */}
            <div className="panel-surface p-3">
              <div className="flex items-center gap-2 mb-3">
                <PieChart className="w-3.5 h-3.5 text-amber-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">By Offense Level</h3>
              </div>
              <div className="space-y-2">
                {byLevel.map((l, i) => {
                  const total = byLevel.reduce((s, e) => s + e.count, 0);
                  const pct = total > 0 ? Math.round((l.count / total) * 100) : 0;
                  const color = levelColors[l.offense_level] || '#6b7280';
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[9px] text-rmpg-300 uppercase font-bold">{l.offense_level?.replace(/_/g, ' ') || 'Unknown'}</span>
                        <span className="text-[9px] font-mono font-bold" style={{ color }}>{l.count} ({pct}%)</span>
                      </div>
                      <div className="h-2 bg-rmpg-800/50 overflow-hidden">
                        <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Monthly Trend */}
          <div className="panel-surface p-3">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-3.5 h-3.5 text-green-400" />
              <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Monthly Citation Trend</h3>
            </div>
            <div className="flex items-end gap-1 h-32">
              {trend.map((t, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[8px] font-mono text-brand-400 font-bold">{t.count}</span>
                  <div
                    className="w-full bg-brand-600/60 transition-all"
                    style={{ height: `${(t.count / trendMax) * 100}%`, minHeight: 2 }}
                  />
                  <span className="text-[7px] text-rmpg-500 font-mono">{t.month.slice(5)}</span>
                </div>
              ))}
              {trend.length === 0 && (
                <p className="text-rmpg-500 text-[10px] text-center py-4 w-full">No trend data</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
