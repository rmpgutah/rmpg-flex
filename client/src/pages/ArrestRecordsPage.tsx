// ============================================================
// RMPG Flex — Arrest Records Page
// ============================================================
// Visual jail roster dashboard: county population cards,
// intake/release statistics, searchable records table, and
// person linking. Data sourced from automated county scrapers.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Database, Search, X, Loader2, ChevronDown, ChevronRight,
  Users, UserPlus, UserMinus, MapPin, Clock, Shield, Activity,
  BarChart3, TrendingUp, TrendingDown, Minus, Eye,
  Link2, Unlink, AlertTriangle, RefreshCw, Filter,
  ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';

// ── Types ─────────────────────────────────────────────────

interface CountyStat {
  county: string;
  display_name: string;
  total_records: number;
  active_count: number;
  released_count: number;
  earliest_booking: string | null;
  newest_booking: string | null;
  male_count: number;
  female_count: number;
  details_fetched: number;
  avg_stay_days: number | null;
}

interface DailyActivity {
  day: string;
  county: string;
  intakes: number;
  releases: number;
  population: number;
  scrape_runs: number;
}

interface PopulationSummary {
  total_records: number;
  total_active: number;
  total_released: number;
  counties_with_data: number;
  intakes_today: number;
  releases_today: number;
}

interface ArrestRecord {
  id: number;
  full_name: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  booking_date: string | null;
  release_date: string | null;
  charges: string[];
  county: string;
  source_id: string;
  status: string;
  booking_number: string | null;
  agency: string | null;
  gender: string | null;
  age: number | null;
  height: string | null;
  weight: string | null;
  hair_color: string | null;
  eye_color: string | null;
  bail_amount: number | null;
  entry_source: string | null;
  person_id: number | null;
  linked_person: { id: number; name: string } | null;
}

interface PersonResult {
  id: number;
  first_name: string;
  last_name: string;
  dob?: string;
}

// ── County colors ─────────────────────────────────────────

const COUNTY_COLORS: Record<string, string> = {
  weber:     'from-blue-600/20 to-blue-800/10 border-blue-500/30',
  davis:     'from-emerald-600/20 to-emerald-800/10 border-emerald-500/30',
  iron:      'from-red-600/20 to-red-800/10 border-red-500/30',
  salt_lake: 'from-purple-600/20 to-purple-800/10 border-purple-500/30',
  summit:    'from-cyan-600/20 to-cyan-800/10 border-cyan-500/30',
  uinta:     'from-amber-600/20 to-amber-800/10 border-amber-500/30',
};

const COUNTY_ACCENTS: Record<string, string> = {
  weber: 'text-blue-400', davis: 'text-emerald-400', iron: 'text-red-400',
  salt_lake: 'text-purple-400', summit: 'text-cyan-400', uinta: 'text-amber-400',
};

const COUNTY_BAR_COLORS: Record<string, string> = {
  weber: 'bg-blue-500', davis: 'bg-emerald-500', iron: 'bg-red-500',
  salt_lake: 'bg-purple-500', summit: 'bg-cyan-500', uinta: 'bg-amber-500',
};

// ── Component ─────────────────────────────────────────────

export default function ArrestRecordsPage() {
  // Statistics data
  const [stats, setStats] = useState<{
    per_county: CountyStat[];
    daily_activity: DailyActivity[];
    population_summary: PopulationSummary;
  } | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Records table
  const [records, setRecords] = useState<ArrestRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsLoading, setRecordsLoading] = useState(false);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [countyFilter, setCountyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Detail / Link
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [personSearch, setPersonSearch] = useState('');
  const [personResults, setPersonResults] = useState<PersonResult[]>([]);
  const [searchingPerson, setSearchingPerson] = useState(false);
  const [linkingPerson, setLinkingPerson] = useState(false);

  // Sections
  const [showStats, setShowStats] = useState(true);
  const [showActivity, setShowActivity] = useState(false);

  // ── Fetch statistics ──────────────────────────────────────

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await apiFetch<any>('/jail-roster/statistics');
      setStats(data);
    } catch { /* ignore */ }
    finally { setStatsLoading(false); }
  }, []);

  // ── Fetch records ─────────────────────────────────────────

  const fetchRecords = useCallback(async (page = 1) => {
    setRecordsLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: '30',
        source: 'scraper',
        ...(countyFilter ? { source_id: countyFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      });

      let data: any;
      if (searchTerm.trim()) {
        data = await apiFetch<any>(`/arrests/search?name=${encodeURIComponent(searchTerm)}&source=scraper${countyFilter ? `&source_id=${countyFilter}` : ''}`);
        setRecords(data.records || []);
        setRecordsTotal(data.resultCount || data.records?.length || 0);
      } else {
        data = await apiFetch<any>(`/arrests/recent?${qs}`);
        setRecords(data.records || []);
        setRecordsTotal(data.total || 0);
      }
    } catch { /* ignore */ }
    finally { setRecordsLoading(false); }
  }, [searchTerm, countyFilter, statusFilter]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchRecords(recordsPage); }, [fetchRecords, recordsPage]);

  // ── Person search & link ──────────────────────────────────

  const searchPersons = useCallback(async (query: string) => {
    if (query.length < 2) { setPersonResults([]); return; }
    setSearchingPerson(true);
    try {
      const data = await apiFetch<any>(`/records/persons/search?q=${encodeURIComponent(query)}&limit=8`);
      setPersonResults(data.results || data || []);
    } catch { setPersonResults([]); }
    finally { setSearchingPerson(false); }
  }, []);

  useEffect(() => {
    if (!linkingId) return;
    const timer = setTimeout(() => searchPersons(personSearch), 300);
    return () => clearTimeout(timer);
  }, [personSearch, searchPersons, linkingId]);

  const handleLinkPerson = async (arrestId: number, personId: number) => {
    setLinkingPerson(true);
    try {
      await apiFetch(`/arrests/${arrestId}/link-person`, {
        method: 'PUT',
        body: JSON.stringify({ person_id: personId }),
      });
      setLinkingId(null);
      setPersonSearch('');
      setPersonResults([]);
      fetchRecords(recordsPage);
    } catch { /* ignore */ }
    finally { setLinkingPerson(false); }
  };

  const handleUnlinkPerson = async (arrestId: number) => {
    try {
      await apiFetch(`/arrests/${arrestId}/link-person`, { method: 'DELETE' });
      fetchRecords(recordsPage);
    } catch { /* ignore */ }
  };

  // ── Derived values ────────────────────────────────────────

  const totalPages = Math.ceil(recordsTotal / 30);
  const maxPopulation = stats?.per_county ? Math.max(...stats.per_county.map(c => c.active_count), 1) : 1;

  // Aggregate daily activity for the summary chart (last 7 days)
  const last7Days = stats?.daily_activity
    ? (() => {
        const byDay = new Map<string, { intakes: number; releases: number }>();
        for (const a of stats.daily_activity) {
          const existing = byDay.get(a.day) || { intakes: 0, releases: 0 };
          existing.intakes += a.intakes;
          existing.releases += a.releases;
          byDay.set(a.day, existing);
        }
        return [...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-7)
          .map(([day, v]) => ({ day: day.substring(5), ...v }));
      })()
    : [];

  return (
    <div className="h-full flex flex-col bg-surface-base">
      <PanelTitleBar title="Arrest Records" icon={Shield} />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ═══ Summary Bar ═══ */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { label: 'Total Records', value: stats?.population_summary?.total_records || 0, icon: Database, color: 'text-brand-400' },
            { label: 'In Custody', value: stats?.population_summary?.total_active || 0, icon: Users, color: 'text-red-400' },
            { label: 'Released', value: stats?.population_summary?.total_released || 0, icon: UserMinus, color: 'text-green-400' },
            { label: 'Counties', value: stats?.population_summary?.counties_with_data || 0, icon: MapPin, color: 'text-purple-400' },
            { label: 'Intakes Today', value: stats?.population_summary?.intakes_today || 0, icon: TrendingUp, color: 'text-amber-400' },
            { label: 'Releases Today', value: stats?.population_summary?.releases_today || 0, icon: TrendingDown, color: 'text-cyan-400' },
          ].map(s => (
            <div key={s.label} className="panel-beveled bg-surface-base p-2.5 rounded-sm text-center">
              <s.icon className={`w-4 h-4 mx-auto mb-1 ${s.color}`} />
              <div className={`text-lg font-bold ${s.color}`}>{s.value.toLocaleString()}</div>
              <div className="text-[8px] text-rmpg-500 uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ═══ County Population Cards ═══ */}
        <div className="panel-beveled bg-surface-base rounded-sm">
          <button
            onClick={() => setShowStats(!showStats)}
            className="w-full flex items-center gap-2 p-3 text-left"
          >
            {showStats ? <ChevronDown className="w-3.5 h-3.5 text-rmpg-500" /> : <ChevronRight className="w-3.5 h-3.5 text-rmpg-500" />}
            <BarChart3 className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">County Population &amp; Statistics</span>
          </button>

          {showStats && (
            <div className="px-3 pb-3 space-y-3">
              {statsLoading ? (
                <div className="flex items-center gap-2 text-[10px] text-rmpg-500 py-4 justify-center">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading statistics...
                </div>
              ) : stats?.per_county?.length ? (
                <>
                  {/* County cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {stats.per_county.map(c => (
                      <div
                        key={c.county}
                        className={`bg-gradient-to-br ${COUNTY_COLORS[c.county] || 'from-rmpg-700/20 to-rmpg-800/10 border-rmpg-600/30'} border rounded-sm p-3 cursor-pointer hover:brightness-110 transition-all ${countyFilter === c.county ? 'ring-1 ring-brand-400' : ''}`}
                        onClick={() => { setCountyFilter(countyFilter === c.county ? '' : c.county); setRecordsPage(1); }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-rmpg-100">{c.display_name || c.county}</span>
                          <span className={`text-lg font-black ${COUNTY_ACCENTS[c.county] || 'text-brand-400'}`}>
                            {c.active_count}
                          </span>
                        </div>

                        {/* Population bar */}
                        <div className="w-full bg-rmpg-800/50 rounded-full h-2 mb-2">
                          <div
                            className={`h-2 rounded-full transition-all ${COUNTY_BAR_COLORS[c.county] || 'bg-brand-500'}`}
                            style={{ width: `${(c.active_count / maxPopulation) * 100}%` }}
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-1 text-[8px] text-rmpg-400">
                          <div className="text-center">
                            <div className="font-bold text-rmpg-200">{c.total_records}</div>
                            <div>TOTAL</div>
                          </div>
                          <div className="text-center">
                            <div className="font-bold text-green-400">{c.released_count}</div>
                            <div>RELEASED</div>
                          </div>
                          <div className="text-center">
                            <div className="font-bold text-rmpg-300">
                              {c.male_count}M / {c.female_count}F
                            </div>
                            <div>GENDER</div>
                          </div>
                        </div>

                        {c.avg_stay_days !== null && (
                          <div className="mt-1.5 text-[8px] text-rmpg-500 text-center">
                            Avg stay: <span className="text-rmpg-300 font-bold">{c.avg_stay_days}d</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* 7-day intake/release mini chart */}
                  {last7Days.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-2">
                        7-Day Intake / Release Activity
                      </div>
                      <div className="flex items-end gap-1 h-16">
                        {last7Days.map(d => {
                          const maxVal = Math.max(...last7Days.map(x => Math.max(x.intakes, x.releases)), 1);
                          return (
                            <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5">
                              <div className="flex items-end gap-px w-full h-12">
                                <div
                                  className="flex-1 bg-amber-500/60 rounded-t-sm min-h-[2px]"
                                  style={{ height: `${(d.intakes / maxVal) * 100}%` }}
                                  title={`${d.intakes} intakes`}
                                />
                                <div
                                  className="flex-1 bg-cyan-500/60 rounded-t-sm min-h-[2px]"
                                  style={{ height: `${(d.releases / maxVal) * 100}%` }}
                                  title={`${d.releases} releases`}
                                />
                              </div>
                              <span className="text-[7px] text-rmpg-600">{d.day}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-[8px] text-rmpg-500">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-500/60 rounded-sm" /> Intakes</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-cyan-500/60 rounded-sm" /> Releases</span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[10px] text-rmpg-500 py-4 text-center">No statistics available yet.</div>
              )}
            </div>
          )}
        </div>

        {/* ═══ Daily Activity Log (Collapsible) ═══ */}
        <div className="panel-beveled bg-surface-base rounded-sm">
          <button
            onClick={() => { setShowActivity(!showActivity); }}
            className="w-full flex items-center gap-2 p-3 text-left"
          >
            {showActivity ? <ChevronDown className="w-3.5 h-3.5 text-rmpg-500" /> : <ChevronRight className="w-3.5 h-3.5 text-rmpg-500" />}
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Daily Activity Log</span>
          </button>

          {showActivity && stats?.daily_activity && (
            <div className="px-3 pb-3">
              <div className="space-y-0.5 max-h-[250px] overflow-y-auto">
                {stats.daily_activity.slice(0, 30).map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-[9px] px-2 py-1 rounded-sm bg-surface-sunken">
                    <span className="text-rmpg-500 w-14 shrink-0">{a.day}</span>
                    <span className={`w-16 shrink-0 font-bold ${COUNTY_ACCENTS[a.county] || 'text-rmpg-300'}`}>
                      {a.county}
                    </span>
                    <span className="text-rmpg-400 w-12 shrink-0">Pop: {a.population}</span>
                    {a.intakes > 0 && (
                      <span className="text-amber-400 flex items-center gap-0.5">
                        <TrendingUp className="w-2.5 h-2.5" /> +{a.intakes}
                      </span>
                    )}
                    {a.releases > 0 && (
                      <span className="text-cyan-400 flex items-center gap-0.5">
                        <TrendingDown className="w-2.5 h-2.5" /> -{a.releases}
                      </span>
                    )}
                    {a.intakes === 0 && a.releases === 0 && (
                      <span className="text-rmpg-600 flex items-center gap-0.5">
                        <Minus className="w-2.5 h-2.5" /> no change
                      </span>
                    )}
                    <span className="text-rmpg-600 ml-auto">{a.scrape_runs} runs</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ═══ Records Table ═══ */}
        <div className="panel-beveled bg-surface-base p-3 space-y-2">
          {/* Search & Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setRecordsPage(1); }}
                placeholder="Search inmates by name..."
                className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] pl-7 pr-8 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <select
              value={countyFilter}
              onChange={e => { setCountyFilter(e.target.value); setRecordsPage(1); }}
              className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1.5 rounded-sm"
            >
              <option value="">All Counties</option>
              {(stats?.per_county || []).map(c => (
                <option key={c.county} value={c.county}>{c.display_name || c.county} ({c.active_count})</option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setRecordsPage(1); }}
              className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1.5 rounded-sm"
            >
              <option value="">All Status</option>
              <option value="active">In Custody</option>
              <option value="released">Released</option>
            </select>

            <button
              onClick={() => { fetchStats(); fetchRecords(recordsPage); }}
              className="toolbar-btn text-[10px] flex items-center gap-1 px-2 py-1.5 text-rmpg-400 hover:text-rmpg-200"
            >
              <RefreshCw className="w-3 h-3" />
            </button>

            <div className="text-[9px] text-rmpg-500 ml-auto">
              {recordsTotal.toLocaleString()} records
            </div>
          </div>

          {/* Table header */}
          <div className="flex items-center gap-2 px-2 py-1 text-[8px] text-rmpg-500 uppercase tracking-wider border-b border-rmpg-700/50">
            <span className="w-1" />
            <span className="flex-1">Name</span>
            <span className="w-20 text-center hidden sm:block">County</span>
            <span className="w-20 text-center hidden sm:block">Booked</span>
            <span className="w-14 text-center">Status</span>
            <span className="w-20 text-center hidden md:block">Charges</span>
            <span className="w-16 text-center hidden md:block">Linked</span>
          </div>

          {/* Records */}
          {recordsLoading ? (
            <div className="flex items-center gap-2 text-[10px] text-rmpg-500 py-6 justify-center">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading records...
            </div>
          ) : records.length === 0 ? (
            <div className="text-center text-[10px] text-rmpg-500 py-6">
              No records found. Adjust filters or wait for the next scraper sync.
            </div>
          ) : (
            <div className="space-y-0.5 max-h-[50vh] overflow-y-auto">
              {records.map(rec => {
                const isExpanded = expandedId === rec.id;
                const isLinking = linkingId === rec.id;
                const chargeCount = Array.isArray(rec.charges) ? rec.charges.length : 0;

                return (
                  <div key={rec.id}>
                    {/* Main row */}
                    <div
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-colors ${
                        isExpanded ? 'bg-rmpg-700/30' : 'bg-surface-sunken hover:bg-rmpg-800/30'
                      }`}
                      onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                    >
                      {/* County color bar */}
                      <div className={`shrink-0 w-1 h-8 rounded-full ${COUNTY_BAR_COLORS[rec.source_id] || 'bg-rmpg-600'}`} />

                      {/* Name */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-rmpg-100 truncate">{rec.full_name}</span>
                          {rec.booking_number && (
                            <span className="text-[8px] font-mono text-rmpg-500">#{rec.booking_number}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[8px] text-rmpg-500 sm:hidden">
                          {rec.source_id && <span className={COUNTY_ACCENTS[rec.source_id] || ''}>{rec.source_id}</span>}
                          {rec.booking_date && <span>{String(rec.booking_date).substring(0, 10)}</span>}
                        </div>
                      </div>

                      {/* County */}
                      <span className={`w-20 text-center text-[9px] font-bold hidden sm:block ${COUNTY_ACCENTS[rec.source_id] || 'text-rmpg-400'}`}>
                        {rec.source_id || '—'}
                      </span>

                      {/* Booking date */}
                      <span className="w-20 text-center text-[9px] text-rmpg-400 hidden sm:block">
                        {rec.booking_date ? String(rec.booking_date).substring(0, 10) : '—'}
                      </span>

                      {/* Status */}
                      <span className={`w-14 text-center text-[8px] font-bold uppercase px-1 py-0.5 rounded ${
                        rec.status === 'active' ? 'bg-red-900/40 text-red-400' :
                        rec.status === 'released' ? 'bg-green-900/40 text-green-400' :
                        'bg-rmpg-700 text-rmpg-400'
                      }`}>
                        {rec.status === 'active' ? 'CUSTODY' : rec.status}
                      </span>

                      {/* Charges count */}
                      <span className="w-20 text-center text-[9px] hidden md:block">
                        {chargeCount > 0 ? (
                          <span className="text-amber-400">{chargeCount} charge{chargeCount !== 1 ? 's' : ''}</span>
                        ) : (
                          <span className="text-rmpg-600">—</span>
                        )}
                      </span>

                      {/* Person link indicator */}
                      <span className="w-16 text-center hidden md:block">
                        {rec.linked_person ? (
                          <span className="text-[8px] text-brand-400 flex items-center justify-center gap-0.5">
                            <Link2 className="w-2.5 h-2.5" /> linked
                          </span>
                        ) : (
                          <span className="text-[8px] text-rmpg-600">—</span>
                        )}
                      </span>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="bg-rmpg-800/20 border border-rmpg-700/30 rounded-sm mx-2 mb-1 p-3 space-y-2">
                        {/* Detail grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[9px]">
                          {[
                            { label: 'Gender', value: rec.gender },
                            { label: 'Age', value: rec.age },
                            { label: 'Height', value: rec.height },
                            { label: 'Weight', value: rec.weight },
                            { label: 'Hair', value: rec.hair_color },
                            { label: 'Eyes', value: rec.eye_color },
                            { label: 'Bail', value: rec.bail_amount ? `$${Number(rec.bail_amount).toLocaleString()}` : null },
                            { label: 'Release Date', value: rec.release_date ? String(rec.release_date).substring(0, 10) : null },
                          ].filter(f => f.value).map(f => (
                            <div key={f.label}>
                              <span className="text-rmpg-500 uppercase text-[8px]">{f.label}: </span>
                              <span className="text-rmpg-200 font-bold">{f.value}</span>
                            </div>
                          ))}
                        </div>

                        {/* Charges list */}
                        {chargeCount > 0 && (
                          <div>
                            <div className="text-[8px] text-rmpg-500 uppercase mb-0.5">Charges</div>
                            <div className="space-y-0.5">
                              {rec.charges.map((ch, i) => (
                                <div key={i} className="text-[9px] text-amber-300 bg-amber-950/20 px-2 py-0.5 rounded-sm">
                                  {ch}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Person link section */}
                        <div className="border-t border-rmpg-700/30 pt-2">
                          <div className="text-[8px] text-rmpg-500 uppercase mb-1">Linked Person Record</div>
                          {rec.linked_person ? (
                            <div className="flex items-center gap-2">
                              <Link2 className="w-3 h-3 text-brand-400" />
                              <span className="text-[10px] text-brand-300 font-bold">{rec.linked_person.name}</span>
                              <span className="text-[8px] text-rmpg-500">(ID: {rec.linked_person.id})</span>
                              <button
                                onClick={e => { e.stopPropagation(); handleUnlinkPerson(rec.id); }}
                                className="text-[8px] text-red-400 hover:text-red-300 flex items-center gap-0.5 ml-2"
                              >
                                <Unlink className="w-2.5 h-2.5" /> Unlink
                              </button>
                            </div>
                          ) : isLinking ? (
                            <div className="space-y-1">
                              <div className="relative">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-rmpg-500" />
                                <input
                                  type="text"
                                  value={personSearch}
                                  onChange={e => setPersonSearch(e.target.value)}
                                  placeholder="Search persons by name..."
                                  className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] pl-6 pr-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none"
                                  autoFocus
                                  onClick={e => e.stopPropagation()}
                                />
                              </div>
                              {searchingPerson && (
                                <div className="flex items-center gap-1 text-[9px] text-rmpg-500">
                                  <Loader2 className="w-2.5 h-2.5 animate-spin" /> Searching...
                                </div>
                              )}
                              {personResults.length > 0 && (
                                <div className="space-y-0.5 max-h-[120px] overflow-y-auto">
                                  {personResults.map(p => (
                                    <button
                                      key={p.id}
                                      onClick={e => { e.stopPropagation(); handleLinkPerson(rec.id, p.id); }}
                                      disabled={linkingPerson}
                                      className="w-full text-left px-2 py-1 rounded-sm bg-surface-sunken hover:bg-brand-900/30 text-[9px] flex items-center gap-2"
                                    >
                                      <UserPlus className="w-3 h-3 text-brand-400" />
                                      <span className="text-rmpg-200 font-bold">{p.last_name}, {p.first_name}</span>
                                      {p.dob && <span className="text-rmpg-500">DOB: {p.dob}</span>}
                                    </button>
                                  ))}
                                </div>
                              )}
                              <button
                                onClick={e => { e.stopPropagation(); setLinkingId(null); setPersonSearch(''); setPersonResults([]); }}
                                className="text-[8px] text-rmpg-500 hover:text-rmpg-300"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); setLinkingId(rec.id); }}
                              className="text-[9px] text-brand-400 hover:text-brand-300 flex items-center gap-1"
                            >
                              <UserPlus className="w-3 h-3" /> Link to Person Record
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 border-t border-rmpg-700/30">
              <button
                disabled={recordsPage <= 1}
                onClick={() => setRecordsPage(p => p - 1)}
                className="text-[10px] text-rmpg-400 hover:text-rmpg-200 disabled:opacity-30 px-2 py-1"
              >
                ← Previous
              </button>
              <span className="text-[10px] text-rmpg-500">
                Page {recordsPage} of {totalPages}
              </span>
              <button
                disabled={recordsPage >= totalPages}
                onClick={() => setRecordsPage(p => p + 1)}
                className="text-[10px] text-rmpg-400 hover:text-rmpg-200 disabled:opacity-30 px-2 py-1"
              >
                Next →
              </button>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="text-[9px] text-rmpg-600 px-1">
          Data sourced from Utah county jail rosters via automated scrapers.
          Click a county card to filter. Expand a record to view details or link to a person record.
        </div>
      </div>
    </div>
  );
}
