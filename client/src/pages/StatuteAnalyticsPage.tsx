// ============================================================
// RMPG Flex — Statute Analytics Dashboard
// Visualizes citation and incident statute data with charts,
// tables, and trends. Uses /api/reports/statute-analytics.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { BarChart3, PieChart, TrendingUp, Search, RefreshCw, Loader2 } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../context/AuthContext';
import PanelTitleBar from '../components/PanelTitleBar';
import { useToast } from '../components/ToastProvider';
import ConfirmDialog from '../components/ConfirmDialog';
import { toDisplayLabel } from '../utils/formatters';
import { useSlashFocus } from '../hooks/useSlashFocus';
import { statuteCountsToCsv, downloadTextFile } from '../utils/rmsListExport';

interface StatuteEntry {
  statute_number: string;
  title: string;
  offense_level: string;
  count: number;
}

interface LevelEntry { offense_level: string; count: number; }
interface TrendEntry { month: string; count: number; }

// admin/manager can export and perform destructive actions
const MANAGE_ROLES = new Set(['admin', 'manager']);

// Brand-token-safe level colours — CSS vars so day/night re-themes automatically.
// Fallback hex is kept only for browsers that don't support the var (legacy kill-switch).
const LEVEL_COLORS: Record<string, string> = {
  felony:                 'rgb(var(--red-400-rgb, 248 113 113))',
  misdemeanor_a:          'rgb(var(--amber-400-rgb, 251 191 36))',
  misdemeanor_b:          'rgb(var(--yellow-400-rgb, 250 204 21))',
  misdemeanor_c:          'rgb(var(--lime-400-rgb, 163 230 53))',
  infraction:             'rgb(var(--green-400-rgb, 74 222 128))',
  class_a_misdemeanor:    'rgb(var(--amber-400-rgb, 251 191 36))',
  class_b_misdemeanor:    'rgb(var(--amber-400-rgb, 251 191 36))',
  class_c_misdemeanor:    'rgb(var(--lime-400-rgb, 163 230 53))',
  third_degree_felony:    'rgb(var(--red-400-rgb, 248 113 113))',
  second_degree_felony:   'rgb(var(--red-600-rgb, 220 38 38))',
  first_degree_felony:    'rgb(var(--red-800-rgb, 153 27 27))',
};

export default function StatuteAnalyticsPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { user } = useAuth();
  const canManage = MANAGE_ROLES.has(user?.role ?? '');

  // ── Deep-link params (read once at mount) ───────────────────
  const [searchParams, setSearchParams] = useSearchParams();

  const initDays = (() => {
    const raw = searchParams.get('date_range');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return [30, 60, 90, 180, 365].includes(parsed) ? parsed : 90;
  })();
  const initStatute = searchParams.get('statute') ?? '';

  const [days, setDays] = useState(initDays);
  const [search, setSearch] = useState(initStatute);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchInputRef);

  // Strip deep-link params after mount so they don't persist in history
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let dirty = false;
    if (next.has('statute'))    { next.delete('statute');    dirty = true; }
    if (next.has('date_range')) { next.delete('date_range'); dirty = true; }
    if (dirty) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [topStatutes, setTopStatutes] = useState<StatuteEntry[]>([]);
  const [byLevel, setByLevel] = useState<LevelEntry[]>([]);
  const [trend, setTrend] = useState<TrendEntry[]>([]);
  const [incidentStatutes, setIncidentStatutes] = useState<StatuteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);

  // ── Feature 36: Penalty Lookup ───────────────────────────────
  const [penaltyResult, setPenaltyResult] = useState<any>(null);
  const [penaltySearch, setPenaltySearch] = useState('');

  // ── Feature 37: Top Charged ──────────────────────────────────
  const [topCharged, setTopCharged] = useState<any[]>([]);

  // ── Feature 39: Enhancement Calculator ──────────────────────
  const [enhancementResult, setEnhancementResult] = useState<any>(null);
  const [enhancementFactors, setEnhancementFactors] = useState({
    repeat_offender: false, weapon_used: false, vulnerable_victim: false,
    gang_related: false, domestic_violence: false,
  });

  // ── Feature 40: Statute Comparison ───────────────────────────
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [comparisonResult, setComparisonResult] = useState<any>(null);

  // ── Clear cache confirm (admin/manager only) ─────────────────
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setFetchError('');
    try {
      const data = await apiFetch<any>(`/reports/statute-analytics?days=${days}`);
      setTopStatutes(data.topStatutes ?? []);
      setByLevel(data.byLevel ?? []);
      setTrend(data.trend ?? []);
      setIncidentStatutes(data.incidentStatutes ?? []);
      setHasLoaded(true);
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to load data');
      addToast('Failed to load statute analytics', 'error');
    }
    setLoading(false);
  }, [days, addToast]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  useLiveSync('incidents', fetchData);

  // ── Keyboard: N focuses search; Esc cascades ─────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === 'Escape') {
        e.stopPropagation();
        if (clearConfirmOpen) { setClearConfirmOpen(false); return; }
        if (search)           { setSearch(''); return; }
        if (penaltyResult)    { setPenaltyResult(null); return; }
        if (topCharged.length > 0) { setTopCharged([]); return; }
        return;
      }

      if ((e.key === 'n' || e.key === 'N') && !inInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, penaltyResult, topCharged, clearConfirmOpen]);

  const maxCount = topStatutes.length > 0 ? Math.max(1, ...topStatutes.map(s => s.count ?? 0)) : 1;
  const trendMax = trend.length > 0 ? Math.max(1, ...trend.map(t => t.count ?? 0)) : 1;
  const totalCitations = topStatutes.reduce((s, e) => s + e.count, 0);

  const filteredStatutes = topStatutes.filter(s =>
    !search ||
    (s.statute_number ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (s.title ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const handlePenaltyLookup = async () => {
    if (!penaltySearch.trim()) return;
    try {
      const data = await apiFetch<any>(`/statutes/penalty/${encodeURIComponent(penaltySearch.trim())}`);
      setPenaltyResult(data?.data ?? data);
    } catch (err) {
      console.warn('[StatuteAnalytics] penalty lookup failed:', err);
      setPenaltyResult(null);
      addToast('Statute not found', 'error');
    }
  };

  const handleLoadTopCharged = async () => {
    try {
      const data = await apiFetch<any>('/statutes/analytics/top-charged?days=365&limit=20');
      setTopCharged(data?.data ?? []);
    } catch (err) {
      console.warn('[StatuteAnalytics] top charged load failed:', err);
    }
  };

  const handleCalculateEnhancement = async (citation: string) => {
    try {
      const data = await apiFetch<any>('/statutes/calculate-enhancement', {
        method: 'POST',
        body: JSON.stringify({ citation, factors: enhancementFactors }),
      });
      setEnhancementResult(data?.data ?? data);
    } catch (err) {
      console.warn('[StatuteAnalytics] enhancement calculation failed:', err);
      addToast('Enhancement calculation failed', 'error');
    }
  };

  const handleCompareStatutes = async () => {
    if (compareIds.length < 2) { addToast('Select at least 2 statutes', 'error'); return; }
    try {
      const data = await apiFetch<any>('/statutes/compare', {
        method: 'POST',
        body: JSON.stringify({ statute_ids: compareIds }),
      });
      setComparisonResult(data?.data ?? data);
    } catch (err) {
      console.warn('[StatuteAnalytics] statute comparison failed:', err);
      addToast('Comparison failed', 'error');
    }
  };

  // Set document title
  useEffect(() => { document.title = 'Statute Analytics — RMPG Flex'; }, []);

  const isEmpty = hasLoaded && topStatutes.length === 0 && trend.length === 0 && byLevel.length === 0;

  return (
    <div className="h-full flex flex-col bg-surface-base text-rmpg-100 overflow-hidden">
      {/* Error banner */}
      {fetchError && (
        <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-sm text-red-400 text-xs flex items-center gap-2">
          <span>⚠ {fetchError}</span>
          <button type="button" className="toolbar-btn" onClick={() => { setLoading(true); void fetchData(); }}>Retry</button>
          <button type="button" onClick={() => setFetchError('')} className="ml-auto text-red-500 hover:text-red-300">✕</button>
        </div>
      )}

      {/* Title bar (desktop) */}
      {!isMobile && (
        <PanelTitleBar title="Statute Analytics" icon={BarChart3}>
          <button
            type="button"
            className="toolbar-btn"
            disabled={filteredStatutes.length === 0}
            onClick={() => downloadTextFile('statute-analytics.csv', statuteCountsToCsv(filteredStatutes.map((s) => ({
              statute_number: s.statute_number,
              title: s.title,
              offense_level: s.offense_level,
              count: s.count,
            }))))}
          >CSV</button>
          <div className="flex items-center gap-2">
            {[30, 60, 90, 180, 365].map(d => (
              <button type="button"
                key={d}
                onClick={() => setDays(d)}
                className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-all duration-150 ${
                  days === d
                    ? 'bg-brand-900/50 text-brand-400 border border-brand-700/50 shadow-sm'
                    : 'text-rmpg-500 hover:text-rmpg-300 border border-transparent hover:border-rmpg-600'
                }`}
              >
                {d}d
              </button>
            ))}
            <div className="w-px h-4 bg-rmpg-600 mx-1" />
            <button type="button" onClick={handleLoadTopCharged} className="toolbar-btn" title="Top Charged (last 365 d)">
              <BarChart3 className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={fetchData} className="toolbar-btn" title="Refresh">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            {/* Destructive action — admin/manager only */}
            {canManage && (
              <button
                type="button"
                onClick={() => setClearConfirmOpen(true)}
                className="toolbar-btn text-red-400 hover:text-red-300"
                title="Clear analytics cache (admin/manager)"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </div>
        </PanelTitleBar>
      )}

      {/* Feature 36: Penalty Lookup Bar */}
      <div className="px-3 py-1.5 border-b border-rmpg-700/50 flex items-center gap-2 bg-surface-sunken flex-shrink-0">
        <Search className="w-3 h-3 text-rmpg-500 shrink-0" />
        <input
          id="ff-statuteanalyticspage-0"
          type="text"
          placeholder="Penalty lookup — enter statute (e.g. 76-5-102)"
          className="input-dark text-xs flex-1 max-w-xs min-h-[36px]"
          value={penaltySearch}
          onChange={e => setPenaltySearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handlePenaltyLookup()}
        />
        <button type="button" onClick={handlePenaltyLookup} className="toolbar-btn text-[10px]">Lookup</button>
        {penaltyResult && (
          <div className="flex items-center gap-2 text-[10px] ml-2">
            <span className="text-rmpg-100 font-bold">{penaltyResult.citation}</span>
            <span className="text-rmpg-400">{penaltyResult.short_title}</span>
            <span className="text-amber-400">{toDisplayLabel(penaltyResult.offense_level).toUpperCase()}</span>
            <span className="text-rmpg-400">Jail: {penaltyResult.penalty_range?.jail_max}</span>
            <span className="text-rmpg-400">Fine: {penaltyResult.penalty_range?.fine_max}</span>
            <button type="button" onClick={() => setPenaltyResult(null)} className="text-rmpg-500 hover:text-rmpg-300 ml-1">×</button>
          </div>
        )}
      </div>

      {/* Feature 37: Top Charged Panel */}
      {topCharged.length > 0 && (
        <div className="px-3 py-2 border-b border-rmpg-700/50 bg-surface-sunken/10 text-xs flex-shrink-0">
          <div className="flex justify-between items-center mb-1">
            <span className="text-rmpg-400 font-bold text-[10px] uppercase">Top {topCharged.length} Most Charged Statutes</span>
            <button type="button" onClick={() => setTopCharged([])} className="text-rmpg-500 hover:text-rmpg-300 text-[10px]">Close</button>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {topCharged.map((s, i) => (
              <div key={i} className="text-[10px] flex gap-2 items-center">
                <span className="text-rmpg-500 w-5">{i + 1}.</span>
                <span className="text-rmpg-100 font-mono w-24">{s.citation}</span>
                <span className="text-rmpg-300 min-w-0 flex-1 truncate">{s.short_title}</span>
                <span className="text-brand-400 font-bold">{s.total_count ?? s.citation_count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mobile: day selector */}
      {isMobile && (
        <div className="flex items-center gap-1 px-3 py-2 overflow-x-auto flex-shrink-0 bg-surface-sunken border-b border-rmpg-700/50">
          {[30, 60, 90, 180, 365].map(d => (
            <button type="button"
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wider shrink-0 transition-colors ${
                days === d
                  ? 'bg-brand-900/50 text-brand-400 border border-brand-700/50'
                  : 'text-rmpg-500 hover:text-rmpg-300'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      )}

      {/* ── Loading state ── */}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
          <p className="text-rmpg-500 text-[10px] uppercase tracking-wider">Loading statute data…</p>
        </div>

      /* ── Empty / no data state ── */
      ) : isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-rmpg-500">
          <BarChart3 className="w-8 h-8 text-rmpg-600 mb-1" />
          <p className="text-sm font-semibold text-rmpg-400">No statute data</p>
          <p className="text-[10px]">No citations or incidents recorded in the last {days} days.</p>
          <button type="button" onClick={fetchData} className="mt-2 toolbar-btn text-[10px]">Refresh</button>
        </div>

      /* ── Data ── */
      ) : (
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Summary Cards */}
          <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-3`}>
            <div className="panel-surface p-3 border-l-[3px] border-l-brand-500 hover:bg-surface-raised/50 transition-colors">
              <p className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider">Total Citations</p>
              <p className="text-2xl font-black text-brand-400 mt-1 font-mono tabular-nums">{totalCitations}</p>
            </div>
            <div className="panel-surface p-3 border-l-[3px] border-l-amber-500 hover:bg-surface-raised/50 transition-colors">
              <p className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider">Unique Statutes</p>
              <p className="text-2xl font-black text-amber-400 mt-1 font-mono tabular-nums">{topStatutes.length}</p>
            </div>
            <div className="panel-surface p-3 border-l-[3px] border-l-purple-500 hover:bg-surface-raised/50 transition-colors">
              <p className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider">Incident Statutes</p>
              <p className="text-2xl font-black text-purple-400 mt-1 font-mono tabular-nums">{incidentStatutes.length}</p>
            </div>
            <div className="panel-surface p-3 border-l-[3px] border-l-green-500 hover:bg-surface-raised/50 transition-colors">
              <p className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider">Time Period</p>
              <p className="text-2xl font-black text-green-400 mt-1 font-mono">{days}d</p>
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
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" />
                  <input
                    id="ff-statuteanalyticspage-1"
                    ref={searchInputRef}
                    type="text"
                    className="bg-surface-base border border-rmpg-600 text-rmpg-100 text-[10px] pl-6 pr-2 py-1 w-48 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
                    placeholder="Search statutes… (/)"
                    aria-label="Search statutes"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setSearch(''); } }}
                  />
                </div>
              </div>
              <div className="space-y-1.5 max-h-80 overflow-auto">
                {filteredStatutes.length > 0 ? (
                  filteredStatutes.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[9px] font-mono text-rmpg-400 w-24 shrink-0 truncate">{s.statute_number}</span>
                      <div className="flex-1 relative h-5 bg-rmpg-800/50">
                        <div
                          className="absolute inset-y-0 left-0 bg-brand-600/60 transition-all"
                          style={{ width: `${(s.count / maxCount) * 100}%` }}
                        />
                        <span className="absolute inset-y-0 left-1 flex items-center text-[9px] text-rmpg-100 font-bold truncate pr-8">
                          {s.title}
                        </span>
                        <span className="absolute inset-y-0 right-1 flex items-center text-[9px] font-mono font-bold text-brand-300">
                          {s.count}
                        </span>
                      </div>
                      <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border shrink-0 ${
                        s.offense_level?.includes('felony')
                          ? 'text-red-400 border-red-700/50 bg-red-900/30'
                          : s.offense_level?.includes('misdemeanor')
                            ? 'text-amber-400 border-amber-700/50 bg-amber-900/30'
                            : 'text-green-400 border-green-700/50 bg-green-900/30'
                      }`}>
                        {toDisplayLabel(s.offense_level) || 'N/A'}
                      </span>
                    </div>
                  ))
                ) : (
                  /* No results for filter */
                  <div className="flex flex-col items-center justify-center py-8 text-rmpg-500">
                    <Search className="w-5 h-5 text-rmpg-600 mb-2" />
                    <p className="text-[10px]">No statutes matching <span className="font-mono text-rmpg-400">&ldquo;{search}&rdquo;</span></p>
                    <button type="button" onClick={() => setSearch('')} className="mt-2 text-[10px] text-brand-400 hover:text-brand-300">Clear filter</button>
                  </div>
                )}
              </div>
            </div>

            {/* Offense Level Breakdown */}
            <div className="panel-surface p-3">
              <div className="flex items-center gap-2 mb-3">
                <PieChart className="w-3.5 h-3.5 text-amber-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">By Offense Level</h3>
              </div>
              {byLevel.length > 0 ? (
                <div className="space-y-2">
                  {byLevel.map((l, i) => {
                    const total = byLevel.reduce((s, e) => s + e.count, 0);
                    const pct = total > 0 ? Math.round((l.count / total) * 100) : 0;
                    const color = LEVEL_COLORS[l.offense_level] ?? 'rgb(var(--rmpg-500-rgb))';
                    return (
                      <div key={i}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[9px] text-rmpg-300 uppercase font-bold">{toDisplayLabel(l.offense_level) || 'Unknown'}</span>
                          <span className="text-[9px] font-mono font-bold" style={{ color }}>{l.count} ({pct}%)</span>
                        </div>
                        <div className="h-2 bg-rmpg-800/50 overflow-hidden" style={{ borderRadius: '2px' }}>
                          <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: color, borderRadius: '2px' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-rmpg-500">
                  <PieChart className="w-5 h-5 text-rmpg-600 mb-1" />
                  <p className="text-[10px]">No level breakdown available</p>
                </div>
              )}
            </div>
          </div>

          {/* Monthly Trend */}
          <div className="panel-surface p-3">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-3.5 h-3.5 text-green-400" />
              <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Monthly Citation Trend</h3>
            </div>
            <div className="flex items-end gap-1 h-32">
              {trend.length > 0 ? (
                trend.map((t, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                    <span className="text-[8px] font-mono text-brand-400 font-bold tabular-nums opacity-70 group-hover:opacity-100 transition-opacity">{t.count}</span>
                    <div
                      className="w-full bg-brand-600/60 group-hover:bg-brand-500/70 transition-all"
                      style={{ height: `${(t.count / trendMax) * 100}%`, minHeight: 2, borderRadius: '2px 2px 0 0' }}
                    />
                    <span className="text-[7px] text-rmpg-500 font-mono">{t.month.slice(5)}</span>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center w-full py-4 text-rmpg-500">
                  <TrendingUp className="w-5 h-5 text-rmpg-600 mb-1" />
                  <p className="text-[10px]">No trend data available</p>
                </div>
              )}
            </div>
          </div>

          {/* Commonly Paired Statutes */}
          {topStatutes.length > 1 && (
            <div className="panel-surface p-3">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-3.5 h-3.5 text-rmpg-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Commonly Paired Statutes</h3>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-auto">
                {(() => {
                  const pairs: { a: string; aTitle: string; b: string; bTitle: string; score: number }[] = [];
                  const sorted = [...topStatutes].sort((x, y) => y.count - x.count).slice(0, 15);
                  for (let i = 0; i < sorted.length; i++) {
                    for (let j = i + 1; j < sorted.length; j++) {
                      const a = sorted[i], b = sorted[j];
                      const sameLevel = a.offense_level === b.offense_level;
                      const score = Math.min(a.count, b.count) * (sameLevel ? 1.5 : 1);
                      if (score >= 2) {
                        pairs.push({ a: a.statute_number, aTitle: a.title, b: b.statute_number, bTitle: b.title, score: Math.round(score) });
                      }
                    }
                  }
                  const top8 = pairs.sort((x, y) => y.score - x.score).slice(0, 8);
                  if (top8.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-4 text-rmpg-500">
                        <p className="text-[10px]">No pairing patterns detected in this period</p>
                      </div>
                    );
                  }
                  return top8.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 py-1 border-b border-rmpg-700/50 last:border-0">
                      <span className="text-[9px] font-mono text-rmpg-400 w-20 shrink-0 truncate">{p.a}</span>
                      <span className="text-[9px] text-rmpg-500">frequently occurs with</span>
                      <span className="text-[9px] font-mono text-rmpg-400 w-20 shrink-0 truncate">{p.b}</span>
                      <span className="text-[9px] font-mono text-rmpg-400 ml-auto">({p.score}×)</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ConfirmDialog: clear analytics cache (admin/manager only) */}
      <ConfirmDialog
        isOpen={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        onConfirm={() => {
          setClearConfirmOpen(false);
          setTopStatutes([]);
          setByLevel([]);
          setTrend([]);
          setIncidentStatutes([]);
          setHasLoaded(false);
          setLoading(true);
          fetchData();
          addToast('Analytics cache cleared — refreshing', 'info');
        }}
        title="Clear Analytics Cache"
        message="This will reset cached statute analytics and re-fetch from the database. Continue?"
        confirmLabel="Clear &amp; Refresh"
        confirmVariant="warning"
      />
    </div>
  );
}
