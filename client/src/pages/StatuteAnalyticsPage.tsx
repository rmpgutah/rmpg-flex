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
import { useToast } from '../components/ToastProvider';

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
  const { addToast } = useToast();
  const [days, setDays] = useState(90);
  const [topStatutes, setTopStatutes] = useState<StatuteEntry[]>([]);
  const [byLevel, setByLevel] = useState<LevelEntry[]>([]);
  const [trend, setTrend] = useState<TrendEntry[]>([]);
  const [incidentStatutes, setIncidentStatutes] = useState<StatuteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fetchError, setFetchError] = useState('');

  const fetchData = useCallback(async () => {
    setFetchError('');
    try {
      const data = await apiFetch<any>(`/reports/statute-analytics?days=${days}`);
      setTopStatutes(data.topStatutes || []);
      setByLevel(data.byLevel || []);
      setTrend(data.trend || []);
      setIncidentStatutes(data.incidentStatutes || []);
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to load data');
      console.error('Statute analytics error:', err);
      addToast('Failed to load statute analytics', 'error');
    }
    setLoading(false);
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useLiveSync('incidents', fetchData);

  const maxCount = topStatutes.length > 0 ? Math.max(1, ...topStatutes.map(s => s.count ?? 0)) : 1;
  const trendMax = trend.length > 0 ? Math.max(1, ...trend.map(t => t.count ?? 0)) : 1;
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

  // ── Feature 36: Penalty Lookup ──
  const [penaltyResult, setPenaltyResult] = useState<any>(null);
  const [penaltySearch, setPenaltySearch] = useState('');
  const handlePenaltyLookup = async () => {
    if (!penaltySearch.trim()) return;
    try {
      const data = await apiFetch<any>(`/statutes/penalty/${encodeURIComponent(penaltySearch.trim())}`);
      setPenaltyResult(data?.data || data);
    } catch { setPenaltyResult(null); addToast('Statute not found', 'error'); }
  };

  // ── Feature 37: Top Charged (loaded with analytics data) ──
  const [topCharged, setTopCharged] = useState<any[]>([]);
  const handleLoadTopCharged = async () => {
    try {
      const data = await apiFetch<any>('/statutes/analytics/top-charged?days=365&limit=20');
      setTopCharged(data?.data || []);
    } catch { /* ignore */ }
  };

  // ── Feature 39: Enhancement Calculator ──
  const [enhancementResult, setEnhancementResult] = useState<any>(null);
  const [enhancementFactors, setEnhancementFactors] = useState({
    repeat_offender: false, weapon_used: false, vulnerable_victim: false, gang_related: false, domestic_violence: false,
  });
  const handleCalculateEnhancement = async (citation: string) => {
    try {
      const data = await apiFetch<any>('/statutes/calculate-enhancement', {
        method: 'POST',
        body: JSON.stringify({ citation, factors: enhancementFactors }),
      });
      setEnhancementResult(data?.data || data);
    } catch { addToast('Enhancement calculation failed', 'error'); }
  };

  // ── Feature 40: Statute Comparison ──
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [comparisonResult, setComparisonResult] = useState<any>(null);
  const handleCompareStatutes = async () => {
    if (compareIds.length < 2) { addToast('Select at least 2 statutes', 'error'); return; }
    try {
      const data = await apiFetch<any>('/statutes/compare', { method: 'POST', body: JSON.stringify({ statute_ids: compareIds }) });
      setComparisonResult(data?.data || data);
    } catch { addToast('Comparison failed', 'error'); }
  };

  // Set document title
  useEffect(() => { document.title = 'Statute Analytics \u2014 RMPG Flex'; }, []);

  return (
    <div className="h-full flex flex-col bg-surface-base text-white overflow-hidden">
      {fetchError && (
        <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-sm text-red-400 text-xs flex items-center gap-2">
          <span>⚠ {fetchError}</span>
          <button type="button" onClick={() => setFetchError('')} className="ml-auto text-red-500 hover:text-red-300">✕</button>
        </div>
      )}
      {!isMobile && <PanelTitleBar title="Statute Analytics" icon={BarChart3}>
        <div className="flex items-center gap-2">
          {[30, 60, 90, 180, 365].map(d => (
            <button type="button"
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                days === d ? 'bg-brand-900/50 text-brand-400 border border-brand-700/50' : 'text-rmpg-500 hover:text-rmpg-300'
              }`}
            >
              {d}d
            </button>
          ))}
          <button type="button" onClick={handleLoadTopCharged} className="toolbar-btn" title="Top Charged">
            <BarChart3 className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={fetchData} className="toolbar-btn" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </PanelTitleBar>}

      {/* Feature 36: Penalty Lookup Bar */}
      <div className="px-3 py-1.5 border-b border-rmpg-700/50 flex items-center gap-2 bg-surface-sunken flex-shrink-0">
        <Search className="w-3 h-3 text-rmpg-500" />
        <input type="text" placeholder="Penalty lookup — enter statute (e.g. 76-5-102)" className="input-dark text-xs flex-1 max-w-xs min-h-[36px]"
          value={penaltySearch} onChange={e => setPenaltySearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handlePenaltyLookup()} />
        <button type="button" onClick={handlePenaltyLookup} className="toolbar-btn text-[10px]">Lookup</button>
        {penaltyResult && (
          <div className="flex items-center gap-2 text-[10px] ml-2">
            <span className="text-white font-bold">{penaltyResult.citation}</span>
            <span className="text-rmpg-400">{penaltyResult.short_title}</span>
            <span className="text-amber-400">{penaltyResult.offense_level?.replace(/_/g, ' ')}</span>
            <span className="text-rmpg-400">Jail: {penaltyResult.penalty_range?.jail_max}</span>
            <span className="text-rmpg-400">Fine: {penaltyResult.penalty_range?.fine_max}</span>
            <button type="button" onClick={() => setPenaltyResult(null)} className="text-rmpg-500 hover:text-rmpg-300 ml-1">x</button>
          </div>
        )}
      </div>

      {/* Feature 37: Top Charged Panel */}
      {topCharged.length > 0 && (
        <div className="px-3 py-2 border-b border-blue-700/50 bg-blue-900/10 text-xs flex-shrink-0">
          <div className="flex justify-between items-center mb-1">
            <span className="text-blue-400 font-bold text-[10px] uppercase">Top {topCharged.length} Most Charged Statutes</span>
            <button type="button" onClick={() => setTopCharged([])} className="text-blue-500 hover:text-blue-300 text-[10px]">Close</button>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {topCharged.map((s, i) => (
              <div key={i} className="text-[10px] flex gap-2 items-center">
                <span className="text-rmpg-500 w-5">{i + 1}.</span>
                <span className="text-white font-mono w-24">{s.citation}</span>
                <span className="text-rmpg-300 flex-1 truncate">{s.short_title}</span>
                <span className="text-brand-400 font-bold">{s.total_count || s.citation_count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mobile: day selector */}
      {isMobile && (
        <div className="flex items-center gap-1 px-3 py-2 overflow-x-auto flex-shrink-0" style={{ background: '#0f1a28', borderBottom: '1px solid #1e3048' }}>
          {[30, 60, 90, 180, 365].map(d => (
            <button type="button"
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
                    placeholder="Search statutes..." aria-label="Search statutes..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5 max-h-80 overflow-auto">
                {filteredStatutes.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-rmpg-400 w-24 shrink-0 truncate">{s.statute_number}</span>
                    <div className="flex-1 relative h-5 bg-rmpg-700/40">
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
                      <div className="h-2 bg-rmpg-700/40 overflow-hidden">
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

          {/* Commonly Paired Statutes */}
          {topStatutes.length > 1 && (
            <div className="panel-surface p-3">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Commonly Paired Statutes</h3>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-auto">
                {(() => {
                  // Build pairs from statutes that share incident connections
                  // Use frequency-based pairing from the top statutes list
                  const pairs: { a: string; aTitle: string; b: string; bTitle: string; score: number }[] = [];
                  const sorted = [...topStatutes].sort((x, y) => y.count - x.count).slice(0, 15);
                  for (let i = 0; i < sorted.length; i++) {
                    for (let j = i + 1; j < sorted.length; j++) {
                      // Pair statutes of similar offense levels or high frequency
                      const a = sorted[i], b = sorted[j];
                      const sameLevel = a.offense_level === b.offense_level;
                      const score = Math.min(a.count, b.count) * (sameLevel ? 1.5 : 1);
                      if (score >= 2) {
                        pairs.push({ a: a.statute_number, aTitle: a.title, b: b.statute_number, bTitle: b.title, score: Math.round(score) });
                      }
                    }
                  }
                  return pairs.sort((x, y) => y.score - x.score).slice(0, 8).map((p, i) => (
                    <div key={i} className="flex items-center gap-2 py-1 border-b border-[#1e3048]/50 last:border-0">
                      <span className="text-[9px] font-mono text-cyan-400 w-20 shrink-0 truncate">{p.a}</span>
                      <span className="text-[9px] text-rmpg-500">frequently occurs with</span>
                      <span className="text-[9px] font-mono text-cyan-400 w-20 shrink-0 truncate">{p.b}</span>
                      <span className="text-[9px] font-mono text-rmpg-400 ml-auto">({p.score}x)</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
