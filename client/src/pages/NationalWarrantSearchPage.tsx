// ============================================================
// RMPG Flex — National Warrant Search Page
// Multi-state warrant search with US coverage map
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { Globe, Search, User, AlertTriangle, MapPin, Loader2, X, Shield, Gavel, ChevronDown } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatDate } from '../utils/dateUtils';

type CoverageStatus = 'active' | 'pending' | 'disabled';

interface NationalCoverageState {
  stateCode: string;
  stateName: string;
  available: boolean;
  message?: string;
}

interface NationalCoverageResponse {
  states: NationalCoverageState[];
  updatedAt?: string;
  sources?: number;
  states_covered?: number;
  active_warrants?: number;
  state_status?: Record<string, CoverageStatus>;
  state_sources?: Record<string, number>;
  state_warrants?: Record<string, number>;
}

interface NationalWarrantSearchResults {
  total?: number;
  search_time_ms?: number;
  by_state?: Record<string, Warrant[]>;
  local?: Warrant[];
  error?: string;
}

interface Warrant {
  id?: string | number;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  dob?: string;
  age?: number | string;
  state?: string;
  warrant_type?: string | null;
  offense_level?: string | null;
  charge?: string;
  charges?: string;
  issued_date?: string | null;
  photo_url?: string | null;
  status?: string | null;
  bond_amount?: number | string | null;
  court?: string;
  source?: string;
}

// ── US States List ──────────────────────────────────────────
const US_STATES = [
  { code: '', label: 'All States' },
  { code: 'US', label: 'Federal' },
  { code: 'AL', label: 'Alabama' },
  { code: 'AK', label: 'Alaska' },
  { code: 'AZ', label: 'Arizona' },
  { code: 'AR', label: 'Arkansas' },
  { code: 'CA', label: 'California' },
  { code: 'CO', label: 'Colorado' },
  { code: 'CT', label: 'Connecticut' },
  { code: 'DE', label: 'Delaware' },
  { code: 'DC', label: 'District of Columbia' },
  { code: 'FL', label: 'Florida' },
  { code: 'GA', label: 'Georgia' },
  { code: 'HI', label: 'Hawaii' },
  { code: 'ID', label: 'Idaho' },
  { code: 'IL', label: 'Illinois' },
  { code: 'IN', label: 'Indiana' },
  { code: 'IA', label: 'Iowa' },
  { code: 'KS', label: 'Kansas' },
  { code: 'KY', label: 'Kentucky' },
  { code: 'LA', label: 'Louisiana' },
  { code: 'ME', label: 'Maine' },
  { code: 'MD', label: 'Maryland' },
  { code: 'MA', label: 'Massachusetts' },
  { code: 'MI', label: 'Michigan' },
  { code: 'MN', label: 'Minnesota' },
  { code: 'MS', label: 'Mississippi' },
  { code: 'MO', label: 'Missouri' },
  { code: 'MT', label: 'Montana' },
  { code: 'NE', label: 'Nebraska' },
  { code: 'NV', label: 'Nevada' },
  { code: 'NH', label: 'New Hampshire' },
  { code: 'NJ', label: 'New Jersey' },
  { code: 'NM', label: 'New Mexico' },
  { code: 'NY', label: 'New York' },
  { code: 'NC', label: 'North Carolina' },
  { code: 'ND', label: 'North Dakota' },
  { code: 'OH', label: 'Ohio' },
  { code: 'OK', label: 'Oklahoma' },
  { code: 'OR', label: 'Oregon' },
  { code: 'PA', label: 'Pennsylvania' },
  { code: 'RI', label: 'Rhode Island' },
  { code: 'SC', label: 'South Carolina' },
  { code: 'SD', label: 'South Dakota' },
  { code: 'TN', label: 'Tennessee' },
  { code: 'TX', label: 'Texas' },
  { code: 'UT', label: 'Utah' },
  { code: 'VT', label: 'Vermont' },
  { code: 'VA', label: 'Virginia' },
  { code: 'WA', label: 'Washington' },
  { code: 'WV', label: 'West Virginia' },
  { code: 'WI', label: 'Wisconsin' },
  { code: 'WY', label: 'Wyoming' },
];

const OFFENSE_LEVELS = [
  { code: '', label: 'All Levels' },
  { code: 'felony', label: 'Felony' },
  { code: 'misdemeanor', label: 'Misdemeanor' },
  { code: 'infraction', label: 'Infraction' },
];

const WARRANT_TYPES = [
  { code: '', label: 'All Types' },
  { code: 'arrest', label: 'Arrest Warrant' },
  { code: 'bench', label: 'Bench Warrant' },
  { code: 'search', label: 'Search Warrant' },
  { code: 'civil', label: 'Civil Warrant' },
  { code: 'extradition', label: 'Extradition' },
  { code: 'fugitive', label: 'Fugitive Warrant' },
];

// ── SVG State Map Data ──────────────────────────────────────
// Simplified US state grid for coverage map. Each state positioned
// in an approximate geographic grid. Columns 0-10 (west to east),
// rows 0-6 (north to south).
const STATE_GRID: { code: string; label: string; col: number; row: number }[] = [
  // Row 0 — Alaska / northern states
  { code: 'AK', label: 'AK', col: 0, row: 0 },
  { code: 'WA', label: 'WA', col: 1, row: 0 },
  { code: 'MT', label: 'MT', col: 3, row: 0 },
  { code: 'ND', label: 'ND', col: 5, row: 0 },
  { code: 'MN', label: 'MN', col: 6, row: 0 },
  { code: 'WI', label: 'WI', col: 7, row: 0 },
  { code: 'MI', label: 'MI', col: 8, row: 0 },
  { code: 'VT', label: 'VT', col: 9, row: 0 },
  { code: 'NH', label: 'NH', col: 10, row: 0 },
  { code: 'ME', label: 'ME', col: 11, row: 0 },
  // Row 1
  { code: 'HI', label: 'HI', col: 0, row: 1 },
  { code: 'OR', label: 'OR', col: 1, row: 1 },
  { code: 'ID', label: 'ID', col: 2, row: 1 },
  { code: 'WY', label: 'WY', col: 3, row: 1 },
  { code: 'SD', label: 'SD', col: 5, row: 1 },
  { code: 'IA', label: 'IA', col: 6, row: 1 },
  { code: 'IL', label: 'IL', col: 7, row: 1 },
  { code: 'IN', label: 'IN', col: 8, row: 1 },
  { code: 'NY', label: 'NY', col: 9, row: 1 },
  { code: 'MA', label: 'MA', col: 10, row: 1 },
  { code: 'CT', label: 'CT', col: 11, row: 1 },
  // Row 2
  { code: 'CA', label: 'CA', col: 0, row: 2 },
  { code: 'NV', label: 'NV', col: 1, row: 2 },
  { code: 'UT', label: 'UT', col: 2, row: 2 },
  { code: 'CO', label: 'CO', col: 3, row: 2 },
  { code: 'NE', label: 'NE', col: 5, row: 2 },
  { code: 'KS', label: 'KS', col: 5, row: 3 },
  { code: 'MO', label: 'MO', col: 6, row: 2 },
  { code: 'OH', label: 'OH', col: 8, row: 2 },
  { code: 'PA', label: 'PA', col: 9, row: 2 },
  { code: 'NJ', label: 'NJ', col: 10, row: 2 },
  { code: 'RI', label: 'RI', col: 11, row: 2 },
  // Row 3
  { code: 'AZ', label: 'AZ', col: 1, row: 3 },
  { code: 'NM', label: 'NM', col: 2, row: 3 },
  { code: 'OK', label: 'OK', col: 4, row: 3 },
  { code: 'AR', label: 'AR', col: 6, row: 3 },
  { code: 'KY', label: 'KY', col: 7, row: 2 },
  { code: 'WV', label: 'WV', col: 8, row: 3 },
  { code: 'VA', label: 'VA', col: 9, row: 3 },
  { code: 'DE', label: 'DE', col: 10, row: 3 },
  { code: 'MD', label: 'MD', col: 11, row: 3 },
  // Row 4
  { code: 'TX', label: 'TX', col: 3, row: 4 },
  { code: 'LA', label: 'LA', col: 5, row: 4 },
  { code: 'MS', label: 'MS', col: 6, row: 4 },
  { code: 'TN', label: 'TN', col: 7, row: 3 },
  { code: 'NC', label: 'NC', col: 9, row: 4 },
  { code: 'SC', label: 'SC', col: 10, row: 4 },
  { code: 'DC', label: 'DC', col: 11, row: 4 },
  // Row 5
  { code: 'AL', label: 'AL', col: 7, row: 4 },
  { code: 'GA', label: 'GA', col: 8, row: 4 },
  { code: 'FL', label: 'FL', col: 8, row: 5 },
];

// ── Coverage status colors ──────────────────────────────────
function coverageFill(status: CoverageStatus | undefined): string {
  switch (status) {
    case 'active': return '#166534'; // green-800
    case 'pending': return '#78350f'; // amber-900
    default: return '#1f2937'; // gray-800
  }
}
function coverageStroke(status: CoverageStatus | undefined): string {
  switch (status) {
    case 'active': return '#22c55e';
    case 'pending': return '#f59e0b';
    default: return '#4b5563';
  }
}
function coverageHoverFill(status: CoverageStatus | undefined): string {
  switch (status) {
    case 'active': return '#15803d';
    case 'pending': return '#92400e';
    default: return '#374151';
  }
}

// ── Severity badge colors ───────────────────────────────────
function severityBadge(level: string) {
  switch (level?.toLowerCase()) {
    case 'felony':
      return 'bg-red-900/50 text-red-400 border border-red-700/50';
    case 'misdemeanor':
      return 'bg-amber-900/50 text-amber-400 border border-amber-700/50';
    case 'infraction':
      return 'bg-blue-900/50 text-blue-400 border border-blue-700/50';
    default:
      return 'bg-gray-900/50 text-gray-400 border border-gray-700/50';
  }
}

function typeBadge(type: string) {
  switch (type?.toLowerCase()) {
    case 'arrest':
    case 'arrest warrant':
      return 'bg-red-900/50 text-red-400 border border-red-700/50';
    case 'bench':
    case 'bench warrant':
      return 'bg-orange-900/50 text-orange-400 border border-orange-700/50';
    case 'fugitive':
    case 'fugitive warrant':
      return 'bg-rose-900/50 text-rose-400 border border-rose-700/50';
    case 'extradition':
      return 'bg-purple-900/50 text-purple-400 border border-purple-700/50';
    default:
      return 'bg-gray-900/50 text-gray-400 border border-gray-700/50';
  }
}

// ── Main Component ──────────────────────────────────────────

export default function NationalWarrantSearchPage() {
  const isMobile = useIsMobile();

  // Search form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [offenseLevel, setOffenseLevel] = useState('');
  const [warrantType, setWarrantType] = useState('');
  const [chargeKeyword, setChargeKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<NationalWarrantSearchResults | null>(null);
  const [coverage, setCoverage] = useState<NationalCoverageResponse | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [searchValidationError, setSearchValidationError] = useState<string | null>(null);

  // Map hover tooltip
  const [hoveredState, setHoveredState] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Collapsed state groups in results
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // ── Load Coverage ─────────────────────────────────────────
  useEffect(() => {
    setCoverageLoading(true);
    apiFetch<NationalCoverageResponse>('/api/warrants/national-coverage')
      .then(data => setCoverage(data))
      .catch(() => setCoverage(null))
      .finally(() => setCoverageLoading(false));
  }, []);

  // ── Search Handler ────────────────────────────────────────
  const handleSearch = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!firstName && !lastName && !dob && !stateFilter && !chargeKeyword) {
      setSearchValidationError('Enter at least one search criterion to run a national warrant search.');
      return;
    }

    setSearchValidationError(null);
    setSearching(true);
    setResults(null);
    try {
      const data = await apiFetch<NationalWarrantSearchResults>('/api/warrants/national-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          dob: dob || undefined,
          state: stateFilter || undefined,
          offense_level: offenseLevel || undefined,
          warrant_type: warrantType || undefined,
          charge_keyword: chargeKeyword || undefined,
        }),
      });
      setResults(data);
    } catch (error) {
      console.error('National warrant search failed:', error);
      const errorMessage = error instanceof Error && error.message
        ? `Search failed: ${error.message}`
        : 'Search failed. Please try again or check your connection.';
      setResults({ total: 0, search_time_ms: 0, by_state: {}, local: [], error: errorMessage });
    } finally {
      setSearching(false);
    }
  }, [firstName, lastName, dob, stateFilter, offenseLevel, warrantType, chargeKeyword]);

  const clearSearch = () => {
    setFirstName('');
    setLastName('');
    setDob('');
    setStateFilter('');
    setOffenseLevel('');
    setWarrantType('');
    setChargeKeyword('');
    setResults(null);
    setCollapsedGroups(new Set());
  };

  const handleStateClick = (code: string) => {
    setStateFilter(prev => prev === code ? '' : code);
  };

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ── Computed Stats ────────────────────────────────────────
  const sourceCount = coverage?.sources ?? 50;
  const statesCovered = coverage?.states_covered ?? 0;
  const activeWarrants = coverage?.active_warrants ?? 0;
  const stateCoverage: Record<string, CoverageStatus> = coverage?.state_status ?? {};

  const totalResults = results?.total ?? 0;
  const searchTime = results?.search_time_ms ?? 0;
  const stateGroups: Record<string, Warrant[]> = results?.by_state ?? {};
  const localResults: Warrant[] = results?.local ?? [];
  const stateGroupKeys = Object.keys(stateGroups).sort();

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0a0a0a]">
      {/* ─── Header ──────────────────────────────────── */}
      <PanelTitleBar title="NATIONAL WARRANT SEARCH" icon={Globe}>
        <span className="text-[10px] text-rmpg-400 font-mono tracking-wide">
          {sourceCount}+ sources
        </span>
        <span className="text-rmpg-500 mx-1">|</span>
        <span className="text-[10px] text-rmpg-400 font-mono tracking-wide">
          {statesCovered} states covered
        </span>
        <span className="text-rmpg-500 mx-1">|</span>
        <span className="text-[10px] text-brand-400 font-mono tracking-wide">
          {activeWarrants.toLocaleString()} active warrants
        </span>
      </PanelTitleBar>

      {/* ─── Scrollable Content ──────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-dark p-3 space-y-3">

        {/* ─── Search Form ────────────────────────────── */}
        <form onSubmit={handleSearch} className="panel-raised p-3 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <Search className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">
              Search Parameters
            </span>
          </div>

          {/* Row 1: Name, DOB, State, Search button */}
          <div className={`grid gap-2 ${isMobile ? 'grid-cols-1' : 'grid-cols-[1fr_1fr_120px_140px_auto]'}`}>
            <input
              type="text"
              placeholder="First Name"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              className="input-dark text-xs"
            />
            <input
              type="text"
              placeholder="Last Name"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              className="input-dark text-xs"
            />
            <input
              type="date"
              placeholder="DOB"
              value={dob}
              onChange={e => setDob(e.target.value)}
              className="input-dark text-xs"
            />
            <select
              value={stateFilter}
              onChange={e => setStateFilter(e.target.value)}
              className="input-dark text-xs"
            >
              {US_STATES.map(s => (
                <option key={s.code} value={s.code}>{s.label}</option>
              ))}
            </select>
            <div className="flex gap-1.5">
              <button
                type="submit"
                disabled={searching}
                className="toolbar-btn bg-brand-900/40 text-brand-400 border-brand-700/50 hover:bg-brand-900/60 px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
              >
                {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Search
              </button>
              {(firstName || lastName || dob || stateFilter || offenseLevel || warrantType || chargeKeyword) && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="toolbar-btn text-rmpg-400 hover:text-white px-2 py-1.5 text-xs"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Row 2: Offense Level, Warrant Type, Charge Keyword */}
          <div className={`grid gap-2 ${isMobile ? 'grid-cols-1' : 'grid-cols-[140px_160px_1fr]'}`}>
            <select
              value={offenseLevel}
              onChange={e => setOffenseLevel(e.target.value)}
              className="input-dark text-xs"
            >
              {OFFENSE_LEVELS.map(o => (
                <option key={o.code} value={o.code}>{o.label}</option>
              ))}
            </select>
            <select
              value={warrantType}
              onChange={e => setWarrantType(e.target.value)}
              className="input-dark text-xs"
            >
              {WARRANT_TYPES.map(t => (
                <option key={t.code} value={t.code}>{t.label}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Charge keyword (e.g., assault, DUI, theft)"
              value={chargeKeyword}
              onChange={e => setChargeKeyword(e.target.value)}
              className="input-dark text-xs"
            />
          </div>
        </form>

        {/* ─── Validation Error ────────────────────────── */}
        {searchValidationError && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-950/40 border border-red-800/50 text-red-400 text-xs">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {searchValidationError}
          </div>
        )}

        {/* ─── US Coverage Map ────────────────────────── */}
        <div className="panel-raised p-3">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">
              US Coverage Map
            </span>
            {/* Legend */}
            <div className="ml-auto flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#166534', border: '1px solid #22c55e' }} />
                <span className="text-rmpg-400">Active</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#78350f', border: '1px solid #f59e0b' }} />
                <span className="text-rmpg-400">Pending</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#1f2937', border: '1px solid #4b5563' }} />
                <span className="text-rmpg-400">No Source</span>
              </span>
            </div>
          </div>

          {coverageLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 text-rmpg-400 animate-spin" />
              <span className="ml-2 text-xs text-rmpg-400">Loading coverage data...</span>
            </div>
          ) : (
            <div className="relative panel-inset p-2">
              <svg
                viewBox="0 0 576 288"
                className="w-full"
                style={{ maxHeight: isMobile ? 200 : 320 }}
              >
                {STATE_GRID.map(st => {
                  const status = stateCoverage[st.code] as CoverageStatus | undefined;
                  const isHovered = hoveredState === st.code;
                  const isSelected = stateFilter === st.code;
                  const cellW = 44;
                  const cellH = 42;
                  const gap = 2;
                  const xOff = 4;
                  const yOff = 8;
                  const x = xOff + st.col * (cellW + gap);
                  const y = yOff + st.row * (cellH + gap);
                  return (
                    <g
                      key={st.code}
                      onClick={() => handleStateClick(st.code)}
                      onMouseEnter={(e) => {
                        setHoveredState(st.code);
                        const rect = (e.target as SVGElement).closest('svg')!.getBoundingClientRect();
                        setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top - 10 });
                      }}
                      onMouseLeave={() => setHoveredState(null)}
                      className="cursor-pointer"
                    >
                      <rect
                        x={x}
                        y={y}
                        width={cellW}
                        height={cellH}
                        rx={2}
                        fill={isHovered ? coverageHoverFill(status) : coverageFill(status)}
                        stroke={isSelected ? '#60a5fa' : coverageStroke(status)}
                        strokeWidth={isSelected ? 2 : 1}
                        opacity={isHovered ? 1 : 0.85}
                      />
                      <text
                        x={x + cellW / 2}
                        y={y + cellH / 2 + 1}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="pointer-events-none select-none"
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          fontFamily: 'JetBrains Mono, monospace',
                          fill: isSelected ? '#60a5fa' : status === 'active' ? '#86efac' : status === 'pending' ? '#fcd34d' : '#9ca3af',
                        }}
                      >
                        {st.label}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Hover Tooltip */}
              {hoveredState && (
                <div
                  className="absolute pointer-events-none z-30 panel-raised border border-rmpg-700/60 px-2 py-1 shadow-lg"
                  style={{
                    left: tooltipPos.x,
                    top: tooltipPos.y,
                    transform: 'translate(-50%, -100%)',
                  }}
                >
                  <div className="text-[10px] font-bold text-white">
                    {US_STATES.find(s => s.code === hoveredState)?.label ?? hoveredState}
                  </div>
                  <div className="text-[10px] text-rmpg-400">
                    Status: <span className={
                      stateCoverage[hoveredState] === 'active' ? 'text-green-400' :
                      stateCoverage[hoveredState] === 'pending' ? 'text-amber-400' :
                      'text-gray-500'
                    }>
                      {stateCoverage[hoveredState] ?? 'No source'}
                    </span>
                  </div>
                  {coverage?.state_sources?.[hoveredState] && (
                    <div className="text-[10px] text-rmpg-500">
                      {coverage.state_sources[hoveredState]} sources
                    </div>
                  )}
                  {coverage?.state_warrants?.[hoveredState] && (
                    <div className="text-[10px] text-rmpg-500">
                      {coverage.state_warrants[hoveredState].toLocaleString()} active warrants
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── Searching Indicator ────────────────────── */}
        {searching && (
          <div className="panel-raised p-6 flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
            <span className="text-xs text-rmpg-300">
              Searching national warrant databases...
            </span>
          </div>
        )}

        {/* ─── Search Results ─────────────────────────── */}
        {results && !searching && (
          <div className="space-y-3">
            {/* Summary Bar */}
            <div className="panel-raised p-2 flex items-center gap-3">
              <Shield className="w-3.5 h-3.5 text-brand-400" />
              <span className="text-xs text-rmpg-200">
                <span className="font-bold text-white">{totalResults}</span> results
                across <span className="font-bold text-white">{Object.keys(stateGroups).length + (localResults.length ? 1 : 0)}</span> sources
                in <span className="text-brand-400">{searchTime}ms</span>
              </span>
              {stateFilter && (
                <span className="ml-auto text-[10px] bg-blue-900/50 text-blue-400 border border-blue-700/50 px-1.5 py-0.5 rounded">
                  Filtered: {US_STATES.find(s => s.code === stateFilter)?.label}
                </span>
              )}
            </div>

            {/* Local System Results */}
            {localResults.length > 0 && (
              <div className="panel-raised overflow-hidden">
                <button
                  onClick={() => toggleGroup('LOCAL')}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-brand-900/20 border-b border-brand-700/30 hover:bg-brand-900/30 transition-colors"
                >
                  <ChevronDown className={`w-3 h-3 text-rmpg-400 transition-transform ${collapsedGroups.has('LOCAL') ? '-rotate-90' : ''}`} />
                  <Shield className="w-3.5 h-3.5 text-brand-400" />
                  <span className="text-xs font-bold text-brand-400 uppercase tracking-wider">
                    Local System
                  </span>
                  <span className="ml-1 text-[10px] bg-brand-900/40 text-brand-400 border border-brand-700/50 px-1.5 py-0.5 rounded font-mono">
                    {localResults.length}
                  </span>
                </button>
                {!collapsedGroups.has('LOCAL') && (
                  <div className="divide-y divide-[#1a1a1a]">
                    {localResults.map((w: any, i: number) => (
                      <WarrantRow key={`local-${i}`} warrant={w} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* State Group Results */}
            {stateGroupKeys.map(stateCode => {
              const warrants = stateGroups[stateCode];
              if (!warrants?.length) return null;
              const stateName = US_STATES.find(s => s.code === stateCode)?.label ?? stateCode;
              const isCollapsed = collapsedGroups.has(stateCode);
              return (
                <div key={stateCode} className="panel-raised overflow-hidden">
                  <button
                    onClick={() => toggleGroup(stateCode)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-surface-raised border-b border-[#1a1a1a] hover:bg-surface-sunken transition-colors"
                  >
                    <ChevronDown className={`w-3 h-3 text-rmpg-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                    <MapPin className="w-3.5 h-3.5 text-rmpg-400" />
                    <span className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">
                      {stateName}
                    </span>
                    <span className="ml-1 text-[10px] bg-gray-900/50 text-rmpg-400 border border-gray-700/50 px-1.5 py-0.5 rounded font-mono">
                      {warrants.length}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="divide-y divide-[#1a1a1a]">
                      {warrants.map((w: any, i: number) => (
                        <WarrantRow key={`${stateCode}-${i}`} warrant={w} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* No Results */}
            {totalResults === 0 && (
              <div className="panel-raised p-8 text-center">
                <Search className="w-8 h-8 text-rmpg-500 mx-auto mb-2" />
                <div className="text-xs text-rmpg-400">No warrants found matching your criteria.</div>
                <div className="text-[10px] text-rmpg-500 mt-1">Try broadening your search parameters.</div>
              </div>
            )}
          </div>
        )}

        {/* ─── Empty State (no search yet) ────────────── */}
        {!results && !searching && (
          <div className="panel-raised p-8 text-center">
            <Globe className="w-10 h-10 text-rmpg-500 mx-auto mb-3 opacity-40" />
            <div className="text-xs text-rmpg-400">
              Enter search criteria above to query national warrant databases.
            </div>
            <div className="text-[10px] text-rmpg-500 mt-1">
              Searches across {sourceCount}+ sources in {statesCovered} states.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Warrant Result Row ──────────────────────────────────────
function WarrantRow({ warrant }: { warrant: Warrant }) {
  return (
    <div className="px-3 py-2 hover:bg-surface-sunken transition-colors flex items-start gap-3">
      {/* Photo thumbnail */}
      {warrant.photo_url ? (
        <img
          src={warrant.photo_url}
          alt=""
          className="w-10 h-12 rounded object-cover border border-[#1a1a1a] flex-shrink-0"
        />
      ) : (
        <div className="w-10 h-12 rounded bg-surface-sunken border border-[#1a1a1a] flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-rmpg-500" />
        </div>
      )}

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-white">
            {warrant.last_name?.toUpperCase()}, {warrant.first_name}
          </span>
          {warrant.dob && (
            <span className="text-[10px] text-rmpg-400">
              DOB: {formatDate(warrant.dob)}
            </span>
          )}
          {warrant.age && (
            <span className="text-[10px] text-rmpg-500">
              (Age {warrant.age})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {warrant.charges && (
            <span className="text-[10px] text-rmpg-300 truncate max-w-[300px]" title={warrant.charges}>
              {warrant.charges}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {warrant.offense_level && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${severityBadge(warrant.offense_level)}`}>
              {warrant.offense_level}
            </span>
          )}
          {warrant.warrant_type && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeBadge(warrant.warrant_type)}`}>
              {warrant.warrant_type}
            </span>
          )}
          {warrant.court && (
            <span className="text-[10px] text-rmpg-500 flex items-center gap-0.5">
              <Gavel className="w-2.5 h-2.5" />
              {warrant.court}
            </span>
          )}
          {warrant.source && (
            <span className="text-[10px] bg-surface-sunken text-rmpg-500 border border-[#1a1a1a] px-1.5 py-0.5 rounded">
              {warrant.source}
            </span>
          )}
        </div>
      </div>

      {/* Warrant status indicator */}
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        {warrant.status === 'active' && (
          <span className="flex items-center gap-1 text-[10px] text-red-400">
            <AlertTriangle className="w-3 h-3" />
            Active
          </span>
        )}
        {warrant.issued_date && (
          <span className="text-[10px] text-rmpg-500">
            Issued: {formatDate(warrant.issued_date)}
          </span>
        )}
        {warrant.bond_amount && (
          <span className="text-[10px] text-amber-400 font-mono">
            Bond: ${Number(warrant.bond_amount).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Mock Data for Development ───────────────────────────────
// Mock data functions removed — only real API data is displayed
